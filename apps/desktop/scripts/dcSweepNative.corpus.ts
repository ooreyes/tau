// Real-engine proof for `.dc` on ngspice: builds the deck Tau would hand the
// native engine, runs it through the ngspice binary, and feeds the axis ngspice
// actually returns back through the adapter's own leg splitter. Three circuits -
// a divider both engines can answer, an NMOS common-source stage the TypeScript
// solver refuses outright (which is the reason this path exists) swept nested so
// the inner-major split is exercised, and a current-source sweep for the other
// half of the scale-name rule.
// Runs under vitest.corpus.config.ts only; skips without ngspice.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";
import { DC_SWEEP_SCALE, splitDcSweepLegs } from "../src/engine/nativeSpice";
import { MAX_OUTER_POINTS, runDcSweep, sweepValues } from "../src/simulation/dcSweep";
import type { NetLabel, SchematicComponent } from "../src/schematic/types";

const haveNgspice = spawnSync("ngspice", ["--version"], { encoding: "utf8" }).error === undefined;

const vsource = (label: string, value: string, x: number, y: number): SchematicComponent => ({
  id: label, kind: "vsource", label, value, x, y, rotation: 0,
});
const isource = (label: string, value: string, x: number, y: number): SchematicComponent => ({
  id: label, kind: "isource", label, value, x, y, rotation: 0,
});
const resistor = (label: string, value: string, x: number, y: number): SchematicComponent => ({
  id: label, kind: "resistor", label, value, x, y, rotation: 0,
});
const lbl = (x: number, y: number, text: string): NetLabel => ({ id: `f-${x}-${y}`, x, y, text });

interface DcRun {
  /** Every vector name ngspice reported, in its own spelling. */
  names: string[];
  /** One column per vector name, over the whole flat run. */
  columns: Map<string, number[]>;
}

/**
 * Run a `.dc` deck and read back what ngspice itself reports: the vector names
 * from `display`, and every column from `print all`. The names come from
 * ngspice's own output rather than being spelled here, which is what makes this
 * a check of DC_SWEEP_SCALE and not just of the numbers.
 *
 * The control block is this harness's own scaffolding - batch mode prints
 * nothing without one. Tau's deck never carries it; the native engine reads the
 * vectors through the shared library instead.
 */
