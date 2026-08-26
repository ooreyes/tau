import { describe, it, expect } from "vitest";
import {
  niceTicks,
  logTicks,
  valueToFraction,
  fractionToValue,
  formatTickLabel,
  computeAxisTicks,
  pickTickCount,
} from "./axisTicks";

describe("niceTicks", () => {
  it("picks round 1/2/5×10^n steps over a simple range", () => {
    const ticks = niceTicks(0, 10, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    for (const t of ticks) {
      // every tick should be a "nice" multiple, i.e. round-trip through 2 sig figs cleanly
      expect(Number.isFinite(t)).toBe(true);
    }
    expect(ticks[0]).toBeLessThanOrEqual(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(10);
    // steps should be uniform
    const step = ticks[1] - ticks[0];
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i] - ticks[i - 1]).toBeCloseTo(step, 9);
    }
  });

  it("covers a tiny sub-nanovolt range without collapsing to a single tick", () => {
    const ticks = niceTicks(1e-9, 5e-9, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...ticks)).toBeLessThanOrEqual(1e-9);
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(5e-9);
  });

  it("covers a huge multi-gigavolt range", () => {
    const ticks = niceTicks(1e9, 9e9, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...ticks)).toBeLessThanOrEqual(1e9);
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(9e9);
  });

  it("handles an all-negative domain", () => {
    const ticks = niceTicks(-10, -2, 5);
    expect(ticks.every((t) => t <= -2 || Math.abs(t + 2) < 1)).toBe(true);
    expect(Math.min(...ticks)).toBeLessThanOrEqual(-10);
  });

  it("handles a domain straddling zero and includes an exact zero tick", () => {
    const ticks = niceTicks(-5, 5, 5);
    expect(ticks.some((t) => t === 0)).toBe(true);
  });

  it("handles a reversed domain (max < min) the same as the sorted one", () => {
    const a = niceTicks(0, 10, 5);
    const b = niceTicks(10, 0, 5);
    expect(b).toEqual(a);
  });

  it("synthesizes a span for a zero-width (flat trace) domain", () => {
    const ticks = niceTicks(5, 5, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(Math.min(...ticks)).toBeLessThan(5);
    expect(Math.max(...ticks)).toBeGreaterThan(5);
  });

  it("synthesizes a span for an exactly-zero domain (min=max=0)", () => {
    const ticks = niceTicks(0, 0, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.some((t) => t === 0)).toBe(true);
  });

  it("returns [] for non-finite input", () => {
    expect(niceTicks(NaN, 10, 5)).toEqual([]);
    expect(niceTicks(0, Infinity, 5)).toEqual([]);
  });

  it("respects a small target count without throwing", () => {
    const ticks = niceTicks(0, 100, 1);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
  });
});

describe("logTicks", () => {
  it("returns [] for a non-positive domain", () => {
    expect(logTicks(-10, 100)).toEqual([]);
    expect(logTicks(0, 100)).toEqual([]);
    expect(logTicks(10, 10)).toEqual([]);
    expect(logTicks(100, 10)).toEqual([]);
  });

  it("puts one tick per decade across a moderate multi-decade span", () => {
    const ticks = logTicks(1, 1e6, 6);
    expect(ticks).toContain(1);
    expect(ticks).toContain(1e6);
    // every tick should be an exact power of 10 in this regime
    for (const t of ticks) {
      const exp = Math.log10(t);
      expect(Math.abs(exp - Math.round(exp))).toBeLessThan(1e-9);
    }
  });

  it("thins by a stride when the span has far more decades than the target count", () => {
    const ticks = logTicks(1, 1e12, 4);
    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(ticks[0]).toBeCloseTo(1, 9);
    expect(ticks[ticks.length - 1]).toBeCloseTo(1e12, -1);
  });

  it("adds 1/2/5 sub-decade ticks for a sub-decade span", () => {
    const ticks = logTicks(500, 5000, 6);
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks).toContain(1000);
    expect(ticks).toContain(2000);
    expect(ticks).toContain(5000);
  });

  it("handles a single-decade span (e.g. 1kHz-10kHz)", () => {
    const ticks = logTicks(1e3, 1e4, 6);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(Math.min(...ticks)).toBeLessThanOrEqual(1e3);
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(1e4);
  });

  it("degrades to nice-number ticks when a deeply-zoomed window contains no 1/2/5x10^n value at all", () => {
    // A Desmos-style wheel-zoom can shrink a log axis to a window this
    // narrow; the 1/2/5 sub-decade grid alone would render zero ticks here
    // since no {1,2,5}x10^n value falls in [3100,3140].
    const ticks = logTicks(3100, 3140, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    for (const t of ticks) {
      expect(t).toBeGreaterThan(0);
      expect(Number.isFinite(t)).toBe(true);
    }
  });
});

