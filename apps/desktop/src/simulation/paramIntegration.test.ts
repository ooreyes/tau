/**
 * End-to-end proof that `.param` / `{expr}` component values resolve through the
 * solver. Same voltage-divider geometry as operatingPoint.test.ts, but every
 * value is a brace expression resolved against a ParamScope built from
 * `.param` directives - exactly the path a real imported LTspice circuit takes.
 */

import { describe, it, expect } from "vitest";
import { runOperatingPoint } from "./operatingPoint";
import { buildSpiceDeck } from "../engine/spiceNetlist";
import { buildParamScope, resolveComponentValues, substituteBraces } from "./paramScope";
import type { SchematicComponent, SchematicWire } from "../schematic/types";

let counter = 0;
const uid = (p: string) => `${p}-${++counter}`;
const vsource = (x: number, y: number, value: string, label = "V1"): SchematicComponent => ({ id: uid("vs"), kind: "vsource", x, y, rotation: 0, value, label });
const resistor = (x: number, y: number, value: string, label = "R1"): SchematicComponent => ({ id: uid("r"), kind: "resistor", x, y, rotation: 0, value, label });
const ground = (x: number, y: number): SchematicComponent => ({ id: uid("gnd"), kind: "ground", x, y, rotation: 0, value: "", label: "" });
const wire = (points: { x: number; y: number }[]): SchematicWire => ({ id: uid("w"), points });

// Vsrc=12, Rtop=1k, Rbot=3k → mid = 12 * 3k/(1k+3k) = 9 V
const params = buildParamScope([".param Vsrc=12 Rtop=1k", ".param Rbot={Rtop*3}"]);
const components = [
  vsource(0, 32, "{Vsrc}", "V1"),
  resistor(96, 0, "{Rtop}", "R1"),
  resistor(192, 0, "{Rbot}", "R2"),
  ground(0, 64),
  ground(224, 0),
];
const wires = [
  wire([{ x: 0, y: 0 }, { x: 64, y: 0 }]),
  wire([{ x: 128, y: 0 }, { x: 160, y: 0 }]),
];

describe("param-driven divider - runOperatingPoint", () => {
  it("resolves {Vsrc}/{Rtop}/{Rbot} and solves the divider", () => {
    const result = runOperatingPoint({ components, wires, params });
    if (!result.ok) throw new Error(result.message);
    const source = result.nets.find((n) => n.id !== "0" && Math.abs(n.voltage - 12) < 0.5);
    const mid = result.nets.find((n) => n.id !== "0" && Math.abs(n.voltage - 9) < 0.5);
    expect(source).toBeDefined();
    expect(mid).toBeDefined();
    expect(Math.abs((mid!.voltage - 9) / 9)).toBeLessThan(0.001);
  });

  it("without params the brace values cannot solve (proves resolution is what works)", () => {
    const result = runOperatingPoint({ components, wires });
    // No scope → {Vsrc} stays literal → value parse fails → solver reports error.
    expect(result.ok).toBe(false);
  });
});

describe("param-driven divider - buildSpiceDeck", () => {
  it("emits concrete numbers in the native netlist", () => {
    const { netlist } = buildSpiceDeck({ components, wires, params }, { kind: "op" });
    // Rtop=1000, Rbot=3000, Vsrc=12 must appear as plain numbers, no braces.
    expect(netlist).not.toContain("{");
    expect(netlist).toMatch(/\b1000\b/);
    expect(netlist).toMatch(/\b3000\b/);
    expect(netlist).toMatch(/DC 12\b/);
  });
});

describe("resolveComponentValues / substituteBraces", () => {
  it("substitutes braces inside a compound source spec", () => {
    expect(substituteBraces("PULSE(0 {Vsrc} 0 1n 1n {Rtop/1e6})", params)).toBe("PULSE(0 12 0 1n 1n 0.001)");
  });

  it("leaves non-brace values untouched", () => {
    expect(substituteBraces("10k", params)).toBe("10k");
  });

  it("evaluates a self-contained LTspice brace expression without requiring .param", () => {
    const item = resistor(0, 0, "{5.1Meg+120K}");
    const out = resolveComponentValues([item]);
    expect(out[0]).not.toBe(item);
    expect(out[0].value).toBe("5220000");
  });

  it("keeps the array fast path when no component contains braces", () => {
    const list = [resistor(0, 0, "1k")];
    expect(resolveComponentValues(list)).toBe(list);
  });

  it("only clones components that contain brace expressions", () => {
    const r1 = resistor(0, 0, "{Rtop}", "R1");
    const r2 = resistor(0, 0, "1k", "R2");
    const out = resolveComponentValues([r1, r2], params);
    expect(out[0]).not.toBe(r1);
    expect(out[0].value).toBe("1000");
    expect(out[1]).toBe(r2); // untouched, same reference
  });
});
