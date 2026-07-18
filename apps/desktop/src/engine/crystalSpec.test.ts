import { describe, it, expect } from "vitest";
import { parseCrystal, crystalDeckLines } from "./crystalSpec";

describe("parseCrystal", () => {
  it("returns null for a plain capacitor value (no crystal params)", () => {
    expect(parseCrystal("100n")).toBeNull();
    expect(parseCrystal("0.25p")).toBeNull();
    expect(parseCrystal("1u IC=2")).toBeNull();
    expect(parseCrystal("")).toBeNull();
  });

  it("recognises an LTspice xtal value and parses all four elements", () => {
    // Pierce.asc Y1: `0.25p Rser=0.1 Lser=0.001 Cpar=5e-011`.
    expect(parseCrystal("0.25p Rser=0.1 Lser=0.001 Cpar=5e-011")).toEqual({
      cser: 0.25e-12,
      lser: 0.001,
      rser: 0.1,
      cpar: 5e-11,
    });
  });

  it("requires the motional Lser signature and is order-independent", () => {
    expect(parseCrystal("1p Lser=1m")).not.toBeNull();
    expect(parseCrystal("1p Cpar=3p")).toBeNull();
    const a = parseCrystal("2p Cpar=4p Lser=2m Rser=5");
    expect(a).toEqual({ cser: 2e-12, lser: 2e-3, rser: 5, cpar: 4e-12 });
  });

  it("falls back to inert defaults for a missing/garbled field instead of throwing", () => {
    const spec = parseCrystal("bogus Lser=oops Cpar=");
    // Lser present → recognised; unparsable numbers default (cser 1p, lser 1m,
    // rser 0, cpar 0) so the deck still builds.
    expect(spec).toEqual({ cser: 1e-12, lser: 1e-3, rser: 0, cpar: 0 });
  });
});

describe("crystalDeckLines", () => {
  it("expands into a motional Lser-Cser-Rser branch plus the Cpar shunt", () => {
    const spec = parseCrystal("0.25p Rser=0.1 Lser=0.001 Cpar=5e-011")!;
    expect(crystalDeckLines("CY1", "a", "b", spec)).toEqual([
      "LCY1 a CY1_m 0.001",
      "CCY1 CY1_m CY1_r 2.5e-13",
      "RCY1 CY1_r b 0.1",
      "CCY1p a b 5e-11",
    ]);
  });

  it("collapses the series resistor when Rser is 0 (motional C ties straight to b)", () => {
    const spec = { cser: 1e-12, lser: 1e-3, rser: 0, cpar: 2e-12 };
    expect(crystalDeckLines("CX", "n1", "n2", spec)).toEqual([
      "LCX n1 CX_m 0.001",
      "CCX CX_m n2 1e-12",
      "CCXp n1 n2 2e-12",
    ]);
  });

  it("drops the shunt line when Cpar is 0", () => {
    const spec = { cser: 1e-12, lser: 1e-3, rser: 10, cpar: 0 };
    expect(crystalDeckLines("CX", "a", "b", spec)).toEqual([
      "LCX a CX_m 0.001",
      "CCX CX_m CX_r 1e-12",
      "RCX CX_r b 10",
    ]);
  });
});
