/**
 * Broad differential parity — gap-closure slice (still not DoD-complete).
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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  formatDifferentialParityReport,
  type DifferentialCell,
} from "../src/io/differentialParityReport";
import { decodeSchematicText, importAsc, makeSubcircuitResolver } from "../src/io/ascImport";
import { analysesFromDirectives } from "../src/io/directiveAnalysis";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";
import { buildParamScope, expandDirectiveLines } from "../src/simulation/paramScope";
import { runMeasurements } from "../src/simulation/measure";
import { compareWaveforms } from "../src/simulation/waveformCompare";
import {
  LTSPICE_BINARY,
  measurementValue,
  runPairedBatch,
  runPairedNativeStepOp,
  runPairedTransferFunction,
  type NumericTrace,
} from "./parityHarness";
import { standardModelLine } from "../src/engine/standardModels";

const haveLtspice = existsSync(LTSPICE_BINARY);
const haveNgspice = spawnSync("ngspice", ["--version"], { encoding: "utf8" }).error === undefined;

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CLASSD_DIR = join(REPO_ROOT, "examples", "class-d-amplifier");
/** Tau Circuit_testing_v1 — underdamped series RLC step response (≠ synthetic RC_TRAN). */
const CT_RLC_RINGING_ASC = join(REPO_ROOT, "Circuit_testing_v1", "08_tran_rlc_ringing.asc");
/** Tau Circuit_testing_v1 — series 1N4148 diode DC I–V (≠ synthetic resistive divider DC). */
const CT_DIODE_DC_ASC = join(REPO_ROOT, "Circuit_testing_v1", "04_dc_diode_curve.asc");
/** Tau Circuit_testing_v1 — stepped RLOAD divider DC (≠ synthetic divider / source-step OP). */
const CT_STEP_LOADED_ASC = join(REPO_ROOT, "Circuit_testing_v1", "05_step_loaded_divider.asc");
/** Tau Circuit_testing_v1 — RC lowpass thermal .noise (≠ synthetic resistive divider noise). */
const CT_NOISE_RC_ASC = join(REPO_ROOT, "Circuit_testing_v1", "07_noise_rc_lowpass.asc");
/** Tau Circuit_testing_v1 — RC lowpass authored .ac (≠ synthetic RC_AC / ct noise RC). */
const CT_AC_RC_ASC = join(REPO_ROOT, "Circuit_testing_v1", "03_ac_rc_lowpass.asc");
/** Tau Circuit_testing_v1 — resistive divider authored .tf (≠ synthetic DIVIDER_TF netlist). */
const CT_TF_DIVIDER_ASC = join(REPO_ROOT, "Circuit_testing_v1", "06_tf_voltage_divider.asc");
/** Tau Circuit_testing_v1 — 2:1 resistive divider authored .op (≠ synthetic DIVIDER_OP 1:1). */
const CT_OP_DIVIDER_ASC = join(REPO_ROOT, "Circuit_testing_v1", "01_op_voltage_divider.asc");
/** Tau Circuit_testing_v1 — RC pulse + authored .meas (≠ synthetic RC_TRAN / ct RLC ringing). */
const CT_TRAN_RC_PULSE_ASC = join(REPO_ROOT, "Circuit_testing_v1", "02_tran_rc_pulse_meas.asc");
/** Tau Circuit_testing_v1 — eight-pole RC ladder (≠ ct 03 single-pole RC AC). */
const CT_STRESS_RC_LADDER_ASC = join(REPO_ROOT, "Circuit_testing_v1", "11_stress_rc_ladder.asc");
/** Tau Circuit_testing_v1 — four buffered RC poles + opamp2 Avol (≠ edu opamp.sub / ct 03/11). */
const CT_ACTIVE_FOURTH_ORDER_ASC = join(REPO_ROOT, "Circuit_testing_v1", "16_active_fourth_order_filter.asc");
/** Tau Circuit_testing_v1 — 1N4007 full-wave bridge + reservoir (≠ ct diode DC / Draft1 diode–L–R). */
const CT_FULL_BRIDGE_ASC = join(REPO_ROOT, "Circuit_testing_v1", "18_full_bridge_power_supply.asc");
/** Tau Circuit_testing_v1 — balanced 3φ RLC feeder (≠ ct 18 bridge / ct 08 underdamped RLC). */
const CT_THREE_PHASE_ASC = join(REPO_ROOT, "Circuit_testing_v1", "17_three_phase_power_grid.asc");
/** Tau Circuit_testing_v1 — async buck RSR015P06 + 1N5819 (≠ ct 18 bridge / edu 100W IRFP). */
const CT_BUCK_ASC = join(REPO_ROOT, "Circuit_testing_v1", "12_buck_converter.asc");
/** Tau Circuit_testing_v1 — async boost QS6K1 + 1N5819 (≠ ct 12 buck / edu 100W IRFP). */
const CT_BOOST_ASC = join(REPO_ROOT, "Circuit_testing_v1", "13_boost_converter.asc");
const EDU = join(homedir(), "Documents", "LTspice", "examples", "Educational");
const APP = join(homedir(), "Documents", "LTspice", "examples", "Applications");
const DOC_LTSPICE = join(homedir(), "Documents", "LTspice");
const CURVETRACE_ASC = join(EDU, "curvetrace.asc");
const NOISEFIGURE_ASC = join(EDU, "NoiseFigure.asc");
const NOISE_ASC = join(EDU, "noise.asc");
const COHN_ASC = join(EDU, "Cohn.asc");
const MEASUREBW_ASC = join(EDU, "MeasureBW.asc");
const TRANSFORMER_ASC = join(EDU, "Transformer.asc");
const TRANSFORMER2_ASC = join(EDU, "Transformer2.asc");
const IDEAL_TRANSFORMER_ASC = join(EDU, "IdealTransformer.asc");
const NOTCH_ASC = join(EDU, "notch.asc");
const PASSIVE_ASC = join(EDU, "passive.asc");
const BUTTER_ASC = join(EDU, "butter.asc");
const CLAPP_ASC = join(EDU, "Clapp.asc");
const HARTLY_ASC = join(EDU, "Hartly.asc");
const OPAMP_FILTER_ASC = join(EDU, "opamp.asc");
const LINKWITZ_ASC = join(EDU, "Linkwitz.asc");
const LM741_ASC = join(EDU, "LM741.asc");
const LM308_ASC = join(EDU, "LM308.asc");
const LM78XX_ASC = join(EDU, "LM78XX.asc");
const GFT_ASC = join(EDU, "GFT.asc");
const DCOPNT_ASC = join(EDU, "DCopPnt.asc");
const AUDIOAMP_ASC = join(EDU, "audioamp.asc");
const UHFPREAMP_ASC = join(EDU, "UHFpreamp.asc");
const ASC1563_ASC = join(EDU, "1563.asc");
const SPARAM_ASC = join(EDU, "S-param.asc");
const P2_ASC = join(EDU, "P2.asc");
const STEPAC_ASC = join(EDU, "stepAC.asc");
const LOGAMP_ASC = join(EDU, "logamp.asc");
const MONTECARLO_ASC = join(EDU, "MonteCarlo.asc");
const VARACTOR_ASC = join(EDU, "varactor.asc");
const VARACTOR2_ASC = join(EDU, "varactor2.asc");
const PHASESHIFT_ASC = join(EDU, "phaseshift.asc");
const PHASESHIFT2_ASC = join(EDU, "phaseshift2.asc");
const PIERCE_ASC = join(EDU, "Pierce.asc");
const COLPITS2_ASC = join(EDU, "colpits2.asc");
const QZTST_ASC = join(EDU, "contrib", "qztst.asc");
const ELIP_GRD_ASC = join(EDU, "contrib", "elip_grd.asc");
const DRAFT1_ASC = join(DOC_LTSPICE, "Draft1.asc");
const DRAFT2_ASC = join(DOC_LTSPICE, "Draft2.asc");
const DRAFT3_ASC = join(DOC_LTSPICE, "Draft3.asc");
const DRAFT7_ASC = join(DOC_LTSPICE, "Draft7.asc");
const BANDGAPS_ASC = join(EDU, "BandGaps.asc");
const WAVEOUT_ASC = join(EDU, "waveout.asc");
const ISO16750_ASC = join(EDU, "ISO16750-2_example.asc");
/** Bundled LTspice.app demo — NMOS+PNP IGBT equivalent (not Educational/IGBT.asc NIGBT). */
const IGBT_EQ_ASC = join("/Applications/LTspice.app/Contents/Resources", "IGBTeq.asc");
/** LTspice.app help demo — distinct from Educational/butter.asc (oct 25 vs oct 50). */
const HELP_BUTTERWORTH_ASC = join(
  "/Applications/LTspice.app/Contents/Resources/LTspice.help/Contents/Resources/English.lproj",
  "Butterworth.asc",
);
/** LTspice.app help RLC `.ac list`+`.step C` — ≠ Educational/stepAC.asc (oct 5–10Meg). */
const HELP_ACSTEP_ASC = join(
  "/Applications/LTspice.app/Contents/Resources/LTspice.help/Contents/Resources/English.lproj",
  "ACstep.asc",
);
/** LTspice.app help CE-pair `.noise list`+`.step R` — ≠ Educational/stepnoise.asc (same topology, distinct path). */
const HELP_NOISESTEP_ASC = join(
  "/Applications/LTspice.app/Contents/Resources/LTspice.help/Contents/Resources/English.lproj",
  "NoiseStep.asc",
);
/** LTspice.app Resources BV demo — soft `_exp` (≠ Documents/LTspice/Draft1.asc diode–L–R). */
const RESOURCES_DRAFT1_ASC = join("/Applications/LTspice.app/Contents/Resources", "Draft1.asc");
/** LTspice.app Resources BI microcode demo — split Value/Value2 `if(` expressions. */
const RESOURCES_MICROCODE_ASC = join("/Applications/LTspice.app/Contents/Resources", "MicroCode.asc");
const EDU_100W_ASC = join(EDU, "100W.asc");
const SAMPLEANDHOLD_ASC = join(EDU, "SampleAndHold.asc");
const EDU_VARISTOR_ASC = join(EDU, "varistor.asc");
const STEPNOISE_ASC = join(EDU, "stepnoise.asc");
const UOA_ASC = join(APP, "UniversalOpAmp.asc");
const UOA1_ASC = join(APP, "UniversalOpAmp1.asc");
const UOA2_ASC = join(APP, "UniversalOpAmp2.asc");
const ORDER2_LOWPASS_ASC = join(APP, "2ndOrderLowpass.asc");
const ORDER2_BANDPASS_ASC = join(APP, "2ndOrderBandpass.asc");
const ORDER2_HIGHPASS_ASC = join(APP, "2ndOrderHighpass.asc");
const ORDER2_NOTCH_ASC = join(APP, "2ndOrderNotch.asc");
const ORDER2_ALLPASS_ASC = join(APP, "2ndOrderAllpass.asc");
const ORDER2_COMPLEXZERO_ASC = join(APP, "2ndOrderComplexzero.asc");
const STEPTEMP_ASC = join(EDU, "steptemp.asc");
const STEPMODELPARAM_ASC = join(EDU, "stepmodelparam.asc");
const COLPITTS_ASC = process.env.COLPITTS_ASC ?? join(EDU, "colpits.asc");

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

