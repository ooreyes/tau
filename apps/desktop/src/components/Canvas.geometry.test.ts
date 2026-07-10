import { describe, expect, it } from "vitest";
import {
  circuitBounds,
  circuitBoundsWithLabels,
  countRouteBodyHits,
  fitViewTransform,
  rectsOverlap,
  rerouteMovedWires,
  routeWireSmart,
  segmentIntersectsRect,
  translateAttachedWireEndpoints,
  wireIntersectsRect,
} from "./Canvas.geometry";
import type { SchematicComponent } from "../schematic/types";

const comp = (id: string, x: number, y: number): SchematicComponent =>
  ({ id, kind: "resistor", x, y, rotation: 0, value: "1k" }) as SchematicComponent;

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

  it("routes a horizontal wire directly when start and end share a y coordinate", () => {
    const route = routeWireSmart({ x: 0, y: 32 }, { x: 96, y: 32 }, []);
    expect(route).toEqual([{ x: 0, y: 32 }, { x: 96, y: 32 }]);
  });

  it("routes an L-shaped wire for diagonal endpoints with no components", () => {
    const route = routeWireSmart({ x: 0, y: 0 }, { x: 96, y: 64 }, []);
    // Must be at least 2 points (start + end) and all segments must be axis-aligned.
    expect(route.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < route.length; i += 1) {
      const a = route[i - 1];
      const b = route[i];
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
    expect(route[0]).toEqual({ x: 0, y: 0 });
    expect(route[route.length - 1]).toEqual({ x: 96, y: 64 });
  });

  it("does not move a wire whose endpoints are not in the moved pins list", () => {
    const wire = { id: "w1", points: [{ x: 0, y: 0 }, { x: 32, y: 0 }] };
    const moved = translateAttachedWireEndpoints([wire], [], 16, 16);
    expect(moved[0].points).toEqual(wire.points);
  });

  it("handles wires with a single valid point safely (degenerate case)", () => {
    // Wires with fewer than 2 points are returned unchanged by translateAttachedWireEndpoints.
    const wire = { id: "w1", points: [{ x: 0, y: 0 }] };
    const moved = translateAttachedWireEndpoints([wire], [{ x: 0, y: 0 }], 16, 0);
    expect(moved[0].points).toEqual([{ x: 0, y: 0 }]);
  });

  it("re-routes a wire around a body after a move when a clear channel exists", () => {
    // Resistor body sits on the straight path between endpoints; smart route
    // should dogleg around it so routeHitCount is 0.
    const blocker = comp("r1", 48, 0);
    const throughBody: { id: string; points: { x: number; y: number }[] } = {
      id: "w1",
      points: [
        { x: 0, y: 0 },
        { x: 96, y: 0 },
      ],
    };
    expect(countRouteBodyHits(throughBody.points, [blocker])).toBeGreaterThan(0);

    const rerouted = rerouteMovedWires([throughBody], [blocker], new Set(["w1"]));
    expect(countRouteBodyHits(rerouted[0].points, [blocker])).toBe(0);
    expect(rerouted[0].points[0]).toEqual({ x: 0, y: 0 });
    expect(rerouted[0].points[rerouted[0].points.length - 1]).toEqual({ x: 96, y: 0 });
  });

  it("routes around a body even when start and end share an axis", () => {
    const blocker = comp("r1", 48, 0);
    const route = routeWireSmart({ x: 0, y: 0 }, { x: 96, y: 0 }, [blocker]);
    expect(countRouteBodyHits(route, [blocker])).toBe(0);
    expect(route.length).toBeGreaterThan(2);
  });
});

describe("circuitBounds (fit-to-view math)", () => {
  it("returns null for a completely empty schematic", () => {
    expect(circuitBounds([], [])).toBeNull();
  });

  it("pads a single component by the symbol margin on every side", () => {
    expect(circuitBounds([comp("r1", 100, 200)], [])).toEqual({
      minX: 60,
      minY: 160,
      maxX: 140,
      maxY: 240,
    });
  });

  it("spans the extremes of multiple components", () => {
    const b = circuitBounds([comp("r1", 0, 0), comp("r2", 320, 160)], []);
    expect(b).toEqual({ minX: -40, minY: -40, maxX: 360, maxY: 200 });
  });

  it("includes bare wire points (no extra margin) alongside components", () => {
    const b = circuitBounds(
      [comp("r1", 100, 100)],
      [{ id: "w1", points: [{ x: 100, y: 100 }, { x: 400, y: 300 }] }],
    );
    expect(b).toEqual({ minX: 60, minY: 60, maxX: 400, maxY: 300 });
  });

  it("frames a wire-only schematic (e.g. a stray net) without components", () => {
    const b = circuitBounds([], [{ id: "w1", points: [{ x: -50, y: 20 }, { x: 50, y: 80 }] }]);
    expect(b).toEqual({ minX: -50, minY: 20, maxX: 50, maxY: 80 });
  });

  it("honors a custom margin", () => {
    expect(circuitBounds([comp("r1", 0, 0)], [], 10)).toEqual({
      minX: -10,
      minY: -10,
      maxX: 10,
      maxY: 10,
    });
  });
});

