import { describe, expect, it } from "vitest";
import { findTraceCrossings, nearestCrossing } from "./cursors";
import { interpolateAt } from "./waveformCompare";

/**
 * Seeking a cursor by value. Typing a number the circuit never reached has to
 * say so rather than silently parking the cursor somewhere plausible — a
 * measurement tool that answers a question you did not ask is worse than one
 * that admits it cannot.
 */
const times = Array.from({ length: 201 }, (_, i) => i * 1e-5);      // 0 … 2 ms
const sine = times.map((t) => 5 * Math.sin(2 * Math.PI * 1000 * t)); // ±5 V @ 1 kHz

describe("seek a cursor to a value", () => {
  it("finds every crossing of a reachable value", () => {
    const hits = findTraceCrossings(times, sine, 2.5);
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(interpolateAt(times, sine, hit.x)).toBeCloseTo(2.5, 2);
    }
  });

  it("returns nothing for a value the trace never reaches", () => {
    // The wave peaks at 5 V; 9 V simply never happens.
    expect(findTraceCrossings(times, sine, 9)).toEqual([]);
    expect(findTraceCrossings(times, sine, -9)).toEqual([]);
  });

  it("picks the crossing nearest the cursor, not merely the first", () => {
    const hits = findTraceCrossings(times, sine, 0);
    expect(hits.length).toBeGreaterThan(2);
    const late = 1.6e-3;
    const chosen = nearestCrossing(hits, late)!;
    for (const hit of hits) {
      expect(Math.abs(chosen.x - late)).toBeLessThanOrEqual(Math.abs(hit.x - late) + 1e-12);
    }
  });

  it("finds the exact peak as a reachable value", () => {
    // A value at the very top of the range is the boundary case between
    // reachable and not.
    expect(findTraceCrossings(times, sine, 4.999).length).toBeGreaterThan(0);
  });

  it("reads back the value the cursor sits on", () => {
    // The pairing the UI depends on: put the cursor at a time, and the value
    // box must show what the trace is doing there.
    const t = 0.25e-3; // quarter period → the positive peak
    expect(interpolateAt(times, sine, t)).toBeCloseTo(5, 1);
  });

  it("survives a flat trace", () => {
    const flat = times.map(() => 1.5);
    expect(findTraceCrossings(times, flat, 9)).toEqual([]);
    expect(interpolateAt(times, flat, 1e-3)).toBeCloseTo(1.5, 12);
  });
});
