import { describe, expect, it } from "vitest";
import {
  displaySampleIndices,
  autoFrameWaveform,
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

  it("auto-frames the final four cycles of a dense periodic run", () => {
    const frequency = 100_000;
    const stopTime = 0.007;
    const step = 0.5e-6;
    const times = Array.from({ length: Math.round(stopTime / step) + 1 }, (_, index) => index * step);
    const values = times.map((time) => 2 + 3 * Math.sin(2 * Math.PI * frequency * time));

    const frame = autoFrameWaveform(times, [{ values }], { xMin: 0, xMax: stopTime });

    expect(frame.xMax).toBeCloseTo(stopTime, 10);
    expect(frame.xMax - frame.xMin).toBeCloseTo(4 / frequency, 8);
    expect(frame.yMin).toBeCloseTo(-1.48, 2);
    expect(frame.yMax).toBeCloseTo(5.48, 2);
  });

  it("uses the slowest periodic trace and ignores startup outliers when framing Y", () => {
    const times = Array.from({ length: 2_001 }, (_, index) => index / 100_000);
    const slow = times.map((time, index) => index === 0 ? 1_000 : Math.sin(2 * Math.PI * 1_000 * time));
    const fast = times.map((time) => 0.25 * Math.sin(2 * Math.PI * 5_000 * time));

    const frame = autoFrameWaveform(
      times,
      [{ values: slow }, { values: fast }],
      { xMin: 0, xMax: 0.02 },
    );

    expect(frame.xMax - frame.xMin).toBeCloseTo(0.004, 6);
    expect(frame.yMax).toBeLessThan(2);
    expect(frame.yMin).toBeGreaterThan(-2);
  });

  it("keeps the current X window for non-periodic data and only fits visible Y", () => {
    const times = [0, 1, 2, 3, 4];
    const values = [100, 10, 2, 3, 4];
    const frame = autoFrameWaveform(times, [{ values }], { xMin: 2, xMax: 4 });

    expect(frame.xMin).toBe(2);
    expect(frame.xMax).toBe(4);
    expect(frame.yMin).toBeCloseTo(1.84, 10);
    expect(frame.yMax).toBeCloseTo(4.16, 10);
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
