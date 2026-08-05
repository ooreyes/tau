/**
 * Broad differential parity — smallest honest vertical slice.
 *
 * Runs the same Tau-derived decks through installed LTspice and ngspice and
 * compares numeric outputs for a representative analysis × topology matrix.
 * Script stdout (`formatDifferentialParityReport`) is the coverage source of
 * truth: `pass` cells are asserted here; `sibling` cites existing dod-parity
 * corpus proofs; `gap` cells are explicit and must never be treated as green.
 *
 * This does NOT close the AGENTS.md DoD box — the full authored-analysis ×
 * device/topology matrix is still open. It advances the box with a re-runnable
 * harness and proven cells beyond the prior TRAN-only waveform proofs.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatDifferentialParityReport,
  type DifferentialCell,
} from "../src/io/differentialParityReport";
import { compareWaveforms } from "../src/simulation/waveformCompare";
import {
  LTSPICE_BINARY,
  runPairedBatch,
  runPairedTransferFunction,
  type NumericTrace,
} from "./parityHarness";

const haveLtspice = existsSync(LTSPICE_BINARY);
const haveNgspice = spawnSync("ngspice", ["--version"], { encoding: "utf8" }).error === undefined;

const RC_TRAN = [
  "Tau differential RC tran",
  "V1 in 0 PULSE(0 1 0 1n 1n 10m 20m)",
  "R1 in out 1k",
  "C1 out 0 1u",
  ".tran 10u 5m",
].join("\n");

const RC_AC = [
  "Tau differential RC ac",
  "V1 in 0 AC 1",
  "R1 in out 1k",
  "C1 out 0 1u",
  ".ac dec 10 10 100k",
].join("\n");

const DIVIDER_DC = [
  "Tau differential divider dc",
  "V1 in 0 0",
  "R1 in out 1k",
  "R2 out 0 1k",
  ".dc V1 0 5 0.5",
].join("\n");

const DIVIDER_OP = [
  "Tau differential divider op",
  "V1 in 0 5",
  "R1 in out 1k",
  "R2 out 0 1k",
  ".op",
].join("\n");

const DIVIDER_TF = [
  "Tau differential divider tf",
  "V1 in 0 5",
  "R1 in out 1k",
  "R2 out 0 1k",
  ".tf V(out) V1",
].join("\n");

const DIVIDER_NOISE = [
  "Tau differential divider noise",
  "V1 in 0 DC 0 AC 1",
  "R1 in out 1k",
  "R2 out 0 1k",
  ".noise V(out) V1 dec 10 1 1k",
].join("\n");

function relativeError(tau: number, ltspice: number): number {
  const scale = Math.abs(ltspice) > 1e-30 ? Math.abs(ltspice) : 1;
  return Math.abs(tau - ltspice) / scale;
}

function firstSample(trace: NumericTrace): number {
  const value = trace.values[0];
  if (!Number.isFinite(value)) throw new Error("trace has no finite samples");
  return value!;
}

function pickScalar(map: Map<string, number>, candidates: readonly string[]): number {
  for (const name of candidates) {
    const hit = [...map.entries()].find(([key]) => key.toLowerCase() === name.toLowerCase());
    if (hit) return hit[1];
  }
  throw new Error(`missing scalar among ${candidates.join("|")}; have ${[...map.keys()].join(",")}`);
}

describe.skipIf(!haveLtspice || !haveNgspice)("authored-analysis differential parity matrix", () => {
  const cells: DifferentialCell[] = [];

  it("matches RC .tran, .ac and divider .dc/.op/.tf/.noise against LTspice", () => {
    // --- TRAN (also covered by waveformParity; re-assert here so this file is self-sufficient) ---
    {
      const result = runPairedBatch("diff-rc-tran", RC_TRAN, ["v(out)"]);
      const lt = result.ltspice.get("v(out)")!;
      const ng = result.ngspice.get("v(out)")!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.005,
        maxTolerance: 0.02,
      });
      expect(comparison.pass, JSON.stringify(comparison)).toBe(true);
      cells.push({
        analysis: "tran",
        circuit: "rc",
        topology: "RC low-pass",
        status: "pass",
        note: `V(out) nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)}`,
      });
    }

    // --- AC magnitude ---
    {
      const result = runPairedBatch("diff-rc-ac", RC_AC, ["v(out)"]);
      const lt = result.ltspice.get("v(out)")!;
      const ng = result.ngspice.get("v(out)")!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.01,
        maxTolerance: 0.03,
      });
      expect(comparison.pass, JSON.stringify(comparison)).toBe(true);
      cells.push({
        analysis: "ac",
        circuit: "rc",
        topology: "RC low-pass",
        status: "pass",
        note: `|V(out)| nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)}`,
      });
    }

    // --- DC sweep ---
    {
      const result = runPairedBatch("diff-div-dc", DIVIDER_DC, ["v(out)"]);
      const lt = result.ltspice.get("v(out)")!;
      const ng = result.ngspice.get("v(out)")!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.002,
        maxTolerance: 0.01,
      });
      expect(comparison.pass, JSON.stringify(comparison)).toBe(true);
      cells.push({
        analysis: "dc",
        circuit: "divider",
        topology: "1:1 resistive divider",
        status: "pass",
        note: `V(out) nRms=${comparison.normalizedRms.toFixed(4)}`,
      });
    }

    // --- OP scalar ---
    {
      const result = runPairedBatch("diff-div-op", DIVIDER_OP, ["v(out)"]);
      const lt = firstSample(result.ltspice.get("v(out)")!);
      const ng = firstSample(result.ngspice.get("v(out)")!);
      expect(relativeError(ng, lt)).toBeLessThanOrEqual(1e-6);
      expect(ng).toBeCloseTo(2.5, 6);
      cells.push({
        analysis: "op",
        circuit: "divider",
        topology: "1:1 resistive divider",
        status: "pass",
        note: `V(out) lt=${lt} ng=${ng} relErr<=1e-6`,
      });
    }

    // --- TF scalars ---
    {
      const result = runPairedTransferFunction("diff-div-tf", DIVIDER_TF);
      const ltGain = pickScalar(result.ltspice, ["transfer_function"]);
      const ngGain = pickScalar(result.ngspice, ["transfer_function"]);
      const ltRin = pickScalar(result.ltspice, ["v1#input_impedance"]);
      const ngRin = pickScalar(result.ngspice, ["v1#input_impedance"]);
      const ltRout = pickScalar(result.ltspice, ["output_impedance_at_v(out)"]);
      const ngRout = pickScalar(result.ngspice, ["output_impedance_at_v(out)"]);
      expect(relativeError(ngGain, ltGain)).toBeLessThanOrEqual(1e-6);
      expect(relativeError(ngRin, ltRin)).toBeLessThanOrEqual(1e-6);
      expect(relativeError(ngRout, ltRout)).toBeLessThanOrEqual(1e-6);
      cells.push({
        analysis: "tf",
        circuit: "divider",
        topology: "1:1 resistive divider",
        status: "pass",
        note: `gain/Rin/Rout relErr<=1e-6 (gain≈${ngGain})`,
      });
    }

    // --- Noise density ---
    {
      const result = runPairedBatch("diff-div-noise", DIVIDER_NOISE, [], {
        skipSave: true,
        extract: ["V(onoise)"],
        ngspiceAliases: { "V(onoise)": "onoise_spectrum" },
      });
      const lt = result.ltspice.get("V(onoise)")!;
      const ng = result.ngspice.get("V(onoise)")!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(comparison.pass, JSON.stringify(comparison)).toBe(true);
      cells.push({
        analysis: "noise",
        circuit: "divider",
        topology: "1:1 resistive divider",
        status: "pass",
        note: `V(onoise) nRms=${comparison.normalizedRms.toFixed(4)}`,
      });
    }

    // Sibling proofs already committed under dod-parity.sh (not re-swept here).
    cells.push(
      {
        analysis: "tran",
        circuit: "colpitts",
        topology: "educational Colpitts MOSFET oscillator",
        status: "sibling",
        note: "waveformParity.corpus.ts amplitude/RMS/freq",
      },
      {
        analysis: "tran",
        circuit: "class-d",
        topology: "class-d_starter + deadtime",
        status: "sibling",
        note: "waveformParity.corpus.ts V(vo)",
      },
      {
        analysis: "meas",
        circuit: "class-d",
        topology: "class-d_starter Efficiency",
        status: "sibling",
        note: "classdEfficiency.corpus.ts PS/PL/Efficiency ≤2%",
      },
      {
        analysis: "tran",
        circuit: "varistor",
        topology: "controlled VARISTOR A-device",
        status: "sibling",
        note: "specialDeviceParity.corpus.ts",
      },
      {
        analysis: "tran",
        circuit: "phasedet",
        topology: "PHASEDET charge pump",
        status: "sibling",
        note: "specialDeviceParity.corpus.ts",
      },
    );

    // Explicit gaps — keep the DoD box honest.
    cells.push(
      {
        analysis: "step",
        circuit: "any",
        topology: "stepped .tran/.ac/.dc/.temp/.param families",
        status: "gap",
        note: "native .step UI path exists; no LTspice differential family matrix yet",
      },
      {
        analysis: "ac",
        circuit: "colpitts",
        topology: "oscillator AC",
        status: "gap",
        note: "Colpitts fixture is .tran-authored; no AC differential cell",
      },
      {
        analysis: "ac",
        circuit: "class-d",
        topology: "Class-D AC",
        status: "gap",
        note: "Class-D fixture is .tran/.meas; no AC/DC/OP/noise/tf differential cells",
      },
      {
        analysis: "noise",
        circuit: "bjt-stage",
        topology: "active noise figure",
        status: "gap",
        note: "Educational NoiseFigure.asc not yet in differential matrix",
      },
      {
        analysis: "dc",
        circuit: "curvetrace",
        topology: "nested MOSFET curve tracer",
        status: "gap",
        note: "Educational curvetrace.asc not yet differentially compared",
      },
      {
        analysis: "meas",
        circuit: "rc",
        topology: "authored .meas on RC",
        status: "gap",
        note: "only Class-D Efficiency .meas is differentially proven",
      },
    );

    const report = formatDifferentialParityReport({
      generatedAt: new Date().toISOString(),
      cells,
    });
    // stdout is the DoD coverage source of truth for this slice
    console.log(`\n${report}`);
    expect(report).toContain("DIFFERENTIAL PARITY");
    expect(report).toMatch(/SUMMARY pass=\d+ sibling=\d+ gap=\d+/);
    expect(report).toContain("GAPS (explicit):");
    const passCount = cells.filter((cell) => cell.status === "pass").length;
    const gapCount = cells.filter((cell) => cell.status === "gap").length;
    expect(passCount).toBeGreaterThanOrEqual(6);
    expect(gapCount).toBeGreaterThanOrEqual(1);
  });
});
