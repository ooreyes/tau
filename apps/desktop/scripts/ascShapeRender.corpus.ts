// Real-corpus proof that every LTspice drawing primitive Tau preserves also
// resolves into something the canvas can actually draw.
//
// The round-trip proof beside this one (ascShapeRoundTrip.corpus.ts) shows the
// records survive a save byte-for-byte; it says nothing about whether they can
// be rendered, and for a long time they were not drawn at all. The hazard is
// specific and it is all over the real corpus: LTspice stores a box as two
// opposite corners in whatever order the author dragged them, so roughly half
// of the real records have the second corner above and/or left of the first.
// Handing `x2 - x1` to an SVG `<rect>` or `<ellipse>` as a width or a radius is
// then negative, and the element silently draws nothing - the exact shape of
// bug that leaves artwork invisible with no error anywhere.
//
// So this walks the user's own files and asserts the stronger property on every
// record: it resolves, every number is finite, and no extent is negative.
//
// Runs under vitest.corpus.config.ts only (needs the local corpus); skips on a
// machine without one. No ngspice required.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { describe, it, expect } from "vitest";
import { parseAsc, ascToSchematic, decodeSchematicText } from "../src/io/ascImport";
import {
  ascShapeRender,
  ascShapeBounds,
  ascArcPath,
  circuitBounds,
  type AscShapeRender,
} from "../src/components/Canvas.geometry";

const CORPUS_ROOT = join(homedir(), "Documents", "LTspice");
/** Bounded defensively; the corpus holds ~69 shape-bearing files today. */
const MAX_FILES = 500;

/** Cheap pre-filter over raw bytes before the real (encoding-aware) decode. */
const SHAPE_TAG_LINE = /^(LINE|RECTANGLE|CIRCLE|ARC)\s/im;

function findShapeSchematics(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || found.length >= MAX_FILES) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory - not this spec's concern
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (found.length >= MAX_FILES) return;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs, depth + 1);
      else if (entry.name.toLowerCase().endsWith(".asc")) {
        try {
          if (SHAPE_TAG_LINE.test(readFileSync(abs, "latin1"))) found.push(abs);
        } catch {
          // unreadable file - skip
        }
      }
    }
  };
  walk(root, 0);
  return found;
}

const files = existsSync(CORPUS_ROOT) ? findShapeSchematics(CORPUS_ROOT) : [];

