import { GRID, SYMBOL_BODY, SYMBOL_BOX } from "../schematic/symbols";
import { CATALOG_BY_KIND } from "../schematic/catalog";
import type { ComponentKind, Point, SchematicComponent, SchematicWire } from "../schematic/types";
import { getLocalPins, getComponentPins, transformPoint } from "../schematic/pins";
import { decodeParams } from "../schematic/params";

export const snap = (v: number) => Math.round(v / GRID) * GRID;

/** World-space bounding box of a circuit, with a per-symbol margin so parts are
 *  never flush against the frame. Returns null for an empty schematic. Pure so
 *  the fit-to-view math is unit-testable without a DOM. */
export function circuitBounds(
  components: readonly SchematicComponent[],
  wires: readonly SchematicWire[],
  margin = 40,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (components.length === 0 && wires.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of components) {
    minX = Math.min(minX, c.x - margin);
    minY = Math.min(minY, c.y - margin);
    maxX = Math.max(maxX, c.x + margin);
    maxY = Math.max(maxY, c.y + margin);
  }
  for (const w of wires) {
    for (const p of w.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { minX, minY, maxX, maxY };
}
export const pointsEqual = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
export const pointKey = (point: Point) => `${point.x},${point.y}`;
export const pathFromPoints = (points: Point[]) =>
  points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

const rotateLocalPoint = (point: Point, rotation: number): Point => {
  switch (rotation) {
    case 90:
      return { x: -point.y, y: point.x };
    case 180:
      return { x: -point.x, y: -point.y };
    case 270:
      return { x: point.y, y: -point.x };
    default:
      return point;
  }
};

/** SVG transform for a symbol's orientation: mirror (across the vertical axis)
 *  applied before rotation, matching {@link transformPoint}. */
export const symbolTransform = (rotation: number, mirrored: boolean): string =>
  mirrored ? `rotate(${rotation}) scale(-1 1)` : `rotate(${rotation})`;

const explicitUnit = (value: string, unit: string) => {
  if (!unit) return value.trim();
  const v = value.trim();
  if (!v) return "";
  if (unit === "Ω" && /(Ω|ohm|ohms)$/i.test(v)) return v;
  if (unit !== "Ω" && new RegExp(`${unit}$`, "i").test(v)) return v;
  // Thin space keeps the unit adjacent without colliding with trailing digits.
  return `${v}\u2009${unit}`;
};

/**
 * Canvas value label per component kind. Most kinds are a single quantity, so
 * the catalog's `unit` is simply suffixed onto the value (`explicitUnit`
 * below). A handful of kinds store several fields in one value string
 * (AC sources' "amplitude freq", a comparator's "vhigh vlow vhyst", a pulse
 * source's "low high freq duty") — for those, suffixing one unit onto the
 * whole joined string is meaningless (or actively garbled, e.g. a
 * comparator's "1 0" + a literal "Vhi Vlo" unit hint). Each gets its own
 * formatter built from the same structured fields the inspector uses
 * (`decodeParams`), instead of the catalog abusing `unit` as a display hint.
 */
export const sourceValueLabel = (kind: ComponentKind, value: string): string => {
  if (kind === "vac" || kind === "iac") {
    const params = decodeParams(kind, value);
    const ampUnit = kind === "vac" ? "V" : "A";
    return `${explicitUnit(params.amplitude ?? "1", ampUnit)} @ ${explicitUnit(params.frequency ?? "1k", "Hz")}`;
  }
  if (kind === "vpulse") {
    const params = decodeParams(kind, value);
    const low = explicitUnit(params.low ?? "0", "V");
    const high = explicitUnit(params.high ?? "5", "V");
    return `${low}→${high} @ ${explicitUnit(params.frequency ?? "100k", "Hz")}`;
  }
  if (kind === "comparator") {
    const params = decodeParams(kind, value);
    const base = `${explicitUnit(params.vhigh ?? "1", "V")}/${explicitUnit(params.vlow ?? "0", "V")}`;
    const hyst = Number(params.vhyst ?? "0");
    return hyst ? `${base} ±${explicitUnit(String(hyst), "V")}` : base;
  }
  if (kind === "nmos" || kind === "pmos") {
    const params = decodeParams(kind, value);
    const model = params.model || (kind === "nmos" ? "NMOS" : "PMOS");
    const w = params.w?.trim();
    const l = params.l?.trim();
    if (w || l) return `${model} W=${w || "?"} L=${l || "?"}`;
    return model;
  }
  return explicitUnit(value, CATALOG_BY_KIND[kind].unit);
};

const componentBounds = (component: SchematicComponent) => {
  const box = SYMBOL_BOX[component.kind];
  const bodyCorners: Point[] = [
    { x: -box.halfW, y: -box.halfH },
    { x: box.halfW, y: -box.halfH },
    { x: box.halfW, y: box.halfH },
    { x: -box.halfW, y: box.halfH },
  ];
  const pins = getLocalPins(component.kind).map((pin) => ({ x: pin.x, y: pin.y }));
  const points = [...bodyCorners, ...pins].map((point) => rotateLocalPoint(point, component.rotation));
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
};

const labelAxis = (component: SchematicComponent) => {
  const pins = getLocalPins(component.kind).map((pin) => rotateLocalPoint({ x: pin.x, y: pin.y }, component.rotation));
  if (pins.length !== 2) return "center";
  const dx = Math.abs(pins[0].x - pins[1].x);
  const dy = Math.abs(pins[0].y - pins[1].y);
  return dy > dx ? "vertical" : "horizontal";
};

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface WireSegment {
  a: Point;
  b: Point;
}

export const wireSegments = (wires: SchematicWire[]): WireSegment[] => {
  const segments: WireSegment[] = [];
  for (const wire of wires) {
    for (let index = 1; index < wire.points.length; index += 1) {
      const a = wire.points[index - 1];
      const b = wire.points[index];
      if (!pointsEqual(a, b)) segments.push({ a, b });
    }
  }
  return segments;
};

export const pointOnWireSegment = (point: Point, segment: WireSegment): boolean => {
  if (segment.a.x === segment.b.x) {
    return point.x === segment.a.x
      && point.y >= Math.min(segment.a.y, segment.b.y)
      && point.y <= Math.max(segment.a.y, segment.b.y);
  }
  if (segment.a.y === segment.b.y) {
    return point.y === segment.a.y
      && point.x >= Math.min(segment.a.x, segment.b.x)
      && point.x <= Math.max(segment.a.x, segment.b.x);
  }
  return false;
};

export const segmentIntersections = (first: WireSegment, second: WireSegment): Point[] => {
  const firstVertical = first.a.x === first.b.x;
  const secondVertical = second.a.x === second.b.x;

  if (firstVertical !== secondVertical) {
    const vertical = firstVertical ? first : second;
    const horizontal = firstVertical ? second : first;
    const point = { x: vertical.a.x, y: horizontal.a.y };
    return pointOnWireSegment(point, vertical) && pointOnWireSegment(point, horizontal) ? [point] : [];
  }

  const axis = firstVertical ? "y" : "x";
  if ((firstVertical && first.a.x !== second.a.x) || (!firstVertical && first.a.y !== second.a.y)) return [];
  return [first.a, first.b, second.a, second.b].filter((point, index, points) => {
    const value = axis === "x" ? point.x : point.y;
    const firstStart = axis === "x" ? first.a.x : first.a.y;
    const firstEnd = axis === "x" ? first.b.x : first.b.y;
    const secondStart = axis === "x" ? second.a.x : second.a.y;
    const secondEnd = axis === "x" ? second.b.x : second.b.y;
    return value >= Math.min(firstStart, firstEnd)
      && value <= Math.max(firstStart, firstEnd)
      && value >= Math.min(secondStart, secondEnd)
      && value <= Math.max(secondStart, secondEnd)
      && points.findIndex((candidate) => pointsEqual(candidate, point)) === index;
  });
};

export const isWireEndpoint = (point: Point, segment: WireSegment) =>
  pointsEqual(point, segment.a) || pointsEqual(point, segment.b);

interface LabelPlacement {
  ref: { x: number; y: number; anchor: "start" | "middle" | "end" };
  val: { x: number; y: number; anchor: "start" | "middle" | "end" };
  box: Rect;
}

const padRect = (rect: Rect, pad: number): Rect => ({
  minX: rect.minX - pad,
  minY: rect.minY - pad,
  maxX: rect.maxX + pad,
  maxY: rect.maxY + pad,
});

const overlapArea = (a: Rect, b: Rect) => {
  const x = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const y = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  return x * y;
};

const estimateTextWidth = (text: string, kind: "ref" | "val") => text.length * (kind === "ref" ? 5.5 : 4.9);

const labelLineRect = (text: string, x: number, y: number, anchor: "start" | "middle" | "end", kind: "ref" | "val") => {
  const w = Math.max(8, estimateTextWidth(text, kind));
  const h = kind === "ref" ? 10 : 9;
  const minX = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
  return padRect({ minX, minY: y - h / 2, maxX: minX + w, maxY: y + h / 2 }, 2);
};

const unionRect = (a: Rect, b: Rect): Rect => ({
  minX: Math.min(a.minX, b.minX),
  minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX),
  maxY: Math.max(a.maxY, b.maxY),
});

const makePlacement = (
  refText: string,
  valText: string,
  ref: LabelPlacement["ref"],
  val: LabelPlacement["val"],
): LabelPlacement => {
  const refBox = labelLineRect(refText, ref.x, ref.y, ref.anchor, "ref");
  const valBox = valText ? labelLineRect(valText, val.x, val.y, val.anchor, "val") : refBox;
  return { ref, val, box: unionRect(refBox, valBox) };
};

export const componentWorldRect = (component: SchematicComponent): Rect => {
  const bounds = componentBounds(component);
  return padRect(
    {
      minX: component.x + bounds.minX,
      minY: component.y + bounds.minY,
      maxX: component.x + bounds.maxX,
      maxY: component.y + bounds.maxY,
    },
    5,
  );
};

const labelCandidates = (component: SchematicComponent, refText: string, valText: string) => {
  const b = componentBounds(component);
  const x = component.x;
  const y = component.y;
  const leftX = x + b.minX - 10;
  const rightX = x + b.maxX + 10;
  const topRefY = y + b.minY - 20;
  const belowRefY = y + b.maxY + 10;
  const vertical = labelAxis(component) === "vertical";
  const candidates = [
    makePlacement(refText, valText, { x: leftX, y: y - 7, anchor: "end" }, { x: leftX, y: y + 7, anchor: "end" }),
    makePlacement(refText, valText, { x: rightX, y: y - 7, anchor: "start" }, { x: rightX, y: y + 7, anchor: "start" }),
    makePlacement(refText, valText, { x, y: topRefY, anchor: "middle" }, { x, y: topRefY + 12, anchor: "middle" }),
    makePlacement(refText, valText, { x, y: belowRefY, anchor: "middle" }, { x, y: belowRefY + 12, anchor: "middle" }),
    makePlacement(refText, valText, { x: leftX - 8, y: y + b.minY - 6, anchor: "end" }, { x: leftX - 8, y: y + b.minY + 7, anchor: "end" }),
    makePlacement(refText, valText, { x: rightX + 8, y: y + b.maxY - 8, anchor: "start" }, { x: rightX + 8, y: y + b.maxY + 5, anchor: "start" }),
  ];
  return vertical ? candidates : [candidates[2], candidates[3], candidates[1], candidates[0], candidates[5], candidates[4]];
};

/** Thin rects covering each wire segment, so labels don't settle on top of a
 *  wire and read as if the wire itself carried that value. */
const wireSegmentRects = (wires: SchematicWire[]): Rect[] => {
  const rects: Rect[] = [];
  for (const wire of wires) {
    for (let i = 1; i < wire.points.length; i += 1) {
      const a = wire.points[i - 1];
      const b = wire.points[i];
      rects.push(
        padRect(
          {
            minX: Math.min(a.x, b.x),
            minY: Math.min(a.y, b.y),
            maxX: Math.max(a.x, b.x),
            maxY: Math.max(a.y, b.y),
          },
          3,
        ),
      );
    }
  }
  return rects;
};

export const buildLabelPlacements = (components: SchematicComponent[], wires: SchematicWire[] = []) => {
  const componentRects = components.map(componentWorldRect);
  const wireRects = wireSegmentRects(wires);
  const placed: Rect[] = [];
  const placements = new Map<string, LabelPlacement>();

  for (const component of components) {
    const refText = component.label;
    const valText = sourceValueLabel(component.kind, component.value);
    if (!refText && !valText) continue;

    const candidates = labelCandidates(component, refText || valText, valText);
    const scored = candidates.map((candidate) => {
      const obstacles = [...componentRects, ...wireRects, ...placed];
      const score = obstacles.reduce((total, rect) => total + overlapArea(candidate.box, rect), 0);
      return { candidate, score };
    });
    const chosen = scored.find((entry) => entry.score === 0)?.candidate
      ?? scored.sort((a, b) => a.score - b.score)[0].candidate;
    placements.set(component.id, chosen);
    placed.push(padRect(chosen.box, 3));
  }

  return placements;
};

/** A component's drawn body box, rotated to its orientation (still centred on origin). */
const rotatedBodyBox = (kind: ComponentKind, rotation: number): Rect => {
  const b = SYMBOL_BODY[kind];
  const corners = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ].map((p) => rotateLocalPoint(p, rotation));
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    minY: Math.min(...corners.map((c) => c.y)),
    maxX: Math.max(...corners.map((c) => c.x)),
    maxY: Math.max(...corners.map((c) => c.y)),
  };
};

