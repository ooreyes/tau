import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseRaw, rawTrace } from "../src/io/rawImport";

export const LTSPICE_BINARY = process.env.LTSPICE_BINARY
  ?? "/Applications/LTspice.app/Contents/MacOS/LTspice";

export interface NumericTrace {
  axis: number[];
  values: number[];
}

export interface PairedBatchResult {
  ltspice: Map<string, NumericTrace>;
  ngspice: Map<string, NumericTrace>;
  ltspiceLog: string;
  ngspiceLog: string;
}

export interface PairedBatchOptions {
  measurements?: readonly string[];
  ngspiceNetlist?: string;
  /**
   * Map each LTspice save / extract name to the ngspice raw vector name when
   * the engines disagree (e.g. noise `V(onoise)` ↔ `onoise_spectrum`).
   */
  ngspiceAliases?: Readonly<Record<string, string>>;
  /**
   * When true, omit the `.save` card. Required for LTspice `.noise`, which
   * writes its own density vectors and produces an empty raw when `.save` is
   * forced to a name it does not keep.
   */
  skipSave?: boolean;
  /** Extra raw vectors to pull (in addition to `saves`) under the given keys. */
  extract?: readonly string[];
}

export interface PairedScalarResult {
  ltspice: Map<string, number>;
  ngspice: Map<string, number>;
  ltspiceLog: string;
  ngspiceLog: string;
}

function compatibleOptions(line: string, ltspice: boolean): string {
  if (!/^\.options?\b/i.test(line.trim())) return line;
  if (!ltspice) return line;
  const kept = line.split(/\s+/).filter((token, index) => (
    index === 0 || !/^(?:rshunt|rseries)=/i.test(token)
  ));
  return kept.join(" ");
}

function prepareDeck(
  source: string,
  saves: readonly string[],
  measurements: readonly string[],
  ltspice: boolean,
  skipSave = false,
): string {
  // Drop save/end/measure cards so the harness owns them. Tau's deck builder
  // may already emit authored `.meas` (P1.6); re-appending the same names
  // makes LTspice refuse with "Multiply defined .measure". Also drop `+`
  // wrap lines that belong to a removed `.save` — otherwise orphan
  // `+ @m1[id]` continuations splice onto the previous card and LTspice
  // rejects Class-D / MOSFET decks with "Bad .save request".
  const lines: string[] = [];
  let skippingSaveWrap = false;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^\.save\b/i.test(trimmed)) {
      skippingSaveWrap = true;
      continue;
    }
    if (skippingSaveWrap) {
      if (/^\+/.test(trimmed)) continue;
      skippingSaveWrap = false;
    }
    if (/^\.end\b/i.test(trimmed) || /^\.meas(?:ure)?\b/i.test(trimmed)) continue;
    if (/^\+\s+@/i.test(trimmed)) continue;
    lines.push(compatibleOptions(line, ltspice));
  }
  if (ltspice) lines.push(".options plotwinsize=0");
  if (!skipSave && saves.length > 0) lines.push(`.save ${saves.join(" ")}`);
  lines.push(...measurements);
  lines.push(".end");
  return `${lines.join("\n")}\n`;
}

function decodeLtspiceLog(bytes: Uint8Array): string {
  const utf16 = bytes.length > 3 && bytes[1] === 0;
  return new TextDecoder(utf16 ? "utf-16le" : "utf-8").decode(bytes);
}

interface NgRaw {
  variables: string[];
  values: number[][];
  complex: boolean;
}

/** ngspice's binary raw writer stores every real value as float64. Complex
 * (`.ac`) plots store every variable — including the frequency axis — as a
 * (re, im) float64 pair, matching LTspice's complex layout rather than the
 * mixed float64-axis / float32-dependent real layout. */
export function parseNgspiceRaw(bytes: Uint8Array): NgRaw {
  const marker = new TextEncoder().encode("Binary:\n");
  let dataStart = -1;
  outer: for (let offset = 0; offset + marker.length <= bytes.length; offset += 1) {
    for (let index = 0; index < marker.length; index += 1) {
      if (bytes[offset + index] !== marker[index]) continue outer;
    }
    dataStart = offset + marker.length;
    break;
  }
  if (dataStart < 0) throw new Error("ngspice raw output has no Binary marker");
  const header = new TextDecoder().decode(bytes.subarray(0, dataStart));
  const pointCount = Number(/^No\. Points:\s*(\d+)/im.exec(header)?.[1] ?? "0");
  const variableCount = Number(/^No\. Variables:\s*(\d+)/im.exec(header)?.[1] ?? "0");
  const complex = /\bFlags:\s*[^\r\n]*\bcomplex\b/i.test(header);
  const variableLines = header.split(/\r?\n/).filter((line) => /^\s*\d+\s+\S+/.test(line));
  const variables = variableLines.map((line) => line.trim().split(/\s+/)[1]!);
  if (variables.length !== variableCount || pointCount < 1) {
    throw new Error(`invalid ngspice raw header (${variables.length}/${variableCount} variables, ${pointCount} points)`);
  }
  const stride = complex ? 16 : 8;
  const expectedBytes = pointCount * variableCount * stride;
  if (bytes.length - dataStart < expectedBytes) {
    throw new Error("truncated ngspice raw output");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset + dataStart, expectedBytes);
  const values = Array.from({ length: variableCount }, () => new Array<number>(pointCount));
  let offset = 0;
  for (let point = 0; point < pointCount; point += 1) {
    for (let variable = 0; variable < variableCount; variable += 1) {
      const re = view.getFloat64(offset, true);
      offset += 8;
      if (complex) {
        const im = view.getFloat64(offset, true);
        offset += 8;
        // Axis 0 (frequency) uses the real part; dependents use magnitude so
        // they match LTspice `rawTrace` complex behavior.
        values[variable]![point] = variable === 0 ? re : Math.hypot(re, im);
      } else {
        values[variable]![point] = re;
      }
    }
  }
  return { variables, values, complex };
}

