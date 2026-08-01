import { describe, expect, it } from "vitest";
import {
  ascArcPath,
  ascShapeRender,
  autoNetLabelOffset,
  autoNetLabelOffsets,
  buildLabelPlacements,
  circuitBounds,
  circuitBoundsWithLabels,
  componentVisualPlacement,
  componentWorldRect,
  countRouteBodyHits,
  fitViewTransform,
  netLabelTextRect,
  pathWithHops,
  rectsOverlap,
  rerouteMovedWires,
  routeWireSmart,
  segmentIntersectsRect,
  translateAttachedWireEndpoints,
  wireIntersectsRect,
} from "./Canvas.geometry";
import type { SchematicAscShape, SchematicComponent } from "../schematic/types";
import { GRID } from "../schematic/symbols";
import { getLocalPins, transformPoint } from "../schematic/pins";

const comp = (id: string, x: number, y: number): SchematicComponent =>
  ({ id, kind: "resistor", x, y, rotation: 0, value: "1k" }) as SchematicComponent;

// Tau-authored geometry equivalent to the failure mode: imported file anchors
// sit above/left of the exact terminal bank, and the imported passive axis can
// differ from Tau's native default. No external schematic content is embedded.
const IMPORTED_VISUAL_FIXTURES: SchematicComponent[] = [
  {
    id: "imported-r", kind: "resistor", label: "R1", value: "470", x: 96, y: 96, rotation: 0,
    pinOverride: [
      { id: "a", label: "A", x: 112, y: 112 },
      { id: "b", label: "B", x: 112, y: 192 },
    ],
  },
  {
    id: "imported-c", kind: "capacitor", label: "C1", value: "220p", x: 320, y: 96, rotation: 90,
    pinOverride: [
      { id: "a", label: "A", x: 320, y: 112 },
      { id: "b", label: "B", x: 256, y: 112 },
    ],
  },
  {
    id: "imported-j", kind: "njf", label: "Q1", value: "NJF", x: 480, y: 96, rotation: 0,
    pinOverride: [
      { id: "d", label: "D", x: 528, y: 96 },
      { id: "g", label: "G", x: 480, y: 160 },
      { id: "s", label: "S", x: 528, y: 192 },
    ],
  },
];

const IMPORTED_VISUAL_WIRES = [
  { id: "wr-a", points: [{ x: 64, y: 112 }, { x: 112, y: 112 }] },
  { id: "wr-b", points: [{ x: 112, y: 192 }, { x: 160, y: 192 }] },
  { id: "wc", points: [{ x: 256, y: 112 }, { x: 320, y: 112 }] },
  { id: "wj-g", points: [{ x: 432, y: 160 }, { x: 480, y: 160 }] },
];