/** World-space AABB of a component body at (x,y) with the given rotation. */
const bodyBoxAt = (kind: ComponentKind, x: number, y: number, rotation: number): Rect => {
  const box = rotatedBodyBox(kind, rotation);
  return { minX: x + box.minX, minY: y + box.minY, maxX: x + box.maxX, maxY: y + box.maxY };
};

const rectsOverlap = (a: Rect, b: Rect) =>
  a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

/** Click slack around a body, in world px, for selecting thin symbols. */
const HIT_PAD = 7;

/** The component under a world point. Prefer one whose actual body contains the
 *  point over one only within the click pad, then the smaller body — so a small
 *  part (e.g. ground) can never steal a click from the part under the cursor,
 *  regardless of render/z-order. */
export const componentAt = (components: SchematicComponent[], wx: number, wy: number): SchematicComponent | null => {
  let best: SchematicComponent | null = null;
  let bestScore = Infinity;
  for (const c of components) {
    const box = bodyBoxAt(c.kind, c.x, c.y, c.rotation);
    if (wx < box.minX - HIT_PAD || wx > box.maxX + HIT_PAD || wy < box.minY - HIT_PAD || wy > box.maxY + HIT_PAD) {
      continue;
    }
    const inside = wx >= box.minX && wx <= box.maxX && wy >= box.minY && wy <= box.maxY;
    const area = (box.maxX - box.minX) * (box.maxY - box.minY);
    const score = (inside ? 0 : 1e7) + area;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
};

/** True if a body at (x,y) would overlap another component's body. Touching is allowed. */
export const collides = (
  components: SchematicComponent[],
  x: number,
  y: number,
  kind: ComponentKind,
  rotation: number,
  excludeId: string | null,
): boolean => {
  const a = bodyBoxAt(kind, x, y, rotation);
  for (const c of components) {
    if (c.id === excludeId) continue;
    if (rectsOverlap(a, bodyBoxAt(c.kind, c.x, c.y, c.rotation))) return true;
  }
  return false;
};

/** Does an axis-aligned wire segment pass through any component body? Used to
 *  pick the wire elbow that doesn't run across a symbol. */
const segmentHitsBody = (a: Point, b: Point, components: SchematicComponent[]): boolean => {
  const seg: Rect = {
    minX: Math.min(a.x, b.x) - 1,
    minY: Math.min(a.y, b.y) - 1,
    maxX: Math.max(a.x, b.x) + 1,
    maxY: Math.max(a.y, b.y) + 1,
  };
  return components.some((c) => {
    const isEndpointComponent = getComponentPins(c).some((pin) => pointsEqual(pin, a) || pointsEqual(pin, b));
    if (isEndpointComponent) return false;
    const box = bodyBoxAt(c.kind, c.x, c.y, c.rotation);
    // Keep a small clearance so wires don't graze symbol strokes.
    const pad = 1;
    return rectsOverlap(seg, {
      minX: box.minX + pad,
      minY: box.minY + pad,
      maxX: box.maxX - pad,
      maxY: box.maxY - pad,
    });
  });
};

const cleanRoute = (points: Point[]) => {
  const out: Point[] = [];
  for (const point of points) {
    if (out.length === 0 || !pointsEqual(out[out.length - 1], point)) out.push(point);
  }
  for (let i = 1; i < out.length - 1; i += 1) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) {
      out.splice(i, 1);
      i -= 1;
    }
  }
  return out;
};