describe.skipIf(files.length === 0)("drawing primitives render on the real corpus", () => {
  it("resolves every preserved record into finite, non-negative geometry", () => {
    let records = 0;
    let reversedBoxes = 0;
    const kinds = new Map<string, number>();

    for (const path of files) {
      const doc = parseAsc(decodeSchematicText(readFileSync(path)));
      for (const shape of doc.shapes) {
        records += 1;
        kinds.set(shape.kind, (kinds.get(shape.kind) ?? 0) + 1);
        const [x1, y1, x2, y2] = shape.coords;
        if (shape.kind !== "LINE" && (x2 < x1 || y2 < y1)) reversedBoxes += 1;

        const render = ascShapeRender(shape);
        const where = `${path}: ${shape.kind} ${shape.coords.join(" ")}`;
        expect(render, where).not.toBeNull();
        if (!render) continue;

        const numbers = Object.values(render).flatMap((value) =>
          typeof value === "number"
            ? [value]
            : value && typeof value === "object"
              ? Object.values(value as Record<string, number>)
              : [],
        );
        for (const value of numbers) expect(Number.isFinite(value), where).toBe(true);

        if (render.kind === "RECTANGLE") {
          // A negative extent is the failure this whole spec exists to catch.
          expect(render.width, where).toBeGreaterThanOrEqual(0);
          expect(render.height, where).toBeGreaterThanOrEqual(0);
          // The normalised box has to still cover the author's own corners.
          expect(render.x, where).toBe(Math.min(x1, x2));
          expect(render.x + render.width, where).toBe(Math.max(x1, x2));
          expect(render.y, where).toBe(Math.min(y1, y2));
          expect(render.y + render.height, where).toBe(Math.max(y1, y2));
        }
        if (render.kind === "CIRCLE") {
          expect(render.rx, where).toBeGreaterThanOrEqual(0);
          expect(render.ry, where).toBeGreaterThanOrEqual(0);
          expect(render.cx, where).toBe((x1 + x2) / 2);
          expect(render.cy, where).toBe((y1 + y2) / 2);
        }
        if (render.kind === "ARC") {
          // The record's rays are directions from the centre; the drawn ends
          // must sit on the ellipse itself.
          expect(
            Math.hypot(
              (render.start.x - render.cx) / render.rx,
              (render.start.y - render.cy) / render.ry,
            ),
            where,
          ).toBeCloseTo(1, 9);
          expect(ascArcPath(render), where).not.toContain("NaN");
        }
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `[asc-shape-render] ${records} records across ${files.length} files ` +
        `(${[...kinds].map(([kind, count]) => `${kind} ${count}`).join(", ")}); ` +
        `${reversedBoxes} boxes stored corner-reversed`,
    );
    expect(records).toBeGreaterThan(0);
    // If this ever drops to zero the corner-normalisation assertions above
    // stop proving anything, so the spec would be quietly vacuous.
    expect(reversedBoxes).toBeGreaterThan(0);
  });

  // Fit-to-view frames `circuitBounds`, so a box that does not cover the
  // artwork opens a real sheet with its border - or its whole drawing - off
  // screen, and a box that is loose zooms out past what is there. Sampling the
  // curve the canvas draws is the only way to check both at once: it walks an
  // arc through the emitted PATH's own sweep flag rather than repeating the
  // angle arithmetic `ascShapeBounds` uses to decide the same thing.
  const TAU = Math.PI * 2;
  const SAMPLES = 2000;

  const sampleDrawing = (render: AscShapeRender): { x: number; y: number }[] => {
    if (render.kind === "LINE") {
      return [{ x: render.x1, y: render.y1 }, { x: render.x2, y: render.y2 }];
    }
    if (render.kind === "RECTANGLE") {
      const right = render.x + render.width;
      const bottom = render.y + render.height;
      return [
        { x: render.x, y: render.y },
        { x: right, y: render.y },
        { x: right, y: bottom },
        { x: render.x, y: bottom },
      ];
    }
    const at = (angle: number) => ({
      x: render.cx + render.rx * Math.cos(angle),
      y: render.cy + render.ry * Math.sin(angle),
    });
    if (render.kind === "CIRCLE") {
      return Array.from({ length: SAMPLES }, (_, i) => at((i / SAMPLES) * TAU));
    }
    const flag = /A \S+ \S+ 0 [01] ([01])/.exec(ascArcPath(render));
    expect(flag, "arc path carries a sweep flag").not.toBeNull();
    // Sweep flag 1 travels in the direction of increasing angle; 0 the other
    // way. Both are SVG's rule, not Tau's.
    const direction = flag![1] === "1" ? 1 : -1;
    const angleOf = (point: { x: number; y: number }) =>
      Math.atan2((point.y - render.cy) / render.ry, (point.x - render.cx) / render.rx);
    const start = angleOf(render.start);
    const swept = ((direction * (angleOf(render.end) - start)) % TAU + TAU) % TAU;
    return Array.from({ length: SAMPLES + 1 }, (_, i) =>
      at(start + direction * swept * (i / SAMPLES)));
  };

  it("bounds every real record tightly around what the canvas draws", () => {
    let records = 0;
    let tightenedArcs = 0;

    for (const path of files) {
      for (const shape of parseAsc(decodeSchematicText(readFileSync(path))).shapes) {
        const render = ascShapeRender(shape);
        const box = ascShapeBounds(shape);
        const where = `${path}: ${shape.kind} ${shape.coords.join(" ")}`;
        if (!render) {
          expect(box, where).toBeNull();
          continue;
        }
        expect(box, where).not.toBeNull();
        records += 1;
        const points = sampleDrawing(render);
        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);
        // Nothing drawn may fall outside the box - an off-screen border.
        expect(Math.min(...xs), `${where} minX`).toBeGreaterThanOrEqual(box!.minX - 1e-9);
        expect(Math.max(...xs), `${where} maxX`).toBeLessThanOrEqual(box!.maxX + 1e-9);
        expect(Math.min(...ys), `${where} minY`).toBeGreaterThanOrEqual(box!.minY - 1e-9);
        expect(Math.max(...ys), `${where} maxY`).toBeLessThanOrEqual(box!.maxY + 1e-9);
        // ...and no side may sit clear of it - a fit zoomed out past the sheet.
        expect(Math.min(...xs), `${where} minX slack`).toBeCloseTo(box!.minX, 3);
        expect(Math.max(...xs), `${where} maxX slack`).toBeCloseTo(box!.maxX, 3);
        expect(Math.min(...ys), `${where} minY slack`).toBeCloseTo(box!.minY, 3);
        expect(Math.max(...ys), `${where} maxY slack`).toBeCloseTo(box!.maxY, 3);

        if (render.kind === "ARC") {
          const ellipse = (render.rx * 2) * (render.ry * 2);
          const drawn = (box!.maxX - box!.minX) * (box!.maxY - box!.minY);
          if (drawn < ellipse - 1e-6) tightenedArcs += 1;
        }
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `[asc-shape-bounds] ${records} records bounded; ` +
        `${tightenedArcs} arcs reach less than their own ellipse box`,
    );
    expect(records).toBeGreaterThan(0);
    // If no real arc were a partial sweep, the swept-extreme arithmetic would
    // never be exercised and the tightness assertions above would be vacuous.
    expect(tightenedArcs).toBeGreaterThan(0);
  });

  it("frames artwork that reaches outside the circuit on real sheets", () => {
    let sheetsWithArtworkOutside = 0;
    let sheetsFramingNothingElse = 0;

    for (const path of files) {
      const imported = ascToSchematic(parseAsc(decodeSchematicText(readFileSync(path))));
      const circuit = circuitBounds(imported.components, imported.wires);
      const framed = circuitBounds(
        imported.components,
        imported.wires,
        undefined,
        imported.shapes,
      );
      if (!circuit) {
        // A sheet that is only artwork used to have no bounds at all, so
        // fit-to-view fell back to zoom 1 at the viewport origin.
        if (framed) sheetsFramingNothingElse += 1;
        continue;
      }
      expect(framed, path).not.toBeNull();
      // The circuit is never dropped by widening the box.
      expect(framed!.minX, path).toBeLessThanOrEqual(circuit.minX);
      expect(framed!.minY, path).toBeLessThanOrEqual(circuit.minY);
      expect(framed!.maxX, path).toBeGreaterThanOrEqual(circuit.maxX);
      expect(framed!.maxY, path).toBeGreaterThanOrEqual(circuit.maxY);
      const grew = framed!.minX < circuit.minX || framed!.minY < circuit.minY
        || framed!.maxX > circuit.maxX || framed!.maxY > circuit.maxY;
      if (grew) sheetsWithArtworkOutside += 1;
    }

    // eslint-disable-next-line no-console
    console.log(
      `[asc-shape-bounds] ${sheetsWithArtworkOutside} of ${files.length} shape-bearing files ` +
        `draw artwork outside the circuit's own frame; ` +
        `${sheetsFramingNothingElse} are artwork with no circuit to frame`,
    );
    // The whole point of the unit: on real files this is not a hypothetical.
    expect(sheetsWithArtworkOutside).toBeGreaterThan(0);
  });

  // Which way an arc sweeps is the one thing about these records that a wrong
  // guess renders plausibly rather than not at all - the complementary curve is
  // still an arc on the same ellipse. LTspice's `ind.asy` pins it in the unit
  // tests; this is the independent check, on a real schematic rather than a
  // symbol, and it is the only kind of file that can settle it.
  const cylinder = join(CORPUS_ROOT, "examples", "Applications", "LT3086.asc");

  it.skipIf(!existsSync(cylinder))("sweeps a real schematic's arcs the way its author drew them", () => {
    const arcs = parseAsc(decodeSchematicText(readFileSync(cylinder))).shapes
      .filter((shape) => shape.kind === "ARC")
      .map((shape) => ascShapeRender(shape));

    // The drawing is a cylinder lying on its side: two long horizontal rules
    // from x=928 to x=1316 capped by a full ellipse at the right-hand end, and
    // at the left-hand end these two arcs. One is solid and one is LTspice's
    // dotted pen, which is how a hidden edge is drawn - so the solid half-cap
    // has to bulge left, away from the body, and the dotted one right, into it.
    expect(arcs).toHaveLength(2);
    // Both are half-caps, so their chords run through the centre and
    // `largeArc` cannot distinguish the two candidate curves - the sweep flag
    // carries the whole decision. Read it back off the emitted path and walk
    // the arc by SVG's own rule for it, so this checks what ships rather than
    // repeating how it was worked out.
    const midpoint = (arc: ReturnType<typeof ascShapeRender>) => {
      if (arc?.kind !== "ARC") throw new Error("expected an arc");
      const flag = /A \S+ \S+ 0 [01] ([01])/.exec(ascArcPath(arc));
      expect(flag, "arc path carries a sweep flag").not.toBeNull();
      const angleOf = (point: { x: number; y: number }) =>
        Math.atan2((point.y - arc.cy) / arc.ry, (point.x - arc.cx) / arc.rx);
      // Sweep flag 1 travels in the direction of increasing angle, which is
      // clockwise under a downward y axis; 0 travels the other way.
      const direction = flag![1] === "1" ? 1 : -1;
      const start = angleOf(arc.start);
      const swept = ((direction * (angleOf(arc.end) - start)) % (Math.PI * 2) + Math.PI * 2)
        % (Math.PI * 2);
      const angle = start + (direction * swept) / 2;
      return { x: arc.cx + arc.rx * Math.cos(angle), cx: arc.cx };
    };

    const dotted = arcs.find((arc) => arc?.style === 2);
    const solid = arcs.find((arc) => arc?.style !== 2);
    expect(dotted, "the hidden half-cap is drawn with LTspice's dotted pen").toBeDefined();
    expect(solid).toBeDefined();
    const front = midpoint(solid!);
    const hidden = midpoint(dotted!);
    expect(front.x, "the visible half-cap bulges away from the body").toBeLessThan(front.cx);
    expect(hidden.x, "the hidden half-cap bulges into the body").toBeGreaterThan(hidden.cx);
  });
});
