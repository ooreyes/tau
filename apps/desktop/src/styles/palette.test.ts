import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The trace palette is verifiable, so verify it rather than trusting review.
 *
 * The previous hand-tuned palette failed on measurement: sage green and steel
 * cyan sat at deltaE 11.6 for NORMAL vision against a floor of 15, so V(in) and
 * V(out) on one scope were hard to separate for every user. The replacement is
 * Okabe-Ito snapped into each surface's OKLCH lightness band.
 *
 * The ORDER is part of the result, not cosmetic: olive beside green fails the
 * normal-vision floor, and orange beside olive collapses to deltaE 0.6 under
 * deuteranopia. So this reads the rotation out of the source of truth
 * (TRACE_COLORS) and validates the palette in exactly that order.
 *
 * There are TWO such lists - the preview solver's and the native ngspice
 * path's - and both reach the same plotter. Checking only one is how they
 * drifted: `engine/nativeSpice.ts`, the list the packaged desktop app actually
 * uses, sat at cyan/green/cream/red/... for long enough to ship, putting olive
 * directly after green (normal-vision deltaE 13.7 against a floor of 15) and
 * vermillion beside olive (deltaE 0.8 under deuteranopia). So every list is
 * enumerated here, each is validated in its own order, and they must be
 * identical to each other.
 */

const ROOT = join(__dirname, "..", "..", "..", "..");
const CSS = readFileSync(join(__dirname, "..", "App.css"), "utf8");

/** Every module carrying a trace rotation. Adding a renderer means adding it
 *  here; a list that exists but is not listed is exactly the gap that let the
 *  native path drift. */
const ROTATION_SOURCES = [
  { label: "preview solver", path: ["..", "simulation", "linearTransient.ts"] },
  { label: "native ngspice", path: ["..", "engine", "nativeSpice.ts"] },
] as const;

/** Rotation order as a given renderer actually uses it. */
function rotationTokens(relative: readonly string[]): string[] {
  const src = readFileSync(join(__dirname, ...relative), "utf8");
  const block = /const TRACE_COLORS = \[([\s\S]*?)\]/.exec(src);
  expect(block, `TRACE_COLORS not found in ${relative.join("/")}`).not.toBeNull();
  return [...block![1].matchAll(/--trace-([a-z]+)/g)].map((m) => m[1]);
}

/**
 * The four blocks in App.css that can define a trace palette, each named by the
 * selector that introduces it.
 *
 * This used to be a two-way split on the position of the
 * `@media (prefers-color-scheme: light)` string: everything before it was
 * "dark", everything after was "light". That validated the two media-query
 * blocks and left the two `:root[data-theme]` blocks unchecked - which are the
 * ones that actually ship, because index.html stamps `data-theme` on load and
 * only removes it for the explicit "System" setting. The two pairs agree today.
 * Nothing was enforcing that they keep agreeing, and a redesign that
 * consolidates theming is exactly when they would stop.
 */
const THEME_BLOCKS = [
  { mode: "dark", selector: ":root {", label: "bare :root (system, OS dark)" },
  {
    mode: "light",
    selector: "@media (prefers-color-scheme: light)",
    label: "@media light (system, OS light)",
  },
  { mode: "light", selector: ':root[data-theme="light"]', label: 'data-theme="light"' },
  { mode: "dark", selector: ':root[data-theme="dark"]', label: 'data-theme="dark"' },
] as const;

/** Resolve a token inside one named theme block, reading forward from it. */
function blockValues(tokens: string[], selector: string, label: string): string[] {
  const start = CSS.indexOf(selector);
  expect(start, `App.css has no ${label} block`).toBeGreaterThan(-1);
  // Read from this block's start to the next block's, so a token defined only
  // in a later block cannot be borrowed by an earlier one.
  const laterStarts = THEME_BLOCKS.map((block) => CSS.indexOf(block.selector)).filter(
    (index) => index > start,
  );
  const scope = CSS.slice(start, laterStarts.length ? Math.min(...laterStarts) : undefined);
  return tokens.map((name) => {
    const hit = new RegExp(`--trace-${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(scope);
    expect(hit, `--trace-${name} missing from ${label}`).not.toBeNull();
    return hit![1];
  });
}

function validate(palette: string[], mode: "dark" | "light"): string {
  return execFileSync(
    "node",
    [join(ROOT, "scripts", "validate-palette.mjs"), palette.join(","), "--mode", mode],
    { encoding: "utf8" },
  );
}

describe("trace palette", () => {
  const rotations = ROTATION_SOURCES.map((source) => ({
    ...source,
    tokens: rotationTokens(source.path),
  }));

  for (const { label, tokens } of rotations) {
    describe(label, () => {
      it("rotates six distinct hues", () => {
        expect(tokens).toHaveLength(6);
        expect(new Set(tokens).size).toBe(6);
      });

      for (const { mode, selector, label } of THEME_BLOCKS) {
        it(`passes every colour check in ${label}, in rotation order`, () => {
          const report = validate(blockValues(tokens, selector, label), mode);
          expect(report, report).toContain("ALL CHECKS PASS");
        });
      }

      // The pair a user sees depends on whether they chose a theme or left it
      // on System, and they must not be able to tell the difference.
      it("gives the shipped data-theme blocks the same palette as the media queries", () => {
        for (const mode of ["dark", "light"] as const) {
          const media = THEME_BLOCKS.find((b) => b.mode === mode && b.selector.startsWith("@") )
            ?? THEME_BLOCKS.find((b) => b.mode === mode && b.selector === ":root {")!;
          const stamped = THEME_BLOCKS.find((b) => b.selector.includes(`data-theme="${mode}"`))!;
          expect(
            blockValues(tokens, stamped.selector, stamped.label),
            `${mode}: the stamped ${stamped.label} palette differs from ${media.label}, so choosing a theme would change the trace colours`,
          ).toEqual(blockValues(tokens, media.selector, media.label));
        }
      });
    });
  }

  // Both renderers feed the same plotter, so a user comparing a preview run
  // against a native run must see the same trace in the same colour. Equality
  // is asserted separately from validity: two lists could each pass the colour
  // checks in their own order and still disagree with one another.
  it("uses one identical rotation across every renderer", () => {
    const [first, ...rest] = rotations;
    for (const other of rest) {
      expect(
        other.tokens,
        `${other.label} rotation differs from ${first.label} - see DESIGN_SYSTEM.md §1.5, the order is load-bearing`,
      ).toEqual(first.tokens);
    }
  });
});
