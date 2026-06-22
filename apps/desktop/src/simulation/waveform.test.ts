import { describe, expect, it } from "vitest";
import { displaySampleIndices, MAX_WAVEFORM_RENDER_POINTS, waveformBounds } from "./waveform";

describe("waveform display data", () => {
  it("calculates bounds over a large native-size trace without spreading its samples", () => {
    const values = Array.from({ length: 250_000 }, (_, index) => (index === 249_999 ? 5 : -2));
    const bounds = waveformBounds([{ values }]);
    expect(bounds.min).toBeCloseTo(-2.56, 12);
    expect(bounds.max).toBeCloseTo(5.56, 12);
  });

  it("limits a high-resolution render path while preserving both endpoints", () => {
    const indices = displaySampleIndices(2_000_000);
    expect(indices.length).toBeGreaterThan(0);
    expect(indices.length).toBeLessThanOrEqual(MAX_WAVEFORM_RENDER_POINTS);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(1_999_999);
  });

  it("returns empty array for zero-length or invalid input", () => {
    expect(displaySampleIndices(0)).toEqual([]);
    expect(displaySampleIndices(-1)).toEqual([]);
  });

  it("returns [0] for a single sample", () => {
    expect(displaySampleIndices(1)).toEqual([0]);
  });

  it("returns all indices when count is within the render limit", () => {
    const indices = displaySampleIndices(10);
    expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("waveformBounds pads by 8% of span for a range that includes zero", () => {
    // rawMin starts at 0, rawMax becomes 3 → span = 3.
    // min = 0 - 3*0.08 = -0.24, max = 3 + 3*0.08 = 3.24.
    const bounds = waveformBounds([{ values: [3, 3, 3] }]);
    expect(bounds.min).toBeCloseTo(-0.24, 10);
    expect(bounds.max).toBeCloseTo(3.24, 10);
  });

  it("waveformBounds uses a fallback span of 1 when all values equal zero", () => {
    // rawMin = rawMax = 0, span = 0 || 1 = 1.
    // min = 0 - 0.08, max = 0 + 0.08.
    const bounds = waveformBounds([{ values: [0, 0, 0] }]);
    expect(bounds.min).toBeCloseTo(-0.08, 10);
    expect(bounds.max).toBeCloseTo(0.08, 10);
  });

  it("waveformBounds ignores non-finite values", () => {
    const bounds = waveformBounds([{ values: [NaN, Infinity, -Infinity, 2, -1] }]);
    expect(bounds.min).toBeLessThan(-1);
    expect(bounds.max).toBeGreaterThan(2);
    expect(Number.isFinite(bounds.min)).toBe(true);
    expect(Number.isFinite(bounds.max)).toBe(true);
  });

  it("waveformBounds returns a finite span for an empty trace", () => {
    const bounds = waveformBounds([{ values: [] }]);
    expect(Number.isFinite(bounds.min)).toBe(true);
    expect(Number.isFinite(bounds.max)).toBe(true);
  });
});