const startsAxisAligned = (a: Point, b: Point) => a.x === b.x || a.y === b.y;

function moveWireStart(points: Point[], target: Point): Point[] {
  const original = points[0];
  const next = points[1];
  if (startsAxisAligned(target, next)) return cleanRoute([target, ...points.slice(1)]);

  // Preserve the original lead direction at the moved pin, then turn once.
  const elbow = original.y === next.y
    ? { x: next.x, y: target.y }
    : { x: target.x, y: next.y };
  return cleanRoute([target, elbow, ...points.slice(1)]);
}

function moveWireEnd(points: Point[], target: Point): Point[] {
  const original = points[points.length - 1];
  const previous = points[points.length - 2];
  if (startsAxisAligned(previous, target)) return cleanRoute([...points.slice(0, -1), target]);

  // Preserve the original lead direction into the moved pin, then turn once.
  const elbow = previous.y === original.y
    ? { x: previous.x, y: target.y }
    : { x: target.x, y: previous.y };
  return cleanRoute([...points.slice(0, -1), elbow, target]);
}

/** Move wire endpoints that were attached to a component's pins at drag start.
 *  Source routes are supplied from that moment, so a long drag does not add a
 *  new elbow for every pointer event. */
export function translateAttachedWireEndpoints(
  sourceWires: SchematicWire[],
  sourcePins: Point[],
  dx: number,
  dy: number,
): SchematicWire[] {
  const targetFor = (point: Point) =>
    sourcePins.some((pin) => pointsEqual(pin, point))
      ? { x: point.x + dx, y: point.y + dy }
      : null;

  return sourceWires.map((wire) => {
    if (wire.points.length < 2) return wire;
    const firstTarget = targetFor(wire.points[0]);
    const lastTarget = targetFor(wire.points[wire.points.length - 1]);
    if (!firstTarget && !lastTarget) return wire;

    if (firstTarget && lastTarget) {
      return { ...wire, points: wire.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) };
    }
    return {
      ...wire,
      points: firstTarget ? moveWireStart(wire.points, firstTarget) : moveWireEnd(wire.points, lastTarget!),
    };
  });
}

