import { describe, expect, it } from "vitest";
import {
  displaySampleIndices,
  MAX_WAVEFORM_RENDER_POINTS,
  visibleWaveformBounds,
  waveformBounds,
  waveformEnvelopeIndices,
} from "./waveform";

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

  it("waveformBounds scales a flat positive signal without forcing zero into view", () => {
    const bounds = waveformBounds([{ values: [3, 3, 3] }]);
    expect(bounds.min).toBeCloseTo(2.76, 10);
    expect(bounds.max).toBeCloseTo(3.24, 10);
  });

  it("waveformBounds gives a flat zero signal a finite non-zero viewport", () => {
    const bounds = waveformBounds([{ values: [0, 0, 0] }]);
    expect(bounds.min).toBeLessThan(0);
    expect(bounds.max).toBeGreaterThan(0);
    expect(bounds.max - bounds.min).toBeGreaterThan(0);
  });

  it("keeps negative-only traces negative after padding", () => {
    const bounds = waveformBounds([{ values: [-5, -4, -2] }]);
    expect(bounds.min).toBeCloseTo(-5.24, 10);
    expect(bounds.max).toBeCloseTo(-1.76, 10);
  });

  it("preserves the engineering scale of flat and tiny signals", () => {
    const flat = waveformBounds([{ values: [5e-12, 5e-12] }]);
    const tiny = waveformBounds([{ values: [1e-12, 2e-12] }]);
    expect(flat.min).toBeGreaterThan(4e-12);
    expect(flat.max).toBeLessThan(6e-12);
    expect(tiny.min).toBeGreaterThan(0);
    expect(tiny.max).toBeLessThan(3e-12);
  });

  it("autoscale ignores outliers outside the visible time window", () => {
    const bounds = visibleWaveformBounds([0, 1, 2], [{ values: [1, 2, 1000] }], 0, 1);
    expect(bounds.min).toBeCloseTo(0.92, 10);
    expect(bounds.max).toBeCloseTo(2.08, 10);
  });

  it("preserves both square-wave levels in every dense pixel bucket", () => {
    const times = Array.from({ length: 1_000 }, (_, index) => index);
    const values = times.map((index) => index % 2 === 0 ? 0 : 5);
    const indices = waveformEnvelopeIndices(times, values, 0, 999, 10);

    expect(indices.length).toBeLessThanOrEqual(42);
    for (let column = 0; column < 10; column += 1) {
      const bucketValues = indices
        .filter((index) => Math.min(9, Math.floor((times[index] / 999) * 10)) === column)
        .map((index) => values[index]);
      expect(bucketValues).toContain(0);
      expect(bucketValues).toContain(5);
    }
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
