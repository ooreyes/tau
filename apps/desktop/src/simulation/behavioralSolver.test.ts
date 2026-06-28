/**
 * Linear behavioral B-source in the TS MNA solver.
 *
 * The interim linear solver simulates the *affine* subset of B-sources
 * (`V=const + Σ coeff·V(node)`, likewise `I=…`) by linearizing the expression.
 * Node names come from net labels, so each test labels its control net.
 *
 * Hand-computed and cross-checked against ngspice 17:
 *   B out 0 V=2*V(ctrl)        →  V(out) = 2·V(ctrl)   (ideal, load-independent)
 *   B out 0 V=2*V(ctrl)+0.5    →  V(out) = 2·V(ctrl)+0.5
 *   B out 0 I=1m*V(ctrl), R=1k →  V(out) = -1m·V(ctrl)·1k  (current pulled from out)
 */

import { describe, it, expect } from "vitest";
import { runOperatingPoint } from "./operatingPoint";
import { runTransientAnalysis } from "./linearTransient";
import { runAcSweep } from "./acSweep";
import type { NetLabel, PinOverride, SchematicComponent } from "../schematic/types";

let counter = 0;
const uid = (p: string) => `${p}-${++counter}`;

const GND = { x: 0, y: 0 };
const CTRL = { x: 100, y: 0 };
const REF = { x: 150, y: 0 };
const OUT = { x: 200, y: 0 };

type PinMap = Record<string, { x: number; y: number }>;
const overrides = (pins: PinMap): PinOverride[] =>
  Object.entries(pins).map(([id, p]) => ({ id, label: id, x: p.x, y: p.y }));

const part = (
  kind: SchematicComponent["kind"],
  value: string,
  label: string,
  pins: PinMap,
): SchematicComponent => ({ id: uid(kind), kind, x: 0, y: 0, rotation: 0, value, label, pinOverride: overrides(pins) });

const ground = () => part("ground", "", "", { g: GND });
const labelAt = (text: string, p: { x: number; y: number }): NetLabel => ({ id: uid("nl"), x: p.x, y: p.y, text });

/** Voltage of the non-ground net whose value is closest to `target`. */
function nodeNear(result: ReturnType<typeof runOperatingPoint>, target: number): number {
  if (!result.ok) throw new Error(result.message);
  let best = Infinity;
  let bestV = NaN;
  for (const net of result.nets) {
    const d = Math.abs(net.voltage - target);
    if (d < best) { best = d; bestV = net.voltage; }
  }
  return bestV;
}

describe("behavioral B-source (V=) — linear voltage", () => {
  it("outputs a gain·V(node), independent of the load", () => {
    const components = [
      part("vsource", "1", "V1", { p: CTRL, n: GND }),
      part("bsource", "V=2*V(ctrl)", "B1", { p: OUT, n: GND }),
      part("resistor", "1k", "R1", { a: OUT, b: GND }),
      ground(),
    ];
    const netLabels = [labelAt("ctrl", CTRL)];
    expect(nodeNear(runOperatingPoint({ components, wires: [], netLabels }), 2)).toBeCloseTo(2, 6);

    // 100× smaller load — ideal source, output unchanged.
    components[2] = part("resistor", "10", "R1", { a: OUT, b: GND });
    expect(nodeNear(runOperatingPoint({ components, wires: [], netLabels }), 2)).toBeCloseTo(2, 6);
  });

  it("applies a constant offset (gain·V(node) + k)", () => {
    const components = [
      part("vsource", "1", "V1", { p: CTRL, n: GND }),
      part("bsource", "V=2*V(ctrl)+0.5", "B1", { p: OUT, n: GND }),
      part("resistor", "1k", "R1", { a: OUT, b: GND }),
      ground(),
    ];
    expect(nodeNear(runOperatingPoint({ components, wires: [], netLabels: [labelAt("ctrl", CTRL)] }), 2.5)).toBeCloseTo(2.5, 6);
  });

  it("subtracts two control nodes (V=V(ctrl)-V(ref))", () => {
    const components = [
      part("vsource", "3", "V1", { p: CTRL, n: GND }),
      part("vsource", "1", "V2", { p: REF, n: GND }),
      part("bsource", "V=V(ctrl)-V(ref)", "B1", { p: OUT, n: GND }),
      part("resistor", "1k", "R1", { a: OUT, b: GND }),
      ground(),
    ];
    const netLabels = [labelAt("ctrl", CTRL), labelAt("ref", REF)];
    expect(nodeNear(runOperatingPoint({ components, wires: [], netLabels }), 2)).toBeCloseTo(2, 6);
  });

  it("resolves a parameter inside the expression", () => {
    const components = [
      part("vsource", "1", "V1", { p: CTRL, n: GND }),
      part("bsource", "V=gain*V(ctrl)", "B1", { p: OUT, n: GND }),
      part("resistor", "1k", "R1", { a: OUT, b: GND }),
      ground(),
    ];
    const params = { scope: { gain: 4 }, funcs: {} };
    expect(nodeNear(runOperatingPoint({ components, wires: [], netLabels: [labelAt("ctrl", CTRL)], params }), 4)).toBeCloseTo(4, 6);
  });
});

