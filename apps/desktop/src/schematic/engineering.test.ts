import { describe, expect, it } from "vitest";
import {
  compactEngineeringMantissa,
  composeEngineeringValue,
  isEngineeringMantissa,
  isEngineeringMantissaDraft,
  splitEngineeringValue,
} from "./engineering";

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
