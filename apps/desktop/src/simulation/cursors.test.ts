import { describe, it, expect } from "vitest";
import {
  cursorReadout,
  dbPerDecade,
  findTraceCrossings,
  fractionToX,
  logFractionToX,
  nearestCrossing,
  plotClientXToFraction,
  xToFraction,
} from "./cursors";

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
    const flat = { label: "I(load)", unit: "A", values: [5, 5, 5, 5, 5] };
    const r = cursorReadout(axis, [{ ...ramp, unit: "V" }, flat], 0, 4);
    expect(r.traces).toHaveLength(2);
    expect(r.traces[0].unit).toBe("V");
    expect(r.traces[1].unit).toBe("A");
    expect(r.traces[1].dy).toBe(0);
    expect(r.traces[1].y1).toBe(5);
  });

  it("throws on an empty axis or a mismatched trace", () => {
    expect(() => cursorReadout([], [], 0, 1)).toThrow(/empty/);
    expect(() => cursorReadout(axis, [{ label: "x", values: [1, 2] }], 0, 1)).toThrow(/length/);
  });
});

describe("plotClientXToFraction", () => {
  it("maps the padded plot face onto the full-run cursor fraction", () => {
    expect(plotClientXToFraction(440, { left: 100, width: 680 }, 340, 46, { xMin: 0, xMax: 4 }, axis)).toBeCloseTo(0.5);
  });

  it("respects a zoomed viewport and clamps pointer travel to the plot face", () => {
    expect(plotClientXToFraction(100, { left: 100, width: 680 }, 340, 46, { xMin: 1, xMax: 3 }, axis)).toBeCloseTo(0.25);
    expect(plotClientXToFraction(780, { left: 100, width: 680 }, 340, 46, { xMin: 1, xMax: 3 }, axis)).toBeCloseTo(0.75);
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

describe("findTraceCrossings", () => {
  const axis = [0, 1, 2, 3, 4];

  it("interpolates a rising crossing onto the rendered line", () => {
    const crossings = findTraceCrossings(axis, [0, 2, 4, 6, 8], 3);
    expect(crossings).toHaveLength(1);
    expect(crossings[0].x).toBeCloseTo(1.5, 12);
    expect(crossings[0].rising).toBe(true);
    expect(crossings[0].index).toBe(1);
  });

  it("finds every crossing of a triangle, in order, with direction", () => {
    const crossings = findTraceCrossings(axis, [0, 4, 0, 4, 0], 2);
    expect(crossings.map((c) => c.x)).toEqual([0.5, 1.5, 2.5, 3.5]);
    expect(crossings.map((c) => c.rising)).toEqual([true, false, true, false]);
  });

  it("reports a sample sitting exactly on the target once, at that sample", () => {
    const crossings = findTraceCrossings(axis, [0, 1, 2, 3, 4], 2);
    expect(crossings).toHaveLength(1);
    expect(crossings[0].x).toBe(2);
    expect(crossings[0].index).toBe(2);
    expect(crossings[0].rising).toBe(true);
  });

  it("reports a settled flat run only where it is entered", () => {
    // A step that reaches the target and holds must not report one crossing
    // per sample - that is the difference between a usable readout and noise.
    const flat = [0, 5, 5, 5, 5];
    const crossings = findTraceCrossings(axis, flat, 5);
    expect(crossings).toHaveLength(1);
    expect(crossings[0].x).toBe(1);
  });

  it("returns nothing when the target is never reached, and nothing for NaN", () => {
    expect(findTraceCrossings(axis, [0, 1, 2, 3, 4], 9)).toEqual([]);
    expect(findTraceCrossings(axis, [0, 1, 2, 3, 4], NaN)).toEqual([]);
  });

  it("never interpolates a root across a non-finite gap", () => {
    // 0 -> 4 does span the target, but only by bridging the NaN at index 1.
    // Reporting a position there would put a readout on a line the scope never
    // drew, so the gap yields nothing.
    expect(findTraceCrossings(axis, [0, NaN, 4, 6, 8], 3)).toEqual([]);
  });

  it("resumes finding crossings on finite segments after a gap", () => {
    const crossings = findTraceCrossings(axis, [0, NaN, 2, 6, 8], 4);
    expect(crossings.map((c) => c.x)).toEqual([2.5]);
    expect(crossings[0].rising).toBe(true);
  });

  it("refuses mismatched lengths and honours the limit", () => {
    expect(findTraceCrossings(axis, [0, 1], 1)).toEqual([]);
    const saw = Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? 0 : 10));
    const sawAxis = saw.map((_, i) => i);
    expect(findTraceCrossings(sawAxis, saw, 5, 7)).toHaveLength(7);
  });

  it("finds a descending crossing on a falling edge", () => {
    const crossings = findTraceCrossings(axis, [8, 6, 4, 2, 0], 3);
    expect(crossings).toHaveLength(1);
    expect(crossings[0].x).toBeCloseTo(2.5, 12);
    expect(crossings[0].rising).toBe(false);
  });
});

describe("nearestCrossing", () => {
  it("picks the crossing closest to the reference position", () => {
    const crossings = findTraceCrossings([0, 1, 2, 3, 4], [0, 4, 0, 4, 0], 2);
    expect(nearestCrossing(crossings, 3.4)?.x).toBe(3.5);
    expect(nearestCrossing(crossings, 0)?.x).toBe(0.5);
  });

  it("prefers the earlier crossing on a tie and handles an empty list", () => {
    const crossings = findTraceCrossings([0, 1, 2, 3, 4], [0, 4, 0, 4, 0], 2);
    // 1.5 and 2.5 are equidistant from 2.
    expect(nearestCrossing(crossings, 2)?.x).toBe(1.5);
    expect(nearestCrossing([], 1)).toBeNull();
  });
});

describe("xToFraction", () => {
  it("inverts fractionToX across the axis", () => {
    const axis = [10, 20, 30, 40];
    for (const fraction of [0, 0.25, 0.5, 1]) {
      expect(xToFraction(axis, fractionToX(axis, fraction))).toBeCloseTo(fraction, 12);
    }
  });

  it("clamps outside the range and collapses a zero-span axis", () => {
    expect(xToFraction([0, 10], -5)).toBe(0);
    expect(xToFraction([0, 10], 99)).toBe(1);
    expect(xToFraction([5, 5], 5)).toBe(0);
    expect(Number.isNaN(xToFraction([], 1))).toBe(true);
  });
});
