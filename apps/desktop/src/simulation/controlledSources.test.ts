/**
 * Linear controlled sources: VCVS (E) and VCCS (G).
 *
 * Connectivity here is built with explicit `pinOverride` world coordinates so
 * each test fully controls which pins share a node (coincident pins merge into
 * one net, exactly as in the real extractor). Three named points are used:
 *   GND = (0,0)   CP = (100,0)   OUT = (200,0)
 *
 * Every expected value is hand-computed and cross-checked against ngspice 17:
 *   E op 0 cp 0 gain →  V(op) = gain·V(cp)            (ideal, load-independent)
 *   G op 0 cp 0 gm   →  V(op) = -gm·R_load·V(cp)      (current pulled from op)
 */

import { describe, it, expect } from "vitest";
import { runOperatingPoint } from "./operatingPoint";
import { runTransientAnalysis } from "./linearTransient";
import { runAcSweep } from "./acSweep";
import { buildSpiceDeck } from "../engine/spiceNetlist";
import type { PinOverride, SchematicComponent } from "../schematic/types";

let counter = 0;
const uid = (p: string) => `${p}-${++counter}`;

const GND = { x: 0, y: 0 };
const CP = { x: 100, y: 0 };
const OUT = { x: 200, y: 0 };

type PinMap = Record<string, { x: number; y: number }>;
const overrides = (pins: PinMap): PinOverride[] =>
  Object.entries(pins).map(([id, p]) => ({ id, label: id, x: p.x, y: p.y }));

const part = (
  kind: SchematicComponent["kind"],
  value: string,
  label: string,
  pins: PinMap,
): SchematicComponent => ({
  id: uid(kind),
  kind,
  x: 0,
  y: 0,
  rotation: 0,
  value,
  label,
  pinOverride: overrides(pins),
});

const ground = () => part("ground", "", "", { g: GND });

/** Voltage of the non-ground net whose value is closest to `target`. */
function nodeNear(result: ReturnType<typeof runOperatingPoint>, target: number): number {
  if (!result.ok) throw new Error(result.message);
  let best = Infinity;
  let bestV = NaN;
  for (const net of result.nets) {
    const d = Math.abs(net.voltage - target);
    if (d < best) {
      best = d;
      bestV = net.voltage;
    }
  }
  return bestV;
}

describe("VCVS (E) — voltage-controlled voltage source", () => {
  it("outputs gain·V(control), independent of the load", () => {
    const components = [
      part("vsource", "1", "V1", { p: CP, n: GND }),
      part("vcvs", "10", "E1", { cp: CP, cn: GND, op: OUT, on: GND }),
      part("resistor", "1k", "R1", { a: OUT, b: GND }),
      ground(),
    ];
    const result = runOperatingPoint({ components, wires: [] });
    expect(result.ok).toBe(true);
    expect(nodeNear(result, 10)).toBeCloseTo(10, 6);
  });

  it("load resistance does not change the output (ideal source)", () => {
    const big = [
      part("vsource", "1", "V1", { p: CP, n: GND }),
      part("vcvs", "10", "E1", { cp: CP, cn: GND, op: OUT, on: GND }),
      part("resistor", "47", "R1", { a: OUT, b: GND }),
      ground(),
    ];
    expect(nodeNear(runOperatingPoint({ components: big, wires: [] }), 10)).toBeCloseTo(10, 6);
  });

  it("honours a negative gain (inverting)", () => {
    const components = [
      part("vsource", "2", "V1", { p: CP, n: GND }),
      part("vcvs", "-5", "E1", { cp: CP, cn: GND, op: OUT, on: GND }),
      part("resistor", "2k", "R1", { a: OUT, b: GND }),
      ground(),
    ];
    // V(o) = -5 · 2 = -10  (matches ngspice)
    expect(nodeNear(runOperatingPoint({ components, wires: [] }), -10)).toBeCloseTo(-10, 6);
  });

  it("a difference amplifier subtracts its two control nodes", () => {
    // cp at 3 V, cn at 1 V → V(op) = gain·(3−1) = 2·2 = 4
    const CN = { x: 150, y: 0 };
    const components = [
      part("vsource", "3", "V1", { p: CP, n: GND }),
      part("vsource", "1", "V2", { p: CN, n: GND }),
      part("vcvs", "2", "E1", { cp: CP, cn: CN, op: OUT, on: GND }),
      part("resistor", "1k", "R1", { a: OUT, b: GND }),
      ground(),
    ];
    expect(nodeNear(runOperatingPoint({ components, wires: [] }), 4)).toBeCloseTo(4, 6);
  });
});

