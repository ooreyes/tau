import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useSchematic } from "../store/useSchematic";
import { ComponentSymbol, GRID, SYMBOL_BODY, SYMBOL_BOX } from "../schematic/symbols";
import { CATALOG_BY_KIND } from "../schematic/catalog";
import type { ComponentKind, Point, SchematicComponent, SchematicWire } from "../schematic/types";
import { getLocalPins, getComponentPins, transformPoint } from "../schematic/pins";
import { decodeParams } from "../schematic/params";
import type { AnalysisResult } from "../simulation/linearTransient";
import type { OperatingPointResult } from "../simulation/operatingPoint";
import { opAnnotations } from "../simulation/opAnnotations";
import { extractCircuit } from "../schematic/netlist";
import { FlowLayer, FLOW_PLAY_MS } from "./FlowLayer";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface View {
  x: number;
  y: number;
  zoom: number;
}

const snap = (v: number) => Math.round(v / GRID) * GRID;
const clampZoom = (z: number) => Math.min(5, Math.max(0.25, z));

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
const pointsEqual = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const pointKey = (point: Point) => `${point.x},${point.y}`;
const pathFromPoints = (points: Point[]) =>
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
const symbolTransform = (rotation: number, mirrored: boolean): string =>
  mirrored ? `rotate(${rotation}) scale(-1 1)` : `rotate(${rotation})`;

