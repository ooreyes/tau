import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getLocalPins, type LocalPin } from "./pins";
import {
  ComponentSymbol,
  PART_CAPTIONS,
  PIN_LABEL_LAYOUT,
  SYMBOL_BODY,
  SYMBOL_BOX,
  gateBodyHalfHeight,
  gateComPoint,
  gateInputRows,
} from "./symbols";
import { GATE_INPUTS_MAX, GATE_INPUTS_MIN, parseDigitalGate } from "../engine/digitalGateSpec";
import type { ComponentKind, Rotation } from "./types";

const ROTATIONS: Rotation[] = [0, 90, 180, 270];

/**
 * Geometry tests for the symbols redrawn under MISSION_COMPONENT_LIBRARY items
 * 3 and 4. These parse the rendered SVG and *compute* distances rather than
 * asserting on path strings, so they keep holding when a symbol is nudged and
 * fail the moment a glyph collides, a lead dangles, or SYMBOL_BODY drifts away
 * from the drawing again.
 */

/** `.component.selected .symbol` stroke-width in App.css. Selection weight is
 *  the worst case: a glyph that clears the body at rest can still bleed into
 *  it (plus its drop-shadow halo) once the part is picked. */
const SELECTED_STROKE = 2.35;

/** Kinds redrawn by items 3 and 4, plus the motor — redrawn later, but it
 *  earns the same body/lead/preview guarantees, and it shares the bulb's
 *  circle-plus-glyph artwork, so the two are best held to one standard. */
const REDRAWN_KINDS: ComponentKind[] = [
  "bulb",
  "motor",
  "potentiometer",
  "opamp",
  "comparator",
  "transformer",
  "ctTransformer",
  "vcvs",
  "vccs",
  "cccs",
  "ccvs",
];

const CONTROLLED_SOURCES = ["vcvs", "vccs", "cccs", "ccvs"] as const;

/** Palette / command-palette / inspector previews clip at roughly this box. */
const PREVIEW_HALF_W = 42;
const PREVIEW_HALF_H = 40;

// ── SVG markup → geometry ──────────────────────────────────────────────────

interface Pt {
  x: number;
  y: number;
}
interface Seg {
  a: Pt;
  b: Pt;
}
interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
/** One drawn SVG element, flattened to straight segments plus an exact box. */
interface Elem {
  tag: string;
  segments: Seg[];
  box: Box;
}

const render = (kind: ComponentKind): string =>
  renderToStaticMarkup(
    <svg>
      <ComponentSymbol kind={kind} />
    </svg>,
  );

/** Same, for the parts whose drawing depends on their value or orientation. */
const renderWith = (
  kind: ComponentKind,
  value?: string,
  rotation: Rotation = 0,
  mirrored = false,
): string =>
  renderToStaticMarkup(
    <svg>
      <ComponentSymbol kind={kind} value={value} rotation={rotation} mirrored={mirrored} />
    </svg>,
  );

/** Same, for a part carrying a source file's own pin bank (`pinOverride`). */
const renderWithImported = (kind: ComponentKind, value?: string): string =>
  renderToStaticMarkup(
    <svg>
      <ComponentSymbol kind={kind} value={value} imported />
    </svg>,
  );

const elementTags = (markup: string, name: string): string[] =>
  markup.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];

const attr = (tag: string, name: string): string | undefined => {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? match[1] : undefined;
};

const numAttr = (tag: string, name: string, fallback = 0): number => {
  const raw = attr(tag, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  expect(Number.isFinite(value), `${name}="${raw}"`).toBe(true);
  return value;
};

/** Elliptical-arc → polyline. Only circular arcs appear in these symbols. */
function arcSegments(from: Pt, to: Pt, r: number, large: boolean, sweep: boolean): Pt[] {
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const half2 = dx * dx + dy * dy;
  const radius = Math.max(r, Math.sqrt(half2));
  const scale = Math.sqrt(Math.max(0, radius * radius - half2) / half2);
  const sign = large === sweep ? -1 : 1;
  const cx = (from.x + to.x) / 2 + sign * scale * dy;
  const cy = (from.y + to.y) / 2 - sign * scale * dx;
  const a0 = Math.atan2(from.y - cy, from.x - cx);
  const a1 = Math.atan2(to.y - cy, to.x - cx);
  let delta = a1 - a0;
  if (sweep && delta <= 0) delta += Math.PI * 2;
  if (!sweep && delta >= 0) delta -= Math.PI * 2;
  const steps = 48;
  const points: Pt[] = [];
  for (let k = 1; k <= steps; k += 1) {
    const angle = a0 + (delta * k) / steps;
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  return points;
}

/** Absolute-only path parser covering the commands these symbols use. An
 *  unsupported command throws so a future bezier cannot silently skip a test. */
function pathSegments(d: string): Seg[] {
  const tokens = d.trim().split(/[\s,]+/).filter(Boolean);
  const segments: Seg[] = [];
  let index = 0;
  let cursor: Pt = { x: 0, y: 0 };
  let subpathStart: Pt = { x: 0, y: 0 };
  let command = "";
  const next = (): number => {
    const value = Number(tokens[index]);
    index += 1;
    if (!Number.isFinite(value)) throw new Error(`bad number in path "${d}"`);
    return value;
  };
  const lineTo = (point: Pt) => {
    segments.push({ a: cursor, b: point });
    cursor = point;
  };
  /** Flatten a cubic to a polyline; `reflect` carries S's implicit control. */
  let reflect: Pt | null = null;
  const curveTo = (c1: Pt, c2: Pt, end: Pt) => {
    const from = cursor;
    const steps = 32;
    for (let k = 1; k <= steps; k += 1) {
      const t = k / steps;
      const u = 1 - t;
      lineTo({
        x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
        y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y,
      });
    }
    reflect = { x: 2 * end.x - c2.x, y: 2 * end.y - c2.y };
  };
  while (index < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[index])) {
      command = tokens[index];
      index += 1;
    }
    switch (command) {
      case "M": {
        cursor = { x: next(), y: next() };
        subpathStart = cursor;
        command = "L"; // implicit lineto for repeated pairs, per the SVG spec
        break;
      }
      case "L":
        lineTo({ x: next(), y: next() });
        break;
      case "H":
        lineTo({ x: next(), y: cursor.y });
        break;
      case "V":
        lineTo({ x: cursor.x, y: next() });
        break;
      case "A": {
        const rx = next();
        next(); // ry (circular arcs only)
        next(); // x-axis rotation
        const large = next() === 1;
        const sweep = next() === 1;
        const end = { x: next(), y: next() };
        for (const point of arcSegments(cursor, end, rx, large, sweep)) lineTo(point);
        cursor = end;
        break;
      }
      case "C": {
        const c1 = { x: next(), y: next() };
        const c2 = { x: next(), y: next() };
        curveTo(c1, c2, { x: next(), y: next() });
        break;
      }
      case "S": {
        const c1 = reflect ?? cursor;
        const c2 = { x: next(), y: next() };
        curveTo(c1, c2, { x: next(), y: next() });
        break;
      }
      case "Z":
      case "z":
        segments.push({ a: cursor, b: subpathStart });
        cursor = subpathStart;
        command = "";
        break;
      default:
        throw new Error(`unsupported path command "${command}" in "${d}"`);
    }
  }
  return segments;
}

