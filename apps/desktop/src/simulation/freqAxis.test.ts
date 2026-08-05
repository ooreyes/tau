import { describe, expect, it } from "vitest";
import { freqToFraction } from "./freqAxis";

describe("freqToFraction", () => {
  it("maps log decades and linear Hz spans", () => {
    expect(freqToFraction(100, 10, 1000, "log")).toBeCloseTo(0.5, 10);
    expect(freqToFraction(10, 10, 1000, "log")).toBeCloseTo(0, 10);
    expect(freqToFraction(1000, 10, 1000, "log")).toBeCloseTo(1, 10);
    expect(freqToFraction(550, 100, 1000, "linear")).toBeCloseTo(0.5, 10);
    expect(freqToFraction(100, 100, 1000, "linear")).toBeCloseTo(0, 10);
  });

  it("rejects non-positive log domains and degenerate spans", () => {
    expect(freqToFraction(10, -1, 100, "log")).toBeNull();
    expect(freqToFraction(0, 1, 100, "log")).toBeNull();
    expect(freqToFraction(50, 10, 10, "linear")).toBeNull();
    expect(freqToFraction(Number.NaN, 1, 10, "linear")).toBeNull();
  });
});
