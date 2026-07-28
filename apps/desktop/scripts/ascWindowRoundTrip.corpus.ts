// Real-corpus proof that LTspice `WINDOW` label placement survives a save.
//
// LTspice writes a WINDOW record whenever the user drags an attribute label off
// its default spot, so roughly a quarter of real schematics carry one. Tau used
// to refuse to save any of them rather than silently move the labels. This walks
// the user's own corpus and asserts the stronger property: whenever a symbol is
// written back under the same name and the same symbol type, its placement
// records come out byte-identical and in the same order.
//
// Runs under vitest.corpus.config.ts only (needs the local corpus); skips on a
// machine without one. No ngspice required.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { describe, it, expect } from "vitest";
import { importAsc, decodeSchematicText, parseAsc } from "../src/io/ascImport";
import type { AscDocument } from "../src/io/ascImport";
import { schematicToAsc } from "../src/io/ascExport";
import { ascRewriteRisks, ascSaveBlockReason } from "../src/project/types";

const CORPUS_ROOT = join(homedir(), "Documents", "LTspice");
/** Bounded so the spec stays a few seconds; the corpus holds ~1,000 matches. */
const MAX_FILES = 300;

function findWindowSchematics(root: string): string[] {
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
          if (/^WINDOW /m.test(readFileSync(abs, "latin1"))) found.push(abs);
        } catch { /* unreadable file */ }
      }
    }
  };
  walk(root, 0);
  return found;
}

/** Symbol type and placement records, keyed by instance name. */
const placementByInstance = (doc: AscDocument) =>
  new Map(
    doc.symbols
      .filter((symbol) => symbol.attrs.InstName)
      .map((symbol) => [symbol.attrs.InstName, { type: symbol.type, windows: symbol.windows ?? [] }]),
  );

const files = existsSync(CORPUS_ROOT) ? findWindowSchematics(CORPUS_ROOT) : [];

describe.skipIf(files.length === 0)("LTspice WINDOW placement round-trip", () => {
  it("re-emits every placement record unchanged, and unblocks the save", () => {
    const scattered: string[] = [];
    let symbolsChecked = 0;
    let saveable = 0;
    let failedToImport = 0;

    for (const file of files) {
      const source = decodeSchematicText(readFileSync(file));
      let imported: ReturnType<typeof importAsc>;
      let exported: ReturnType<typeof schematicToAsc>;
      try {
        imported = importAsc(source);
        exported = schematicToAsc({
          components: imported.components,
          wires: imported.wires,
          netLabels: imported.netLabels,
          directives: imported.directives,
          textAnnotations: imported.textAnnotations ?? [],
        });
      } catch {
        failedToImport += 1;
        continue;
      }

      const before = placementByInstance(parseAsc(source));
      const after = placementByInstance(parseAsc(exported.text));
      for (const [instance, original] of before) {
        const written = after.get(instance);
        // A part Tau could not write back under its own symbol legitimately
        // drops its placement - the exporter warns and the save stays blocked.
        if (!written || written.type !== original.type || original.windows.length === 0) continue;
        symbolsChecked += 1;
        if (JSON.stringify(written.windows) !== JSON.stringify(original.windows)) {
          scattered.push(
            `${file} [${instance}]: ${JSON.stringify(original.windows)} -> ${JSON.stringify(written.windows)}`,
          );
        }
      }

      if (ascSaveBlockReason(ascRewriteRisks(source), 0, exported.warnings) === null) saveable += 1;
    }

    console.log(
      `WINDOW corpus: ${files.length} files · ${symbolsChecked} placements verified · `
      + `${saveable} now saveable · ${failedToImport} failed to import`,
    );

    expect(scattered.slice(0, 5)).toEqual([]);
    expect(symbolsChecked).toBeGreaterThan(100);
    // Every one of these files was unsaveable before placement was preserved.
    // The rest are held back by an unrelated risk (drawing primitives, vendor
    // symbol attributes), not by their labels.
    expect(saveable).toBeGreaterThan(0);
  });
});
