// Real-corpus proof that LTspice drawing primitives (LINE/RECTANGLE/CIRCLE/ARC)
// survive a save.
//
// LTspice writes these for schematic-sheet artwork - box borders, dividers, the
// odd hand-drawn diagram - and Tau used to refuse to save any file that carried
// one rather than silently dropping the drawing. `parseAsc` now captures each
// record into `doc.shapes` and `serializeAscDocument` re-emits it. This walks
// the user's own corpus and asserts the stronger property: every shape line
// comes back byte-identical and in the same order, none are lost or invented,
// and the files it examines are no longer blocked on this particular risk.
//
// Runs under vitest.corpus.config.ts only (needs the local corpus); skips on a
// machine without one. No ngspice required.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { describe, it, expect } from "vitest";
import { parseAsc, decodeSchematicText } from "../src/io/ascImport";
import { serializeAscDocument } from "../src/io/ascExport";
import { ascRewriteRisks } from "../src/project/types";

const CORPUS_ROOT = join(homedir(), "Documents", "LTspice");
/** Bounded defensively; the corpus holds ~69 shape-bearing files today. */
const MAX_FILES = 500;

const SHAPE_TAGS = new Set(["LINE", "RECTANGLE", "CIRCLE", "ARC"]);
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
        } catch { /* unreadable file */ }
      }
    }
  };
  walk(root, 0);
  return found;
}

/** Every LINE/RECTANGLE/CIRCLE/ARC line in `text`, trimmed and with any CR
 *  stripped, in file order - the same tokenization `parseAsc` uses to
 *  recognize a shape record. */
function shapeLines(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const tag = line.split(/\s+/)[0]?.toUpperCase();
    if (tag && SHAPE_TAGS.has(tag)) lines.push(line);
  }
  return lines;
}

const files = existsSync(CORPUS_ROOT) ? findShapeSchematics(CORPUS_ROOT) : [];

describe.skipIf(files.length === 0)("LTspice drawing-primitive round-trip", () => {
  it("re-emits every shape line byte-identically, loses none, and unblocks the save", () => {
    const reemissionMismatches: string[] = [];
    const lossOrInventionIssues: string[] = [];
    const riskRegressions: string[] = [];
    let filesChecked = 0;
    let totalShapeLines = 0;
    let newlyFree = 0;
    let fullySaveable = 0;

    for (const file of files) {
      const source = decodeSchematicText(readFileSync(file));
      const sourceLines = shapeLines(source);
      if (sourceLines.length === 0) continue; // discovery heuristic false positive

      filesChecked += 1;
      totalShapeLines += sourceLines.length;

      const parsed = parseAsc(source);

      // No shape lost or invented: the parser found exactly the shape lines we
      // see in the text, and none of them fell through to `unknown`.
      if (parsed.shapes.length !== sourceLines.length) {
        lossOrInventionIssues.push(
          `${file}: source has ${sourceLines.length} shape lines but parseAsc found ${parsed.shapes.length}`,
        );
      }
      for (const unknownLine of parsed.unknown) {
        const tag = unknownLine.trim().split(/\s+/)[0]?.toUpperCase();
        if (tag && SHAPE_TAGS.has(tag)) {
          lossOrInventionIssues.push(`${file}: shape-tagged line landed in unknown: ${unknownLine}`);
        }
      }

      // Byte-identical re-emission, in order.
      const outputLines = shapeLines(serializeAscDocument(parsed));
      const span = Math.max(sourceLines.length, outputLines.length);
      for (let i = 0; i < span; i++) {
        const before = sourceLines[i];
        const after = outputLines[i];
        if (before !== after) {
          reemissionMismatches.push(
            `${file} [shape ${i}]: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
          );
        }
      }

      // Every one of these files carries a shape, so under the old rule
      // (`if (parsed.shapes.length > 0) risks.add("drawing primitives")`) all of
      // them were unconditionally blocked. Assert that risk never resurfaces.
      const risks = ascRewriteRisks(source);
      if (risks.includes("drawing primitives")) riskRegressions.push(file);
      else newlyFree += 1;
      if (risks.length === 0) fullySaveable += 1;
    }

    console.log(
      `${totalShapeLines} shape lines across ${filesChecked} files re-emitted byte-identically; `
      + `${newlyFree} files newly free of the drawing-primitives block · ${fullySaveable} fully saveable`,
    );

    expect(reemissionMismatches.slice(0, 5)).toEqual([]);
    expect(lossOrInventionIssues.slice(0, 5)).toEqual([]);
    expect(riskRegressions.slice(0, 5)).toEqual([]);
    expect(filesChecked).toBeGreaterThanOrEqual(40);
    expect(totalShapeLines).toBeGreaterThanOrEqual(150);
  });
});