describe("imported LTspice symbol presentation", () => {
  const components = IMPORTED_VISUAL_FIXTURES;
  const byLabel = (label: string) => components.find((component) => component.label === label)!;

  it("centres and rotates imported passives on their real terminal bank", () => {
    expect(componentVisualPlacement(byLabel("R1"))).toMatchObject({ x: 112, y: 152, rotation: 90, mirrored: false });
    expect(componentVisualPlacement(byLabel("C1"))).toMatchObject({ x: 288, y: 112, rotation: 180, mirrored: false });
  });

  it("moves an imported JFET body from its file anchor into the D/G/S pin bank", () => {
    const placement = componentVisualPlacement(byLabel("Q1"));
    expect(placement.x).toBeCloseTo(512);
    expect(placement.y).toBeCloseTo(149.333333);
    expect(placement.rotation).toBe(0);
    expect(placement.mirrored).toBe(false);
  });

  it("renders only straight terminal extensions instead of crooked diagonal repair leads", () => {
    for (const component of components) {
      if (!component.pinOverride?.length) continue;
      const placement = componentVisualPlacement(component);
      const nativePins = new Map(getLocalPins(component.kind).map((pin) => [pin.id, pin]));
      for (const target of component.pinOverride) {
        const native = nativePins.get(target.id);
        if (!native) continue;
        const local = transformPoint(native, placement.rotation, placement.mirrored);
        const start = { x: placement.x + local.x, y: placement.y + local.y };
        expect(
          start.x === target.x || start.y === target.y,
          `${component.label}.${target.id} lead ${start.x},${start.y} -> ${target.x},${target.y}`,
        ).toBe(true);
      }
    }
  });

  it("keeps imported reference/value pairs from overlapping one another", () => {
    const placements = [...buildLabelPlacements(components, IMPORTED_VISUAL_WIRES).values()];
    expect(placements).toHaveLength(components.length);
    for (let left = 0; left < placements.length; left += 1) {
      for (let right = left + 1; right < placements.length; right += 1) {
        expect(rectsOverlap(placements[left].box, placements[right].box)).toBe(false);
      }
    }
  });
});

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

  it("adds an orthogonal lead when a moved pin was attached to a wire interior", () => {
    const moved = translateAttachedWireEndpoints(
      [{ id: "bus", points: [{ x: -96, y: 0 }, { x: 96, y: 0 }] }],
      [{ x: 0, y: 0 }],
      32,
      32,
    );
    expect(moved[0].points).toEqual([{ x: -96, y: 0 }, { x: 96, y: 0 }]);
    expect(moved[1].points).toEqual([{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 32 }]);
  });

  it("keeps a shared stationary-pin junction and adds a lead to the moved pin", () => {
    const moved = translateAttachedWireEndpoints(
      [{ id: "shared", points: [{ x: 0, y: 0 }, { x: 96, y: 0 }] }],
      [{ x: 0, y: 0 }],
      32,
      32,
      [{ x: 0, y: 0 }],
    );
    expect(moved[0].points).toEqual([{ x: 0, y: 0 }, { x: 96, y: 0 }]);
    expect(moved[1].points).toEqual([{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 32 }]);
  });

  it("routes a horizontal wire directly when start and end share a y coordinate", () => {
    const route = routeWireSmart({ x: 0, y: 32 }, { x: 96, y: 32 }, []);
    expect(route).toEqual([{ x: 0, y: 32 }, { x: 96, y: 32 }]);
  });

  it("snaps a slightly off-axis gesture onto a component pin without a tiny dogleg", () => {
    const resistor = comp("r1", 64, 0); // left pin is exactly (32, 0)
    const route = routeWireSmart({ x: -31.7, y: 0.3 }, { x: 31.6, y: -0.4 }, [resistor]);

    expect(route).toEqual([{ x: -32, y: 0 }, { x: 32, y: 0 }]);
  });

  it("keeps obstacle detours on full grid segments when the pointer is fractionally off-axis", () => {
    const route = routeWireSmart({ x: 0.2, y: -0.3 }, { x: 96.3, y: 0.4 }, [comp("r1", 48, 0)]);

    expect(countRouteBodyHits(route, [comp("r1", 48, 0)])).toBe(0);
    for (const point of route) {
      expect(Math.abs(point.x % GRID)).toBe(0);
      expect(Math.abs(point.y % GRID)).toBe(0);
    }
    for (let index = 1; index < route.length; index += 1) {
      const a = route[index - 1];
      const b = route[index];
      expect(a.x === b.x || a.y === b.y).toBe(true);
      expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(GRID);
    }
  });

  it("preserves an exact off-grid imported-wire junction instead of snapping it away", () => {
    const existing = [{ id: "imported", points: [{ x: 20, y: 5 }, { x: 100, y: 5 }] }];
    const route = routeWireSmart({ x: 20, y: 5 }, { x: 20, y: 69 }, [], existing);

    expect(route[0]).toEqual({ x: 20, y: 5 });
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

  it("does not use another terminal of the endpoint component as an elbow", () => {
    const importedVerticalResistor: SchematicComponent = {
      ...comp("r1", 80, 0),
      pinOverride: [
        { id: "a", label: "A", x: 96, y: 16 },
        { id: "b", label: "B", x: 96, y: 96 },
      ],
    };
    const unintendedPin = { x: 96, y: 96 };
    const route = routeWireSmart({ x: 0, y: 96 }, { x: 96, y: 16 }, [importedVerticalResistor]);

    expect(route.slice(1, -1)).not.toContainEqual(unintendedPin);
    for (let index = 1; index < route.length; index += 1) {
      const a = route[index - 1];
      const b = route[index];
      const touches = a.x === b.x
        ? unintendedPin.x === a.x && unintendedPin.y >= Math.min(a.y, b.y) && unintendedPin.y <= Math.max(a.y, b.y)
        : unintendedPin.y === a.y && unintendedPin.x >= Math.min(a.x, b.x) && unintendedPin.x <= Math.max(a.x, b.x);
      expect(touches).toBe(false);
    }
  });

  it("uses a clear channel instead of overlapping an existing wire", () => {
    const existing = [{
      id: "existing",
      points: [{ x: 16, y: 0 }, { x: 80, y: 0 }],
    }];
    const route = routeWireSmart({ x: 0, y: 0 }, { x: 96, y: 0 }, [], existing);
    expect(route.length).toBeGreaterThan(2);
    expect(route.some((point) => point.y !== 0)).toBe(true);
  });

  it("routes around a finite crossing wire when a clear channel exists", () => {
    const existing = [{
      id: "existing",
      points: [{ x: 48, y: -16 }, { x: 48, y: 16 }],
    }];
    const route = routeWireSmart({ x: 0, y: 0 }, { x: 96, y: 0 }, [], existing);
    expect(route.length).toBeGreaterThan(2);
    expect(route.some((point) => Math.abs(point.y) >= 32)).toBe(true);
  });

  it("does not pass through a pre-existing wire endpoint in the middle of a route", () => {
    const existing = [{
      id: "existing",
      points: [{ x: 48, y: 0 }, { x: 48, y: 32 }],
    }];
    const route = routeWireSmart({ x: 0, y: 0 }, { x: 96, y: 0 }, [], existing);
    expect(route.length).toBeGreaterThan(2);
    expect(route.some((point) => point.y !== 0)).toBe(true);
  });

  it("allows an intentional connection when the existing node is the route endpoint", () => {
    const existing = [{
      id: "existing",
      points: [{ x: 48, y: 0 }, { x: 48, y: 32 }],
    }];
    expect(routeWireSmart({ x: 0, y: 0 }, { x: 48, y: 0 }, [], existing)).toEqual([
      { x: 0, y: 0 },
      { x: 48, y: 0 },
    ]);
  });

  it("does not place a candidate elbow on the interior of an existing wire", () => {
    const existing = [{
      id: "existing",
      points: [{ x: 48, y: -32 }, { x: 48, y: 64 }],
    }];
    const route = routeWireSmart({ x: 0, y: 0 }, { x: 48, y: 96 }, [], existing);
    expect(route.slice(1, -1)).not.toContainEqual({ x: 48, y: 0 });
  });

  it("moves imported off-grid parallel runs onto a visibly separate lane", () => {
    const existing = [{
      id: "existing",
      points: [{ x: 16, y: 8 }, { x: 80, y: 8 }],
    }];
    const route = routeWireSmart({ x: 0, y: 0 }, { x: 96, y: 0 }, [], existing);
    expect(route.length).toBeGreaterThan(2);
    expect(route.some((point) => Math.abs(point.y) >= GRID)).toBe(true);
  });
});

