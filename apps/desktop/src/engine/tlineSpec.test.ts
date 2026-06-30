import { describe, it, expect } from "vitest";
import { parseTlineSpec, tlineDeckParams } from "./tlineSpec";

describe("parseTlineSpec", () => {
  it("parses LTspice's Td/Z0 order with SI suffixes", () => {
    const spec = parseTlineSpec("Td=30n Z0=150");
    expect(spec.z0).toBe(150);
    expect(spec.td).toBeCloseTo(30e-9, 18);
  });

  it("is order-independent (Z0 first)", () => {
    const spec = parseTlineSpec("Z0=75 Td=50n");
    expect(spec.z0).toBe(75);
    expect(spec.td).toBeCloseTo(50e-9, 18);
  });

  it("accepts the SPICE-spelled TD= and delay=", () => {
    expect(parseTlineSpec("Z0=50 TD=10n").td).toBeCloseTo(10e-9, 18);
    expect(parseTlineSpec("Z0=50 delay=2u").td).toBeCloseTo(2e-6, 15);
  });

  it("is case-insensitive on keys", () => {
    expect(parseTlineSpec("z0=100 td=1n")).toEqual({ z0: 100, td: 1e-9 });
  });

  it("defaults a missing Z0 to 50 Ω and a missing Td to 1 ns", () => {
    expect(parseTlineSpec("Td=5n")).toEqual({ z0: 50, td: 5e-9 });
    expect(parseTlineSpec("Z0=93")).toEqual({ z0: 93, td: 1e-9 });
    expect(parseTlineSpec("")).toEqual({ z0: 50, td: 1e-9 });
  });

  it("rejects non-positive / non-finite values, falling back to defaults", () => {
    expect(parseTlineSpec("Z0=0 Td=-5n")).toEqual({ z0: 50, td: 1e-9 });
    expect(parseTlineSpec("Z0=abc Td=xyz")).toEqual({ z0: 50, td: 1e-9 });
  });
});

describe("tlineDeckParams", () => {
  it("emits ngspice lossless-line params (Z0 + TD)", () => {
    expect(tlineDeckParams("Td=30n Z0=150")).toMatch(/^Z0=150 TD=3(\.0+\d*)?e-8$/);
  });

  it("fills defaults for an empty value", () => {
    expect(tlineDeckParams("")).toBe("Z0=50 TD=1e-9");
  });
});
