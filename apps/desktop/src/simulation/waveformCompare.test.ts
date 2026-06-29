import { describe, it, expect } from "vitest";
import { interpolateAt, resampleOnto, compareWaveforms } from "./waveformCompare";

describe("interpolateAt", () => {
  const t = [0, 1, 2, 3];
  const v = [0, 10, 20, 30];
  it("interpolates linearly between samples", () => {
    expect(interpolateAt(t, v, 0.5)).toBeCloseTo(5);
    expect(interpolateAt(t, v, 2.25)).toBeCloseTo(22.5);
  });
  it("clamps outside the range", () => {
    expect(interpolateAt(t, v, -1)).toBe(0);
    expect(interpolateAt(t, v, 9)).toBe(30);
  });
  it("hits exact sample points", () => {
    expect(interpolateAt(t, v, 2)).toBe(20);
  });
});

describe("resampleOnto", () => {
  it("resamples a coarse series onto a finer grid", () => {
    const out = resampleOnto([0, 2], [0, 20], [0, 0.5, 1, 1.5, 2]);
    expect(out).toEqual([0, 5, 10, 15, 20]);
  });
});

describe("compareWaveforms", () => {
  it("reports zero error for identical series on different grids", () => {
    // y = 2t sampled on two unrelated grids.
    const testT = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
    const testV = testT.map((t) => 2 * t);
    const refT = [0, 0.25, 0.5];
    const refV = refT.map((t) => 2 * t);
    const r = compareWaveforms(testT, testV, refT, refV);
    expect(r.maxAbsError).toBeCloseTo(0, 9);
    expect(r.rmsError).toBeCloseTo(0, 9);
    expect(r.normalizedRms).toBeCloseTo(0, 9);
    expect(r.pass).toBe(true);
    expect(r.referenceRange).toBeCloseTo(1, 9); // 2*0.5
  });

  it("measures a constant offset against the reference range", () => {
    const testT = [0, 1, 2];
    const refT = [0, 1, 2];
    const refV = [0, 5, 10]; // range 10
    const testV = refV.map((v) => v + 1); // +1 everywhere
    const r = compareWaveforms(testT, testV, refT, refV);
    expect(r.maxAbsError).toBeCloseTo(1);
    expect(r.rmsError).toBeCloseTo(1);
    expect(r.normalizedMax).toBeCloseTo(0.1);
    expect(r.normalizedRms).toBeCloseTo(0.1);
    // 10% RMS exceeds the default 5% tolerance → fail by default…
    expect(r.pass).toBe(false);
    // …but passes when the caller allows 10% RMS / 10% max.
    const loose = compareWaveforms(testT, testV, refT, refV, {
      rmsTolerance: 0.1,
      maxTolerance: 0.1,
    });
    expect(loose.pass).toBe(true);
  });

  it("fails when the error exceeds tolerance", () => {
    const r = compareWaveforms([0, 1, 2], [0, 0, 0], [0, 1, 2], [0, 5, 10]);
    expect(r.normalizedMax).toBeGreaterThan(0.1);
    expect(r.pass).toBe(false);
  });

  it("restricts metrics to the overlapping interval", () => {
    // Reference only covers [0,1]; test runs to 2. Compare on [0,1] only.
    const testT = [0, 0.5, 1, 1.5, 2];
    const testV = [0, 1, 2, 3, 4];
    const refT = [0, 1];
    const refV = [0, 2];
    const r = compareWaveforms(testT, testV, refT, refV);
    expect(r.overlap).toEqual([0, 1]);
    expect(r.samples).toBe(3); // t = 0, 0.5, 1
    expect(r.maxAbsError).toBeCloseTo(0, 9);
  });

  it("handles a flat reference without dividing by zero", () => {
    const r = compareWaveforms([0, 1], [1, 1.5], [0, 1], [2, 2]);
    expect(r.referenceRange).toBe(0);
    expect(Number.isFinite(r.normalizedRms)).toBe(true);
  });

  it("throws on empty input or no overlap", () => {
    expect(() => compareWaveforms([], [], [0], [0])).toThrow(/non-empty/);
    expect(() => compareWaveforms([0, 1], [0, 1], [5, 6], [0, 1])).toThrow(/overlap/);
  });
});
