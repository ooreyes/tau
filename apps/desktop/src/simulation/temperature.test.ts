/**
 * Coverage for the resistor temperature model (FEATURE_PARITY §4 `.temp` /
 * `.step temp`). All expectations are hand-computed against LTspice's tempco law
 * `R(T) = R0·(1 + tc1·ΔT + tc2·ΔT²)`, ΔT = T − 27 °C.
 */

import { describe, it, expect } from "vitest";
import {
  TNOM_C,
  stripTcSpec,
  parseResistorTemp,
  resistanceAtTemperature,
  applyTemperature,
} from "./temperature";
import type { SchematicComponent } from "../schematic/types";

let counter = 0;
const uid = (p: string) => `${p}-${++counter}`;
const resistor = (value: string, label = "R1"): SchematicComponent => ({ id: uid("r"), kind: "resistor", x: 0, y: 0, rotation: 0, value, label });
const cap = (value: string): SchematicComponent => ({ id: uid("c"), kind: "capacitor", x: 0, y: 0, rotation: 0, value, label: "C1" });

describe("stripTcSpec", () => {
  it("removes a single-coefficient tc token", () => {
    expect(stripTcSpec("1k tc=0.001")).toBe("1k");
  });
  it("removes a two-coefficient tc token (comma or space separated)", () => {
    expect(stripTcSpec("4.7k tc=0.001,1e-6")).toBe("4.7k");
    expect(stripTcSpec("4.7k tc=0.001 1e-6")).toBe("4.7k");
  });
  it("tolerates whitespace around the equals sign and is case-insensitive", () => {
    expect(stripTcSpec("100 TC = -2e-3")).toBe("100");
  });
  it("leaves a plain value untouched", () => {
    expect(stripTcSpec("10meg")).toBe("10meg");
  });
});

describe("parseResistorTemp", () => {
  it("splits magnitude and coefficients", () => {
    const spec = parseResistorTemp("2k tc=0.005,2e-6");
    expect(spec.resistance).toBe(2000);
    expect(spec.tc1).toBe(0.005);
    expect(spec.tc2).toBe(2e-6);
  });
  it("defaults coefficients to zero when no tc spec", () => {
    const spec = parseResistorTemp("330");
    expect(spec).toEqual({ resistance: 330, tc1: 0, tc2: 0 });
  });
  it("throws on an unparsable magnitude (e.g. a param expression)", () => {
    expect(() => parseResistorTemp("{Rload}")).toThrow();
  });
});

describe("resistanceAtTemperature", () => {
  const spec = { resistance: 1000, tc1: 0.004, tc2: 1e-6 };
  it("returns R0 at Tnom", () => {
    expect(resistanceAtTemperature(spec, TNOM_C)).toBeCloseTo(1000, 9);
  });
  it("applies the linear + quadratic law above Tnom", () => {
    // ΔT = 100: 1000·(1 + 0.004·100 + 1e-6·100²) = 1000·(1 + 0.4 + 0.01) = 1410.
    expect(resistanceAtTemperature(spec, 127)).toBeCloseTo(1410, 6);
  });
  it("applies below Tnom (negative ΔT)", () => {
    // ΔT = -27: 1000·(1 - 0.108 + 1e-6·729) = 1000·0.892729 = 892.729.
    expect(resistanceAtTemperature(spec, 0)).toBeCloseTo(892.729, 6);
  });
  it("with zero coefficients is temperature-independent", () => {
    expect(resistanceAtTemperature({ resistance: 470, tc1: 0, tc2: 0 }, 200)).toBe(470);
  });
});

describe("applyTemperature", () => {
  it("rescales only tc-bearing resistors and preserves the rest", () => {
    const comps = [resistor("1k tc=0.01", "R1"), resistor("2k", "R2"), cap("1u")];
    const out = applyTemperature(comps, 77); // ΔT = 50 → R1 = 1000·1.5 = 1500.
    expect(Number(out[0].value)).toBeCloseTo(1500, 6);
    expect(out[1]).toBe(comps[1]); // untouched reference (no tc)
    expect(out[2]).toBe(comps[2]); // capacitor untouched
  });
  it("does not mutate the input list", () => {
    const comps = [resistor("1k tc=0.01", "R1")];
    applyTemperature(comps, 100);
    expect(comps[0].value).toBe("1k tc=0.01");
  });
  it("leaves an unparsable resistor value for the solver to handle", () => {
    const comps = [resistor("{Rload} tc=0.01", "R1")];
    const out = applyTemperature(comps, 100);
    expect(out[0]).toBe(comps[0]);
  });
});