describe("VCCS (G) — voltage-controlled current source", () => {
  it("drives gm·V(control) into the load (current pulled from op)", () => {
    // V(out) = -gm·R·V(cp) = -1e-3·1000·1 = -1 V  (matches ngspice)
    const components = [
      part("vsource", "1", "V1", { p: CP, n: GND }),
      part("vccs", "1m", "G1", { cp: CP, cn: GND, op: OUT, on: GND }),
      part("resistor", "1k", "R1", { a: OUT, b: GND }),
      ground(),
    ];
    expect(nodeNear(runOperatingPoint({ components, wires: [] }), -1)).toBeCloseTo(-1, 6);
  });

  it("transconductance scales linearly with gm and load", () => {
    // gm = 2 mS, R = 1k, Vc = 1 → V(out) = -2 V
    const components = [
      part("vsource", "1", "V1", { p: CP, n: GND }),
      part("vccs", "2m", "G1", { cp: CP, cn: GND, op: OUT, on: GND }),
      part("resistor", "1k", "R1", { a: OUT, b: GND }),
      ground(),
    ];
    expect(nodeNear(runOperatingPoint({ components, wires: [] }), -2)).toBeCloseTo(-2, 6);
  });
});

describe("controlled sources in transient analysis", () => {
  it("VCVS tracks a DC control level over time", () => {
    const components = [
      part("vsource", "1", "V1", { p: CP, n: GND }),
      part("vcvs", "10", "E1", { cp: CP, cn: GND, op: OUT, on: GND }),
      part("resistor", "1k", "R1", { a: OUT, b: GND }),
      ground(),
    ];
    const result = runTransientAnalysis({ components, wires: [] }, { stopTime: 1e-3, steps: 16 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const out = result.traces.find((t) => Math.abs(t.values[t.values.length - 1] - 10) < 1e-6);
    expect(out).toBeDefined();
    // VCVS branch current follows the same MNA sign convention as I(Vsrc):
    // the reported value is the negative of the conventional current out of op,
    // i.e. −V(out)/R = −10/1000 = −10 mA.
    const e1 = result.currents.find((c) => c.ref === "E1");
    expect(e1?.values[e1.values.length - 1]).toBeCloseTo(-0.01, 6);
  });
});

describe("controlled sources in AC analysis", () => {
  it("VCVS gives a flat gain·input across frequency", () => {
    const components = [
      part("vac", "1 1k", "V1", { p: CP, n: GND }),
      part("vcvs", "10", "E1", { cp: CP, cn: GND, op: OUT, on: GND }),
      part("resistor", "1k", "R1", { a: OUT, b: GND }),
      ground(),
    ];
    const result = runAcSweep({ components, wires: [] }, { startHz: 10, stopHz: 1e5, pointsPerDecade: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Output node sits at gain·1 = 10 → 20·log10(10) = 20 dB, flat.
    const out = result.traces.find((t) => Math.abs(t.magDb[0] - 20) < 0.01);
    expect(out).toBeDefined();
    if (!out) return;
    for (const db of out.magDb) expect(db).toBeCloseTo(20, 3);
  });
});

describe("controlled sources in the ngspice deck", () => {
  it("emits E and G lines with control nodes and gain", () => {
    const components = [
      part("vsource", "1", "V1", { p: CP, n: GND }),
      part("vcvs", "10", "E1", { cp: CP, cn: GND, op: OUT, on: GND }),
      part("vccs", "1m", "G1", { cp: CP, cn: GND, op: OUT, on: GND }),
      part("resistor", "1k", "R1", { a: OUT, b: GND }),
      ground(),
    ];
    const { netlist } = buildSpiceDeck({ components, wires: [] }, { kind: "op" });
    const eLine = netlist.split("\n").find((l) => l.startsWith("E1 "));
    const gLine = netlist.split("\n").find((l) => l.startsWith("G1 "));
    expect(eLine).toBeDefined();
    expect(gLine).toBeDefined();
    // 5 fields after the ref-des: op on cp cn gain
    expect(eLine!.trim().split(/\s+/)).toHaveLength(6);
    expect(eLine!.trim().split(/\s+/).pop()).toBe("10");
    expect(gLine!.trim().split(/\s+/).pop()).toBe("0.001");
  });
});