describe("valueToFraction / fractionToValue", () => {
  it("maps linear domain endpoints to 0 and 1", () => {
    expect(valueToFraction(0, 0, 10)).toBe(0);
    expect(valueToFraction(10, 0, 10)).toBe(1);
    expect(valueToFraction(5, 0, 10)).toBeCloseTo(0.5, 9);
  });

  it("round-trips linear values through fractionToValue", () => {
    const frac = valueToFraction(3, -5, 15);
    expect(fractionToValue(frac, -5, 15)).toBeCloseTo(3, 9);
  });

  it("maps log domain endpoints to 0 and 1 and the geometric mean to 0.5", () => {
    expect(valueToFraction(1, 1, 100, "log")).toBeCloseTo(0, 9);
    expect(valueToFraction(100, 1, 100, "log")).toBeCloseTo(1, 9);
    expect(valueToFraction(10, 1, 100, "log")).toBeCloseTo(0.5, 9);
  });

  it("returns NaN for a non-positive value or domain on a log axis", () => {
    expect(Number.isNaN(valueToFraction(-1, 1, 100, "log"))).toBe(true);
    expect(Number.isNaN(valueToFraction(0, 1, 100, "log"))).toBe(true);
    expect(Number.isNaN(valueToFraction(10, -1, 100, "log"))).toBe(true);
  });

  it("round-trips log values through fractionToValue", () => {
    const frac = valueToFraction(50, 1, 1000, "log");
    expect(fractionToValue(frac, 1, 1000, "log")).toBeCloseTo(50, 6);
  });

  it("handles a zero-span linear domain by returning the midpoint fraction", () => {
    expect(valueToFraction(5, 5, 5)).toBe(0.5);
  });
});

describe("formatTickLabel", () => {
  it("reuses formatEngineering's SI-prefix scaling for physical units", () => {
    expect(formatTickLabel(0.002, "s")).toBe("2 ms");
    expect(formatTickLabel(0.004, "s")).toBe("4 ms");
    expect(formatTickLabel(1, "V")).toBe("1 V");
    expect(formatTickLabel(2000, "Hz")).toBe("2 kHz");
    expect(formatTickLabel(0, "V")).toBe("0 V");
  });

  it("never SI-scales dB - no 'k'/'µ' prefix nonsense on a logarithmic unit", () => {
    expect(formatTickLabel(40, "dB")).toBe("40 dB");
    expect(formatTickLabel(-2000, "dB")).toBe("-2000 dB");
    expect(formatTickLabel(0, "dB")).toBe("0 dB");
  });

  it("formats degrees without a space before the ° glyph", () => {
    expect(formatTickLabel(90, "°")).toBe("90°");
    expect(formatTickLabel(-180, "°")).toBe("-180°");
  });
});

describe("computeAxisTicks", () => {
  it("allows a live scope to cap solver-residue precision", () => {
    const ticks = computeAxisTicks(4.999998, 5.000002, {
      unit: "V",
      targetCount: 5,
      significantDigits: 4,
    });
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((tick) => !/999|00000/.test(tick.label))).toBe(true);
    expect(ticks.every((tick) => tick.label.endsWith("V"))).toBe(true);
  });

  it("formats a near-constant trace as distinct truthful offsets", () => {
    const ticks = computeAxisTicks(4.999998, 5.000002, {
      unit: "V",
      targetCount: 5,
      significantDigits: 4,
      relativeTo: 5,
    });
    expect(new Set(ticks.map((tick) => tick.label)).size).toBe(ticks.length);
    expect(ticks.map((tick) => tick.label)).toContain("0 V");
    expect(ticks.every((tick) => tick.label.length <= 8)).toBe(true);
  });

  it("returns ticks sorted by fraction, all within [0,1]", () => {
    const ticks = computeAxisTicks(-5, 5, { unit: "V", targetCount: 5 });
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) {
      expect(t.frac).toBeGreaterThanOrEqual(0);
      expect(t.frac).toBeLessThanOrEqual(1);
      expect(t.label.length).toBeGreaterThan(0);
    }
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].frac).toBeGreaterThanOrEqual(ticks[i - 1].frac);
    }
  });

  it("flags the zero tick when zero is in range", () => {
    const ticks = computeAxisTicks(-5, 5, { unit: "V" });
    const zero = ticks.find((t) => t.isZero);
    expect(zero).toBeDefined();
    expect(zero!.value).toBe(0);
  });

  it("has no zero-flagged tick when zero is out of range", () => {
    const ticks = computeAxisTicks(1, 10, { unit: "V" });
    expect(ticks.some((t) => t.isZero)).toBe(false);
  });

  it("produces log ticks with Hz labels for a frequency axis", () => {
    const ticks = computeAxisTicks(10, 1e5, { scale: "log", unit: "Hz", targetCount: 5 });
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.some((t) => t.label.includes("Hz"))).toBe(true);
  });

  it("drops out-of-range candidate ticks at log domain edges", () => {
    const ticks = computeAxisTicks(250, 3300, { scale: "log", unit: "Hz", targetCount: 6 });
    for (const t of ticks) {
      expect(t.value).toBeGreaterThanOrEqual(250 * 0.999);
      expect(t.value).toBeLessThanOrEqual(3300 * 1.001);
    }
  });

  it("returns [] for non-finite bounds instead of throwing", () => {
    expect(computeAxisTicks(NaN, 10)).toEqual([]);
  });

  it("adds enough significant digits to distinguish ticks in a deeply zoomed viewport", () => {
    const ticks = computeAxisTicks(2.5, 2.5004, { unit: "V", targetCount: 5 });
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(new Set(ticks.map((tick) => tick.label)).size).toBe(ticks.length);
    expect(ticks.some((tick) => /2\.500[1-4] V/.test(tick.label))).toBe(true);
  });
});

describe("pickTickCount", () => {
  it("returns fewer ticks for a narrow measured size", () => {
    const narrow = pickTickCount(120);
    const wide = pickTickCount(600);
    expect(narrow).toBeLessThan(wide);
  });

  it("clamps to the configured min/max", () => {
    expect(pickTickCount(1)).toBeGreaterThanOrEqual(2);
    expect(pickTickCount(10000, 55, 2, 7)).toBeLessThanOrEqual(7);
  });

  it("falls back to maxCount for an invalid size", () => {
    expect(pickTickCount(NaN)).toBe(7);
    expect(pickTickCount(0)).toBe(7);
  });
});