const explicitUnit = (value: string, unit: string) => {
  if (!unit) return value.trim();
  const v = value.trim();
  if (!v) return "";
  if (unit === "Ω" && /(Ω|ohm|ohms)$/i.test(v)) return v;
  if (unit !== "Ω" && new RegExp(`${unit}$`, "i").test(v)) return v;
  return `${v}${unit}`;
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

interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface WireSegment {
  a: Point;
  b: Point;
}

const wireSegments = (wires: SchematicWire[]): WireSegment[] => {
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

const pointOnWireSegment = (point: Point, segment: WireSegment): boolean => {
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

const segmentIntersections = (first: WireSegment, second: WireSegment): Point[] => {
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

const isWireEndpoint = (point: Point, segment: WireSegment) =>
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

const componentWorldRect = (component: SchematicComponent): Rect => {
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

const buildLabelPlacements = (components: SchematicComponent[], wires: SchematicWire[] = []) => {
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
const componentAt = (components: SchematicComponent[], wx: number, wy: number): SchematicComponent | null => {
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
const collides = (
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
const findFreeSpot = (
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

/** Screen-space box used while drawing a rubber-band selection rectangle. */
interface BoxDrag {
  startX: number; // screen coords
  startY: number;
  curX: number;
  curY: number;
}

interface DragState {
  mode: "none" | "pan" | "move" | "group-move" | "box";
  id?: string;
  /** ids being moved together in group-move mode */
  groupIds?: string[];
  lastX: number;
  lastY: number;
  moved: boolean;
  origin?: Point;
  /** For single-component move: the component's pin positions at drag start. */
  sourcePins?: Point[];
  sourceWires?: SchematicWire[];
  /** For group-move: map from component id → pin world positions at drag start. */
  groupSourcePins?: Map<string, Point[]>;
  /** For group-move: per-component world origins at drag start. */
  groupOrigins?: Map<string, Point>;
}

export function Canvas({
  analysis,
  op = null,
  interactive = true,
  fitSignal = 0,
}: {
  analysis: AnalysisResult | null;
  /** Last DC operating point; in simulator mode its node voltages / branch
   *  currents are annotated in place on the schematic (§6). */
  op?: OperatingPointResult | null;
  /** When false (simulator view) the canvas is a read-only reflection: pan/zoom
   *  and selecting-to-inspect only — no placing, wiring, probing, or editing. */
  interactive?: boolean;
  /** Bumped by App on open/new/tab switch so the schematic auto-fits once. */
  fitSignal?: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [wireDraft, setWireDraft] = useState<{ start: Point; cursor: Point } | null>(null);
  const [snapHover, setSnapHover] = useState<{ x: number; y: number; pin: boolean } | null>(null);
  /** Pending net label being typed (label tool): world point + draft text. */
  const [labelDraft, setLabelDraft] = useState<{ x: number; y: number; text: string } | null>(null);
  const labelInputRef = useRef<HTMLInputElement | null>(null);
  const [flowOn, setFlowOn] = useState(true);
  /** Rubber-band box in screen coords, null when not drawing. */
  const [boxDrag, setBoxDrag] = useState<BoxDrag | null>(null);
  /** True while a component (or group) is being dragged — drives snap-dot visibility. */
  const [movingParts, setMovingParts] = useState(false);

  const components = useSchematic((s) => s.components);
  const wires = useSchematic((s) => s.wires);
  // Keep latest geometry in refs so fitView stays stable and does NOT re-fit
  // the camera on every component/wire edit (only on fitSignal / home / resize).
  const componentsRef = useRef(components);
  const wiresRef = useRef(wires);
  componentsRef.current = components;
  wiresRef.current = wires;
  const selectedId = useSchematic((s) => s.selectedId);
  const selectedWireId = useSchematic((s) => s.selectedWireId);
  const selectedWireIds = useSchematic((s) => s.selectedWireIds);
  const selectedIds = useSchematic((s) => s.selectedIds);
  const tool = useSchematic((s) => s.tool);
  const placeRotation = useSchematic((s) => s.placeRotation);
  const placeMirror = useSchematic((s) => s.placeMirror);
  const addComponent = useSchematic((s) => s.addComponent);
  const addWire = useSchematic((s) => s.addWire);
  const select = useSchematic((s) => s.select);
  const selectWire = useSchematic((s) => s.selectWire);
  const selectWires = useSchematic((s) => s.selectWires);
  const selectMultiple = useSchematic((s) => s.selectMultiple);
  const toggleSelect = useSchematic((s) => s.toggleSelect);
  const moveGroup = useSchematic((s) => s.moveGroup);
  const clearSelection = useSchematic((s) => s.clearSelection);
  const beginChange = useSchematic((s) => s.beginChange);
  const setValue = useSchematic((s) => s.setValue);
  const probes = useSchematic((s) => s.probes);
  const addProbe = useSchematic((s) => s.addProbe);
  const netLabels = useSchematic((s) => s.netLabels);
  const upsertNetLabel = useSchematic((s) => s.upsertNetLabel);
  const [editingId, setEditingId] = useState<string | null>(null);

  // In-place OP annotations (simulator mode only): re-extract geometry only
  // when an ok OP result is actually on screen — never during schematic edits.
  const opLabels = useMemo(() => {
    if (interactive || !op?.ok) return [];
    return opAnnotations(op, extractCircuit(components, wires, netLabels));
  }, [interactive, op, components, wires, netLabels]);
  const editDirty = useRef(false);

  // Map of world "x,y" -> component pins there, for attributing wire current flow.
  const pinIndex = useMemo(() => {
    const m = new Map<string, { componentId: string; pinId: string }[]>();
    for (const c of components) {
      for (const p of getComponentPins(c)) {
        const k = `${p.x},${p.y}`;
        const list = m.get(k) ?? [];
        list.push({ componentId: c.id, pinId: p.id });
        m.set(k, list);
      }
    }
    return m;
  }, [components]);

  // World pin endpoints of two-terminal R/C/L parts, so charge also flows through the body.
  const legs = useMemo(() => {
    const out: { id: string; a: Point; b: Point }[] = [];
    for (const c of components) {
      if (c.kind !== "resistor" && c.kind !== "capacitor" && c.kind !== "inductor") continue;
      const pins = getComponentPins(c);
      const a = pins.find((p) => p.id === "a");
      const b = pins.find((p) => p.id === "b");
      if (a && b) out.push({ id: c.id, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } });
    }
    return out;
  }, [components]);

  // Flat list of pin world points, for snapping wires/probes onto terminals.
  const pinPoints = useMemo(
    () =>
      [...pinIndex.keys()].map((k) => {
        const [x, y] = k.split(",").map(Number);
        return { x, y };
      }),
    [pinIndex],
  );

  // Connection dots use the same explicit-junction semantics as net extraction:
  // a wire end/turn or a component pin makes a connection; two wire interiors
  // that merely cross remain an unmarked overpass.
  const junctions = useMemo(() => {
    const segments = wireSegments(wires);
    const candidates = new Map<string, Point>();
    const addCandidate = (point: Point) => candidates.set(pointKey(point), point);

    for (const wire of wires) {
      for (const point of wire.points) addCandidate(point);
    }
    for (const point of pinPoints) addCandidate(point);
    for (let i = 0; i < segments.length; i += 1) {
      for (let j = i + 1; j < segments.length; j += 1) {
        for (const point of segmentIntersections(segments[i], segments[j])) {
          if (isWireEndpoint(point, segments[i]) || isWireEndpoint(point, segments[j])) addCandidate(point);
        }
      }
    }

    const out: Point[] = [];
    for (const [key, point] of candidates) {
      let degree = pinIndex.get(key)?.length ?? 0;
      for (const segment of segments) {
        if (!pointOnWireSegment(point, segment)) continue;
        degree += isWireEndpoint(point, segment) ? 1 : 2;
      }
      if (degree >= 3) out.push(point);
    }
    return out;
  }, [wires, pinIndex, pinPoints]);

  // Interaction kept in a ref so dragging/panning doesn't trigger re-renders.
  const drag = useRef<DragState>({
    mode: "none",
    lastX: 0,
    lastY: 0,
    moved: false,
  });

  const moveComponentWithAttachedWires = useCallback(
    (id: string, x: number, y: number, sourcePins: Point[], sourceWires: SchematicWire[], dx: number, dy: number) => {
      const wiresWithMovedEndpoints = translateAttachedWireEndpoints(sourceWires, sourcePins, dx, dy);
      useSchematic.setState((state) => {
        const components = state.components.map((component) =>
          component.id === id ? { ...component, x, y } : component,
        );
        const moved = components.find((c) => c.id === id);
        const pins = moved ? worldPinsFor([moved]) : [];
        const affected = wiresTouchingPins(wiresWithMovedEndpoints, pins);
        return {
          components,
          wires: rerouteMovedWires(wiresWithMovedEndpoints, components, affected),
        };
      });
    },
    [],
  );

  // Center the world origin on first mount.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setView((v) => ({ ...v, x: r.width / 2, y: r.height / 2 }));
  }, []);

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const el = svgRef.current;
      if (!el || view.zoom === 0) return { x: 0, y: 0 };
      const r = el.getBoundingClientRect();
      return {
        x: (clientX - r.left - view.x) / view.zoom,
        y: (clientY - r.top - view.y) / view.zoom,
      };
    },
    [view],
  );

  // Wheel: ⌘/ctrl (or trackpad pinch) → zoom about cursor; otherwise pan.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const cx = e.clientX - r.left;
        const cy = e.clientY - r.top;
        setView((v) => {
          const zoom = clampZoom(v.zoom * Math.exp(-e.deltaY * 0.01));
          const k = zoom / v.zoom;
          return { zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
        });
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (tool.mode !== "wire") setWireDraft(null);
    if (tool.mode !== "wire" && tool.mode !== "probe" && tool.mode !== "label") setSnapHover(null);
    if (tool.mode !== "label") setLabelDraft(null);
  }, [tool.mode]);

  // Focus the label input on the NEXT frame: it mounts during the opening
  // click's pointerdown, and the browser's default mousedown action would
  // immediately steal focus back (blur → instant close) if we focused at mount.
  const labelDraftPoint = labelDraft ? `${labelDraft.x},${labelDraft.y}` : null;
  useEffect(() => {
    if (!labelDraftPoint) return;
    const id = requestAnimationFrame(() => {
      labelInputRef.current?.focus();
      labelInputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [labelDraftPoint]);

  const placeAtCursor = useCallback(
    (clientX: number, clientY: number) => {
      if (tool.mode !== "place") return;
      const w = screenToWorld(clientX, clientY);
      const spot = findFreeSpot(components, snap(w.x), snap(w.y), tool.kind, placeRotation);
      addComponent(tool.kind, spot.x, spot.y);
    },
    [tool, screenToWorld, addComponent, components, placeRotation],
  );

  // Snap targets: every component pin plus every wire vertex, so wiring/probing
  // latch onto terminals and existing wires instead of being pixel-finicky.
  const snapTargets = useMemo(() => {
    const seen = new Set<string>();
    const pts: Point[] = [];
    const add = (p: Point) => {
      const key = `${p.x},${p.y}`;
      if (seen.has(key)) return;
      seen.add(key);
      pts.push(p);
    };
    for (const p of pinPoints) add(p);
    for (const wire of wires) for (const p of wire.points) add(p);
    return pts;
  }, [pinPoints, wires]);

  const pinKeySet = useMemo(
    () => new Set(pinPoints.map((p) => `${p.x},${p.y}`)),
    [pinPoints],
  );

  const snappedCursor = useCallback(
    (clientX: number, clientY: number): Point => {
      const w = screenToWorld(clientX, clientY);
      let best: Point | null = null;
      let bestD = 22 * 22; // ~1.4 grid cells of forgiveness
      // Prefer pins over wire midpoints so terminals are easy to hit.
      for (const p of pinPoints) {
        const dx = p.x - w.x;
        const dy = p.y - w.y;
        const d = (dx * dx + dy * dy) * 0.82; // ~18% preference for pins
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      for (const p of snapTargets) {
        if (pinKeySet.has(`${p.x},${p.y}`)) continue;
        const dx = p.x - w.x;
        const dy = p.y - w.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      for (const wire of wires) {
        for (let i = 1; i < wire.points.length; i += 1) {
          const a = wire.points[i - 1];
          const b = wire.points[i];
          let candidate: Point | null = null;
          if (a.x === b.x) {
            const minY = Math.min(a.y, b.y);
            const maxY = Math.max(a.y, b.y);
            const y = Math.min(maxY, Math.max(minY, snap(w.y)));
            candidate = { x: a.x, y };
          } else if (a.y === b.y) {
            const minX = Math.min(a.x, b.x);
            const maxX = Math.max(a.x, b.x);
            const x = Math.min(maxX, Math.max(minX, snap(w.x)));
            candidate = { x, y: a.y };
          }
          if (!candidate) continue;
          const dx = candidate.x - w.x;
          const dy = candidate.y - w.y;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = candidate;
          }
        }
      }
      return best ?? { x: snap(w.x), y: snap(w.y) };
    },
    [screenToWorld, snapTargets, pinPoints, pinKeySet, wires],
  );

  const wireAtCursor = useCallback(
    (clientX: number, clientY: number) => {
      if (tool.mode !== "wire") return;
      const end = snappedCursor(clientX, clientY);
      if (wireDraft && !pointsEqual(wireDraft.start, end)) {
        addWire(routeWireSmart(wireDraft.start, end, components));
      }
      setWireDraft({ start: end, cursor: end });
    },
    [tool, snappedCursor, wireDraft, addWire, components],
  );

  /** World-coord bounds of a rubber-band box. */
  const boxWorldRect = useCallback(
    (box: BoxDrag): Rect => {
      const a = screenToWorld(box.startX, box.startY);
      const b = screenToWorld(box.curX, box.curY);
      return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
    },
    [screenToWorld],
  );

  /** Return component ids fully enclosed in the world rect. */
  const componentsInRect = useCallback(
    (rect: Rect): string[] =>
      components
        .filter((c) => {
          const wr = componentWorldRect(c);
          return wr.minX >= rect.minX && wr.maxX <= rect.maxX && wr.minY >= rect.minY && wr.maxY <= rect.maxY;
        })
        .map((c) => c.id),
    [components],
  );

  /** Return wire ids where ALL points are fully inside the world rect. */
  const wiresInRect = useCallback(
    (rect: Rect): string[] =>
      wires
        .filter((w) => w.points.every((p) => p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY))
        .map((w) => w.id),
    [wires],
  );

  // All selection/drag goes through one hit-test on the SVG, so z-order never
  // decides which component a click lands on (components don't intercept).
  const onBackgroundPointerDown = (e: ReactPointerEvent<SVGElement>) => {
    // Middle-mouse button always pans (button === 1).
    if (e.button === 1) {
      drag.current = { mode: "pan", lastX: e.clientX, lastY: e.clientY, moved: false };
      svgRef.current?.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const world = screenToWorld(e.clientX, e.clientY);

    if (!interactive) {
      // Simulator view no longer hosts the schematic canvas (§UX). If this
      // branch is ever hit, only pan — no probing or clamp-meter toggles.
      drag.current = { mode: "pan", lastX: e.clientX, lastY: e.clientY, moved: false };
      svgRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    if (tool.mode === "place") {
      placeAtCursor(e.clientX, e.clientY);
      return;
    }
    if (tool.mode === "wire") {
      wireAtCursor(e.clientX, e.clientY);
      return;
    }
    if (tool.mode === "probe") {
      const w = snappedCursor(e.clientX, e.clientY);
      addProbe(w.x, w.y);
      return;
    }
    if (tool.mode === "label") {
      // A click while an input is open just blurs it (the input's onBlur
      // commits); the next click opens a fresh one.
      if (labelDraft) return;
      const w = snappedCursor(e.clientX, e.clientY);
      const existing = netLabels.find((l) => l.x === w.x && l.y === w.y);
      setLabelDraft({ x: w.x, y: w.y, text: existing?.text ?? "" });
      return;
    }

    const hit = componentAt(components, world.x, world.y);
    if (hit) {
      if (e.shiftKey) {
        // Shift+click: toggle this component in/out of multi-select.
        toggleSelect(hit.id);
        drag.current = { mode: "none", lastX: e.clientX, lastY: e.clientY, moved: false };
        return;
      }
      // If the clicked component is already in the multi-selection, start a
      // group-move of the whole selection. Otherwise, start a single-component move.
      const isInGroup = selectedIds.includes(hit.id) && selectedIds.length > 1;
      if (isInGroup) {
        // Group move: snapshot pin positions for all components in the selection.
        const snapshotComps = components.filter((c) => selectedIds.includes(c.id));
        const groupSourcePins = new Map<string, Point[]>();
        for (const c of snapshotComps) {
          groupSourcePins.set(c.id, getComponentPins(c).map(({ x, y }) => ({ x, y })));
        }
        const groupOrigins = new Map<string, Point>(snapshotComps.map((c) => [c.id, { x: c.x, y: c.y }]));
        const frozenWires = wires.map((w) => ({ ...w, points: w.points.map((p) => ({ ...p })) }));
        drag.current = {
          mode: "group-move",
          id: hit.id,
          groupIds: selectedIds.slice(),
          lastX: e.clientX,
          lastY: e.clientY,
          moved: false,
          origin: { x: hit.x, y: hit.y },
          groupSourcePins,
          groupOrigins,
          sourceWires: frozenWires,
        };
        setMovingParts(true);
      } else {
        select(hit.id);
        drag.current = {
          mode: "move",
          id: hit.id,
          lastX: e.clientX,
          lastY: e.clientY,
          moved: false,
          origin: { x: hit.x, y: hit.y },
          sourcePins: getComponentPins(hit).map(({ x, y }) => ({ x, y })),
          sourceWires: wires.map((wire) => ({ ...wire, points: wire.points.map((point) => ({ ...point })) })),
        };
        setMovingParts(true);
      }
    } else {
      // Empty canvas click: start rubber-band box select (not pan).
      // A plain click (no drag) clears the selection on pointer-up.
      clearSelection();
      drag.current = { mode: "box", lastX: e.clientX, lastY: e.clientY, moved: false };
      setBoxDrag({ startX: e.clientX, startY: e.clientY, curX: e.clientX, curY: e.clientY });
    }
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onCanvasDoubleClick = (e: ReactMouseEvent<SVGElement>) => {
    if (!interactive) return;
    const world = screenToWorld(e.clientX, e.clientY);
    const hit = componentAt(components, world.x, world.y);
    if (hit && hit.kind !== "ground") {
      editDirty.current = false;
      setEditingId(hit.id);
    }
  };

  const onWirePointerDown = (e: ReactPointerEvent<SVGElement>, wire: SchematicWire) => {
    if (e.button !== 0) return;
    if (!interactive) return;
    if (tool.mode === "probe") {
      e.stopPropagation();
      const w = snappedCursor(e.clientX, e.clientY);
      addProbe(w.x, w.y);
      return;
    }
    if (tool.mode !== "select") return; // let place/wire/pan handle via bubbling
    e.stopPropagation();
    selectWire(wire.id);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGElement>) => {
    if (!interactive) {
      const d = drag.current;
      if (d.mode === "pan") {
        setView((v) => ({ ...v, x: v.x + (e.clientX - d.lastX), y: v.y + (e.clientY - d.lastY) }));
        d.lastX = e.clientX;
        d.lastY = e.clientY;
      }
      return;
    }
    if (tool.mode === "place") {
      const w = screenToWorld(e.clientX, e.clientY);
      // Show the ghost where the part will actually land (collision-resolved),
      // so the preview never lies about the drop position.
      setGhost(findFreeSpot(components, snap(w.x), snap(w.y), tool.kind, placeRotation));
    } else if (tool.mode === "wire" || tool.mode === "probe" || tool.mode === "label") {
      const cursor = snappedCursor(e.clientX, e.clientY);
      setSnapHover({ x: cursor.x, y: cursor.y, pin: pinPoints.some((p) => p.x === cursor.x && p.y === cursor.y) });
      if (tool.mode === "wire") setWireDraft((draft) => (draft ? { ...draft, cursor } : draft));
    }
    const d = drag.current;
    if (d.mode === "pan") {
      const dx = e.clientX - d.lastX;
      const dy = e.clientY - d.lastY;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    } else if (d.mode === "box") {
      // Update rubber-band box in screen space.
      setBoxDrag((prev) => prev ? { ...prev, curX: e.clientX, curY: e.clientY } : prev);
    } else if (d.mode === "move" && d.id && d.origin && d.sourcePins && d.sourceWires) {
      const w = screenToWorld(e.clientX, e.clientY);
      const tx = snap(w.x);
      const ty = snap(w.y);
      // Skip if coordinates are degenerate (can happen if svgRef was null during screenToWorld).
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
      const moving = components.find((c) => c.id === d.id);
      // Never let a body slide into another body (pins may still meet).
      if (moving && collides(components, tx, ty, moving.kind, moving.rotation, d.id)) return;
      if (moving?.x === tx && moving.y === ty) return;
      // Capture one undo snapshot for the whole drag, on the first move only.
      if (!d.moved) {
        beginChange();
        d.moved = true;
      }
      moveComponentWithAttachedWires(d.id, tx, ty, d.sourcePins, d.sourceWires, tx - d.origin.x, ty - d.origin.y);
    } else if (d.mode === "group-move" && d.groupIds && d.groupOrigins && d.groupSourcePins && d.sourceWires && d.origin) {
      const w = screenToWorld(e.clientX, e.clientY);
      // The pointer started over the anchor component (d.origin). Compute the
      // snapped-grid offset from that origin to where the pointer is now.
      const anchorOrigin = d.groupOrigins.get(d.id ?? "") ?? d.origin;
      const dx = snap(w.x) - anchorOrigin.x;
      const dy = snap(w.y) - anchorOrigin.y;
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      if (dx === 0 && dy === 0) return;
      if (!d.moved) {
        beginChange();
        d.moved = true;
      }
      moveGroup(d.groupOrigins, dx, dy, d.groupSourcePins, d.sourceWires);
      // Live re-route so group moves don't leave wires cutting through bodies.
      const state = useSchematic.getState();
      const movedComps = state.components.filter((c) => d.groupIds!.includes(c.id));
      const affected = wiresTouchingPins(state.wires, worldPinsFor(movedComps));
      if (affected.size > 0) {
        useSchematic.setState({
          wires: rerouteMovedWires(state.wires, state.components, affected),
        });
      }
    }
  };

  const endDrag = (e: ReactPointerEvent<SVGElement>) => {
    const d = drag.current;
    if (d.mode === "box") {
      // On release, commit the box selection.
      setBoxDrag((prev) => {
        if (prev) {
          const rect = boxWorldRect(prev);
          const inRect = componentsInRect(rect);
          const wiresIn = wiresInRect(rect);
          if (inRect.length > 0) {
            selectMultiple(inRect);
          } else if (wiresIn.length > 0) {
            selectWires(wiresIn);
          } else {
            clearSelection();
          }
        }
        return null;
      });
    } else if ((d.mode === "move" || d.mode === "group-move") && d.moved) {
      // Final re-route pass (live routing already ran during the drag).
      const state = useSchematic.getState();
      const movedIds = d.groupIds ?? (d.id ? [d.id] : []);
      const movedComps = state.components.filter((c) => movedIds.includes(c.id));
      const affected = wiresTouchingPins(state.wires, worldPinsFor(movedComps));
      if (affected.size > 0) {
        useSchematic.setState({
          wires: rerouteMovedWires(state.wires, state.components, affected),
        });
      }
    }
    setMovingParts(false);
    drag.current.mode = "none";
    drag.current.id = undefined;
    drag.current.groupIds = undefined;
    drag.current.moved = false;
    drag.current.origin = undefined;
    drag.current.sourcePins = undefined;
    drag.current.sourceWires = undefined;
    drag.current.groupSourcePins = undefined;
    drag.current.groupOrigins = undefined;
    const el = svgRef.current;
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };

  const zoomBy = (factor: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const cx = r.width / 2;
    const cy = r.height / 2;
    setView((v) => {
      const zoom = clampZoom(v.zoom * factor);
      const k = zoom / v.zoom;
      return { zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  };

  // Frame the whole circuit in the viewport (home / zoom-to-fit).
  const fitView = useCallback(() => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const b = circuitBounds(componentsRef.current, wiresRef.current);
    if (!b) {
      setView({ x: r.width / 2, y: r.height / 2, zoom: 1 });
      return;
    }
    const pad = 80;
    const zoom = clampZoom(
      Math.min((r.width - pad * 2) / Math.max(b.maxX - b.minX, 1), (r.height - pad * 2) / Math.max(b.maxY - b.minY, 1)),
    );
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    setView({ zoom, x: r.width / 2 - cx * zoom, y: r.height / 2 - cy * zoom });
  }, []);

  // Auto-fit when the document identity changes (open / new / tab switch).
  // Deliberately does NOT depend on components/wires — user pan is preserved
  // across edits; ⌂ and fitSignal are the only re-fit triggers in schematic mode.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => fitView());
    return () => cancelAnimationFrame(id);
  }, [fitSignal, fitView]);

  // Read-only simulator reflection also re-fits when its column resizes.
  useEffect(() => {
    if (interactive) return;
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fitView());
    ro.observe(el);
    return () => ro.disconnect();
  }, [interactive, fitView]);

  const placing = tool.mode === "place";
  const wiring = tool.mode === "wire";
  const probing = tool.mode === "probe";
  const labeling = tool.mode === "label";
  const previewWire = wireDraft && !pointsEqual(wireDraft.start, wireDraft.cursor)
    ? routeWireSmart(wireDraft.start, wireDraft.cursor, components)
    : null;
  const flowActive = analysis?.ok === true;
  const flowEndTime = analysis?.ok ? analysis.times[analysis.times.length - 1] ?? 0 : 0;
  const flowSlowdown = flowEndTime > 0 ? FLOW_PLAY_MS / 1000 / flowEndTime : 0;

  const editingComp = editingId ? components.find((c) => c.id === editingId) ?? null : null;
  const editBox = editingComp ? SYMBOL_BOX[editingComp.kind] : null;
  const editVert =
    editingComp && editBox
      ? editingComp.rotation === 90 || editingComp.rotation === 270
        ? editBox.halfW
        : editBox.halfH
      : 0;
  const editLeft = editingComp ? editingComp.x * view.zoom + view.x : 0;
  const editTop = editingComp ? (editingComp.y + editVert + 15) * view.zoom + view.y : 0;

  return (
    <>
      <svg
        ref={svgRef}
        className="canvas"
        style={{ cursor: interactive && (placing || wiring || probing || labeling) ? "crosshair" : "default" }}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onDoubleClick={onCanvasDoubleClick}
        onPointerLeave={() => {
          if (placing) setGhost(null);
          setSnapHover(null);
        }}
      >
        <defs>
          {/*
            Circles must be centered in each tile — SVG patterns clip at the
            tile edge, so a dot at (0,0) renders as a quarter-circle (the bug
            visible on the schematic stage).
          */}
          <pattern id="grid-minor" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
            <circle cx={GRID / 2} cy={GRID / 2} r={1.35} className="grid-dot" />
          </pattern>
          <pattern id="grid" width={GRID * 5} height={GRID * 5} patternUnits="userSpaceOnUse">
            <rect width={GRID * 5} height={GRID * 5} fill="url(#grid-minor)" />
            <circle cx={GRID / 2} cy={GRID / 2} r={2.1} className="grid-dot-major" />
          </pattern>
        </defs>

        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          <rect x={-100000} y={-100000} width={200000} height={200000} fill="url(#grid)" />

          {wires.map((wire) => (
            <WireView
              key={wire.id}
              wire={wire}
              selected={wire.id === selectedWireId || selectedWireIds.includes(wire.id)}
              probeReady={!interactive}
              onPointerDown={(e) => onWirePointerDown(e, wire)}
            />
          ))}

          {previewWire && <WirePolyline points={previewWire} className="wire preview" />}

          {/* Soft snap markers while wiring / placing / moving / probing / labeling */}
          {interactive && (wiring || probing || labeling || placing || movingParts) &&
            snapTargets.map((p) => {
              const isPin = pinKeySet.has(`${p.x},${p.y}`);
              return (
                <circle
                  key={`snap-${p.x}-${p.y}`}
                  className={`snap-dot${isPin ? " pin" : ""}`}
                  cx={p.x}
                  cy={p.y}
                  r={isPin ? 3.2 : 2.2}
                />
              );
            })}

          {(wiring || probing || labeling) && snapHover && (
            <circle
              className={`snap-ring${snapHover.pin ? " on-pin" : ""}`}
              cx={snapHover.x}
              cy={snapHover.y}
              r={snapHover.pin ? 8 : 6.5}
            />
          )}

          {junctions.map((j) => (
            <circle key={`j-${j.x}-${j.y}`} className="junction-dot" cx={j.x} cy={j.y} r={2.6} />
          ))}

          {components.map((c) => (
            <ComponentView
              key={c.id}
              comp={c}
              selected={c.id === selectedId || selectedIds.includes(c.id)}
              showPins={wiring || probing || labeling || placing}
            />
          ))}

          {probes.map((p) => {
            // A clamp-meter probe follows its component; skip it if the part is gone.
            const host = p.componentId ? components.find((c) => c.id === p.componentId) : null;
            if (p.componentId && !host) return null;
            const px = host ? host.x : p.x;
            const py = host ? host.y : p.y;
            return (
              <g key={p.id} className={`probe-marker${p.componentId ? " current" : ""}`} style={{ color: p.color }}>
                <circle className="probe-ring" cx={px} cy={py} r={7} />
                <circle className="probe-dot" cx={px} cy={py} r={3.5} />
              </g>
            );
          })}

          {netLabels.map((l) => (
            <text key={l.id} className="net-label-text" x={l.x + 6} y={l.y - 6}>
              {l.text}
            </text>
          ))}

          {opLabels.map((a) =>
            a.kind === "voltage" ? (
              <text key={a.key} className="op-annotation voltage" x={a.x + 5} y={a.y - 8}>
                {a.text}
              </text>
            ) : (
              // Centered under the component body — clear of the ref/value
              // labels, which sit beside the body.
              <text key={a.key} className="op-annotation current" x={a.x} y={a.y + 30} textAnchor="middle">
                {a.text}
              </text>
            ),
          )}

          {flowActive && flowOn && analysis?.ok && (
            <FlowLayer wires={wires} legs={legs} pinIndex={pinIndex} result={analysis} playing={flowOn} />
          )}

          <ComponentLabels components={components} wires={wires} />

          {placing && ghost && (
            <g className="ghost" transform={`translate(${ghost.x} ${ghost.y})`}>
              <g className="symbol" transform={symbolTransform(placeRotation, placeMirror)}>
                <ComponentSymbol kind={tool.kind} />
              </g>
            </g>
          )}
        </g>

        {/* Rubber-band selection rectangle — in screen space (no world transform). */}
        {boxDrag && (() => {
          const el = svgRef.current;
          const r = el?.getBoundingClientRect();
          const ox = r ? r.left : 0;
          const oy = r ? r.top : 0;
          const x = Math.min(boxDrag.startX, boxDrag.curX) - ox;
          const y = Math.min(boxDrag.startY, boxDrag.curY) - oy;
          const w = Math.abs(boxDrag.curX - boxDrag.startX);
          const h = Math.abs(boxDrag.curY - boxDrag.startY);
          return <rect className="select-box" x={x} y={y} width={w} height={h} />;
        })()}
      </svg>

      {flowActive && (
        <div className="flow-controls">
          <button
            className={`flow-toggle${flowOn ? " on" : ""}`}
            onClick={() => setFlowOn((v) => !v)}
            aria-pressed={flowOn}
            title="Animate conventional current along wires and through components"
          >
            <i className="flow-lamp" aria-hidden="true" />
            <span className="flow-bolt" aria-hidden="true">⚡</span>
            {flowOn ? "Current flow" : "Flow paused"}
          </button>
          {flowOn && flowSlowdown > 0 && (
            <span className="flow-rate mono-num">slowed ≈{Math.round(flowSlowdown).toLocaleString()}× vs real time</span>
          )}
        </div>
      )}

      <div className="view-controls">
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="view-btn" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
              +
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Zoom in</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="view-btn" onClick={() => zoomBy(0.8)} aria-label="Zoom out">
              −
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Zoom out</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="view-btn" onClick={fitView} aria-label="Fit circuit to view">
              ⌂
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Fit to view</TooltipContent>
        </Tooltip>
      </div>

      {labelDraft && (
        <input
          ref={labelInputRef}
          className="value-edit-input net-label-input"
          value={labelDraft.text}
          spellCheck={false}
          placeholder="net name"
          aria-label="Net label name"
          style={{
            left: labelDraft.x * view.zoom + view.x,
            top: (labelDraft.y + 10) * view.zoom + view.y,
          }}
          onChange={(e) => setLabelDraft({ ...labelDraft, text: e.currentTarget.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              upsertNetLabel(labelDraft.x, labelDraft.y, labelDraft.text);
              setLabelDraft(null);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setLabelDraft(null);
            }
          }}
          onBlur={() => {
            // Click-away confirms, like Enter (empty text removes the label).
            upsertNetLabel(labelDraft.x, labelDraft.y, labelDraft.text);
            setLabelDraft(null);
          }}
        />
      )}

      {editingComp && (
        <input
          className="value-edit-input"
          autoFocus
          value={editingComp.value}
          spellCheck={false}
          style={{ left: editLeft, top: editTop }}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            if (!editDirty.current) {
              beginChange();
              editDirty.current = true;
            }
            setValue(editingComp.id, e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") {
              e.preventDefault();
              setEditingId(null);
            }
          }}
          onBlur={() => setEditingId(null)}
        />
      )}
    </>
  );
}

function ComponentView({
  comp,
  selected,
  showPins,
}: {
  comp: SchematicComponent;
  selected: boolean;
  showPins: boolean;
}) {
  // Presentational only — selection/drag/edit are resolved centrally by
  // geometry in the SVG handlers, so render order never decides hit results.
  // Mirror-before-rotate (matches transformPoint / LTspice M*): SVG applies
  // transforms right-to-left, so `rotate(R) scale(-1 1)` flips then rotates.
  const orient = symbolTransform(comp.rotation, comp.mirrored ?? false);
  return (
    <g className={`component${selected ? " selected" : ""}`} transform={`translate(${comp.x} ${comp.y})`}>
      <g className="symbol" transform={orient}>
        <ComponentSymbol kind={comp.kind} />
      </g>
      {showPins && (
        <g className="pin-layer" transform={orient}>
          {getLocalPins(comp.kind).map((pin) => (
            <circle key={pin.id} className="pin-target" cx={pin.x} cy={pin.y} r={4.5} />
          ))}
        </g>
      )}
    </g>
  );
}

/** All component ref/value labels, drawn in a top layer so nothing can obscure them. */
function ComponentLabels({ components, wires }: { components: SchematicComponent[]; wires: SchematicWire[] }) {
  const placements = useMemo(() => buildLabelPlacements(components, wires), [components, wires]);

  return (
    <g className="label-layer" aria-hidden="true">
      {components.map((c) => {
        const value = sourceValueLabel(c.kind, c.value);
        const placement = placements.get(c.id);
        if (!placement) return null;
        return (
          <g key={c.id}>
            {c.label && (
              <text className="ref" x={placement.ref.x} y={placement.ref.y} textAnchor={placement.ref.anchor}>
                {c.label}
              </text>
            )}
            {value && (
              <text className="val" x={placement.val.x} y={placement.val.y} textAnchor={placement.val.anchor}>
                {value}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function WireView({
  wire,
  selected,
  probeReady,
  onPointerDown,
}: {
  wire: SchematicWire;
  selected: boolean;
  /** Simulator mode: clicking probes the net, so advertise it with the probe cursor. */
  probeReady: boolean;
  onPointerDown: (e: ReactPointerEvent<SVGElement>) => void;
}) {
  const d = pathFromPoints(wire.points);
  return (
    <g
      className={`wire-group${selected ? " selected" : ""}${probeReady ? " probe-ready" : ""}`}
      onPointerDown={onPointerDown}
    >
      {/* Wide invisible stroke makes the thin wire easy to click. */}
      <path className="wire-hit" d={d} />
      <path className="wire" d={d} />
    </g>
  );
}

function WirePolyline({ points, className }: { points: Point[]; className: string }) {
  return <path className={className} d={pathFromPoints(points)} />;
}
