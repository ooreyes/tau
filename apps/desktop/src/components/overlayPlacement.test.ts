import { describe, expect, it } from "vitest";
import { overlapArea, padRect, placeOverlay, type Rect } from "./overlayPlacement";

const rect = (minX: number, minY: number, maxX: number, maxY: number): Rect => ({ minX, minY, maxX, maxY });

describe("overlapArea", () => {
  it("is zero for disjoint rects", () => {
    expect(overlapArea(rect(0, 0, 10, 10), rect(20, 20, 30, 30))).toBe(0);
  });

  it("is zero for rects that only touch at an edge", () => {
    expect(overlapArea(rect(0, 0, 10, 10), rect(10, 0, 20, 10))).toBe(0);
  });

  it("computes the intersection area for overlapping rects", () => {
    expect(overlapArea(rect(0, 0, 10, 10), rect(5, 5, 15, 15))).toBe(25);
  });
});

describe("padRect", () => {
  it("grows every side by the given amount", () => {
    expect(padRect(rect(10, 10, 20, 20), 3)).toEqual(rect(7, 7, 23, 23));
  });

  it("shrinks with a negative pad", () => {
    expect(padRect(rect(10, 10, 20, 20), -2)).toEqual(rect(12, 12, 18, 18));
  });
});

describe("placeOverlay", () => {
  it("picks a zero-overlap candidate even when a later one has smaller (but nonzero) overlap", () => {
    const obstacle = rect(0, 0, 10, 10);
    const candidates = [
      { name: "clear", box: rect(100, 100, 110, 110) }, // zero overlap, but "far"
      { name: "close-but-overlapping", box: rect(9, 9, 19, 19) }, // small overlap, geometrically closer
    ];
    const chosen = placeOverlay({ candidates, obstacles: [obstacle] });
    expect(chosen.name).toBe("clear");
  });

  it("picks the minimum-overlap candidate when every candidate overlaps something", () => {
    const obstacle = rect(0, 0, 10, 10);
    const candidates = [
      { name: "big-overlap", box: rect(0, 0, 10, 10) }, // full 100 overlap
      { name: "small-overlap", box: rect(8, 8, 18, 18) }, // 4 overlap
      { name: "medium-overlap", box: rect(5, 5, 15, 15) }, // 25 overlap
    ];
    const chosen = placeOverlay({ candidates, obstacles: [obstacle] });
    expect(chosen.name).toBe("small-overlap");
  });

  it("breaks ties by candidate order, respecting the caller's priority order", () => {
    const obstacle = rect(0, 0, 10, 10);
    // Both candidates overlap the obstacle by the same amount (25).
    const candidates = [
      { name: "first", box: rect(5, 5, 15, 15) },
      { name: "second", box: rect(-5, 5, 5, 15) },
    ];
    expect(overlapArea(candidates[0].box, obstacle)).toBe(overlapArea(candidates[1].box, obstacle));
    const chosen = placeOverlay({ candidates, obstacles: [obstacle] });
    expect(chosen.name).toBe("first");

    // Reversing the priority order flips the winner, proving the tiebreak is
    // positional rather than some hidden preference for one box's geometry.
    const reversed = [...candidates].reverse();
    const chosenReversed = placeOverlay({ candidates: reversed, obstacles: [obstacle] });
    expect(chosenReversed.name).toBe("second");
  });

  it("returns the first candidate when there are no obstacles", () => {
    const candidates = [
      { name: "first", box: rect(0, 0, 10, 10) },
      { name: "second", box: rect(20, 20, 30, 30) },
    ];
    const chosen = placeOverlay({ candidates, obstacles: [] });
    expect(chosen.name).toBe("first");
  });
});
