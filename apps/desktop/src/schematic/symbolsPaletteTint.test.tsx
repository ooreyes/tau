// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ComponentSymbol } from "./symbols";

/**
 * P4-10 — an LED's selected colour belongs only on emitted-light arrows.
 *
 * The tint itself is correct: an LED's colour is a real parameter and its
 * arrows must keep showing it on the canvas. The diode junction must remain
 * ordinary schematic ink, and every type index remains monochrome.
 *
 * Two mechanisms carry the fix, and this file measures both because they fail
 * independently:
 *
 *  1. `ComponentSymbol` places `led-color-*` only on its emitted-arrow child
 *     group; `catalog` omits it in the surfaces this lane owns (`Palette.tsx`).
 *     Asserted as markup.
 *  2. `styles/sourceSymbols.css` neutralizes the tint for the two type-index
 *     surfaces this lane does NOT own (`CommandPalette.tsx`'s `.cmdk-icon`,
 *     `Canvas.tsx`'s `.ghost`), where the prop cannot be passed without a
 *     cross-lane edit. Asserted as a computed stroke.
 *
 * The computed-stroke assertions inject the REAL rules, read out of
 * `App.css` and `styles/sourceSymbols.css` at test time, rather than a
 * hand-copied approximation — the precedent is `styles/symbolStroke.test.ts`,
 * and the reason is the same: a rule that moves in App.css must move this test
 * too. jsdom does not resolve custom properties, so what comes back is the
 * declared `var(--token)` text. That is exactly the assertion the item wants —
 * WHICH token the palette LED resolves through — and it also means the test
 * can never accidentally pass by hardcoding a hex value, which the design-system
 * gate forbids anyway.
 */

const APP_CSS = readFileSync(join(__dirname, "..", "App.css"), "utf8");
const SOURCE_SYMBOLS_CSS = readFileSync(
  join(__dirname, "..", "styles", "sourceSymbols.css"),
  "utf8",
);

/** Every declaration block in `css` whose selector list matches, comments
 *  stripped first so a `/* … {ple} … *\/` note cannot desynchronise the scan. */
function rulesMatching(css: string, selectorPattern: RegExp): string[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: string[] = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rule.exec(bare)) !== null) {
    const selector = match[1].split("\n").pop()!.trim();
    if (!selector || selector.startsWith("@")) continue;
    if (selectorPattern.test(selector)) found.push(`${selector} { ${match[2].trim()} }`);
  }
  return found;
}

/**
 * The cascade the LED artwork actually sits in. `.symbol` supplies the canvas
 * stroke, `sourceSymbols.css` places the seven `led-color-*` rules on arrows,
 * and the palette-preview / ghost rules are the two contexts with their own
 * stroke.
 */
function cascadeUnderTest(): string {
  const symbolBase = rulesMatching(APP_CSS, /^\.symbol$/);
  const ledColors = rulesMatching(SOURCE_SYMBOLS_CSS, /^\.symbol \.led-light-arrows\.led-color-/);
  const previewStroke = rulesMatching(APP_CSS, /^\.symbol-preview \.symbol$/);
  const ghostStroke = rulesMatching(APP_CSS, /^\.ghost \.symbol$/);
  // Guard the extraction itself: a silently-empty stylesheet would make every
  // assertion below pass against an empty cascade.
  expect(symbolBase, ".symbol base rule").toHaveLength(1);
  expect(ledColors.length, "led-color rules").toBeGreaterThanOrEqual(7);
  expect(previewStroke, ".symbol-preview .symbol").toHaveLength(1);
  expect(ghostStroke, ".ghost .symbol").toHaveLength(1);
  return [
    ...symbolBase,
    ...previewStroke,
    ...ghostStroke,
    // Loaded after App.css in App.tsx, so its equal-specificity rules win on
    // order — the same cascade position the running app gives it.
    ...rulesMatching(SOURCE_SYMBOLS_CSS, /led-light-arrows/),
  ].join("\n");
}

function mountWithCascade(markup: React.ReactElement): HTMLElement {
  const style = document.createElement("style");
  style.textContent = cascadeUnderTest();
  document.head.appendChild(style);
  const { container } = render(markup);
  return container;
}