const boxOf = (points: Pt[]): Box => ({
  minX: Math.min(...points.map((p) => p.x)),
  minY: Math.min(...points.map((p) => p.y)),
  maxX: Math.max(...points.map((p) => p.x)),
  maxY: Math.max(...points.map((p) => p.y)),
});

const boxOfSegments = (segments: Seg[]): Box =>
  boxOf(segments.flatMap((s) => [s.a, s.b]));

const union = (a: Box, b: Box): Box => ({
  minX: Math.min(a.minX, b.minX),
  minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX),
  maxY: Math.max(a.maxY, b.maxY),
});

/** Every drawn element of a symbol, flattened. */
function drawnElements(markup: string): Elem[] {
  const elements: Elem[] = [];
  for (const tag of elementTags(markup, "line")) {
    const a = { x: numAttr(tag, "x1"), y: numAttr(tag, "y1") };
    const b = { x: numAttr(tag, "x2"), y: numAttr(tag, "y2") };
    elements.push({ tag, segments: [{ a, b }], box: boxOf([a, b]) });
  }
  for (const tag of elementTags(markup, "path")) {
    const d = attr(tag, "d");
    expect(d, `path without d: ${tag}`).toBeTruthy();
    const segments = pathSegments(d ?? "");
    elements.push({ tag, segments, box: boxOfSegments(segments) });
  }
  for (const tag of elementTags(markup, "circle")) {
    const cx = numAttr(tag, "cx");
    const cy = numAttr(tag, "cy");
    const r = numAttr(tag, "r");
    const points: Pt[] = [];
    for (let k = 0; k <= 64; k += 1) {
      const angle = (Math.PI * 2 * k) / 64;
      points.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
    }
    const segments = points.slice(1).map((p, k) => ({ a: points[k], b: p }));
    // The polygon under-reports the extremes; the circle's own box is exact.
    elements.push({
      tag,
      segments,
      box: { minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r },
    });
  }
  for (const tag of elementTags(markup, "rect")) {
    const x = numAttr(tag, "x");
    const y = numAttr(tag, "y");
    const w = numAttr(tag, "width");
    const h = numAttr(tag, "height");
    const corners = [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
    elements.push({
      tag,
      segments: corners.map((c, k) => ({ a: c, b: corners[(k + 1) % 4] })),
      box: boxOf(corners),
    });
  }
  expect(elements.length, "symbol draws nothing").toBeGreaterThan(0);
  return elements;
}

// ── distance helpers ───────────────────────────────────────────────────────

const samePoint = (a: Pt, b: Pt): boolean =>
  Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

function pointToSegment(p: Pt, s: Seg): number {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / len2));
  return Math.hypot(p.x - (s.a.x + t * dx), p.y - (s.a.y + t * dy));
}

