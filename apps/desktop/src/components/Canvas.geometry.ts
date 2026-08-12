import { GRID, SYMBOL_BODY } from "../schematic/symbols";
import { CATALOG_BY_KIND } from "../schematic/catalog";
import type { ComponentKind, NetLabel, Point, Rotation, SchematicAscShape, SchematicComponent, SchematicWire } from "../schematic/types";
import { getComponentPins, getLocalPins, transformPoint } from "../schematic/pins";
import { decodeParams } from "../schematic/params";
import { decodeIndependentSourceValue } from "../schematic/sourceValue";
import { DEFAULT_WIPER, parsePotentiometerSpec } from "../engine/potentiometerSpec";
import { withoutGateInputCount } from "../engine/digitalGateSpec";
import { isNativeMultiPinSubcircuit, nativeSubcircuitBody } from "../schematic/subcircuitGeometry";
import { overlapArea, padRect, placeOverlay } from "./overlayPlacement";
import type { Rect } from "./overlayPlacement";

// Re-exported so existing importers of `Rect` from this module (e.g.
// Canvas.tsx) don't need to change - the type now lives in
// overlayPlacement.ts alongside the placement kernel that scores it.
export type { Rect };

export const snap = (v: number) => {
  const snapped = Math.round(v / GRID) * GRID;
  return Object.is(snapped, -0) ? 0 : snapped;
};

/** Local-space AABB of everything that establishes a component's visible
 * footprint: transformed symbol body plus its real pins. `getComponentPins`
 * is intentional here - imported LTspice parts can carry absolute pin
 * overrides that are much farther from the component origin than Tau's
 * built-in bank. */
export interface ComponentVisualPlacement {
  x: number;
  y: number;
  rotation: Rotation;
  mirrored: boolean;
}

/**
 * Imported LTspice symbols store the file's symbol anchor in `component.x/y`
 * and the electrically exact terminal positions in `pinOverride`. The anchor
 * is generally not the symbol centre (an R0 resistor's anchor is above-left of
 * its vertical body), while Tau symbols are centre-origin. Drawing at the raw
 * anchor therefore creates long diagonal repair leads even though the circuit
 * topology is correct.
 *
 * Fit Tau's native pin bank onto the imported terminals using the eight legal
 * orthogonal orientations plus a least-squares translation. The imported pins
 * remain untouched and authoritative for netlisting/export; this is strictly a
 * presentation transform. Native Tau components take the fast identity path.
 */
export function componentVisualPlacement(component: SchematicComponent): ComponentVisualPlacement {
  const fallback: ComponentVisualPlacement = {
    x: component.x,
    y: component.y,
    rotation: component.rotation,
    mirrored: component.mirrored ?? false,
  };
  if (!component.pinOverride?.length) return fallback;
  // Tau-authored X devices already store their terminal bank around the true
  // centre. Fitting the generic two-pin symbol onto p1/p2 would incorrectly
  // translate/rotate a five-terminal block.
  if (isNativeMultiPinSubcircuit(component)) return fallback;

  const nativeById = new Map(getLocalPins(component.kind).map((pin) => [pin.id, pin]));
  const matches = component.pinOverride.flatMap((pin) => {
    const native = nativeById.get(pin.id);
    return native ? [{ native, target: pin }] : [];
  });
  if (matches.length < 2) return fallback;

  const candidates: Array<{ rotation: Rotation; mirrored: boolean }> = [];
  const addCandidate = (rotation: Rotation, mirrored: boolean) => {
    if (!candidates.some((candidate) => candidate.rotation === rotation && candidate.mirrored === mirrored)) {
      candidates.push({ rotation, mirrored });
    }
  };
  // Prefer the authored orientation when fits tie (common for symmetric parts).
  addCandidate(component.rotation, component.mirrored ?? false);
  for (const mirrored of [false, true]) {
    for (const rotation of [0, 90, 180, 270] as const) addCandidate(rotation, mirrored);
  }

  let best = { ...fallback, score: Number.POSITIVE_INFINITY };
  for (const candidate of candidates) {
    const transformed = matches.map(({ native, target }) => ({
      local: transformPoint(native, candidate.rotation, candidate.mirrored),
      target,
    }));
    const x = transformed.reduce((sum, pair) => sum + pair.target.x - pair.local.x, 0) / transformed.length;
    const y = transformed.reduce((sum, pair) => sum + pair.target.y - pair.local.y, 0) / transformed.length;
    const score = transformed.reduce((sum, pair) => {
      const dx = x + pair.local.x - pair.target.x;
      const dy = y + pair.local.y - pair.target.y;
      return sum + dx * dx + dy * dy;
    }, 0);
    if (score < best.score) best = { x, y, ...candidate, score };
  }
  return { x: best.x, y: best.y, rotation: best.rotation, mirrored: best.mirrored };
}

function componentGeometryBounds(component: SchematicComponent): Rect {
  const placement = componentVisualPlacement(component);
  const box = isNativeMultiPinSubcircuit(component)
    ? nativeSubcircuitBody(component)
    : SYMBOL_BODY[component.kind];
  const bodyCorners: Point[] = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ].map((point) => {
    const transformed = transformPoint(point, placement.rotation, placement.mirrored);
    return {
      x: placement.x - component.x + transformed.x,
      y: placement.y - component.y + transformed.y,
    };
  });
  const pins = getComponentPins(component).map((pin) => ({
    x: pin.x - component.x,
    y: pin.y - component.y,
  }));
  const points = [...bodyCorners, ...pins];
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

/** World-space bounding box of a circuit, with a small margin around each
 * transformed symbol/pin footprint so parts are never flush against the
 * frame. Preserved `.asc` artwork counts toward it, so a sheet framed by a
 * border - or one that is nothing but a drawing - is not fitted to a region
 * that leaves it off-screen. Returns null for an empty schematic. Pure so
 * fit-to-view stays independently testable without a DOM. */
export function circuitBounds(
  components: readonly SchematicComponent[],
  wires: readonly SchematicWire[],
  margin = 16,
  shapes: readonly SchematicAscShape[] = [],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const cover = (box: Rect) => {
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
  };
  for (const c of components) {
    const bounds = componentGeometryBounds(c);
    cover({
      minX: c.x + bounds.minX - margin,
      minY: c.y + bounds.minY - margin,
      maxX: c.x + bounds.maxX + margin,
      maxY: c.y + bounds.maxY + margin,
    });
  }
  for (const w of wires) {
    for (const p of w.points) cover({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y });
  }
  // Artwork takes no symbol margin: a drawing's own extent is exactly what
  // reaches the sheet, and fit-to-view's viewport padding is what keeps it off
  // the frame.
  for (const shape of shapes) {
    const box = ascShapeBounds(shape);
    if (box) cover(box);
  }
  // A wire carrying no points, or a record with no visible extent, contributes
  // nothing - so emptiness is what was covered, not how long the lists were.
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}
export const pointsEqual = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
export const pointKey = (point: Point) => `${point.x},${point.y}`;
export const pathFromPoints = (points: Point[]) =>
  points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

export const HOP_RADIUS = 4;

/**
 * SVG path for a wire polyline where horizontal segments arc over the given
 * x positions - the classic "hop" that marks an UNCONNECTED crossing (a
 * connected join gets a junction dot instead). The bump always points up
 * (−y): sweep=1 while traveling +x, sweep=0 while traveling −x. Hops within
 * HOP_RADIUS of a segment end are dropped so elbows keep their corners.
 * Keyed by segment index (segment i = points[i] → points[i+1]).
 */