function ngTrace(raw: NgRaw, expression: string): NumericTrace {
  const index = raw.variables.findIndex((name) => name.toLowerCase() === expression.toLowerCase());
  if (index < 0) throw new Error(`ngspice raw output is missing ${expression}`);
  const series = raw.values[index]!;
  // Operating-point plots often have a single saved dependent and no separate
  // sweep axis; mirror sample indices onto a dummy axis so callers can still
  // compare scalars via the first sample.
  if (raw.variables.length === 1) {
    return { axis: series.map((_, i) => i), values: series };
  }
  return { axis: raw.values[0]!, values: series };
}

function ltTraceOrScalar(bytes: Uint8Array, expression: string): NumericTrace {
  const ltRaw = parseRaw(bytes);
  const lt = rawTrace(ltRaw, expression);
  if (!lt) throw new Error(`LTspice raw output is missing ${expression}`);
  if (ltRaw.variables.length === 1) {
    return { axis: lt.values.map((_, i) => i), values: lt.values };
  }
  return { axis: lt.axis, values: lt.values };
}

function assertRun(label: string, status: number | null, output: string): void {
  if (status !== 0 || /fatal error|simulation\(s\) aborted/i.test(output)) {
    throw new Error(`${label} failed (${status ?? "timeout"}):\n${output.slice(-2500)}`);
  }
}

export function measurementValue(output: string, name: string): number {
  const match = new RegExp(`^${name}\\s*[:=]\\s*(?:[^=\\r\\n]*=)?\\s*([^\\s\\r\\n]+)`, "im").exec(output);
  const value = Number(match?.[1]);
  if (!Number.isFinite(value)) throw new Error(`measurement ${name} is missing from simulator output`);
  return value;
}

/** Parse `name = value` scalars from an ngspice `.tf` stdout block. */
export function parseNgspiceTransferScalars(output: string): Map<string, number> {
  const block = output.split(/transfer function information:/i)[1];
  if (!block) throw new Error("ngspice printed no transfer function information");
  const scalars = new Map<string, number>();
  for (const line of block.split(/\r?\n/)) {
    const match = /^\s*(\S+)\s*=\s*([-0-9.eE+]+)\s*$/.exec(line);
    if (match) scalars.set(match[1]!.toLowerCase(), Number(match[2]));
  }
  if (scalars.size === 0) throw new Error("ngspice transfer block contained no scalars");
  return scalars;
}

/** Run the same Tau-derived electrical deck through both installed simulators.
 * LTspice-only/ngspice-only output controls are added to otherwise identical
 * decks, and all generated artifacts live in a disposable temp directory. */
