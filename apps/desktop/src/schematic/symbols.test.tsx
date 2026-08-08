import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getLocalPins, type LocalPin } from "./pins";
import { ComponentSymbol, SYMBOL_BODY, SYMBOL_BOX } from "./symbols";
import type { ComponentKind } from "./types";

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

/** Kinds redrawn by items 3 and 4. */
const REDRAWN_KINDS: ComponentKind[] = [
  "bulb",
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
