import { describe, it, expect } from "vitest";
import { parsePotentiometerSpec, potentiometerLegs, DEFAULT_WIPER } from "./potentiometerSpec";

describe("parsePotentiometerSpec", () => {
  it("defaults a bare value to a centred wiper", () => {
    expect(parsePotentiometerSpec("10k")).toEqual({ resistanceText: "10k", wiper: 0.5 });
  });

  it("extracts a Wiper= token, tolerant of spaces around =", () => {
    expect(parsePotentiometerSpec("10k Wiper=0.25")).toEqual({ resistanceText: "10k", wiper: 0.25 });
    expect(parsePotentiometerSpec("10k wiper = 0.25")).toEqual({ resistanceText: "10k", wiper: 0.25 });
  });

  it("is token-order independent", () => {
    expect(parsePotentiometerSpec("Wiper=0.8 4k7")).toEqual({ resistanceText: "4k7", wiper: 0.8 });
  });

  it("falls back to the default wiper for out-of-range or unparseable fractions", () => {
    expect(parsePotentiometerSpec("10k Wiper=1.5").wiper).toBe(DEFAULT_WIPER);
    expect(parsePotentiometerSpec("10k Wiper=-0.2").wiper).toBe(DEFAULT_WIPER);
    expect(parsePotentiometerSpec("10k Wiper=abc").wiper).toBe(DEFAULT_WIPER);
  });
});

describe("potentiometerLegs", () => {
  it("splits the track at the wiper fraction, trimmed of binary-float noise", () => {
    expect(potentiometerLegs(10000, 0.3)).toEqual({ a: 3000, b: 7000 });
  });

  it("sums to the track resistance for interior fractions", () => {
    for (const wiper of [0.25, 0.3, 0.5, 0.8]) {
      const legs = potentiometerLegs(10000, wiper);
      expect(legs.a + legs.b).toBe(10000);
    }
  });

  it("keeps a strictly positive leg on both sides at a fully-rotated wiper", () => {
    const atA = potentiometerLegs(10000, 0);
    expect(atA.a).toBeGreaterThan(0);
    expect(atA.b).toBeGreaterThan(0);

    const atB = potentiometerLegs(10000, 1);
    expect(atB.a).toBeGreaterThan(0);
    expect(atB.b).toBeGreaterThan(0);
  });
});