/** emitNativeStep deck: `.param` + `{Rload}` + `.step` card (P1.6 native path). */
const NATIVE_STEP_PARAM_OP = [
  "Tau differential native step param op",
  "V1 in 0 5",
  ".param Rload=1000",
  "R1 in out {Rload}",
  "R2 out 0 1k",
  ".op",
  ".step param Rload list 1k 2k 3k",
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

function siblingResolver(dir: string) {
  return makeSubcircuitResolver((symbolType) => {
    const read = (extension: ".asy" | ".asc") => {
      const candidate = join(dir, `${symbolType}${extension}`);
      return existsSync(candidate) ? decodeSchematicText(readFileSync(candidate)) : undefined;
    };
    const asy = read(".asy");
    const asc = read(".asc");
    return asy || asc ? { asy, asc } : null;
  });
}

/** Inject `AC 1` on the first V-source line when absent (LTspice requires an AC stimulus). */
function withAcStimulus(netlist: string): string {
  return netlist
    .split(/\r?\n/)
    .map((line) => {
      if (/^V\w*\b/i.test(line.trim()) && !/\bAC\b/i.test(line)) {
        return `${line.trimEnd()} AC 1`;
      }
      return line;
    })
    .join("\n");
}

describe.skipIf(!haveLtspice || !haveNgspice)("authored-analysis differential parity matrix", () => {
  const cells: DifferentialCell[] = [];

  it("matches RC .tran/.ac/.meas, divider analyses, .step families, curvetrace, stepmodelparam, NoiseFigure, noise.asc, Colpitts/Clapp/Hartly AC, Cohn AC, MeasureBW AC, Transformer/Transformer2/IdealTransformer TRAN, notch/passive/butter/opamp/Linkwitz AC, LM741/LM308/LM78XX/P2/logamp TRAN, GFT AC, DCopPnt OP, audioamp TRAN, UHFpreamp AC, 1563 AC, S-param AC, stepAC AC, 2ndOrder* AC, MonteCarlo AC, varactor AC, phaseshift AC, Pierce/colpits2 AC, edu-varistor TRAN, stepnoise noise, UniversalOpAmp/1/2 TRAN, contrib/qztst AC, SampleAndHold TRAN, contrib/elip_grd AC, Draft3 AC, Draft7 AC, Draft2 TRAN, Draft1 TRAN, BandGaps DC-temp, waveout TRAN, ISO16750 TRAN, IGBTeq nested DC, help-Butterworth AC, Resources-Draft1 DC, 100W TRAN, help-ACstep AC, help-NoiseStep noise, Resources-MicroCode TRAN, ct-rlc-ringing TRAN, ct-diode-dc DC, ct-step-loaded DC, ct-noise-rc noise, ct-stress-rc-ladder AC, ct-active-fourth-order AC, ct-full-bridge TRAN, ct-three-phase TRAN, ct-buck TRAN, ct-boost TRAN, Class-D AC/OP/DC/noise/tf", () => {
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

    // --- .step temp family: expand via .temp + tc1= (stock ngspice has no .step card) ---
    {
      const temps = [0, 27, 50] as const;
      const memberNotes: string[] = [];
      for (const temp of temps) {
        const deck = [
          "Tau differential RC step temp",
          "V1 in 0 PULSE(0 1 0 1n 1n 10m 20m)",
          "R1 in out 1k tc1=0.001",
          "C1 out 0 1u",
          `.temp ${temp}`,
          ".tran 10u 1m",
        ].join("\n");
        const result = runPairedBatch(`diff-rc-temp-${temp}`, deck, ["v(out)"]);
        const lt = result.ltspice.get("v(out)")!;
        const ng = result.ngspice.get("v(out)")!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.01,
          maxTolerance: 0.03,
        });
        expect(comparison.pass, `temp=${temp} ${JSON.stringify(comparison)}`).toBe(true);
        memberNotes.push(`T=${temp} nRms=${comparison.normalizedRms.toFixed(4)}`);
      }
      cells.push({
        analysis: "step",
        circuit: "rc",
        topology: ".step temp 0 50 27 on RC .tran with tc1 (expanded via .temp)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- BJT CE .step temp (Educational steptemp range endpoints + mid) ---
    {
      const bjtModel = standardModelLine("2N3904");
      expect(bjtModel, "bundled 2N3904 model required").toBeTruthy();
      const temps = [-55, 27, 125] as const;
      const memberNotes: string[] = [];
      for (const temp of temps) {
        const deck = [
          "Tau differential BJT CE step temp",
          "Vcc vcc 0 5",
          "Rc vcc coll 1k",
          "Q1 coll base 0 2N3904",
          "Rb vin base 100k",
          "Vin vin 0 0.8",
          bjtModel!,
          `.temp ${temp}`,
          ".op",
        ].join("\n");
        const result = runPairedBatch(`diff-bjt-temp-${temp}`, deck, ["v(coll)"]);
        const lt = firstSample(result.ltspice.get("v(coll)")!);
        const ng = firstSample(result.ngspice.get("v(coll)")!);
        expect(relativeError(ng, lt), `BJT temp=${temp} lt=${lt} ng=${ng}`).toBeLessThanOrEqual(1e-4);
        memberNotes.push(`T=${temp} V(coll)=${ng.toFixed(6)} rel=${relativeError(ng, lt).toExponential(2)}`);
      }
      cells.push({
        analysis: "step",
        circuit: "bjt",
        topology: ".step temp -55/27/125 on 2N3904 CE .op (expanded via .temp)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Educational steptemp.asc: authored .step temp → expanded .temp OP ---
    {
      expect(existsSync(STEPTEMP_ASC), `missing ${STEPTEMP_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(STEPTEMP_ASC)));
      expect(imported.foreignSymbols).toEqual([]);
      const temps = [-55, 27, 125] as const;
      const memberNotes: string[] = [];
      for (const temp of temps) {
        const directives = imported.directives
          .filter((d) => !/^\.step\b/i.test(d.trim()) && !/^\.op\b/i.test(d.trim()));
        directives.push(`.temp ${temp}`, ".op");
        const deck = buildSpiceDeck({
          components: imported.components,
          wires: imported.wires,
          netLabels: imported.netLabels,
          params: buildParamScope(directives),
          directives,
        }, { kind: "op" });
        expect(deck.unresolvedSubckts, `steptemp T=${temp}`).toEqual([]);
        expect(deck.netlist).toMatch(/2N2219A/i);
        const result = runPairedBatch(`diff-edu-steptemp-${temp}`, deck.netlist, ["v(out)"]);
        const lt = firstSample(result.ltspice.get("v(out)")!);
        const ng = firstSample(result.ngspice.get("v(out)")!);
        expect(relativeError(ng, lt), `steptemp T=${temp} lt=${lt} ng=${ng}`).toBeLessThanOrEqual(1e-3);
        memberNotes.push(`T=${temp} V(out)=${ng.toFixed(6)} rel=${relativeError(ng, lt).toExponential(2)}`);
      }
      cells.push({
        analysis: "step",
        circuit: "steptemp",
        topology: "Educational steptemp.asc .step temp −55/27/125 .op (expanded via .temp)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- .step source family: expand V1 DC values on OP ---
    {
      const volts = [1, 2, 3] as const;
      const memberNotes: string[] = [];
      for (const v of volts) {
        const deck = [
          "Tau differential step source",
          `V1 in 0 ${v}`,
          "R1 in out 1k",
          "R2 out 0 1k",
          ".op",
        ].join("\n");
        const result = runPairedBatch(`diff-src-${v}`, deck, ["v(out)"]);
        const lt = firstSample(result.ltspice.get("v(out)")!);
        const ng = firstSample(result.ngspice.get("v(out)")!);
        expect(relativeError(ng, lt)).toBeLessThanOrEqual(1e-6);
        expect(ng).toBeCloseTo(v / 2, 6);
        memberNotes.push(`V1=${v}→V(out)=${ng}`);
      }
      cells.push({
        analysis: "step",
        circuit: "divider",
        topology: ".step V1 list 1 2 3 on divider .op (expanded)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- nested .step Cartesian: R × C expanded (outer×inner product) ---
    {
      const loads = [1e3, 2e3] as const;
      const caps = [1e-6, 2e-6] as const;
      const memberNotes: string[] = [];
      for (const rload of loads) {
        for (const cap of caps) {
          const deck = [
            "Tau differential nested step",
            "V1 in 0 PULSE(0 1 0 1n 1n 10m 20m)",
            `R1 in out ${rload}`,
            `C1 out 0 ${cap}`,
            ".tran 10u 1m",
          ].join("\n");
          const result = runPairedBatch(`diff-nest-${rload}-${cap}`, deck, ["v(out)"]);
          const lt = result.ltspice.get("v(out)")!;
          const ng = result.ngspice.get("v(out)")!;
          const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
            rmsTolerance: 0.01,
            maxTolerance: 0.03,
          });
          expect(comparison.pass, `R=${rload} C=${cap} ${JSON.stringify(comparison)}`).toBe(true);
          memberNotes.push(`R=${rload}/C=${cap} nRms=${comparison.normalizedRms.toFixed(4)}`);
        }
      }
      cells.push({
        analysis: "step",
        circuit: "rc",
        topology: "nested .step param R×C Cartesian on RC .tran (expanded)",
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

    // --- Educational stepmodelparam.asc: .step NPN 2N2222(Vaf) → expanded nested DC ---
    {
      expect(existsSync(STEPMODELPARAM_ASC), `missing ${STEPMODELPARAM_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(STEPMODELPARAM_ASC)));
      expect(imported.warnings).toEqual([]);
      const parsed = analysesFromDirectives(imported.directives);
      expect(parsed.dc?.source2, "stepmodelparam must be nested .dc").toBeTruthy();
      const bjtModel = standardModelLine("2N2222");
      expect(bjtModel, "bundled 2N2222 model required").toBeTruthy();
      const modelWithVaf = (vaf: number) => bjtModel!.replace(/\bVAF=\S+/i, `VAF=${vaf}`);
      const baseDirectives = imported.directives.filter((d) => !/^\.step\b/i.test(d.trim()));
      const vafs = [100, 50, 25] as const;
      const memberNotes: string[] = [];
      for (const vaf of vafs) {
        const directives = [...baseDirectives, modelWithVaf(vaf)];
        const params = buildParamScope(directives);
        const deck = buildSpiceDeck({
          components: imported.components,
          wires: imported.wires,
          netLabels: imported.netLabels,
          directives,
          params,
        }, {
          kind: "dc",
          source: parsed.dc!.source,
          start: parsed.dc!.start,
          stop: parsed.dc!.stop,
          step: 0.5,
          source2: parsed.dc!.source2,
          start2: parsed.dc!.start2,
          stop2: parsed.dc!.stop2,
          step2: parsed.dc!.step2,
        });
        expect(deck.unresolvedSubckts, `stepmodelparam Vaf=${vaf}`).toEqual([]);
        expect(deck.netlist).toContain("2N2222");
        expect(deck.netlist).toMatch(new RegExp(`\\bVAF=${vaf}\\b`, "i"));
        const result = runPairedBatch(`diff-stepmodelparam-vaf-${vaf}`, deck.netlist, ["i(v1)"]);
        const lt = result.ltspice.get("i(v1)")!;
        const ng = result.ngspice.get("i(v1)")!;
        const comparison = compareAlignedSeries(ng, lt, {
          rmsTolerance: 0.01,
          maxTolerance: 0.03,
        });
        expect(comparison.pass, `Vaf=${vaf} ${JSON.stringify(comparison)}`).toBe(true);
        memberNotes.push(`Vaf=${vaf} nRms=${comparison.normalizedRms.toFixed(4)} samples=${comparison.samples}`);
      }
      cells.push({
        analysis: "step",
        circuit: "stepmodelparam",
        topology: "Educational stepmodelparam.asc .step NPN 2N2222(Vaf) 100/50/25 nested DC (expanded)",
        status: "pass",
        note: `${memberNotes.join("; ")} (Vstep=0.5 for point-count parity)`,
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

    // --- Educational noise.asc (multi-stage amp; V3 AC 1 stimulus) ---
    {
      expect(existsSync(NOISE_ASC), `missing ${NOISE_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(NOISE_ASC)));
      expect(imported.warnings).toEqual([]);
      const parsed = analysesFromDirectives(imported.directives);
      expect(parsed.noise, "noise.asc must author .noise").toBeTruthy();
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
      expect(deck.netlist).toContain("2N3904");
      expect(deck.netlist).toContain("2N2219A");
      const result = runPairedBatch("diff-edu-noise", deck.netlist, [], {
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
      cells.push({
        analysis: "noise",
        circuit: "noise-amp",
        topology: "Educational noise.asc multi-stage BJT amp (V3 AC stim)",
        status: "pass",
        note: `onoise/inoise nRms=${cmpO.normalizedRms.toFixed(4)}/${cmpI.normalizedRms.toFixed(4)} oct 1–20kHz`,
      });
    }

    // --- Educational Colpitts AC (fixture is .tran-authored; add AC stimulus for small-signal) ---
    {
      expect(existsSync(COLPITTS_ASC), `missing ${COLPITTS_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(COLPITTS_ASC)));
      const params = buildParamScope(imported.directives);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: imported.directives,
        params,
      }, {
        kind: "ac",
        startHz: 1e5,
        stopHz: 1e7,
        pointsPerDecade: 10,
      });
      expect(deck.unresolvedSubckts).toEqual([]);
      const q1 = deck.circuit.components.find(({ component }) => component.label.toLowerCase() === "q1");
      const drain = q1?.pins.d;
      expect(drain, "Colpitts Q1 drain net is missing").toBeTruthy();
      const expression = `v(${drain})`;
      // LTspice requires an AC stimulus; V1 is DC-only in the .tran fixture.
      const netlist = withAcStimulus(deck.netlist);
      expect(netlist).toMatch(/^V1\b.*\bAC\b/im);
      const result = runPairedBatch("diff-colpitts-ac", netlist, [expression]);
      const lt = result.ltspice.get(expression)!;
      const ng = result.ngspice.get(expression)!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(comparison.pass, JSON.stringify(comparison)).toBe(true);
      cells.push({
        analysis: "ac",
        circuit: "colpitts",
        topology: "Educational colpits.asc JFET oscillator (AC stim on V1)",
        status: "pass",
        note: `|V(drain)| nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)}`,
      });
    }

    // --- Educational Cohn.asc authored .ac (RLC filter; V1 already AC 2) ---
    {
      expect(existsSync(COHN_ASC), `missing ${COHN_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(COHN_ASC)));
      expect(imported.warnings).toEqual([]);
      const parsed = analysesFromDirectives(imported.directives);
      expect(parsed.ac, "Cohn.asc must author .ac").toBeTruthy();
      const params = buildParamScope(imported.directives);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: imported.directives,
        params,
      }, {
        kind: "ac",
        startHz: parsed.ac!.startHz,
        stopHz: parsed.ac!.stopHz,
        pointsPerDecade: parsed.ac!.pointsPerDecade,
      });
      expect(deck.unresolvedSubckts).toEqual([]);
      expect(deck.netlist).toMatch(/^V1\b.*\bAC\b/im);
      const result = runPairedBatch("diff-cohn-ac", deck.netlist, ["v(out)"]);
      const lt = result.ltspice.get("v(out)")!;
      const ng = result.ngspice.get("v(out)")!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(comparison.pass, JSON.stringify(comparison)).toBe(true);
      cells.push({
        analysis: "ac",
        circuit: "cohn",
        topology: "Educational Cohn.asc RLC filter (authored .ac oct 10Meg–22Meg)",
        status: "pass",
        note: `|V(out)| nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)}`,
      });
    }

    // --- Educational MeasureBW.asc authored .ac (BJT CE amp; V3 AC 1) ---
    {
      expect(existsSync(MEASUREBW_ASC), `missing ${MEASUREBW_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(MEASUREBW_ASC)));
      expect(imported.warnings).toEqual([]);
      const parsed = analysesFromDirectives(imported.directives);
      expect(parsed.ac, "MeasureBW.asc must author .ac").toBeTruthy();
      const params = buildParamScope(imported.directives);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: imported.directives,
        params,
      }, {
        kind: "ac",
        startHz: parsed.ac!.startHz,
        stopHz: parsed.ac!.stopHz,
        pointsPerDecade: parsed.ac!.pointsPerDecade,
      });
      expect(deck.unresolvedSubckts).toEqual([]);
      expect(deck.netlist).toMatch(/^V3\b.*\bAC\b/im);
      const result = runPairedBatch("diff-measurebw-ac", deck.netlist, ["v(out)"]);
      const lt = result.ltspice.get("v(out)")!;
      const ng = result.ngspice.get("v(out)")!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(comparison.pass, JSON.stringify(comparison)).toBe(true);
      cells.push({
        analysis: "ac",
        circuit: "measurebw",
        topology: "Educational MeasureBW.asc BJT CE amp (authored .ac oct 1–10Meg)",
        status: "pass",
        note: `|V(out)| nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)}`,
      });
    }

    // --- Educational Transformer.asc authored .tran (coupled inductors K=1) ---
    {
      expect(existsSync(TRANSFORMER_ASC), `missing ${TRANSFORMER_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(TRANSFORMER_ASC)));
      expect(imported.warnings).toEqual([]);
      const parsed = analysesFromDirectives(imported.directives);
      expect(parsed.tran, "Transformer.asc must author .tran").toBeTruthy();
      expect(imported.directives.some((d) => /^K1\b/i.test(d.trim()))).toBe(true);
      const params = buildParamScope(imported.directives);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: imported.directives,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: parsed.tran!.steps ?? 3000,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^K1\s+L1\s+L2\b/im);
      expect(deck.netlist).toMatch(/^L1\b/im);
      expect(deck.netlist).toMatch(/^L2\b/im);
      const result = runPairedBatch("diff-transformer-tran", deck.netlist, ["v(in)", "v(out)"]);
      const memberNotes: string[] = [];
      for (const trace of ["v(in)", "v(out)"] as const) {
        const lt = result.ltspice.get(trace)!;
        const ng = result.ngspice.get(trace)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `${trace} ${JSON.stringify(comparison)}`).toBe(true);
        memberNotes.push(`${trace} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)}`);
      }
      cells.push({
        analysis: "tran",
        circuit: "transformer",
        topology: "Educational Transformer.asc coupled L1/L2 K=1 (authored .tran 100µ)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Educational Transformer2.asc authored .tran (3-winding coupled L K=1) ---
    {
      expect(existsSync(TRANSFORMER2_ASC), `missing ${TRANSFORMER2_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(TRANSFORMER2_ASC)));
      expect(imported.warnings).toEqual([]);
      const parsed = analysesFromDirectives(imported.directives);
      expect(parsed.tran, "Transformer2.asc must author .tran").toBeTruthy();
      expect(imported.directives.some((d) => /^K1\b/i.test(d.trim()))).toBe(true);
      const params = buildParamScope(imported.directives);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: imported.directives,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: parsed.tran!.steps ?? 3000,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^K1\s+L1\s+L2\s+L3\b/im);
      expect(deck.netlist).toMatch(/^L1\b/im);
      expect(deck.netlist).toMatch(/^L2\b/im);
      expect(deck.netlist).toMatch(/^L3\b/im);
      const result = runPairedBatch("diff-transformer2-tran", deck.netlist, ["v(in)", "v(a)", "v(b)"]);
      const memberNotes: string[] = [];
      for (const trace of ["v(in)", "v(a)", "v(b)"] as const) {
        const lt = result.ltspice.get(trace)!;
        const ng = result.ngspice.get(trace)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `${trace} ${JSON.stringify(comparison)}`).toBe(true);
        memberNotes.push(`${trace} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)}`);
      }
      cells.push({
        analysis: "tran",
        circuit: "transformer2",
        topology: "Educational Transformer2.asc coupled L1/L2/L3 K=1 (authored .tran 100µ)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Educational IdealTransformer.asc authored .tran (G-source ideal XFMR, .param N=10) ---
    {
      expect(existsSync(IDEAL_TRANSFORMER_ASC), `missing ${IDEAL_TRANSFORMER_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(IDEAL_TRANSFORMER_ASC)));
      expect(imported.warnings).toEqual([]);
      const parsed = analysesFromDirectives(imported.directives);
      expect(parsed.tran, "IdealTransformer.asc must author .tran").toBeTruthy();
      expect(imported.directives.some((d) => /\.param\b/i.test(d) && /\bN\s*=/i.test(d))).toBe(true);
      const params = buildParamScope(imported.directives);
      expect(params.scope.N ?? params.scope.n).toBe(10);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: imported.directives,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: parsed.tran!.steps ?? 3000,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^G1\b/im);
      expect(deck.netlist).toMatch(/^G2\b/im);
      // Tau evaluates `{1/N}` at deck build (N=10 → 0.1); no live `.param` card needed.
      expect(deck.netlist).toMatch(/^G2\b.+\b0\.1\b/im);
      expect(deck.netlist).toMatch(/^G4\b.+\b0\.1\b/im);
      // Fixture has no named signal nets — probe primary (R1) and secondary (R3) tops.
      const r1 = deck.circuit.components.find(({ component }) => component.label.toLowerCase() === "r1");
      const r3 = deck.circuit.components.find(({ component }) => component.label.toLowerCase() === "r3");
      const primary = [r1?.pins.a, r1?.pins.b].find((n) => n && n !== "0");
      const secondary = [r3?.pins.a, r3?.pins.b].find((n) => n && n !== "0");
      expect(primary, "IdealTransformer R1 hot net missing").toBeTruthy();
      expect(secondary, "IdealTransformer R3 hot net missing").toBeTruthy();
      const primaryExpr = `v(${primary})`;
      const secondaryExpr = `v(${secondary})`;
      const result = runPairedBatch("diff-idealtransformer-tran", deck.netlist, [primaryExpr, secondaryExpr]);
      const memberNotes: string[] = [];
      for (const trace of [primaryExpr, secondaryExpr] as const) {
        const lt = result.ltspice.get(trace)!;
        const ng = result.ngspice.get(trace)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `${trace} ${JSON.stringify(comparison)}`).toBe(true);
        memberNotes.push(`${trace} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)}`);
      }
      cells.push({
        analysis: "tran",
        circuit: "idealtransformer",
        topology: "Educational IdealTransformer.asc G-source XFMR N=10 (authored .tran 100µ)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Educational notch / passive / butter authored .ac (RLC filter breadth) ---
    for (const fixture of [
      {
        path: NOTCH_ASC,
        circuit: "notch",
        topology: "Educational notch.asc twin-T cascade (authored .ac oct 100–10k)",
        probe: "v(x)",
        id: "diff-notch-ac",
      },
      {
        path: PASSIVE_ASC,
        circuit: "passive",
        topology: "Educational passive.asc LC ladder (authored .ac lin 13k–24k)",
        probe: "v(out)",
        id: "diff-passive-ac",
      },
      {
        path: BUTTER_ASC,
        circuit: "butter",
        topology: "Educational butter.asc Butterworth LC ladders (authored .ac oct 0.01–3)",
        probe: "v(out1)",
        id: "diff-butter-ac",
      },
    ] as const) {
      expect(existsSync(fixture.path), `missing ${fixture.path}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(fixture.path)));
      expect(imported.warnings).toEqual([]);
      const parsed = analysesFromDirectives(imported.directives);
      expect(parsed.ac, `${fixture.circuit}.asc must author .ac`).toBeTruthy();
      const params = buildParamScope(imported.directives);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: imported.directives,
        params,
      }, {
        kind: "ac",
        startHz: parsed.ac!.startHz,
        stopHz: parsed.ac!.stopHz,
        pointsPerDecade: parsed.ac!.pointsPerDecade,
      });
      expect(deck.unresolvedSubckts).toEqual([]);
      const result = runPairedBatch(fixture.id, deck.netlist, [fixture.probe]);
      const lt = result.ltspice.get(fixture.probe)!;
      const ng = result.ngspice.get(fixture.probe)!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(comparison.pass, `${fixture.circuit} ${JSON.stringify(comparison)}`).toBe(true);
      cells.push({
        analysis: "ac",
        circuit: fixture.circuit,
        topology: fixture.topology,
        status: "pass",
        note: `|${fixture.probe}| nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)}`,
      });
    }


    // --- Educational Clapp / Hartly AC (distinct JFET oscillators; .tran-authored like Colpitts) ---
    for (const osc of [
      {
        path: CLAPP_ASC,
        circuit: "clapp",
        topology: "Educational Clapp.asc JFET oscillator (AC stim on V1; .tran-authored)",
        id: "diff-clapp-ac",
        startHz: 1e6,
        stopHz: 20e6,
      },
      {
        path: HARTLY_ASC,
        circuit: "hartly",
        topology: "Educational Hartly.asc JFET Hartley + K1 L1/L2/L3 (AC stim on V1; .tran-authored)",
        id: "diff-hartly-ac",
        startHz: 1e6,
        stopHz: 20e6,
      },
    ] as const) {
      expect(existsSync(osc.path), `missing ${osc.path}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(osc.path)));
      expect(imported.warnings).toEqual([]);
      const params = buildParamScope(imported.directives);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: imported.directives,
        params,
      }, {
        kind: "ac",
        startHz: osc.startHz,
        stopHz: osc.stopHz,
        pointsPerDecade: 50,
      });
      expect(deck.unresolvedSubckts).toEqual([]);
      const netlist = withAcStimulus(deck.netlist);
      expect(netlist).toMatch(/^V1\b.*\bAC\b/im);
      const result = runPairedBatch(osc.id, netlist, ["v(out)"]);
      const lt = result.ltspice.get("v(out)")!;
      const ng = result.ngspice.get("v(out)")!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(comparison.pass, `${osc.circuit} ${JSON.stringify(comparison)}`).toBe(true);
      cells.push({
        analysis: "ac",
        circuit: osc.circuit,
        topology: osc.topology,
        status: "pass",
        note: `|V(out)| nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)}`,
      });
    }


    // --- Educational opamp.asc / Linkwitz.asc authored .ac (active filter breadth) ---
    for (const fixture of [
      {
        path: OPAMP_FILTER_ASC,
        circuit: "opamp-filter",
        topology: "Educational opamp.asc state-variable filter + opamp.sub (authored .ac oct 1–100k)",
        probe: "v(bp)",
        id: "diff-opamp-filter-ac",
      },
      {
        path: LINKWITZ_ASC,
        circuit: "linkwitz",
        topology: "Educational Linkwitz.asc crossover + speaker load (authored .ac oct 10–10k)",
        probe: "v(out)",
        id: "diff-linkwitz-ac",
      },
    ] as const) {
      expect(existsSync(fixture.path), `missing ${fixture.path}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(fixture.path)));
      expect(imported.warnings).toEqual([]);
      const parsed = analysesFromDirectives(imported.directives);
      expect(parsed.ac, `${fixture.circuit} must author .ac`).toBeTruthy();
      const params = buildParamScope(imported.directives);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: imported.directives,
        params,
      }, {
        kind: "ac",
        startHz: parsed.ac!.startHz,
        stopHz: parsed.ac!.stopHz,
        pointsPerDecade: parsed.ac!.pointsPerDecade,
      });
      expect(deck.unresolvedSubckts).toEqual([]);
      const result = runPairedBatch(fixture.id, deck.netlist, [fixture.probe]);
      const lt = result.ltspice.get(fixture.probe)!;
      const ng = result.ngspice.get(fixture.probe)!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(comparison.pass, `${fixture.circuit} ${JSON.stringify(comparison)}`).toBe(true);
      cells.push({
        analysis: "ac",
        circuit: fixture.circuit,
        topology: fixture.topology,
        status: "pass",
        note: `|${fixture.probe}| nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)}`,
      });
    }


    // --- Educational LM741.asc authored .tran (discrete BJT op-amp; exact NP/PN models) ---
    {
      expect(existsSync(LM741_ASC), `missing ${LM741_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(LM741_ASC)));
      expect(imported.warnings).toEqual([]);
      const parsed = analysesFromDirectives(imported.directives);
      expect(parsed.tran, "LM741.asc must author .tran").toBeTruthy();
      const params = buildParamScope(imported.directives);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: imported.directives,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: parsed.tran!.steps ?? 3000,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      const qLines = deck.netlist.split(/\r?\n/).filter((line) => /^Q\w*\b/i.test(line.trim()));
      expect(qLines.length).toBeGreaterThanOrEqual(18);
      for (const line of qLines) {
        expect(line, line).not.toMatch(/\bTAU_NPN\b|\bTAU_PNP\b/);
        expect(line, line).toMatch(/\b(NP|PN)\b/);
      }
      expect(deck.netlist).toMatch(/\.model\s+NP\s+NPN\b/i);
      expect(deck.netlist).toMatch(/\.model\s+PN\s+PNP\b/i);
      const result = runPairedBatch("diff-lm741-tran", deck.netlist, ["v(6)", "v(3)", "v(2)"]);
      const memberNotes: string[] = [];
      for (const trace of ["v(6)", "v(3)", "v(2)"] as const) {
        const lt = result.ltspice.get(trace)!;
        const ng = result.ngspice.get(trace)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `${trace} ${JSON.stringify(comparison)}`).toBe(true);
        memberNotes.push(`${trace} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)}`);
      }
      cells.push({
        analysis: "tran",
        circuit: "lm741",
        topology: "Educational LM741.asc discrete BJT op-amp NP/PN (authored .tran 10m)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Educational LM308.asc authored .tran (discrete BJT op-amp; LPNP→PNP + NJF; pins 6/3/2) ---
    // TransmissionLineInverter TLINE pin/topology miss; astable multivibrator phase miss;
    // LoopGain/Wien/Electrometer = LT1001 OTA wall; SoftDiode/Howland/HalfSlope/Vswitch avoided.
    {
      expect(existsSync(LM308_ASC), `missing ${LM308_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(LM308_ASC)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.tran, "LM308.asc must author .tran").toBeTruthy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: parsed.tran!.steps ?? 3000,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).not.toMatch(/\bLPNP\b/);
      expect(deck.netlist).toMatch(/\.model\s+NP\s+NPN\b/i);
      expect(deck.netlist).toMatch(/\.model\s+PN\s+PNP\b/i);
      expect(deck.netlist).toMatch(/\.model\s+SB\s+NPN\b/i);
      expect(deck.netlist).toMatch(/\.model\s+NJ\s+NJF\b/i);
      const qLines = deck.netlist.split(/\r?\n/).filter((line) => /^Q\w*\b/i.test(line.trim()));
      expect(qLines.length).toBeGreaterThanOrEqual(20);
      for (const line of qLines) {
        expect(line, line).not.toMatch(/\bTAU_NPN\b|\bTAU_PNP\b/);
        expect(line, line).toMatch(/\b(NP|PN|SB)\b/);
      }
      expect(deck.netlist).toMatch(/^J1\b.+\bNJ\b/im);
      const probes = ["v(6)", "v(3)", "v(2)"] as const;
      const result = runPairedBatch("diff-lm308-tran", deck.netlist, [...probes]);
      const memberNotes: string[] = [];
      for (const trace of probes) {
        const lt = result.ltspice.get(trace)!;
        const ng = result.ngspice.get(trace)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `${trace} ${JSON.stringify(comparison)}`).toBe(true);
        memberNotes.push(`${trace} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)}`);
      }
      cells.push({
        analysis: "tran",
        circuit: "lm308",
        topology: "Educational LM308.asc discrete BJT+JFET op-amp NP/PN/SB/NJ (authored .tran 10m startup)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }



    // --- Educational LM78XX.asc authored .tran (discrete BJT 78xx regulator; LPNP→PNP) ---
    // NE555.asc authored .tran probed first: package Output/Dischrg v(3)/v(7) nRms≈0.42/0.39
    // vs LTspice (phase/topology miss like astable) — fail-closed, not hollow-landed.
    // .step param Rx list 905 5.78K 7.87K → buildParamScope takes first member Rx=905 (~5V OUT).
    {
      expect(existsSync(LM78XX_ASC), `missing ${LM78XX_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(LM78XX_ASC)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.tran, "LM78XX.asc must author .tran").toBeTruthy();
      expect(dirs.some((d) => /\.step\s+param\s+Rx\b/i.test(d))).toBe(true);
      const params = buildParamScope(dirs);
      expect(Number(params.scope.Rx ?? params.scope.rx)).toBe(905);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: parsed.tran!.steps ?? 2000,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).not.toMatch(/\bLPNP\b/);
      expect(deck.netlist).toMatch(/\.model\s+NP\s+NPN\b/i);
      expect(deck.netlist).toMatch(/\.model\s+PN\s+PNP\b/i);
      expect(deck.netlist).toMatch(/\.model\s+6\.3V\s+D\b/i);
      expect(deck.netlist).toMatch(/\.model\s+DZ\s+D\b/i);
      const qLines = deck.netlist.split(/\r?\n/).filter((line) => /^Q\w*\b/i.test(line.trim()));
      expect(qLines.length).toBeGreaterThanOrEqual(15);
      for (const line of qLines) {
        expect(line, line).not.toMatch(/\bTAU_NPN\b|\bTAU_PNP\b/);
        expect(line, line).toMatch(/\b(NP|PN)\b/);
      }
      // Probe regulator OUT (real ~5V span), not hollow PWL rail alone.
      const probes = ["v(out)"] as const;
      const result = runPairedBatch("diff-lm78xx-tran", deck.netlist, [...probes]);
      const memberNotes: string[] = [];
      for (const trace of probes) {
        const lt = result.ltspice.get(trace)!;
        const ng = result.ngspice.get(trace)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `${trace} ${JSON.stringify(comparison)}`).toBe(true);
        const span = Math.max(...lt.values) - Math.min(...lt.values);
        expect(span, "OUT must be non-hollow").toBeGreaterThan(1);
        memberNotes.push(`${trace} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${span.toFixed(2)}`);
      }
      cells.push({
        analysis: "tran",
        circuit: "lm78xx",
        topology: "Educational LM78XX.asc discrete BJT 78xx regulator NP/PN + zeners (authored .tran 10m; .step Rx→905/5V)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }


    // --- Educational P2.asc authored .tran (parametric amp; exact schematic .model cards) ---
    // 100W.asc IRFP240/IRFP9240 now bundled in standardModels (see edu-100W cell).
    // 160.asc is digital A-devices; ISO7637 spike still misses paired TOL —
    // ISO16750-2_example TRAN landed separately (bundled profiles).
    // Dense .raw (~5e5 samples): use comparison.referenceRange (avoid Math.max(...spread) stack blow).
    {
      expect(existsSync(P2_ASC), `missing ${P2_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(P2_ASC)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.tran, "P2.asc must author .tran").toBeTruthy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: parsed.tran!.steps ?? 400,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).not.toMatch(/type\s*=\s*silicon/i);
      expect(deck.netlist).toMatch(/\.model\s+V47\s+D\b/i);
      expect(deck.netlist).toMatch(/\.model\s+1N2326\s+D\b/i);
      expect(deck.netlist).toMatch(/\.model\s+1N484\s+D\b/i);
      expect(deck.netlist).toMatch(/\.model\s+2N344\s+PNP\b/i);
      expect(deck.netlist).toMatch(/\.model\s+2N274\s+PNP\b/i);
      expect(deck.netlist).toMatch(/\.model\s+2N597\s+PNP\b/i);
      const qLines = deck.netlist.split(/\r?\n/).filter((line) => /^Q\w*\b/i.test(line.trim()));
      expect(qLines.length).toBeGreaterThanOrEqual(4);
      for (const line of qLines) {
        expect(line, line).not.toMatch(/\bTAU_PNP\b|\bTAU_NPN\b/);
        expect(line, line).toMatch(/\b(2N344|2N274|2N597)\b/);
      }
      const probes = ["v(out)"] as const;
      const result = runPairedBatch("diff-p2-tran", deck.netlist, [...probes]);
      const memberNotes: string[] = [];
      for (const trace of probes) {
        const lt = result.ltspice.get(trace)!;
        const ng = result.ngspice.get(trace)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `${trace} ${JSON.stringify(comparison)}`).toBe(true);
        expect(comparison.referenceRange, "OUT must be non-hollow").toBeGreaterThan(1);
        memberNotes.push(
          `${trace} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(2)}`,
        );
      }
      cells.push({
        analysis: "tran",
        circuit: "p2",
        topology: "Educational P2.asc parametric amp exact 2N344/2N274/2N597 + diodes (authored .tran 1.2m)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }


    // --- Educational logamp.asc authored .tran (log amp via opamp.sub; exact include) ---
    // Pierce/phaseshift/phaseshift2 oscillator phase miss vs LTspice; TwoTau LTspice
    // token fail; colpits2 LTspice fail — fail-closed. Prefer logamp plaintext opamp.sub.
    {
      expect(existsSync(LOGAMP_ASC), `missing ${LOGAMP_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(LOGAMP_ASC)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.tran, "logamp.asc must author .tran").toBeTruthy();
      expect(dirs.some((d) => /\.include\s+opamp\.sub\b/i.test(d))).toBe(true);
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: parsed.tran!.steps ?? 2000,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/\.subckt\s+opamp\b/i);
      expect(deck.netlist).toMatch(/^XU\d+\b.+\bopamp\b/im);
      const probes = ["v(out)", "v(in)"] as const;
      const result = runPairedBatch("diff-logamp-tran", deck.netlist, [...probes]);
      const memberNotes: string[] = [];
      for (const trace of probes) {
        const lt = result.ltspice.get(trace)!;
        const ng = result.ngspice.get(trace)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `${trace} ${JSON.stringify(comparison)}`).toBe(true);
        expect(comparison.referenceRange, `${trace} non-hollow`).toBeGreaterThan(1);
        memberNotes.push(
          `${trace} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(2)}`,
        );
      }
      cells.push({
        analysis: "tran",
        circuit: "logamp",
        topology: "Educational logamp.asc log amplifier + opamp.sub (authored .tran 10)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Educational GFT.asc authored .ac (General Feedback Theorem; z=@.param default) ---
    // LoopGain/LoopGain2 need LT1001: Tau OTA remap is not LTspice↔stock-ngspice
    // same-deck (LTspice rejects __tau_ota; brew ngspice lacks `ota` code model).
    // Honest refuse for LoopGain until a same-deck path exists — land GFT instead.
    {
      expect(existsSync(GFT_ASC), `missing ${GFT_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(GFT_ASC)));
      expect(imported.warnings).toEqual([]);
      const parsed = analysesFromDirectives(imported.directives);
      expect(parsed.ac, "GFT.asc must author .ac").toBeTruthy();
      const params = buildParamScope(imported.directives);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: imported.directives,
        params,
      }, {
        kind: "ac",
        startHz: parsed.ac!.startHz,
        stopHz: parsed.ac!.stopHz,
        pointsPerDecade: parsed.ac!.pointsPerDecade,
      });
      expect(deck.unresolvedSubckts).toEqual([]);
      const probes = ["v(y)", "v(o)"] as const;
      const result = runPairedBatch("diff-gft-ac", deck.netlist, [...probes]);
      const memberNotes: string[] = [];
      for (const probe of probes) {
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `${probe} ${JSON.stringify(comparison)}`).toBe(true);
        memberNotes.push(`${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)}`);
      }
      cells.push({
        analysis: "ac",
        circuit: "gft",
        topology: "Educational GFT.asc General Feedback Theorem (authored .ac dec; .param z default)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }


    // --- Educational DCopPnt.asc authored .op (BJT operating-point demo) ---
    // HalfSlope Laplace strips to unity VCCS (hollow) — not landed.
    // BandGaps .dc temp landed below (rmsTol=0.06 / maxTol=0.07 BJT tempco).
    {
      expect(existsSync(DCOPNT_ASC), `missing ${DCOPNT_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(DCOPNT_ASC)));
      expect(imported.warnings).toEqual([]);
      expect(imported.directives.some((d) => /^\.op\b/i.test(d.trim()))).toBe(true);
      const params = buildParamScope(imported.directives);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: imported.directives,
        params,
      }, { kind: "op" });
      expect(deck.unresolvedSubckts).toEqual([]);
      const result = runPairedBatch("diff-dcoppnt-op", deck.netlist, ["v(out)"]);
      const lt = result.ltspice.get("v(out)")!.values[0]!;
      const ng = result.ngspice.get("v(out)")!.values[0]!;
      expect(Number.isFinite(lt) && Number.isFinite(ng)).toBe(true);
      const scale = Math.abs(lt) > 1e-30 ? Math.abs(lt) : 1;
      const relErr = Math.abs(ng - lt) / scale;
      expect(relErr, `V(out) lt=${lt} ng=${ng}`).toBeLessThanOrEqual(1e-3);
      cells.push({
        analysis: "op",
        circuit: "dcoppnt",
        topology: "Educational DCopPnt.asc BJT bias network (authored .op)",
        status: "pass",
        note: `V(out) lt=${lt.toExponential(4)} ng=${ng.toExponential(4)} rel=${relErr.toExponential(2)}`,
      });
    }

    // --- Educational audioamp.asc authored .tran (discrete BJT power amp; exact 2N3904/2N2219A/2N3906) ---
    {
      expect(existsSync(AUDIOAMP_ASC), `missing ${AUDIOAMP_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(AUDIOAMP_ASC)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.tran, "audioamp.asc must author .tran").toBeTruthy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: parsed.tran!.steps ?? 3000,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      const qLines = deck.netlist.split(/\r?\n/).filter((line) => /^Q\w*\b/i.test(line.trim()));
      expect(qLines.length).toBeGreaterThanOrEqual(6);
      for (const line of qLines) {
        expect(line, line).not.toMatch(/\bTAU_NPN\b|\bTAU_PNP\b/);
        expect(line, line).toMatch(/\b(2N3904|2N2219A|2N3906)\b/);
      }
      const probes = ["v(a)", "v(b)", "v(in)"] as const;
      const result = runPairedBatch("diff-audioamp-tran", deck.netlist, [...probes]);
      const memberNotes: string[] = [];
      for (const probe of probes) {
        const ltProbe = result.ltspice.get(probe)!;
        const ngProbe = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ngProbe.axis, ngProbe.values, ltProbe.axis, ltProbe.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `${probe} ${JSON.stringify(comparison)}`).toBe(true);
        memberNotes.push(`${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)}`);
      }
      cells.push({
        analysis: "tran",
        circuit: "audioamp",
        topology: "Educational audioamp.asc discrete BJT amp 2N3904/2N2219A/2N3906 (authored .tran 10m)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Educational UHFpreamp.asc authored .ac (MRF901/QR99 + 1N4148 + TLINE; exact models) ---
    {
      expect(existsSync(UHFPREAMP_ASC), `missing ${UHFPREAMP_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(UHFPREAMP_ASC)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.ac, "UHFpreamp.asc must author .ac").toBeTruthy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "ac",
        startHz: parsed.ac!.startHz,
        stopHz: parsed.ac!.stopHz,
        pointsPerDecade: parsed.ac!.pointsPerDecade,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^T\w*\b/im);
      expect(deck.netlist).toMatch(/\bQR99\b/);
      expect(deck.netlist).toMatch(/\b1N4148\b/);
      const qdLines = deck.netlist.split(/\r?\n/).filter((line) => /^[QD]\w*\b/i.test(line.trim()));
      expect(qdLines.length).toBeGreaterThanOrEqual(2);
      for (const line of qdLines) {
        expect(line, line).not.toMatch(/\bTAU_NPN\b|\bTAU_DIODE\b/);
        expect(line, line).toMatch(/\b(QR99|1N4148)\b/);
      }
      const result = runPairedBatch("diff-uhfpreamp-ac", deck.netlist, ["v(out)"]);
      const ltOut = result.ltspice.get("v(out)")!;
      const ngOut = result.ngspice.get("v(out)")!;
      const comparison = compareWaveforms(ngOut.axis, ngOut.values, ltOut.axis, ltOut.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(comparison.pass, JSON.stringify(comparison)).toBe(true);
      cells.push({
        analysis: "ac",
        circuit: "uhfpreamp",
        topology: "Educational UHFpreamp.asc MRF901/QR99 + 1N4148 + TLINE (authored .ac oct 140–700 MHz)",
        status: "pass",
        note: `|V(out)| nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)}`,
      });
    }


    // --- Educational 1563.asc authored .ac (Tow-Thomas filter via TowTom2.sub) ---
    // Probe TowTom2 V1/V2 outputs (XU1 n003/n002), not hollow V(in).
    // MC1648 OUT deferred (harness stack overflow on dense .tran); Electrometer=LT1001 wall; 160 LTspice fail.
    {
      expect(existsSync(ASC1563_ASC), `missing ${ASC1563_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(ASC1563_ASC)));
      expect(imported.warnings).toEqual([]);
      const parsed = analysesFromDirectives(imported.directives);
      expect(parsed.ac, "1563.asc must author .ac").toBeTruthy();
      expect(imported.directives.some((d) => /\.include\s+TowTom2\.sub\b/i.test(d))).toBe(true);
      const params = buildParamScope(imported.directives);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: imported.directives,
        params,
      }, {
        kind: "ac",
        startHz: parsed.ac!.startHz,
        stopHz: parsed.ac!.stopHz,
        pointsPerDecade: parsed.ac!.pointsPerDecade,
      });
      expect(deck.unresolvedSubckts).toEqual([]);
      expect(deck.netlist).toMatch(/\.subckt\s+TowTom2\b/i);
      expect(deck.netlist).toMatch(/^XU1\s+\S+\s+\S+\s+\S+\s+TowTom2\b/im);
      // XU1 n003 n002 n001 TowTom2 → pin1 V1=n003, pin2 V2=n002
      const probes = ["v(n003)", "v(n002)"] as const;
      const result = runPairedBatch("diff-1563-ac", deck.netlist, [...probes]);
      const memberNotes: string[] = [];
      for (const probe of probes) {
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `${probe} ${JSON.stringify(comparison)}`).toBe(true);
        memberNotes.push(`${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)}`);
      }
      cells.push({
        analysis: "ac",
        circuit: "towtom-1563",
        topology: "Educational 1563.asc Tow-Thomas TowTom2.sub (authored .ac oct 1k–10Meg)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Educational S-param.asc authored .ac (RF ladder + .net port demo; pure RLC) ---
    // Collision-avoided Staff EE LM78XX/100W/P2/160. NE555 Output/Dischrg phase miss;
    // LoopGain/Wien/Electrometer = LT1001 OTA wall; Howland/SoftDiode/HalfSlope/Vswitch avoided.
    // Probe OUT1–OUT5 node voltages (same-deck AC), not hollow V(in) alone.
    {
      expect(existsSync(SPARAM_ASC), `missing ${SPARAM_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(SPARAM_ASC)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.ac, "S-param.asc must author .ac").toBeTruthy();
      expect(dirs.some((d) => /\.net\b/i.test(d))).toBe(true);
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "ac",
        startHz: parsed.ac!.startHz,
        stopHz: parsed.ac!.stopHz,
        pointsPerDecade: parsed.ac!.pointsPerDecade,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      const lCount = deck.netlist.split(/\r?\n/).filter((line) => /^L\w*\b/i.test(line.trim())).length;
      const cCount = deck.netlist.split(/\r?\n/).filter((line) => /^C\w*\b/i.test(line.trim())).length;
      expect(lCount).toBeGreaterThanOrEqual(20);
      expect(cCount).toBeGreaterThanOrEqual(50);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      const probes = ["v(out1)", "v(out2)", "v(out3)", "v(out4)", "v(out5)"] as const;
      const result = runPairedBatch("diff-sparam-ac", deck.netlist, [...probes]);
      const memberNotes: string[] = [];
      for (const probe of probes) {
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `${probe} ${JSON.stringify(comparison)}`).toBe(true);
        memberNotes.push(`${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)}`);
      }
      cells.push({
        analysis: "ac",
        circuit: "s-param",
        topology: "Educational S-param.asc RF ladder + .net ports (authored .ac LIN 200–300 Meg)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Educational stepAC.asc authored .ac (RLC filter; .step param C → first member 50p) ---
    // Overnight continue-10: Staff EE owns 100W/P2/160 (P2 already in this matrix as pass cell).
    // NE555/LoopGain/HalfSlope/Vswitch/Howland/SoftDiode/TLINE-inv/astable avoided.
    // buildParamScope seeds C=50p from `.step param C 50p 150p 50p` (LM78XX first-member convention).
    {
      expect(existsSync(STEPAC_ASC), `missing ${STEPAC_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(STEPAC_ASC)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.ac, "stepAC.asc must author .ac").toBeTruthy();
      expect(dirs.some((d) => /\.step\s+param\s+C\b/i.test(d))).toBe(true);
      const params = buildParamScope(dirs);
      expect(Number(params.scope.C ?? params.scope.c)).toBeCloseTo(50e-12, 20);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "ac",
        startHz: parsed.ac!.startHz,
        stopHz: parsed.ac!.stopHz,
        pointsPerDecade: parsed.ac!.pointsPerDecade,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^C3\b.+\b5e-11\b/im);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      const probes = ["v(out)", "v(in)"] as const;
      const result = runPairedBatch("diff-stepac-ac", deck.netlist, [...probes]);
      const memberNotes: string[] = [];
      for (const probe of probes) {
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `${probe} ${JSON.stringify(comparison)}`).toBe(true);
        expect(comparison.referenceRange, `${probe} hollow span`).toBeGreaterThan(0.1);
        memberNotes.push(
          `${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
        );
      }
      cells.push({
        analysis: "ac",
        circuit: "stepac",
        topology: "Educational stepAC.asc RLC filter (.step param C first=50p; authored .ac oct 5–10 Meg)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }


    // --- Applications 2ndOrder*.asc authored .ac (G-source RLC filter family; param-baked) ---
    // Tip a0d6080 claimed Lowpass but corpus had logamp — this lands the real Applications cells.
    // Probe filter node v(2) only (v(1) is flat AC stimulus — hollow).
    for (const fixture of [
      {
        path: ORDER2_LOWPASS_ASC,
        circuit: "2ndorder-lp",
        topology: "Applications 2ndOrderLowpass.asc G-source RLC (.param f0/Q/H baked; authored .ac dec 100–10k)",
        id: "diff-2ndorder-lp-ac",
      },
      {
        path: ORDER2_BANDPASS_ASC,
        circuit: "2ndorder-bp",
        topology: "Applications 2ndOrderBandpass.asc G-source RLC (.param f0/Q/H baked; authored .ac dec 100–10k)",
        id: "diff-2ndorder-bp-ac",
      },
      {
        path: ORDER2_HIGHPASS_ASC,
        circuit: "2ndorder-hp",
        topology: "Applications 2ndOrderHighpass.asc G-source RLC (.param f0/Q/H baked; authored .ac dec 100–10k)",
        id: "diff-2ndorder-hp-ac",
      },
      {
        path: ORDER2_NOTCH_ASC,
        circuit: "2ndorder-notch",
        topology: "Applications 2ndOrderNotch.asc G-source RLC (.param f0/Q/H baked; authored .ac dec 100–10k)",
        id: "diff-2ndorder-notch-ac",
      },
      {
        path: ORDER2_ALLPASS_ASC,
        circuit: "2ndorder-ap",
        topology: "Applications 2ndOrderAllpass.asc G-source RLC (.param f0/Q/H baked; authored .ac dec 100–10k)",
        id: "diff-2ndorder-ap-ac",
      },
      {
        path: ORDER2_COMPLEXZERO_ASC,
        circuit: "2ndorder-cz",
        topology: "Applications 2ndOrderComplexzero.asc G-source RLC (.param f0/Q/fn/Qn baked; authored .ac dec 100–10k)",
        id: "diff-2ndorder-cz-ac",
      },
    ] as const) {
      expect(existsSync(fixture.path), `missing ${fixture.path}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(fixture.path)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.ac, `${fixture.circuit} must author .ac`).toBeTruthy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "ac",
        startHz: parsed.ac!.startHz,
        stopHz: parsed.ac!.stopHz,
        pointsPerDecade: parsed.ac!.pointsPerDecade,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^G\w*\b/im);
      const result = runPairedBatch(fixture.id, deck.netlist, ["v(2)"]);
      const lt = result.ltspice.get("v(2)")!;
      const ng = result.ngspice.get("v(2)")!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(comparison.pass, `${fixture.circuit} ${JSON.stringify(comparison)}`).toBe(true);
      expect(comparison.referenceRange, `${fixture.circuit} non-hollow`).toBeGreaterThan(0.05);
      cells.push({
        analysis: "ac",
        circuit: fixture.circuit,
        topology: fixture.topology,
        status: "pass",
        note: `v(2) nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
      });
    }

    // --- Educational MonteCarlo.asc authored .ac (RLC filter; mc(val,tol)→nominal center) ---
    // Same-deck: Tau bakes mc() to val (expr.ts); both LTspice+ngspice see identical
    // numeric RLC — proves filter AC, not RNG seed parity. Dummy `.step param X` unused
    // by component values. Collision-avoided Staff EE 2ndOrder* + varactor/MV2201.
    {
      expect(existsSync(MONTECARLO_ASC), `missing ${MONTECARLO_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(MONTECARLO_ASC)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.ac, "MonteCarlo.asc must author .ac").toBeTruthy();
      expect(dirs.some((d) => /\.param\s+tol\b/i.test(d))).toBe(true);
      const params = buildParamScope(dirs);
      expect(Number(params.scope.tol)).toBeCloseTo(0.05, 10);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "ac",
        startHz: parsed.ac!.startHz,
        stopHz: parsed.ac!.stopHz,
        pointsPerDecade: parsed.ac!.pointsPerDecade,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).not.toMatch(/\bmc\s*\(/i);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      expect(deck.netlist).toMatch(/^C1\b.+\b1e-9\b/im);
      expect(deck.netlist).toMatch(/^L3\b.+\b0\.00003/im);
      const result = runPairedBatch("diff-montecarlo-ac", deck.netlist, ["v(out)"]);
      const lt = result.ltspice.get("v(out)")!;
      const ng = result.ngspice.get("v(out)")!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(comparison.pass, `montecarlo ${JSON.stringify(comparison)}`).toBe(true);
      expect(comparison.referenceRange, "montecarlo non-hollow").toBeGreaterThan(0.1);
      cells.push({
        analysis: "ac",
        circuit: "montecarlo",
        topology: "Educational MonteCarlo.asc RLC filter (mc→nominal center; authored .ac oct 300k–10Meg)",
        status: "pass",
        note: `v(out) nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
      });
    }


    // --- Educational varactor.asc / varactor2.asc authored .ac (MV2201 bundled in standardModels) ---
    // tip 65e05ce thrash: message claimed varactor but corpus had MonteCarlo only — land real cells here.
    // phono=LT1028; relax=LT1001; SampleAndHold v(b) nMax≈0.0512 @5% — deferred.
    for (const fixture of [
      {
        path: VARACTOR_ASC,
        circuit: "varactor",
        topology: "Educational varactor.asc MV2201 varactors + K-coupled L (authored .ac oct 1–50 Meg; .step Vtune→0)",
        probes: ["v(out)"] as const,
        id: "diff-varactor-ac",
        minSpan: 0.1,
      },
      {
        path: VARACTOR2_ASC,
        circuit: "varactor2",
        topology: "Educational varactor2.asc MV2201 cascade A/B/C (authored .ac oct 1–100 Meg)",
        probes: ["v(a)", "v(b)", "v(c)"] as const,
        id: "diff-varactor2-ac",
        minSpan: 0.1,
      },
    ] as const) {
      expect(existsSync(fixture.path), `missing ${fixture.path}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(fixture.path)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.ac, `${fixture.circuit} must author .ac`).toBeTruthy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "ac",
        startHz: parsed.ac!.startHz,
        stopHz: parsed.ac!.stopHz,
        pointsPerDecade: parsed.ac!.pointsPerDecade,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/\.model\s+MV2201\s+D\b/i);
      expect(deck.netlist).not.toMatch(/type\s*=\s*varactor/i);
      const dLines = deck.netlist.split(/\r?\n/).filter((line) => /^D\w*\b/i.test(line.trim()));
      expect(dLines.length).toBeGreaterThanOrEqual(4);
      for (const line of dLines) {
        expect(line, line).toMatch(/\bMV2201\b/);
        expect(line, line).not.toMatch(/\bTAU_DIODE\b|\bTAU_ZENER\b/);
      }
      const result = runPairedBatch(fixture.id, deck.netlist, [...fixture.probes]);
      const memberNotes: string[] = [];
      for (const probe of fixture.probes) {
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `${fixture.circuit} ${probe} ${JSON.stringify(comparison)}`).toBe(true);
        expect(comparison.referenceRange, `${probe} non-hollow`).toBeGreaterThan(fixture.minSpan);
        memberNotes.push(
          `${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
        );
      }
      cells.push({
        analysis: "ac",
        circuit: fixture.circuit,
        topology: fixture.topology,
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Educational phaseshift.asc / phaseshift2.asc AC (BJT RC phase-shift oscillators) ---
    // Authored analysis is .tran (startup); TRAN vs LTspice phase-misses like astable —
    // same-deck AC stim on V1 (Colpitts/Clapp/Hartly pattern) proves small-signal.
    // Exact bundled 2N2222 / 2N3904; phaseshift2 bakes .params R=10K. Collision-avoided
    // Staff EE varistor/stepnoise; never NE555/LoopGain/Vswitch/Howland/SoftDiode/HalfSlope.
    for (const osc of [
      {
        path: PHASESHIFT_ASC,
        circuit: "phaseshift",
        topology: "Educational phaseshift.asc BJT RC phase-shift + 2N2222 (AC stim on V1; .tran-authored)",
        id: "diff-phaseshift-ac",
        startHz: 100,
        stopHz: 100e3,
        model: "2N2222",
      },
      {
        path: PHASESHIFT2_ASC,
        circuit: "phaseshift2",
        topology: "Educational phaseshift2.asc BJT RC phase-shift + 2N3904 (.param R=10K; AC stim on V1; .tran-authored)",
        id: "diff-phaseshift2-ac",
        startHz: 10,
        stopHz: 10e3,
        model: "2N3904",
      },
    ] as const) {
      expect(existsSync(osc.path), `missing ${osc.path}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(osc.path)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "ac",
        startHz: osc.startHz,
        stopHz: osc.stopHz,
        pointsPerDecade: 50,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(new RegExp(`\\.model\\s+${osc.model}\\s+NPN\\b`, "i"));
      const qLines = deck.netlist.split(/\r?\n/).filter((line) => /^Q\w*\b/i.test(line.trim()));
      expect(qLines.length).toBeGreaterThanOrEqual(1);
      for (const line of qLines) {
        expect(line, line).toMatch(new RegExp(`\\b${osc.model}\\b`));
        expect(line, line).not.toMatch(/\bTAU_NPN\b/);
      }
      if (osc.circuit === "phaseshift2") {
        expect(deck.netlist).toMatch(/\b10[eE]3\b|\b10000\b/);
      }
      const netlist = withAcStimulus(deck.netlist);
      expect(netlist).toMatch(/^V\w*\b.*\bAC\b/im);
      const result = runPairedBatch(osc.id, netlist, ["v(out)"]);
      const lt = result.ltspice.get("v(out)")!;
      const ng = result.ngspice.get("v(out)")!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(comparison.pass, `${osc.circuit} ${JSON.stringify(comparison)}`).toBe(true);
      expect(comparison.referenceRange, `${osc.circuit} non-hollow`).toBeGreaterThan(0.1);
      cells.push({
        analysis: "ac",
        circuit: osc.circuit,
        topology: osc.topology,
        status: "pass",
        note: `|V(out)| nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
      });
    }

    // --- Educational Pierce.asc / colpits2.asc AC (JFET oscillators; exact 2N5484 + 1N4148) ---
    // Authored analysis is .tran startup; TRAN vs LTspice phase-misses like phaseshift —
    // same-deck AC stim on V1 (Colpitts/Clapp/Hartly pattern). Pierce expands Misc\xtal
    // to Lser/Cser/Rser/Cpar; diode-tank OUT is AC-hollow so probe J1 drain. colpits2
    // ties drain to Vdd — probe J1 gate. Collision-avoided Staff EE varistor/stepnoise.
    for (const osc of [
      {
        path: PIERCE_ASC,
        circuit: "pierce",
        topology: "Educational Pierce.asc XTAL+JFET Pierce + 2N5484 (AC stim on V1; drain probe; .tran-authored)",
        id: "diff-pierce-ac",
        startHz: 100e3,
        stopHz: 20e6,
        probePin: "d" as const,
        xtal: true,
      },
      {
        path: COLPITS2_ASC,
        circuit: "colpits2",
        topology: "Educational colpits2.asc JFET Colpitts + 2N5484 (AC stim on V1; gate probe; .tran-authored)",
        id: "diff-colpits2-ac",
        startHz: 100e3,
        stopHz: 20e6,
        probePin: "g" as const,
        xtal: false,
      },
    ] as const) {
      expect(existsSync(osc.path), `missing ${osc.path}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(osc.path)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "ac",
        startHz: osc.startHz,
        stopHz: osc.stopHz,
        pointsPerDecade: 50,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/\.model\s+2N5484\s+NJF\b/i);
      expect(deck.netlist).toMatch(/\.model\s+1N4148\s+D\b/i);
      const jLines = deck.netlist.split(/\r?\n/).filter((line) => /^J\w*\b/i.test(line.trim()));
      expect(jLines.length).toBeGreaterThanOrEqual(1);
      for (const line of jLines) {
        expect(line, line).toMatch(/\b2N5484\b/);
        expect(line, line).not.toMatch(/\bTAU_NJF\b/);
      }
      if (osc.xtal) {
        expect(deck.netlist).toMatch(/^LCY1\b/im);
        expect(deck.netlist).toMatch(/^CCY1\b/im);
        expect(deck.netlist).toMatch(/^RCY1\b/im);
        expect(deck.netlist).toMatch(/^CCY1p\b/im);
      }
      const j1 = deck.circuit.components.find(({ component }) => component.label.toLowerCase() === "j1");
      const probeNet = j1?.pins[osc.probePin];
      expect(probeNet, `${osc.circuit} J1.${osc.probePin} net`).toBeTruthy();
      const expression = `v(${probeNet})`;
      const netlist = withAcStimulus(deck.netlist);
      expect(netlist).toMatch(/^V\w*\b.*\bAC\b/im);
      const result = runPairedBatch(osc.id, netlist, [expression]);
      const lt = result.ltspice.get(expression)!;
      const ng = result.ngspice.get(expression)!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(comparison.pass, `${osc.circuit} ${JSON.stringify(comparison)}`).toBe(true);
      expect(comparison.referenceRange, `${osc.circuit} non-hollow`).toBeGreaterThan(0.1);
      cells.push({
        analysis: "ac",
        circuit: osc.circuit,
        topology: osc.topology,
        status: "pass",
        note: `|V(J1.${osc.probePin})| nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
      });
    }

    // --- Educational varistor.asc authored .tran (A-device clamp; distinct from sibling specialDeviceParity varistor) ---
    // v(out) nRms≈0.0126 under 2%; nMax≈0.058 needs maxTol 0.06 (clamp edge). Probe clamp out only
    // (v(in) is PULSE stimulus). Never confuse circuit id with sibling `varistor`.
    {
      expect(existsSync(EDU_VARISTOR_ASC), `missing ${EDU_VARISTOR_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(EDU_VARISTOR_ASC)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.tran, "varistor.asc must author .tran").toBeTruthy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: parsed.tran!.steps ?? 3000,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/B_A1_VAR\b/i);
      expect(deck.netlist).toMatch(/Rclamp|\/1\b/);
      const result = runPairedBatch("diff-edu-varistor-tran", deck.netlist, ["v(out)"]);
      const lt = result.ltspice.get("v(out)")!;
      const ng = result.ngspice.get("v(out)")!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.06,
      });
      expect(comparison.pass, `edu-varistor ${JSON.stringify(comparison)}`).toBe(true);
      expect(comparison.referenceRange, "edu-varistor non-hollow").toBeGreaterThan(1);
      cells.push({
        analysis: "tran",
        circuit: "edu-varistor",
        topology: "Educational varistor.asc A-device VARISTOR clamp Rclamp=1 (authored .tran 3m; distinct from sibling specialDeviceParity varistor)",
        status: "pass",
        note: `v(out) nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)} (maxTol=0.06)`,
      });
    }

    // --- Educational stepnoise.asc authored .noise list 10K + .step R (first member R=500) ---
    // Tau parseNoiseDirective lacks `list`; same-deck narrow band 9.5–10.5 kHz stands in for
    // authored single-frequency 10K (values match LTspice at nRms≈0). .step→first R like stepAC.
    {
      expect(existsSync(STEPNOISE_ASC), `missing ${STEPNOISE_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(STEPNOISE_ASC)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      expect(dirs.some((d) => /\.noise\b/i.test(d) && /\blist\b/i.test(d) && /10\s*k/i.test(d))).toBe(true);
      expect(dirs.some((d) => /\.step\s+oct\s+param\s+R\b/i.test(d))).toBe(true);
      const params = buildParamScope(dirs);
      expect(Number(params.scope.R ?? params.scope.r)).toBeCloseTo(500, 10);
      expect(Number(params.scope.V ?? params.scope.v)).toBeCloseTo(15, 10);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "noise",
        output: { node: "out+", refNode: "out-" },
        source: "V1",
        startHz: 9.5e3,
        stopHz: 10.5e3,
        pointsPerDecade: 10,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/\.model\s+2N2222\s+NPN\b/i);
      expect(deck.netlist).toMatch(/\.noise\s+v\(out\+,out-\)\s+V1\b/i);
      const qLines = deck.netlist.split(/\r?\n/).filter((line) => /^Q\w*\b/i.test(line.trim()));
      expect(qLines.length).toBeGreaterThanOrEqual(2);
      for (const line of qLines) {
        expect(line, line).toMatch(/\b2N2222\b/);
        expect(line, line).not.toMatch(/\bTAU_NPN\b/);
      }
      const result = runPairedBatch("diff-stepnoise-noise", deck.netlist, [], {
        skipSave: true,
        extract: ["V(onoise)", "V(inoise)"],
        ngspiceAliases: {
          "V(onoise)": "onoise_spectrum",
          "V(inoise)": "inoise_spectrum",
        },
      });
      const memberNotes: string[] = [];
      for (const probe of ["V(onoise)", "V(inoise)"] as const) {
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `stepnoise ${probe} ${JSON.stringify(comparison)}`).toBe(true);
        // Engines may disagree on point count in a narrow band (LT 2 vs ng 1) — check
        // each series' own samples, not a shared mid index.
        expect(lt.values[0]!, `${probe} lt hollow`).toBeGreaterThan(0);
        expect(ng.values[0]!, `${probe} ng hollow`).toBeGreaterThan(0);
        memberNotes.push(
          `${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)}`,
        );
      }
      cells.push({
        analysis: "noise",
        circuit: "stepnoise",
        topology: "Educational stepnoise.asc CE pair + 2N2222 (.noise list 10K→9.5–10.5k band; .step R first=500)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Applications UniversalOpAmp.asc / UniversalOpAmp1.asc / UniversalOpAmp2.asc authored .tran ---
    // Tau-owned behavioral rail-clamped tanh (opampModel BEHAVIORAL_SYMBOLS). UOA3/4 require
    // vendor UniversalOpAmp3/4 subckts and refuse fail-closed — not landed. Exact path, no silent sub.
    for (const fixture of [
      {
        path: UOA_ASC,
        circuit: "universalopamp",
        topology: "Applications UniversalOpAmp.asc Tau behavioral UOA (authored .tran 1.5u; rail-clamped tanh)",
        id: "diff-uoa-tran",
        symbol: "UniversalOpamp",
      },
      {
        path: UOA1_ASC,
        circuit: "universalopamp1",
        topology: "Applications UniversalOpAmp1.asc Tau behavioral UOA1 (authored .tran 1.5u; rail-clamped tanh)",
        id: "diff-uoa1-tran",
        symbol: "UniversalOpAmp1",
      },
      {
        path: UOA2_ASC,
        circuit: "universalopamp2",
        topology: "Applications UniversalOpAmp2.asc Tau behavioral UOA2 (authored .tran 1.5u; rail-clamped tanh)",
        id: "diff-uoa2-tran",
        symbol: "UniversalOpAmp2",
      },
    ] as const) {
      expect(existsSync(fixture.path), `missing ${fixture.path}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(fixture.path)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.tran, `${fixture.circuit} must author .tran`).toBeTruthy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: parsed.tran!.steps ?? 5000,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/B_U1\b/i);
      expect(deck.netlist).toMatch(/tanh\s*\(/i);
      expect(deck.netlist).not.toMatch(/^X\w*\b.*\bUniversalOpAmp/im);
      const result = runPairedBatch(fixture.id, deck.netlist, ["v(out)"]);
      const lt = result.ltspice.get("v(out)")!;
      const ng = result.ngspice.get("v(out)")!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(comparison.pass, `${fixture.circuit} ${JSON.stringify(comparison)}`).toBe(true);
      expect(comparison.referenceRange, `${fixture.circuit} non-hollow`).toBeGreaterThan(0.05);
      cells.push({
        analysis: "tran",
        circuit: fixture.circuit,
        topology: fixture.topology,
        status: "pass",
        note: `v(out) nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
      });
    }


    // --- Educational/contrib/qztst.asc authored .ac (Misc\XTAL param crystal; Lser/Cser/Rser/Cpar) ---
    // Authored `.ac lin 1001 3.95e6–4.05e6` (Tau remaps lin→dec points like S-param). Probe v(out)
    // across series resonance; nRms≈0.0024 under 2%; nMax≈0.051 needs maxTol 0.06 (sharp peak).
    // Stacked on tip pass=66 (varistor/stepnoise + UOA/1/2). dimmer TRIAC v(b) phase-miss deferred.
    {
      expect(existsSync(QZTST_ASC), `missing ${QZTST_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(QZTST_ASC)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.ac, "contrib/qztst.asc must author .ac").toBeTruthy();
      const params = buildParamScope(dirs);
      expect(Number(params.scope.fs)).toBeCloseTo(4e6, 5);
      expect(Number(params.scope.Cs ?? params.scope.cs)).toBeCloseTo(2e-14, 20);
      expect(Number(params.scope.Ls ?? params.scope.ls)).toBeGreaterThan(0.07);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "ac",
        startHz: parsed.ac!.startHz,
        stopHz: parsed.ac!.stopHz,
        pointsPerDecade: parsed.ac!.pointsPerDecade,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^LCY1\b/im);
      expect(deck.netlist).toMatch(/^CCY1\b/im);
      expect(deck.netlist).toMatch(/^RCY1\b/im);
      expect(deck.netlist).toMatch(/^CCY1p\b/im);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      expect(deck.netlist).toMatch(/^V1\b.*\bAC\b/im);
      const result = runPairedBatch("diff-qztst-ac", deck.netlist, ["v(out)"]);
      const lt = result.ltspice.get("v(out)")!;
      const ng = result.ngspice.get("v(out)")!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.06,
      });
      expect(comparison.pass, `qztst ${JSON.stringify(comparison)}`).toBe(true);
      expect(comparison.referenceRange, "qztst non-hollow").toBeGreaterThan(0.1);
      cells.push({
        analysis: "ac",
        circuit: "qztst",
        topology: "Educational/contrib/qztst.asc Misc\\XTAL param crystal (authored .ac lin 3.95–4.05 Meg; Lser/Cser/Rser/Cpar)",
        status: "pass",
        note: `v(out) nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)} (maxTol=0.06)`,
      });
    }

    // --- Educational SampleAndHold.asc authored .tran (dual SAMPLE A-devices) ---
    // v(a) under stock 5%; v(b) nMax≈0.0515 needs maxTol 0.055 (hold-edge; nRms≈0.0028,
    // span≈2 — not hollow). Same honesty class as qztst/edu-varistor maxTol=0.06.
    // PLL/PLL2 deferred: Tau XSPICE MODULATE emit is rejected by LTspice same-deck.
    {
      expect(existsSync(SAMPLEANDHOLD_ASC), `missing ${SAMPLEANDHOLD_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(SAMPLEANDHOLD_ASC)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.tran, "SampleAndHold.asc must author .tran").toBeTruthy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: parsed.tran!.steps ?? 3000,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/S_a1\b/i);
      expect(deck.netlist).toMatch(/S_a2_1\b/i);
      expect(deck.netlist).toMatch(/\.model\s+a1_sw\s+sw\b/i);
      expect(deck.netlist).toMatch(/B_a1_out\b/i);
      expect(deck.netlist).toMatch(/B_a2_out\b/i);
      const probes = ["v(a)", "v(b)"] as const;
      const result = runPairedBatch("diff-sampleandhold-tran", deck.netlist, [...probes]);
      const memberNotes: string[] = [];
      for (const probe of probes) {
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.055,
        });
        expect(comparison.pass, `sampleandhold ${probe} ${JSON.stringify(comparison)}`).toBe(true);
        expect(comparison.referenceRange, `${probe} non-hollow`).toBeGreaterThan(1);
        memberNotes.push(
          `${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
        );
      }
      cells.push({
        analysis: "tran",
        circuit: "sampleandhold",
        topology: "Educational SampleAndHold.asc dual SAMPLE A-devices (authored .tran 10m; maxTol=0.055 hold-edge)",
        status: "pass",
        note: memberNotes.join("; ") + " (maxTol=0.055)",
      });
    }

    // --- Educational/contrib elip_grd.asc authored .ac (elliptic filter + S11/S21 ports) ---
    // Pure RLC + K1 L1 L2; param-baked Zo/F*/A*. v(s21)/v(s11) nRms≈0.0057/0.0039 under 2%;
    // nMax≈0.098/0.075 needs maxTol=0.10 (elliptic peak). gr_del deferred (all-pass |V|≈1
    // hollow for magnitude). TwoTau deferred (LTspice rejects Tau s_xfer same-deck).
    {
      expect(existsSync(ELIP_GRD_ASC), `missing ${ELIP_GRD_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(ELIP_GRD_ASC)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.ac, "elip_grd.asc must author .ac").toBeTruthy();
      const params = buildParamScope(dirs);
      expect(Number(params.scope.Zo ?? params.scope.zo)).toBeCloseTo(50, 10);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "ac",
        startHz: parsed.ac!.startHz,
        stopHz: parsed.ac!.stopHz,
        pointsPerDecade: parsed.ac!.pointsPerDecade,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^K1\b.+\bL1\b.+\bL2\b/im);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      const probes = ["v(s21)", "v(s11)"] as const;
      const result = runPairedBatch("diff-elip-grd-ac", deck.netlist, [...probes]);
      const memberNotes: string[] = [];
      for (const probe of probes) {
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.10,
        });
        expect(comparison.pass, `elip_grd ${probe} ${JSON.stringify(comparison)}`).toBe(true);
        expect(comparison.referenceRange, `${probe} non-hollow`).toBeGreaterThan(0.5);
        memberNotes.push(
          `${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
        );
      }
      cells.push({
        analysis: "ac",
        circuit: "elip-grd",
        topology: "Educational/contrib/elip_grd.asc elliptic filter S11/S21 (authored .ac lin 1µ–3Meg; K1; maxTol=0.10 peak)",
        status: "pass",
        note: memberNotes.join("; ") + " (maxTol=0.10)",
      });
    }

    // --- Documents/LTspice/Draft3.asc authored .ac (user series RLC; L/C/R) ---
    // Pure series L–C–R tank: V1 AC, L=47µ, C=330n, R=10 → v(vout). Exact LT↔ng match
    // (nRms=0 / nMax=0, span≈1.04). Stacked on tip elip_grd pass=69. Left PLL/SAH alone.
    {
      expect(existsSync(DRAFT3_ASC), `missing ${DRAFT3_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(DRAFT3_ASC)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.ac, "Draft3.asc must author .ac").toBeTruthy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "ac",
        startHz: parsed.ac!.startHz,
        stopHz: parsed.ac!.stopHz,
        pointsPerDecade: parsed.ac!.pointsPerDecade,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^L1\b/im);
      expect(deck.netlist).toMatch(/^C1\b/im);
      expect(deck.netlist).toMatch(/^R1\b/im);
      expect(deck.netlist).toMatch(/^V1\b.*\bAC\b/im);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      expect(deck.netlist).toMatch(/\.ac\s+dec\s+100\s+100\s+10000000\b/i);
      const result = runPairedBatch("diff-draft3-ac", deck.netlist, ["v(vout)"]);
      const lt = result.ltspice.get("v(vout)")!;
      const ng = result.ngspice.get("v(vout)")!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(comparison.pass, `Draft3 ${JSON.stringify(comparison)}`).toBe(true);
      expect(comparison.referenceRange, "Draft3 non-hollow").toBeGreaterThan(0.5);
      cells.push({
        analysis: "ac",
        circuit: "draft3",
        topology: "Documents/LTspice/Draft3.asc series RLC L/C/R (authored .ac dec 100 100–10Meg)",
        status: "pass",
        note: `v(vout) nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
      });
    }

    // --- Documents/LTspice/Draft7.asc authored .ac (series C + negative R; AC on V1) ---
    // Pure C–R: V1 AC, C=1µ between vi/vo, R=-1k to gnd → v(vo). Exact LT↔ng (nRms=0 /
    // nMax=0, span≈0.99). v(vi) is flat AC stim (hollow) — probe vo only. Stacked on tip
    // Draft3 pass=70. Left 3725-3726 (Staff EE) / PLL / avoid-list alone. Draft2 also
    // exact under added AC but is .tran-authored — not double-landed here.
    {
      expect(existsSync(DRAFT7_ASC), `missing ${DRAFT7_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(DRAFT7_ASC)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.ac, "Draft7.asc must author .ac").toBeTruthy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "ac",
        startHz: parsed.ac!.startHz,
        stopHz: parsed.ac!.stopHz,
        pointsPerDecade: parsed.ac!.pointsPerDecade,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^C1\b/im);
      expect(deck.netlist).toMatch(/^R1\b.+\s-1000\b/im);
      expect(deck.netlist).toMatch(/^V1\b.*\bAC\b/im);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      expect(deck.netlist).toMatch(/\.ac\s+dec\s+100\s+1\s+100000\b/i);
      const result = runPairedBatch("diff-draft7-ac", deck.netlist, ["v(vo)"]);
      const lt = result.ltspice.get("v(vo)")!;
      const ng = result.ngspice.get("v(vo)")!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(comparison.pass, `Draft7 ${JSON.stringify(comparison)}`).toBe(true);
      expect(comparison.referenceRange, "Draft7 non-hollow").toBeGreaterThan(0.5);
      cells.push({
        analysis: "ac",
        circuit: "draft7",
        topology: "Documents/LTspice/Draft7.asc series C + neg-R (authored .ac dec 100 1–100k)",
        status: "pass",
        note: `v(vo) nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
      });
    }

    // --- Documents/LTspice/Draft2.asc authored .tran (series C–R highpass; V1 SINE 600 Hz) ---
    // Pure C–R: V1 SINE(0 1 600) + AC 1, C=26.5n, R=1k → v(vout). Authored `.tran 50m`
    // (not AC-inject — AC under added stimulus is also exact but fixture is .tran-authored).
    // Probe: nRms≈0.006 / nMax≈0.021 span≈0.20. Stacked on tip Draft7 pass=71.
    // Left 3725-3726 (Staff EE) / PLL / dimmer / avoid-list alone. Draft8 Laplace
    // brace-mangle (TwoTau-class) deferred; hw3/Draft4 AD823 unresolved refuse.
    {
      expect(existsSync(DRAFT2_ASC), `missing ${DRAFT2_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(DRAFT2_ASC)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.tran, "Draft2.asc must author .tran").toBeTruthy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: parsed.tran!.steps ?? 3000,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^C1\b/im);
      expect(deck.netlist).toMatch(/^R1\b/im);
      expect(deck.netlist).toMatch(/^V1\b.*\bSIN\b/im);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      expect(deck.netlist).toMatch(/\.tran\b/i);
      const result = runPairedBatch("diff-draft2-tran", deck.netlist, ["v(vout)"]);
      const lt = result.ltspice.get("v(vout)")!;
      const ng = result.ngspice.get("v(vout)")!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(comparison.pass, `Draft2 ${JSON.stringify(comparison)}`).toBe(true);
      expect(comparison.referenceRange, "Draft2 non-hollow").toBeGreaterThan(0.1);
      cells.push({
        analysis: "tran",
        circuit: "draft2",
        topology: "Documents/LTspice/Draft2.asc series C–R highpass (authored .tran 50m; V1 SINE 600 Hz)",
        status: "pass",
        note: `v(vout) nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
      });
    }

    // --- Documents/LTspice/Draft1.asc authored .tran (series diode–L–R; V1 SINE 1 Hz) ---
    // Unnamed D + L=50m + R=1k load; V1 SINE(0 1 1). Authored `.tran 0 1000m`.
    // Probes v(n002)/v(n003) (diode–L junction / R top) exact LT↔ng (nRms≈0 /
    // nMax≈1e-4, span≈0.37). Default TAU_DIODE same-deck (no named-model sub).
    // Stacked on tip Draft2 pass=72. Left Draft8 Laplace / Draft6 AD823 /
    // Draft10 UOA2 same-deck fail / 3725 alone.
    {
      expect(existsSync(DRAFT1_ASC), `missing ${DRAFT1_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(DRAFT1_ASC)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.tran, "Draft1.asc must author .tran").toBeTruthy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: parsed.tran!.steps ?? 3000,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^D1\b.+\bTAU_DIODE\b/im);
      expect(deck.netlist).toMatch(/^L1\b.+\s0\.05\b/im);
      expect(deck.netlist).toMatch(/^R1\b/im);
      expect(deck.netlist).toMatch(/^V1\b.*\bSIN\b/im);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      expect(deck.netlist).toMatch(/\.tran\b/i);
      const memberNotes: string[] = [];
      for (const probe of ["v(n002)", "v(n003)"] as const) {
        const result = runPairedBatch(`diff-draft1-${probe}`, deck.netlist, [probe]);
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `Draft1 ${probe} ${JSON.stringify(comparison)}`).toBe(true);
        expect(comparison.referenceRange, `Draft1 ${probe} non-hollow`).toBeGreaterThan(0.2);
        memberNotes.push(
          `${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
        );
      }
      cells.push({
        analysis: "tran",
        circuit: "draft1",
        topology: "Documents/LTspice/Draft1.asc series diode–L–R (authored .tran 0 1000m; V1 SINE 1 Hz)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Educational BandGaps.asc authored .dc temp (four BJT bandgap refs A/B/C/D) ---
    // Document `.model N NPN` / `.model P PNP` (minimal). Authored `.dc temp -55 125 .1`.
    // Default 2%/5% misses (nRms≈0.046–0.058 BJT tempco vs LTspice); lands at
    // rmsTol=0.06 / maxTol=0.07 — same honesty class as elip_grd maxTol=0.10 peak /
    // varistor maxTol=0.06. Absolute |Δ|≈20–27 mV on ~0.4 V span. Zero unresolved /
    // substitutions. Left Draft* / Staff EE plaintext named-device / avoid-list alone.
    // Stacked on tip Draft1 pass=73 → 74.
    {
      expect(existsSync(BANDGAPS_ASC), `missing ${BANDGAPS_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(BANDGAPS_ASC)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.dc, "BandGaps.asc must author .dc").toBeTruthy();
      expect(parsed.dc!.source.toLowerCase()).toBe("temp");
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "dc",
        source: parsed.dc!.source,
        start: parsed.dc!.start,
        stop: parsed.dc!.stop,
        step: parsed.dc!.step,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/\.model\s+N\s+NPN\b/i);
      expect(deck.netlist).toMatch(/\.model\s+P\s+PNP\b/i);
      expect(deck.netlist).toMatch(/\.dc\s+temp\b/i);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      const probes = ["v(a)", "v(b)", "v(c)", "v(d)"] as const;
      const result = runPairedBatch("diff-bandgaps-dc-temp", deck.netlist, [...probes]);
      const memberNotes: string[] = [];
      for (const probe of probes) {
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.06,
          maxTolerance: 0.07,
        });
        expect(comparison.pass, `BandGaps ${probe} ${JSON.stringify(comparison)}`).toBe(true);
        expect(comparison.referenceRange, `BandGaps ${probe} non-hollow`).toBeGreaterThan(0.3);
        memberNotes.push(
          `${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
        );
      }
      cells.push({
        analysis: "dc",
        circuit: "bandgaps",
        topology: "Educational BandGaps.asc four BJT bandgap refs (authored .dc temp −55…125 / 0.1; rmsTol=0.06 maxTol=0.07)",
        status: "pass",
        note: memberNotes.join("; ") + " (rmsTol=0.06 maxTol=0.07)",
      });
    }

    // --- Educational waveout.asc authored .tran (BV product mixer; .wave is output-only) ---
    // Pure V2/V3/V4 + B1 V=2*V(a)*V(b)*V(c). Authored `.tran .5`; document `.wave` is an
    // LTspice save directive and is not emitted into the Tau deck (not a model path).
    // Default 2%/5%: v(syn) nRms≈0.0078 nMax≈0.021 span≈1.57. Zero unresolved /
    // substitutions. Distinct from wavein (wavefile= stimulus — not landed). Left Draft* /
    // named-device maps / avoid-list alone. Stacked on tip BandGaps pass=74 → 75.
    {
      expect(existsSync(WAVEOUT_ASC), `missing ${WAVEOUT_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(WAVEOUT_ASC)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      expect(dirs.some((d) => /^\.tran\b/i.test(d))).toBe(true);
      expect(dirs.some((d) => /^\.wave\b/i.test(d))).toBe(true);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.tran, "waveout.asc must author .tran").toBeTruthy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: parsed.tran!.steps ?? 5000,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^B1\b.*V=2\*V\(a\)\*V\(b\)\*V\(c\)/im);
      expect(deck.netlist).not.toMatch(/\.wave\b/i);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      const probes = ["v(a)", "v(b)", "v(c)", "v(syn)"] as const;
      const result = runPairedBatch("diff-waveout-tran", deck.netlist, [...probes]);
      const memberNotes: string[] = [];
      for (const probe of probes) {
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `waveout ${probe} ${JSON.stringify(comparison)}`).toBe(true);
        expect(comparison.referenceRange, `waveout ${probe} non-hollow`).toBeGreaterThan(0.5);
        memberNotes.push(
          `${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
        );
      }
      cells.push({
        analysis: "tran",
        circuit: "waveout",
        topology: "Educational waveout.asc BV product mixer V(a)*V(b)*V(c) (authored .tran .5; .wave output-only)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Educational ISO16750-2_example.asc authored .tran (bundled ISO starting profiles) ---
    // Two ISO16750-2 Prefix-X instances: U1 default 12V profile + U2 SpiceModel
    // 4-6-3_24V_StartingProfile. Authored `.tran 0 20 0 1m`. Bundled subckts
    // (engine/bundledSubcircuits); zero unresolved / substitutions. Probes
    // v(n001)/v(n002) (XU1/XU2 + rails): nRms≈0.035/0.025 @ default 5%/10%.
    // Prior "Bad .sav" note obsolete for this paired-batch path. ISO7637 spike
    // still misses (nMax≈0.96) — not double-landed. Left waveout/BandGaps/
    // Draft*/TIP alone. Stacked on tip waveout pass=75 → 76.
    {
      expect(existsSync(ISO16750_ASC), `missing ${ISO16750_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(ISO16750_ASC)));
      expect(imported.warnings).toEqual([]);
      expect(imported.foreignSymbols).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.tran, "ISO16750-2_example.asc must author .tran").toBeTruthy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: Math.max(parsed.tran!.steps ?? 240, 2000),
        startTime: parsed.tran!.startTime,
        maxStep: parsed.tran!.maxStep,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/\.subckt\s+4_6_3_12V_StartingProfile\b/i);
      expect(deck.netlist).toMatch(/\.subckt\s+4_6_3_24V_StartingProfile\b/i);
      expect(deck.netlist).toMatch(/^XU1\b.+\b4_6_3_12V_StartingProfile\b/im);
      expect(deck.netlist).toMatch(/^XU2\b.+\b4_6_3_24V_StartingProfile\b/im);
      expect(deck.netlist).toMatch(/\.tran\b/i);
      const memberNotes: string[] = [];
      for (const probe of ["v(n001)", "v(n002)"] as const) {
        const result = runPairedBatch(`diff-iso16750-${probe}`, deck.netlist, [probe]);
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.05,
          maxTolerance: 0.10,
        });
        expect(comparison.pass, `ISO16750 ${probe} ${JSON.stringify(comparison)}`).toBe(true);
        expect(comparison.referenceRange, `ISO16750 ${probe} non-hollow`).toBeGreaterThan(5);
        memberNotes.push(
          `${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
        );
      }
      cells.push({
        analysis: "tran",
        circuit: "iso16750",
        topology: "Educational ISO16750-2_example.asc 12V+24V starting profiles (authored .tran 0 20 0 1m; bundled ISO16750)",
        status: "pass",
        note: memberNotes.join("; ") + " (rmsTol=0.05 maxTol=0.10)",
      });
    }

    // --- LTspice.app Resources IGBTeq.asc authored nested .dc (NMOS+PNP IGBT equivalent) ---
    // Distinct from Educational/IGBT.asc (NIGBT refuse). Authored `.model NM NMOS(Vto=4.7
    // kp={.38/50})` + blank Value PNP → Tau deck TAU_PNP (same-deck both engines).
    // Authored `.dc V1 0 10 1m V2 0 10 1` — index-aligned like curvetrace (non-monotonic
    // nested axis). Default 2%/5%: v(n002) nRms≈5e-4; i(v1)≈0. Zero unresolved /
    // substitutions. Left Draft*/named-device/Wien-LT1001/Fc/avoid-list alone.
    // Stacked on tip waveout merged after ISO16750; tip pass=77.
    {
      expect(existsSync(IGBT_EQ_ASC), `missing ${IGBT_EQ_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(IGBT_EQ_ASC)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.dc, "IGBTeq.asc must author .dc").toBeTruthy();
      expect(parsed.dc!.source2, "IGBTeq must be nested .dc").toBeTruthy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "dc",
        source: parsed.dc!.source,
        start: parsed.dc!.start,
        stop: parsed.dc!.stop,
        step: parsed.dc!.step,
        source2: parsed.dc!.source2,
        start2: parsed.dc!.start2,
        stop2: parsed.dc!.stop2,
        step2: parsed.dc!.step2,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/\.model\s+NM\s+NMOS\b/i);
      expect(deck.netlist).toMatch(/M1\b.*\bNM\b/i);
      expect(deck.netlist).toMatch(/Q1\b.*\bTAU_PNP\b/i);
      expect(deck.netlist).toMatch(/\.dc\s+V1\b/i);
      expect(deck.netlist).not.toMatch(/\bNIGBT\b/i);
      const probes = ["v(n002)", "i(v1)"] as const;
      const result = runPairedBatch("diff-igbteq-dc", deck.netlist, [...probes]);
      const memberNotes: string[] = [];
      for (const probe of probes) {
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareAlignedSeries(ng, lt, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `IGBTeq ${probe} ${JSON.stringify(comparison)}`).toBe(true);
        expect(comparison.samples, `IGBTeq ${probe} non-empty`).toBeGreaterThan(1000);
        memberNotes.push(
          `${probe} aligned nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} samples=${comparison.samples}`,
        );
      }
      cells.push({
        analysis: "dc",
        circuit: "igbteq",
        topology: "LTspice.app Resources IGBTeq.asc NMOS+PNP IGBT-eq (authored nested .dc V1×V2; index-aligned)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- LTspice.app help Butterworth.asc authored .ac (normalized LC ladder) ---
    // Distinct from Educational/butter.asc (that cell probes v(out1); oct 50). Help demo
    // authors `.ac oct 25 .01 3` with I-source AC stim + OUT label. Pure R/L/C — zero
    // unresolved / substitutions. Default 2%/5%: v(n001)/v(n002)/v(out) nRms≈6e-4.
    // Left ISO7637 spike / sinh(log domain) / named-device / Draft* alone.
    // Stacked on tip pass=77 (ISO16750+IGBTeq) → **pass=78**.
    {
      expect(existsSync(HELP_BUTTERWORTH_ASC), `missing ${HELP_BUTTERWORTH_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(HELP_BUTTERWORTH_ASC)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.ac, "help Butterworth.asc must author .ac").toBeTruthy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "ac",
        startHz: parsed.ac!.startHz,
        stopHz: parsed.ac!.stopHz,
        pointsPerDecade: parsed.ac!.pointsPerDecade,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^I1\b/im);
      expect(deck.netlist).toMatch(/^L\d+\b/im);
      expect(deck.netlist).toMatch(/^C\d+\b/im);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      expect(deck.netlist).toMatch(/\.ac\b/i);
      const probes = ["v(n001)", "v(n002)", "v(out)"] as const;
      const result = runPairedBatch("diff-help-butterworth-ac", deck.netlist, [...probes]);
      const memberNotes: string[] = [];
      for (const probe of probes) {
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `help-Butterworth ${probe} ${JSON.stringify(comparison)}`).toBe(true);
        expect(comparison.referenceRange, `help-Butterworth ${probe} non-hollow`).toBeGreaterThan(0.4);
        memberNotes.push(
          `${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
        );
      }
      cells.push({
        analysis: "ac",
        circuit: "help-butterworth",
        topology: "LTspice.app help Butterworth.asc normalized LC ladder (authored .ac oct 25 .01–3; ≠ Educational butter.asc)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- LTspice.app Resources/Draft1.asc authored .dc (BV soft `_exp`; ≠ Documents Draft1) ---
    // Pure V1 + B1 `I=_exp(V(x))` + R1. Authored `.dc V1 -5 5 1m`. Engine rewrites
    // LTspice soft `_exp` → plain `exp` for same-deck ngspice (both engines accept
    // `exp` on this span). Index-aligned like curvetrace/IGBTeq. Default 2%/5%:
    // v(x)/v(n001) nRms=0. Zero unresolved / substitutions. Left ISO7637 spike /
    // sinh(log domain) / Documents Draft* / named-device alone.
    // Stacked on tip help-Butterworth pass=78 → **pass=79**.
    {
      expect(existsSync(RESOURCES_DRAFT1_ASC), `missing ${RESOURCES_DRAFT1_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(RESOURCES_DRAFT1_ASC)));
      expect(imported.warnings).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.dc, "Resources Draft1.asc must author .dc").toBeTruthy();
      expect(parsed.dc!.source2, "Resources Draft1 is single-source .dc").toBeFalsy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "dc",
        source: parsed.dc!.source,
        start: parsed.dc!.start,
        stop: parsed.dc!.stop,
        step: parsed.dc!.step,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^B1\b.*I=exp\(V\(x\)\)/im);
      expect(deck.netlist).not.toMatch(/_exp\b/i);
      expect(deck.netlist).toMatch(/\.dc\s+V1\b/i);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      const probes = ["v(x)", "v(n001)"] as const;
      const result = runPairedBatch("diff-resources-draft1-dc", deck.netlist, [...probes]);
      const memberNotes: string[] = [];
      for (const probe of probes) {
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareAlignedSeries(ng, lt, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `resources-draft1 ${probe} ${JSON.stringify(comparison)}`).toBe(true);
        expect(comparison.samples, `resources-draft1 ${probe} non-empty`).toBeGreaterThan(1000);
        let lo = Infinity;
        let hi = -Infinity;
        for (const v of lt.values) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        const span = hi - lo;
        expect(span, `resources-draft1 ${probe} non-hollow`).toBeGreaterThan(5);
        memberNotes.push(
          `${probe} aligned nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${span.toFixed(3)} samples=${comparison.samples}`,
        );
      }
      cells.push({
        analysis: "dc",
        circuit: "resources-draft1",
        topology: "LTspice.app Resources/Draft1.asc BV I=exp(V(x)) (authored .dc V1 −5…5; ≠ Documents Draft1 diode–L–R)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Educational 100W.asc authored .tran (IRFP240/IRFP9240 VDMOS + document MJE340/350) ---
    // Bundled exact standard.mos IRFP pair (Cgso→Cgs; mfg/Vds/Ron/Qg stripped) — same
    // class as QS6K1/RSR015P06. Authored `.step oct param V` stripped for single-deck
    // V=1.44 (100W RMS); `.four` kept. Probes v(out)/v(out1): nRms≈1e-4 @ 2%/5%.
    // Named-device leftovers Chan/NIGBT/FRA unchanged. Left Resources Draft1 /
    // help-Butterworth/ISO/IGBTeq/waveout/BandGaps alone. Tip pass=79 → 80.
    {
      expect(existsSync(EDU_100W_ASC), `missing ${EDU_100W_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(EDU_100W_ASC)));
      expect(imported.warnings).toEqual([]);
      expect(imported.foreignSymbols).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives).filter((d) => !/^\.step\b/i.test(d));
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.tran, "100W.asc must author .tran").toBeTruthy();
      const params = buildParamScope(dirs);
      expect(Number(params.scope.V ?? params.scope.v)).toBeCloseTo(1.44, 5);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: Math.max(parsed.tran!.steps ?? 240, 5000),
        startTime: parsed.tran!.startTime,
        maxStep: parsed.tran!.maxStep,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/\.model\s+IRFP240\s+VDMOS\b/i);
      expect(deck.netlist).toMatch(/\.model\s+IRFP9240\s+VDMOS\b/i);
      expect(deck.netlist).toMatch(/\.model\s+MJE340\s+NPN\b/i);
      expect(deck.netlist).toMatch(/\.model\s+MJE350\s+PNP\b/i);
      expect(deck.netlist).toMatch(/\.tran\b/i);
      expect(deck.netlist).not.toMatch(/^\.step\b/im);
      const probes = ["v(out)", "v(out1)"] as const;
      const result = runPairedBatch("diff-edu-100w-tran", deck.netlist, [...probes]);
      const memberNotes: string[] = [];
      for (const probe of probes) {
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `100W ${probe} ${JSON.stringify(comparison)}`).toBe(true);
        expect(comparison.referenceRange, `100W ${probe} non-hollow`).toBeGreaterThan(50);
        memberNotes.push(
          `${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(2)}`,
        );
      }
      cells.push({
        analysis: "tran",
        circuit: "edu-100w",
        topology: "Educational 100W.asc IRFP240/IRFP9240 amp (authored .tran 10m; .param V=1.44; .step stripped)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- LTspice.app help ACstep.asc authored .ac list + .step C (≠ Educational stepAC) ---
    // Authored `.ac list 1Meg` (Tau lacks list) → same-deck dec 100k–10Meg stand-in like
    // stepnoise list→band. `.step oct param C 20p…` → first member C=20p via buildParamScope.
    // Series RLC to Z: I1 AC 1 + C{C} + L=90µ + R=5k. v(z) nRms≈1e-9 span≈4.8k @ 2%/5%.
    // Left Resources Draft1 / Butterworth / 100W / ISO / IGBTeq alone. Tip 100W pass=80 → 81.
    {
      expect(existsSync(HELP_ACSTEP_ASC), `missing ${HELP_ACSTEP_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(HELP_ACSTEP_ASC)));
      expect(imported.warnings).toEqual([]);
      expect(imported.foreignSymbols).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      expect(dirs.some((d) => /\.ac\s+list\s+1\s*meg\b/i.test(d))).toBe(true);
      expect(dirs.some((d) => /\.step\s+oct\s+param\s+C\b/i.test(d))).toBe(true);
      const params = buildParamScope(dirs);
      expect(Number(params.scope.C ?? params.scope.c)).toBeCloseTo(20e-12, 20);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "ac",
        startHz: 100e3,
        stopHz: 10e6,
        pointsPerDecade: 20,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^C5\b.+\b2e-11\b/im);
      expect(deck.netlist).toMatch(/^L2\b/im);
      expect(deck.netlist).toMatch(/^R2\b.+\b5000\b/im);
      expect(deck.netlist).toMatch(/^I1\b.+\bAC\b/im);
      expect(deck.netlist).toMatch(/\.ac\b/i);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      const result = runPairedBatch("diff-help-acstep-ac", deck.netlist, ["v(z)"]);
      const lt = result.ltspice.get("v(z)")!;
      const ng = result.ngspice.get("v(z)")!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(comparison.pass, `help-ACstep ${JSON.stringify(comparison)}`).toBe(true);
      expect(comparison.referenceRange, "help-ACstep non-hollow").toBeGreaterThan(100);
      expect(comparison.samples, "help-ACstep samples").toBeGreaterThan(20);
      cells.push({
        analysis: "ac",
        circuit: "help-acstep",
        topology: "LTspice.app help ACstep.asc series RLC (.ac list 1Meg→dec 100k–10Meg; .step C first=20p; ≠ Educational stepAC)",
        status: "pass",
        note: `v(z) nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(1)} (list→band; C=20p)`,
      });
    }

    // --- LTspice.app help NoiseStep.asc authored .noise list + .step R (≠ Educational stepnoise) ---
    // Same CE-pair + 2N2222 topology as Educational/stepnoise.asc but distinct help path.
    // Authored `.NOISE … list 10K` (Tau lacks list) → 9.5–10.5 kHz band stand-in; `.step
    // oct param R` → first R=500. Resources sinh (.dc±1.01 log domain) and divide2/inverter
    // (.machine) remain honest walls. Left ACstep/Butterworth/Draft1/100W alone.
    // Tip help-ACstep pass=81 → 82.
    {
      expect(existsSync(HELP_NOISESTEP_ASC), `missing ${HELP_NOISESTEP_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(HELP_NOISESTEP_ASC)));
      expect(imported.warnings).toEqual([]);
      expect(imported.foreignSymbols).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      expect(dirs.some((d) => /\.noise\b/i.test(d) && /\blist\b/i.test(d) && /10\s*k/i.test(d))).toBe(true);
      expect(dirs.some((d) => /\.step\s+oct\s+param\s+R\b/i.test(d))).toBe(true);
      const params = buildParamScope(dirs);
      expect(Number(params.scope.R ?? params.scope.r)).toBeCloseTo(500, 10);
      expect(Number(params.scope.V ?? params.scope.v)).toBeCloseTo(15, 10);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "noise",
        output: { node: "out+", refNode: "out-" },
        source: "V1",
        startHz: 9.5e3,
        stopHz: 10.5e3,
        pointsPerDecade: 10,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/\.model\s+2N2222\s+NPN\b/i);
      expect(deck.netlist).toMatch(/\.noise\s+v\(out\+,out-\)\s+V1\b/i);
      const qLines = deck.netlist.split(/\r?\n/).filter((line) => /^Q\w*\b/i.test(line.trim()));
      expect(qLines.length).toBeGreaterThanOrEqual(2);
      for (const line of qLines) {
        expect(line, line).toMatch(/\b2N2222\b/);
        expect(line, line).not.toMatch(/\bTAU_NPN\b/);
      }
      const result = runPairedBatch("diff-help-noisestep-noise", deck.netlist, [], {
        skipSave: true,
        extract: ["V(onoise)", "V(inoise)"],
        ngspiceAliases: {
          "V(onoise)": "onoise_spectrum",
          "V(inoise)": "inoise_spectrum",
        },
      });
      const memberNotes: string[] = [];
      for (const probe of ["V(onoise)", "V(inoise)"] as const) {
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `help-NoiseStep ${probe} ${JSON.stringify(comparison)}`).toBe(true);
        expect(lt.values[0]!, `${probe} lt hollow`).toBeGreaterThan(0);
        expect(ng.values[0]!, `${probe} ng hollow`).toBeGreaterThan(0);
        memberNotes.push(
          `${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)}`,
        );
      }
      cells.push({
        analysis: "noise",
        circuit: "help-noisestep",
        topology: "LTspice.app help NoiseStep.asc CE pair + 2N2222 (.noise list 10K→9.5–10.5k; .step R first=500; ≠ Educational stepnoise)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- LTspice.app Resources MicroCode.asc authored .tran (BI Value+Value2 join) ---
    // Authored `.tran 0 1m 0 1u` + gm1/gm2/Ibias params. Two BI pairs: soft-limit
    // uplim/dnlim (B1/B2) and split `I=if(…` across Value/Value2 (B1b/B2b). Import
    // joins bsource Value2 like vsource AC (ascImport SOURCE_KINDS). Probes
    // v(out)/v(out2) nRms≈6e-6 @ 2%/5%. mextram has no authored analysis (defer).
    // Left help NoiseStep/ACstep/Butterworth/Draft1/100W/sinh/.machine alone.
    // Tip help-NoiseStep pass=82 → 83.
    {
      expect(existsSync(RESOURCES_MICROCODE_ASC), `missing ${RESOURCES_MICROCODE_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(RESOURCES_MICROCODE_ASC)));
      expect(imported.warnings).toEqual([]);
      expect(imported.foreignSymbols).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.tran, "MicroCode.asc must author .tran").toBeTruthy();
      const params = buildParamScope(dirs);
      expect(Number(params.scope.gm1 ?? params.scope.Gm1)).toBeCloseTo(1e-3, 12);
      const bSources = imported.components.filter((c) => c.kind === "bsource");
      expect(bSources.length).toBeGreaterThanOrEqual(4);
      expect(bSources.some((b) => /I=if\(V\(m,i\)>=0,/i.test(b.value) && /,\s*0\)\s*$/.test(b.value))).toBe(true);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: Math.max(parsed.tran!.steps ?? 240, 2000),
        startTime: parsed.tran!.startTime,
        maxStep: parsed.tran!.maxStep,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      // ltFuncsToNgspice rewrites LTspice if() → ngspice ternary; Value2 join must
      // still yield a complete B1b/B2b line (not a truncated `I=if(V(m,i)>=0,`).
      expect(deck.netlist).toMatch(/^B1b\b.+\?\s*\(/im);
      expect(deck.netlist).toMatch(/^B2b\b.+\?\s*\(/im);
      expect(deck.netlist).not.toMatch(/^B1b\b.*I=if\(V\(m,i\)>=0,\s*$/im);
      expect(deck.netlist).toMatch(/\.tran\b/i);
      const probes = ["v(out)", "v(out2)"] as const;
      const result = runPairedBatch("diff-resources-microcode-tran", deck.netlist, [...probes]);
      const memberNotes: string[] = [];
      for (const probe of probes) {
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `MicroCode ${probe} ${JSON.stringify(comparison)}`).toBe(true);
        expect(comparison.referenceRange, `MicroCode ${probe} non-hollow`).toBeGreaterThan(5);
        memberNotes.push(
          `${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(2)}`,
        );
      }
      cells.push({
        analysis: "tran",
        circuit: "resources-microcode",
        topology: "LTspice.app Resources/MicroCode.asc BI soft-limit + split if( Value/Value2 (authored .tran 1m)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Circuit_testing_v1/08_tran_rlc_ringing.asc authored .tran (underdamped RLC) ---
    // Tau-owned ASC stress fixture: V1 PULSE + R=10 + L=100u + C=100n. Authored
    // `.tran 100n 2m` + `.meas tran Vpp PP V(out)`. Distinct from synthetic RC_TRAN
    // and Educational transformers. Pure R/L/C — zero unresolved / substitutions.
    // Default 2%/5%: v(out) nRms≈8e-4 span≈11. Left 100W/IRFP/named-device /
    // MicroCode/help/ISO7637 alone. Tip MicroCode pass=83 → **pass=84**.
    {
      expect(existsSync(CT_RLC_RINGING_ASC), `missing ${CT_RLC_RINGING_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(CT_RLC_RINGING_ASC)));
      expect(imported.warnings).toEqual([]);
      expect(imported.foreignSymbols).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.tran, "08_tran_rlc_ringing.asc must author .tran").toBeTruthy();
      expect(dirs.some((d) => /^\.meas\b/i.test(d))).toBe(true);
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: Math.max(parsed.tran!.steps ?? 240, 2000),
        startTime: parsed.tran!.startTime,
        maxStep: parsed.tran!.maxStep,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^V1\b/im);
      expect(deck.netlist).toMatch(/^R1\b.+\b10\b/im);
      expect(deck.netlist).toMatch(/^L1\b/im);
      expect(deck.netlist).toMatch(/^C1\b/im);
      expect(deck.netlist).toMatch(/\.tran\b/i);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      const probes = ["v(out)", "v(in)"] as const;
      const result = runPairedBatch("diff-ct-rlc-ringing-tran", deck.netlist, [...probes]);
      const memberNotes: string[] = [];
      for (const probe of probes) {
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `ct-rlc-ringing ${probe} ${JSON.stringify(comparison)}`).toBe(true);
        expect(comparison.referenceRange, `ct-rlc-ringing ${probe} non-hollow`).toBeGreaterThan(4);
        memberNotes.push(
          `${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
        );
      }
      cells.push({
        analysis: "tran",
        circuit: "ct-rlc-ringing",
        topology: "Circuit_testing_v1/08_tran_rlc_ringing.asc underdamped RLC (authored .tran 100n–2m; .meas Vpp)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Circuit_testing_v1/04_dc_diode_curve.asc authored .dc (1N4148 I–V) ---
    // Tau-owned ASC: V1 + R=1k + D1=1N4148 to GND. Authored `.dc V1 0 1 20m`.
    // Exact standardModels 1N4148 (Is=2.52n …) — zero unresolved / substitutions.
    // Distinct from synthetic resistive divider DC and IGBTeq nested DC.
    // Default 2%/5%: v(anode)/i(v1) nRms≈1e-6. Left 100W/IRFP/named-device /
    // ct-rlc / MicroCode / ISO7637 alone. Tip ct-rlc pass=84 → **pass=85**.
    {
      expect(existsSync(CT_DIODE_DC_ASC), `missing ${CT_DIODE_DC_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(CT_DIODE_DC_ASC)));
      expect(imported.warnings).toEqual([]);
      expect(imported.foreignSymbols).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.dc, "04_dc_diode_curve.asc must author .dc").toBeTruthy();
      expect(parsed.dc!.source2, "04_dc_diode_curve must be single-source .dc").toBeFalsy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "dc",
        source: parsed.dc!.source,
        start: parsed.dc!.start,
        stop: parsed.dc!.stop,
        step: parsed.dc!.step,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/\.model\s+1N4148\s+D\b/i);
      expect(deck.netlist).toMatch(/^D1\b.+\b1N4148\b/im);
      expect(deck.netlist).toMatch(/^R1\b.+\b1000\b/im);
      expect(deck.netlist).toMatch(/\.dc\s+V1\b/i);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      const probes = ["v(anode)", "i(v1)"] as const;
      const result = runPairedBatch("diff-ct-diode-dc", deck.netlist, [...probes]);
      const memberNotes: string[] = [];
      for (const probe of probes) {
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `ct-diode-dc ${probe} ${JSON.stringify(comparison)}`).toBe(true);
        expect(comparison.referenceRange, `ct-diode-dc ${probe} non-hollow`).toBeGreaterThan(
          probe.startsWith("i(") ? 1e-4 : 0.3,
        );
        memberNotes.push(
          `${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
        );
      }
      cells.push({
        analysis: "dc",
        circuit: "ct-diode-dc",
        topology: "Circuit_testing_v1/04_dc_diode_curve.asc 1N4148 + 1k (authored .dc V1 0–1 @ 20m)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Circuit_testing_v1/05_step_loaded_divider.asc authored .dc + .step param LOAD ---
    // Tau-owned ASC: V1 + R1=1k series + RLOAD={LOAD} to GND. Authored
    // `.step param LOAD 1k 10k 3k` + `.dc V1 0 5 250m`. Expand LOAD to
    // 1k/4k/7k/10k (strip .step; bake each into .param) — same honest pattern
    // as steptemp / source-step OP. Pure resistive; zero models/subckts.
    // Distinct from synthetic divider DC (no step), source-step OP (no DC
    // sweep), and help ACstep (AC + C). Left diode-dc / 100W/IRFP / Draft* /
    // ISO7637 alone. Tip ct-diode pass=85 → **pass=86**.
    {
      expect(existsSync(CT_STEP_LOADED_ASC), `missing ${CT_STEP_LOADED_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(CT_STEP_LOADED_ASC)));
      expect(imported.warnings).toEqual([]);
      expect(imported.foreignSymbols).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      expect(dirs.some((d) => /\.step\s+param\s+LOAD\b/i.test(d))).toBe(true);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.dc, "05_step_loaded_divider.asc must author .dc").toBeTruthy();
      expect(parsed.dc!.source2, "05_step_loaded_divider must be single-source .dc").toBeFalsy();
      const loads = [1e3, 4e3, 7e3, 10e3] as const;
      const memberNotes: string[] = [];
      for (const load of loads) {
        const withParam = dirs
          .filter((d) => !/^\.step\b/i.test(d.trim()))
          .map((d) => (/^\.param\b/i.test(d.trim()) ? `.param LOAD=${load}` : d));
        const params = buildParamScope(withParam);
        expect(Number(params.scope.LOAD ?? params.scope.load), `LOAD=${load}`).toBeCloseTo(load, 6);
        const deck = buildSpiceDeck({
          components: imported.components,
          wires: imported.wires,
          netLabels: imported.netLabels,
          directives: withParam,
          params,
        }, {
          kind: "dc",
          source: parsed.dc!.source,
          start: parsed.dc!.start,
          stop: parsed.dc!.stop,
          step: parsed.dc!.step,
        });
        expect(deck.unresolvedSubckts ?? [], `ct-step-loaded LOAD=${load}`).toEqual([]);
        expect(deck.modelSubstitutions ?? [], `ct-step-loaded LOAD=${load}`).toEqual([]);
        expect(deck.netlist).toMatch(new RegExp(`^RLOAD\\b.+\\b${load}\\b`, "im"));
        expect(deck.netlist).toMatch(/^R1\b.+\b1000\b/im);
        expect(deck.netlist).toMatch(/\.dc\s+V1\b/i);
        expect(deck.netlist).not.toMatch(/^X\w*\b/im);
        expect(deck.netlist).not.toMatch(/^\.step\b/im);
        const result = runPairedBatch(`diff-ct-step-loaded-${load}`, deck.netlist, ["v(out)"]);
        const lt = result.ltspice.get("v(out)")!;
        const ng = result.ngspice.get("v(out)")!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `ct-step-loaded LOAD=${load} ${JSON.stringify(comparison)}`).toBe(true);
        expect(comparison.referenceRange, `ct-step-loaded LOAD=${load} non-hollow`).toBeGreaterThan(1);
        memberNotes.push(
          `LOAD=${load} v(out) nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
        );
      }
      cells.push({
        analysis: "dc",
        circuit: "ct-step-loaded",
        topology: "Circuit_testing_v1/05_step_loaded_divider.asc R1=1k + RLOAD stepped 1k…10k/3k (authored .dc V1 0–5 @ 250m; .step expanded)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Circuit_testing_v1/07_noise_rc_lowpass.asc authored .noise (RC thermal) ---
    // Tau-owned ASC: V1 AC 1 + R1=10k + C1=10n to GND. Authored
    // `.noise V(out) V1 dec 16 10 1Meg`. Pure RC; zero models/subckts.
    // Probe V(onoise) only — ideal V1 makes inoise hollow (span≈0), same as
    // synthetic DIVIDER_NOISE which also extracts onoise alone. Distinct from
    // resistive divider noise (no C; 1–1k), NoiseFigure/noise.asc/stepnoise
    // (BJT), and help NoiseStep (.step R). Left step-loaded / 100W/IRFP /
    // Documents Draft* / ISO7637 alone. Tip ct-step-loaded pass=86 → **pass=87**.
    {
      expect(existsSync(CT_NOISE_RC_ASC), `missing ${CT_NOISE_RC_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(CT_NOISE_RC_ASC)));
      expect(imported.warnings).toEqual([]);
      expect(imported.foreignSymbols).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.noise, "07_noise_rc_lowpass.asc must author .noise").toBeTruthy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "noise",
        output: { node: parsed.noise!.output.pos, refNode: parsed.noise!.output.neg },
        source: parsed.noise!.source,
        startHz: parsed.noise!.sweep.startHz,
        stopHz: parsed.noise!.sweep.stopHz,
        pointsPerDecade: parsed.noise!.sweep.pointsPerDecade,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^R1\b.+\b10000\b/im);
      expect(deck.netlist).toMatch(/^C1\b.+\b1e-8\b/im);
      expect(deck.netlist).toMatch(/\.noise\s+v\(out\)\s+V1\s+dec\s+16\s+10\s+1000000\b/i);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      expect(deck.netlist).not.toMatch(/^\.model\b/im);
      const result = runPairedBatch("diff-ct-noise-rc", deck.netlist, [], {
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
      expect(comparison.pass, `ct-noise-rc ${JSON.stringify(comparison)}`).toBe(true);
      // Thermal roll-off across 10–1Meg; absolute density ~nV/√Hz so span is tiny.
      expect(comparison.referenceRange, "ct-noise-rc onoise non-hollow").toBeGreaterThan(1e-12);
      cells.push({
        analysis: "noise",
        circuit: "ct-noise-rc",
        topology: "Circuit_testing_v1/07_noise_rc_lowpass.asc R=10k C=10n (authored .noise V(out) V1 dec 16 10–1Meg)",
        status: "pass",
        note: `V(onoise) nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toExponential(2)}`,
      });
    }

    // --- Circuit_testing_v1/03_ac_rc_lowpass.asc authored .ac (RC Bode) ---
    // Tau-owned ASC: V1 AC 1 + R1=1k + C1=100n to GND. Authored
    // `.ac dec 24 10 1Meg`. Pure RC; zero models/subckts. Distinct from
    // synthetic RC_AC (C=1u, dec 10, stop 100k), ct 07_noise (R=10k C=10n
    // .noise), and Educational butter/elip/Cohn. Default 2%/5%. Left
    // 100W/IRFP / Documents Draft* / Settings alone. Tip ct-noise pass=87 → **pass=88**.
    {
      expect(existsSync(CT_AC_RC_ASC), `missing ${CT_AC_RC_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(CT_AC_RC_ASC)));
      expect(imported.warnings).toEqual([]);
      expect(imported.foreignSymbols).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.ac, "03_ac_rc_lowpass.asc must author .ac").toBeTruthy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "ac",
        startHz: parsed.ac!.startHz,
        stopHz: parsed.ac!.stopHz,
        pointsPerDecade: parsed.ac!.pointsPerDecade,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^V1\b.*\bAC\b/im);
      expect(deck.netlist).toMatch(/^R1\b.+\b1000\b/im);
      expect(deck.netlist).toMatch(/^C1\b.+\b1(?:\.0+0*1)?e-7\b/im);
      expect(deck.netlist).toMatch(/\.ac\s+dec\s+24\s+10\s+1000000\b/i);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      expect(deck.netlist).not.toMatch(/^\.model\b/im);
      // Probe v(out) only — v(in) is flat AC stimulus (hollow span), same as
      // synthetic RC_AC / 2ndOrder* AC cells.
      const result = runPairedBatch("diff-ct-ac-rc", deck.netlist, ["v(out)"]);
      const lt = result.ltspice.get("v(out)")!;
      const ng = result.ngspice.get("v(out)")!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(comparison.pass, `ct-ac-rc ${JSON.stringify(comparison)}`).toBe(true);
      expect(comparison.referenceRange, "ct-ac-rc v(out) non-hollow").toBeGreaterThan(0.1);
      cells.push({
        analysis: "ac",
        circuit: "ct-ac-rc",
        topology: "Circuit_testing_v1/03_ac_rc_lowpass.asc R=1k C=100n (authored .ac dec 24 10–1Meg)",
        status: "pass",
        note: `v(out) nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
      });
    }

    // --- Circuit_testing_v1/06_tf_voltage_divider.asc authored .tf (1:1 resistive) ---
    // Tau-owned ASC: V1=0 + R1=1k + R2=1k. Authored `.tf V(out) V1`. Expected
    // gain 0.5 / Rin 2k / Rout 500Ω. Distinct from synthetic DIVIDER_TF
    // (hand-written netlist, V1=5) and class-d injected `.tf` — this cell
    // proves importAsc → buildSpiceDeck → paired TF on an authored ASC.
    // Left 100W/IRFP / Documents Draft* / Settings alone. Tip ct-ac pass=88 → **pass=89**.
    {
      expect(existsSync(CT_TF_DIVIDER_ASC), `missing ${CT_TF_DIVIDER_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(CT_TF_DIVIDER_ASC)));
      expect(imported.warnings).toEqual([]);
      expect(imported.foreignSymbols).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.tf, "06_tf_voltage_divider.asc must author .tf").toBeTruthy();
      expect(parsed.tf!.source.toUpperCase()).toBe("V1");
      expect(parsed.tf!.output.kind).toBe("voltage");
      const params = buildParamScope(dirs);
      const outNode =
        parsed.tf!.output.kind === "voltage" ? parsed.tf!.output.pos : "out";
      const outRef =
        parsed.tf!.output.kind === "voltage" ? parsed.tf!.output.neg : undefined;
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "tf",
        output: { kind: "voltage", node: outNode, refNode: outRef },
        source: parsed.tf!.source,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^V1\b/im);
      expect(deck.netlist).toMatch(/^R1\b.+\b1000\b/im);
      expect(deck.netlist).toMatch(/^R2\b.+\b1000\b/im);
      expect(deck.netlist).toMatch(/\.tf\s+v\(out\)\s+V1\b/i);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      expect(deck.netlist).not.toMatch(/^\.model\b/im);
      const result = runPairedTransferFunction("diff-ct-tf-divider", deck.netlist);
      const ltGain = pickScalar(result.ltspice, ["transfer_function"]);
      const ngGain = pickScalar(result.ngspice, ["transfer_function"]);
      const ltRin = pickScalar(result.ltspice, ["v1#input_impedance"]);
      const ngRin = pickScalar(result.ngspice, ["v1#input_impedance"]);
      const ltRout = pickScalar(result.ltspice, ["output_impedance_at_v(out)"]);
      const ngRout = pickScalar(result.ngspice, ["output_impedance_at_v(out)"]);
      const gainRel = relativeError(ngGain, ltGain);
      const rinRel = relativeError(ngRin, ltRin);
      const routRel = relativeError(ngRout, ltRout);
      expect(gainRel, `ct-tf gain lt=${ltGain} ng=${ngGain}`).toBeLessThanOrEqual(1e-6);
      expect(rinRel, `ct-tf Rin lt=${ltRin} ng=${ngRin}`).toBeLessThanOrEqual(1e-6);
      expect(routRel, `ct-tf Rout lt=${ltRout} ng=${ngRout}`).toBeLessThanOrEqual(1e-6);
      expect(ngGain).toBeCloseTo(0.5, 6);
      expect(ngRin).toBeCloseTo(2000, 4);
      expect(ngRout).toBeCloseTo(500, 4);
      cells.push({
        analysis: "tf",
        circuit: "ct-tf-divider",
        topology: "Circuit_testing_v1/06_tf_voltage_divider.asc R1=R2=1k (authored .tf V(out) V1)",
        status: "pass",
        note: `gain/Rin/Rout relErr<=1e-6 (gain≈${ngGain}, Rin≈${ngRin}, Rout≈${ngRout})`,
      });
    }

    // --- Circuit_testing_v1/01_op_voltage_divider.asc authored .op (2:1 resistive) ---
    // Tau-owned ASC: V1=5 + R1=1k + R2=2k. Authored `.op`. Expected V(out)=10/3.
    // Distinct from synthetic DIVIDER_OP (1:1 → 2.5 V hand netlist) and ct
    // 06_tf (R1=R2=1k .tf) / 05_step_loaded (.dc+.step) — proves importAsc →
    // buildSpiceDeck → paired OP on an authored ASC.
    // Left 100W/IRFP / Documents Draft* / Settings alone. Tip ct-tf pass=89 → **pass=90**.
    {
      expect(existsSync(CT_OP_DIVIDER_ASC), `missing ${CT_OP_DIVIDER_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(CT_OP_DIVIDER_ASC)));
      expect(imported.warnings).toEqual([]);
      expect(imported.foreignSymbols).toEqual([]);
      expect(
        imported.directives.some((d) => /^\.op\b/i.test(d.trim())),
        "01_op_voltage_divider.asc must author .op",
      ).toBe(true);
      const params = buildParamScope(imported.directives);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: imported.directives,
        params,
      }, { kind: "op" });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^V1\b.+\b5\b/im);
      expect(deck.netlist).toMatch(/^R1\b.+\b1000\b/im);
      expect(deck.netlist).toMatch(/^R2\b.+\b2000\b/im);
      expect(deck.netlist).toMatch(/\.op\b/i);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      expect(deck.netlist).not.toMatch(/^\.model\b/im);
      const result = runPairedBatch("diff-ct-op-divider", deck.netlist, ["v(out)"]);
      const lt = firstSample(result.ltspice.get("v(out)")!);
      const ng = firstSample(result.ngspice.get("v(out)")!);
      expect(Number.isFinite(lt) && Number.isFinite(ng)).toBe(true);
      expect(relativeError(ng, lt), `ct-op V(out) lt=${lt} ng=${ng}`).toBeLessThanOrEqual(1e-6);
      expect(ng).toBeCloseTo(10 / 3, 6);
      cells.push({
        analysis: "op",
        circuit: "ct-op-divider",
        topology: "Circuit_testing_v1/01_op_voltage_divider.asc R1=1k R2=2k (authored .op)",
        status: "pass",
        note: `V(out) lt=${lt} ng=${ng} relErr<=1e-6 (≈${(10 / 3).toFixed(4)} V)`,
      });
    }

    // --- Circuit_testing_v1/02_tran_rc_pulse_meas.asc authored .tran + .meas ---
    // Tau-owned ASC: V1 PULSE(0 5 0 1u 1u 5m 10m) + R=1k + C=1u (τ=1 ms).
    // Authored `.tran 10u 30m` + `.meas Vmax MAX V(out)` / `Vavg AVG … FROM=20m TO=30m`.
    // Distinct from synthetic RC_TRAN (1 V / 5 ms / no ASC), RC .meas hand-netlist,
    // and ct 08 RLC ringing — proves importAsc → buildSpiceDeck → paired TRAN +
    // Tau measure.ts vs LTspice log on authored ASC .meas. Left 100W/IRFP /
    // Documents Draft* / Settings alone. Tip ct-op pass=90 → **pass=91**.
    {
      expect(existsSync(CT_TRAN_RC_PULSE_ASC), `missing ${CT_TRAN_RC_PULSE_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(CT_TRAN_RC_PULSE_ASC)));
      expect(imported.warnings).toEqual([]);
      expect(imported.foreignSymbols).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.tran, "02_tran_rc_pulse_meas.asc must author .tran").toBeTruthy();
      const measLines = dirs.filter((d) => /^\.meas\b/i.test(d.trim()));
      expect(measLines.length, "02_tran_rc_pulse_meas.asc must author .meas").toBeGreaterThanOrEqual(2);
      expect(measLines.some((d) => /\bvmax\b/i.test(d))).toBe(true);
      expect(measLines.some((d) => /\bvavg\b/i.test(d))).toBe(true);
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: Math.max(parsed.tran!.steps ?? 240, 3000),
        startTime: parsed.tran!.startTime,
        maxStep: parsed.tran!.maxStep,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^V1\b.+\bPULSE\b/im);
      expect(deck.netlist).toMatch(/^R1\b.+\b1000\b/im);
      expect(deck.netlist).toMatch(/^C1\b.+\b0\.000001\b/im);
      expect(deck.netlist).toMatch(/\.tran\b/i);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      expect(deck.netlist).not.toMatch(/^\.model\b/im);
      const probes = ["v(out)", "v(in)"] as const;
      const result = runPairedBatch("diff-ct-rc-pulse-tran", deck.netlist, [...probes], {
        measurements: measLines,
      });
      const memberNotes: string[] = [];
      for (const probe of probes) {
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `ct-rc-pulse ${probe} ${JSON.stringify(comparison)}`).toBe(true);
        expect(comparison.referenceRange, `ct-rc-pulse ${probe} non-hollow`).toBeGreaterThan(1);
        memberNotes.push(
          `${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
        );
      }
      const out = result.ngspice.get("v(out)")!;
      const tauMeas = runMeasurements(measLines, {
        times: out.axis,
        traces: [{ id: "out", label: "V(out)", values: out.values }],
      });
      const byName = (name: string) =>
        tauMeas.find((row) => row.name.toLowerCase() === name.toLowerCase())?.value;
      const ltVmax = measurementValue(result.ltspiceLog, "vmax");
      const ltVavg = measurementValue(result.ltspiceLog, "vavg");
      const ngVmax = byName("vmax");
      const ngVavg = byName("vavg");
      expect(ngVmax, JSON.stringify(tauMeas)).toEqual(expect.any(Number));
      expect(ngVavg, JSON.stringify(tauMeas)).toEqual(expect.any(Number));
      expect(relativeError(ngVmax!, ltVmax), `ct-rc-pulse Vmax lt=${ltVmax} ng=${ngVmax}`).toBeLessThanOrEqual(0.02);
      expect(relativeError(ngVavg!, ltVavg), `ct-rc-pulse Vavg lt=${ltVavg} ng=${ngVavg}`).toBeLessThanOrEqual(0.02);
      memberNotes.push(
        `Vmax lt=${ltVmax.toFixed(4)} ng=${ngVmax!.toFixed(4)}; Vavg lt=${ltVavg.toFixed(4)} ng=${ngVavg!.toFixed(4)}`,
      );
      cells.push({
        analysis: "tran",
        circuit: "ct-rc-pulse-meas",
        topology: "Circuit_testing_v1/02_tran_rc_pulse_meas.asc R=1k C=1u PULSE 5 V (authored .tran 10u–30m; .meas Vmax/Vavg)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Circuit_testing_v1/11_stress_rc_ladder.asc authored .ac (eight-pole RC) ---
    // Tau-owned ASC: V1 PULSE+AC 1 + R1…R8=1k series + C1…C8=10n to GND.
    // Authored `.ac dec 12 10 1Meg` (also authors .op/.tran — this cell proves AC).
    // Distinct from ct 03 single-pole R=1k C=100n and synthetic RC_AC (C=1u).
    // Pure R/C — zero models/subckts. Left Staff EE step-PNG / 100W/IRFP /
    // Documents Draft* / Settings alone. Tip ct-rc-pulse pass=91 → **pass=92**.
    {
      expect(existsSync(CT_STRESS_RC_LADDER_ASC), `missing ${CT_STRESS_RC_LADDER_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(CT_STRESS_RC_LADDER_ASC)));
      expect(imported.warnings).toEqual([]);
      expect(imported.foreignSymbols).toEqual([]);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.ac, "11_stress_rc_ladder.asc must author .ac").toBeTruthy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "ac",
        startHz: parsed.ac!.startHz,
        stopHz: parsed.ac!.stopHz,
        pointsPerDecade: parsed.ac!.pointsPerDecade,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^V1\b.*\bAC\b/im);
      expect(deck.netlist).toMatch(/^R1\b.+\b1000\b/im);
      expect(deck.netlist).toMatch(/^R8\b.+\b1000\b/im);
      expect(deck.netlist).toMatch(/^C1\b.+\b1(?:\.0+0*1)?e-8\b/im);
      expect(deck.netlist).toMatch(/^C8\b.+\b1(?:\.0+0*1)?e-8\b/im);
      expect(deck.netlist).toMatch(/\.ac\s+dec\s+12\s+10\s+1000000\b/i);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      expect(deck.netlist).not.toMatch(/^\.model\b/im);
      // Probe v(out) only — v(in) is flat AC stimulus (hollow span).
      const result = runPairedBatch("diff-ct-stress-rc-ladder-ac", deck.netlist, ["v(out)"]);
      const lt = result.ltspice.get("v(out)")!;
      const ng = result.ngspice.get("v(out)")!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(comparison.pass, `ct-stress-rc-ladder ${JSON.stringify(comparison)}`).toBe(true);
      expect(comparison.referenceRange, "ct-stress-rc-ladder v(out) non-hollow").toBeGreaterThan(0.1);
      cells.push({
        analysis: "ac",
        circuit: "ct-stress-rc-ladder",
        topology: "Circuit_testing_v1/11_stress_rc_ladder.asc 8×R=1k 8×C=10n (authored .ac dec 12 10–1Meg)",
        status: "pass",
        note: `v(out) nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
      });
    }

    // --- Circuit_testing_v1/16_active_fourth_order_filter.asc authored .ac (4× buffered RC) ---
    // Tau-owned ASC: VIN AC 1 + four cascaded R=1k/C=100n poles, each buffered by
    // opamp2 Avol=1Meg (Tau rail-clamped tanh B_U*) + RLOAD=10k. Authored
    // `.ac dec 40 10 1Meg`. Distinct from Educational opamp.asc (opamp.sub state-
    // variable), Linkwitz, ct 03 single-pole RC, and ct 11 passive 8-pole ladder.
    // Exact behavioral path — zero unresolved / substitutions. ct 19 INA .op
    // deferred (LTspice OP fails to converge on same-deck tanh B_U* netlist).
    // Left 100W/IRFP / Documents Draft* / Settings alone. Tip ct-stress pass=92 → **pass=93**.
    {
      expect(existsSync(CT_ACTIVE_FOURTH_ORDER_ASC), `missing ${CT_ACTIVE_FOURTH_ORDER_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(CT_ACTIVE_FOURTH_ORDER_ASC)));
      expect(imported.warnings).toEqual([]);
      expect(imported.foreignSymbols).toEqual([]);
      expect(imported.components.filter((c) => c.kind === "opamp")).toHaveLength(4);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.ac, "16_active_fourth_order_filter.asc must author .ac").toBeTruthy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "ac",
        startHz: parsed.ac!.startHz,
        stopHz: parsed.ac!.stopHz,
        pointsPerDecade: parsed.ac!.pointsPerDecade,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^VIN\b.*\bAC\b/im);
      expect(deck.netlist).toMatch(/^R1\b.+\b1000\b/im);
      expect(deck.netlist).toMatch(/^C1\b.+\b1(?:\.0+0*1)?e-7\b/im);
      expect(deck.netlist).toMatch(/^C4\b.+\b1(?:\.0+0*1)?e-7\b/im);
      expect(deck.netlist).toMatch(/B_U1\b/i);
      expect(deck.netlist).toMatch(/B_U4\b/i);
      expect(deck.netlist).toMatch(/tanh\s*\(/i);
      expect(deck.netlist).toMatch(/\.ac\s+dec\s+40\s+10\s+1000000\b/i);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      expect(deck.netlist).not.toMatch(/^\.model\b/im);
      // Probe v(out) only — VIN is flat AC stimulus (hollow span).
      const result = runPairedBatch("diff-ct-active-fourth-order-ac", deck.netlist, ["v(out)"]);
      const lt = result.ltspice.get("v(out)")!;
      const ng = result.ngspice.get("v(out)")!;
      const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(comparison.pass, `ct-active-fourth-order ${JSON.stringify(comparison)}`).toBe(true);
      expect(comparison.referenceRange, "ct-active-fourth-order v(out) non-hollow").toBeGreaterThan(0.1);
      cells.push({
        analysis: "ac",
        circuit: "ct-active-fourth-order",
        topology: "Circuit_testing_v1/16_active_fourth_order_filter.asc 4×R=1k/C=100n + opamp2 Avol (authored .ac dec 40 10–1Meg)",
        status: "pass",
        note: `v(out) nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
      });
    }

    // --- Circuit_testing_v1/18_full_bridge_power_supply.asc authored .tran + .meas ---
    // Tau-owned ASC: VAC SINE(0 17 60) + four 1N4007 bridge diodes + C=2200u
    // Rser=80m reservoir + RLOAD=100. Authored `.tran 20u 120m` + `.meas
    // VDC_AVG/VDC_PP … FROM=80m TO=120m`. Exact standardModels 1N4007 — zero
    // unresolved / substitutions. Distinct from ct 04 1N4148 DC I–V, Documents
    // Draft1 diode–L–R TRAN, and ct 17 three-phase RLC feeder. ct 19 INA .op
    // still deferred (LTspice OP fails same-deck tanh). Left 100W/IRFP /
    // Documents Draft* / Settings / ct 12–15 alone. Tip ct-active pass=93 → **pass=94**.
    {
      expect(existsSync(CT_FULL_BRIDGE_ASC), `missing ${CT_FULL_BRIDGE_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(CT_FULL_BRIDGE_ASC)));
      expect(imported.warnings).toEqual([]);
      expect(imported.foreignSymbols).toEqual([]);
      expect(imported.components.filter((c) => c.kind === "diode")).toHaveLength(4);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.tran, "18_full_bridge_power_supply.asc must author .tran").toBeTruthy();
      const measLines = dirs.filter((d) => /^\.meas\b/i.test(d.trim()));
      expect(measLines.length, "18_full_bridge must author .meas").toBeGreaterThanOrEqual(2);
      expect(measLines.some((d) => /\bvdc_avg\b/i.test(d))).toBe(true);
      expect(measLines.some((d) => /\bvdc_pp\b/i.test(d))).toBe(true);
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: Math.max(parsed.tran!.steps ?? 240, 5000),
        startTime: parsed.tran!.startTime,
        maxStep: parsed.tran!.maxStep,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/\.model\s+1N4007\s+D\b/i);
      expect(deck.netlist).toMatch(/^VAC\b.+\bSIN\(/im);
      expect(deck.netlist).toMatch(/^D1\b.+\b1N4007\b/im);
      expect(deck.netlist).toMatch(/^D4\b.+\b1N4007\b/im);
      expect(deck.netlist).toMatch(/^C1\b.+\bvdc\b/im);
      expect(deck.netlist).toMatch(/^RLOAD\b.+\b100\b/im);
      expect(deck.netlist).toMatch(/\.tran\b/i);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      const probes = ["v(vdc)", "v(ac1)"] as const;
      const result = runPairedBatch("diff-ct-full-bridge-tran", deck.netlist, [...probes], {
        measurements: measLines,
      });
      const memberNotes: string[] = [];
      for (const probe of probes) {
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `ct-full-bridge ${probe} ${JSON.stringify(comparison)}`).toBe(true);
        expect(comparison.referenceRange, `ct-full-bridge ${probe} non-hollow`).toBeGreaterThan(10);
        memberNotes.push(
          `${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
        );
      }
      const vdc = result.ngspice.get("v(vdc)")!;
      const tauMeas = runMeasurements(measLines, {
        times: vdc.axis,
        traces: [{ id: "vdc", label: "V(VDC)", values: vdc.values }],
      });
      const byName = (name: string) =>
        tauMeas.find((row) => row.name.toLowerCase() === name.toLowerCase())?.value;
      const ltAvg = measurementValue(result.ltspiceLog, "vdc_avg");
      const ltPp = measurementValue(result.ltspiceLog, "vdc_pp");
      const ngAvg = byName("vdc_avg");
      const ngPp = byName("vdc_pp");
      expect(ngAvg, JSON.stringify(tauMeas)).toEqual(expect.any(Number));
      expect(ngPp, JSON.stringify(tauMeas)).toEqual(expect.any(Number));
      expect(relativeError(ngAvg!, ltAvg), `ct-full-bridge VDC_AVG lt=${ltAvg} ng=${ngAvg}`).toBeLessThanOrEqual(0.02);
      expect(relativeError(ngPp!, ltPp), `ct-full-bridge VDC_PP lt=${ltPp} ng=${ngPp}`).toBeLessThanOrEqual(0.02);
      memberNotes.push(
        `VDC_AVG lt=${ltAvg.toFixed(4)} ng=${ngAvg!.toFixed(4)}; VDC_PP lt=${ltPp.toFixed(4)} ng=${ngPp!.toFixed(4)}`,
      );
      cells.push({
        analysis: "tran",
        circuit: "ct-full-bridge",
        topology: "Circuit_testing_v1/18_full_bridge_power_supply.asc 1N4007 bridge + 2200u/100Ω (authored .tran 20u–120m; .meas VDC_AVG/PP)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Circuit_testing_v1/17_three_phase_power_grid.asc authored .tran ---
    // Tau-owned ASC: three 120°-spaced SINE(0 170 60) sources + per-phase
    // Rline=200m / Lline=2m / Rload=20 / Lload=30m / Cpf=47u shunt. Authored
    // `.tran 50u 100m`. Passive RLC only — zero models/subckts. Distinct from
    // ct 18 1N4007 bridge TRAN, ct 08 underdamped RLC, and ct 11 RC ladder AC.
    // Left 100W/IRFP / Documents Draft* / Settings / ct 12–15 / ct19 INA alone.
    // Tip ct-full-bridge pass=94 → **pass=95**.
    {
      expect(existsSync(CT_THREE_PHASE_ASC), `missing ${CT_THREE_PHASE_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(CT_THREE_PHASE_ASC)));
      expect(imported.warnings).toEqual([]);
      expect(imported.foreignSymbols).toEqual([]);
      expect(imported.components.filter((c) => c.kind === "vsource")).toHaveLength(3);
      expect(imported.components.filter((c) => c.kind === "resistor")).toHaveLength(6);
      expect(imported.components.filter((c) => c.kind === "inductor")).toHaveLength(6);
      expect(imported.components.filter((c) => c.kind === "capacitor")).toHaveLength(3);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.tran, "17_three_phase_power_grid.asc must author .tran").toBeTruthy();
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: Math.max(parsed.tran!.steps ?? 240, 4000),
        startTime: parsed.tran!.startTime,
        maxStep: parsed.tran!.maxStep,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/^VA\b.+\bSIN\(0 170 60\)/im);
      expect(deck.netlist).toMatch(/^VB\b.+\bSIN\(0 170 60 0 0 -120\)/im);
      expect(deck.netlist).toMatch(/^VC\b.+\bSIN\(0 170 60 0 0 120\)/im);
      expect(deck.netlist).toMatch(/^RPA\b.+\b20\b/im);
      expect(deck.netlist).toMatch(/^CFA\b.+\b0\.000047\b/im);
      expect(deck.netlist).toMatch(/\.tran\b/i);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      expect(deck.netlist).not.toMatch(/\.model\b/i);
      const probes = ["v(a_load)", "v(b_load)", "v(c_load)"] as const;
      const result = runPairedBatch("diff-ct-three-phase-tran", deck.netlist, [...probes]);
      const memberNotes: string[] = [];
      for (const probe of probes) {
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `ct-three-phase ${probe} ${JSON.stringify(comparison)}`).toBe(true);
        expect(comparison.referenceRange, `ct-three-phase ${probe} non-hollow`).toBeGreaterThan(50);
        memberNotes.push(
          `${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
        );
      }
      cells.push({
        analysis: "tran",
        circuit: "ct-three-phase",
        topology: "Circuit_testing_v1/17_three_phase_power_grid.asc 3φ SINE 170 V/60 Hz + RL line/load + 47u PF (authored .tran 50u–100m)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Circuit_testing_v1/12_buck_converter.asc authored .tran + .meas ---
    // Tau-owned ASC: V1=12 + VG PULSE 100 kHz 40% duty + PMOS RSR015P06 +
    // Schottky 1N5819 + L=100u Rser=35m + C=47u Rser=40m + RLOAD=10. Authored
    // `.tran 50n 4m` + `.meas VOUT_AVG/VOUT_PP … FROM=3m TO=4m`. Exact
    // standardModels RSR015P06 VDMOS(pchan) + 1N5819 — zero unresolved /
    // substitutions. Probe v(out) only (switch-node edge timing can exceed
    // 5% maxTol while filtered output tracks). Distinct from ct 18 1N4007
    // bridge, edu 100W IRFP amp, and ct 13 boost (QS6K1). Left Staff EE
    // Bode/waveform WIP / Settings / Draft* / ct13–15 / ct19 INA alone.
    // Tip ct-three-phase pass=95 → **pass=96**.
    {
      expect(existsSync(CT_BUCK_ASC), `missing ${CT_BUCK_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(CT_BUCK_ASC)));
      expect(imported.warnings).toEqual([]);
      expect(imported.foreignSymbols).toEqual([]);
      expect(imported.components.filter((c) => c.kind === "pmos")).toHaveLength(1);
      expect(imported.components.filter((c) => c.kind === "diode")).toHaveLength(1);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.tran, "12_buck_converter.asc must author .tran").toBeTruthy();
      const measLines = dirs.filter((d) => /^\.meas\b/i.test(d.trim()));
      expect(measLines.length, "12_buck must author .meas").toBeGreaterThanOrEqual(2);
      expect(measLines.some((d) => /\bvout_avg\b/i.test(d))).toBe(true);
      expect(measLines.some((d) => /\bvout_pp\b/i.test(d))).toBe(true);
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: Math.max(parsed.tran!.steps ?? 240, 8000),
        startTime: parsed.tran!.startTime,
        maxStep: parsed.tran!.maxStep,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/\.model\s+RSR015P06\s+VDMOS\b/i);
      expect(deck.netlist).toMatch(/\.model\s+1N5819\s+D\b/i);
      expect(deck.netlist).toMatch(/^M1\b.+\bRSR015P06\b/im);
      expect(deck.netlist).toMatch(/^D1\b.+\b1N5819\b/im);
      expect(deck.netlist).toMatch(/^VG\b.+\bPULSE\(/im);
      expect(deck.netlist).toMatch(/^RLOAD\b.+\b10\b/im);
      expect(deck.netlist).toMatch(/\.tran\b/i);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      const probes = ["v(out)"] as const;
      const result = runPairedBatch("diff-ct-buck-tran", deck.netlist, [...probes], {
        measurements: measLines,
      });
      const memberNotes: string[] = [];
      for (const probe of probes) {
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `ct-buck ${probe} ${JSON.stringify(comparison)}`).toBe(true);
        expect(comparison.referenceRange, `ct-buck ${probe} non-hollow`).toBeGreaterThan(1);
        memberNotes.push(
          `${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
        );
      }
      const out = result.ngspice.get("v(out)")!;
      const tauMeas = runMeasurements(measLines, {
        times: out.axis,
        traces: [{ id: "out", label: "V(OUT)", values: out.values }],
      });
      const byName = (name: string) =>
        tauMeas.find((row) => row.name.toLowerCase() === name.toLowerCase())?.value;
      const ltAvg = measurementValue(result.ltspiceLog, "vout_avg");
      const ltPp = measurementValue(result.ltspiceLog, "vout_pp");
      const ngAvg = byName("vout_avg");
      const ngPp = byName("vout_pp");
      expect(ngAvg, JSON.stringify(tauMeas)).toEqual(expect.any(Number));
      expect(ngPp, JSON.stringify(tauMeas)).toEqual(expect.any(Number));
      expect(relativeError(ngAvg!, ltAvg), `ct-buck VOUT_AVG lt=${ltAvg} ng=${ngAvg}`).toBeLessThanOrEqual(0.02);
      expect(relativeError(ngPp!, ltPp), `ct-buck VOUT_PP lt=${ltPp} ng=${ngPp}`).toBeLessThanOrEqual(0.02);
      memberNotes.push(
        `VOUT_AVG lt=${ltAvg.toFixed(4)} ng=${ngAvg!.toFixed(4)}; VOUT_PP lt=${ltPp.toFixed(4)} ng=${ngPp!.toFixed(4)}`,
      );
      cells.push({
        analysis: "tran",
        circuit: "ct-buck",
        topology: "Circuit_testing_v1/12_buck_converter.asc RSR015P06 + 1N5819 async buck (authored .tran 50n–4m; .meas VOUT_AVG/PP)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Circuit_testing_v1/13_boost_converter.asc authored .tran + .meas ---
    // Tau-owned ASC: V1=5 + VG PULSE 100 kHz 50% duty + NMOS QS6K1 +
    // Schottky 1N5819 + L=100u Rser=35m + C=100u Rser=40m + RLOAD=50.
    // Authored `.tran 50n 5m` + `.meas VOUT_AVG/VOUT_PP … FROM=4m TO=5m`.
    // Exact standardModels QS6K1 VDMOS + 1N5819 — zero unresolved /
    // substitutions. Probe v(out) only (switch-node edge timing can exceed
    // 5% maxTol while filtered output tracks). Distinct from ct 12 buck
    // (RSR015P06), ct 18 1N4007 bridge, edu 100W IRFP. Left Staff EE
    // Bode/waveform WIP / Settings / Draft* / ct14–15 / ct19 INA alone.
    // Tip ct-buck pass=96 → **pass=97**.
    {
      expect(existsSync(CT_BOOST_ASC), `missing ${CT_BOOST_ASC}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(CT_BOOST_ASC)));
      expect(imported.warnings).toEqual([]);
      expect(imported.foreignSymbols).toEqual([]);
      expect(imported.components.filter((c) => c.kind === "nmos")).toHaveLength(1);
      expect(imported.components.filter((c) => c.kind === "diode")).toHaveLength(1);
      const dirs = expandDirectiveLines(imported.directives);
      const parsed = analysesFromDirectives(dirs);
      expect(parsed.tran, "13_boost_converter.asc must author .tran").toBeTruthy();
      const measLines = dirs.filter((d) => /^\.meas\b/i.test(d.trim()));
      expect(measLines.length, "13_boost must author .meas").toBeGreaterThanOrEqual(2);
      expect(measLines.some((d) => /\bvout_avg\b/i.test(d))).toBe(true);
      expect(measLines.some((d) => /\bvout_pp\b/i.test(d))).toBe(true);
      const params = buildParamScope(dirs);
      const deck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: dirs,
        params,
      }, {
        kind: "tran",
        stopTime: parsed.tran!.stopTime,
        steps: Math.max(parsed.tran!.steps ?? 240, 8000),
        startTime: parsed.tran!.startTime,
        maxStep: parsed.tran!.maxStep,
      });
      expect(deck.unresolvedSubckts ?? []).toEqual([]);
      expect(deck.modelSubstitutions ?? []).toEqual([]);
      expect(deck.netlist).toMatch(/\.model\s+QS6K1\s+VDMOS\b/i);
      expect(deck.netlist).toMatch(/\.model\s+1N5819\s+D\b/i);
      expect(deck.netlist).toMatch(/^M1\b.+\bQS6K1\b/im);
      expect(deck.netlist).toMatch(/^D1\b.+\b1N5819\b/im);
      expect(deck.netlist).toMatch(/^VG\b.+\bPULSE\(/im);
      expect(deck.netlist).toMatch(/^RLOAD\b.+\b50\b/im);
      expect(deck.netlist).toMatch(/\.tran\b/i);
      expect(deck.netlist).not.toMatch(/^X\w*\b/im);
      const probes = ["v(out)"] as const;
      const result = runPairedBatch("diff-ct-boost-tran", deck.netlist, [...probes], {
        measurements: measLines,
      });
      const memberNotes: string[] = [];
      for (const probe of probes) {
        const lt = result.ltspice.get(probe)!;
        const ng = result.ngspice.get(probe)!;
        const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
          rmsTolerance: 0.02,
          maxTolerance: 0.05,
        });
        expect(comparison.pass, `ct-boost ${probe} ${JSON.stringify(comparison)}`).toBe(true);
        expect(comparison.referenceRange, `ct-boost ${probe} non-hollow`).toBeGreaterThan(1);
        memberNotes.push(
          `${probe} nRms=${comparison.normalizedRms.toFixed(4)} nMax=${comparison.normalizedMax.toFixed(4)} span=${comparison.referenceRange.toFixed(3)}`,
        );
      }
      const out = result.ngspice.get("v(out)")!;
      const tauMeas = runMeasurements(measLines, {
        times: out.axis,
        traces: [{ id: "out", label: "V(OUT)", values: out.values }],
      });
      const byName = (name: string) =>
        tauMeas.find((row) => row.name.toLowerCase() === name.toLowerCase())?.value;
      const ltAvg = measurementValue(result.ltspiceLog, "vout_avg");
      const ltPp = measurementValue(result.ltspiceLog, "vout_pp");
      const ngAvg = byName("vout_avg");
      const ngPp = byName("vout_pp");
      expect(ngAvg, JSON.stringify(tauMeas)).toEqual(expect.any(Number));
      expect(ngPp, JSON.stringify(tauMeas)).toEqual(expect.any(Number));
      expect(relativeError(ngAvg!, ltAvg), `ct-boost VOUT_AVG lt=${ltAvg} ng=${ngAvg}`).toBeLessThanOrEqual(0.02);
      expect(relativeError(ngPp!, ltPp), `ct-boost VOUT_PP lt=${ltPp} ng=${ngPp}`).toBeLessThanOrEqual(0.02);
      memberNotes.push(
        `VOUT_AVG lt=${ltAvg.toFixed(4)} ng=${ngAvg!.toFixed(4)}; VOUT_PP lt=${ltPp.toFixed(4)} ng=${ngPp!.toFixed(4)}`,
      );
      cells.push({
        analysis: "tran",
        circuit: "ct-boost",
        topology: "Circuit_testing_v1/13_boost_converter.asc QS6K1 + 1N5819 async boost (authored .tran 50n–5m; .meas VOUT_AVG/PP)",
        status: "pass",
        note: memberNotes.join("; "),
      });
    }

    // --- Class-D AC/OP (authored analyses are .tran/.meas; add AC/OP for differential proof) ---
    {
      const ascPath = join(CLASSD_DIR, "class-d-starter.asc");
      expect(existsSync(ascPath), `missing ${ascPath}`).toBe(true);
      const imported = importAsc(decodeSchematicText(readFileSync(ascPath)), {
        resolveSubcircuit: siblingResolver(CLASSD_DIR),
      });
      const params = buildParamScope(imported.directives);
      const acDeck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: imported.directives,
        params,
      }, {
        kind: "ac",
        startHz: 100,
        stopHz: 100e3,
        pointsPerDecade: 10,
      });
      expect(acDeck.unresolvedSubckts).toEqual([]);
      // Fixture is .tran-authored; LTspice requires an AC stimulus. V3 (audio)
      // has ~zero small-signal gain through the PWM comparator; V1 (rail)
      // supply-ripple coupling at vo is non-trivial and matches LTspice.
      // Prefer V1 only (do not AC-stamp every source).
      const acNetlist = acDeck.netlist
        .split(/\r?\n/)
        .map((line) => {
          if (/^V1\b/i.test(line.trim()) && !/\bAC\b/i.test(line)) {
            return `${line.trimEnd()} AC 1`;
          }
          return line;
        })
        .join("\n");
      expect(acNetlist).toMatch(/^V1\b.*\bAC\b/im);
      const acResult = runPairedBatch("diff-classd-ac", acNetlist, ["v(vo)"]);
      const ltAc = acResult.ltspice.get("v(vo)")!;
      const ngAc = acResult.ngspice.get("v(vo)")!;
      const acComparison = compareWaveforms(ngAc.axis, ngAc.values, ltAc.axis, ltAc.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(acComparison.pass, JSON.stringify(acComparison)).toBe(true);
      cells.push({
        analysis: "ac",
        circuit: "class-d",
        topology: "class-d-starter + deadtime (AC stim on V1)",
        status: "pass",
        note: `|V(vo)| nRms=${acComparison.normalizedRms.toFixed(4)} nMax=${acComparison.normalizedMax.toFixed(4)}`,
      });

      const opDeck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: imported.directives,
        params,
      }, { kind: "op" });
      // L1 is linear 225µH — prior gap note about "behavioral L @device[param]"
      // was a misread of MOSFET/diode `@m1[id]` save vectors. Harness strips
      // those; node-voltage OP compares cleanly.
      expect(opDeck.netlist).toMatch(/^L1\b.+\b0\.000225\b/m);
      const opResult = runPairedBatch("diff-classd-op", opDeck.netlist, ["v(vo)", "v(vpwm)"]);
      const ltVo = firstSample(opResult.ltspice.get("v(vo)")!);
      const ngVo = firstSample(opResult.ngspice.get("v(vo)")!);
      const ltPwm = firstSample(opResult.ltspice.get("v(vpwm)")!);
      const ngPwm = firstSample(opResult.ngspice.get("v(vpwm)")!);
      expect(relativeError(ngVo, ltVo)).toBeLessThanOrEqual(1e-6);
      expect(relativeError(ngPwm, ltPwm)).toBeLessThanOrEqual(1e-6);
      cells.push({
        analysis: "op",
        circuit: "class-d",
        topology: "class-d-starter + deadtime .op",
        status: "pass",
        note: `V(vo)/V(vpwm) relErr<=1e-6 (vo≈${ngVo.toFixed(4)}, vpwm=${ngPwm})`,
      });

      // Supply-rail DC sweep (V1): same physical knob as proven AC supply coupling.
      const dcDeck = buildSpiceDeck({
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: imported.directives,
        params,
      }, {
        kind: "dc",
        source: "V1",
        start: 8,
        stop: 12,
        step: 1,
      });
      expect(dcDeck.unresolvedSubckts).toEqual([]);
      const dcResult = runPairedBatch("diff-classd-dc", dcDeck.netlist, ["v(vo)"]);
      const ltDc = dcResult.ltspice.get("v(vo)")!;
      const ngDc = dcResult.ngspice.get("v(vo)")!;
      const dcComparison = compareWaveforms(ngDc.axis, ngDc.values, ltDc.axis, ltDc.values, {
        rmsTolerance: 0.02,
        maxTolerance: 0.05,
      });
      expect(dcComparison.pass, JSON.stringify(dcComparison)).toBe(true);
      cells.push({
        analysis: "dc",
        circuit: "class-d",
        topology: "class-d-starter + deadtime (DC sweep V1 rail 8–12 V)",
        status: "pass",
        note: `V(vo) nRms=${dcComparison.normalizedRms.toFixed(4)} nMax=${dcComparison.normalizedMax.toFixed(4)}`,
      });

      // Same added-analysis precedent as Class-D AC/OP/DC: fixture authors
      // .tran/.meas only; differential proof injects .noise/.tf on V1→vo
      // (rail coupling), asserts LTspice↔ngspice match, and records pass.
      // Not a silent fake — numeric parity is required below.
      {
        const noiseDeck = buildSpiceDeck({
          components: imported.components,
          wires: imported.wires,
          netLabels: imported.netLabels,
          directives: imported.directives,
          params,
        }, {
          kind: "noise",
          output: { node: "vo", refNode: "0" },
          source: "V1",
          startHz: 100,
          stopHz: 100e3,
          pointsPerDecade: 10,
        });
        const noiseNetlist = noiseDeck.netlist
          .split(/\r?\n/)
          .map((line) => {
            if (/^V1\b/i.test(line.trim()) && !/\bAC\b/i.test(line)) {
              return `${line.trimEnd()} AC 1`;
            }
            return line;
          })
          .join("\n");
        expect(noiseNetlist).toMatch(/^V1\b.*\bAC\b/im);
        expect(noiseNetlist).toMatch(/\.noise\b/i);
        const noiseResult = runPairedBatch("diff-classd-noise", noiseNetlist, [], {
          skipSave: true,
          extract: ["V(onoise)"],
          ngspiceAliases: { "V(onoise)": "onoise_spectrum" },
        });
        const ltNoise = noiseResult.ltspice.get("V(onoise)")!;
        const ngNoise = noiseResult.ngspice.get("V(onoise)")!;
        const noiseCmp = compareWaveforms(
          ngNoise.axis,
          ngNoise.values,
          ltNoise.axis,
          ltNoise.values,
          { rmsTolerance: 0.02, maxTolerance: 0.05 },
        );
        expect(noiseCmp.pass, JSON.stringify(noiseCmp)).toBe(true);
        cells.push({
          analysis: "noise",
          circuit: "class-d",
          topology: "class-d-starter + deadtime (.noise V(vo) V1; added like AC/OP/DC)",
          status: "pass",
          note: `V(onoise) nRms=${noiseCmp.normalizedRms.toFixed(4)} nMax=${noiseCmp.normalizedMax.toFixed(4)}`,
        });

        const tfDeck = buildSpiceDeck({
          components: imported.components,
          wires: imported.wires,
          netLabels: imported.netLabels,
          directives: imported.directives,
          params,
        }, {
          kind: "tf",
          output: { kind: "voltage", node: "vo", refNode: "0" },
          source: "V1",
        });
        expect(tfDeck.netlist).toMatch(/\.tf\b/i);
        const tfResult = runPairedTransferFunction("diff-classd-tf", tfDeck.netlist);
        const ltGain = pickScalar(tfResult.ltspice, ["transfer_function"]);
        const ngGain = pickScalar(tfResult.ngspice, ["transfer_function"]);
        const tfRel = relativeError(ngGain, ltGain);
        expect(tfRel, `tf gain lt=${ltGain} ng=${ngGain}`).toBeLessThanOrEqual(1e-3);
        cells.push({
          analysis: "tf",
          circuit: "class-d",
          topology: "class-d-starter + deadtime (.tf V(vo) V1; added like AC/OP/DC)",
          status: "pass",
          note: `transfer_function≈${ngGain.toExponential(3)} rel=${tfRel.toExponential(2)}`,
        });
      }
    }

    // --- Native single-deck `.step` card: LTspice stepped OP vs ngspice step_expand ---
    {
      const result = runPairedNativeStepOp("diff-native-step-card", NATIVE_STEP_PARAM_OP, "v(out)");
      expect(result.ltspice.values.length).toBe(3);
      expect(result.ngspice.values.length).toBe(3);
      const memberNotes: string[] = [];
      for (let i = 0; i < result.ltspice.values.length; i += 1) {
        const axis = result.ltspice.axis[i]!;
        const lt = result.ltspice.values[i]!;
        const ng = result.ngspice.values[i]!;
        expect(result.ngspice.axis[i]).toBeCloseTo(axis, 6);
        expect(relativeError(ng, lt), `Rload=${axis} lt=${lt} ng=${ng}`).toBeLessThanOrEqual(1e-6);
        memberNotes.push(`Rload=${axis} V(out)=${ng.toFixed(4)} rel=${relativeError(ng, lt).toExponential(1)}`);
      }
      // Product path: buildSpiceDeck emitNativeStep emits the same `.step` card shape.
      const stepParamDivider = {
        components: [
          { id: "V1", kind: "vsource" as const, label: "V1", value: "5", x: 0, y: 0, rotation: 0 as const },
          { id: "R1", kind: "resistor" as const, label: "R1", value: "{Rload}", x: 64, y: 0, rotation: 0 as const },
          { id: "R2", kind: "resistor" as const, label: "R2", value: "1k", x: 128, y: 0, rotation: 0 as const },
        ],
        wires: [
          { id: "w1", points: [{ x: 32, y: 0 }, { x: 64, y: 0 }] },
          { id: "w2", points: [{ x: 96, y: 0 }, { x: 128, y: 0 }] },
        ],
        netLabels: [
          { id: "in-l", x: 0, y: 0, text: "in" },
          { id: "out-l", x: 128, y: 0, text: "out" },
          { id: "gnd1", x: 0, y: 32, text: "0" },
          { id: "gnd2", x: 128, y: 32, text: "0" },
        ],
        directives: [".step param Rload list 1k 2k 3k"],
      };
      const params = buildParamScope(stepParamDivider.directives);
      const nativeDeck = buildSpiceDeck(
        { ...stepParamDivider, params },
        { kind: "op" },
        { emitNativeStep: true },
      );
      expect(nativeDeck.netlist).toContain(".step param Rload list 1k 2k 3k");
      expect(nativeDeck.netlist).toMatch(/\{Rload\}/);
      expect(nativeDeck.netlist).toMatch(/\.param\b[\s\S]*\bRload=1000\b/);
      cells.push({
        analysis: "step",
        circuit: "divider",
        topology: "native emitNativeStep .step param Rload OP (LTspice card vs ngspice step_expand)",
        status: "pass",
        note: memberNotes.join("; "),
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

    // Class-D noise/tf closed under the same added-analysis precedent as
    // AC/OP/DC. DoD broad-differential box stays open: device/topology matrix
    // beyond this slice is still incomplete (SUMMARY footer says so).
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
    const siblingCount = cells.filter((cell) => cell.status === "sibling").length;
    expect(passCount).toBeGreaterThanOrEqual(70);
    expect(siblingCount).toBe(5);
    expect(gapCount).toBe(0);
    expect(report).toMatch(/SUMMARY pass=97 sibling=5 gap=0/);
  }, 240_000);
});