describe("circuitBounds (fit-to-view math)", () => {
  it("returns null for a completely empty schematic", () => {
    expect(circuitBounds([], [])).toBeNull();
  });

  it("pads the real horizontal symbol footprint instead of a fixed square around its origin", () => {
    expect(circuitBounds([comp("r1", 100, 200)], [])).toEqual({
      minX: 52,
      minY: 172,
      maxX: 148,
      maxY: 228,
    });
  });

  it("spans the extremes of multiple components", () => {
    const b = circuitBounds([comp("r1", 0, 0), comp("r2", 320, 160)], []);
    expect(b).toEqual({ minX: -48, minY: -28, maxX: 368, maxY: 188 });
  });

  it("includes bare wire points (no extra margin) alongside components", () => {
    const b = circuitBounds(
      [comp("r1", 100, 100)],
      [{ id: "w1", points: [{ x: 100, y: 100 }, { x: 400, y: 300 }] }],
    );
    expect(b).toEqual({ minX: 52, minY: 72, maxX: 400, maxY: 300 });
  });

  it("frames a wire-only schematic (e.g. a stray net) without components", () => {
    const b = circuitBounds([], [{ id: "w1", points: [{ x: -50, y: 20 }, { x: 50, y: 80 }] }]);
    expect(b).toEqual({ minX: -50, minY: 20, maxX: 50, maxY: 80 });
  });

  it("honors a custom margin", () => {
    expect(circuitBounds([comp("r1", 0, 0)], [], 10)).toEqual({
      minX: -42,
      minY: -22,
      maxX: 42,
      maxY: 22,
    });
  });

  it("rotates the fitted footprint through every resistor orientation, including vertical", () => {
    for (const rotation of [0, 180] as const) {
      expect(circuitBounds([{ ...comp(`r-${rotation}`, 100, 200), rotation }], [], 0)).toEqual({
        minX: 68,
        minY: 188,
        maxX: 132,
        maxY: 212,
      });
    }
    for (const rotation of [90, 270] as const) {
      expect(circuitBounds([{ ...comp(`r-${rotation}`, 100, 200), rotation }], [], 0)).toEqual({
        minX: 88,
        minY: 168,
        maxX: 112,
        maxY: 232,
      });
    }
    const vertical = { ...comp("r1", 100, 200), rotation: 90 as const };
    expect(circuitBounds([vertical], [])).toEqual({
      minX: 72,
      minY: 152,
      maxX: 128,
      maxY: 248,
    });
  });

  it("includes absolute imported pin overrides in the fit frame", () => {
    const imported = {
      ...comp("r1", 100, 200),
      pinOverride: [
        { id: "a", label: "A", x: -50, y: 20 },
        { id: "b", label: "B", x: 400, y: 500 },
      ],
    };
    expect(circuitBounds([imported], [], 0)).toEqual({
      minX: -50,
      minY: 20,
      maxX: 400,
      maxY: 500,
    });
  });

  it("keeps asymmetric symbols centered from their rendered orientation, not their origin", () => {
    const ground = (rotation: 0 | 90 | 180 | 270): SchematicComponent => ({
      id: `g-${rotation}`,
      kind: "ground",
      x: 0,
      y: 0,
      rotation,
      value: "",
      label: "",
    });
    expect(circuitBounds([ground(0)], [], 0)).toEqual({ minX: -12, minY: -3, maxX: 12, maxY: 22 });
    expect(circuitBounds([ground(90)], [], 0)).toEqual({ minX: -22, minY: -12, maxX: 3, maxY: 12 });
    expect(circuitBounds([ground(180)], [], 0)).toEqual({ minX: -12, minY: -22, maxX: 12, maxY: 3 });
    expect(circuitBounds([ground(270)], [], 0)).toEqual({ minX: -3, minY: -12, maxX: 22, maxY: 12 });
  });
});

