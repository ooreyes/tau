import { describe, expect, it } from "vitest";
import { bodeMagYDomain, dbToLinearMag, freqToFraction } from "./freqAxis";

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

describe("dbToLinearMag / bodeMagYDomain", () => {
  it("converts dB and autoranges Lin dB vs Log |V| decades", () => {
    expect(dbToLinearMag(0)).toBeCloseTo(1, 10);
    expect(dbToLinearMag(-20)).toBeCloseTo(0.1, 10);
    const lin = bodeMagYDomain([[0, -3, -20]], "linear");
    expect(lin?.unit).toBe("dB");
    expect(lin?.yMax).toBe(0);
    expect(lin?.yMin).toBe(-20);
    const log = bodeMagYDomain([[0, -20, -40]], "log");
    expect(log?.unit).toBe("V/V");
    expect(log?.yMin).toBe(0.01);
    expect(log?.yMax).toBe(1);
    expect(bodeMagYDomain([[-300]], "linear")).toBeNull();
  });
});
