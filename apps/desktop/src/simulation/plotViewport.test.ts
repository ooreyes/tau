import { describe, it, expect } from "vitest";
import { zoomViewport, panViewport, panByPixels, fitViewport, clampFraction, type Viewport } from "./plotViewport";

const LINEAR = { xScale: "linear" as const, yScale: "linear" as const };
const LOG_X = { xScale: "log" as const, yScale: "linear" as const };

describe("zoomViewport", () => {
  it("shrinks the span and keeps the focal point fixed when zooming in at the center", () => {
    const vp: Viewport = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };
    const out = zoomViewport(vp, { xFrac: 0.5, yFrac: 0.5 }, { x: 0.5, y: 0.5 }, LINEAR);
    expect(out.xMax - out.xMin).toBeCloseTo(5, 9);
    expect((out.xMin + out.xMax) / 2).toBeCloseTo(5, 9); // center unchanged
    expect(out.yMax - out.yMin).toBeCloseTo(5, 9);
  });

  it("keeps the exact data value under the cursor fixed when zooming at a non-center focal point", () => {
    const vp: Viewport = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };
    const focalFrac = 0.2; // data value 2
    const before = vp.xMin + focalFrac * (vp.xMax - vp.xMin);
    const out = zoomViewport(vp, { xFrac: focalFrac, yFrac: 0.5 }, { x: 0.5, y: 1 }, LINEAR);
    const afterFrac = (before - out.xMin) / (out.xMax - out.xMin);
    expect(afterFrac).toBeCloseTo(focalFrac, 6);
  });

  it("grows the span when factor > 1 (zoom out)", () => {
    const vp: Viewport = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };
    const out = zoomViewport(vp, { xFrac: 0.5, yFrac: 0.5 }, { x: 2, y: 2 }, LINEAR);
    expect(out.xMax - out.xMin).toBeCloseTo(20, 9);
  });

  it("zooms only x when the y factor is 1 (Shift+wheel convention)", () => {
    const vp: Viewport = { xMin: 0, xMax: 10, yMin: -5, yMax: 5 };
    const out = zoomViewport(vp, { xFrac: 0.5, yFrac: 0.5 }, { x: 0.5, y: 1 }, LINEAR);
    expect(out.xMax - out.xMin).toBeCloseTo(5, 9);
    expect(out.yMax - out.yMin).toBeCloseTo(10, 9);
  });

  it("zooms only y when the x factor is 1 (Alt/Option+wheel convention)", () => {
    const vp: Viewport = { xMin: 0, xMax: 10, yMin: -5, yMax: 5 };
    const out = zoomViewport(vp, { xFrac: 0.5, yFrac: 0.5 }, { x: 1, y: 0.5 }, LINEAR);
    expect(out.xMax - out.xMin).toBeCloseTo(10, 9);
    expect(out.yMax - out.yMin).toBeCloseTo(5, 9);
  });

  it("zooms a log-scale x axis in log space, preserving the focal decade position", () => {
    const vp: Viewport = { xMin: 10, xMax: 10000, yMin: 0, yMax: 1 };
    const focalFrac = 0.5; // geometric mean = 1000 (log10=3, midpoint of [1,4])
    const out = zoomViewport(vp, { xFrac: focalFrac, yFrac: 0.5 }, { x: 0.5, y: 1 }, LOG_X);
    const logSpanBefore = Math.log10(vp.xMax) - Math.log10(vp.xMin);
    const logSpanAfter = Math.log10(out.xMax) - Math.log10(out.xMin);
    expect(logSpanAfter).toBeCloseTo(logSpanBefore * 0.5, 6);
    // geometric mean (the focal value) stays fixed
    const gmBefore = Math.sqrt(vp.xMin * vp.xMax);
    const gmAfter = Math.sqrt(out.xMin * out.xMax);
    expect(gmAfter).toBeCloseTo(gmBefore, 3);
  });

  it("leaves a non-positive log-scale domain unchanged instead of producing NaN", () => {
    const vp: Viewport = { xMin: -5, xMax: 5, yMin: 0, yMax: 1 };
    const out = zoomViewport(vp, { xFrac: 0.5, yFrac: 0.5 }, { x: 0.5, y: 1 }, LOG_X);
    expect(out.xMin).toBe(-5);
    expect(out.xMax).toBe(5);
  });

  it("never collapses the span to zero or inverts it after many zoom-in steps", () => {
    let vp: Viewport = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };
    for (let i = 0; i < 200; i++) {
      vp = zoomViewport(vp, { xFrac: 0.5, yFrac: 0.5 }, { x: 0.5, y: 0.5 }, LINEAR);
    }
    expect(vp.xMax).toBeGreaterThan(vp.xMin);
    expect(vp.yMax).toBeGreaterThan(vp.yMin);
    expect(Number.isFinite(vp.xMax - vp.xMin)).toBe(true);
  });

  it("ignores a non-finite or non-positive factor (defends against a bad event value)", () => {
    const vp: Viewport = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };
    const out = zoomViewport(vp, { xFrac: 0.5, yFrac: 0.5 }, { x: NaN, y: -1 }, LINEAR);
    expect(out.xMax - out.xMin).toBeCloseTo(10, 9);
    expect(out.yMax - out.yMin).toBeCloseTo(10, 9);
  });
});