describe("circuitBoundsWithLabels", () => {
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
    // The label must actually widen the box on at least one side - otherwise
    // this helper would be indistinguishable from circuitBounds.
    const widened =
      withLabels.minX < base.minX || withLabels.maxX > base.maxX ||
      withLabels.minY < base.minY || withLabels.maxY > base.maxY;
    expect(widened).toBe(true);
  });
});

describe("autoNetLabelOffset (Fix 2 - net label auto-placement)", () => {
  it("defaults to the right-above offset (today's old fixed default) when nothing obstructs it", () => {
    expect(autoNetLabelOffset({ x: 0, y: 0 }, "OUT", [])).toEqual({ dx: 6, dy: -6 });
  });

  it("picks a candidate whose text bbox clears the component when the default position collides", () => {
    const blocker = comp("r1", 0, 0);
    const blockerRect = componentWorldRect(blocker);
    // Sanity: the default right-above candidate's start point (anchor + 6,-6)
    // does land inside this blocker's own bbox for this placement - otherwise
    // this test isn't actually exercising the collision-avoidance path.
    expect(blockerRect.minX).toBeLessThanOrEqual(6);
    expect(blockerRect.maxX).toBeGreaterThanOrEqual(6);
    expect(blockerRect.minY).toBeLessThanOrEqual(-6);
    expect(blockerRect.maxY).toBeGreaterThanOrEqual(-6);

    const offset = autoNetLabelOffset({ x: 0, y: 0 }, "OUT", [blocker]);
    expect(offset).not.toEqual({ dx: 6, dy: -6 });
    const startX = offset.dx;
    const startY = offset.dy;
    const clearsBbox = startX < blockerRect.minX || startX > blockerRect.maxX
      || startY < blockerRect.minY || startY > blockerRect.maxY;
    expect(clearsBbox).toBe(true);
  });

  it("is deterministic for identical inputs (no randomness, no dependence on call order)", () => {
    const blocker = comp("r1", 0, 0);
    const first = autoNetLabelOffset({ x: 10, y: 10 }, "VOUT", [blocker]);
    const second = autoNetLabelOffset({ x: 10, y: 10 }, "VOUT", [blocker]);
    expect(first).toEqual(second);
  });

  it("places automatic labels as a set so they do not choose the same slot", () => {
    const offsets = autoNetLabelOffsets([
      { id: "a", x: 0, y: 0, text: "INPUT" },
      { id: "b", x: 0, y: 0, text: "SENSE" },
    ], []);
    expect(offsets.get("a")).toEqual({ dx: 6, dy: -6 });
    expect(offsets.get("b")).not.toEqual(offsets.get("a"));
  });

  it("keeps an explicit user label fixed and routes automatic labels around it", () => {
    const offsets = autoNetLabelOffsets([
      { id: "fixed", x: 0, y: 0, text: "INPUT", dx: 6, dy: -6 },
      { id: "auto", x: 0, y: 0, text: "SENSE" },
    ], []);
    expect(offsets.get("fixed")).toEqual({ dx: 6, dy: -6 });
    expect(offsets.get("auto")).not.toEqual({ dx: 6, dy: -6 });
  });

  it("does not settle a net label on a component's reference designator", () => {
    // Regression: only component *symbols* were treated as obstacles, so a net
    // label could land squarely on the refdes/value text that
    // buildLabelPlacements had already positioned. Reproduced from
    // Circuit_testing_v1/02_tran_rc_pulse_meas.asc, where FLAG 304 96 "out"
    // rendered on top of R1 in a three-part RC circuit.
    // Real geometry from that file: SYMBOL res 320 80 R90, refdes R1, 1k.
    const r1 = {
      id: "r1", kind: "resistor", label: "R1", value: "1k", x: 320, y: 80, rotation: 90,
    } as SchematicComponent;
    const labelBoxes = [...buildLabelPlacements([r1], []).values()].map((p) => p.box);
    expect(labelBoxes.length).toBeGreaterThan(0);

    const offsets = autoNetLabelOffsets([{ id: "out", x: 304, y: 96, text: "out" }], [r1]);
    const chosen = offsets.get("out");
    expect(chosen).toBeDefined();

    const box = netLabelTextRect({ x: 304, y: 96 }, chosen!.dx, chosen!.dy, "out");
    for (const labelBox of labelBoxes) {
      expect(
        rectsOverlap(box, labelBox),
        `net label overlaps component label text ${JSON.stringify(labelBox)}`,
      ).toBe(false);
    }
  });
});

