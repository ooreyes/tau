import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeSchematicText, importAsc, makeSubcircuitResolver } from "../src/io/ascImport";
import { parseTranDirective } from "../src/io/directiveAnalysis";
import { buildSpiceDeck, type SpiceDeck } from "../src/engine/spiceNetlist";
import { buildParamScope } from "../src/simulation/paramScope";
import { compareWaveforms } from "../src/simulation/waveformCompare";
import { runPairedBatch, type NumericTrace } from "./parityHarness";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CLASSD_DIR = join(REPO_ROOT, "examples", "class-d-amplifier");
const COLPITTS_PATH = process.env.COLPITTS_ASC
  ?? join(homedir(), "Documents", "LTspice", "examples", "Educational", "colpits.asc");

function importedDeck(path: string, stopFallback: number, stepsFallback: number): SpiceDeck {
  const parent = dirname(path);
  const sibling = makeSubcircuitResolver((symbolType) => {
    const read = (extension: ".asy" | ".asc") => {
      const candidate = join(parent, `${symbolType}${extension}`);
      return existsSync(candidate) ? decodeSchematicText(readFileSync(candidate)) : undefined;
    };
    const asy = read(".asy");
    const asc = read(".asc");
    return asy || asc ? { asy, asc } : null;
  });
  const imported = importAsc(decodeSchematicText(readFileSync(path)), { resolveSubcircuit: sibling });
  const tran = imported.directives.map(parseTranDirective).find((value) => value !== null);
  return buildSpiceDeck({
    components: imported.components,
    wires: imported.wires,
    netLabels: imported.netLabels,
    directives: imported.directives,
    params: buildParamScope(imported.directives),
  }, { kind: "tran", stopTime: tran?.stopTime ?? stopFallback, steps: tran?.steps ?? stepsFallback, ...(tran?.uic ? { uic: true } : {}), ...(tran?.startup ? { startup: true } : {}) });
}

function tail(trace: NumericTrace, start: number): NumericTrace {
  const first = trace.axis.findIndex((time) => time >= start);
  const index = first < 0 ? 0 : first;
  return { axis: trace.axis.slice(index), values: trace.values.slice(index) };
}

function range(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

function rms(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function risingFrequency(trace: NumericTrace): number {
  const mean = trace.values.reduce((sum, value) => sum + value, 0) / trace.values.length;
  const crossings: number[] = [];
  for (let index = 1; index < trace.values.length; index += 1) {
    if (trace.values[index - 1]! < mean && trace.values[index]! >= mean) {
      const span = trace.values[index]! - trace.values[index - 1]!;
      const fraction = span === 0 ? 0 : (mean - trace.values[index - 1]!) / span;
      crossings.push(trace.axis[index - 1]! + fraction * (trace.axis[index]! - trace.axis[index - 1]!));
    }
  }
  if (crossings.length < 3) throw new Error("oscillator waveform has too few rising crossings");
  const periods = crossings.slice(1).map((time, index) => time - crossings[index]!);
  return 1 / (periods.reduce((sum, period) => sum + period, 0) / periods.length);
}

describe("LTspice/Tau waveform parity", () => {
  it("matches an RC transient point-for-point within numeric solver tolerance", () => {
    const deck = [
      "Tau RC waveform parity",
      "V1 in 0 PULSE(0 1 0 1n 1n 10m 20m)",
      "R1 in out 1k",
      "C1 out 0 1u",
      ".tran 10u 5m",
      ".end",
    ].join("\n");
    const result = runPairedBatch("rc", deck, ["v(out)"]);
    const lt = tail(result.ltspice.get("v(out)")!, 20e-6);
    const tau = tail(result.ngspice.get("v(out)")!, 20e-6);
    const comparison = compareWaveforms(tau.axis, tau.values, lt.axis, lt.values, { rmsTolerance: 0.005, maxTolerance: 0.02 });
    expect(comparison.pass, JSON.stringify(comparison)).toBe(true);
  });

  it("matches the unmodified Colpitts oscillator's amplitude, RMS, and frequency", () => {
    expect(existsSync(COLPITTS_PATH), `missing Colpitts fixture: ${COLPITTS_PATH}`).toBe(true);
    const deck = importedDeck(COLPITTS_PATH, 500e-6, 3000);
    const q1 = deck.circuit.components.find(({ component }) => component.label.toLowerCase() === "q1");
    const drain = q1?.pins.d;
    expect(drain, "Colpitts Q1 drain net is missing").toBeTruthy();
    const expression = `v(${drain})`;
    const result = runPairedBatch("colpitts", deck.netlist, [expression]);
    const lt = tail(result.ltspice.get(expression)!, 250e-6);
    const tau = tail(result.ngspice.get(expression)!, 250e-6);
    expect(Math.abs(range(tau.values) / range(lt.values) - 1)).toBeLessThanOrEqual(0.15);
    expect(Math.abs(rms(tau.values) / rms(lt.values) - 1)).toBeLessThanOrEqual(0.15);
    expect(Math.abs(risingFrequency(tau) / risingFrequency(lt) - 1)).toBeLessThanOrEqual(0.1);
  });

  it("matches the unmodified Class-D filtered output trace within tolerance", () => {
    const deck = importedDeck(join(CLASSD_DIR, "class-d-starter.asc"), 3e-3, 3000);
    const result = runPairedBatch("classd-waveform", deck.netlist, ["v(vo)"]);
    const lt = tail(result.ltspice.get("v(vo)")!, 100e-6);
    const tau = tail(result.ngspice.get("v(vo)")!, 100e-6);
    const comparison = compareWaveforms(tau.axis, tau.values, lt.axis, lt.values, { rmsTolerance: 0.03, maxTolerance: 0.12 });
    expect(comparison.pass, JSON.stringify(comparison)).toBe(true);
  });
});
