import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(__dirname, "..", "App.css"), "utf8");

/**
 * Collect every top-level rule in `App.css` whose selector list is exactly
 * `selector`, ignoring anything nested inside `@media` / `@layer` / `@supports`
 * (those are a different cascade question) and anything more specific.
 */
function topLevelRules(selector: string): Array<{ line: number; body: string }> {
  const lines = CSS.split("\n");
  const found: Array<{ line: number; body: string }> = [];
  let index = 0;
  while (index < lines.length) {
    const text = (lines[index] ?? "").trim();
    if (!text.endsWith("{") || text.startsWith("@")) {
      index += 1;
      continue;
    }
    const head = text.slice(0, -1).trim();
    const startLine = index + 1;
    const body: string[] = [];
    let depth = 1;
    index += 1;
    while (index < lines.length && depth > 0) {
      const line = lines[index] ?? "";
      depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
      if (depth > 0) body.push(line);
      index += 1;
    }
    if (head === selector) found.push({ line: startLine, body: body.join("\n") });
  }
  return found;
}

describe("canvas symbol stroke weight", () => {
  /**
   * For seven weeks `App.css` declared `.symbol` twice at top level - 1.45 near
   * the schematic block and 1.55 in a bulk-pasted shell block 5,300 lines
   * later. Same specificity, so the later one won in silence: the canvas drew
   * at 1.55, the 1.45 that someone had deliberately tuned down from 1.6 was
   * dead, and no gate could see the disagreement. Deleting the wrong copy would
   * have re-weighted every symbol in the product without a single test turning
   * red, which is precisely why it went unresolved for so long.
   *
   * A second top-level `.symbol` rule is therefore not a style nit, it is the
   * return of a defect whose whole nature is that nothing else notices it. One
   * rule, and the weight the product actually ships, are both asserted here.
   */
  it("declares .symbol exactly once, at the weight the canvas ships", () => {
    const rules = topLevelRules(".symbol");
    expect(
      rules.map((rule) => rule.line),
      "a second top-level `.symbol` rule silently reweights every schematic symbol",
    ).toHaveLength(1);
    expect(rules[0]?.body).toMatch(/^\s*stroke-width:\s*1\.55;\s*$/m);
  });
});
