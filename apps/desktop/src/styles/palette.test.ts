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
 */

const ROOT = join(__dirname, "..", "..", "..", "..");
const CSS = readFileSync(join(__dirname, "..", "App.css"), "utf8");

/** Rotation order as the renderer actually uses it. */
function rotationTokens(): string[] {
  const src = readFileSync(join(__dirname, "..", "simulation", "linearTransient.ts"), "utf8");
  const block = /const TRACE_COLORS = \[([\s\S]*?)\]/.exec(src);
  expect(block, "TRACE_COLORS not found").not.toBeNull();
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
  const tokens = rotationTokens();

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