const routeLength = (points: Point[]) =>
  points.slice(1).reduce((total, point, index) => {
    const prev = points[index];
    return total + Math.abs(point.x - prev.x) + Math.abs(point.y - prev.y);
  }, 0);

const routeHitCount = (points: Point[], components: SchematicComponent[]) =>
  points.slice(1).reduce((total, point, index) => {
    const prev = points[index];
    return total + (segmentHitsBody(prev, point, components) ? 1 : 0);
  }, 0);

/** Exported for tests — count how many orthogonal segments cross a body. */
export const countRouteBodyHits = routeHitCount;

/** Route an orthogonal wire between two points. Prefers clear channels around
 *  component bodies, then shorter length, then fewer corners. */
export const routeWireSmart = (start: Point, end: Point, components: SchematicComponent[]): Point[] => {
  if (pointsEqual(start, end)) return [start];
  const candidates: Point[][] = [];
  const push = (points: Point[]) => {
    const cleaned = cleanRoute(points);
    if (cleaned.length >= 2) candidates.push(cleaned);
  };

  if (start.x === end.x || start.y === end.y) push([start, end]);
  const horizFirst = { x: end.x, y: start.y };
  const vertFirst = { x: start.x, y: end.y };
  push([start, horizFirst, end]);
  push([start, vertFirst, end]);

  const xChannels = new Set<number>([start.x, end.x]);
  const yChannels = new Set<number>([start.y, end.y]);
  for (const component of components) {
    const box = bodyBoxAt(component.kind, component.x, component.y, component.rotation);
    // One and two grid cells outside the body — gives the router room to skirt
    // symbols without hugging the stroke.
    for (const pad of [GRID, GRID * 2]) {
      xChannels.add(snap(box.minX - pad));
      xChannels.add(snap(box.maxX + pad));
      yChannels.add(snap(box.minY - pad));
      yChannels.add(snap(box.maxY + pad));
    }
  }

  for (const y of yChannels) {
    push([start, { x: start.x, y }, { x: end.x, y }, end]);
    // U-shaped detour when start/end share an axis but a body sits between them.
    push([start, { x: start.x, y }, { x: end.x, y }, { x: end.x, y: end.y }, end]);
  }
  for (const x of xChannels) {
    push([start, { x, y: start.y }, { x, y: end.y }, end]);
    push([start, { x, y: start.y }, { x, y: end.y }, { x: end.x, y: end.y }, end]);
  }

  return candidates
    .map((points) => ({
      points,
      hits: routeHitCount(points, components),
      length: routeLength(points),
      corners: Math.max(0, points.length - 2),
    }))
    .sort(
      (a, b) =>
        a.hits - b.hits ||
        a.length - b.length ||
        a.corners - b.corners ||
        a.points.length - b.points.length,
    )[0]?.points
    ?? [start, end];
};

