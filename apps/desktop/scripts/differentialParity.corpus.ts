/**
 * Broad differential parity — widened matrix (still not DoD-complete).
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
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatDifferentialParityReport,
  type DifferentialCell,
} from "../src/io/differentialParityReport";
import { decodeSchematicText, importAsc } from "../src/io/ascImport";
import { analysesFromDirectives } from "../src/io/directiveAnalysis";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";
import { buildParamScope } from "../src/simulation/paramScope";
import { runMeasurements } from "../src/simulation/measure";
import { compareWaveforms } from "../src/simulation/waveformCompare";
import {
  LTSPICE_BINARY,
  measurementValue,
  runPairedBatch,
  runPairedTransferFunction,
  type NumericTrace,
} from "./parityHarness";

const haveLtspice = existsSync(LTSPICE_BINARY);
const haveNgspice = spawnSync("ngspice", ["--version"], { encoding: "utf8" }).error === undefined;

const EDU = join(homedir(), "Documents", "LTspice", "examples", "Educational");
const CURVETRACE_ASC = join(EDU, "curvetrace.asc");
const NOISEFIGURE_ASC = join(EDU, "NoiseFigure.asc");

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

/**
 * Index-aligned series compare for nested/stepped DC where the sweep axis is
 * non-monotonic (outer×inner concatenation). `compareWaveforms` interpolates
 * by axis value and is wrong for that layout; point values still match.
 */
function compareAlignedSeries(
  test: NumericTrace,
  ref: NumericTrace,
  options: { rmsTolerance: number; maxTolerance: number },
): { pass: boolean; normalizedRms: number; normalizedMax: number; samples: number } {
  expect(test.values.length).toBe(ref.values.length);
  expect(test.axis.length).toBe(ref.axis.length);
  let sumSq = 0;
  let maxAbs = 0;
  let refMin = Infinity;
  let refMax = -Infinity;
  for (let i = 0; i < ref.values.length; i += 1) {
    const err = Math.abs(test.values[i]! - ref.values[i]!);
    sumSq += err * err;
    if (err > maxAbs) maxAbs = err;
    const rv = ref.values[i]!;
    if (rv < refMin) refMin = rv;
    if (rv > refMax) refMax = rv;
  }
  const samples = ref.values.length;
  const referenceRange = Math.max(refMax - refMin, 1e-30);
  const rmsError = Math.sqrt(sumSq / samples);
  const normalizedRms = rmsError / referenceRange;
  const normalizedMax = maxAbs / referenceRange;
  return {
    samples,
    normalizedRms,
    normalizedMax,
    pass: normalizedRms <= options.rmsTolerance && normalizedMax <= options.maxTolerance,
  };
}