function runDc(netlist: string, name: string): DcRun {
  const scaffolded = `${netlist.replace(/^\s*\.end\s*$/mi, "")}
.control
run
display
print all
.endc
.end
`;
  const cirPath = join(tmpdir(), `tau-dc-${name}.cir`);
  writeFileSync(cirPath, scaffolded);
  const run = spawnSync("ngspice", ["-b", cirPath], { encoding: "utf8", timeout: 60_000 });
  const out = `${run.stdout}\n${run.stderr}`;

  // `display` heads its dump with `Name: <plot> (...)`, then lists one indented
  // `vector : type` line each. Title/Name/Date sit at column 0, so requiring the
  // leading indent keeps them out.
  const dump = out.split(/here are the vectors currently active:/i)[1];
  expect(dump, `ngspice listed no vectors for ${name}:\n${out}`).toBeDefined();
  const names: string[] = [];
  for (const line of dump.split("\n")) {
    if (/^\s*Index\s/.test(line)) break;
    const vec = line.match(/^\s+([A-Za-z0-9_#().-]+)\s+:\s+\S/);
    if (vec && !names.includes(vec[1])) names.push(vec[1]);
  }

  // `print all` splits into tables of three vectors plus the index, repeating
  // the scale in each. A column is claimed by the first table to carry it, so a
  // repeat is read as the same vector printed again, not as more of it.
  const columns = new Map<string, number[]>();
  let claims: { column: string; index: number }[] = [];
  let width = 0;
  for (const line of out.split("\n")) {
    const head = line.match(/^Index\s+(.+?)\s*$/);
    if (head) {
      const header = head[1].trim().split(/\s+/);
      width = header.length;
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

/** The one vector ngspice named as the sweep axis, per the adapter's own rule. */
function axisOf(run: DcRun, label: string): number[] {
  const hits = run.names.filter((name) => DC_SWEEP_SCALE.test(name.trim()));
  expect(hits, `${label}: no sweep axis among ${run.names.join(", ")}`).toHaveLength(1);
  const axis = run.columns.get(hits[0]);
  expect(axis, `${label}: ngspice named ${hits[0]} but printed no column for it`).toBeDefined();
  return axis!;
}

describe.skipIf(!haveNgspice)("`.dc` through the native engine", () => {
  // in --R1-- out --R2-- 0, both 1k: V(out) is half the swept input.
  // Pin geometry: resistor a=(x-32,y) b=(x+32,y); vsource p=(x,y-32) n=(x,y+32).
  const divider = {
    components: [vsource("V1", "5", 100, 300), resistor("R1", "1k", 200, 268), resistor("R2", "1k", 300, 268)],
    wires: [],
    netLabels: [
      lbl(100, 268, "in"), lbl(168, 268, "in"),
      lbl(232, 268, "out"), lbl(268, 268, "out"),
      lbl(100, 332, "0"), lbl(332, 268, "0"),
    ],
  };

  it("sweeps a divider both engines can answer, on one leg", () => {
    const spec = { source: "V1", start: 0, stop: 10, step: 2.5 };
    const deck = buildSpiceDeck(divider, { kind: "dc", ...spec });
    expect(deck.netlist).toContain(".dc V1 0 10 2.5");

    const run = runDc(deck.netlist, "divider");
    const axis = axisOf(run, "divider");

    // A single-source sweep never returns to its first value, so the splitter
    // must see exactly one leg of the full length.
    const legs = splitDcSweepLegs(axis);
    expect(legs.legCount).toBe(1);
    expect(legs.legLength).toBe(5);
    expect(legs.sweep).toEqual([0, 2.5, 5, 7.5, 10]);

    // The node vectors ngspice returns are named for the deck's own nets, which
    // is what the adapter looks each series up by.
    expect(run.names).toContain("out");
    const out = run.columns.get("out")!;
    expect(out).toHaveLength(axis.length);
    axis.forEach((value, index) => expect(out[index]).toBeCloseTo(value / 2, 9));

    // Same sweep on the solver that already shipped: this is a case both
    // engines can answer, so they have to agree.
    const ts = runDcSweep(divider, spec);
    expect(ts.ok).toBe(true);
    if (!ts.ok) return;
    expect(ts.sweep).toEqual(legs.sweep);
    const tsOut = ts.nets.find((net) => net.id === "out");
    expect(tsOut).toBeDefined();
    tsOut!.voltages.forEach((value, index) => expect(value).toBeCloseTo(out[index], 9));
  });

  // Common-source stage: Vg drives the gate, Rd loads the drain from vdd,
  // source and bulk grounded. Sweeping the gate inner and the rail outer is the
  // transfer-curve family a nested `.dc` is for.
  // Pin geometry: nmos d=(x+16,y-32) g=(x-32,y) s=(x+16,y+32) b=(x+32,y).
  const commonSource = {
    components: [
      vsource("V1", "5", 100, 300),
      vsource("Vg", "0", 150, 500),
      resistor("Rd", "1k", 250, 200),
      { id: "M1", kind: "nmos" as const, label: "M1", value: "NMOS W=10u L=1u", x: 500, y: 300, rotation: 0 as const },
    ],
    wires: [],
    netLabels: [
      lbl(100, 268, "vdd"), lbl(218, 200, "vdd"),
      lbl(100, 332, "0"), lbl(150, 532, "0"), lbl(516, 332, "0"), lbl(532, 300, "0"),
      lbl(150, 468, "gate"), lbl(468, 300, "gate"),
      lbl(282, 200, "drain"), lbl(516, 268, "drain"),
    ],
  };

  /**
   * The drain voltage the shipped TAU_NMOS starter model must produce, in
   * closed form. Level 1 in saturation is Id = k(Vgs-Vto)^2 (1 + lambda*Vds)
   * with k = (Kp/2)(W/L) = 1e-3 A/V^2 here, and Vds = Vdd - Id*Rd, so
   * Id = a(1 + lambda*Vdd) / (1 + a*lambda*Rd) with a = k(Vgs-Vto)^2.
   * Below threshold the device is off and the drain sits at the rail exactly.
   */
  function expectedDrain(vgs: number, vdd: number): number {
    const K = 1e-3, VTO = 1, LAMBDA = 0.02, RD = 1_000;
    if (vgs <= VTO) return vdd;
    const a = K * (vgs - VTO) ** 2;
    return vdd - (a * (1 + LAMBDA * vdd)) / (1 + a * LAMBDA * RD) * RD;
  }

  it("sweeps a MOSFET transfer curve the TypeScript solver cannot", () => {
    const spec = {
      source: "Vg", start: 0, stop: 2.5, step: 0.25,
      source2: "V1", start2: 4, stop2: 5, step2: 0.5,
    };

    // The point of the native path: no semiconductor stamps means no answer.
    const ts = runDcSweep(commonSource, spec);
    expect(ts.ok).toBe(false);

    const deck = buildSpiceDeck(commonSource, { kind: "dc", ...spec });
    expect(deck.netlist).toContain(".dc Vg 0 2.5 0.25 V1 4 5 0.5");
    // The numbers below are this model's, so the deck has to be carrying it.
    expect(deck.netlist).toContain(".model TAU_NMOS NMOS(Level=1 Vto=1 Kp=200u Lambda=0.02)");
    expect(deck.netlist).toMatch(/^M1 drain gate 0 0 TAU_NMOS W=10u L=1u$/m);

    const run = runDc(deck.netlist, "commonsource");
    const axis = axisOf(run, "common source");

    // 11 inner points across 3 outer values, returned as one flat inner-major
    // run - the shape the whole splitter exists for.
    expect(axis).toHaveLength(33);
    const legs = splitDcSweepLegs(axis);
    expect(legs.legCount).toBe(3);
    expect(legs.legLength).toBe(11);
    expect(legs.sweep[0]).toBe(0);
    expect(legs.sweep[10]).toBeCloseTo(2.5, 9);

    // The outer values the adapter captions each leg with come from Tau's own
    // arithmetic, not from ngspice. Holding them against the rail ngspice
    // actually solved each leg at is what proves the two agree on leg order -
    // a mis-split would smear one rail's curve across another's caption.
    const outerValues = sweepValues(
      { source: "V1", start: 4, stop: 5, step: 0.5 },
      MAX_OUTER_POINTS,
    );
    expect(outerValues).toHaveLength(legs.legCount);

    const drain = run.columns.get("drain")!;
    const vdd = run.columns.get("vdd")!;
    expect(drain).toHaveLength(33);
    for (let leg = 0; leg < legs.legCount; leg += 1) {
      const from = leg * legs.legLength;
      const rail = outerValues[leg];
      for (let step = 0; step < legs.legLength; step += 1) {
        const vgs = legs.sweep[step];
        expect(vdd[from + step]).toBeCloseTo(rail, 9);
        expect(drain[from + step]).toBeCloseTo(expectedDrain(vgs, rail), 6);
      }
      // Off below threshold, pulled down above it: a real transfer curve, not a
      // flat line the closed form would also satisfy if the device never turned
      // on. Over 2 V across a 1k load is more than 2 mA of drain current.
      expect(drain[from]).toBeCloseTo(rail, 9);
      expect(rail - drain[from + legs.legLength - 1]).toBeGreaterThan(2);
    }
  });

  // I1 drives R1 to ground. The only reason this circuit is here is that
  // ngspice names the axis for the swept source's TYPE, so a current sweep is
  // the other half of the scale rule and nothing else in the repo exercises it.
  const currentDriven = {
    components: [isource("I1", "1m", 100, 300), resistor("R1", "1k", 200, 268)],
    wires: [],
    netLabels: [
      lbl(100, 268, "out"), lbl(168, 268, "out"),
      lbl(100, 332, "0"), lbl(232, 268, "0"),
    ],
  };

  it("names a current sweep's axis differently, and the rule covers both", () => {
    const spec = { source: "I1", start: 0, stop: 5e-3, step: 1e-3 };
    const deck = buildSpiceDeck(currentDriven, { kind: "dc", ...spec });
    expect(deck.netlist).toContain(".dc I1 0 0.005 0.001");

    const run = runDc(deck.netlist, "currentdriven");
    // Named `i-sweep`, not `v-sweep`, and not for the refdes: the adapter would
    // find no axis at all if it matched on the source name.
    expect(run.names).toContain("i-sweep");
    expect(run.names).not.toContain("v-sweep");
    expect(run.names).not.toContain("I1");

    const axis = axisOf(run, "current driven");
    const legs = splitDcSweepLegs(axis);
    expect(legs.legCount).toBe(1);
    expect(legs.sweep).toHaveLength(6);

    // Ohm's law across the sweep, and the sign convention Tau emits the source
    // with: a positive current raises V(p).
    const out = run.columns.get("out")!;
    axis.forEach((current, index) => expect(out[index]).toBeCloseTo(current * 1_000, 9));

    const ts = runDcSweep(currentDriven, spec);
    expect(ts.ok).toBe(true);
    if (!ts.ok) return;
    const tsOut = ts.nets.find((net) => net.id === "out");
    expect(tsOut).toBeDefined();
    tsOut!.voltages.forEach((value, index) => expect(value).toBeCloseTo(out[index], 9));
  });
});
