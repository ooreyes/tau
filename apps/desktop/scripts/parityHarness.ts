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
): string {
  const lines = source
    .split(/\r?\n/)
    .filter((line) => !/^\.save\b/i.test(line.trim()) && !/^\.end\b/i.test(line.trim()))
    .map((line) => compatibleOptions(line, ltspice));
  if (ltspice) lines.push(".options plotwinsize=0");
  lines.push(`.save ${saves.join(" ")}`);
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
}

/** ngspice's binary raw writer stores every real value as float64, unlike
 * LTspice's mixed float64-axis/float32-dependent layout. */
function parseNgspiceRaw(bytes: Uint8Array): NgRaw {
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
  const variableLines = header.split(/\r?\n/).filter((line) => /^\s*\d+\s+\S+/.test(line));
  const variables = variableLines.map((line) => line.trim().split(/\s+/)[1]!);
  if (variables.length !== variableCount || pointCount < 1) {
    throw new Error(`invalid ngspice raw header (${variables.length}/${variableCount} variables, ${pointCount} points)`);
  }
  const expectedBytes = pointCount * variableCount * 8;
  if (bytes.length - dataStart < expectedBytes) {
    throw new Error("truncated ngspice raw output");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset + dataStart, expectedBytes);
  const values = Array.from({ length: variableCount }, () => new Array<number>(pointCount));
  let offset = 0;
  for (let point = 0; point < pointCount; point += 1) {
    for (let variable = 0; variable < variableCount; variable += 1) {
      values[variable]![point] = view.getFloat64(offset, true);
      offset += 8;
    }
  }
  return { variables, values };
}

function ngTrace(raw: NgRaw, expression: string): NumericTrace {
  const index = raw.variables.findIndex((name) => name.toLowerCase() === expression.toLowerCase());
  if (index < 0) throw new Error(`ngspice raw output is missing ${expression}`);
  return { axis: raw.values[0]!, values: raw.values[index]! };
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

/** Run the same Tau-derived electrical deck through both installed simulators.
 * LTspice-only/ngspice-only output controls are added to otherwise identical
 * decks, and all generated artifacts live in a disposable temp directory. */
export function runPairedBatch(
  name: string,
  netlist: string,
  saves: readonly string[],
  measurements: readonly string[] = [],
): PairedBatchResult {
  if (!existsSync(LTSPICE_BINARY)) throw new Error(`LTspice is missing at ${LTSPICE_BINARY}`);
  const dir = mkdtempSync(join(tmpdir(), `tau-parity-${name}-`));
  try {
    const ltPath = join(dir, `${name}-lt.cir`);
    const ngPath = join(dir, `${name}-ng.cir`);
    // LTspice does not retain resistor/device currents referenced only by a
    // `.meas` expression; name those currents on its save card. ngspice can
    // evaluate them directly for the measurement run and may not expose a
    // corresponding raw vector (notably I(R1)), so they are LT-only outputs.
    const measuredCurrents = measurements.flatMap((line) => (
      [...line.matchAll(/\bi\s*\(\s*([^)]+)\s*\)/gi)].map((match) => `i(${match[1]!.trim()})`)
    ));
    const ltSaves = [...new Set([...saves, ...measuredCurrents])];
    writeFileSync(ltPath, prepareDeck(netlist, ltSaves, measurements, true));
    // Tau evaluates authored measurements from returned traces (simulation/
    // measure.ts); do not ask ngspice's more limited `.meas` dialect to do so.
    writeFileSync(ngPath, prepareDeck(netlist, saves, [], false));

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
    const ltRaw = parseRaw(readFileSync(ltRawPath));
    const ngRaw = parseNgspiceRaw(readFileSync(ngRawPath));
    const ltspice = new Map<string, NumericTrace>();
    const ngspice = new Map<string, NumericTrace>();
    for (const expression of saves) {
      const lt = rawTrace(ltRaw, expression);
      if (!lt) throw new Error(`LTspice raw output is missing ${expression}`);
      ltspice.set(expression, { axis: lt.axis, values: lt.values });
      ngspice.set(expression, ngTrace(ngRaw, expression));
    }
    return { ltspice, ngspice, ltspiceLog, ngspiceLog };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
