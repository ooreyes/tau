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

/**
 * Waveform shapes from circuit classes the browser preview solver refuses, so
 * they never reach the end-to-end sweep: switching converters, rectifiers and
 * digital logic all run only on native ngspice. Settlement is engine-agnostic -
 * it sees an array of numbers - so the shapes are what need covering.
 */
describe("settledReading across circuit classes", () => {
  it("reads a buck converter output as DC with ripple, not as a 0-to-Vin swing", () => {
    // Switching node averaged into an LC output: 5 V with 100 mV of ripple at
    // the switching frequency, after a startup ramp.
    const ramp = Array.from({ length: 40 }, (_, i) => 5 * (i / 40));
    const steady = Array.from({ length: 160 }, (_, i) => 5 + 0.1 * (i % 8 < 4 ? 1 : -1));
    const r = settledReading([...ramp, ...steady])!;
    expect(r.settled).toBe(true);
    expect(r.offset).toBeCloseTo(5, 1);
    expect(r.amplitude).toBeCloseTo(0.1, 2);
  });

  it("reads inductor ripple current as an average plus a triangle", () => {
    // Triangular ripple on a 2 A average - the classic continuous-conduction
    // inductor current.
    const tri = (i: number) => (i % 20 < 10 ? -0.5 + (i % 20) * 0.1 : 0.5 - ((i % 20) - 10) * 0.1);
    const r = settledReading(Array.from({ length: 200 }, (_, i) => 2 + tri(i)))!;
    expect(r.settled).toBe(true);
    expect(r.offset).toBeCloseTo(2, 1);
    expect(r.amplitude).toBeCloseTo(0.5, 1);
  });

  it("reads a rectifier output as DC with sawtooth ripple", () => {
    const saw = Array.from({ length: 240 }, (_, i) => 12 - 0.4 * ((i % 24) / 24));
    const r = settledReading(saw)!;
    expect(r.settled).toBe(true);
    expect(r.offset).toBeCloseTo(11.8, 1);
    expect(r.amplitude).toBeLessThan(0.3);
  });

  it("reads a digital square as its two logic levels", () => {
    const clk = Array.from({ length: 160 }, (_, i) => (i % 10 < 5 ? 0 : 5));
    const r = settledReading(clk)!;
    expect(r.settled).toBe(true);
    expect(r.offset).toBeCloseTo(2.5, 2);
    expect(r.amplitude).toBeCloseTo(2.5, 2);
  });

  it("handles an asymmetric duty cycle without inventing a bias", () => {
    // 20% duty. Offset and amplitude still describe the two levels; the mark
    // ratio is not something a min/max reading can or should claim to show.
    const pwm = Array.from({ length: 200 }, (_, i) => (i % 10 < 2 ? 5 : 0));
    const r = settledReading(pwm)!;
    expect(r.settled).toBe(true);
    expect(r.offset).toBeCloseTo(2.5, 2);
    expect(r.amplitude).toBeCloseTo(2.5, 2);
  });

  it("does not claim settlement for a chaotic trace", () => {
    // Deterministic pseudo-noise with a growing envelope - no period, no
    // steady state. Must not be presented as an operating value.
    let x = 0.3;
    const values = Array.from({ length: 256 }, (_, i) => {
      x = 3.99 * x * (1 - x);
      return (1 + i / 64) * (x - 0.5);
    });
    expect(settledReading(values)!.settled).toBe(false);
  });

  it("survives NaN samples in a trace", () => {
    const values = Array.from({ length: 64 }, (_, i) => (i === 5 ? NaN : Math.sin(i / 3)));
    const r = settledReading(values)!;
    expect(Number.isFinite(r.offset)).toBe(true);
    expect(Number.isFinite(r.amplitude)).toBe(true);
  });

  it("survives an all-NaN trace without producing a fake reading", () => {
    expect(settledReading(Array(32).fill(NaN))).toBeNull();
  });

  it("stays cheap on a long run", () => {
    // 200k samples is well past any real `.tran`; the detector downsamples, so
    // cost must not track the sample count.
    const big = Array.from({ length: 200_000 }, (_, i) => Math.sin((2 * Math.PI * i) / 997));
    const started = performance.now();
    const r = settledReading(big)!;
    const elapsed = performance.now() - started;
    expect(r.settled).toBe(true);
    expect(elapsed).toBeLessThan(400);
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
