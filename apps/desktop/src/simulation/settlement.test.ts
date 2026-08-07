import { describe, expect, it } from "vitest";
import { settledReading } from "./settlement";
import { formatSettledReading } from "./quantity";

/** A sine of `cycles` periods sampled `per` times each, riding on `offset`. */
const sine = (amp: number, cycles: number, per: number, offset = 0) =>
  Array.from({ length: cycles * per }, (_, i) => offset + amp * Math.sin((2 * Math.PI * i) / per));

describe("settledReading", () => {
  it("ignores a turn-on excursion that never repeats", () => {
    // The reported case in miniature: one large first-cycle overshoot, then a
    // steady ±100 mV. Whole-run min/max would report the overshoot as though
    // the circuit oscillated up to it.
    const values = [0, 0.254, -0.05, 0.2, ...sine(0.1, 6, 8)];
    const r = settledReading(values)!;
    expect(r.settled).toBe(true);
    expect(r.amplitude).toBeCloseTo(0.1, 2);
    expect(Math.abs(r.offset)).toBeLessThan(0.01);
    expect(r.amplitude).toBeLessThan(0.254);
  });

  it("recovers offset and amplitude from a biased ripple", () => {
    const r = settledReading(sine(0.1, 8, 8, 2.5))!;
    expect(r.settled).toBe(true);
    expect(r.offset).toBeCloseTo(2.5, 2);
    expect(r.amplitude).toBeCloseTo(0.1, 2);
  });

  it("reports a flat DC node as offset with no swing", () => {
    const r = settledReading(Array(32).fill(5))!;
    expect(r.settled).toBe(true);
    expect(r.offset).toBe(5);
    expect(r.amplitude).toBe(0);
  });

  it("refuses to call a ramp settled", () => {
    expect(settledReading(Array.from({ length: 32 }, (_, i) => i * 0.5))!.settled).toBe(false);
  });

  it("refuses to call a growing oscillation settled", () => {
    const values = Array.from({ length: 64 }, (_, i) =>
      (1 + i / 16) * Math.sin((2 * Math.PI * i) / 8));
    expect(settledReading(values)!.settled).toBe(false);
  });

  it("still describes a run too short to judge, marked unsettled", () => {
    const r = settledReading([-0.488, 0.005, 0.488])!;
    expect(r.settled).toBe(false);
    expect(r.amplitude).toBeCloseTo(0.488, 3);
  });

  it("returns null only for an empty trace", () => {
    expect(settledReading([])).toBeNull();
  });

  it("treats a decaying transient as settled once the tail stops moving", () => {
    // Exponential decay onto a DC level - the classic RC charge.
    const values = Array.from({ length: 64 }, (_, i) => 5 * (1 - Math.exp(-i / 6)));
    const r = settledReading(values)!;
    expect(r.settled).toBe(true);
    expect(r.offset).toBeCloseTo(5, 1);
    expect(r.amplitude).toBeLessThan(0.05);
  });
});

describe("formatSettledReading", () => {
  const settled = (offset: number, amplitude: number) => ({ offset, amplitude, settled: true });

  it("writes a DC level plainly", () => {
    expect(formatSettledReading(settled(5, 0), "V")).toBe("5 V");
  });

  it("writes a symmetric swing as ±A", () => {
    expect(formatSettledReading(settled(0, 0.157), "V")).toBe("±157 mV");
  });

  it("ignores a sampling-artefact offset", () => {
    // 1.4 mV of asymmetry on a 157 mV swing is where the samples landed, not a
    // real bias, so it must not turn into "1.4 mV ±157 mV".
    expect(formatSettledReading(settled(0.0014, 0.157), "V")).toBe("±157 mV");
  });

  it("keeps a real bias as offset ± amplitude", () => {
    expect(formatSettledReading(settled(2.5, 0.1), "V")).toBe("2.5 V ±100 mV");
  });

  it("marks an unsettled reading", () => {
    expect(formatSettledReading({ offset: 0, amplitude: 0.157, settled: false }, "V"))
      .toBe("±157 mV ~settling");
  });

  it("survives a non-finite reading", () => {
    expect(formatSettledReading({ offset: NaN, amplitude: 1, settled: true }, "V")).toBe("--");
  });
});
