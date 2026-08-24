import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sideClustersAvoidMode, toolbarGeometry } from "./schematicWorkspaceGeometry";

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

  it("measures true center and no title/action overlap with macOS overlay padding", () => {
    const floors = [
      { viewportWidth: 1440, modeReserve: 224 },
      { viewportWidth: 900, modeReserve: 112 },
    ];
    for (const floor of floors) {
      const geometry = toolbarGeometry({
        ...floor,
        paddingLeft: 78,
        paddingRight: 12,
        // A long document title and the full action cluster at the minimum
        // window size, rather than idealized empty-side widths.
        titleWidth: 300,
        actionsWidth: 360,
      });
      expect(geometry.modeMidpoint).toBe(floor.viewportWidth / 2);
      expect(geometry.leftTrack + geometry.rightTrack + floor.modeReserve).toBe(
        floor.viewportWidth - 78 - 12,
      );
      expect(sideClustersAvoidMode(geometry, 16)).toBe(true);
    }
  });

  it("reserves side lanes and shrinks the visible control at 900px", () => {
    const toolbar = rule(".toolbar");
    expect(toolbar).toContain("grid-template-columns:");
    expect(toolbar).toContain("calc((100% - var(--schematic-mode-reserve)) / 2 - var(--schematic-mode-bias))");
    expect(toolbar).toContain("var(--schematic-mode-reserve)");
    expect(CSS).toContain("@media (max-width: 980px)");
    expect(rule(".toolbar .mode-btn")).toMatch(/min-width:\s*48px/);
    expect(rule(".toolbar .mode-btn")).toMatch(/font-size:\s*0/);
    expect(rule(".toolbar .mode-btn svg")).toMatch(/width:\s*16px/);
    expect(rule(".toolbar .mode-toggle")).toMatch(/overflow:\s*visible/);
    expect(CSS).toContain(".toolbar .titlebar-left {\n  grid-column: 1;");
    expect(CSS).toContain(".toolbar .titlebar-right {\n  grid-column: 3;");
    expect(CSS).toContain("--schematic-mode-bias: 33px");
  });

  it("preserves the keyboard focus indicator without clipping it", () => {
    expect(rule(".toolbar .mode-toggle")).toMatch(/overflow:\s*visible/);
    const appCss = readFileSync(join(__dirname, "..", "App.css"), "utf8");
    expect(appCss).toMatch(/\.mode-btn:focus-visible\s*\{[^}]*box-shadow:/s);
  });

  it("keeps summoned columns out of layout when a future hidden mount is used", () => {
    const hidden = CSS.slice(CSS.indexOf(".app-schematic .shell-body > .explorer-panel"));
    expect(hidden).toContain("display: none");
    expect(hidden).toContain(".components-rail[aria-hidden=\"true\"]");
    expect(hidden).toContain(".assistant-panel[aria-hidden=\"true\"]");
  });
});
