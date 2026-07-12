import { describe, expect, it } from "vitest";
import { buildEngineeringTraceReadout, interpolateTraceValue } from "./engineeringTraceReadout";

describe("interpolateTraceValue", () => {
  it("interpolates within a finite waveform segment", () => {
    expect(interpolateTraceValue([0, 2, 5], [0, 4, 10], 1)).toBe(2);
    expect(interpolateTraceValue([0, 2, 5], [0, 4, 10], 3.5)).toBe(7);
  });

  it("does not clamp or fabricate values across invalid samples", () => {
    expect(interpolateTraceValue([0, 1], [2, 4], -1)).toBeNull();
    expect(interpolateTraceValue([0, 1], [2, 4], 2)).toBeNull();
    expect(interpolateTraceValue([0, 1, 2], [2, Number.NaN, 4], 1.5)).toBeNull();
  });
});

describe("buildEngineeringTraceReadout", () => {
  it("adds peak-to-peak and an interpolated cursor to shared measurement statistics", () => {
    const model = buildEngineeringTraceReadout(
      { id: "out", label: "V(out)", unit: "V", values: [-2, 2, 0] },
      [0, 1, 2],
      { time: 0.25, label: "C1" },
    );

    expect(model).toMatchObject({
      traceId: "out",
      minimum: -2,
      maximum: 2,
      peakToPeak: 4,
      final: 0,
      cursor: { label: "C1", time: 0.25, value: -1 },
    });
  });

  it("exposes estimated frequency and period for periodic data", () => {
    const times = Array.from({ length: 401 }, (_, index) => index / 100);
    const values = times.map((time) => Math.sin(2 * Math.PI * 2 * time));
    const model = buildEngineeringTraceReadout(
      { id: "ac", label: "V(ac)", unit: "V", values },
      times,
    );

    expect(model?.classification.kind).toBe("periodic");
    expect(model?.frequency).toBeCloseTo(2, 2);
    expect(model?.period).toBeCloseTo(0.5, 2);
  });

  it("returns null when the trace has no finite samples", () => {
    expect(buildEngineeringTraceReadout(
      { id: "bad", label: "V(bad)", unit: "V", values: [Number.NaN] },
      [0],
    )).toBeNull();
  });
});
