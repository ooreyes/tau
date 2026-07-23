/**
 * Repository-owned engineering stress pack.
 *
 * Unlike the personal acceptance corpus, Circuit_testing_v1 travels with Tau.
 * It imports unmodified LTspice `.asc` files, validates the exact document
 * shape the app opens, drives Tau's analysis implementations, and sends every
 * native OP/TRAN/AC/DC deck through ngspice. Run with:
 *
 *   Circuit_testing_v1/run.sh
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { importAsc } from "../src/io/ascImport";
import { validateSchematicDocument } from "../src/schematic/documentValidation";
import { analysesFromDirectives } from "../src/io/directiveAnalysis";
import { buildParamScope } from "../src/simulation/paramScope";
import { buildSpiceDeck, type SpiceAnalysis } from "../src/engine/spiceNetlist";
import { runOperatingPoint } from "../src/simulation/operatingPoint";
import { runTransientAnalysis } from "../src/simulation/linearTransient";
import { runMeasurements } from "../src/simulation/measure";
import { runAcSweep } from "../src/simulation/acSweep";
import { runDcSweep } from "../src/simulation/dcSweep";
import { runnableStepsFromDirectives } from "../src/simulation/stepFamily";
import { runDcStepFamily } from "../src/simulation/stepAnalysisFamily";
import { runTransferFunction } from "../src/simulation/transferFunction";
import { runNoiseAnalysis } from "../src/simulation/noise";

const PACK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../Circuit_testing_v1");
const EXPECTED_FILES = 11;
const haveNgspice = spawnSync("ngspice", ["--version"], { encoding: "utf8" }).status === 0;
const rows: { file: string; check: string; result: "PASS" | "SKIP" }[] = [];

type Imported = ReturnType<typeof importAsc>;

function load(name: string, validate = true): Imported {
  const imported = importAsc(readFileSync(join(PACK_DIR, name), "utf8"));
  if (validate) {
    validateSchematicDocument({
      components: imported.components,
      wires: imported.wires,
      probes: [],
      netLabels: imported.netLabels,
      directives: imported.directives,
    });
  }
  return imported;
}

function schematic(imported: Imported) {
  return {
    components: imported.components,
    wires: imported.wires,
    netLabels: imported.netLabels,
    params: buildParamScope(imported.directives),
    directives: imported.directives,
  };
}

function pass(file: string, check: string, result: "PASS" | "SKIP" = "PASS") {
  rows.push({ file, check, result });
}

function nativeRun(file: string, imported: Imported, analysis: SpiceAnalysis) {
  if (!haveNgspice) {
    pass(file, `native ${analysis.kind}`, "SKIP");
    return;
  }
  const deck = buildSpiceDeck(schematic(imported), analysis);
  expect(deck.unresolvedSubckts, `${file}: unresolved subcircuits`).toEqual([]);
  // Tauri's shared-library API reads vectors directly and needs no textual
  // output command. The standalone ngspice batch CLI used by this runner does,
  // so add a harmless print for one real node without changing the analysis.
  const printedNode = deck.circuit.nets.find((net) => !net.isGround)?.id;
  const printLine = printedNode
    ? analysis.kind === "ac"
      ? `.print ac vm(${printedNode}) vp(${printedNode})`
      : analysis.kind === "op"
        ? `.print op v(${printedNode})`
        : `.print ${analysis.kind} v(${printedNode})`
    : "";
  const batchNetlist = printLine
    ? deck.netlist.replace(/\n\.end\s*$/i, `\n${printLine}\n.end`)
    : deck.netlist;
  const temp = mkdtempSync(join(tmpdir(), "tau-circuit-v1-"));
  try {
    const path = join(temp, `${analysis.kind}.cir`);
    writeFileSync(path, batchNetlist);
    const run = spawnSync("ngspice", ["-b", path], {
      encoding: "utf8",
      timeout: 120_000,
    });
    const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
    expect(run.status, `${file} native ${analysis.kind}\n${output.slice(-2500)}`).toBe(0);
    expect(output, `${file} native ${analysis.kind}`).not.toMatch(
      /simulation\(s\) aborted|fatal error|timestep too small/i,
    );
    pass(file, `native ${analysis.kind}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function voltageAt(
  result: Extract<ReturnType<typeof runOperatingPoint>, { ok: true }>,
  name: string,
): number {
  const net = result.nets.find((candidate) => candidate.id.toLowerCase() === name.toLowerCase());
  expect(net, `missing V(${name})`).toBeDefined();
  return net!.voltage;
}

afterAll(() => {
  const report = [
    "",
    "Circuit_testing_v1",
    "FILE                              CHECK                         RESULT",
    "────────────────────────────────  ────────────────────────────  ──────",
    ...rows.map(
      ({ file, check, result }) =>
        `${file.padEnd(32)}  ${check.padEnd(28)}  ${result}`,
    ),
    "",
    `${rows.filter((row) => row.result === "PASS").length} passed · `
      + `${rows.filter((row) => row.result === "SKIP").length} skipped`,
  ].join("\n");
  console.log(report);
});

describe("Circuit_testing_v1", () => {
  it("contains the documented LTspice-compatible matrix and imports cleanly", () => {
    const files = readdirSync(PACK_DIR).filter((name) => /\.asc$/i.test(name)).sort();
    expect(files).toHaveLength(EXPECTED_FILES);
    for (const file of files) {
      const imported = load(file, file !== "10_error_duplicate_refdes.asc");
      expect(imported.warnings, `${file}: import warnings`).toEqual([]);
      if (file === "10_error_duplicate_refdes.asc") {
        expect(() => validateSchematicDocument({
          components: imported.components,
          wires: imported.wires,
          probes: [],
          netLabels: imported.netLabels,
          directives: imported.directives,
        })).toThrow(/component reference "R1" is used 2 times/i);
        pass(file, "import + expected validation rejection");
      } else {
        pass(file, "import + document validation");
      }
    }
  });

  it("solves the hand-calculated operating-point divider", () => {
    const file = "01_op_voltage_divider.asc";
    const imported = load(file);
    const op = runOperatingPoint(schematic(imported));
    expect(op.ok).toBe(true);
    if (!op.ok) return;
    expect(voltageAt(op, "out")).toBeCloseTo(10 / 3, 8);
    pass(file, "Tau OP: V(out)=3.333 V");
    nativeRun(file, imported, { kind: "op" });
  });

  it("runs an RC pulse and evaluates its authored measurements", async () => {
    const file = "02_tran_rc_pulse_meas.asc";
    const imported = load(file);
    const tran = analysesFromDirectives(imported.directives).tran;
    expect(tran).toBeDefined();
    const result = await runTransientAnalysis(schematic(imported), tran!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const out = result.traces.find((trace) => trace.id.toLowerCase() === "out");
    expect(out).toBeDefined();
    expect(Math.max(...out!.values)).toBeGreaterThan(4.9);
    const measurements = runMeasurements(imported.directives, result);
    expect(measurements.map((entry) => entry.name.toLowerCase())).toEqual(["vmax", "vavg"]);
    expect(measurements.every((entry) => entry.value !== null && !entry.error)).toBe(true);
    pass(file, "Tau TRAN + .meas");
    nativeRun(file, imported, { kind: "tran", ...tran! });
  });

  it("places the RC low-pass corner at the hand-calculated frequency", () => {
    const file = "03_ac_rc_lowpass.asc";
    const imported = load(file);
    const ac = analysesFromDirectives(imported.directives).ac;
    expect(ac).toBeDefined();
    const result = runAcSweep(schematic(imported), ac!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const out = result.traces.find((trace) => trace.id.toLowerCase() === "out");
    expect(out).toBeDefined();
    const target = 1 / (2 * Math.PI * 1_000 * 100e-9);
    const index = result.freqs.reduce(
      (best, value, candidate) =>
        Math.abs(value - target) < Math.abs(result.freqs[best] - target) ? candidate : best,
      0,
    );
    expect(out!.magDb[index]).toBeGreaterThan(-3.8);
    expect(out!.magDb[index]).toBeLessThan(-2.3);
    expect(out!.phaseDeg[index]).toBeGreaterThan(-52);
    expect(out!.phaseDeg[index]).toBeLessThan(-38);
    pass(file, "Tau AC: fc≈1.59 kHz");
    nativeRun(file, imported, { kind: "ac", ...ac! });
  });

  it("keeps a nonlinear diode DC sweep finite and monotonic", () => {
    const file = "04_dc_diode_curve.asc";
    const imported = load(file);
    const dc = analysesFromDirectives(imported.directives).dc;
    expect(dc).toBeDefined();
    const result = runDcSweep(schematic(imported), dc!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const anode = result.nets.find((net) => net.id.toLowerCase() === "anode");
    expect(anode).toBeDefined();
    expect(anode!.voltages.every(Number.isFinite)).toBe(true);
    for (let i = 1; i < anode!.voltages.length; i += 1) {
      expect(anode!.voltages[i]).toBeGreaterThanOrEqual(anode!.voltages[i - 1] - 1e-9);
    }
    const finalVoltage = anode!.voltages[anode!.voltages.length - 1];
    expect(finalVoltage).toBeGreaterThan(0.45);
    expect(finalVoltage).toBeLessThan(0.9);
    pass(file, "Tau DC nonlinear sweep");
    nativeRun(file, imported, { kind: "dc", ...dc! });
  });

  it("builds four distinct parameter-step transfer curves", () => {
    const file = "05_step_loaded_divider.asc";
    const imported = load(file);
    const dc = analysesFromDirectives(imported.directives).dc;
    const steps = runnableStepsFromDirectives(imported.directives);
    expect(dc).toBeDefined();
    expect(steps).toHaveLength(1);
    const family = runDcStepFamily(
      steps,
      buildParamScope(imported.directives),
      {
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
      },
      dc!,
    );
    expect(family.ok).toBe(true);
    expect(family.members).toHaveLength(4);
    const finals = family.members.map((member) => {
      expect(member.result.ok).toBe(true);
      if (!member.result.ok) return NaN;
      const voltages = member.result.nets.find((net) => net.id.toLowerCase() === "out")!.voltages;
      return voltages[voltages.length - 1];
    });
    expect(finals.every(Number.isFinite)).toBe(true);
    expect([...finals].sort((a, b) => a - b)).toEqual(finals);
    pass(file, "Tau STEP family: 4 curves");
    nativeRun(file, imported, { kind: "dc", ...dc! });
  });

  it("reports the divider transfer function and port impedances", () => {
    const file = "06_tf_voltage_divider.asc";
    const imported = load(file);
    const tf = analysesFromDirectives(imported.directives).tf;
    expect(tf).toBeDefined();
    const result = runTransferFunction(schematic(imported), tf!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gain).toBeCloseTo(0.5, 8);
    expect(result.inputImpedance).toBeCloseTo(2_000, 5);
    expect(result.outputImpedance).toBeCloseTo(500, 5);
    pass(file, "Tau TF: gain + Zin/Zout");
  });

  it("produces finite input/output-referred thermal-noise spectra", () => {
    const file = "07_noise_rc_lowpass.asc";
    const imported = load(file);
    const noise = analysesFromDirectives(imported.directives).noise;
    expect(noise).toBeDefined();
    const result = runNoiseAnalysis(schematic(imported), noise!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.freqs.length).toBeGreaterThan(20);
    expect(result.onoise.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    expect(result.inoise.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    expect(result.totalOutputNoise).toBeGreaterThan(0);
    expect(result.totalInputNoise).toBeGreaterThan(0);
    pass(file, "Tau NOISE spectrum + totals");
  });

  it("runs a stable underdamped RLC transient", async () => {
    const file = "08_tran_rlc_ringing.asc";
    const imported = load(file);
    const tran = analysesFromDirectives(imported.directives).tran;
    expect(tran).toBeDefined();
    const result = await runTransientAnalysis(schematic(imported), tran!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const out = result.traces.find((trace) => trace.id.toLowerCase() === "out");
    expect(out).toBeDefined();
    expect(out!.values.every(Number.isFinite)).toBe(true);
    expect(Math.max(...out!.values) - Math.min(...out!.values)).toBeGreaterThan(1);
    const measurements = runMeasurements(imported.directives, result);
    expect(measurements[0]?.value).toBeGreaterThan(1);
    pass(file, "Tau TRAN RLC + .meas");
    nativeRun(file, imported, { kind: "tran", ...tran! });
  });

  it("rejects missing ground with an actionable instruction", () => {
    const file = "09_error_missing_ground.asc";
    const imported = load(file);
    expect(() => buildSpiceDeck(schematic(imported), { kind: "op" })).toThrow(
      "Add a ground symbol so node voltages have a reference.",
    );
    const op = runOperatingPoint(schematic(imported));
    expect(op.ok).toBe(false);
    if (!op.ok) expect(op.message).toBe("Add a ground symbol so node voltages have a reference.");
    pass(file, "clear missing-ground error");
  });

  it("rejects duplicate reference designators by name", () => {
    const file = "10_error_duplicate_refdes.asc";
    const imported = load(file, false);
    expect(() => validateSchematicDocument({
      components: imported.components,
      wires: imported.wires,
      probes: [],
      netLabels: imported.netLabels,
      directives: imported.directives,
    })).toThrow(/component reference "R1" is used 2 times/i);
    pass(file, "clear duplicate-R1 error");
  });

  it("runs the eight-pole ladder through OP, TRAN, and AC", async () => {
    const file = "11_stress_rc_ladder.asc";
    const imported = load(file);
    expect(imported.components).toHaveLength(18);
    const analyses = analysesFromDirectives(imported.directives);
    expect(analyses.tran).toBeDefined();
    expect(analyses.ac).toBeDefined();

    const op = runOperatingPoint(schematic(imported));
    expect(op.ok).toBe(true);
    if (op.ok) expect(op.warnings).toEqual([]);

    const tran = await runTransientAnalysis(schematic(imported), analyses.tran!);
    expect(tran.ok).toBe(true);
    if (tran.ok) {
      expect(tran.traces.length).toBeGreaterThanOrEqual(9);
      expect(tran.traces.every((trace) => trace.values.every(Number.isFinite))).toBe(true);
    }

    const ac = runAcSweep(schematic(imported), analyses.ac!);
    expect(ac.ok).toBe(true);
    if (ac.ok) {
      const out = ac.traces.find((trace) => trace.id.toLowerCase() === "out");
      expect(out).toBeDefined();
      expect(out!.magDb[out!.magDb.length - 1]).toBeLessThan(out!.magDb[0] - 60);
    }

    pass(file, "Tau OP + TRAN + AC stress");
    nativeRun(file, imported, { kind: "op" });
    nativeRun(file, imported, { kind: "tran", ...analyses.tran! });
    nativeRun(file, imported, { kind: "ac", ...analyses.ac! });
  });
});