describe("fitViewTransform padding", () => {
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

  it("keeps an explicit topology center fixed when label bounds are asymmetric", () => {
    const labelHeavyBounds = { minX: -180, minY: -50, maxX: 120, maxY: 50 };
    const t = fitViewTransform(labelHeavyBounds, 600, 300, {
      paddingFraction: 0,
      minPaddingPx: 0,
      center: { x: 0, y: 0 },
    });

    expect(t.x).toBeCloseTo(300, 10);
    expect(t.y).toBeCloseTo(150, 10);
    expect(t.x + labelHeavyBounds.minX * t.zoom).toBeGreaterThanOrEqual(0);
    expect(t.x + labelHeavyBounds.maxX * t.zoom).toBeLessThanOrEqual(600);
  });
});

describe("marquee intersection geometry ", () => {
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

describe("pathWithHops - hop-over arcs at unconnected crossings", () => {
  it("arcs over each crossing on a left-to-right horizontal segment, in order", () => {
    const d = pathWithHops(
      [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      new Map([[0, [64, 32]]]),
    );
    // Crossings sorted along travel: 32 before 64; sweep 1 bulges the arc up.
    expect(d).toBe("M 0 0 L 28 0 A 4 4 0 0 1 36 0 L 60 0 A 4 4 0 0 1 68 0 L 100 0");
  });

  it("flips the sweep on right-to-left travel so the bump still points up", () => {
    const d = pathWithHops(
      [{ x: 100, y: 0 }, { x: 0, y: 0 }],
      new Map([[0, [40]]]),
    );
    expect(d).toBe("M 100 0 L 44 0 A 4 4 0 0 0 36 0 L 0 0");
  });

  it("drops hops that would deform a corner and leaves vertical segments straight", () => {
    const d = pathWithHops(
      [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 80 }],
      new Map([
        [0, [2, 39]], // both within HOP_RADIUS of an endpoint → dropped
        [1, [50]], // vertical segment: hops don't apply
      ]),
    );
    expect(d).toBe("M 0 0 L 40 0 L 40 80");
  });
});

describe("ascShapeRender", () => {
  const shape = (
    kind: SchematicAscShape["kind"],
    coords: number[],
    width: SchematicAscShape["width"] = "Normal",
  ): SchematicAscShape => ({ kind, width, coords });

  it("normalises a box whose corners arrive in the author's drag order", () => {
    // Real records in the LTspice corpus put the second corner above and left
    // of the first, so a raw `x2 - x1` is negative and `<rect>` draws nothing.
    const rect = ascShapeRender(shape("RECTANGLE", [96, 240, -32, 16]));
    expect(rect).toEqual({
      kind: "RECTANGLE",
      wide: false,
      style: 0,
      x: -32,
      y: 16,
      width: 128,
      height: 224,
    });
  });

  it("reads a circle as the ellipse inscribed in its box, keeping the style index", () => {
    // `CIRCLE Normal -32 224 -112 -32 2` - a real corpus record, both corners
    // reversed, with LTspice's dotted pen.
    expect(ascShapeRender(shape("CIRCLE", [-32, 224, -112, -32, 2]))).toEqual({
      kind: "CIRCLE",
      wide: false,
      style: 2,
      cx: -72,
      cy: 96,
      rx: 40,
      ry: 128,
    });
  });

  it("keeps a line's endpoints as drawn and defaults an absent style to solid", () => {
    expect(ascShapeRender(shape("LINE", [16, 80, 16, -32], "Wide"))).toEqual({
      kind: "LINE",
      wide: true,
      style: 0,
      x1: 16,
      y1: 80,
      x2: 16,
      y2: -32,
    });
  });

  // LTspice's own `ind.asy` draws an inductor as three arcs between pins at
  // (16,16) and (16,96), so every hump has to bulge clear of that axis. That
  // makes the file ground truth for the sweep direction: the wrong way round
  // gives three shallow nicks on the far side instead of a coil.
  const INDUCTOR_ARCS = [
    [0, 40, 32, 72, 4, 68, 4, 44],
    [0, 64, 32, 96, 16, 96, 4, 68],
    [0, 16, 32, 48, 4, 44, 16, 16],
  ];

  it("sweeps an arc the way LTspice draws it, so an inductor's humps clear the pin axis", () => {
    for (const coords of INDUCTOR_ARCS) {
      const arc = ascShapeRender(shape("ARC", coords));
      if (arc?.kind !== "ARC") throw new Error("expected an arc");
      // Which of the two candidate curves gets drawn is exactly what
      // `largeArc` decides, so recover the midpoint from the chord rather than
      // from the shipped angle arithmetic: it sits on the far side of the
      // centre from the chord when the long way round is taken.
      const chordX = (arc.start.x + arc.end.x) / 2 - arc.cx;
      const chordY = (arc.start.y + arc.end.y) / 2 - arc.cy;
      const norm = Math.hypot(chordX, chordY);
      const sign = arc.largeArc ? -1 : 1;
      const midX = arc.cx + (sign * chordX / norm) * arc.rx;
      const midY = arc.cy + (sign * chordY / norm) * arc.ry;
      expect(arc.largeArc).toBe(true);
      // Right of the pin axis at x = 16, and clear of it, not grazing.
      expect(midX).toBeGreaterThan(24);
      expect(midY).toBeGreaterThan(arc.cy - arc.ry - 1e-9);
      expect(midY).toBeLessThan(arc.cy + arc.ry + 1e-9);
    }
  });

  it("projects an arc's rays onto the ellipse instead of drawing to the raw record point", () => {
    // LTspice stores a direction from the centre, not a point on the curve:
    // (4,68) is 16.97 from the centre of a circle of radius 16.
    const arc = ascShapeRender(shape("ARC", INDUCTOR_ARCS[0]));
    if (arc?.kind !== "ARC") throw new Error("expected an arc");
    expect(Math.hypot(arc.start.x - arc.cx, arc.start.y - arc.cy)).toBeCloseTo(16, 9);
    expect(Math.hypot(arc.end.x - arc.cx, arc.end.y - arc.cy)).toBeCloseTo(16, 9);
    expect(arc.start.x).toBeCloseTo(4.686, 3);
    expect(arc.start.y).toBeCloseTo(67.314, 3);
  });

  it("writes the counterclockwise sweep flag SVG needs under a downward y axis", () => {
    const arc = ascShapeRender(shape("ARC", INDUCTOR_ARCS[0]));
    if (arc?.kind !== "ARC") throw new Error("expected an arc");
    expect(ascArcPath(arc)).toBe("M 4.686 67.314 A 16 16 0 1 0 4.686 44.686");
  });

  it("drops an arc with no extent rather than emitting a path of NaN", () => {
    // A zero-width box makes the ray projection divide by zero; the record has
    // nothing to draw either way.
    expect(ascShapeRender(shape("ARC", [40, 16, 40, 48, 4, 44, 16, 16]))).toBeNull();
    expect(ascShapeRender(shape("ARC", [0, 16, 32, 16, 4, 44, 16, 16]))).toBeNull();
  });
});