const ledArtwork = (container: HTMLElement): Element => {
  const artwork = container.querySelector(".led-artwork");
  expect(artwork, "led artwork group").toBeTruthy();
  return artwork!;
};

const ledArrows = (container: HTMLElement): Element => {
  const arrows = container.querySelector(".led-light-arrows");
  expect(arrows, "LED light-arrow group").toBeTruthy();
  return arrows!;
};

afterEach(() => {
  cleanup();
  document.head.querySelectorAll("style").forEach((node) => node.remove());
});

describe("P3-03 the LED is tinted on the canvas and monochrome in a parts index", () => {
  it("omits the colour class from a catalog glyph while the canvas keeps it", () => {
    const catalogMarkup = render(
      <svg><g className="symbol"><ComponentSymbol kind="led" value="LED" catalog /></g></svg>,
    ).container.innerHTML;
    expect(catalogMarkup).toContain("led-artwork");
    expect(catalogMarkup).not.toContain("led-color-");

    cleanup();
    const canvasMarkup = render(
      <svg><g className="symbol"><ComponentSymbol kind="led" value="LED" /></g></svg>,
    ).container.innerHTML;
    expect(canvasMarkup).toContain("led-light-arrows led-color-red");
    expect(canvasMarkup).toContain('data-led-body="junction"');
    expect(canvasMarkup).not.toContain("data-led-body=\"junction\" class=\"led-color-");
  });

  it("draws the same LED artwork in a catalog glyph, minus only the tint", () => {
    // The fix must not become "the palette draws a diode". Both light arrows
    // and the diode body still have to be there.
    const container = render(
      <svg><g className="symbol"><ComponentSymbol kind="led" value="LED" catalog /></g></svg>,
    ).container;
    expect(container.querySelectorAll('[data-light-arrow]')).toHaveLength(2);
    expect(container.querySelectorAll(".led-artwork path, .led-artwork line").length)
      .toBeGreaterThanOrEqual(5);
  });

  it("resolves a palette-row LED through the monochrome symbol stroke, not --led-red", () => {
    const container = mountWithCascade(
      <svg className="palette-icon"><g className="symbol"><ComponentSymbol kind="led" value="LED" catalog /></g></svg>,
    );
    expect(getComputedStyle(ledArrows(container)).stroke).toBe("var(--comp)");
  });

  it("resolves a symbol-preview LED through the preview accent, not --led-red", () => {
    const container = mountWithCascade(
      <div className="symbol-preview"><svg><g className="symbol"><ComponentSymbol kind="led" value="LED" catalog /></g></svg></div>,
    );
    expect(getComputedStyle(ledArrows(container)).stroke).toBe("var(--accent)");
  });

  it("keeps a canvas LED resolving through its colour token, so Vf and the tint stay coupled", () => {
    const container = mountWithCascade(
      <svg><g className="symbol"><ComponentSymbol kind="led" value="LED color=green" /></g></svg>,
    );
    expect(getComputedStyle(ledArrows(container)).stroke).toBe("var(--led-green)");
    expect(getComputedStyle(ledArtwork(container)).stroke).toBe("var(--comp)");
  });

  it("resolves a command-palette LED through the monochrome stroke, though that surface cannot pass the flag", () => {
    // `CommandPalette.tsx` belongs to no lane this run, so the CSS backstop is
    // what has to hold there. It passes no value at all, and
    // `ledColorFromValue("")` answers "red", which is why an untinted-by-intent
    // surface still came out red.
    const container = mountWithCascade(
      <svg className="cmdk-icon"><g className="symbol"><ComponentSymbol kind="led" /></g></svg>,
    );
    expect(getComputedStyle(ledArrows(container)).stroke).toBe("var(--comp)");
  });

  it("resolves a placement-ghost LED through the ghost accent, so the preview is not a red part", () => {
    // `.symbol .led-artwork.led-color-red` (0,3,0) outranks `.ghost .symbol`
    // (0,2,0), so before the backstop an LED ghost drew solid red over the
    // dashed accent every other part previews in.
    const container = mountWithCascade(
      <svg><g className="ghost"><g className="symbol"><ComponentSymbol kind="led" /></g></g></svg>,
    );
    expect(getComputedStyle(ledArrows(container)).stroke).toBe("var(--accent)");
  });
});
