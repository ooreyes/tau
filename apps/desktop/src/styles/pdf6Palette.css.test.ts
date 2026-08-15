// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(__dirname, "pdf6Palette.css"), "utf8");

function ruleBody(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, `${selector} is missing from pdf6Palette.css`).toBeGreaterThan(-1);
  const bodyStart = CSS.indexOf("{", start) + 1;
  const end = CSS.indexOf("}", bodyStart);
  return CSS.slice(bodyStart, end);
}

/**
 * PDF6 item 10 - "This text needs to be aligned".
 *
 * The hints staggered because each row derived its columns from its own
 * contents: an `auto` keycap track was ~24px wide on a row with a hotkey and 0
 * on a row without, so the two fractional columns beside it split a different
 * remainder per row, and a row with no hint at all dropped its keycap into the
 * hint's track. These assertions pin the two properties that fix it - one fixed
 * geometry for every row, and every child placed in its own track by name.
 */
describe("PDF6 palette hint column", () => {
  it("gives every row the same four tracks, sized by type rather than contents", () => {
    const list = ruleBody(".palette-list");
    expect(list).toContain("--pdf6-hint-col: 80px");
    expect(list).toContain("--pdf6-key-col: 24px");

    const item = ruleBody(".palette-item");
    expect(item).toContain("grid-template-columns:");
    // The name column keeps App.css's 56px floor and remains the one that grows.
    expect(item).toContain("minmax(56px, 1fr)");
    // The hint is a fixed column that shrinks only when the row runs out of room,
    // which is what makes its left edge the same x on every row.
    expect(item).toContain("minmax(0, var(--pdf6-hint-col))");
    expect(item).toContain("var(--pdf6-key-col)");
  });

  it("places each cell in its own track, so a missing hint cannot shift a keycap", () => {
    expect(ruleBody(".palette-icon")).toContain("grid-column: 1");
    expect(ruleBody(".palette-name")).toContain("grid-column: 2");
    expect(ruleBody(".palette-desc")).toContain("grid-column: 3");
    expect(ruleBody(".palette-key")).toContain("grid-column: 4");
  });

  it("keeps App.css's narrow-rail fallback, keycap included", () => {
    // Below this width there is no room for a name and a hint both; App.css hides
    // the hint, and this sheet has to move the keycap back to the third track or
    // the explicit `grid-column: 4` opens an implicit fifth one.
    const narrow = CSS.slice(CSS.indexOf("@container palette-list (max-width: 220px)"));
    expect(narrow).toContain("grid-template-columns: 22px minmax(0, 1fr) var(--pdf6-key-col)");
    expect(narrow).toContain("grid-column: 3");
  });
});

/**
 * PDF6 item 8 - "the magnifying and home tool bar feels incredibly laggy".
 */
describe("PDF6 canvas view controls motion", () => {
  it("does not ease toward a position the pointer is still moving", () => {
    // `right` is derived from --stage-rail-inset, i.e. from the parts rail's live
    // width during a drag. App.css transitioned it, so the cluster restarted a
    // 120ms ease on every sample and could not converge until the drag stopped.
    expect(ruleBody(".view-controls")).toContain("transition: none");
  });

  it("introduces no raw colors", () => {
    expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(CSS).not.toMatch(/\b(?:rgba?|hsla?)\(/i);
  });
});
