import { describe, expect, it } from "vitest";
import {
  compactEngineeringMantissa,
  composeEngineeringValue,
  engineeringSpelling,
  isEngineeringMantissa,
  isEngineeringMantissaDraft,
  splitEngineeringValue,
} from "./engineering";
import { parseQuantity } from "../simulation/quantity";

describe("engineering value controls", () => {
  it("treats m and M both as milli (LTspice suffix rules)", () => {
    expect(splitEngineeringValue("4.7m", "H")).toEqual({ mantissa: "4.7", prefix: "m" });
    expect(splitEngineeringValue("4.7M", "Ω")).toEqual({ mantissa: "4.7", prefix: "m" });
  });

  it("normalizes micro and mega spellings for the selector", () => {
    expect(splitEngineeringValue("10µ", "F")).toEqual({ mantissa: "10", prefix: "u" });
    expect(splitEngineeringValue("10μ", "F")).toEqual({ mantissa: "10", prefix: "u" });
    expect(splitEngineeringValue("1meg", "Hz")).toEqual({ mantissa: "1", prefix: "Meg" });
    expect(splitEngineeringValue("1Meg", "Hz")).toEqual({ mantissa: "1", prefix: "Meg" });
    expect(splitEngineeringValue("1MEG", "Hz")).toEqual({ mantissa: "1", prefix: "Meg" });
  });

  it("accepts uppercase forms of every suffix case-insensitively", () => {
    expect(splitEngineeringValue("1K", "Ω")).toEqual({ mantissa: "1", prefix: "k" });
    expect(splitEngineeringValue("1G", "Hz")).toEqual({ mantissa: "1", prefix: "G" });
    expect(splitEngineeringValue("2N", "F")).toEqual({ mantissa: "2", prefix: "n" });
    expect(splitEngineeringValue("2P", "F")).toEqual({ mantissa: "2", prefix: "p" });
    expect(splitEngineeringValue("2U", "F")).toEqual({ mantissa: "2", prefix: "u" });
  });

  it("preserves values it cannot represent instead of dropping the suffix", () => {
    // `mil` (25.4µ) has no dropdown slot; the raw text must survive round-trip.
    expect(splitEngineeringValue("1mil", "")).toEqual({ mantissa: "1mil", prefix: "" });
    expect(splitEngineeringValue("1x", "")).toEqual({ mantissa: "1x", prefix: "" });
    expect(composeEngineeringValue("1mil", "")).toBe("1mil");
  });

  it("composes mega as Meg so the deck reads back as mega, not milli", () => {
    expect(composeEngineeringValue("4.7", "Meg")).toBe("4.7Meg");
  });

  it("composes values back into solver-compatible syntax", () => {
    expect(composeEngineeringValue("2.2", "k")).toBe("2.2k");
    expect(composeEngineeringValue("47", "n")).toBe("47n");
  });

  it("accepts incomplete typing locally only after it becomes a valid number", () => {
    expect(isEngineeringMantissa("1.")).toBe(true);
    expect(isEngineeringMantissa("-")).toBe(false);
    expect(isEngineeringMantissaDraft("-")).toBe(true);
    expect(isEngineeringMantissaDraft("1e-")).toBe(true);
    expect(isEngineeringMantissaDraft("english")).toBe(false);
  });

  it("compacts overlong numbers to exponential notation for display", () => {
    expect(compactEngineeringMantissa("123456789012")).toBe("1.23456789e11");
    expect(compactEngineeringMantissa("4.7")).toBe("4.7");
  });
});

/**
 * Display spelling. The panel shows a value the way it is stored, which is
 * right almost always and wrong at the extremes - `1000` where a datasheet
 * writes `1 kΩ`, `0.000003` where it writes `3 µm`.
 */
describe("engineeringSpelling", () => {
  it("gives a bare number past the plain-decimal band its prefix", () => {
    expect(engineeringSpelling("1000", "Ω")).toBe("1k");
    expect(engineeringSpelling("0.000003", "m")).toBe("3µ");
    expect(engineeringSpelling("4700", "Ω")).toBe("4.7k");
    expect(engineeringSpelling("2e-7", "F")).toBe("200n");
  });

  it("never overrules a prefix the author already chose", () => {
    // `50n` and `0.05µ` are the same number; they picked the decade they
    // think in, and re-spelling it would fight the person typing.
    expect(engineeringSpelling("50n", "s")).toBe("50n");
    expect(engineeringSpelling("10u", "m")).toBe("10u");
    expect(engineeringSpelling("4k7", "Ω")).toBe("4k7");
  });

  it("leaves a plain decimal that already reads fine alone", () => {
    expect(engineeringSpelling("0.25", "V")).toBe("0.25");
    expect(engineeringSpelling("75", "Ω")).toBe("75");
    expect(engineeringSpelling("-0.4", "V")).toBe("-0.4");
    expect(engineeringSpelling("0", "V")).toBe("0");
  });

  it("passes through anything that is not a quantity", () => {
    expect(engineeringSpelling("{Rload}", "Ω")).toBe("{Rload}");
    expect(engineeringSpelling("", "Ω")).toBe("");
    expect(engineeringSpelling("V(a)*2", "")).toBe("V(a)*2");
  });

  it("only ever returns a spelling that parses back to the same number", () => {
    // The guarantee that makes this a formatter and not a value rewriter. A
    // component value quietly rounded on screen is a lie about the deck.
    // "Same" is within a few ulps - `200 * 1e-9` and `2e-7` differ by one -
    // while a rounded value would be off by ~1e-3 relative.
    for (const raw of ["1000", "0.000003", "4700", "123456", "1e-11", "0.0001234567", "8.25e7", "2e-7"]) {
      const target = parseQuantity(raw, "");
      const spelled = parseQuantity(engineeringSpelling(raw), "");
      expect(Math.abs(spelled - target)).toBeLessThanOrEqual(Math.abs(target) * 8 * Number.EPSILON);
    }
  });

  it("spells mega as Meg so the value does not read back as milli", () => {
    expect(engineeringSpelling("1000000", "Hz")).toBe("1Meg");
    expect(parseQuantity(engineeringSpelling("1000000", "Hz"), "Hz")).toBe(1e6);
  });
});