export const pathWithHops = (
  points: Point[],
  hopsBySegment: ReadonlyMap<number, readonly number[]>,
): string => {
  if (points.length === 0) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const hops = hopsBySegment.get(i - 1);
    if (!hops || hops.length === 0 || a.y !== b.y || a.x === b.x) {
      d += ` L ${b.x} ${b.y}`;
      continue;
    }
    const dir = Math.sign(b.x - a.x);
    const usable = [...hops]
      .filter((x) => Math.abs(x - a.x) > HOP_RADIUS && Math.abs(b.x - x) > HOP_RADIUS)
      .sort((p, q) => (p - q) * dir);
    const sweep = dir > 0 ? 1 : 0;
    for (const x of usable) {
      d += ` L ${x - dir * HOP_RADIUS} ${a.y}`;
      d += ` A ${HOP_RADIUS} ${HOP_RADIUS} 0 0 ${sweep} ${x + dir * HOP_RADIUS} ${a.y}`;
    }
    d += ` L ${b.x} ${b.y}`;
  }
  return d;
};

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

/**
 * Scale an imported LTspice independent source so Tau's native pin bank
 * lands on the file's pinOverride terminals. Without this, DC voltage.asy
 * (80-unit pin span) draws the same circle as a native vac (64-unit span)
 * but with longer repair leads — reading as a different size beside AC.
 */
