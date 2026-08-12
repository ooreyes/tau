import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(__dirname, "..", "App.css"), "utf8");

/**
 * Collect every rule whose selector list is exactly `selector`, at any nesting
 * depth. Unlike the stroke-weight audit next door this one deliberately looks
 * inside `@media`, because the narrow-window override is where the inspector
 * grid was most badly starved.
 */
function rulesFor(selector: string): string[] {
  const lines = CSS.split("\n");
  const found: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const text = (lines[index] ?? "").trim();
    if (!text.endsWith("{") || text.startsWith("@")) {
      index += 1;
      continue;
    }
    const head = text.slice(0, -1).trim();
    const body: string[] = [];
    let depth = 1;
    index += 1;
    while (index < lines.length && depth > 0) {
      const line = lines[index] ?? "";
      depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
      if (depth > 0) body.push(line);
      index += 1;
    }
    if (head === selector) found.push(body.join("\n"));
  }
  return found;
}

const declaration = (body: string, property: string): string | null =>
  body.match(new RegExp(`(?:^|[;{\\n])\\s*${property}\\s*:\\s*([^;]+);`))?.[1]?.trim() ?? null;

/**
 * The inspector's value column has failed twice in the same way: something
 * beside the number refused to shrink, the number's own control was flexed
 * down to 0px, and it rendered past the panel edge where it could not be seen
 * or reached. Measured in a real browser the op-amp read
 * `Open-loop gain  1–1000000000000` with no value at all.
 *
 * These are the two structural invariants that keep the number on screen.
 * Layout is not observable in jsdom, so this reads the stylesheet directly.
 */
describe("inspector value column keeps the number visible", () => {
  it("lets the range hint yield space rather than the value control", () => {
    const [range] = rulesFor(".property-range");
    expect(range, ".property-range rule").toBeTruthy();

    const flex = declaration(range, "flex");
    expect(flex, ".property-range flex").toBeTruthy();
    // `flex: none` is the regression: an unshrinkable hint wins the width
    // fight against the control it is annotating.
    expect(flex).not.toBe("none");
    expect(flex!.startsWith("0 1")).toBe(true);
    expect(declaration(range, "min-width")).toBe("0");
  });

  it("pins the engineering control so it cannot be flexed to zero", () => {
    const [eng] = rulesFor(".property-value .eng-input");
    expect(eng, ".property-value .eng-input rule").toBeTruthy();
    expect(declaration(eng, "flex")).toBe("0 0 auto");
  });

  it("gives a single selected part the whole inspector width", () => {
    const templates = rulesFor(".component-inspector")
      .map((body) => declaration(body, "grid-template-columns"))
      .filter((value): value is string => Boolean(value));

    expect(templates.length, "component-inspector grid templates").toBeGreaterThan(0);
    for (const template of templates) {
      // A fixed leading track dates from an identity block that now rides in
      // each group's header. Left in place it pinned the only child to 232px
      // (156px under the narrow-window override) and gave the remainder to an
      // empty second track.
      expect(template, "inspector track list").toContain("auto-fit");
      expect(/^\d+px\s/.test(template), `fixed leading track in "${template}"`).toBe(false);
    }
  });
});

/**
 * The canvas zoom cluster (+, -, fit) is anchored to the stage's right edge,
 * and so is the parts rail, which is an absolutely-positioned overlay on the
 * same stage. The cluster was mounted, focusable and hit-testable the whole
 * time - and rendered underneath the rail, so in the schematic tab there were
 * simply no zoom buttons on screen.
 */
describe("canvas view controls clear the parts rail", () => {
  it("offsets itself by the rail's published width", () => {
    const [rule] = rulesFor(".view-controls");
    expect(rule, ".view-controls rule").toBeTruthy();

    const right = declaration(rule, "right");
    expect(right, ".view-controls right").toBeTruthy();
    // A bare `right: var(--sp-4)` is the regression.
    expect(right).toContain("--stage-rail-inset");
  });

  it("is published from the rail's real width, not a hardcoded guess", () => {
    const app = readFileSync(join(__dirname, "..", "App.tsx"), "utf8");
    expect(app).toContain("--stage-rail-inset");
    // Derived from the same clamp the rail itself renders with.
    expect(app).toMatch(/componentsRailWidth\(/);
  });
});