const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function segmentsCross(p: Seg, q: Seg): boolean {
  const d1 = cross(p.a, p.b, q.a);
  const d2 = cross(p.a, p.b, q.b);
  const d3 = cross(q.a, q.b, p.a);
  const d4 = cross(q.a, q.b, p.b);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** Centreline-to-centreline distance between two stroked segments. */
function segmentDistance(p: Seg, q: Seg): number {
  if (segmentsCross(p, q)) return 0;
  return Math.min(
    pointToSegment(p.a, q),
    pointToSegment(p.b, q),
    pointToSegment(q.a, p),
    pointToSegment(q.b, p),
  );
}

const minDistanceToSegments = (p: Pt, segments: Seg[]): number =>
  segments.reduce((best, s) => Math.min(best, pointToSegment(p, s)), Infinity);

/** A lead is any element with an endpoint sitting exactly on a pin. */
const isLead = (element: Elem, pins: LocalPin[]): boolean =>
  element.segments.some((s) => pins.some((pin) => samePoint(s.a, pin) || samePoint(s.b, pin)));

// ── item 3: amplifier polarity glyphs must clear the body ──────────────────

describe("amplifier polarity glyphs (item 3)", () => {
  const AMPLIFIERS = ["opamp", "comparator"] as const;

  const glyphPaths = (markup: string): Map<string, Seg[]> => {
    const out = new Map<string, Seg[]>();
    for (const tag of elementTags(markup, "path")) {
      const name = attr(tag, "data-amp-glyph");
      if (name === undefined) continue;
      out.set(name, pathSegments(attr(tag, "d") ?? ""));
    }
    return out;
  };

  const bodyPath = (markup: string): Seg[] => {
    const tag = elementTags(markup, "path").find((t) => attr(t, "data-amp-body") !== undefined);
    expect(tag, "no data-amp-body triangle").toBeTruthy();
    return pathSegments(attr(tag ?? "", "d") ?? "");
  };

  it.each(AMPLIFIERS)(
    "%s keeps every interior glyph a full selected stroke clear of the body edge",
    (kind) => {
      const markup = render(kind);
      const body = bodyPath(markup);
      const glyphs = glyphPaths(markup);
      expect([...glyphs.keys()].sort()).toContain("+");
      expect([...glyphs.keys()].sort()).toContain("-");

      for (const [name, segments] of glyphs) {
        let closest = Infinity;
        for (const glyphSeg of segments) {
          for (const bodySeg of body) {
            closest = Math.min(closest, segmentDistance(glyphSeg, bodySeg));
          }
        }
        // Both strokes are painted SELECTED_STROKE wide and round-capped, so
        // each consumes half a stroke either side of its centreline. Requiring
        // two full stroke widths of centreline separation therefore leaves at
        // least one whole selected-stroke width of visible gap.
        //
        // The pre-fix ±26 triangle put the "+" 1.935 units from the hypotenuse,
        // i.e. already overlapping once painted; this assertion is what fails
        // if that triangle comes back.
        expect(closest, `${kind} "${name}" glyph clearance`).toBeGreaterThan(
          SELECTED_STROKE * 2,
        );
      }
    },
  );

  it.each(AMPLIFIERS)("%s keeps + and − on their own input pin rows", (kind) => {
    const markup = render(kind);
    const pins = getLocalPins(kind);
    const plusRow = pins.find((p) => p.id === "in+")?.y;
    const minusRow = pins.find((p) => p.id === "in-")?.y;
    const rowOf = (name: string) => {
      const tag = elementTags(markup, "path").find((t) => attr(t, "data-amp-glyph") === name);
      const box = boxOfSegments(pathSegments(attr(tag ?? "", "d") ?? ""));
      return (box.minY + box.maxY) / 2;
    };
    expect(rowOf("+")).toBe(plusRow);
    expect(rowOf("-")).toBe(minusRow);
  });
});

// ── item 3: the parts whose glyph had drifted off its own body ─────────────

describe("passive redraws (item 3)", () => {
  it("lands the potentiometer wiper arrow on the resistance track", () => {
    const markup = render("potentiometer");
    const track = elementTags(markup, "path").find((t) => attr(t, "data-track") !== undefined);
    const wiper = elementTags(markup, "path").find((t) => attr(t, "data-wiper") !== undefined);
    expect(track, "no data-track").toBeTruthy();
    expect(wiper, "no data-wiper").toBeTruthy();
    // The wiper must read as adjustable, which means a solid arrow: an open
    // chevron renders as two stray strokes (see .symbol-arrow in App.css).
    expect(wiper).toContain('class="symbol-arrow"');

    const trackSegments = pathSegments(attr(track ?? "", "d") ?? "");
    const wiperSegments = pathSegments(attr(wiper ?? "", "d") ?? "");
    let closest = Infinity;
    for (const w of wiperSegments) {
      for (const t of trackSegments) closest = Math.min(closest, segmentDistance(w, t));
    }
    // The arrow tip used to float 8 units above the track, so the part read as
    // a fixed resistor with an unrelated chevron over it.
    expect(closest, "wiper arrow to track").toBeLessThanOrEqual(0.775);
  });

  it("slides the potentiometer wiper arrow to where Wiper= says the tap is", () => {
    // Item 6: the wiper is a live control the reader drags in simulator mode.
    // A fixed arrow would make a working control look inert.
    const arrowX = (value?: string) => {
      const markup = renderWith("potentiometer", value);
      const wiper = elementTags(markup, "path").find((t) => attr(t, "data-wiper") !== undefined);
      const box = boxOfSegments(pathSegments(attr(wiper ?? "", "d") ?? ""));
      return (box.minX + box.maxX) / 2;
    };
    // A centred wiper draws exactly where it always did, so every schematic
    // saved before the control existed looks identical.
    expect(arrowX(undefined)).toBeCloseTo(0, 6);
    expect(arrowX("10k")).toBeCloseTo(0, 6);
    expect(arrowX("10k Wiper=0.5")).toBeCloseTo(0, 6);

    const left = arrowX("10k Wiper=0");
    const right = arrowX("10k Wiper=1");
    expect(left).toBeLessThan(-15);
    expect(right).toBeGreaterThan(15);
    // Monotone, and pin A (x = -32) is the 0 end - the same end the netlist
    // measures the fraction from.
    expect(arrowX("10k Wiper=0.25")).toBeGreaterThan(left);
    expect(arrowX("10k Wiper=0.25")).toBeLessThan(0);
    expect(arrowX("10k Wiper=0.75")).toBeGreaterThan(0);
    expect(arrowX("10k Wiper=0.75")).toBeLessThan(right);
    // Out-of-range text cannot throw the arrow off the part.
    expect(arrowX("10k Wiper=9")).toBeCloseTo(0, 6);
  });

  it("keeps the potentiometer inside its declared body at every wiper position", () => {
    // SYMBOL_BODY is kind-only, so it has to cover the whole travel or
    // hit-testing and label clearance quietly stop matching the drawing.
    const declared = SYMBOL_BODY.potentiometer;
    const pins = getLocalPins("potentiometer");
    for (const wiper of [0, 0.13, 0.25, 0.5, 0.62, 0.75, 1]) {
      const elements = drawnElements(renderWith("potentiometer", `10k Wiper=${wiper}`));
      const drawn = elements.filter((e) => !isLead(e, pins)).map((e) => e.box).reduce(union);
      expect(declared.minX, `wiper ${wiper} minX`).toBeLessThanOrEqual(drawn.minX + 0.05);
      expect(declared.maxX, `wiper ${wiper} maxX`).toBeGreaterThanOrEqual(drawn.maxX - 0.05);
      expect(declared.minY, `wiper ${wiper} minY`).toBeLessThanOrEqual(drawn.minY + 0.05);
      expect(declared.maxY, `wiper ${wiper} maxY`).toBeGreaterThanOrEqual(drawn.maxY - 0.05);
    }
  });

  it("anchors the bulb filament to the glass envelope", () => {
    const markup = render("bulb");
    const glass = elementTags(markup, "circle")[0];
    expect(glass, "no glass envelope").toBeTruthy();
    const r = numAttr(glass ?? "", "r");
    const centre = { x: numAttr(glass ?? "", "cx"), y: numAttr(glass ?? "", "cy") };
    const filament = elementTags(markup, "path").flatMap((tag) =>
      pathSegments(attr(tag, "d") ?? ""),
    );
    expect(filament.length, "no filament").toBeGreaterThan(0);
    // A filament is struck between two points on the glass. The old symbol was
    // a free-floating squiggle barely half the glass wide, which is why it read
    // as the motor's circle-plus-M rather than as a lamp.
    for (const segment of filament) {
      for (const end of [segment.a, segment.b]) {
        expect(
          Math.abs(Math.hypot(end.x - centre.x, end.y - centre.y) - r),
          `filament end (${end.x}, ${end.y}) is not on the glass`,
        ).toBeLessThanOrEqual(0.5);
      }
    }
  });

  // The mirror image of the bulb's rule. The lamp's filament must touch the
  // glass; the motor's letter must not. Held together, the two symbols cannot
  // drift back into looking like each other.
  describe("the motor is a circled M", () => {
    const motorGlyph = (): Seg[] => {
      const tag = elementTags(render("motor"), "path")
        .find((candidate) => attr(candidate, "data-motor-glyph") === "M");
      expect(tag, "no motor glyph").toBeTruthy();
      return pathSegments(attr(tag ?? "", "d") ?? "");
    };
    const glyphPoints = (): Pt[] => motorGlyph().flatMap((s) => [s.a, s.b]);

    it("draws a glyph that is its own mirror image", () => {
      // This is what makes it a letter rather than a squiggle. The old glyph
      // failed it: apex at x = -2, one vertical leg and one diagonal one.
      const key = (s: Seg) =>
        [s.a, s.b].map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`).sort().join("|");
      const segments = motorGlyph();
      const mirrored = segments.map((s) => ({
        a: { x: -s.a.x, y: s.a.y },
        b: { x: -s.b.x, y: s.b.y },
      }));
      expect(new Set(mirrored.map(key))).toEqual(new Set(segments.map(key)));
    });

    it("centres the M on the glass in both axes", () => {
      const glass = elementTags(render("motor"), "circle")[0];
      expect(numAttr(glass ?? "", "cx")).toBe(0);
      expect(numAttr(glass ?? "", "cy")).toBe(0);
      const box = boxOfSegments(motorGlyph());
      expect(box.minX).toBeCloseTo(-box.maxX, 9);
      expect(box.minY).toBeCloseTo(-box.maxY, 9);
    });

    it("is a five-point M: two full-height uprights and an apex on the axis", () => {
      const points = glyphPoints();
      const xs = [...new Set(points.map((p) => p.x))].sort((a, b) => a - b);
      expect(xs, "an M has a left leg, an axial apex and a right leg").toHaveLength(3);
      expect(xs[1], "the apex is off the circle's axis").toBe(0);
      const box = boxOfSegments(motorGlyph());
      for (const x of [xs[0], xs[2]]) {
        const ys = points.filter((p) => p.x === x).map((p) => p.y);
        expect(Math.min(...ys), `upright at x = ${x} is short at the top`).toBeCloseTo(box.minY, 9);
        expect(Math.max(...ys), `upright at x = ${x} is short at the bottom`).toBeCloseTo(box.maxY, 9);
      }
    });

    it("keeps the M clear of the glass by a whole selected stroke", () => {
      const glass = elementTags(render("motor"), "circle")[0];
      const r = numAttr(glass ?? "", "r");
      for (const point of glyphPoints()) {
        const paintedGap = (r - SELECTED_STROKE / 2) - (Math.hypot(point.x, point.y) + SELECTED_STROKE / 2);
        expect(paintedGap, `(${point.x}, ${point.y}) crowds the glass`)
          .toBeGreaterThanOrEqual(SELECTED_STROKE);
      }
    });
  });
});

// ── item 4: the four controlled sources must be tellable apart ─────────────

describe("controlled sources are distinguishable (item 4)", () => {
  it("renders four different drawings", () => {
    const markup = new Map(CONTROLLED_SOURCES.map((kind) => [kind, render(kind)] as const));
    for (const a of CONTROLLED_SOURCES) {
      for (const b of CONTROLLED_SOURCES) {
        if (a === b) continue;
        expect(markup.get(a), `${a} vs ${b}`).not.toBe(markup.get(b));
      }
    }
    // All four used to be byte-identical apart from a few units of glyph
    // offset, so also assert the *reason* they differ: the control port says
    // what is sensed and the output diamond says what is driven.
    const expected = {
      vcvs: { control: "voltage", output: "voltage" },
      vccs: { control: "voltage", output: "current" },
      cccs: { control: "current", output: "current" },
      ccvs: { control: "current", output: "voltage" },
    } as const;
    for (const kind of CONTROLLED_SOURCES) {
      const svg = markup.get(kind) ?? "";
      expect(svg, `${kind} control port`).toContain(
        `data-control-port="${expected[kind].control}"`,
      );
      expect(svg, `${kind} source output`).toContain(
        `data-source-output="${expected[kind].output}"`,
      );
      expect(svg, `${kind} diamond`).toContain("data-source-diamond");
    }
  });

  it("draws the voltage-controlled port open and the current-controlled port closed", () => {
    // Voltage sensing draws no current: the two control terminals must not be
    // joined. Current sensing must be a continuous branch from cp to cn.
    for (const kind of CONTROLLED_SOURCES) {
      const markup = render(kind);
      const pins = getLocalPins(kind);
      const cp = pins.find((p) => p.id === "cp")!;
      const cn = pins.find((p) => p.id === "cn")!;
      const conducts = reachable(drawnElements(markup).flatMap((e) => e.segments), cp, cn);
      const voltageControlled = kind === "vcvs" || kind === "vccs";
      expect(conducts, `${kind} control port continuity`).toBe(!voltageControlled);
    }
  });
});

/** True when two points are joined by a chain of drawn segments (endpoint
 *  connectivity — enough to tell an open control pair from a sense branch). */
function reachable(segments: Seg[], from: Pt, to: Pt): boolean {
  const key = (p: Pt) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
  const graph = new Map<string, string[]>();
  const link = (a: Pt, b: Pt) => {
    const ka = key(a);
    const kb = key(b);
    graph.set(ka, [...(graph.get(ka) ?? []), kb]);
    graph.set(kb, [...(graph.get(kb) ?? []), ka]);
  };
  for (const s of segments) link(s.a, s.b);
  const seen = new Set<string>([key(from)]);
  const stack = [key(from)];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === key(to)) return true;
    for (const nextNode of graph.get(node) ?? []) {
      if (seen.has(nextNode)) continue;
      seen.add(nextNode);
      stack.push(nextNode);
    }
  }
  return false;
}

// ── SYMBOL_BODY / SYMBOL_BOX must describe what is actually drawn ──────────

describe("declared metrics match the drawing", () => {
  it.each(REDRAWN_KINDS)("%s: SYMBOL_BODY covers the drawn body with no drift", (kind) => {
    const pins = getLocalPins(kind);
    const elements = drawnElements(render(kind));
    const bodyParts = elements.filter((element) => !isLead(element, pins));
    expect(bodyParts.length, `${kind} draws no body`).toBeGreaterThan(0);
    const drawn = bodyParts.map((e) => e.box).reduce(union);
    const declared = SYMBOL_BODY[kind];

    const tolerance = 0.05;
    expect(declared.minX, `${kind} minX`).toBeLessThanOrEqual(drawn.minX + tolerance);
    expect(declared.minY, `${kind} minY`).toBeLessThanOrEqual(drawn.minY + tolerance);
    expect(declared.maxX, `${kind} maxX`).toBeGreaterThanOrEqual(drawn.maxX - tolerance);
    expect(declared.maxY, `${kind} maxY`).toBeGreaterThanOrEqual(drawn.maxY - tolerance);

    // …and no slack either: an over-declared body is the drift that made the
    // controlled sources claim ±18 × ±22 while drawing ±14 × ±20.
    const slack = 1.5;
    expect(drawn.minX - declared.minX, `${kind} minX slack`).toBeLessThanOrEqual(slack);
    expect(drawn.minY - declared.minY, `${kind} minY slack`).toBeLessThanOrEqual(slack);
    expect(declared.maxX - drawn.maxX, `${kind} maxX slack`).toBeLessThanOrEqual(slack);
    expect(declared.maxY - drawn.maxY, `${kind} maxY slack`).toBeLessThanOrEqual(slack);
  });

  it.each(REDRAWN_KINDS)("%s: SYMBOL_BOX contains SYMBOL_BODY", (kind) => {
    const body = SYMBOL_BODY[kind];
    const box = SYMBOL_BOX[kind];
    expect(box.halfW, `${kind} halfW`).toBeGreaterThanOrEqual(Math.max(-body.minX, body.maxX));
    expect(box.halfH, `${kind} halfH`).toBeGreaterThanOrEqual(Math.max(-body.minY, body.maxY));
  });
});

// ── every lead has to reach both ends ──────────────────────────────────────

describe("leads connect pins to the body", () => {
  it.each(REDRAWN_KINDS)("%s: every pin is the endpoint of a drawn lead", (kind) => {
    const pins = getLocalPins(kind);
    const elements = drawnElements(render(kind));
    for (const pin of pins) {
      const touched = elements.some((element) =>
        element.segments.some((s) => samePoint(s.a, pin) || samePoint(s.b, pin)),
      );
      expect(touched, `${kind} pin ${pin.id} has no lead`).toBe(true);
    }
  });

  it.each(REDRAWN_KINDS)("%s: no lead stops short of the body", (kind) => {
    const pins = getLocalPins(kind);
    const elements = drawnElements(render(kind));
    const bodySegments = elements
      .filter((element) => !isLead(element, pins))
      .flatMap((element) => element.segments);
    for (const element of elements) {
      if (!isLead(element, pins)) continue;
      for (const segment of element.segments) {
        for (const end of [segment.a, segment.b]) {
          if (pins.some((pin) => samePoint(end, pin))) continue;
          // The transformer's p2/s2 leads used to die ~6.3 units from the coil
          // and the CT tap 4 units off the winding junction; half a stroke is
          // the most a lead end may miss the body by.
          expect(
            minDistanceToSegments(end, bodySegments),
            `${kind} lead end (${end.x}, ${end.y}) floats free`,
          ).toBeLessThanOrEqual(0.775);
        }
      }
    }
  });

  it.each(REDRAWN_KINDS)("%s: nothing is drawn outside the preview viewBox", (kind) => {
    const drawn = drawnElements(render(kind))
      .map((element) => element.box)
      .reduce(union);
    expect(drawn.minX, `${kind} left`).toBeGreaterThanOrEqual(-PREVIEW_HALF_W);
    expect(drawn.maxX, `${kind} right`).toBeLessThanOrEqual(PREVIEW_HALF_W);
    expect(drawn.minY, `${kind} top`).toBeGreaterThanOrEqual(-PREVIEW_HALF_H);
    expect(drawn.maxY, `${kind} bottom`).toBeLessThanOrEqual(PREVIEW_HALF_H);
  });
});

// ── item 9: the gate is drawn from its value, not from a hard-coded picture ──

/** The seven rows the Digital section of the palette places (paletteItems.ts). */
const GATE_PRESETS = ["and", "or", "not", "nand", "nor", "xor", "xnor"] as const;

/** Input leads: elements with one endpoint exactly on an `inN` pin. */
const inputLeadCount = (kind: ComponentKind, value: string): number => {
  const inputs = getLocalPins(kind, value).filter((pin) => pin.id.startsWith("in"));
  return drawnElements(renderWith(kind, value)).filter((element) =>
    element.segments.some((s) => inputs.some((pin) => samePoint(s.a, pin) || samePoint(s.b, pin))),
  ).length;
};

describe("logic gate input count (item 9)", () => {
  it("exposes exactly the inputs the value asks for", () => {
    for (let n = GATE_INPUTS_MIN; n <= GATE_INPUTS_MAX; n += 1) {
      const ids = getLocalPins("digitalGate", `and Inputs=${n}`).map((pin) => pin.id);
      expect(ids.filter((id) => id.startsWith("in")), `${n} inputs`).toEqual(
        Array.from({ length: n }, (_, index) => `in${index + 1}`),
      );
      // One output, whatever the input count. The complementary pin and the
      // com reference are LTspice's, not the function's, and only an imported
      // gate keeps them (see "one output" below).
      expect(ids.slice(n), `${n} tail`).toEqual(["q"]);
    }
  });

  it("draws one lead per input — three for a 3-input gate, five for a 5-input", () => {
    // The whole of item 9: the symbol used to draw five leads whatever the
    // gate was, so a 2-input AND arrived with three terminals in mid-air.
    expect(inputLeadCount("digitalGate", "and Inputs=3")).toBe(3);
    expect(inputLeadCount("digitalGate", "and Inputs=5")).toBe(5);
    expect(inputLeadCount("digitalGate", "and")).toBe(2);
    expect(inputLeadCount("digitalGate", "not")).toBe(1);
  });

  it("keeps every input row on the 16 grid, centred, at every count", () => {
    for (let n = 1; n <= GATE_INPUTS_MAX; n += 1) {
      const rows = gateInputRows(n);
      expect(rows, `${n} rows`).toHaveLength(n);
      for (const y of rows) expect(Math.abs(y % 16), `row ${y} off grid`).toBe(0);
      // Symmetric about the body centre (normalise -0, which is still 0).
      expect(rows.map((y) => -y + 0).reverse()).toEqual(rows.map((y) => y + 0));
    }
  });

  it("renders the seven palette gates as seven different drawings", () => {
    const markup = new Map(GATE_PRESETS.map((fn) => [fn, renderWith("digitalGate", fn)] as const));
    for (const a of GATE_PRESETS) {
      for (const b of GATE_PRESETS) {
        if (a === b) continue;
        expect(markup.get(a), `${a} vs ${b}`).not.toBe(markup.get(b));
      }
    }
    // …and assert WHY they differ, so a stray attribute cannot pass this.
    const back = (fn: string) => (markup.get(fn as never) ?? "").includes('data-gate-body="or"')
      || (markup.get(fn as never) ?? "").includes('data-gate-body="xor"');
    for (const fn of ["or", "nor", "xor", "xnor"]) expect(back(fn), `${fn} curved back`).toBe(true);
    for (const fn of ["and", "nand", "not"]) expect(back(fn), `${fn} flat back`).toBe(false);
    for (const fn of ["xor", "xnor"]) {
      expect(markup.get(fn as never), `${fn} second arc`).toContain("data-gate-xor-arc");
    }
    for (const fn of ["and", "or", "nand", "nor"]) {
      expect(markup.get(fn as never), `${fn} has no xor arc`).not.toContain("data-gate-xor-arc");
    }
    expect(markup.get("not"), "not buffer glyph").toContain('data-gate-glyph="buf"');
  });

  it("draws exactly one output lead on a placed gate, at every function", () => {
    // The reported defect: every gate drew TWO output leads, because the
    // symbol transcribed LTspice's A-device pin contract (q + the
    // complementary _Q) instead of the function's own terminals.
    for (const fn of [...GATE_PRESETS, "buf", "schmitt"]) {
      const value = fn as string;
      const output = getLocalPins("digitalGate", value).find((pin) => pin.id === "q");
      expect(output, `${value} has one output`).toEqual(
        expect.objectContaining({ id: "q", x: 32, y: 0 }),
      );
      const leads = drawnElements(renderWith("digitalGate", value)).filter((element) =>
        element.segments.some((s) => samePoint(s.a, output!) || samePoint(s.b, output!)),
      );
      expect(leads, `${value} output leads`).toHaveLength(1);
      // …and nothing is drawn on the row the complementary output used to
      // occupy, which is what made an AND read as a NAND.
      const oldRow = { x: 32, y: 16 };
      for (const element of drawnElements(renderWith("digitalGate", value))) {
        for (const segment of element.segments) {
          for (const end of [segment.a, segment.b]) {
            expect(samePoint(end, oldRow), `${value} still draws the qbar row`).toBe(false);
          }
        }
      }
    }
  });

  it("bubbles the output if and only if the function inverts", () => {
    // Inversion is a property of the FUNCTION, not of which pin a line drives.
    // The bubble used to mean "this is the complementary terminal", so a plain
    // AND rendered with a bubble on its lower output and read as a NAND.
    for (const fn of ["and", "or", "xor", "buf", "schmitt"]) {
      expect(renderWith("digitalGate", fn), `${fn} must not be bubbled`)
        .not.toContain("data-gate-invert");
    }
    for (const fn of ["nand", "nor", "xnor", "not"]) {
      expect(renderWith("digitalGate", fn), `${fn} must be bubbled`)
        .toContain('data-gate-invert="q"');
    }
  });

  it("puts the bubble on the output lead, tangent to the nose and clear of the pin", () => {
    // A bubble is only an inversion mark if it sits between the body and the
    // terminal. Drawn inside the body (as it was) it reads as decoration; drawn
    // past x = 32 it would overhang its own pin.
    for (const fn of ["nand", "nor", "xnor", "not"]) {
      const elements = drawnElements(renderWith("digitalGate", fn));
      const bubble = elements.find((element) => element.tag.startsWith("<circle"));
      expect(bubble, `${fn} bubble`).toBeTruthy();
      expect(bubble!.box.minX, `${fn} bubble left`).toBeCloseTo(24, 6);
      expect(bubble!.box.maxX, `${fn} bubble right`).toBeCloseTo(30, 6);
      expect((bubble!.box.minY + bubble!.box.maxY) / 2, `${fn} bubble row`).toBe(0);
      expect(bubble!.box.maxX, `${fn} bubble clears its pin`).toBeLessThan(32);
    }
  });

  it("draws no com stub on a placed gate", () => {
    // `com` is the behavioural model's voltage reference leaking through the
    // symbol; it read as a stray input hanging off the bottom edge. The deck
    // refers every comparison and every output to ground when it is absent, so
    // there is nothing left to wire.
    for (const fn of [...GATE_PRESETS, "buf", "schmitt", "and Inputs=5"]) {
      const value = fn as string;
      expect(getLocalPins("digitalGate", value).some((pin) => pin.id === "com"), value).toBe(false);
      // Nothing is drawn on the reference row at all - not the old (0,48), not
      // the body-following (-16,32) / (32,32) it passed through.
      for (const element of drawnElements(renderWith("digitalGate", value))) {
        for (const segment of element.segments) {
          for (const end of [segment.a, segment.b]) {
            expect(Math.abs(end.y), `${value} draws below the body`).toBeLessThanOrEqual(
              gateBodyHalfHeight(parseDigitalGate(value).inputs),
            );
          }
        }
      }
    }
  });

  it("keeps an imported gate's LTspice bank drawn: both outputs and com", () => {
    // Only the natively placed gate changed. A gate from an `.asy` carries that
    // file's real terminals in `pinOverride`, and Canvas draws a repair lead
    // from each NATIVE position out to them - so if the body stopped drawing
    // the pair and the reference, those leads would start in mid-air.
    for (const value of ["and Inputs=5", "inv", "schmitt", "xor Inputs=5"]) {
      const inputs = parseDigitalGate(value).inputs;
      const elements = drawnElements(renderWithImported("digitalGate", value));
      // The complementary PAIR at ±16, and the reference on the row the body
      // puts it. (`gateComPoint` follows the body, while the kind dictionary is
      // pinned at the five-input geometry; that older disagreement is the
      // importer's to settle and is deliberately untouched here.)
      const terminals = [
        { id: "q", x: 32, y: -16 },
        { id: "qbar", x: 32, y: 16 },
        { id: "com", ...gateComPoint(inputs) },
      ];
      for (const pin of terminals) {
        const touched = elements.some((element) =>
          element.segments.some((s) => samePoint(s.a, pin) || samePoint(s.b, pin)),
        );
        expect(touched, `imported "${value}" ${pin.id} has no lead`).toBe(true);
      }
      // LTspice's reading of the bubble survives on the import: the inverted
      // sense is on the complementary pin unless the value inverted q.
      expect(renderWithImported("digitalGate", value), `imported ${value}`)
        .toContain('data-gate-invert="qbar"');
    }
    // And a placed gate of the same value draws none of that.
    expect(renderWith("digitalGate", "and Inputs=5")).not.toContain("data-gate-invert");
  });

  it("terminates every lead on its pin and every lead end on the body", () => {
    for (const value of ["and", "or Inputs=3", "xnor Inputs=5", "not", "schmitt"]) {
      const pins = getLocalPins("digitalGate", value);
      const elements = drawnElements(renderWith("digitalGate", value));
      for (const pin of pins) {
        const touched = elements.some((element) =>
          element.segments.some((s) => samePoint(s.a, pin) || samePoint(s.b, pin)),
        );
        expect(touched, `"${value}" pin ${pin.id} has no lead`).toBe(true);
      }
      const bodySegments = elements
        .filter((element) => !isLead(element, pins))
        .flatMap((element) => element.segments);
      for (const element of elements) {
        if (!isLead(element, pins)) continue;
        for (const segment of element.segments) {
          for (const end of [segment.a, segment.b]) {
            if (pins.some((pin) => samePoint(end, pin))) continue;
            expect(
              minDistanceToSegments(end, bodySegments),
              `"${value}" lead end (${end.x}, ${end.y}) floats free`,
            ).toBeLessThanOrEqual(0.775);
          }
        }
      }
    }
  });

  it("declares a SYMBOL_BODY that covers the gate at every input count", () => {
    // One static box has to hold a drawing that grows, so it is declared at the
    // largest gate. Under-declaring it is what let the old `maxX: 28` sit while
    // the nose reached x = 40.
    const declared = SYMBOL_BODY.digitalGate;
    for (const value of ["buf", "and", "or Inputs=3", "xor Inputs=4", "xnor Inputs=5"]) {
      const pins = getLocalPins("digitalGate", value);
      const drawn = drawnElements(renderWith("digitalGate", value))
        .filter((element) => !isLead(element, pins))
        .map((element) => element.box)
        .reduce(union);
      expect(declared.minX, `${value} minX`).toBeLessThanOrEqual(drawn.minX + 0.05);
      expect(declared.minY, `${value} minY`).toBeLessThanOrEqual(drawn.minY + 0.05);
      expect(declared.maxX, `${value} maxX`).toBeGreaterThanOrEqual(drawn.maxX - 0.05);
      expect(declared.maxY, `${value} maxY`).toBeGreaterThanOrEqual(drawn.maxY - 0.05);
    }
    expect(SYMBOL_BOX.digitalGate.halfW).toBeGreaterThanOrEqual(
      Math.max(-declared.minX, declared.maxX),
    );
    expect(SYMBOL_BOX.digitalGate.halfH).toBeGreaterThanOrEqual(
      Math.max(-declared.minY, declared.maxY),
    );
  });
});

// ── item 5: the digital parts must be readable without a datasheet ─────────

const DIGITAL_KINDS: ComponentKind[] = [
  "digitalGate",
  "dflop",
  "srflop",
  "tflop",
  "jkflop",
  "counter",
  "timer555",
  "adc",
  "dac",
  "sevenSeg",
  "sampleHold",
  "modulator",
];

/** SF Mono at 7px (`.subckt-pin-label`) advances a shade over 0.6em per
 *  character - measured against the rendered 555, whose "RESET" spans about 22
 *  units. Combining marks (the overline in `Q̅`) add no width, so they are not
 *  counted. */
const LABEL_EM = 4.4;
const LABEL_HEIGHT = 7;
const glyphCount = (text: string): number => [...text].filter((c) => !/\p{M}/u.test(c)).length;

interface DrawnText {
  text: string;
  x: number;
  y: number;
  transform: string;
}

function drawnText(markup: string): DrawnText[] {
  const out: DrawnText[] = [];
  const pattern = /<text\b([^>]*)>([^<]*)<\/text>/g;
  let match = pattern.exec(markup);
  while (match !== null) {
    const attrs = match[1];
    const transform = /transform="([^"]*)"/.exec(attrs)?.[1] ?? "";
    const translate = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(transform);
    out.push({
      text: match[2],
      x: translate ? Number(translate[1]) : 0,
      y: translate ? Number(translate[2]) : 0,
      transform,
    });
    match = pattern.exec(markup);
  }
  return out;
}

const textBox = (label: DrawnText): Box => {
  const halfW = (glyphCount(label.text) * LABEL_EM) / 2;
  return {
    minX: label.x - halfW,
    maxX: label.x + halfW,
    minY: label.y - LABEL_HEIGHT / 2,
    maxY: label.y + LABEL_HEIGHT / 2,
  };
};

const overlaps = (a: Box, b: Box): boolean =>
  a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

// ── 2×3 affine matrices, so "upright" can be measured instead of eyeballed ──

type Mat = [number, number, number, number, number, number]; // a b c d e f
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];
const multiply = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const rotateMat = (deg: number): Mat => {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
};

/** Parse the transform list Tau's symbols emit (translate / rotate / scale). */
function parseTransform(value: string): Mat {
  let result = IDENTITY;
  const pattern = /(translate|rotate|scale)\(([^)]*)\)/g;
  let match = pattern.exec(value);
  while (match !== null) {
    const args = match[2].trim().split(/[\s,]+/).map(Number);
    const op: Mat = match[1] === "translate"
      ? [1, 0, 0, 1, args[0], args[1] ?? 0]
      : match[1] === "rotate"
        ? rotateMat(args[0])
        : [args[0], 0, 0, args[1] ?? args[0], 0, 0];
    result = multiply(result, op);
    match = pattern.exec(value);
  }
  return result;
}

describe("digital parts carry a readable pinout (item 5)", () => {
  it.each(DIGITAL_KINDS)("%s: nothing is drawn outside the ±42 × ±40 preview", (kind) => {
    // sevenSeg reached y = 56, the flip-flops ±48 and every `com` 48, so the
    // palette and the inspector cut the bottom off half the digital section.
    const drawn = drawnElements(render(kind)).map((element) => element.box).reduce(union);
    const boxes = [drawn, ...drawnText(render(kind)).map(textBox)];
    for (const box of boxes) {
      expect(box.minX, `${kind} left`).toBeGreaterThanOrEqual(-PREVIEW_HALF_W);
      expect(box.maxX, `${kind} right`).toBeLessThanOrEqual(PREVIEW_HALF_W);
      expect(box.minY, `${kind} top`).toBeGreaterThanOrEqual(-PREVIEW_HALF_H);
      expect(box.maxY, `${kind} bottom`).toBeLessThanOrEqual(PREVIEW_HALF_H);
    }
  });

  it("fits a configured gate in the preview too, at every input count", () => {
    for (let n = GATE_INPUTS_MIN; n <= GATE_INPUTS_MAX; n += 1) {
      const drawn = drawnElements(renderWith("digitalGate", `and Inputs=${n}`))
        .map((element) => element.box)
        .reduce(union);
      expect(drawn.minX, `${n} left`).toBeGreaterThanOrEqual(-PREVIEW_HALF_W);
      expect(drawn.maxX, `${n} right`).toBeLessThanOrEqual(PREVIEW_HALF_W);
      expect(drawn.minY, `${n} top`).toBeGreaterThanOrEqual(-PREVIEW_HALF_H);
      expect(drawn.maxY, `${n} bottom`).toBeLessThanOrEqual(PREVIEW_HALF_H);
    }
  });

  it("names every pin of every labelled part, spelled as the pin itself is", () => {
    for (const [kind, layout] of Object.entries(PIN_LABEL_LAYOUT)) {
      const pins = getLocalPins(kind as ComponentKind);
      expect(
        layout.map((label) => label.pin).sort(),
        `${kind} labels every pin`,
      ).toEqual(pins.map((pin) => pin.id).sort());
      for (const label of layout) {
        const pin = pins.find((candidate) => candidate.id === label.pin);
        expect(label.text, `${kind}.${label.pin} caption`).toBe(pin?.label);
      }
    }
  });

  it("labels the 555 with the roles the datasheet uses", () => {
    const markup = render("timer555");
    for (const role of ["TRIG", "OUT", "RESET", "CTRL", "THRES", "DISCH", "VCC", "GND"]) {
      expect(markup, `555 ${role}`).toContain(`data-pin-label="${role}"`);
    }
    // The part caption survives, and rides the same counter-rotation now.
    expect(markup).toContain('data-pin-label="555"');
  });

  it("keeps every caption inside the body it annotates", () => {
    for (const kind of Object.keys(PIN_LABEL_LAYOUT) as ComponentKind[]) {
      const body = SYMBOL_BODY[kind];
      for (const label of drawnText(render(kind))) {
        const box = textBox(label);
        expect(box.minX, `${kind} "${label.text}" left`).toBeGreaterThanOrEqual(body.minX);
        expect(box.maxX, `${kind} "${label.text}" right`).toBeLessThanOrEqual(body.maxX);
        expect(box.minY, `${kind} "${label.text}" top`).toBeGreaterThanOrEqual(body.minY);
        expect(box.maxY, `${kind} "${label.text}" bottom`).toBeLessThanOrEqual(body.maxY);
      }
    }
  });

  it("never overlaps one caption with another", () => {
    for (const kind of Object.keys(PIN_LABEL_LAYOUT) as ComponentKind[]) {
      const labels = drawnText(render(kind));
      for (let i = 0; i < labels.length; i += 1) {
        for (let j = i + 1; j < labels.length; j += 1) {
          expect(
            overlaps(textBox(labels[i]), textBox(labels[j])),
            `${kind}: "${labels[i].text}" overlaps "${labels[j].text}"`,
          ).toBe(false);
        }
      }
    }
  });

  it("never draws pin text upside-down or mirrored, at any of the four rotations", () => {
    // A <text> inside a symbol inherits the wrapper's `rotate(R) scale(-1 1)`.
    // Nothing corrected it, so the 555's caption read BACKWARDS when the part
    // was flipped and UPSIDE-DOWN at 180°. Compose the wrapper with the
    // caption's own transform and require the product to be a pure rotation of
    // 0° or 90°: readable head-on or side-on, never inverted, never mirrored.
    //
    // (Undoing the rotation entirely instead was measured and rejected: at 90°
    // the 555's five left captions land on one line 16 apart while "RESET" is
    // 21 wide. Turning with the body keeps each caption in its own lane.)
    for (const kind of [...Object.keys(PIN_LABEL_LAYOUT), ...Object.keys(PART_CAPTIONS)] as ComponentKind[]) {
      for (const rotation of ROTATIONS) {
        for (const mirrored of [false, true]) {
          const labels = drawnText(renderWith(kind, undefined, rotation, mirrored));
          expect(labels.length, `${kind} draws captions`).toBeGreaterThan(0);
          const wrapper = mirrored
            ? multiply(rotateMat(rotation), [-1, 0, 0, 1, 0, 0])
            : rotateMat(rotation);
          for (const label of labels) {
            const composed = multiply(wrapper, parseTransform(label.transform));
            const where = `${kind} "${label.text}" at ${rotation}°${mirrored ? " mirrored" : ""}`;
            // determinant +1 ⇒ the glyphs are not flipped.
            expect(composed[0] * composed[3] - composed[1] * composed[2], `${where} mirrored`)
              .toBeCloseTo(1, 9);
            const angle = Math.round((Math.atan2(composed[1], composed[0]) * 180) / Math.PI);
            expect([0, 90], `${where} reads at ${angle}°`).toContain(angle);
          }
        }
      }
    }
  });

  it("draws every caption exactly horizontally at 0° and at 180°", () => {
    // The half-turn is the whole of the old "555" bug: at 180° the body is
    // upside-down and the caption must not be.
    for (const rotation of [0, 180] as Rotation[]) {
      for (const label of drawnText(renderWith("timer555", undefined, rotation))) {
        const composed = multiply(rotateMat(rotation), parseTransform(label.transform));
        for (const [index, expected] of [1, 0, 0, 1].entries()) {
          expect(composed[index], `"${label.text}" at ${rotation}°`).toBeCloseTo(expected, 9);
        }
      }
    }
  });

  it("lands each caption on the point it annotates, whatever the orientation", () => {
    // Counter-rotating is only half of it: the caption also has to end up
    // where the pin ended up, or it names the wrong terminal.
    const kind: ComponentKind = "timer555";
    const layout = PIN_LABEL_LAYOUT[kind] ?? [];
    for (const rotation of ROTATIONS) {
      const wrapper = rotateMat(rotation);
      const labels = new Map(drawnText(renderWith(kind, undefined, rotation)).map((l) => [l.text, l]));
      for (const spec of layout) {
        const composed = multiply(wrapper, parseTransform(labels.get(spec.text)?.transform ?? ""));
        const expected = multiply(wrapper, [1, 0, 0, 1, spec.x, spec.y]);
        expect(composed[4], `${spec.pin} x at ${rotation}°`).toBeCloseTo(expected[4], 6);
        expect(composed[5], `${spec.pin} y at ${rotation}°`).toBeCloseTo(expected[5], 6);
      }
    }
  });

  it.each(DIGITAL_KINDS)("%s: every pin is the endpoint of a drawn lead", (kind) => {
    const value = kind === "digitalGate" ? "and" : undefined;
    const pins = getLocalPins(kind, value);
    const elements = drawnElements(renderWith(kind, value));
    for (const pin of pins) {
      const touched = elements.some((element) =>
        element.segments.some((s) => samePoint(s.a, pin) || samePoint(s.b, pin)),
      );
      expect(touched, `${kind} pin ${pin.id} has no lead`).toBe(true);
    }
  });

  it("draws no degenerate zero-length element", () => {
    // sevenSeg carried `<line x1=32 y1=-24 x2=32 y2=-24 />`, which paints
    // nothing and hides a pin that looks connected in the source.
    for (const kind of DIGITAL_KINDS) {
      for (const element of drawnElements(render(kind))) {
        const box = element.box;
        expect(
          box.maxX - box.minX + (box.maxY - box.minY),
          `${kind} degenerate element ${element.tag}`,
        ).toBeGreaterThan(0);
      }
    }
  });
});

// ── item 6: an operated contact has to be seen to move ─────────────────────

describe("contacts draw their state (item 6)", () => {
  const conducts = (kind: ComponentKind, value: string, from: string, to: string): boolean => {
    const pins = getLocalPins(kind);
    const segments = drawnElements(renderWith(kind, value)).flatMap((element) => element.segments);
    return reachable(segments, pins.find((p) => p.id === from)!, pins.find((p) => p.id === to)!);
  };

  it("draws a switch closed only when its value says it is closed", () => {
    expect(conducts("switch", "closed", "a", "b")).toBe(true);
    expect(conducts("switch", "open", "a", "b")).toBe(false);
    // The spellings the solver already accepts (kindGroups.isStaticContactClosed)
    // must move the blade too, or a hand-typed value draws the wrong circuit.
    for (const closed of ["closed", "CLOSED", "on", "1", "pressed"]) {
      expect(conducts("switch", closed, "a", "b"), closed).toBe(true);
    }
    for (const open of ["", "open", "no", "0"]) {
      expect(conducts("switch", open, "a", "b"), `"${open}"`).toBe(false);
    }
  });

  it("drops the push button's plate onto its contacts when pressed", () => {
    expect(conducts("pushButton", "closed", "a", "b")).toBe(true);
    expect(conducts("pushButton", "open", "a", "b")).toBe(false);
    // The plate travels: the open and closed drawings are not the same picture
    // with a different attribute on it.
    expect(renderWith("pushButton", "open")).toContain('data-contact="open"');
    expect(renderWith("pushButton", "closed")).toContain('data-contact="closed"');
  });

  it("throws the SPDT blade to the pole its value selects", () => {
    expect(conducts("spdt", "no", "com", "no")).toBe(true);
    expect(conducts("spdt", "no", "com", "nc")).toBe(false);
    expect(conducts("spdt", "nc", "com", "nc")).toBe(true);
    expect(conducts("spdt", "nc", "com", "no")).toBe(false);
    // Catalog default is `no`, and a blank value must not float between poles.
    expect(conducts("spdt", "", "com", "no")).toBe(true);
  });

  it("pivots the moving part on the same fixed contacts either way", () => {
    for (const kind of ["switch", "pushButton", "spdt"] as const) {
      const open = drawnElements(renderWith(kind, kind === "spdt" ? "nc" : "open"));
      const closed = drawnElements(renderWith(kind, kind === "spdt" ? "no" : "closed"));
      const contacts = (elements: Elem[]) =>
        elements
          .filter((element) => element.tag.startsWith("<circle"))
          .map((element) => `${element.box.minX},${element.box.minY}`)
          .sort();
      expect(contacts(open), `${kind} contacts move`).toEqual(contacts(closed));
    }
  });
});