/**
 * After a component move, rebuild intermediate elbows for wires whose endpoints
 * moved, preserving pin endpoints while avoiding component bodies.
 */
export function rerouteMovedWires(
  wires: SchematicWire[],
  components: SchematicComponent[],
  affectedWireIds?: Set<string>,
): SchematicWire[] {
  return wires.map((wire) => {
    if (affectedWireIds && !affectedWireIds.has(wire.id)) return wire;
    if (wire.points.length < 2) return wire;
    const start = wire.points[0];
    const end = wire.points[wire.points.length - 1];
    return { ...wire, points: routeWireSmart(start, end, components) };
  });
}

/** Wires whose endpoints currently sit on any of the given world pin points. */
export function wiresTouchingPins(wires: SchematicWire[], pinPoints: Point[]): Set<string> {
  const pins = new Set(pinPoints.map((p) => `${p.x},${p.y}`));
  const out = new Set<string>();
  for (const wire of wires) {
    if (wire.points.length < 2) continue;
    const a = wire.points[0];
    const b = wire.points[wire.points.length - 1];
    if (pins.has(`${a.x},${a.y}`) || pins.has(`${b.x},${b.y}`)) out.add(wire.id);
  }
  return out;
}

/** World pin positions for a set of components (after orientation). */
export function worldPinsFor(components: SchematicComponent[]): Point[] {
  const out: Point[] = [];
  for (const c of components) {
    for (const pin of getLocalPins(c.kind)) {
      const local = transformPoint({ x: pin.x, y: pin.y }, c.rotation, c.mirrored ?? false);
      out.push({ x: c.x + local.x, y: c.y + local.y });
    }
  }
  return out;
}

/** Nearest grid spot (spiralling out) where a new body won't overlap an existing one. */
export const findFreeSpot = (
  components: SchematicComponent[],
  x: number,
  y: number,
  kind: ComponentKind,
  rotation: number,
): Point => {
  if (!collides(components, x, y, kind, rotation, null)) return { x, y };
  for (let r = 1; r <= 16; r += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx * GRID;
        const ny = y + dy * GRID;
        if (!collides(components, nx, ny, kind, rotation, null)) return { x: nx, y: ny };
      }
    }
  }
  return { x, y };
};