describe("panViewport", () => {
  it("shifts a linear axis by a fraction of its own span, preserving the span", () => {
    const vp: Viewport = { xMin: 0, xMax: 10, yMin: -5, yMax: 5 };
    const out = panViewport(vp, { xFrac: 0.5, yFrac: 0 }, LINEAR);
    expect(out.xMin).toBeCloseTo(5, 9);
    expect(out.xMax).toBeCloseTo(15, 9);
    expect(out.xMax - out.xMin).toBeCloseTo(10, 9);
    expect(out.yMin).toBe(-5);
    expect(out.yMax).toBe(5);
  });

  it("shifts a log axis by a fraction of its span IN DECADES, preserving the span", () => {
    const vp: Viewport = { xMin: 10, xMax: 1000, yMin: 0, yMax: 1 };
    // span is 2 decades; shifting by 0.5 of the span = 1 decade
    const out = panViewport(vp, { xFrac: 0.5, yFrac: 0 }, LOG_X);
    expect(out.xMin).toBeCloseTo(100, 6);
    expect(out.xMax).toBeCloseTo(10000, 3);
  });

  it("leaves a non-positive log domain unchanged", () => {
    const vp: Viewport = { xMin: -10, xMax: 10, yMin: 0, yMax: 1 };
    const out = panViewport(vp, { xFrac: 0.5, yFrac: 0 }, LOG_X);
    expect(out.xMin).toBe(-10);
    expect(out.xMax).toBe(10);
  });
});

describe("panByPixels", () => {
  it("dragging right (positive dxPx) shifts the visible x-window LEFT", () => {
    const vp: Viewport = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };
    const out = panByPixels(vp, 50, 0, 100, 100, LINEAR);
    expect(out.xMin).toBeLessThan(vp.xMin);
    expect(out.xMax - out.xMin).toBeCloseTo(10, 9);
  });

  it("dragging left (negative dxPx) shifts the visible x-window RIGHT", () => {
    const vp: Viewport = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };
    const out = panByPixels(vp, -50, 0, 100, 100, LINEAR);
    expect(out.xMin).toBeGreaterThan(vp.xMin);
  });

  it("dragging down (positive dyPx) shifts the visible y-window UP (higher values)", () => {
    const vp: Viewport = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };
    const out = panByPixels(vp, 0, 50, 100, 100, LINEAR);
    expect(out.yMin).toBeGreaterThan(vp.yMin);
  });

  it("is a no-op when the measured inner size is zero (avoids divide-by-zero NaNs)", () => {
    const vp: Viewport = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };
    const out = panByPixels(vp, 50, 50, 0, 0, LINEAR);
    expect(out).toEqual(vp);
  });

  it("full-width drag pans by exactly one full span", () => {
    const vp: Viewport = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };
    const out = panByPixels(vp, 100, 0, 100, 100, LINEAR);
    expect(out.xMin).toBeCloseTo(-10, 9);
    expect(out.xMax).toBeCloseTo(0, 9);
  });
});

describe("fitViewport", () => {
  it("returns a viewport exactly matching the domain", () => {
    const domain: Viewport = { xMin: 1, xMax: 2, yMin: 3, yMax: 4 };
    expect(fitViewport(domain)).toEqual(domain);
  });

  it("returns a NEW object, not the same reference (callers may mutate defensively)", () => {
    const domain: Viewport = { xMin: 1, xMax: 2, yMin: 3, yMax: 4 };
    expect(fitViewport(domain)).not.toBe(domain);
  });
});

describe("clampFraction", () => {
  it("clamps into [0,1]", () => {
    expect(clampFraction(-0.5)).toBe(0);
    expect(clampFraction(1.5)).toBe(1);
    expect(clampFraction(0.3)).toBe(0.3);
  });

  it("falls back to 0.5 for a non-finite fraction", () => {
    expect(clampFraction(NaN)).toBe(0.5);
    expect(clampFraction(Infinity)).toBe(0.5);
  });
});
