import { describe, it, expect } from "vitest";
import { cursorReadout, dbPerDecade, fractionToX, logFractionToX } from "./cursors";

const axis = [0, 1, 2, 3, 4];
const ramp = { label: "V(out)", values: [0, 10, 20, 30, 40] };

describe("fractionToX", () => {
  it("maps fractions onto the axis range", () => {
    expect(fractionToX(axis, 0)).toBe(0);
    expect(fractionToX(axis, 1)).toBe(4);
    expect(fractionToX(axis, 0.5)).toBe(2);
  });
  it("clamps out-of-range fractions", () => {
    expect(fractionToX(axis, -0.5)).toBe(0);
    expect(fractionToX(axis, 2)).toBe(4);
  });
});

describe("cursorReadout", () => {
  it("interpolates each trace at both cursors and reports deltas", () => {
    const r = cursorReadout(axis, [ramp], 1, 3);
    expect(r.x1).toBe(1);
    expect(r.x2).toBe(3);
    expect(r.dx).toBe(2);
    expect(r.inverseDx).toBeCloseTo(0.5);
    expect(r.traces[0].y1).toBeCloseTo(10);
    expect(r.traces[0].y2).toBeCloseTo(30);
    expect(r.traces[0].dy).toBeCloseTo(20);
    expect(r.traces[0].slope).toBeCloseTo(10); // 20 / 2
  });

  it("interpolates between samples", () => {
    const r = cursorReadout(axis, [ramp], 0.5, 2.5);
    expect(r.traces[0].y1).toBeCloseTo(5);
    expect(r.traces[0].y2).toBeCloseTo(25);
  });

  it("clamps cursors to the axis range", () => {
    const r = cursorReadout(axis, [ramp], -10, 99);
    expect(r.x1).toBe(0);
    expect(r.x2).toBe(4);
    expect(r.traces[0].y1).toBeCloseTo(0);
    expect(r.traces[0].y2).toBeCloseTo(40);
  });

  it("yields NaN slope / inverseDx when the cursors coincide", () => {
    const r = cursorReadout(axis, [ramp], 2, 2);
    expect(r.dx).toBe(0);
    expect(Number.isNaN(r.inverseDx)).toBe(true);
    expect(Number.isNaN(r.traces[0].slope)).toBe(true);
    expect(r.traces[0].dy).toBe(0);
  });

  it("handles multiple traces", () => {
    const flat = { label: "V(ref)", values: [5, 5, 5, 5, 5] };
    const r = cursorReadout(axis, [ramp, flat], 0, 4);
    expect(r.traces).toHaveLength(2);
    expect(r.traces[1].dy).toBe(0);
    expect(r.traces[1].y1).toBe(5);
  });

  it("throws on an empty axis or a mismatched trace", () => {
    expect(() => cursorReadout([], [], 0, 1)).toThrow(/empty/);
    expect(() => cursorReadout(axis, [{ label: "x", values: [1, 2] }], 0, 1)).toThrow(/length/);
  });
});

describe("logFractionToX (FFT/Bode frequency axis)", () => {
  const freqs = [0, 10, 100, 1000, 10000]; // leading DC bin, 3 decades of span

  it("maps equal fractions to equal decades, skipping the DC bin", () => {
    expect(logFractionToX(freqs, 0)).toBeCloseTo(10);
    expect(logFractionToX(freqs, 1)).toBeCloseTo(10000);
    // Half the slider travel = 1.5 decades above 10 Hz.
    expect(logFractionToX(freqs, 0.5)).toBeCloseTo(10 ** 2.5, 6);
    expect(logFractionToX(freqs, 1 / 3)).toBeCloseTo(100, 6);
  });

  it("clamps out-of-range fractions", () => {
    expect(logFractionToX(freqs, -1)).toBeCloseTo(10);
    expect(logFractionToX(freqs, 2)).toBeCloseTo(10000);
  });

  it("returns NaN when there is no positive span", () => {
    expect(logFractionToX([], 0.5)).toBeNaN();
    expect(logFractionToX([0], 0.5)).toBeNaN();
  });
});

describe("dbPerDecade", () => {
  it("reads −20 dB/dec off a synthetic 1-pole rolloff", () => {
    // Magnitude of a pole well above fc falls 20 dB per decade:
    // dB(f) = −20·log10(f/fc), fc = 1 Hz.
    const freqs = [10, 100, 1000, 10000];
    const db = freqs.map((f) => -20 * Math.log10(f));
    const r = cursorReadout(freqs, [{ label: "V(out)", values: db }], 10, 10000);
    expect(dbPerDecade(r, r.traces[0])).toBeCloseTo(-20, 6);
  });

  it("is NaN for coincident cursors or non-positive frequencies", () => {
    const freqs = [10, 100];
    const flat = [{ label: "V(out)", values: [0, 0] }];
    const same = cursorReadout(freqs, flat, 100, 100);
    expect(dbPerDecade(same, same.traces[0])).toBeNaN();
    const zeroAxis = cursorReadout([0, 1], [{ label: "V(out)", values: [0, 0] }], 0, 1);
    expect(dbPerDecade(zeroAxis, zeroAxis.traces[0])).toBeNaN();
  });
});
