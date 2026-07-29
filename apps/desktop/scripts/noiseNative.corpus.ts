// Real-engine proof for `.noise` on ngspice: builds the deck Tau would hand the
// native engine and runs it through the ngspice binary, checking the numbers,
// the vector names the adapter reads, and the two-plot split the adapter
// depends on. Two circuits - a divider whose noise is hand-computable, and a
// common-emitter stage the TypeScript solver refuses outright, which is the
// reason this path exists.
// Runs under vitest.corpus.config.ts only; skips without ngspice.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";
import { NOISE_VECTOR_NAMES } from "../src/engine/nativeSpice";
import { runNoiseAnalysis } from "../src/simulation/noise";
import type { NetLabel, SchematicComponent } from "../src/schematic/types";

const haveNgspice = spawnSync("ngspice", ["--version"], { encoding: "utf8" }).error === undefined;

/** Boltzmann constant and ngspice's default 27 C, for the hand computation. */
const BOLTZMANN = 1.380649e-23;
const T_DEFAULT = 300.15;

const vsource = (label: string, value: string, x: number, y: number): SchematicComponent => ({
  id: label, kind: "vsource", label, value, x, y, rotation: 0,
});
const resistor = (label: string, value: string, x: number, y: number): SchematicComponent => ({
  id: label, kind: "resistor", label, value, x, y, rotation: 0,
});
const lbl = (x: number, y: number, text: string): NetLabel => ({ id: `f-${x}-${y}`, x, y, text });

interface NoisePlotDump {
  name: string;
  /** True for the plot ngspice leaves current, which `ngSpice_CurPlot` returns. */
  current: boolean;
  description: string;
  vectors: string[];
}

interface NoiseRun {
  plots: NoisePlotDump[];
  rows: { freq: number; onoise: number; inoise: number }[];
  totals: Map<string, number>;
}

/**
 * Run a noise deck and read back what ngspice itself reports: the plot listing,
 * each plot's vector names, the density table and the integrated totals. The
 * names come from ngspice's own output rather than being spelled here, which is
 * what makes this a check of NOISE_VECTOR_NAMES and the two-plot split, not
 * just of the numbers.
 *
 * The control block is this harness's own scaffolding - batch mode prints
 * nothing without one. Tau's deck never carries it; the native engine reads the
 * vectors through the shared library instead.
 */
