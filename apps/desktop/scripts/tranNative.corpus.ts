// Real-engine proof for `.tran` on ngspice: builds the deck Tau would hand the
// native engine, runs it through the ngspice binary, and holds the adapter's
// engine-facing assumptions against what a real run returns. `.tran` is the
// highest-traffic analysis in the app and the one whose vector contract was
// only ever checked against mocked vectors.
//
// What is under test here is naming and shape, not arithmetic ngspice owns:
// the `time` scale, node vectors arriving bare rather than as `v(x)`, the
// `<ref>#branch` spelling the current ladder leads with, the non-uniform
// timestep the sample statistics have to describe, and `deriveRcCurrents`
// standing in for the device currents ngspice does not return.
// Runs under vitest.corpus.config.ts only; skips without ngspice.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";
import { deriveRcCurrents } from "../src/simulation/currents";
import { runTransientAnalysis } from "../src/simulation/linearTransient";
import type { NetLabel, SchematicComponent } from "../src/schematic/types";

const haveNgspice = spawnSync("ngspice", ["--version"], { encoding: "utf8" }).error === undefined;

const vsource = (label: string, value: string, x: number, y: number): SchematicComponent => ({
  id: label, kind: "vsource", label, value, x, y, rotation: 0,
});
const resistor = (label: string, value: string, x: number, y: number): SchematicComponent => ({
  id: label, kind: "resistor", label, value, x, y, rotation: 0,
});
const capacitor = (label: string, value: string, x: number, y: number): SchematicComponent => ({
  id: label, kind: "capacitor", label, value, x, y, rotation: 0,
});
const inductor = (label: string, value: string, x: number, y: number): SchematicComponent => ({
  id: label, kind: "inductor", label, value, x, y, rotation: 0,
});
const lbl = (x: number, y: number, text: string): NetLabel => ({ id: `f-${x}-${y}`, x, y, text });

interface TranRun {
  /** Every vector name ngspice reported, in its own spelling. */
  names: string[];
  /** One column per vector name, over the whole run. */
  columns: Map<string, number[]>;
}

/**
 * Run a `.tran` deck and read back what ngspice itself reports: the vector
 * names from `display`, and every column from `print all`. The names come from
 * ngspice's own output rather than being spelled here, which is what makes
 * this a check of the adapter's lookups and not just of the numbers.
 *
 * The control block is this harness's own scaffolding - batch mode prints
 * nothing without one. Tau's deck never carries it; the native engine reads
 * the vectors through the shared library instead.
 */