describe.skipIf(!haveLtspice || !haveNgspice)("authored-analysis differential parity matrix", () => {
  const cells: DifferentialCell[] = [];

  it("matches RC .tran/.ac/.meas, divider analyses, .step param, curvetrace, NoiseFigure", () => {
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

    // --- RC authored .meas (Tau measure.ts path vs LTspice log) ---
    {
      const measurements = [
        ".meas tran vavg AVG V(out) FROM=1m TO=5m",
        ".meas tran vmax MAX V(out) FROM=0 TO=5m",
      ];
      const result = runPairedBatch("diff-rc-meas", RC_TRAN, ["v(out)"], { measurements });
      const ltAvg = measurementValue(result.ltspiceLog, "vavg");
      const ltMax = measurementValue(result.ltspiceLog, "vmax");
      const out = result.ngspice.get("v(out)")!;
      const tau = runMeasurements(measurements, {
        times: out.axis,
        traces: [{ id: "out", label: "V(out)", values: out.values }],
      });
      const byName = (name: string) =>
        tau.find((row) => row.name.toLowerCase() === name)?.value;
      const ngAvg = byName("vavg");
      const ngMax = byName("vmax");
      expect(ngAvg, JSON.stringify(tau)).toEqual(expect.any(Number));
      expect(ngMax, JSON.stringify(tau)).toEqual(expect.any(Number));
      expect(relativeError(ngAvg!, ltAvg)).toBeLessThanOrEqual(0.01);
      expect(relativeError(ngMax!, ltMax)).toBeLessThanOrEqual(0.01);
      cells.push({
        analysis: "meas",
        circuit: "rc",
        topology: "RC low-pass AVG/MAX .meas",
        status: "pass",
        note: `vavg/vmax relErr<=1% (ltAvg=${ltAvg.toFixed(4)})`,
      });
    }

    // --- .step param family: expand both engines (stock ngspice has no .step card) ---
    {
      const loads = [1e3, 2e3, 3e3] as const;
      const memberNotes: string[] = [];
      for (const rload of loads) {
        const deck = [
          "Tau differential RC step param",
          "V1 in 0 PULSE(0 1 0 1n 1n 10m 20m)",
          `R1 in out ${rload}`,
          "C1 out 0 1u",
          ".tran 10u 2m",
        ].join("\n");
        const result = runPairedBatch(`diff-rc-step-${rload}`, deck, ["v(out)"]);
        const lt = result.ltspice.get("v(out)")!;
        const ng = result.ngspice.get("v(out)")!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.01,
          maxTolerance: 0.03,
        });
        expect(comparison.pass, `Rload=${rload} ${JSON.stringify(comparison)}`).toBe(true);
        memberNotes.push(`R=${rload} nRms=${comparison.normalizedRms.toFixed(4)}`);
      }
      cells.push({
        analysis: "step",
        circuit: "rc",
        topology: ".step param Rload list 1k 2k 3k on RC .tran (expanded)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Educational curvetrace.asc nested DC (index-aligned; axis non-monotonic) ---
    {
      expect(existsSync(CURVETRACE_ASC), `missing ${CURVETRACE_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(CURVETRACE_ASC)));
      expect(imported.warnings).toEqual([]);
      const parsed = analysesFromDirectives(imported.directives);
      expect(parsed.dc?.source2, "curvetrace must be nested .dc").toBeTruthy();
      const params = buildParamScope(imported.directives);
      // Authored step is 10m (7505 pts). LTspice and ngspice disagree by a few
      // nested-DC endpoints on that fine grid; coarsen to 0.5 V so both engines
      // share an identical point count while keeping the ASC topology/models.
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: imported.directives,
        params,
      }, {
        kind: "dc",
        source: parsed.dc!.source,
        start: parsed.dc!.start,
        stop: parsed.dc!.stop,
        step: 0.5,
        source2: parsed.dc!.source2,
        start2: 20e-6,
        stop2: 100e-6,
        step2: 20e-6,
      });
      expect(deck.unresolvedSubckts).toEqual([]);
      expect(deck.netlist).toContain("2N2222");
      expect(deck.netlist).toMatch(/\.dc\s+V1\b/i);
      const result = runPairedBatch("diff-curvetrace", deck.netlist, ["i(v1)"]);
      const lt = result.ltspice.get("i(v1)")!;
      const ng = result.ngspice.get("i(v1)")!;
      const comparison = compareAlignedSeries(ng, lt, {
        rmsTolerance: 0.01,
        maxTolerance: 0.03,
      });
      expect(comparison.pass, JSON.stringify(comparison)).toBe(true);
      cells.push({
        analysis: "dc",
        circuit: "curvetrace",
        topology: "Educational curvetrace.asc nested BJT Ic(Vce,Ib)",
        status: "pass",
        note: `I(V1) aligned nRms=${comparison.normalizedRms.toFixed(4)} samples=${comparison.samples} (Vstep=0.5 for point-count parity)`,
      });
    }

    // --- Educational NoiseFigure.asc (Tau deck expands V1 Rser=1K) ---
    {
      expect(existsSync(NOISEFIGURE_ASC), `missing ${NOISEFIGURE_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(NOISEFIGURE_ASC)));
      expect(imported.warnings).toEqual([]);
      const parsed = analysesFromDirectives(imported.directives);
      expect(parsed.noise, "NoiseFigure.asc must author .noise").toBeTruthy();
      const params = buildParamScope(imported.directives);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: imported.directives,
        params,
      }, {
        kind: "noise",
        output: { node: parsed.noise!.output.pos, refNode: parsed.noise!.output.neg },
        source: parsed.noise!.source,
        startHz: parsed.noise!.sweep.startHz,
        stopHz: parsed.noise!.sweep.stopHz,
        pointsPerDecade: parsed.noise!.sweep.pointsPerDecade,
      });
      expect(deck.unresolvedSubckts).toEqual([]);
      expect(deck.netlist).toMatch(/RTAU_V1_RSER/i);
      expect(deck.netlist).toContain("2N2222");
      const result = runPairedBatch("diff-noisefigure", deck.netlist, [], {
        skipSave: true,
        extract: ["V(onoise)", "V(inoise)"],
        ngspiceAliases: {
          "V(onoise)": "onoise_spectrum",
          "V(inoise)": "inoise_spectrum",
        },
      });
      const ltO = result.ltspice.get("V(onoise)")!;
      const ngO = result.ngspice.get("V(onoise)")!;
      const cmpO = compareWaveforms(ngO.axis, ngO.values, ltO.axis, ltO.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(cmpO.pass, JSON.stringify(cmpO)).toBe(true);
      const ltI = result.ltspice.get("V(inoise)")!;
      const ngI = result.ngspice.get("V(inoise)")!;
      const cmpI = compareWaveforms(ngI.axis, ngI.values, ltI.axis, ltI.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(cmpI.pass, JSON.stringify(cmpI)).toBe(true);
      // Spot-check NF expression from the ASC comment at mid-band.
      const k = 1.380649e-23;
      const t = 300.15;
      const rSource = 1e3;
      const mid = Math.floor(ltI.axis.length / 2);
      const nfLt = 10 * Math.log10((ltI.values[mid]! ** 2) / (4 * k * t * rSource));
      const nfNg = 10 * Math.log10((ngI.values[mid]! ** 2) / (4 * k * t * rSource));
      expect(Math.abs(nfNg - nfLt)).toBeLessThanOrEqual(0.05);
      cells.push({
        analysis: "noise",
        circuit: "bjt-stage",
        topology: "Educational NoiseFigure.asc CE amp + V1 Rser=1k",
        status: "pass",
        note: `onoise/inoise nRms=${cmpO.normalizedRms.toFixed(4)}/${cmpI.normalizedRms.toFixed(4)}; NF≈${nfNg.toFixed(2)}dB`,
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

    // Explicit remaining gaps — keep the DoD box honest.
    cells.push(
      {
        analysis: "step",
        circuit: "any",
        topology: "nested / .step temp / .step source families",
        status: "gap",
        note: "param list on RC proven; nested×temp×source differential families still open",
      },
      {
        analysis: "ac",
        circuit: "colpitts",
        topology: "oscillator AC",
        status: "gap",
        note: "Colpitts fixture is .tran-authored; no AC differential cell",
      },
      {
        analysis: "op",
        circuit: "class-d",
        topology: "Class-D non-tran (OP/AC/DC/noise/tf)",
        status: "gap",
        note: "authored analyses are .tran/.meas only; OP refused (behavioral L @device[param])",
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
    expect(passCount).toBeGreaterThanOrEqual(10);
    expect(gapCount).toBeGreaterThanOrEqual(1);
  }, 180_000);
});
