// Real-engine proof for `.op` on ngspice: builds the deck Tau would hand the
// native engine, runs it through the ngspice binary, and holds the operating
// point's CURRENT contract against what a real run returns. The voltages were
// already covered by the acceptance corpus; the currents shipped with their
// engine-facing assumptions checked only by hand at a shell prompt.
//
// The one that matters is the SIGN. ngspice's `<ref>#branch` on an `.op` run and
// the TypeScript solver's `branches` unknown are two independently-authored
// conventions that happen to agree, so `runNativeOperatingPoint` deliberately
// stores ngspice's value UNFLIPPED. If they did not agree, every source current
// in the table would read backwards while every voltage stayed correct - a
// plausible wrong number, which is the worst failure an engineering tool has.
// A unit test pins that the adapter performs no flip; what it cannot check is
// whether "no flip" is the RIGHT answer, because it feeds its own mocked vector.
// That is this file's job: the two engines are run on one circuit and their
// branch currents compared, against hand arithmetic as well as each other.
//
// Also under test: an `.op` run has no scale vector of its own, names nodes bare
// the way a transient does, gives a resistor and a capacitor no current at all,
// and yields a semiconductor's own current only because the deck named it in a
// `.save` card whose `all` keeps it additive - so a passive's DC current is
// Tau's to reconstruct, and its sign is checked here against one the engine did
// return.
// Runs under vitest.corpus.config.ts only; skips without ngspice.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";
import { deriveDcRcBranches } from "../src/simulation/currents";
import { runOperatingPoint } from "../src/simulation/operatingPoint";
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

interface OpRun {
  /** Every vector name ngspice reported, in its own spelling. */
  names: string[];
  /** The single value of each vector - an `.op` plot is one row. */
  values: Map<string, number>;
}

/**
 * Run an `.op` deck and read back what ngspice itself reports: the vector names
 * from `display`, and every value from `print all`. The names come from
 * ngspice's own output rather than being spelled here, which is what makes this
 * a check of the read side's lookups and not just of the numbers.
 *
 * An operating point is a ONE-ROW plot, and `print all` switches form for one:
 * instead of the paginated `Index / <headers>` table a transient prints, it
 * emits a `name = value` line per vector. Requiring the `=` is also what keeps
 * ngspice's own batch-mode `.op` summary - which lists `name value` in columns,
 * followed by every parameter of every model - out of the parse.
 *
 * The control block is this harness's own scaffolding; batch mode prints nothing
 * without one. Tau's deck never carries it - the native engine reads the vectors
 * through the shared library instead.
 */