export function runPairedBatch(
  name: string,
  netlist: string,
  saves: readonly string[],
  measurementsOrOptions: readonly string[] | PairedBatchOptions = [],
  ngspiceNetlistArg: string = netlist,
): PairedBatchResult {
  const options: PairedBatchOptions = Array.isArray(measurementsOrOptions)
    ? { measurements: measurementsOrOptions, ngspiceNetlist: ngspiceNetlistArg }
    : { ngspiceNetlist: ngspiceNetlistArg, ...measurementsOrOptions };
  const ngspiceNetlist = options.ngspiceNetlist ?? netlist;
  const measurementLines = options.measurements ?? [];
  if (!existsSync(LTSPICE_BINARY)) throw new Error(`LTspice is missing at ${LTSPICE_BINARY}`);
  const dir = mkdtempSync(join(tmpdir(), `tau-parity-${name}-`));
  try {
    const ltPath = join(dir, `${name}-lt.cir`);
    const ngPath = join(dir, `${name}-ng.cir`);
    // LTspice does not retain resistor/device currents referenced only by a
    // `.meas` expression; name those currents on its save card. ngspice can
    // evaluate them directly for the measurement run and may not expose a
    // corresponding raw vector (notably I(R1)), so they are LT-only outputs.
    const measuredCurrents = measurementLines.flatMap((line) => (
      [...line.matchAll(/\bi\s*\(\s*([^)]+)\s*\)/gi)].map((match) => `i(${match[1]!.trim()})`)
    ));
    const ltSaves = [...new Set([...saves, ...measuredCurrents])];
    const ngSaves = saves.map((expression) => options.ngspiceAliases?.[expression] ?? expression);
    writeFileSync(ltPath, prepareDeck(netlist, ltSaves, measurementLines, true, options.skipSave));
    // Tau evaluates authored measurements from returned traces (simulation/
    // measure.ts); do not ask ngspice's more limited `.meas` dialect to do so.
    writeFileSync(ngPath, prepareDeck(ngspiceNetlist, ngSaves, [], false, options.skipSave));

    const ltRun = spawnSync(LTSPICE_BINARY, ["-b", ltPath], { encoding: "utf8", timeout: 120_000 });
    const ltLogPath = join(dir, `${name}-lt.log`);
    const ltspiceLog = existsSync(ltLogPath)
      ? decodeLtspiceLog(readFileSync(ltLogPath))
      : `${ltRun.stdout ?? ""}\n${ltRun.stderr ?? ""}`;
    assertRun("LTspice", ltRun.status, ltspiceLog);

    const ngRawPath = join(dir, `${name}-ng.raw`);
    const ngRun = spawnSync("ngspice", ["-b", "-r", ngRawPath, ngPath], { encoding: "utf8", timeout: 120_000 });
    const ngspiceLog = `${ngRun.stdout ?? ""}\n${ngRun.stderr ?? ""}`;
    assertRun("ngspice", ngRun.status, ngspiceLog);

    const ltRawPath = join(dir, `${name}-lt.raw`);
    if (!existsSync(ltRawPath) || !existsSync(ngRawPath)) throw new Error("simulator did not produce a raw waveform");
    const ltBytes = readFileSync(ltRawPath);
    const ngRaw = parseNgspiceRaw(readFileSync(ngRawPath));
    const ltspice = new Map<string, NumericTrace>();
    const ngspice = new Map<string, NumericTrace>();
    const keys = [...new Set([...saves, ...(options.extract ?? [])])];
    for (const expression of keys) {
      ltspice.set(expression, ltTraceOrScalar(ltBytes, expression));
      const ngName = options.ngspiceAliases?.[expression] ?? expression;
      ngspice.set(expression, ngTrace(ngRaw, ngName));
    }
    return { ltspice, ngspice, ltspiceLog, ngspiceLog };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Compare an LTspice `.tf` raw (Transfer_function / impedances) against
 * ngspice's "Transfer function information" log block on the same deck.
 */
export function runPairedTransferFunction(
  name: string,
  netlist: string,
  ngspiceNetlist: string = netlist,
): PairedScalarResult {
  if (!existsSync(LTSPICE_BINARY)) throw new Error(`LTspice is missing at ${LTSPICE_BINARY}`);
  const dir = mkdtempSync(join(tmpdir(), `tau-parity-tf-${name}-`));
  try {
    const ltPath = join(dir, `${name}-lt.cir`);
    const ngPath = join(dir, `${name}-ng.cir`);
    writeFileSync(ltPath, prepareDeck(netlist, [], [], true, true));
    writeFileSync(ngPath, prepareDeck(ngspiceNetlist, [], [], false, true));

    const ltRun = spawnSync(LTSPICE_BINARY, ["-b", ltPath], { encoding: "utf8", timeout: 60_000 });
    const ltLogPath = join(dir, `${name}-lt.log`);
    const ltspiceLog = existsSync(ltLogPath)
      ? decodeLtspiceLog(readFileSync(ltLogPath))
      : `${ltRun.stdout ?? ""}\n${ltRun.stderr ?? ""}`;
    assertRun("LTspice", ltRun.status, ltspiceLog);

    const ngRun = spawnSync("ngspice", ["-b", ngPath], { encoding: "utf8", timeout: 60_000 });
    const ngspiceLog = `${ngRun.stdout ?? ""}\n${ngRun.stderr ?? ""}`;
    assertRun("ngspice", ngRun.status, ngspiceLog);

    const ltRawPath = join(dir, `${name}-lt.raw`);
    if (!existsSync(ltRawPath)) throw new Error("LTspice did not produce a transfer-function raw");
    const ltRaw = parseRaw(readFileSync(ltRawPath));
    const ltspice = new Map<string, number>();
    for (const variable of ltRaw.variables) {
      const series = ltRaw.values[variable.index];
      if (!series || series.length < 1) continue;
      ltspice.set(variable.name.toLowerCase(), series[0]!);
    }
    const ngspice = parseNgspiceTransferScalars(ngspiceLog);
    return { ltspice, ngspice, ltspiceLog, ngspiceLog };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