function runNoise(netlist: string, name: string): NoiseRun {
  const scaffolded = `${netlist.replace(/^\s*\.end\s*$/mi, "")}
.control
run
setplot
setplot noise1
display
print frequency ${NOISE_VECTOR_NAMES.outputSpectrum} ${NOISE_VECTOR_NAMES.inputSpectrum}
setplot noise2
display
print ${NOISE_VECTOR_NAMES.outputTotal} ${NOISE_VECTOR_NAMES.inputTotal}
.endc
.end
`;
  const cirPath = join(tmpdir(), `tau-noise-${name}.cir`);
  writeFileSync(cirPath, scaffolded);
  const run = spawnSync("ngspice", ["-b", cirPath], { encoding: "utf8", timeout: 60_000 });
  const out = `${run.stdout}\n${run.stderr}`;

  const listing = out.split(/list of plots available:/i)[1];
  expect(listing, `ngspice listed no plots for ${name}:\n${out}`).toBeDefined();
  const plots: NoisePlotDump[] = [];
  for (const line of listing.split("\n")) {
    const match = line.match(/^(Current)?\s*([A-Za-z0-9_]+)\s+.*\(([^)]*)\)\s*$/);
    if (!match) continue;
    if (match[2] === "const") continue;
    plots.push({ name: match[2], current: match[1] !== undefined, description: match[3], vectors: [] });
  }

  // `display` heads each dump with `Name: <plot> (<description>)`, then lists
  // one indented `vector : type` line each. Title/Name/Date sit at column 0, so
  // requiring the leading indent keeps them out.
  let active: NoisePlotDump | undefined;
  for (const line of out.split("\n")) {
    const header = line.match(/^Name:\s*([A-Za-z0-9_]+)\s*\(/);
    if (header) {
      active = plots.find((plot) => plot.name === header[1]);
      continue;
    }
    const vec = line.match(/^\s+([A-Za-z0-9_#().]+)\s+:\s+\S/);
    if (vec && active && !active.vectors.includes(vec[1])) active.vectors.push(vec[1]);
  }

  const rows: { freq: number; onoise: number; inoise: number }[] = [];
  for (const line of out.split("\n")) {
    const cells = line.trim().split(/\s+/);
    if (cells.length !== 4) continue;
    if (!/^\d+$/.test(cells[0])) continue;
    const [freq, onoise, inoise] = cells.slice(1).map(Number);
    if ([freq, onoise, inoise].some((value) => !Number.isFinite(value))) continue;
    rows.push({ freq, onoise, inoise });
  }

  const totals = new Map<string, number>();
  for (const line of out.split("\n")) {
    const match = line.match(/^\s*([a-z_]+)\s*=\s*([-\d.eE+]+)\s*$/);
    if (match) totals.set(match[1].toLowerCase(), Number(match[2]));
  }
  return { plots, rows, totals };
}

/** Assert the plot split the adapter reads against, and return both plots. */
function splitPlots(run: NoiseRun, label: string) {
  const spectrum = run.plots.find((plot) => plot.vectors.includes(NOISE_VECTOR_NAMES.outputSpectrum));
  const totals = run.plots.find((plot) => plot.vectors.includes(NOISE_VECTOR_NAMES.outputTotal));
  expect(spectrum, `${label}: no plot holds ${NOISE_VECTOR_NAMES.outputSpectrum}`).toBeDefined();
  expect(totals, `${label}: no plot holds ${NOISE_VECTOR_NAMES.outputTotal}`).toBeDefined();
  if (!spectrum || !totals) throw new Error("unreachable");

  // The whole reason `extraPlots` exists: ngspice leaves the integrated totals
  // current and puts the density curves in a plot `ngSpice_CurPlot` cannot
  // reach. A build that ever flipped this would silently draw nothing.
  expect(totals.current, `${label}: the integrated totals should be the current plot`).toBe(true);
  expect(spectrum.current, `${label}: the density curves should NOT be the current plot`).toBe(false);
  expect(spectrum.name).not.toBe(totals.name);

  // Every name the adapter looks up, checked against a real run.
  expect(spectrum.vectors).toContain(NOISE_VECTOR_NAMES.scale);
  expect(spectrum.vectors).toContain(NOISE_VECTOR_NAMES.inputSpectrum);
  expect(totals.vectors).toContain(NOISE_VECTOR_NAMES.inputTotal);
  return { spectrum, totals };
}

describe.skipIf(!haveNgspice)("`.noise` through the native engine", () => {
  // in --R1-- out --R2-- 0, both 10k. The output sees R1||R2 = 5k of thermal
  // noise, flat over frequency, and the divider's gain from V1 is 0.5.
  // Pin geometry: resistor a=(x-32,y) b=(x+32,y); vsource p=(x,y-32) n=(x,y+32).
  const divider = {
    components: [vsource("V1", "0 AC 1", 100, 300), resistor("R1", "10k", 200, 268), resistor("R2", "10k", 300, 268)],
    wires: [],
    netLabels: [
      lbl(100, 268, "in"), lbl(168, 268, "in"),
      lbl(232, 268, "out"), lbl(268, 268, "out"),
      lbl(100, 332, "0"), lbl(332, 268, "0"),
    ],
  };
  const sweep = { startHz: 1, stopHz: 1e6, pointsPerDecade: 2 };

  it("agrees with the hand-computed thermal noise of a divider", () => {
    const deck = buildSpiceDeck(divider, {
      kind: "noise",
      output: { node: "out" },
      source: "V1",
      ...sweep,
    });
    expect(deck.netlist).toContain(".noise v(out) V1 dec 2 1 1000000");

    const run = runNoise(deck.netlist, "divider");
    splitPlots(run, "divider");

    // A decade sweep from 1 Hz to 1 MHz at 2 points per decade: 6 decades + 1.
    expect(run.rows).toHaveLength(13);

    // Johnson noise of R1||R2 = 5k: sqrt(4kTR) = 9.10 nV/sqrt(Hz), and with no
    // reactance it is flat across the whole sweep.
    const expectedDensity = Math.sqrt(4 * BOLTZMANN * T_DEFAULT * 5_000);
    expect(expectedDensity).toBeCloseTo(9.1e-9, 10);
    for (const row of run.rows) {
      expect(row.onoise / expectedDensity).toBeCloseTo(1, 2);
      // Referred back through a gain of 0.5, so exactly twice the output noise.
      expect(row.inoise / row.onoise).toBeCloseTo(2, 6);
    }

    // Integrating a flat density over the band is density * sqrt(bandwidth).
    const totalOutput = run.totals.get(NOISE_VECTOR_NAMES.outputTotal);
    const totalInput = run.totals.get(NOISE_VECTOR_NAMES.inputTotal);
    expect(totalOutput).toBeDefined();
    expect(totalInput).toBeDefined();
    expect(totalOutput! / (expectedDensity * Math.sqrt(sweep.stopHz - sweep.startHz))).toBeCloseTo(1, 2);
    expect(totalInput! / totalOutput!).toBeCloseTo(2, 2);

    // Same circuit on the resistor-only solver that already shipped: this is
    // the one case both engines can answer, so they have to agree.
    const ts = runNoiseAnalysis(divider, { output: { pos: "out" }, source: "V1", sweep });
    expect(ts.ok).toBe(true);
    if (!ts.ok) return;
    expect(ts.onoise[0] / run.rows[0].onoise).toBeCloseTo(1, 2);
    expect(ts.totalOutputNoise / totalOutput!).toBeCloseTo(1, 2);
  });

  // Vin -> Rb -> base, Vcc -> Rc -> collector, emitter grounded.
  // Pin geometry: npn c=(x+16,y-32) b=(x-32,y) e=(x+16,y+32).
  const commonEmitter = {
    components: [
      vsource("V1", "12", 100, 300),
      vsource("Vin", "0.75 AC 1", 150, 500),
      resistor("Rb", "100k", 250, 200),
      resistor("Rc", "10k", 350, 100),
      { id: "Q1", kind: "npn" as const, label: "Q1", value: "TAU_NPN", x: 500, y: 300, rotation: 0 as const },
    ],
    wires: [],
    netLabels: [
      lbl(100, 268, "vcc"), lbl(318, 100, "vcc"),
      lbl(100, 332, "0"), lbl(150, 532, "0"), lbl(516, 332, "0"),
      lbl(150, 468, "inp"), lbl(218, 200, "inp"),
      lbl(282, 200, "base"), lbl(468, 300, "base"),
      lbl(382, 100, "coll"), lbl(516, 268, "coll"),
    ],
    directives: [".model TAU_NPN NPN(Is=1e-14 Bf=100 Vaf=100)"],
  };

  it("reports device noise the TypeScript solver cannot", () => {
    // The point of the native path: the shipped solver has resistor thermal
    // noise only and refuses any circuit with a semiconductor in it.
    const ts = runNoiseAnalysis(commonEmitter, { output: { pos: "coll" }, source: "Vin", sweep });
    expect(ts.ok).toBe(false);

    const deck = buildSpiceDeck(commonEmitter, {
      kind: "noise",
      output: { node: "coll" },
      source: "Vin",
      ...sweep,
    });
    const run = runNoise(deck.netlist, "commonemitter");
    splitPlots(run, "common emitter");
    expect(run.rows).toHaveLength(13);

    // Rc's own thermal noise is sqrt(4kT*10k) = 12.9 nV/sqrt(Hz). The measured
    // output noise is far above it, which is the transistor's shot noise
    // amplified by the stage - exactly what the resistor-only solver misses.
    const rcThermal = Math.sqrt(4 * BOLTZMANN * T_DEFAULT * 10_000);
    for (const row of run.rows) {
      expect(row.onoise).toBeGreaterThan(rcThermal * 10);
      expect(row.onoise).toBeLessThan(1e-5);
      // The model sets no flicker coefficient, so the density stays flat.
      expect(row.onoise / run.rows[0].onoise).toBeCloseTo(1, 6);
      // An amplifying stage: referring the output noise back to the input
      // divides it down.
      expect(row.inoise).toBeLessThan(row.onoise);
    }

    const totalOutput = run.totals.get(NOISE_VECTOR_NAMES.outputTotal);
    expect(totalOutput).toBeDefined();
    expect(totalOutput! / (run.rows[0].onoise * Math.sqrt(sweep.stopHz - sweep.startHz))).toBeCloseTo(1, 2);
  });
});
