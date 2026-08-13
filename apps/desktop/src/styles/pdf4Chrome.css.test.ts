// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(__dirname, "pdf4Chrome.css"), "utf8");

function ruleBody(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, `${selector} is missing from pdf4Chrome.css`).toBeGreaterThan(-1);
  const bodyStart = CSS.indexOf("{", start) + 1;
  const end = CSS.indexOf("}\n", bodyStart);
  return CSS.slice(bodyStart, end);
}

describe("PDF4 chrome layout contracts", () => {
  it("centers an empty stage in the usable canvas when the overlay rail is open", () => {
    const emptyState = ruleBody(".stage > .empty-state");
    expect(emptyState).toContain("padding-inline-end: var(--stage-rail-inset, 0px)");
    expect(emptyState).toContain("box-sizing: border-box");
  });

  it("keeps editor tools on a single 32px target and compact token rhythm", () => {
    const toolbar = ruleBody(".editor-toolbar");
    expect(toolbar).toContain("--pdf4-editor-target: 32px");
    expect(toolbar).toContain("height: 44px");
    expect(toolbar).toContain("gap: var(--sp-1)");
    expect(CSS).toContain(".editor-toolbar .editor-icon-btn,\n.editor-toolbar .transport button");
    expect(CSS).toContain("min-width: var(--pdf4-editor-target)");
  });

  it("uses the existing lower-right settings utility without adding idle filler", () => {
    expect(ruleBody(".statusbar-utility")).toContain("margin-inline-start: auto");
    expect(ruleBody(".statusbar-context")).toContain("flex: 1");
  });
});

describe("PDF4 action motion contract", () => {
  it("keeps the idle Run and Ask Bode sheen gentle, shared, and token-driven", () => {
    const sheen = ruleBody(".pdf4-action-sheen");
    expect(sheen).toContain("--pdf4-sheen-ink: var(--accent)");
    expect(sheen).toContain("animation: tau-pdf4-action-sheen 5.6s var(--ease-out) infinite");
    expect(CSS).toContain(".pdf4-action-sheen--bode");
    expect(CSS).toContain("--pdf4-sheen-ink: var(--assistant)");
    expect(CSS).toContain("@keyframes tau-pdf4-action-sheen");
  });

  it("removes the sheen under reduced motion and never introduces raw colors", () => {
    expect(CSS).toContain("@media (prefers-reduced-motion: reduce)");
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.pdf4-action-sheen[\s\S]*?animation: none/);
    expect(CSS).toMatch(/\.pdf4-action-sheen:disabled[\s\S]*?animation: none/);
    expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
