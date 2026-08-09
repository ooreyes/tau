/**
 * The test that stops `preferenceRegistry.ts` rotting the way `resetEverything`
 * did.
 *
 * "Reset to defaults" used to clear 2 of 7 preference domains while its copy
 * claimed to reset "every preference on every page". Nothing caught that,
 * because nothing could: the button named its own scope, so the button was
 * never wrong about itself. A registry only fixes that for as long as new
 * preferences get added to it, and the failure mode of a hand-maintained list
 * is silence.
 *
 * So this walks the source for every `tau.…` string literal and requires each
 * one to be classified as exactly one of three things: reset by the button,
 * deliberately preserved, or not a storage key at all. A new preference module
 * fails this test until somebody decides which it is. That decision is the
 * whole point; the test exists to force it, not to check spelling.
 *
 * A match must begin at the opening quote of a literal, because a storage key
 * always does. Scanning raw text instead was tried first and reported three
 * false positives immediately: `tau.id` and `tau.label` are property reads off
 * a local named `tau` in `io/ascImport.ts`, and `.tau.json` is the project file
 * extension. A check that cries wolf is a check somebody deletes, so precision
 * wins here over catching keys named only in prose.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  PRESERVED_KEY_PREFIXES,
  PRESERVED_PREFERENCES,
  RESETTABLE_PREFERENCES,
} from "./preferenceRegistry";

const SRC = fileURLToPath(new URL("..", import.meta.url));

/**
 * Identifiers that begin with `tau.` and are NOT localStorage keys, so the
 * registry has nothing to say about them. Each one is a discriminator inside a
 * JSON payload, and each was verified by checking that its module either never
 * touches localStorage or stores under a different key entirely:
 *
 * - `tau.cli.*` are the CLI's API version and envelope `kind` tags
 *   (`cli/tauCliApi.ts`). Neither CLI file references localStorage at all.
 * - `tau.run.record.v1` is `RUN_RECORD_KIND` (`lib/runRecord.ts`), the envelope
 *   tag stored *inside* each record. That module's actual storage key is
 *   `tau.run.history.v1`, which is registered as preserved.
 *
 * This list is deliberately explicit rather than a pattern. A pattern would
 * quietly absorb a real preference key that happened to match it, which is the
 * exact class of silence this file exists to prevent.
 */
const NOT_STORAGE_KEYS: ReadonlySet<string> = new Set([
  "tau.cli.v1",
  "tau.cli.diagnose.v1",
  "tau.cli.help.v1",
  "tau.cli.version.v1",
  "tau.run.record.v1",
]);

/** Every non-test .ts/.tsx file under src. */
function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, found);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

/**
 * A `tau.` run that starts immediately after an opening quote or backtick.
 * The trailing character class excludes `$`, braces and quotes, so a template
 * literal such as `` `tau.tranGrid.${key}` `` yields its fixed head
 * `tau.tranGrid.`, which is what `PRESERVED_KEY_PREFIXES` matches. A key
 * assembled from a const still gets caught at that const's own declaration.
 */
const TAU_KEY = /["'`](tau\.[A-Za-z0-9._:-]*)/g;

function scannedKeys(): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const file of sourceFiles(SRC)) {
    const relative = file.slice(SRC.length);
    for (const match of readFileSync(file, "utf8").matchAll(TAU_KEY)) {
      // Group 1 drops the opening quote. Kept verbatim otherwise, trailing dot
      // and all, because `tau.tranGrid.` is a real prefix.
      const key = match[1];
      const seen = byKey.get(key) ?? [];
      if (!seen.includes(relative)) seen.push(relative);
      byKey.set(key, seen);
    }
  }
  return byKey;
}

const RESETTABLE = new Set(RESETTABLE_PREFERENCES.map((entry) => entry.key));
const PRESERVED = new Set(PRESERVED_PREFERENCES.map((entry) => entry.key));

function classify(key: string): "reset" | "preserved" | "not-storage" | "unclassified" {
  if (RESETTABLE.has(key)) return "reset";
  if (PRESERVED.has(key)) return "preserved";
  if (PRESERVED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) return "preserved";
  if (NOT_STORAGE_KEYS.has(key)) return "not-storage";
  // A prose mention that ends a sentence keeps its full stop; judge the
  // trimmed form too rather than failing on punctuation.
  const trimmed = key.replace(/\.+$/, "");
  if (trimmed !== key) return classify(trimmed);
  return "unclassified";
}

describe("preference registry covers every tau. key in the source", () => {
  it("finds keys at all, so a broken scan cannot pass vacuously", () => {
    const keys = scannedKeys();
    // The guard that matters. Every earlier version of a scanning check I have
    // written in this repo passed at some point by finding nothing at all.
    expect(keys.size).toBeGreaterThan(15);
    expect([...keys.keys()]).toContain("tau.ui.theme");
  });

  it("classifies every key as reset, preserved, or not a storage key", () => {
    const unclassified = [...scannedKeys().entries()]
      .filter(([key]) => classify(key) === "unclassified")
      .map(([key, files]) => `${key}  (${files.join(", ")})`);

    expect(
      unclassified,
      "Every tau. key must be listed in RESETTABLE_PREFERENCES, in " +
        "PRESERVED_PREFERENCES or PRESERVED_KEY_PREFIXES, or in this file's " +
        "NOT_STORAGE_KEYS if it is a payload discriminator rather than a " +
        "storage key. Decide which, and say so in the Reset copy if a user " +
        "could reasonably expect the button to clear it.",
    ).toEqual([]);
  });

  it("lists no key that the source does not actually use", () => {
    const scanned = scannedKeys();
    const isUsed = (key: string) =>
      [...scanned.keys()].some((found) => found === key || found.startsWith(key));

    // The reverse rot: an entry left behind after its module was deleted makes
    // the registry look more complete than it is.
    const orphaned = [...RESETTABLE, ...PRESERVED, ...PRESERVED_KEY_PREFIXES].filter(
      (key) => !isUsed(key),
    );
    expect(orphaned).toEqual([]);
  });

  it("does not classify the same key as both reset and preserved", () => {
    const both = [...RESETTABLE].filter((key) => PRESERVED.has(key));
    expect(both).toEqual([]);
  });
});
