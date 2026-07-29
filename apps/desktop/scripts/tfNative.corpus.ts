// Real-engine proof for `.tf` on ngspice: builds the deck Tau would hand the
// native engine and runs it through the ngspice binary, checking both the
// numbers and the vector names the adapter matches on. Two circuits - a
// divider whose answer is hand-computable, and a common-emitter stage the
// TypeScript solver refuses outright, which is the reason this path exists.
// Runs under vitest.corpus.config.ts only; skips without ngspice.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";
import { TF_VECTOR_MATCHERS } from "../src/engine/nativeSpice";
import { runTransferFunction } from "../src/simulation/transferFunction";
import type { NetLabel, SchematicComponent } from "../src/schematic/types";

const haveNgspice = spawnSync("ngspice", ["--version"], { encoding: "utf8" }).error === undefined;

const vsource = (label: string, value: string, x: number, y: number): SchematicComponent => ({
  id: label, kind: "vsource", label, value, x, y, rotation: 0,
});
const resistor = (label: string, value: string, x: number, y: number): SchematicComponent => ({
  id: label, kind: "resistor", label, value, x, y, rotation: 0,
});
const lbl = (x: number, y: number, text: string): NetLabel => ({ id: `f-${x}-${y}`, x, y, text });

/**
 * Run a deck and read ngspice's printed transfer-function block back as
 * lower-cased name/value pairs - the same spelling `ngSpice_AllVecs` hands the
 * adapter, which is what makes this a check of TF_VECTOR_MATCHERS and not just
 * of the numbers.
 */
function runTf(netlist: string, name: string): Map<string, number> {
  const cirPath = join(tmpdir(), `tau-tf-${name}.cir`);
  writeFileSync(cirPath, netlist);
  const run = spawnSync("ngspice", ["-b", cirPath], { encoding: "utf8", timeout: 60_000 });
  const out = `${run.stdout}\n${run.stderr}`;
  const block = out.split(/transfer function information:/i)[1];
  expect(block, `ngspice printed no transfer function for ${name}:\n${out}`).toBeDefined();
  const scalars = new Map<string, number>();
  for (const line of block.split("\n")) {
    const match = line.match(/^\s*(\S+)\s*=\s*([-0-9.eE+]+)\s*$/);
    if (match) scalars.set(match[1].toLowerCase(), Number(match[2]));
  }
  return scalars;
}

/** The one scalar in `scalars` whose name the adapter recognises as `role`. */
function pick(scalars: Map<string, number>, role: keyof typeof TF_VECTOR_MATCHERS): number {
  const hits = [...scalars.keys()].filter(TF_VECTOR_MATCHERS[role]);
  expect(hits, `no ${role} vector among ${[...scalars.keys()].join(", ")}`).toHaveLength(1);
  return scalars.get(hits[0])!;
}

describe.skipIf(!haveNgspice)("`.tf` through the native engine", () => {
  // in --R1-- out --R2-- 0, both 1k: gain 0.5, Rin 2k, Rout 500.
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

  it("agrees with the hand-computed divider the TypeScript solver reports", () => {
    const deck = buildSpiceDeck(divider, {
      kind: "tf",
      output: { kind: "voltage", node: "out" },
      source: "V1",
    });
    expect(deck.netlist).toContain(".tf v(out) V1");

    const scalars = runTf(deck.netlist, "divider");
    expect(pick(scalars, "gain")).toBeCloseTo(0.5, 6);
    expect(pick(scalars, "inputImpedance")).toBeCloseTo(2000, 3);
    expect(pick(scalars, "outputImpedance")).toBeCloseTo(500, 3);

    // Same circuit, same three numbers, on the solver that already shipped.
    const ts = runTransferFunction(divider, { output: { kind: "voltage", pos: "out" }, source: "V1" });
    expect(ts.ok).toBe(true);
    if (!ts.ok) return;
    expect(ts.gain).toBeCloseTo(pick(scalars, "gain"), 6);
    expect(ts.inputImpedance).toBeCloseTo(pick(scalars, "inputImpedance"), 3);
    expect(ts.outputImpedance).toBeCloseTo(pick(scalars, "outputImpedance"), 3);
  });

  // Vin -> Rb -> base, Vcc -> Rc -> collector, emitter grounded.
  // Pin geometry: npn c=(x+16,y-32) b=(x-32,y) e=(x+16,y+32).
  const commonEmitter = {
    components: [
      vsource("V1", "12", 100, 300),
      vsource("Vin", "0.75", 150, 500),
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

  it("takes a gain the TypeScript solver cannot", () => {
    // The point of the native path: no semiconductor stamps means no answer.
    const ts = runTransferFunction(commonEmitter, { output: { kind: "voltage", pos: "coll" }, source: "Vin" });
    expect(ts.ok).toBe(false);

    const deck = buildSpiceDeck(commonEmitter, {
      kind: "tf",
      output: { kind: "voltage", node: "coll" },
      source: "Vin",
    });
    const scalars = runTf(deck.netlist, "commonemitter");

    // An inverting stage biased in the active region. The collector current is
    // exponential in Vbe, so the gain is bounded rather than pinned; the two
    // impedances are set by the resistors and are checked tightly.
    const gain = pick(scalars, "gain");
    expect(gain).toBeLessThan(-5);
    expect(gain).toBeGreaterThan(-500);
    // Rout = Rc || ro, and ro = Vaf/Ic is megohms here, so Rc dominates.
    expect(pick(scalars, "outputImpedance")).toBeGreaterThan(9_000);
    expect(pick(scalars, "outputImpedance")).toBeLessThan(10_000);
    // Rin = Rb + rpi, so the base junction shows up as more than the resistor.
    expect(pick(scalars, "inputImpedance")).toBeGreaterThan(100_000);
  });
});
