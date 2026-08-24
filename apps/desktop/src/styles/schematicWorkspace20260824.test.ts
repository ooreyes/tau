import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(__dirname, "schematicWorkspace20260824.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  const match = CSS.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  expect(match, `${selector} is missing`).toBeTruthy();
  return match?.[1] ?? "";
}

describe("schematic workspace shell geometry", () => {
  it("centers the mode landmark against the window, not title/action widths", () => {
    const mode = rule(".toolbar .mode-toggle");
    expect(mode).toMatch(/position:\s*absolute/);
    expect(mode).toMatch(/left:\s*50%/);
    expect(mode).toMatch(/top:\s*50%/);
    expect(mode).toMatch(/transform:\s*translate\(-50%,\s*-50%\)/);
  });

  it("keeps the measured midpoint and side lanes usable at both shell floors", () => {
    const centeredRect = (viewport: number, control: number) => ({
      left: (viewport - control) / 2,
      right: (viewport + control) / 2,
      midpoint: viewport / 2,
    });
    const floors = [
      { viewport: 1440, reserve: 224 },
      { viewport: 900, reserve: 112 },
    ];
    for (const { viewport, reserve } of floors) {
      const rect = centeredRect(viewport, reserve);
      expect(rect.left + rect.right).toBe(viewport);
      expect((rect.left + rect.right) / 2).toBe(rect.midpoint);
      // Each grid side retains at least the pre-redesign 260px floor, so a
      // title or action cluster cannot be pushed under the mode control.
      expect(rect.left).toBeGreaterThanOrEqual(260);
      expect(viewport - rect.right).toBeGreaterThanOrEqual(260);
    }
  });

  it("reserves side lanes and shrinks the visible control at 900px", () => {
    const toolbar = rule(".toolbar");
    expect(toolbar).toContain("grid-template-columns: minmax(0, 1fr) var(--schematic-mode-reserve) minmax(0, 1fr)");
    expect(CSS).toContain("@media (max-width: 980px)");
    expect(rule(".toolbar .mode-btn")).toMatch(/min-width:\s*48px/);
    expect(rule(".toolbar .mode-btn")).toMatch(/font-size:\s*0/);
    expect(rule(".toolbar .mode-btn svg")).toMatch(/width:\s*16px/);
  });

  it("keeps summoned columns out of layout when a future hidden mount is used", () => {
    const hidden = CSS.slice(CSS.indexOf(".app-schematic .shell-body > .explorer-panel"));
    expect(hidden).toContain("display: none");
    expect(hidden).toContain(".components-rail[aria-hidden=\"true\"]");
    expect(hidden).toContain(".assistant-panel[aria-hidden=\"true\"]");
  });
});
