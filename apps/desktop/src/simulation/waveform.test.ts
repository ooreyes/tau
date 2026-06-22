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
});