export function sourceSymbolFitScale(component: SchematicComponent): number {
  const pins = component.pinOverride;
  if (!pins || pins.length < 2) return 1;
  const native = getLocalPins(component.kind);
  if (native.length < 2) return 1;
  const nativeSpan = Math.hypot(native[0].x - native[1].x, native[0].y - native[1].y);
  const overrideSpan = Math.hypot(pins[0].x - pins[1].x, pins[0].y - pins[1].y);
  if (!(nativeSpan > 0) || !(overrideSpan > 0)) return 1;
  const scale = overrideSpan / nativeSpan;
  if (scale < 0.5 || scale > 2.5) return 1;
  return scale;
}

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
 * source's "low high freq duty") - for those, suffixing one unit onto the
 * whole joined string is meaningless (or actively garbled, e.g. a
 * comparator's "1 0" + a literal "Vhi Vlo" unit hint). Each gets its own
 * formatter built from the same structured fields the inspector uses
 * (`decodeParams`), instead of the catalog abusing `unit` as a display hint.
 */
export const sourceValueLabel = (kind: ComponentKind, value: string): string => {
  if (kind === "logicConstant") {
    const raw = value.trim().toLowerCase();
    if (raw === "0" || raw === "1" || raw === "low" || raw === "high") {
      return raw === "0" || raw === "low" ? "0" : "1";
    }
    return value.trim() || "1";
  }
  if (kind === "vsource" || kind === "isource") {
    const unit = kind === "vsource" ? "V" : "A";
    const source = decodeIndependentSourceValue(value, unit);
    switch (source.mode) {
      case "dc":
        return explicitUnit(source.dcBias, unit);
      case "sine":
        return `Sine · ${explicitUnit(source.parameters.amplitude || "1", unit)} @ ${explicitUnit(source.parameters.frequency || "1k", "Hz")}`;
      case "pulse":
        return `Pulse · ${explicitUnit(source.parameters.low || "0", unit)}→${explicitUnit(source.parameters.high || "5", unit)}`;
      case "pwl":
        return `Piecewise · ${source.pwlPoints.length} ${source.pwlPoints.length === 1 ? "point" : "points"}`;
      case "exp":
        return `Exponential · ${explicitUnit(source.parameters.initial || "0", unit)}→${explicitUnit(source.parameters.pulsed || "1", unit)}`;
      case "sffm":
        return `FM · ${explicitUnit(source.parameters.carrierFrequency || "1k", "Hz")} carrier`;
    }
  }
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
  if (kind === "digitalGate") {
    // The drawing already states the input count by drawing that many leads, so
    // repeating it as raw `Inputs=5` syntax beside the symbol is noise - and
    // every imported LTspice gate now carries the token (see `ascImport`).
    return withoutGateInputCount(value);
  }
  if (kind === "potentiometer") {
    // The tap is now a canvas control (mission item 6), so it reaches this
    // label constantly. Suffixing the catalog unit onto the raw string spelled
    // it "10k Wiper=0.8 Ω" — the track resistance and the tap are two
    // quantities, and only one of them is in ohms.
    const { resistanceText, wiper } = parsePotentiometerSpec(value);
    const track = explicitUnit(resistanceText, "Ω");
    // A centred wiper is the resting state and every schematic saved before the
    // control existed; it reads as a plain resistance, exactly as it always did.
    if (wiper === DEFAULT_WIPER) return track;
    return `${track} · ${Math.round(wiper * 100)}%`;
  }
  if (kind === "comparator") {
    const params = decodeParams(kind, value);
    const base = `${explicitUnit(params.vhigh ?? "1", "V")}/${explicitUnit(params.vlow ?? "0", "V")}`;
    const hyst = Number(params.vhyst ?? "0");
    return hyst ? `${base} ±${explicitUnit(String(hyst), "V")}` : base;
  }
  if (kind === "opamp") {
    const raw = value.trim();
    const bare = raw.split(/\s+/, 1)[0] ?? "";
    // A named or imported part keeps its identity beside the triangle - that
    // is the one thing a reader must not have to guess, and Tau never
    // substitutes for it.
    if (bare && bare.toLowerCase() !== "ideal" && !bare.includes("=")) return bare;
    // `ideal` is the schema's internal model token (`internal: true`), not a
    // fact about the circuit. It was being printed verbatim, so every generic
    // op-amp on the sheet was captioned "ideal". Show the open-loop gain
    // instead, and only once it stops being the default.
    const gain = /(?:^|[\s,;])(?:Gain|Avol)\s*=\s*([^\s,;]+)/i.exec(raw)?.[1];
    return gain ? explicitUnit(gain, "V/V") : "";
  }
  if (kind === "nmos" || kind === "pmos") {
    const params = decodeParams(kind, value);
    const model = params.model || (kind === "nmos" ? "NMOS" : "PMOS");
    const w = params.w?.trim();
    const l = params.l?.trim();
    if (w || l) return `${model} W=${w || "?"} L=${l || "?"}`;
    return model;
  }
  // The sketch names the block; editable instance knobs belong in Properties,
  // not in a raw `X... param=value` string beside the symbol.
  if (kind === "subckt") return value.trim().split(/\s+/, 1)[0] ?? "";
  return explicitUnit(value, CATALOG_BY_KIND[kind].unit);
};

const componentBounds = (component: SchematicComponent) => componentGeometryBounds(component);

/** World-space bounds of the rendered body, excluding terminal leads. Unlike
 * `componentBounds`, this is centred on the fitted visual placement, which is
 * essential for imported `.asc` symbols whose file anchor is not their body
 * centre. Label attachment uses this for capacitors so a long imported lead
 * cannot pull the refdes/value pair away from the plate it names. */
const componentBodyWorldBounds = (component: SchematicComponent): Rect => {
  const placement = componentVisualPlacement(component);
  const body = isNativeMultiPinSubcircuit(component)
    ? nativeSubcircuitBody(component)
    : SYMBOL_BODY[component.kind];
  const corners = [
    { x: body.minX, y: body.minY },
    { x: body.maxX, y: body.minY },
    { x: body.maxX, y: body.maxY },
    { x: body.minX, y: body.maxY },
  ].map((point) => {
    const transformed = transformPoint(point, placement.rotation, placement.mirrored);
    return { x: placement.x + transformed.x, y: placement.y + transformed.y };
  });
  return {
    minX: Math.min(...corners.map((point) => point.x)),
    minY: Math.min(...corners.map((point) => point.y)),
    maxX: Math.max(...corners.map((point) => point.x)),
    maxY: Math.max(...corners.map((point) => point.y)),
  };
};

const labelAxis = (component: SchematicComponent) => {
  const pins = getComponentPins(component);
  if (pins.length !== 2) return "center";
  const dx = Math.abs(pins[0].x - pins[1].x);
  const dy = Math.abs(pins[0].y - pins[1].y);
  return dy > dx ? "vertical" : "horizontal";
};

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

/** Axis-aligned rect overlap (touching edges counts - marquee semantics). */
export const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/** Point inside (or on the edge of) an axis-aligned rect. */
export const pointInRect = (p: Point, r: Rect): boolean =>
  p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;

/**
 * Does an orthogonal wire segment intersect an axis-aligned rect? True when
 * ANY part of the segment crosses or touches the rect (marquee semantics:
 * "inside or intersecting" selects). Wires are axis-aligned so this reduces
 * to interval checks - no general line clipping needed.
 */
export const segmentIntersectsRect = (segment: WireSegment, rect: Rect): boolean => {
  const loX = Math.min(segment.a.x, segment.b.x);
  const hiX = Math.max(segment.a.x, segment.b.x);
  const loY = Math.min(segment.a.y, segment.b.y);
  const hiY = Math.max(segment.a.y, segment.b.y);
  return loX <= rect.maxX && hiX >= rect.minX && loY <= rect.maxY && hiY >= rect.minY;
};

/** Does any segment of a wire's polyline intersect the rect? */
export const wireIntersectsRect = (wire: SchematicWire, rect: Rect): boolean => {
  for (let i = 1; i < wire.points.length; i += 1) {
    if (segmentIntersectsRect({ a: wire.points[i - 1], b: wire.points[i] }, rect)) return true;
  }
  // Degenerate single-point wire.
  return wire.points.length === 1 && pointInRect(wire.points[0], rect);
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

export interface LabelPlacement {
  ref: { x: number; y: number; anchor: "start" | "middle" | "end" };
  val: { x: number; y: number; anchor: "start" | "middle" | "end" };
  box: Rect;
  /** The refdes string as it will be drawn. Equals `component.label` except in
   *  the last-resort elided form, where it is a lone ellipsis. */
  refText: string;
  /** The value caption as it will be drawn: the full string, a shortened form,
   *  or "" when the value had to be dropped to clear a collision. The renderer
   *  must print THIS, not re-derive it, or the boxes the placer reasoned about
   *  stop describing the ink (P3-07). */
  valText: string;
  /** True when the label degraded to an ellipsis affordance: no slot at any
   *  size was free of artwork or other text, so the sheet says "there is a
   *  label here" and the inspector holds the value. */
  elided: boolean;
}

/**
 * Horizontal advance per character, in world units, for each label line.
 *
 * Not a guess and not a fudge factor: a monospace advance is
 * `font-size * advance-ratio + letter-spacing`, and every font in `--font-mono`
 * is a 0.6-em-advance face (SF Mono 0.600, Menlo 0.60205, Courier New 0.600) -
 * so the widest member of the stack is the safe bound. The per-line sizes and
 * letter-spacings come from `.label-layer .ref` / `.val` / `.net-label-text` in
 * App.css, and `Canvas.labels.test.ts` re-derives these numbers from that
 * stylesheet so the two cannot drift.
 *
 * This replaced a hand-tuned 5.5/4.9 px per character, which under-measured the
 * real ink by 21-26% - enough that the placer scored a slot as clear while the
 * glyphs collided. That is the "1u F1k Ω" in P3-07's evidence.
 */
const MONO_ADVANCE_EM = 1233 / 2048; // Menlo, the widest face in --font-mono

export const LABEL_TEXT_ADVANCE = {
  /** `.label-layer .ref`: 11px, letter-spacing 0.02em. */
  ref: 11 * MONO_ADVANCE_EM + 11 * 0.02,
  /** `.label-layer .val`: 10px, letter-spacing 0.02em. */
  val: 10 * MONO_ADVANCE_EM + 10 * 0.02,
  /** `.net-label-text`: 11px, letter-spacing -0.01em. */
  net: 11 * MONO_ADVANCE_EM + 11 * -0.01,
} as const;

/** Em box height of each label line, i.e. its CSS `font-size`. */
export const LABEL_TEXT_HEIGHT = { ref: 11, val: 10 } as const;

const estimateTextWidth = (text: string, kind: "ref" | "val") => text.length * LABEL_TEXT_ADVANCE[kind];

/** The world-space box a single label line inks. Exported so the placement
 *  invariant in `Canvas.labels.test.ts` measures exactly what the placer
 *  reasoned about - a test with its own copy of this arithmetic would pass
 *  while the canvas overlapped. */
export const labelLineRect = (
  text: string,
  x: number,
  y: number,
  anchor: "start" | "middle" | "end",
  kind: "ref" | "val",
) => {
  const w = Math.max(8, estimateTextWidth(text, kind));
  const h = LABEL_TEXT_HEIGHT[kind];
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
  return { ref, val, box: unionRect(refBox, valBox), refText, valText, elided: false };
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
  const attachedCapacitor = component.kind === "capacitor" || component.kind === "polarizedCapacitor";
  if (attachedCapacitor) {
    const body = componentBodyWorldBounds(component);
    const centerX = (body.minX + body.maxX) / 2;
    const centerY = (body.minY + body.maxY) / 2;
    const hasRef = Boolean(component.label);
    const inline = (y: number) => {
      if (!hasRef) {
        return makePlacement(
          refText,
          valText,
          { x: centerX, y, anchor: "middle" },
          { x: centerX, y, anchor: "middle" },
        );
      }
      const gap = 8;
      const refWidth = estimateTextWidth(refText, "ref");
      const valWidth = Math.max(8, estimateTextWidth(valText, "val"));
      const left = centerX - (refWidth + gap + valWidth) / 2;
      const refEnd = left + refWidth;
      return makePlacement(
        refText,
        valText,
        { x: refEnd, y, anchor: "end" },
        { x: refEnd + gap, y, anchor: "start" },
      );
    };
    const stacked = (x: number, anchor: "start" | "end") => {
      if (!hasRef) {
        return makePlacement(
          refText,
          valText,
          { x, y: centerY, anchor },
          { x, y: centerY, anchor },
        );
      }
      return makePlacement(
        refText,
        valText,
        { x, y: centerY - 7, anchor },
        { x, y: centerY + 7, anchor },
      );
    };
    const vertical = labelAxis(component) === "vertical";
    const attached = vertical
      ? [
        stacked(body.maxX + 12, "start"),
        stacked(body.minX - 12, "end"),
      ]
      : [
        inline(body.minY - 12),
        inline(body.maxY + 12),
      ];
    // Keep the old side/fallback candidates after the attached choices. A
    // deliberately crowded sheet may need one, but the normal path remains
    // close to the capacitor body and is rotation/mirror aware.
    const b = componentBounds(component);
    const placement = componentVisualPlacement(component);
    const x = placement.x;
    const y = placement.y;
    const leftX = component.x + b.minX - 10;
    const rightX = component.x + b.maxX + 10;
    const topRefY = component.y + b.minY - 20;
    const belowRefY = component.y + b.maxY + 10;
    const fallback = [
      makePlacement(refText, valText, { x: leftX, y: y - 7, anchor: "end" }, { x: leftX, y: y + 7, anchor: "end" }),
      makePlacement(refText, valText, { x: rightX, y: y - 7, anchor: "start" }, { x: rightX, y: y + 7, anchor: "start" }),
      makePlacement(refText, valText, { x, y: topRefY, anchor: "middle" }, { x, y: topRefY + 12, anchor: "middle" }),
      makePlacement(refText, valText, { x, y: belowRefY, anchor: "middle" }, { x, y: belowRefY + 12, anchor: "middle" }),
    ];
    return vertical ? [...attached, ...fallback] : [...attached, ...fallback.reverse()];
  }
  const b = componentBounds(component);
  const placement = componentVisualPlacement(component);
  const x = placement.x;
  const y = placement.y;
  const leftX = component.x + b.minX - 10;
  const rightX = component.x + b.maxX + 10;
  const topRefY = component.y + b.minY - 20;
  const belowRefY = component.y + b.maxY + 10;
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

/**
 * Slots further out from the part, tried only after every close one has been
 * rejected.
 *
 * The close candidates above are the ones that read well - a label wants to
 * touch the thing it names. But there were only six of them, and when a
 * crowded sheet used all six up the placer had nothing left and drew an
 * overlap anyway. These rings are the "re-anchor" half of P3-07's escalation:
 * the same four sides, pushed out in fixed steps, plus a slide along the
 * perpendicular axis at each step so a label can get past a neighbour rather
 * than only away from it.
 *
 * Fixed steps and a fixed order, never a search: two identical sheets must
 * place identically (Canvas.geometry.placement.test.ts pins that), and the
 * reader's eye must be able to find the label in the same place each time.
 */
const RING_STEPS = [14, 30, 50] as const;

const ringCandidates = (
  component: SchematicComponent,
  refText: string,
  valText: string,
): LabelPlacement[] => {
  const b = componentBounds(component);
  const placement = componentVisualPlacement(component);
  const { x, y } = placement;
  const out: LabelPlacement[] = [];
  for (const step of RING_STEPS) {
    const leftX = component.x + b.minX - 10 - step;
    const rightX = component.x + b.maxX + 10 + step;
    const topRefY = component.y + b.minY - 20 - step;
    const belowRefY = component.y + b.maxY + 10 + step;
    for (const slide of [0, -step, step]) {
      out.push(
        makePlacement(refText, valText,
          { x: leftX, y: y - 7 + slide, anchor: "end" },
          { x: leftX, y: y + 7 + slide, anchor: "end" }),
        makePlacement(refText, valText,
          { x: rightX, y: y - 7 + slide, anchor: "start" },
          { x: rightX, y: y + 7 + slide, anchor: "start" }),
        makePlacement(refText, valText,
          { x: x + slide, y: topRefY, anchor: "middle" },
          { x: x + slide, y: topRefY + 12, anchor: "middle" }),
        makePlacement(refText, valText,
          { x: x + slide, y: belowRefY, anchor: "middle" },
          { x: x + slide, y: belowRefY + 12, anchor: "middle" }),
      );
    }
  }
  return out;
};

/** Total area of `box` covered by `rects`. */
const coveredArea = (box: Rect, rects: readonly Rect[]) => {
  let total = 0;
  for (const rect of rects) total += overlapArea(box, rect);
  return total;
};

/**
 * The first candidate that covers no *hard* obstacle, or null if there is none.
 *
 * Obstacles come in two kinds and conflating them is what forced the old code
 * into a bad trade. Artwork and other label text are HARD: a label on either is
 * the defect P3-07 reports, and no amount of shuffling justifies it. A wire
 * under the text is SOFT: it reads as though the wire carried the value, which
 * is worth avoiding but is not worth dropping a refdes for.
 *
 * So: ask the shared kernel for the best slot against everything (this is the
 * historical behaviour, and in the overwhelmingly common uncrowded case it
 * returns the same first-clear candidate it always did); if that slot is on
 * something hard, ask again with the wire preference dropped.
 */
const placeClear = (
  candidates: readonly LabelPlacement[],
  hard: readonly Rect[],
  soft: readonly Rect[],
): LabelPlacement | null => {
  const ideal = placeOverlay({ candidates, obstacles: soft.length > 0 ? [...hard, ...soft] : hard });
  if (coveredArea(ideal.box, hard) === 0) return ideal;
  if (soft.length === 0) return null;
  const clearOfHard = placeOverlay({ candidates, obstacles: hard });
  return coveredArea(clearOfHard.box, hard) === 0 ? clearOfHard : null;
};

/** Marks a label that had to give up its text entirely. One character wide, so
 *  it fits where the caption could not, and the value is a click away in the
 *  inspector. */
const ELLIPSIS = "…";

/**
 * Progressively shorter value captions, tried in order once re-anchoring has
 * failed. Each keeps the leading characters - the digits, which is the half a
 * reader can use - and marks the loss with an ellipsis, so an abbreviated label
 * never reads as a complete value that happens to be wrong.
 */
const shortenedValues = (valText: string): string[] => {
  const forms: string[] = [];
  for (const fraction of [0.66, 0.33]) {
    const keep = Math.max(1, Math.floor(valText.length * fraction));
    if (keep >= valText.length) continue;
    const form = `${valText.slice(0, keep).trimEnd()}${ELLIPSIS}`;
    if (form.length < valText.length && !forms.includes(form)) forms.push(form);
  }
  return forms;
};

interface LabelTextForm {
  /** What the candidate geometry is measured with. When a part carries no
   *  refdes the value text occupies the ref line's slot, which is why this can
   *  differ from `drawRef`. */
  measureRef: string;
  /** What the canvas actually prints on the ref line ("" for none). */
  drawRef: string;
  val: string;
  elided: boolean;
}

/**
 * The escalation ladder for one component's label, in the order it is tried.
 *
 * Order is a judgement call about what a reader loses at each step: position
 * first (a label further from its part still says everything), then precision
 * (a truncated value still says roughly what it is), then the value (identity
 * outranks the number - the inspector always has the number), and only then
 * the label itself. The last rung has no text at all, so zero overlap is
 * guaranteed by construction rather than by finding a lucky slot.
 */
const labelTextForms = (component: SchematicComponent, valText: string): LabelTextForm[] => {
  const ref = component.label;
  const forms: LabelTextForm[] = [
    { measureRef: ref || valText, drawRef: ref, val: valText, elided: false },
  ];
  for (const short of shortenedValues(valText)) {
    forms.push({ measureRef: ref || short, drawRef: ref, val: short, elided: false });
  }
  if (ref && valText) forms.push({ measureRef: ref, drawRef: ref, val: "", elided: false });
  forms.push({ measureRef: ELLIPSIS, drawRef: ELLIPSIS, val: "", elided: true });
  return forms;
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

/**
 * Where every component's refdes/value text goes.
 *
 * The contract this owes the canvas is absolute (P3-07, "Absolutely no overlap
 * between labels EVER"): the box it returns for a component never intersects
 * another component's artwork and never intersects another label's box. It
 * gets there by escalating rather than by settling - re-anchor, shorten, drop
 * the value, and finally reduce to an ellipsis, which is one character wide and
 * therefore fits where nothing else did. A component whose label cannot be
 * placed even as an ellipsis is simply left out of the map, which the renderer
 * already treats as "draw nothing"; that is the constructive floor that makes
 * the invariant hold by definition instead of by luck.
 */
export const buildLabelPlacements = (components: SchematicComponent[], wires: SchematicWire[] = []) => {
  const componentRects = components.map(componentWorldRect);
  const wireRects = wireSegmentRects(wires);
  const placed: Rect[] = [];
  const placements = new Map<string, LabelPlacement>();

  for (const component of components) {
    const refText = component.label;
    const valText = sourceValueLabel(component.kind, component.value);
    if (!refText && !valText) continue;

    // Artwork and already-placed label boxes are hard: covering either is the
    // reported defect. Wires are soft - see `placeClear`.
    const hard = [...componentRects, ...placed];
    for (const form of labelTextForms(component, valText)) {
      const candidates = [
        ...labelCandidates(component, form.measureRef, form.val),
        ...ringCandidates(component, form.measureRef, form.val),
      ];
      const chosen = placeClear(candidates, hard, wireRects);
      if (!chosen) continue;
      placements.set(component.id, {
        ...chosen,
        refText: form.drawRef,
        valText: form.val,
        elided: form.elided,
      });
      // Padded so the NEXT label keeps a readable gutter, not just a
      // hairline of clearance, from this one.
      placed.push(padRect(chosen.box, 3));
      break;
    }
  }

  return placements;
};

/** Circuit bounds extended to cover the refdes/value text next to each symbol.
 *  `circuitBounds`' fixed per-symbol margin does not account for label text,
 *  so fit-to-view used to clip long labels (e.g. "U1 ideal") at the viewport
 *  edge. Uses the same placement engine the canvas renders with. */
export function circuitBoundsWithLabels(
  components: SchematicComponent[],
  wires: SchematicWire[],
  shapes: readonly SchematicAscShape[] = [],
): Rect | null {
  const base = circuitBounds(components, wires, undefined, shapes);
  if (!base) return base;
  let { minX, minY, maxX, maxY } = base;
  for (const placement of buildLabelPlacements(components, wires).values()) {
    minX = Math.min(minX, placement.box.minX);
    minY = Math.min(minY, placement.box.minY);
    maxX = Math.max(maxX, placement.box.maxX);
    maxY = Math.max(maxY, placement.box.maxY);
  }
  return { minX, minY, maxX, maxY };
}

// ── Net label auto-placement (Fix 2) ──────────────────────────────────────
// Advance and height come from `.net-label-text` in App.css (11px mono,
// letter-spacing -0.01em) via `LABEL_TEXT_ADVANCE`, which
// `Canvas.labels.test.ts` re-derives from that stylesheet. The number used to
// be a hand-tuned 5.8 under a comment claiming the font was "9.5px mono" - it
// had been 11px for some time, and the stale comment is exactly why net labels
// were measured 11% narrower than they ink (P3-07). Still a character-count
// estimate rather than a DOM measurement: auto-placement runs on every render
// of an unpositioned label, so it must stay cheap.
const NET_LABEL_CHAR_W = LABEL_TEXT_ADVANCE.net;
const NET_LABEL_HEIGHT = 11;

/** World-space bbox a net label's text would occupy at a given anchor+offset.
 *  Matches the actual render in Canvas.tsx (`<text x={anchor.x+dx}
 *  y={anchor.y+dy}>`, default start-anchor - text extends rightward from x,
 *  y is the baseline so most of the glyph height sits above it). */
export const netLabelTextRect = (anchor: Point, dx: number, dy: number, text: string): Rect => {
  const w = Math.max(8, text.length * NET_LABEL_CHAR_W);
  const x = anchor.x + dx;
  const y = anchor.y + dy;
  return padRect({ minX: x, minY: y - NET_LABEL_HEIGHT, maxX: x + w, maxY: y + 2 }, 1);
};

/** Candidate (dx, dy) offsets tried in priority order when auto-placing a
 *  net label: right-above (the old fixed default) first, then right-below,
 *  left-above/below, then progressively further out in each direction. `w`
 *  folds into the "left" candidates so they clear the anchor by the text's
 *  own width instead of just nudging a few px past it. */
const netLabelOffsetCandidates = (w: number): Array<{ dx: number; dy: number }> => [
  { dx: 6, dy: -6 },
  { dx: 6, dy: NET_LABEL_HEIGHT + 8 },
  { dx: -(w + 6), dy: -6 },
  { dx: -(w + 6), dy: NET_LABEL_HEIGHT + 8 },
  { dx: 6, dy: -(NET_LABEL_HEIGHT + 20) },
  { dx: 6, dy: 2 * NET_LABEL_HEIGHT + 16 },
  { dx: -(w + 6), dy: -(NET_LABEL_HEIGHT + 20) },
  { dx: -(w + 6), dy: 2 * NET_LABEL_HEIGHT + 16 },
  { dx: w + 24, dy: -6 },
  { dx: -(2 * w + 24), dy: -6 },
];

/**
 * Auto-placement for a net label with no explicit `dx`/`dy` (old .sim files,
 * or a label that has never been dragged): the first candidate offset whose
 * text bbox clears every component's bounding box, else the lowest-overlap
 * fallback. Mirrors `buildLabelPlacements`' candidate-scoring approach
 * (score = summed overlap area, cheapest wins) but scoped to net labels vs.
 * component bodies only - a schematic has few labels and few components, so
 * scoring every candidate against every component per render is deterministic
 * and cheap .
 */
/** Length of `segment` that passes through `rect` (0 when it misses). Only
 *  axis-aligned segments occur in Tau wires, so this is a cheap clip. */
const segmentLengthInRect = (segment: WireSegment, rect: Rect): number => {
  const { a, b } = segment;
  if (a.x === b.x) {
    if (a.x < rect.minX || a.x > rect.maxX) return 0;
    const lo = Math.max(Math.min(a.y, b.y), rect.minY);
    const hi = Math.min(Math.max(a.y, b.y), rect.maxY);
    return Math.max(0, hi - lo);
  }
  if (a.y === b.y) {
    if (a.y < rect.minY || a.y > rect.maxY) return 0;
    const lo = Math.max(Math.min(a.x, b.x), rect.minX);
    const hi = Math.min(Math.max(a.x, b.x), rect.maxX);
    return Math.max(0, hi - lo);
  }
  return 0;
};

/** Everything a net label must avoid, resolved once. Built per placement pass
 *  rather than per candidate offset: the component and wire geometry is
 *  identical for every candidate, so recomputing it inside the scoring loop is
 *  pure waste (and at a few hundred parts it is what makes a drag stutter). */
interface NetLabelObstacles {
  componentRects: Rect[];
  segments: WireSegment[];
  probeRects: Rect[];
}

const netLabelObstacles = (
  components: readonly SchematicComponent[],
  wires: readonly SchematicWire[],
  probePoints: readonly Point[],
): NetLabelObstacles => ({
  componentRects: components.map(componentWorldRect),
  segments: wireSegments(wires as SchematicWire[]),
  probeRects: probePoints.map((p) => ({ minX: p.x - 8, minY: p.y - 8, maxX: p.x + 8, maxY: p.y + 8 })),
});

function chooseNetLabelOffset(
  anchor: Point,
  text: string,
  obstacles: NetLabelObstacles,
  occupiedLabelRects: readonly Rect[],
): { dx: number; dy: number } {
  const w = Math.max(8, text.length * NET_LABEL_CHAR_W);
  const candidates = netLabelOffsetCandidates(w);
  const { componentRects, segments, probeRects } = obstacles;
  if (
    componentRects.length === 0 && segments.length === 0
    && probeRects.length === 0 && occupiedLabelRects.length === 0
  ) return candidates[0];

  const scored = candidates.map((offset) => {
    const box = netLabelTextRect(anchor, offset.dx, offset.dy, text);
    let score = componentRects.reduce((total, rect) => total + overlapArea(box, rect), 0);
    score += probeRects.reduce((total, rect) => total + overlapArea(box, rect) * 2, 0);
    // Text landing on other text is the worst outcome - it is the one case
    // where both strings become unreadable rather than just cluttered.
    score += occupiedLabelRects.reduce((total, rect) => total + overlapArea(box, rect) * 3, 0);
    // A wire crossing the text box is linear, not areal - weight it so a
    // couple of grid units of wire-under-text loses to a clear spot.
    score += segments.reduce((total, segment) => total + segmentLengthInRect(segment, box) * 4, 0);
    return { offset, score };
  });
  return scored.find((entry) => entry.score === 0)?.offset ?? scored.sort((a, b) => a.score - b.score)[0].offset;
}

export function autoNetLabelOffset(
  anchor: Point,
  text: string,
  components: readonly SchematicComponent[],
  /** Optional extra obstacles: wires under the text read as "label on a wire"
   *  and probe dots (r≈8) get fully hidden - both score as overlap. */
  wires: readonly SchematicWire[] = [],
  probePoints: readonly Point[] = [],
  occupiedLabelRects: readonly Rect[] = [],
): { dx: number; dy: number } {
  return chooseNetLabelOffset(
    anchor,
    text,
    netLabelObstacles(components, wires, probePoints),
    occupiedLabelRects,
  );
}

/** Place all automatic net labels as one deterministic set so two labels do
 * not independently choose the same clear-looking slot. Explicitly dragged
 * labels reserve their real boxes first; automatic labels then fill the
 * remaining candidates in document order. */
export function autoNetLabelOffsets(
  labels: readonly NetLabel[],
  components: readonly SchematicComponent[],
  wires: readonly SchematicWire[] = [],
  probePoints: readonly Point[] = [],
): Map<string, { dx: number; dy: number }> {
  const offsets = new Map<string, { dx: number; dy: number }>();
  const obstacles = netLabelObstacles(components, wires, probePoints);

  // Reference designators and value text are placed by buildLabelPlacements,
  // independently of net labels. Without seeding them here a net label happily
  // settles on top of one: FLAG 304 96 "out" landed exactly on R1's refdes in
  // a three-part RC circuit, which is the first thing an imported LTspice file
  // shows. Component *symbols* were already avoided; their *text* was not.
  const occupied: Rect[] = [...buildLabelPlacements(components as SchematicComponent[], wires as SchematicWire[]).values()]
    .map((placement) => placement.box);

  // User placements are authoritative obstacles, regardless of document order.
  for (const label of labels) {
    if (label.dx === undefined || label.dy === undefined) continue;
    const offset = { dx: label.dx, dy: label.dy };
    offsets.set(label.id, offset);
    occupied.push(netLabelTextRect(label, offset.dx, offset.dy, label.text));
  }

  for (const label of labels) {
    if (offsets.has(label.id)) continue;
    const offset = chooseNetLabelOffset(label, label.text, obstacles, occupied);
    offsets.set(label.id, offset);
    occupied.push(netLabelTextRect(label, offset.dx, offset.dy, label.text));
  }
  return offsets;
}

export interface FitViewOptions {
  /** Fraction of each viewport dimension kept clear around the circuit. */
  paddingFraction?: number;
  /** Absolute floor for that padding, so small windows still breathe. */
  minPaddingPx?: number;
  minZoom?: number;
  maxZoom?: number;
  /** Optional topology center. Bounds can include asymmetric labels while the
   *  electrical drawing itself remains centered in the viewport. */
  center?: Point;
}

/** Zoom + translation that frames `bounds` in a viewport with breathing room:
 *  12% of each viewport dimension, never less than 48px. Pure so
 *  the padding math is unit-testable without a DOM. Degenerate (point-sized)
 *  bounds and zero-sized viewports resolve to a clamped, finite transform. */
export function fitViewTransform(
  bounds: Rect,
  viewportWidth: number,
  viewportHeight: number,
  options: FitViewOptions = {},
): { zoom: number; x: number; y: number } {
  const frac = options.paddingFraction ?? 0.12;
  const minPad = options.minPaddingPx ?? 48;
  const minZoom = options.minZoom ?? 0.25;
  const maxZoom = options.maxZoom ?? 5;
  const padX = Math.max(viewportWidth * frac, minPad);
  const padY = Math.max(viewportHeight * frac, minPad);
  const availW = Math.max(viewportWidth - padX * 2, 1);
  const availH = Math.max(viewportHeight - padY * 2, 1);
  const naturalCx = (bounds.minX + bounds.maxX) / 2;
  const naturalCy = (bounds.minY + bounds.maxY) / 2;
  const cx = options.center?.x ?? naturalCx;
  const cy = options.center?.y ?? naturalCy;
  // When an explicit topology center is used, reserve equal screen space on
  // both sides for the furthest label edge. This keeps every label visible
  // without letting asymmetric ref/value text push the circuit body off-center.
  const w = Math.max(
    options.center ? Math.max(cx - bounds.minX, bounds.maxX - cx) * 2 : bounds.maxX - bounds.minX,
    1,
  );
  const h = Math.max(
    options.center ? Math.max(cy - bounds.minY, bounds.maxY - cy) * 2 : bounds.maxY - bounds.minY,
    1,
  );
  const zoom = Math.min(maxZoom, Math.max(minZoom, Math.min(availW / w, availH / h)));
  return { zoom, x: viewportWidth / 2 - cx * zoom, y: viewportHeight / 2 - cy * zoom };
}

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

/** World-space body box using the fitted visual origin for imported parts. */
const componentBodyBox = (component: SchematicComponent): Rect => {
  const placement = componentVisualPlacement(component);
  const body = isNativeMultiPinSubcircuit(component)
    ? nativeSubcircuitBody(component)
    : SYMBOL_BODY[component.kind];
  const corners = [
    { x: body.minX, y: body.minY },
    { x: body.maxX, y: body.minY },
    { x: body.maxX, y: body.maxY },
    { x: body.minX, y: body.maxY },
  ].map((point) => {
    const transformed = transformPoint(point, placement.rotation, placement.mirrored);
    return { x: placement.x + transformed.x, y: placement.y + transformed.y };
  });
  return {
    minX: Math.min(...corners.map((point) => point.x)),
    minY: Math.min(...corners.map((point) => point.y)),
    maxX: Math.max(...corners.map((point) => point.x)),
    maxY: Math.max(...corners.map((point) => point.y)),
  };
};

/** STRICT overlap (touching edges do NOT count) - used for placement/route
 *  collision, where bodies placed flush against each other are legal. The
 *  exported `rectsOverlap` above is inclusive (marquee: touch selects). */
const rectsOverlapStrict = (a: Rect, b: Rect) =>
  a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

/** Click slack around a body, in world px, for selecting thin symbols. */
const HIT_PAD = 7;

/** The component under a world point. Prefer one whose actual body contains the
 *  point over one only within the click pad, then the smaller body - so a small
 *  part (e.g. ground) can never steal a click from the part under the cursor,
 *  regardless of render/z-order. */
export const componentAt = (components: SchematicComponent[], wx: number, wy: number): SchematicComponent | null => {
  let best: SchematicComponent | null = null;
  let bestScore = Infinity;
  for (const c of components) {
    const box = componentBodyBox(c);
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
    if (rectsOverlapStrict(a, componentBodyBox(c))) return true;
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
    const box = componentBodyBox(c);
    // Keep a small clearance so wires don't graze symbol strokes.
    const pad = 1;
    return rectsOverlapStrict(seg, {
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
  stationaryPins: Point[] = [],
): SchematicWire[] {
  const targetFor = (point: Point) =>
    sourcePins.some((pin) => pointsEqual(pin, point))
      ? { x: point.x + dx, y: point.y + dy }
      : null;

  const stationary = new Set(stationaryPins.map((pin) => pointKey(pin)));
  const lead = (from: Point, to: Point): Point[] => cleanRoute([
    from,
    ...(from.x === to.x || from.y === to.y ? [] : [{ x: to.x, y: from.y }]),
    to,
  ]);

  return sourceWires.flatMap((wire) => {
    if (wire.points.length < 2) return wire;
    const firstPoint = wire.points[0];
    const lastPoint = wire.points[wire.points.length - 1];
    const firstTarget = targetFor(firstPoint);
    const lastTarget = targetFor(lastPoint);
    const interiorPins = sourcePins.filter((pin) => (
      !pointsEqual(pin, firstPoint)
      && !pointsEqual(pin, lastPoint)
      && wireSegments([wire]).some((segment) => pointOnWireSegment(pin, segment))
    ));
    const firstShared = !!firstTarget && stationary.has(pointKey(firstPoint));
    const lastShared = !!lastTarget && stationary.has(pointKey(lastPoint));
    const leads = [
      ...(firstShared ? [{ from: firstPoint, to: firstTarget! }] : []),
      ...(lastShared ? [{ from: lastPoint, to: lastTarget! }] : []),
      ...interiorPins.map((pin) => ({ from: pin, to: { x: pin.x + dx, y: pin.y + dy } })),
    ].filter(({ from, to }) => !pointsEqual(from, to)).map(({ from, to }, index) => ({
      id: `${wire.id}~lead~${pointKey(from)}~${index}`,
      points: lead(from, to),
    }));

    const movableFirst = firstTarget && !firstShared ? firstTarget : null;
    const movableLast = lastTarget && !lastShared ? lastTarget : null;
    if (!movableFirst && !movableLast) return [wire, ...leads];

    if (movableFirst && movableLast) {
      return [{ ...wire, points: wire.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) }, ...leads];
    }
    return [{
      ...wire,
      points: movableFirst ? moveWireStart(wire.points, movableFirst) : moveWireEnd(wire.points, movableLast!),
    }, ...leads];
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

/** Count component pins touched anywhere except the two requested terminals.
 * A visually valid orthogonal route may otherwise turn on (or run through) a
 * different pin of its endpoint component, silently shorting that pin when
 * the schematic is netlisted. */
const routeIncidentalPinCount = (points: Point[], components: SchematicComponent[]) => {
  if (points.length < 2) return 0;
  const start = points[0];
  const end = points[points.length - 1];
  const contacts = new Set<string>();
  for (const component of components) {
    for (const pin of getComponentPins(component)) {
      if (pointsEqual(pin, start) || pointsEqual(pin, end)) continue;
      for (let index = 1; index < points.length; index += 1) {
        if (pointOnWireSegment(pin, { a: points[index - 1], b: points[index] })) {
          contacts.add(`${component.id}:${pin.id}`);
          break;
        }
      }
    }
  }
  return contacts.size;
};

/** Exported for tests - count how many orthogonal segments cross a body. */
export const countRouteBodyHits = routeHitCount;

/** Route an orthogonal wire between two points. Prefers clear channels around
 *  component bodies, then shorter length, then fewer corners. */
/** Crossing count + collinear-overlap length of a candidate route against the
 *  existing wires - the "visual nightmare" metrics. Endpoint touches are
 *  ignored (they're legitimate connections, not clutter). */
const routeClutter = (
  points: Point[],
  existing: readonly SchematicWire[],
): { crossings: number; overlap: number; nearParallel: number; nodeContacts: number } => {
  let crossings = 0;
  let overlap = 0;
  let nearParallel = 0;
  const nodeContactKeys = new Set<string>();
  const routeStart = points[0];
  const routeEnd = points[points.length - 1];
  const internalRoutePoints = points.slice(1, -1);
  const existingSegments = wireSegments(existing as SchematicWire[]);
  for (let i = 1; i < points.length; i += 1) {
    const seg = { a: points[i - 1], b: points[i] };
    if (pointsEqual(seg.a, seg.b)) continue;
    const vertical = seg.a.x === seg.b.x;
    for (const other of existingSegments) {
      const otherVertical = other.a.x === other.b.x;
      if (vertical !== otherVertical) {
        const hit = segmentIntersections(seg, other);
        if (hit.length > 0) {
          const point = hit[0];
          // A route may deliberately begin/end on an existing wire (a branch).
          // Any other contact with an existing endpoint is an accidental-looking
          // node and is more confusing than a plain mid-segment crossing.
          if (pointsEqual(point, routeStart) || pointsEqual(point, routeEnd)) continue;
          if (
            isWireEndpoint(point, other) ||
            internalRoutePoints.some((routePoint) => pointsEqual(routePoint, point))
          ) nodeContactKeys.add(`${point.x},${point.y}`);
          else crossings += 1;
        }
      } else if (vertical && seg.a.x === other.a.x) {
        const lo = Math.max(Math.min(seg.a.y, seg.b.y), Math.min(other.a.y, other.b.y));
        const hi = Math.min(Math.max(seg.a.y, seg.b.y), Math.max(other.a.y, other.b.y));
        overlap += Math.max(0, hi - lo);
      } else if (vertical && Math.abs(seg.a.x - other.a.x) < GRID) {
        const lo = Math.max(Math.min(seg.a.y, seg.b.y), Math.min(other.a.y, other.b.y));
        const hi = Math.min(Math.max(seg.a.y, seg.b.y), Math.max(other.a.y, other.b.y));
        nearParallel += Math.max(0, hi - lo);
      } else if (!vertical && seg.a.y === other.a.y) {
        const lo = Math.max(Math.min(seg.a.x, seg.b.x), Math.min(other.a.x, other.b.x));
        const hi = Math.min(Math.max(seg.a.x, seg.b.x), Math.max(other.a.x, other.b.x));
        overlap += Math.max(0, hi - lo);
      } else if (!vertical && Math.abs(seg.a.y - other.a.y) < GRID) {
        const lo = Math.max(Math.min(seg.a.x, seg.b.x), Math.min(other.a.x, other.b.x));
        const hi = Math.min(Math.max(seg.a.x, seg.b.x), Math.max(other.a.x, other.b.x));
        nearParallel += Math.max(0, hi - lo);
      }
    }
  }
  return { crossings, overlap, nearParallel, nodeContacts: nodeContactKeys.size };
};

export const routeWireSmart = (
  start: Point,
  end: Point,
  components: SchematicComponent[],
  existingWires: readonly SchematicWire[] = [],
): Point[] => {
  // Pointer/world transforms can leave a nominally snapped gesture a fraction
  // off-grid. If those raw coordinates reach the orthogonal candidates, the
  // router faithfully creates a tiny final elbow. Preserve exact imported pin
  // and wire connections, but normalize every free endpoint to the grid before
  // generating/scoring candidates.
  const isExistingConnection = (point: Point) =>
    components.some((component) => getComponentPins(component).some((pin) => pointsEqual(pin, point))) ||
    existingWires.some((wire) => wire.points.slice(1).some((b, index) => {
      const a = wire.points[index];
      return a.x === b.x
        ? point.x === a.x && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)
        : a.y === b.y && point.y === a.y && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x);
    }));
  const normalizeEndpoint = (point: Point): Point => isExistingConnection(point)
    ? point
    : { x: snap(point.x), y: snap(point.y) };
  start = normalizeEndpoint(start);
  end = normalizeEndpoint(end);

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
    const box = componentBodyBox(component);
    // One and two grid cells outside the body - gives the router room to skirt
    // symbols without hugging the stroke.
    for (const pad of [GRID, GRID * 2]) {
      xChannels.add(snap(box.minX - pad));
      xChannels.add(snap(box.maxX + pad));
      yChannels.add(snap(box.minY - pad));
      yChannels.add(snap(box.maxY + pad));
    }
  }

  // Existing wires create usable routing channels too. A one-grid clearance
  // from a parallel run avoids visually merging two different nets; a channel
  // just beyond each segment end gives the router a way around a finite wire
  // instead of accepting a crossing simply because no component was nearby.
  for (const wire of existingWires) {
    for (let index = 1; index < wire.points.length; index += 1) {
      const a = wire.points[index - 1];
      const b = wire.points[index];
      if (a.y === b.y) {
        yChannels.add(snap(a.y - GRID));
        yChannels.add(snap(a.y + GRID));
        xChannels.add(snap(Math.min(a.x, b.x) - GRID));
        xChannels.add(snap(Math.max(a.x, b.x) + GRID));
      } else if (a.x === b.x) {
        xChannels.add(snap(a.x - GRID));
        xChannels.add(snap(a.x + GRID));
        yChannels.add(snap(Math.min(a.y, b.y) - GRID));
        yChannels.add(snap(Math.max(a.y, b.y) + GRID));
      }
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
    .map((points) => {
      const clutter = routeClutter(points, existingWires);
      return {
        points,
        incidentalPins: routeIncidentalPinCount(points, components),
        hits: routeHitCount(points, components),
        // Riding on top of another wire is worse than crossing it - an
        // overlapped run is unreadable, a crossing at least gets a hop arc.
        overlap: clutter.overlap,
        nearParallel: clutter.nearParallel,
        nodeContacts: clutter.nodeContacts,
        crossings: clutter.crossings,
        length: routeLength(points),
        corners: Math.max(0, points.length - 2),
      };
    })
    .sort(
      (a, b) =>
        a.incidentalPins - b.incidentalPins ||
        a.hits - b.hits ||
        a.overlap - b.overlap ||
        a.nodeContacts - b.nodeContacts ||
        a.nearParallel - b.nearParallel ||
        a.crossings - b.crossings ||
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
    // Score against the OTHER wires - a wire must not penalize its own path.
    const others = wires.filter((other) => other.id !== wire.id);
    return { ...wire, points: routeWireSmart(start, end, components, others) };
  });
}

/** Wires whose endpoints currently sit on any of the given world pin points. */
export function wiresTouchingPins(wires: SchematicWire[], pinPoints: Point[]): Set<string> {
  const out = new Set<string>();
  for (const wire of wires) {
    if (wire.points.length < 2) continue;
    if (pinPoints.some((pin) => wireSegments([wire]).some((segment) => pointOnWireSegment(pin, segment)))) {
      out.add(wire.id);
    }
  }
  return out;
}

/** World pin positions for a set of components (after orientation). */
export function worldPinsFor(components: SchematicComponent[]): Point[] {
  return components.flatMap((component) => getComponentPins(component).map(({ x, y }) => ({ x, y })));
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

/** One drawing primitive resolved into the numbers an SVG element wants.
 *  LTspice stores a box as two opposite corners in whatever order the author
 *  dragged them, so `x2 - x1` is frequently negative and cannot be handed to a
 *  `<rect>` directly. */
export type AscShapeRender =
  | { kind: "LINE"; wide: boolean; style: number; x1: number; y1: number; x2: number; y2: number }
  | { kind: "RECTANGLE"; wide: boolean; style: number; x: number; y: number; width: number; height: number }
  | { kind: "CIRCLE"; wide: boolean; style: number; cx: number; cy: number; rx: number; ry: number }
  | {
      kind: "ARC";
      wide: boolean;
      style: number;
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      start: Point;
      end: Point;
      largeArc: boolean;
    };

const TAU_RADIANS = Math.PI * 2;

/** How far an arc travels from one parameter angle to another the way LTspice
 *  draws it - counterclockwise on screen, which is a DECREASING angle under a
 *  downward y axis. Stated once, because the emitted path and the bounding box
 *  disagreeing about which of the two candidate curves is drawn would frame the
 *  wrong half of an ellipse. */
const arcSweep = (from: number, to: number) =>
  ((from - to) % TAU_RADIANS + TAU_RADIANS) % TAU_RADIANS;

/** An arc record's last four numbers are rays from the box centre, not points
 *  on the curve - LTspice lets the author drag them anywhere. Projecting them
 *  onto the ellipse is what keeps the arc from starting off it. */
const ellipseRayPoint = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  px: number,
  py: number,
): Point & { angle: number } => {
  const angle = Math.atan2((py - cy) / ry, (px - cx) / rx);
  return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle), angle };
};

/** Resolve one preserved `.asc` drawing primitive into renderable numbers, or
 *  null for a record with no visible extent (an arc needs a non-degenerate box
 *  before its rays mean anything). */
export function ascShapeRender(shape: SchematicAscShape): AscShapeRender | null {
  const [a, b, c, d] = shape.coords;
  if (![a, b, c, d].every((value) => Number.isFinite(value))) return null;
  const wide = shape.width === "Wide";
  // The trailing coordinate is LTspice's line-style index; absent means solid.
  const style = shape.coords[shape.kind === "ARC" ? 8 : 4] ?? 0;
  if (shape.kind === "LINE") {
    return { kind: "LINE", wide, style, x1: a, y1: b, x2: c, y2: d };
  }
  const left = Math.min(a, c);
  const top = Math.min(b, d);
  const width = Math.abs(c - a);
  const height = Math.abs(d - b);
  if (shape.kind === "RECTANGLE") {
    return { kind: "RECTANGLE", wide, style, x: left, y: top, width, height };
  }
  const cx = left + width / 2;
  const cy = top + height / 2;
  const rx = width / 2;
  const ry = height / 2;
  if (shape.kind === "CIRCLE") {
    return { kind: "CIRCLE", wide, style, cx, cy, rx, ry };
  }
  const [px1, py1, px2, py2] = shape.coords.slice(4);
  if (rx <= 0 || ry <= 0) return null;
  if (![px1, py1, px2, py2].every((value) => Number.isFinite(value))) return null;
  const start = ellipseRayPoint(cx, cy, rx, ry, px1, py1);
  const end = ellipseRayPoint(cx, cy, rx, ry, px2, py2);
  // LTspice sweeps an arc counterclockwise on screen from the first ray to the
  // second - established against its own `ind.asy`, whose three arcs only close
  // into a coil bulging away from the pin axis this way round.
  const sweep = arcSweep(start.angle, end.angle);
  return {
    kind: "ARC",
    wide,
    style,
    cx,
    cy,
    rx,
    ry,
    start: { x: start.x, y: start.y },
    end: { x: end.x, y: end.y },
    largeArc: sweep > Math.PI,
  };
}

/** World-space box a preserved primitive actually draws in, or null for a
 *  record with no visible extent. Two things a naive min/max over the record's
 *  own numbers gets wrong: an arc reaches only the part of its ellipse it
 *  sweeps, and an arc's last four numbers are RAYS the author may have dragged
 *  far outside the box, so they are no part of the drawing. Built on
 *  `ascShapeRender` rather than on the record, so what is framed is what the
 *  canvas puts on the sheet. */
export function ascShapeBounds(shape: SchematicAscShape): Rect | null {
  const render = ascShapeRender(shape);
  if (!render) return null;
  if (render.kind === "LINE") {
    return {
      minX: Math.min(render.x1, render.x2),
      minY: Math.min(render.y1, render.y2),
      maxX: Math.max(render.x1, render.x2),
      maxY: Math.max(render.y1, render.y2),
    };
  }
  if (render.kind === "RECTANGLE") {
    return {
      minX: render.x,
      minY: render.y,
      maxX: render.x + render.width,
      maxY: render.y + render.height,
    };
  }
  const { cx, cy, rx, ry } = render;
  if (render.kind === "CIRCLE") {
    return { minX: cx - rx, minY: cy - ry, maxX: cx + rx, maxY: cy + ry };
  }
  const angleOf = (point: Point) => Math.atan2((point.y - cy) / ry, (point.x - cx) / rx);
  const from = angleOf(render.start);
  const swept = arcSweep(from, angleOf(render.end));
  const xs = [render.start.x, render.end.x];
  const ys = [render.start.y, render.end.y];
  // The ellipse's four axis extremes, each kept only if the drawn curve passes
  // through it. An extreme sitting exactly on an endpoint is already covered
  // either way, so the fp error in recovering these angles cannot move a bound.
  const extremes: [number, number, number][] = [
    [0, cx + rx, cy],
    [Math.PI / 2, cx, cy + ry],
    [Math.PI, cx - rx, cy],
    [-Math.PI / 2, cx, cy - ry],
  ];
  for (const [angle, x, y] of extremes) {
    if (arcSweep(from, angle) > swept) continue;
    xs.push(x);
    ys.push(y);
  }
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/** SVG path for an arc. Sweep-flag 0 is counterclockwise under a downward y
 *  axis, which is the direction LTspice draws. */
export const ascArcPath = (arc: Extract<AscShapeRender, { kind: "ARC" }>): string => {
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return `M ${round(arc.start.x)} ${round(arc.start.y)} A ${round(arc.rx)} ${round(arc.ry)} 0 ${
    arc.largeArc ? 1 : 0
  } 0 ${round(arc.end.x)} ${round(arc.end.y)}`;
};
