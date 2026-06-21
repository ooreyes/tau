import { describe, expect, it } from "vitest";
import { composeEngineeringValue, isEngineeringMantissa, splitEngineeringValue } from "./engineering";

describe("engineering value controls", () => {
  it("keeps milli and mega distinct", () => {
    expect(splitEngineeringValue("4.7m", "H")).toEqual({ mantissa: "4.7", prefix: "m" });
    expect(splitEngineeringValue("4.7M", "Ω")).toEqual({ mantissa: "4.7", prefix: "M" });
  });

  it("normalizes common micro and mega spellings for the selector", () => {
    expect(splitEngineeringValue("10µ", "F")).toEqual({ mantissa: "10", prefix: "u" });
    expect(splitEngineeringValue("1meg", "Hz")).toEqual({ mantissa: "1", prefix: "M" });
  });

  it("composes values back into solver-compatible syntax", () => {
    expect(composeEngineeringValue("2.2", "k")).toBe("2.2k");
    expect(composeEngineeringValue("47", "n")).toBe("47n");
  });

  it("accepts incomplete typing locally only after it becomes a valid number", () => {
    expect(isEngineeringMantissa("1.")).toBe(true);
    expect(isEngineeringMantissa("-")).toBe(false);
  });
});
