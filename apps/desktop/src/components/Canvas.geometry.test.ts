import { describe, expect, it } from "vitest";
import { routeWireSmart, translateAttachedWireEndpoints } from "./Canvas";

describe("Canvas wire geometry", () => {
  it("keeps an identical wire preview inert instead of dereferencing an empty route", () => {
    expect(routeWireSmart({ x: 0, y: 0 }, { x: 0, y: 0 }, [])).toEqual([{ x: 0, y: 0 }]);
  });

  it("moves component-attached wire endpoints without creating diagonal segments", () => {
    const moved = translateAttachedWireEndpoints(
      [{ id: "w1", points: [{ x: 32, y: 0 }, { x: 96, y: 0 }] }],
      [{ x: -32, y: 0 }, { x: 32, y: 0 }],
      16,
      16,
    );

    expect(moved[0].points).toEqual([
      { x: 48, y: 16 },
      { x: 96, y: 16 },
      { x: 96, y: 0 },
    ]);
    for (let index = 1; index < moved[0].points.length; index += 1) {
      const a = moved[0].points[index - 1];
      const b = moved[0].points[index];
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
  });

  it("translates a wire as a unit when both endpoints belong to the moved component", () => {
    const moved = translateAttachedWireEndpoints(
      [{ id: "w1", points: [{ x: -32, y: 0 }, { x: 32, y: 0 }] }],
      [{ x: -32, y: 0 }, { x: 32, y: 0 }],
      16,
      -16,
    );

    expect(moved[0].points).toEqual([{ x: -16, y: -16 }, { x: 48, y: -16 }]);
  });
});