describe("behavioral B-source — transient", () => {
  it("an ideal behavioral amplifier holds 2·V(ctrl) across the sweep", () => {
    const components = [
      part("vsource", "1.5", "V1", { p: CTRL, n: GND }),
      part("bsource", "V=2*V(ctrl)", "B1", { p: OUT, n: GND }),
      part("capacitor", "1u", "C1", { a: OUT, b: GND }),
      part("resistor", "1k", "R1", { a: OUT, b: GND }),
      ground(),
    ];
    const result = runTransientAnalysis(
      { components, wires: [], netLabels: [labelAt("ctrl", CTRL)] },
      { stopTime: 1e-3, steps: 16 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const out = result.traces.find((t) => Math.abs(t.values[t.values.length - 1] - 3) < 1e-6);
    // V(out) = 2·1.5 = 3 V, held flat by the ideal source (load-independent).
    expect(out).toBeDefined();
    expect(out!.values.every((v) => Math.abs(v - 3) < 1e-6)).toBe(true);
  });
});

describe("behavioral B-source — AC small signal", () => {
  it("a flat-gain behavioral amplifier gives 20·log10(gain) dB at every frequency", () => {
    const components = [
      part("vac", "1 1k", "V1", { p: CTRL, n: GND }),
      part("bsource", "V=10*V(ctrl)", "B1", { p: OUT, n: GND }),
      part("resistor", "1k", "R1", { a: OUT, b: GND }),
      ground(),
    ];
    const result = runAcSweep(
      { components, wires: [], netLabels: [labelAt("ctrl", CTRL)] },
      { startHz: 10, stopHz: 1e5, pointsPerDecade: 5 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // gain 10 → 20 dB, flat (the DC bias term drops, only coupling remains).
    const out = result.traces.find((t) => Math.abs(t.magDb[0] - 20) < 0.01);
    expect(out).toBeDefined();
    expect(out!.magDb.every((db) => Math.abs(db - 20) < 0.01)).toBe(true);
  });
});

describe("behavioral B-source (I=) — linear current", () => {
  it("pulls coeff·V(node) out of its + node through the load", () => {
    // I(out→0) = 1m·V(ctrl) = 2m; V(out) = -2m·1k = -2 V (matches ngspice).
    const components = [
      part("vsource", "2", "V1", { p: CTRL, n: GND }),
      part("bsource", "I=1m*V(ctrl)", "B1", { p: OUT, n: GND }),
      part("resistor", "1k", "R1", { a: OUT, b: GND }),
      ground(),
    ];
    expect(nodeNear(runOperatingPoint({ components, wires: [], netLabels: [labelAt("ctrl", CTRL)] }), -2)).toBeCloseTo(-2, 6);
  });
});

describe("behavioral B-source — unsupported expressions", () => {
  it("fails cleanly on a nonlinear expression (directs to native engine)", () => {
    const components = [
      part("vsource", "1", "V1", { p: CTRL, n: GND }),
      part("bsource", "V=V(ctrl)*V(ctrl)", "B1", { p: OUT, n: GND }),
      part("resistor", "1k", "R1", { a: OUT, b: GND }),
      ground(),
    ];
    const result = runOperatingPoint({ components, wires: [], netLabels: [labelAt("ctrl", CTRL)] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/native engine/i);
  });

  it("fails cleanly when an expression references an unknown node", () => {
    const components = [
      part("vsource", "1", "V1", { p: CTRL, n: GND }),
      part("bsource", "V=2*V(missing)", "B1", { p: OUT, n: GND }),
      part("resistor", "1k", "R1", { a: OUT, b: GND }),
      ground(),
    ];
    const result = runOperatingPoint({ components, wires: [], netLabels: [labelAt("ctrl", CTRL)] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/unknown node/i);
  });
});
