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

/** Resolve a token inside a specific theme block of App.css. */
function themeValues(tokens: string[], theme: "dark" | "light"): string[] {
  // Dark lives in the bare :root; light in the prefers-color-scheme block.
  const scope = theme === "dark"
    ? CSS.slice(0, CSS.indexOf("@media (prefers-color-scheme: light)"))
    : CSS.slice(CSS.indexOf("@media (prefers-color-scheme: light)"));
  return tokens.map((name) => {
    const hit = new RegExp(`--trace-${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(scope);
    expect(hit, `--trace-${name} missing from ${theme}`).not.toBeNull();
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

      for (const mode of ["dark", "light"] as const) {
        it(`passes every colour check in ${mode} mode, in rotation order`, () => {
          const report = validate(themeValues(tokens, mode), mode);
          expect(report, report).toContain("ALL CHECKS PASS");
        });
      }
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