describe("circuitBoundsWithLabels (§11 Unit A2)", () => {
  it("returns null for an empty schematic, matching circuitBounds", () => {
    expect(circuitBoundsWithLabels([], [])).toBeNull();
  });

  it("is a superset of circuitBounds when a component carries label text", () => {
    const c = { ...comp("r1", 100, 200), label: "R1", value: "10k" } as SchematicComponent;
    const base = circuitBounds([c], [])!;
    const withLabels = circuitBoundsWithLabels([c], [])!;
    expect(withLabels.minX).toBeLessThanOrEqual(base.minX);
    expect(withLabels.minY).toBeLessThanOrEqual(base.minY);
    expect(withLabels.maxX).toBeGreaterThanOrEqual(base.maxX);
    expect(withLabels.maxY).toBeGreaterThanOrEqual(base.maxY);
    // The label must actually widen the box on at least one side — otherwise
    // this helper would be indistinguishable from circuitBounds.
    const widened =
      withLabels.minX < base.minX || withLabels.maxX > base.maxX ||
      withLabels.minY < base.minY || withLabels.maxY > base.maxY;
    expect(widened).toBe(true);
  });
});

describe("fitViewTransform padding (§11 Unit A2)", () => {
  const bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 500 };

  it("keeps 12% of the viewport clear on the constrained axis", () => {
    // 1000x800 viewport: padX = 120, availW = 760 → zoom = 0.76 (width-bound,
    // since availH/500 = 608/500 = 1.216). Left edge of the circuit lands at
    // exactly padX; centering is exact on both axes.
    const t = fitViewTransform(bounds, 1000, 800);
    expect(t.zoom).toBeCloseTo(0.76, 10);
    expect(t.x + bounds.minX * t.zoom).toBeCloseTo(120, 10); // screen-x of minX
    expect(t.x + bounds.maxX * t.zoom).toBeCloseTo(880, 10);
    // Vertically centered: equal slack above and below.
    const top = t.y + bounds.minY * t.zoom;
    const bottom = 800 - (t.y + bounds.maxY * t.zoom);
    expect(top).toBeCloseTo(bottom, 10);
  });

  it("enforces the 48px floor when 12% of a small viewport would be less", () => {
    // 300x200 viewport: 12% → 36/24px, both floored to 48. availW=204,
    // availH=104 → height-bound zoom for a 100x100 circuit = 1.04, and the
    // constrained (vertical) edges sit exactly 48px in.
    const square = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const t = fitViewTransform(square, 300, 200);
    expect(t.zoom).toBeCloseTo(1.04, 10);
    expect(t.y + square.minY * t.zoom).toBeCloseTo(48, 10);
    expect(200 - (t.y + square.maxY * t.zoom)).toBeCloseTo(48, 10);
  });

  it("clamps zoom for tiny and huge circuits", () => {
    const point = { minX: 0, minY: 0, maxX: 8, maxY: 8 };
    expect(fitViewTransform(point, 1440, 900).zoom).toBe(5);
    const huge = { minX: 0, minY: 0, maxX: 1e6, maxY: 1e6 };
    expect(fitViewTransform(huge, 1440, 900).zoom).toBe(0.25);
  });

  it("stays finite for degenerate zero-size bounds and tiny viewports", () => {
    const point = { minX: 50, minY: 50, maxX: 50, maxY: 50 };
    const t = fitViewTransform(point, 60, 40); // viewport smaller than 2×minPad
    expect(Number.isFinite(t.zoom)).toBe(true);
    expect(Number.isFinite(t.x)).toBe(true);
    expect(Number.isFinite(t.y)).toBe(true);
    // A point circuit centers in the viewport.
    expect(t.x + 50 * t.zoom).toBeCloseTo(30, 10);
    expect(t.y + 50 * t.zoom).toBeCloseTo(20, 10);
  });

  it("honors custom padding options", () => {
    const t = fitViewTransform(bounds, 1000, 800, { paddingFraction: 0, minPaddingPx: 0 });
    // No padding: width-bound zoom fills the viewport exactly.
    expect(t.zoom).toBeCloseTo(1000 / 1000, 10);
    expect(t.x + bounds.minX * t.zoom).toBeCloseTo(0, 10);
  });
});

describe("marquee intersection geometry (§UX checklist 3)", () => {
  const rect = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

  it("rectsOverlap: overlap, containment, touch, and miss", () => {
    expect(rectsOverlap(rect, { minX: 50, minY: 50, maxX: 150, maxY: 150 })).toBe(true); // partial
    expect(rectsOverlap(rect, { minX: 20, minY: 20, maxX: 30, maxY: 30 })).toBe(true); // contained
    expect(rectsOverlap(rect, { minX: 100, minY: 0, maxX: 120, maxY: 10 })).toBe(true); // edge touch
    expect(rectsOverlap(rect, { minX: 101, minY: 0, maxX: 120, maxY: 10 })).toBe(false); // miss
  });

  it("segmentIntersectsRect: a horizontal segment crossing THROUGH the box selects", () => {
    expect(segmentIntersectsRect({ a: { x: -50, y: 50 }, b: { x: 150, y: 50 } }, rect)).toBe(true);
  });

  it("segmentIntersectsRect: a segment that only clips a corner region selects", () => {
    expect(segmentIntersectsRect({ a: { x: 90, y: -20 }, b: { x: 90, y: 20 } }, rect)).toBe(true);
  });

  it("segmentIntersectsRect: a segment fully outside does not select", () => {
    expect(segmentIntersectsRect({ a: { x: -50, y: 150 }, b: { x: 150, y: 150 } }, rect)).toBe(false);
    expect(segmentIntersectsRect({ a: { x: 120, y: 0 }, b: { x: 120, y: 100 } }, rect)).toBe(false);
  });

  it("wireIntersectsRect: an L-wire counts when ANY segment intersects", () => {
    const wire = { id: "w1", points: [{ x: -50, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 300 }] };
    expect(wireIntersectsRect(wire, rect)).toBe(true);
    const missWire = { id: "w2", points: [{ x: -50, y: 150 }, { x: 50, y: 150 }, { x: 50, y: 300 }] };
    expect(wireIntersectsRect(missWire, rect)).toBe(false);
  });
});