function runOp(netlist: string, name: string): OpRun {
  const scaffolded = `${netlist.replace(/^\s*\.end\s*$/mi, "")}
.control
run
display
print all
.endc
.end
`;
  const cirPath = join(tmpdir(), `tau-op-${name}.cir`);
  writeFileSync(cirPath, scaffolded);
  const run = spawnSync("ngspice", ["-b", cirPath], { encoding: "utf8", timeout: 120_000 });
  const out = `${run.stdout}\n${run.stderr}`;

  // `display` heads its dump with `Title/Name/Date` at column 0, then lists one
  // indented `vector : type` line each, so requiring the leading indent keeps
  // the header out.
  const dump = out.split(/here are the vectors currently active:/i)[1];
  expect(dump, `ngspice listed no vectors for ${name}:\n${out}`).toBeDefined();
  const names: string[] = [];
  for (const line of dump.split("\n")) {
    const vec = line.match(/^\s+([A-Za-z0-9_#@().[\]-]+)\s+:\s+\S/);
    if (vec && !names.includes(vec[1])) names.push(vec[1]);
    // The value listing starts where the vector listing ends.
    if (/^\S+\s*=\s*/.test(line)) break;
  }

  const values = new Map<string, number>();
  for (const line of out.split("\n")) {
    const cell = line.match(/^([A-Za-z0-9_#@().[\]-]+)\s*=\s*(-?[\d.]+(?:[eE][-+]?\d+)?)\s*$/);
    if (!cell || values.has(cell[1])) continue;
    const value = Number(cell[2]);
    if (Number.isFinite(value)) values.set(cell[1], value);
  }
  return { names, values };
}

const value = (run: OpRun, name: string): number => {
  const found = run.values.get(name);
  expect(found, `ngspice printed no value for ${name}; it has ${[...run.values.keys()].join(", ")}`)
    .toBeDefined();
  return found!;
};

/**
 * Two legs off one rail, so the source current is a sum rather than a single
 * resistor's and cannot be matched by accident. An inductor is a short at DC,
 * which puts `tap` at `mid`, and a capacitor is an open, so C1 across the rail
 * changes no current here - it is present to prove that ngspice gives neither
 * passive a current vector.
 *
 *   V1 5V -> in ->  R1 2k -> mid -> L1 -> tap -> R2 1k -> 0
 *                   R3 470k ------------------------------> 0
 *                   C1 1u --------------------------------> 0
 *
 * Pin geometry: resistor, capacitor and inductor are horizontal two-terminal
 * parts, a=(x-32,y) b=(x+32,y); vsource p=(x,y-32) n=(x,y+32).
 */
const twoLegLadder = {
  components: [
    vsource("V1", "5", 100, 300),
    resistor("R1", "2k", 200, 268),
    inductor("L1", "1m", 300, 268),
    resistor("R2", "1k", 400, 268),
    resistor("R3", "470k", 200, 400),
    capacitor("C1", "1u", 200, 500),
  ],
  wires: [],
  netLabels: [
    lbl(100, 268, "in"), lbl(168, 268, "in"), lbl(168, 400, "in"), lbl(168, 500, "in"),
    lbl(232, 268, "mid"), lbl(268, 268, "mid"),
    lbl(332, 268, "tap"), lbl(368, 268, "tap"),
    lbl(100, 332, "0"), lbl(432, 268, "0"), lbl(232, 400, "0"), lbl(232, 500, "0"),
  ],
};

// Closed form at DC: the inductor is a short, the capacitor an open.
const LEG_A = 5 / 3000;        // in -> R1 -> L1 -> R2 -> 0
const LEG_B = 5 / 470000;      // in -> R3 -> 0
const SOURCE_OUT = LEG_A + LEG_B;
// `print` carries about six significant digits, which sets the floor on every
// comparison against a printed value, so they are made relatively.
const PRINTED_DIGITS = 1e-5;

const closeRelative = (actual: number, expected: number, tolerance = PRINTED_DIGITS): void => {
  expect(
    Math.abs(actual - expected),
    `expected ${actual} to be within ${tolerance} of ${expected}, relatively`,
  ).toBeLessThan(Math.abs(expected) * tolerance);
};

describe.skipIf(!haveNgspice)("`.op` through the native engine", () => {
  it("names nodes bare, has no scale of its own, and gives no passive a current", () => {
    const deck = buildSpiceDeck(twoLegLadder, { kind: "op" });
    expect(deck.netlist).toMatch(/^\.op$/m);

    const run = runOp(deck.netlist, "names");

    // Nodes come back WITHOUT the `v(...)` wrapper, exactly as on a transient,
    // which is why the read side strips it before looking one up.
    expect(run.names).toContain("in");
    expect(run.names).toContain("mid");
    expect(run.names).not.toContain("v(in)");
    // Ground is not a vector, which is why the adapter filters it out and
    // prepends its own GND row at 0 V rather than expecting one back.
    expect(run.names).not.toContain("0");

    // No independent axis: an operating point is a single row and ngspice marks
    // one of the node vectors as the default scale instead of returning a scale
    // vector. A read side that insisted on one - the way the transient path
    // requires `time` - would reject every operating point.
    expect(run.names).not.toContain("time");
    expect(run.names.some((vector) => vector.endsWith("-sweep"))).toBe(false);
    for (const vector of run.names) expect(run.values.get(vector)).toBeDefined();

    // The source and the inductor get a current for free. The resistors and the
    // capacitor get NOTHING, under any spelling - which is why their DC currents
    // are Tau's to reconstruct rather than to read back, and why the case below
    // has to check the derived sign against a vector the engine did return.
    expect(run.names).toContain("v1#branch");
    expect(run.names).toContain("l1#branch");
    for (const passive of ["r1#branch", "r2#branch", "r3#branch", "c1#branch", "i(r1)", "i(c1)"]) {
      expect(run.names).not.toContain(passive);
    }

    // No device current either: this deck has no semiconductor, so it emits no
    // `.save` card at all and nothing asks ngspice for an `@...` vector.
    expect(deck.deviceCurrents).toEqual([]);
    expect(deck.netlist).not.toMatch(/^\.save/m);
    expect(run.names.some((vector) => vector.startsWith("@"))).toBe(false);
  });

  it("returns a source current NEGATIVE of the current it delivers, matching the solver unflipped", () => {
    const deck = buildSpiceDeck(twoLegLadder, { kind: "op" });
    const run = runOp(deck.netlist, "sign");

    // The voltages first, so the currents below are being read off a circuit
    // that solved the way the closed form says.
    closeRelative(value(run, "in"), 5);
    closeRelative(value(run, "mid"), 5 - 2000 * LEG_A);
    closeRelative(value(run, "tap"), value(run, "mid"));   // the inductor is a short at DC

    // THE SIGN. V1 delivers 1.677 mA out of its + terminal into the two legs,
    // and ngspice reports `v1#branch` as the NEGATIVE of that - it is the raw
    // MNA branch unknown, the current flowing into the + node from inside the
    // source, not the conventional delivered current.
    const sourceBranch = value(run, "v1#branch");
    expect(sourceBranch).toBeLessThan(0);
    closeRelative(sourceBranch, -SOURCE_OUT);
    // Not just any negative number: the legs' own total, so a value that had
    // been flipped, halved, or taken from one leg fails here.
    closeRelative(-sourceBranch, (5 - value(run, "mid")) / 2000 + 5 / 470000);

    // The inductor's is the current from its FIRST node to its second, so it is
    // positive down the leg it sits in - the opposite sign to the source that
    // drives it, even though the same current flows round the loop.
    const inductorBranch = value(run, "l1#branch");
    expect(inductorBranch).toBeGreaterThan(0);
    closeRelative(inductorBranch, LEG_A);

    // And the reason `runNativeOperatingPoint` stores both of those UNFLIPPED:
    // the TypeScript solver, whose `branches` contract was written independently
    // of ngspice, reports the same two numbers with the same two signs. This is
    // the check a unit test cannot make - it can only prove the adapter does not
    // flip, not that not flipping is correct.
    const ts = runOperatingPoint(twoLegLadder, { returnBranches: true });
    expect(ts.ok).toBe(true);
    if (!ts.ok) return;
    const tsBranches = new Map((ts.branches ?? []).map((branch) => [branch.label, branch.current]));
    expect([...tsBranches.keys()].sort()).toEqual(["I(L1)", "I(V1)"]);
    closeRelative(tsBranches.get("I(V1)")!, sourceBranch);
    closeRelative(tsBranches.get("I(L1)")!, inductorBranch);
    // Both are non-trivial and of OPPOSITE sign, so the agreement above is not
    // two zeros or two copies of one number.
    expect(tsBranches.get("I(V1)")! * tsBranches.get("I(L1)")!).toBeLessThan(0);
    expect(Math.abs(tsBranches.get("I(V1)")!)).toBeGreaterThan(1e-4);

    // The voltages agree too, which is what makes the pair comparable at all.
    const tsNets = new Map(ts.nets.map((net) => [net.id, net.voltage]));
    closeRelative(tsNets.get("mid")!, value(run, "mid"));
  });

  it("derives a passive's current with the same sign as the inductor branch ngspice returned", () => {
    // The passives are the half of the table ngspice supplies nothing for, so
    // unlike the source and the inductor above there is no engine vector to
    // compare `I(R1)` against directly. What makes the sign checkable anyway is
    // that R1, L1 and R2 sit in ONE series leg: whatever convention the derived
    // current follows, it has to come out equal to `l1#branch` - a number the
    // engine did return - or Tau is reporting two elements of one loop as
    // carrying current in opposite directions.
    const deck = buildSpiceDeck(twoLegLadder, { kind: "op" });
    const run = runOp(deck.netlist, "passives");

    // Fed the way the read side feeds it: ngspice's own node voltages, with
    // ground supplied explicitly because it is not a vector.
    const voltageByNet = new Map<string, number>();
    for (const net of deck.circuit.nets) {
      voltageByNet.set(net.id, net.isGround ? 0 : value(run, net.id.toLowerCase()));
    }
    const derived = new Map(
      deriveDcRcBranches(deck.circuit.components, voltageByNet).map((b) => [b.label, b.current]),
    );
    // Every passive in the ladder and nothing else - the source and the inductor
    // are the engine's to report, not this function's.
    expect([...derived.keys()].sort()).toEqual(["I(C1)", "I(R1)", "I(R2)", "I(R3)"]);

    // THE SIGN, against a vector ngspice returned. R1 runs `in` -> `mid` and R2
    // runs `tap` -> `0`, both down the leg L1 sits in, so all three are the same
    // current: positive, and equal to `l1#branch` to the printed digits.
    const inductorBranch = value(run, "l1#branch");
    expect(inductorBranch).toBeGreaterThan(0);
    closeRelative(derived.get("I(R1)")!, inductorBranch);
    closeRelative(derived.get("I(R2)")!, inductorBranch);

    // And the source, whose sign is the opposite one, is the negative of the two
    // legs' derived currents summed. This is the check a flip cannot survive:
    // it holds two DERIVED numbers against one the engine produced, through KCL
    // at `in`, where the only paths off the node are R1, R3 and the source.
    const sourceBranch = value(run, "v1#branch");
    expect(sourceBranch).toBeLessThan(0);
    closeRelative(-sourceBranch, derived.get("I(R1)")! + derived.get("I(R3)")!);
    // Both legs are real contributors, so the sum above cannot pass on one term.
    closeRelative(derived.get("I(R1)")!, LEG_A);
    closeRelative(derived.get("I(R3)")!, LEG_B);
    expect(derived.get("I(R3)")!).toBeGreaterThan(0);

    // The capacitor is exactly zero, not merely small: at a DC operating point
    // it holds its voltage, and it has 5 V across it here, so a value that
    // tracked the node voltage instead would be conspicuous.
    expect(derived.get("I(C1)")).toBe(0);
    closeRelative(value(run, "in"), 5);
  });

  it("reports a transistor's own current on a circuit the TypeScript solver refuses", () => {
    // Common-emitter stage with a second path off the collector node, so KCL at
    // `coll` involves the transistor AND an inductor rather than being the whole
    // of one resistor's current. That is what makes the device vector checkable
    // against vectors ngspice returned separately.
    //
    //   V1 5V -> vdd -> Rc 2k -> coll -> Q1 collector
    //            vdd -> Rb 470k -> base   coll -> L1 -> tap -> Rl 5k -> 0
    //
    // Pin geometry: npn c=(x+16,y-32) b=(x-32,y) e=(x+16,y+32).
    const amplifier = {
      components: [
        vsource("V1", "5", 100, 300),
        resistor("Rc", "2k", 250, 200),
        resistor("Rb", "470k", 250, 400),
        inductor("L1", "1m", 700, 200),
        resistor("Rl", "5k", 850, 200),
        { id: "Q1", kind: "npn" as const, label: "Q1", value: "NPN", x: 500, y: 300, rotation: 0 as const },
      ],
      wires: [],
      netLabels: [
        lbl(100, 268, "vdd"), lbl(218, 200, "vdd"), lbl(218, 400, "vdd"),
        lbl(100, 332, "0"), lbl(516, 332, "0"), lbl(882, 200, "0"),
        lbl(282, 400, "base"), lbl(468, 300, "base"),
        lbl(282, 200, "coll"), lbl(516, 268, "coll"), lbl(668, 200, "coll"),
        lbl(732, 200, "tap"), lbl(818, 200, "tap"),
      ],
    };

    // The reason the native path exists: the shipped solver has no semiconductor
    // stamps, so this operating point has no answer at all without ngspice.
    expect(runOperatingPoint(amplifier, { returnBranches: true }).ok).toBe(false);

    const deck = buildSpiceDeck(amplifier, { kind: "op" });
    expect(deck.netlist).toMatch(/^Q1 coll base 0 /m);

    // The card the read side depends on, taken from the deck's own record of
    // what it asked for rather than spelled here - the same record
    // `runNativeOperatingPoint` looks the vector up by, so the ask and the read
    // cannot drift apart in this proof either.
    // A BJT's three terminals are all asked for; only the untagged one - the
    // collector - is what `I(Q1)` means, and the operating-point table reads
    // that one alone, since a `branches` entry is keyed by component id.
    expect(deck.deviceCurrents).toEqual([
      { componentId: "Q1", vector: "@q1[ic]" },
      { componentId: "Q1", vector: "@q1[ib]", terminal: "b" },
      { componentId: "Q1", vector: "@q1[ie]", terminal: "e" },
    ]);
    const saved = deck.deviceCurrents.find((current) => !current.terminal)!.vector;
    expect(saved).toBe("@q1[ic]");
    expect(deck.netlist).toMatch(/^\.save all @q1\[ic\] @q1\[ib\] @q1\[ie\]$/m);

    const run = runOp(deck.netlist, "amplifier");

    // Present only under the name the deck saved. A semiconductor never gets a
    // `#branch`; that form is for sources and inductors.
    expect(run.names).toContain(saved);
    expect(run.names).not.toContain("q1#branch");

    // Biased into the active region rather than sitting at a rail, so the
    // current below is a real bias point and not a saturated corner.
    const vdd = value(run, "vdd");
    const coll = value(run, "coll");
    closeRelative(vdd, 5);
    expect(coll).toBeGreaterThan(0.3);
    expect(coll).toBeLessThan(4.7);

    // The real collector current: `coll` is joined only by Rc, the collector and
    // L1, so KCL there is exact - the current in through Rc leaves as Ic plus
    // the inductor's. Checked against three vectors ngspice returned
    // separately, so a mis-read, wrongly-scaled or wrong-terminal device vector
    // cannot pass.
    const ic = value(run, saved);
    const inductorBranch = value(run, "l1#branch");
    expect(ic).toBeGreaterThan(0);          // into the collector, so positive for an NPN
    closeRelative(ic + inductorBranch, (vdd - coll) / 2000);
    // Both terms matter: neither is small enough for the sum to pass on the
    // other alone, which is what makes this a check of `@q1[ic]` and not of Rc.
    expect(ic).toBeGreaterThan(Math.abs(inductorBranch) * 0.05);
    closeRelative(inductorBranch, coll / 5000);

    // The source current is still the negative of what it delivers, on a circuit
    // with a semiconductor in it: everything leaving `vdd` goes down Rc or Rb.
    const sourceBranch = value(run, "v1#branch");
    expect(sourceBranch).toBeLessThan(0);
    closeRelative(-sourceBranch, (vdd - coll) / 2000 + (vdd - value(run, "base")) / 470000);
  });

  it("keeps every vector a run without the `.save` returned, because the card says `all`", () => {
    // The trap this pins, on an `.op` deck rather than the transient one where
    // it was first proved: a bare `.save @q1[ic]` REPLACES ngspice's default set
    // instead of adding to it. Dropping `all` would strip every node voltage and
    // every source branch current from the operating point - the analysis still
    // succeeds and still populates a table, with almost nothing in it, and
    // nothing in the result says so.
    const diodeLadder = {
      components: [
        vsource("V1", "5", 100, 300),
        resistor("R1", "1k", 250, 300),
        { id: "D1", kind: "diode" as const, label: "D1", value: "D", x: 400, y: 300, rotation: 0 as const },
      ],
      wires: [],
      netLabels: [
        lbl(100, 268, "vdd"), lbl(218, 300, "vdd"),
        lbl(282, 300, "anode"), lbl(368, 300, "anode"),
        lbl(432, 300, "0"), lbl(100, 332, "0"),
      ],
    };

    const deck = buildSpiceDeck(diodeLadder, { kind: "op" });
    expect(deck.deviceCurrents).toEqual([{ componentId: "D1", vector: "@d1[id]" }]);

    const isSaveCard = (line: string): boolean => /^(\.save|\+ @)/.test(line);
    const withSave = runOp(deck.netlist, "save-superset");
    const withoutSave = runOp(
      deck.netlist.split("\n").filter((line) => !isSaveCard(line)).join("\n"),
      "save-baseline",
    );
    // The same card with `all` removed - the one-word mutation the emitter's
    // comment warns about, run against the engine instead of trusted.
    const withoutAll = runOp(
      deck.netlist.split("\n").map((line) => (isSaveCard(line) ? line.replace(".save all", ".save") : line)).join("\n"),
      "save-noall",
    );

    // Everything the plain run returned is still here, spelling for spelling.
    expect(withoutSave.names.length).toBeGreaterThan(2);
    for (const name of withoutSave.names) expect(withSave.names).toContain(name);
    // Plus exactly the device current the card asked for, which the plain run
    // did not have - so the comparison above is not two identical sets.
    expect(withoutSave.names).not.toContain("@d1[id]");
    expect(withSave.names).toContain("@d1[id]");

    // And without `all`, the run collapses to the named vector alone: no node
    // voltages, no source branch. This is the silent failure `all` prevents.
    expect(withoutAll.names).toEqual(["@d1[id]"]);
    expect(withoutAll.names).not.toContain("v1#branch");
    expect(withoutAll.names).not.toContain("anode");
  });
});
