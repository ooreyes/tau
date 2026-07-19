import { describe, it, expect } from "vitest";
import { parseTfDirective, runTransferFunction } from "./transferFunction";
import type { NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";

// ---------------------------------------------------------------------------
// parseTfDirective
// ---------------------------------------------------------------------------

describe("parseTfDirective", () => {
  it("parses V(node) output and a source", () => {
    expect(parseTfDirective(".tf V(out) V1")).toEqual({
      output: { kind: "voltage", pos: "out", neg: undefined },
      source: "V1",
    });
  });

  it("parses a differential V(a,b) output with spaces", () => {
    expect(parseTfDirective("!tf V(out, ref) Vin")).toEqual({
      output: { kind: "voltage", pos: "out", neg: "ref" },
      source: "Vin",
    });
  });

  it("parses an I(device) output", () => {
    expect(parseTfDirective(".tf I(Vsense) Iin")).toEqual({
      output: { kind: "current", device: "Vsense" },
      source: "Iin",
    });
  });

  it("accepts a bare output node", () => {
    expect(parseTfDirective(".tf out V1")).toEqual({
      output: { kind: "voltage", pos: "out", neg: undefined },
      source: "V1",
    });
  });

  it("returns null for non-tf or malformed lines", () => {
    expect(parseTfDirective(".tran 1m")).toBeNull();
    expect(parseTfDirective(".tf V(out)")).toBeNull(); // missing source
    expect(parseTfDirective(".tf")).toBeNull();
    expect(parseTfDirective("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runTransferFunction - hand-computed resistive divider
// ---------------------------------------------------------------------------
//
//   in ---R1--- out ---R2--- gnd      (R1 = R2 = 1k)
//   |                          |
//   V1+                       V1-/gnd
//
// Voltage input V1:
//   gain  V(out)/V1 = R2/(R1+R2)            = 0.5
//   Rin   looking into V1 = R1 + R2         = 2000 Ω
//   Rout  at "out" = R1 ∥ R2                = 500 Ω

function dividerWithLabels(): {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels: NetLabel[];
} {
  const components: SchematicComponent[] = [
    { id: "v1", label: "V1", kind: "vsource", x: 0, y: 0, rotation: 0, value: "5",
      pinOverride: [
        { id: "p", label: "+", x: 0, y: 0 },
        { id: "n", label: "-", x: 0, y: 100 },
      ] },
    { id: "r1", label: "R1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k",
      pinOverride: [
        { id: "a", label: "a", x: 0, y: 0 },
        { id: "b", label: "b", x: 0, y: 50 },
      ] },
    { id: "r2", label: "R2", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k",
      pinOverride: [
        { id: "a", label: "a", x: 0, y: 50 },
        { id: "b", label: "b", x: 0, y: 100 },
      ] },
    { id: "g", label: "", kind: "ground", x: 0, y: 100, rotation: 0, value: "",
      pinOverride: [{ id: "g", label: "gnd", x: 0, y: 100 }] },
  ];
  const netLabels: NetLabel[] = [
    { id: "lin", x: 0, y: 0, text: "in" },
    { id: "lout", x: 0, y: 50, text: "out" },
  ];
  return { components, wires: [], netLabels };
}

describe("runTransferFunction - voltage input", () => {
  it("computes gain, input and output impedance of a 1k:1k divider", () => {
    const sch = dividerWithLabels();
    const res = runTransferFunction(sch, parseTfDirective(".tf V(out) V1")!);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.gain).toBeCloseTo(0.5, 9);
    expect(res.gainUnit).toBe("");
    expect(res.inputImpedance).toBeCloseTo(2000, 6);
    expect(res.outputImpedance).toBeCloseTo(500, 6);
    expect(res.gainLabel).toBe("V(out)/V1");
  });

  it("differential output V(out,in) equals V(out) − V(in)", () => {
    const sch = dividerWithLabels();
    // V(in) tracks the source (gain 1), so V(out)-V(in) = 0.5 - 1 = -0.5.
    const res = runTransferFunction(sch, parseTfDirective(".tf V(out,in) V1")!);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.gain).toBeCloseTo(-0.5, 9);
  });

  it("errors when the output node is not labelled", () => {
    const sch = dividerWithLabels();
    const res = runTransferFunction(sch, { output: { kind: "voltage", pos: "nope" }, source: "V1" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toMatch(/not found/);
  });

  it("errors on an unknown source", () => {
    const sch = dividerWithLabels();
    const res = runTransferFunction(sch, parseTfDirective(".tf V(out) V9")!);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toMatch(/not found/);
  });

  it("errors when the named source is not an independent source", () => {
    const sch = dividerWithLabels();
    const res = runTransferFunction(sch, parseTfDirective(".tf V(out) R1")!);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toMatch(/not an independent source/);
  });
});

// ---------------------------------------------------------------------------
// runTransferFunction - current input
// ---------------------------------------------------------------------------
//
//   in ---R1--- gnd      (R1 = 2k), I1 injects into "in".
//   gain  V(in)/I1 = R1 = 2000 Ω (transimpedance)
//   Rin   = R1     = 2000 Ω
//   Rout  at "in"  = R1 = 2000 Ω

function currentDrivenResistor(): {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels: NetLabel[];
} {
  const components: SchematicComponent[] = [
    { id: "i1", label: "I1", kind: "isource", x: 0, y: 0, rotation: 0, value: "1m",
      pinOverride: [
        { id: "p", label: "+", x: 0, y: 0 },
        { id: "n", label: "-", x: 0, y: 100 },
      ] },
    { id: "r1", label: "R1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "2k",
      pinOverride: [
        { id: "a", label: "a", x: 0, y: 0 },
        { id: "b", label: "b", x: 0, y: 100 },
      ] },
    { id: "g", label: "", kind: "ground", x: 0, y: 100, rotation: 0, value: "",
      pinOverride: [{ id: "g", label: "gnd", x: 0, y: 100 }] },
  ];
  const netLabels: NetLabel[] = [{ id: "lin", x: 0, y: 0, text: "in" }];
  return { components, wires: [], netLabels };
}

describe("runTransferFunction - current input", () => {
  it("reports transimpedance gain and matching impedances", () => {
    const sch = currentDrivenResistor();
    const res = runTransferFunction(sch, parseTfDirective(".tf V(in) I1")!);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.gain).toBeCloseTo(2000, 6); // V per A
    expect(res.gainUnit).toBe("Ω");
    expect(res.inputImpedance).toBeCloseTo(2000, 6);
    expect(res.outputImpedance).toBeCloseTo(2000, 6);
  });
});