function runTran(netlist: string, name: string): TranRun {
  const scaffolded = `${netlist.replace(/^\s*\.end\s*$/mi, "")}
.control
run
display
print all
.endc
.end
`;
  const cirPath = join(tmpdir(), `tau-tran-${name}.cir`);
  writeFileSync(cirPath, scaffolded);
  const run = spawnSync("ngspice", ["-b", cirPath], { encoding: "utf8", timeout: 120_000 });
  const out = `${run.stdout}\n${run.stderr}`;

  // `display` heads its dump with `Name: <plot> (...)`, then lists one indented
  // `vector : type` line each. Title/Name/Date sit at column 0, so requiring
  // the leading indent keeps them out.
  const dump = out.split(/here are the vectors currently active:/i)[1];
  expect(dump, `ngspice listed no vectors for ${name}:\n${out}`).toBeDefined();
  const names: string[] = [];
  for (const line of dump.split("\n")) {
    if (/^\s*Index\s/.test(line)) break;
    const vec = line.match(/^\s+([A-Za-z0-9_#().[\]-]+)\s+:\s+\S/);
    if (vec && !names.includes(vec[1])) names.push(vec[1]);
  }

  // `print all` splits into groups of vectors, repeating the scale in each,
  // and PAGINATES each group - the same header comes back every ~50 rows. A
  // transient run is long enough to hit that, so a repeated header has to be
  // read as more of the same columns while a new one starts a new group. A
  // column is claimed by the first group to carry it, so the scale is not
  // collected twice; within one header a repeat is the same vector printed
  // again, not another column.
  const columns = new Map<string, number[]>();
  let claims: { column: string; index: number }[] = [];
  let group = "";
  let width = 0;
  for (const line of out.split("\n")) {
    const head = line.match(/^Index\s+(.+?)\s*$/);
    if (head) {
      const header = head[1].trim().split(/\s+/);
      width = header.length;
      // Another page of the group already being read: keep its claims so the
      // rows below append instead of being dropped on the floor.
      if (head[1] === group) continue;
      group = head[1];
      claims = [];
      header.forEach((column, index) => {
        if (columns.has(column)) return;
        columns.set(column, []);
        claims.push({ column, index });
      });
      continue;
    }
    if (width === 0) continue;
    const cells = line.trim().split(/\s+/);
    if (cells.length !== width + 1 || !/^\d+$/.test(cells[0])) continue;
    const values = cells.slice(1).map(Number);
    if (values.some((value) => !Number.isFinite(value))) continue;
    for (const claim of claims) columns.get(claim.column)!.push(values[claim.index]);
  }
  return { names, columns };
}

const column = (run: TranRun, name: string): number[] => {
  const values = run.columns.get(name);
  expect(values, `ngspice printed no column for ${name}; it has ${[...run.columns.keys()].join(", ")}`).toBeDefined();
  return values!;
};

describe.skipIf(!haveNgspice)("`.tran` through the native engine", () => {
  // A 5 V step into 1k / 1u, so V(out) is a textbook exponential with a 1 ms
  // time constant. Pin geometry: resistor, capacitor and inductor are all
  // horizontal two-terminal parts, a=(x-32,y) b=(x+32,y); vsource p=(x,y-32)
  // n=(x,y+32).
  const rcStep = {
    components: [
      vsource("V1", "PULSE(0 5 0 1n 1n 10m 20m)", 100, 300),
      resistor("R1", "1k", 200, 268),
      capacitor("C1", "1u", 300, 300),
    ],
    wires: [],
    netLabels: [
      lbl(100, 268, "in"), lbl(168, 268, "in"),
      lbl(232, 268, "out"), lbl(268, 300, "out"),
      lbl(100, 332, "0"), lbl(332, 300, "0"),
    ],
  };

  it("names the scale `time` and the node vectors bare, not `v(node)`", () => {
    const deck = buildSpiceDeck(rcStep, { kind: "tran", stopTime: 5e-3, steps: 500 });
    expect(deck.netlist).toContain(".tran 0.00001 0.005");

    const run = runTran(deck.netlist, "rcnames");

    // The adapter reads the axis as `time` and every trace as `v(<net>)`.
    // ngspice returns the axis under that name but the nodes WITHOUT the
    // `v(...)` wrapper, which is the whole reason `nodeVectorName` strips it -
    // a literal lookup would find no traces at all and the adapter would throw.
    expect(run.names).toContain("time");
    expect(run.names).toContain("out");
    expect(run.names).not.toContain("v(out)");

    // Ground is not returned as a vector, which is why the adapter filters it
    // out of the trace list rather than expecting a flat zero series.
    expect(run.names).not.toContain("0");
  });

  it("returns an adaptive, non-uniform timestep, so the first interval is not the step", () => {
    // 500 output steps across 5 ms: a uniform grid would be 10 us apart.
    const deck = buildSpiceDeck(rcStep, { kind: "tran", stopTime: 5e-3, steps: 500 });
    const run = runTran(deck.netlist, "rcstep");
    const time = column(run, "time");

    expect(time.length).toBeGreaterThan(2);
    expect(time[0]).toBe(0);
    expect(time[time.length - 1]).toBeCloseTo(5e-3, 9);

    // The bug this pins: ngspice opens the run with a tiny step while it finds
    // the solution, so `time[1] - time[0]` is orders of magnitude below the
    // requested 10 us and reporting it as the step size is simply false.
    const firstInterval = time[1] - time[0];
    expect(firstInterval).toBeGreaterThan(0);
    expect(firstInterval).toBeLessThan(1e-6);

    // What the adapter reports instead: the average interval over the samples
    // that actually came back, which is the requested step to within the
    // extra points ngspice inserts where the waveform moves fastest.
    const span = time[time.length - 1] - time[0];
    const average = span / (time.length - 1);
    expect(average).toBeGreaterThan(0);
    expect(average).toBeLessThanOrEqual(1e-5);
    expect(average).toBeGreaterThan(1e-7);

    // Non-uniform in fact, not just in principle - otherwise the average and
    // the first interval would agree and this test would prove nothing.
    const intervals = time.slice(1).map((t, i) => t - time[i]);
    expect(Math.max(...intervals)).toBeGreaterThan(Math.min(...intervals) * 10);
  });

  it("solves the RC step the shipped solver also answers, and both match theory", async () => {
    const options = { stopTime: 5e-3, steps: 500 };
    const deck = buildSpiceDeck(rcStep, { kind: "tran", ...options });
    const run = runTran(deck.netlist, "rctheory");
    const time = column(run, "time");
    const out = column(run, "out");
    expect(out).toHaveLength(time.length);

    // V(out) = 5 (1 - e^(-t/RC)), RC = 1 ms, checked at ngspice's own sample
    // times so the time axis and the trace are proved against each other.
    time.forEach((t, index) => {
      expect(out[index]).toBeCloseTo(5 * (1 - Math.exp(-t / 1e-3)), 4);
    });
    // Actually charging: a flat line would satisfy nothing above but is worth
    // excluding explicitly.
    expect(out[out.length - 1]).toBeGreaterThan(4.9);

    // The solver that already shipped answers this one too. ngspice returns
    // its own non-uniform grid and the TypeScript solver a uniform one, so the
    // two are held against the same closed form rather than against each
    // other's samples. The shipped solver integrates by backward Euler, whose
    // error at this step size runs to about 9 mV on the 5 V step, so it gets a
    // looser bound than ngspice's - still under 0.3% of full scale, and tight
    // enough that losing the RC term or getting the time constant wrong fails.
    const ts = await runTransientAnalysis(rcStep, options);
    expect(ts.ok).toBe(true);
    if (!ts.ok) return;
    const tsOut = ts.traces.find((trace) => trace.id === "out");
    expect(tsOut).toBeDefined();
    const worst = Math.max(...ts.times.map((t, index) =>
      Math.abs(tsOut!.values[index] - 5 * (1 - Math.exp(-t / 1e-3)))));
    expect(worst).toBeLessThan(1.5e-2);
    expect(tsOut!.values[tsOut!.values.length - 1]).toBeGreaterThan(4.9);
  });

  it("returns source and inductor currents as `<ref>#branch`, the ladder's first rung", () => {
    // An inductor in series with the load gives a second `#branch` vector, and
    // it is the only component kind besides a source that produces one.
    const rlc = {
      components: [
        vsource("V1", "PULSE(0 5 0 1n 1n 10m 20m)", 100, 300),
        inductor("L1", "1m", 200, 268),
        resistor("R1", "1k", 300, 268),
      ],
      wires: [],
      netLabels: [
        lbl(100, 268, "in"), lbl(168, 268, "in"),
        lbl(232, 268, "mid"), lbl(268, 268, "mid"),
        lbl(100, 332, "0"), lbl(332, 268, "0"),
      ],
    };
    const deck = buildSpiceDeck(rlc, { kind: "tran", stopTime: 1e-3, steps: 200 });
    const run = runTran(deck.netlist, "rlbranch");

    // Lower-cased by ngspice regardless of the refdes Tau emitted, which is
    // why the adapter's lookup normalises case on both sides.
    expect(deck.netlist).toMatch(/^V1 in 0 /m);
    expect(run.names).toContain("v1#branch");
    expect(run.names).toContain("l1#branch");

    // The other two rungs of the ladder are absent from a real run: ngspice
    // does not name a current `i(<ref>)`, and a device vector needs a `.save`
    // Tau's deck does not emit. They are defensive, not the normal path.
    expect(run.names).not.toContain("i(r1)");
    expect(run.names.some((name) => name.startsWith("@"))).toBe(false);

    // Series circuit: the source branch carries the inductor's current, with
    // ngspice's sign convention on a source (current INTO the + terminal).
    const source = column(run, "v1#branch");
    const inductorCurrent = column(run, "l1#branch");
    // `print all` carries about six significant digits, which sets the floor
    // on every comparison against a printed column.
    source.forEach((value, index) => expect(value).toBeCloseTo(-inductorCurrent[index], 8));

    // Settled at 5 mA through the 1k, with the 1 us L/R corner long past.
    expect(inductorCurrent[inductorCurrent.length - 1]).toBeCloseTo(5e-3, 6);
  });

  it("derives the resistor and capacitor currents ngspice never returns", () => {
    const options = { stopTime: 5e-3, steps: 500 };
    const deck = buildSpiceDeck(rcStep, { kind: "tran", ...options });
    const run = runTran(deck.netlist, "rccurrents");
    const time = column(run, "time");

    // Neither R1 nor C1 has a current vector of its own in the run, which is
    // the gap `deriveRcCurrents` exists to fill.
    expect(run.names).not.toContain("r1#branch");
    expect(run.names).not.toContain("c1#branch");

    // Feed the real node voltages, on ngspice's real non-uniform grid, through
    // the shipped derivation - the capacitor branch divides by a per-sample dt,
    // so a uniform-grid assumption would show up here as a wrong current.
    const nodeVoltages = new Map<string, number[]>([
      ["in", column(run, "in")],
      ["out", column(run, "out")],
    ]);
    const derived = deriveRcCurrents(deck.circuit.components, nodeVoltages, time);
    const byRef = new Map(derived.map((trace) => [trace.ref, trace.values]));
    expect([...byRef.keys()].sort()).toEqual(["C1", "R1"]);

    // Series RC: the resistor and capacitor carry the same current, and it is
    // the source's, so the derivation is checked against a vector ngspice DID
    // return rather than against itself. The capacitor's is a backward
    // difference, so it lags by one sample on a curve - compare where the
    // exponential is flattest, over the last fifth of the run.
    const source = column(run, "v1#branch");
    const r1 = byRef.get("R1")!;
    const c1 = byRef.get("C1")!;
    expect(r1).toHaveLength(time.length);
    expect(c1).toHaveLength(time.length);
    for (let index = Math.floor(time.length * 0.8); index < time.length; index += 1) {
      expect(r1[index]).toBeCloseTo(-source[index], 8);
      // The capacitor's is a backward difference over a curve, so it carries
      // its own dt/2 * dI/dt error rather than matching to the printed digits.
      expect(Math.abs(c1[index] - r1[index])).toBeLessThan(Math.abs(r1[index]) * 0.02);
    }

    // At t = 0+ the capacitor is a short, so the full 5 mA flows; by 5 ms
    // (5 time constants) it is essentially over. A derivation that silently
    // returned zeros would pass the settled comparison above but not this.
    expect(Math.max(...r1)).toBeCloseTo(5e-3, 4);
    expect(r1[r1.length - 1]).toBeLessThan(1e-4);
  });

  it("runs a transistor transient the TypeScript solver refuses outright", async () => {
    // Common-emitter stage driven by a 1 kHz sine. The reason the native path
    // exists: the shipped solver has no semiconductor stamps, so this circuit
    // has no answer at all without ngspice.
    // Pin geometry: npn c=(x+16,y-32) b=(x-32,y) e=(x+16,y+32).
    const amplifier = {
      components: [
        vsource("V1", "5", 100, 300),
        vsource("Vin", "SINE(0.8 0.02 1k)", 150, 500),
        resistor("Rb", "10k", 250, 400),
        resistor("Rc", "2k", 250, 200),
        { id: "Q1", kind: "npn" as const, label: "Q1", value: "NPN", x: 500, y: 300, rotation: 0 as const },
      ],
      wires: [],
      netLabels: [
        lbl(100, 268, "vdd"), lbl(218, 200, "vdd"),
        lbl(100, 332, "0"), lbl(150, 532, "0"), lbl(516, 332, "0"),
        lbl(150, 468, "src"), lbl(218, 400, "src"),
        lbl(282, 400, "base"), lbl(468, 300, "base"),
        lbl(282, 200, "coll"), lbl(516, 268, "coll"),
      ],
    };

    const options = { stopTime: 3e-3, steps: 300 };
    const ts = await runTransientAnalysis(amplifier, options);
    expect(ts.ok).toBe(false);

    const deck = buildSpiceDeck(amplifier, { kind: "tran", ...options });
    expect(deck.netlist).toMatch(/^Q1 coll base 0 /m);

    const run = runTran(deck.netlist, "amplifier");
    const time = column(run, "time");
    const coll = column(run, "coll");
    expect(time.length).toBeGreaterThan(50);

    // Biased into the active region: the collector sits between the rails
    // rather than saturated at either one.
    const settled = coll.slice(Math.floor(coll.length / 3));
    const low = Math.min(...settled);
    const high = Math.max(...settled);
    expect(low).toBeGreaterThan(0.2);
    expect(high).toBeLessThan(4.8);

    // And it is amplifying: 40 mV peak-to-peak in produces a much larger swing
    // at the collector.
    const src = column(run, "src");
    const inputSwing = Math.max(...src) - Math.min(...src);
    expect(inputSwing).toBeCloseTo(0.04, 3);
    expect(high - low).toBeGreaterThan(inputSwing * 5);

    // Inverting, which is the qualitative signature of a common-emitter stage
    // and does not depend on the model's beta: where the drive peaks the
    // collector is at the bottom of its own range. A stage that was merely
    // following its input - or a mis-read column - would fail this.
    const peak = src.indexOf(Math.max(...src));
    expect(coll[peak]).toBeLessThan((low + high) / 2);

    // The transistor's own current is NOT in the run - ngspice returns no
    // device vector without a `.save`, and `deriveRcCurrents` only covers R and
    // C. This is the documented gap, pinned so it cannot close silently.
    expect(run.names).not.toContain("q1#branch");
    expect(run.names.some((name) => name.toLowerCase().includes("q1"))).toBe(false);
  });
});
