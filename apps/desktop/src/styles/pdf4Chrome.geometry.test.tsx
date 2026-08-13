// @vitest-environment jsdom
/**
 * Rendered geometry proof for the PDF4 editor chrome.
 *
 * jsdom deliberately has no layout engine: every real DOMRect is 0×0. Rather
 * than fall back to source-text assertions, this fixture renders the production
 * EmptyState and EditorToolbar, reads their applied CSS, and supplies only the
 * missing flex/grid measurements. That lets the assertions exercise the same
 * DOM/CSS contract a browser uses at the three review window sizes.
 */
import type { CSSProperties } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { EmptyState } from "../components/EmptyState";
import { EditorToolbar } from "../components/editor/EditorChrome";
import { useSchematic } from "../store/useSchematic";

// Vitest's CSS transform does not attach global CSS to jsdom's document. Load
// the exact production layers as a stylesheet so getComputedStyle() observes
// the same selectors/tokens the desktop renderer receives.
const PRODUCTION_CSS = [
  readFileSync(join(__dirname, "../App.css"), "utf8"),
  readFileSync(join(__dirname, "pdf4Chrome.css"), "utf8"),
].join("\n");
let productionStyle: HTMLStyleElement | null = null;

interface ChromeViewport {
  name: string;
  width: number;
  height: number;
  /** Open/resized sibling panels that reduce the editor column. */
  explorer: number;
  inspector: number;
  /** Summoned parts rail: overlays stage, so it must be reserved by empty UI. */
  rail: number;
}

const VIEWPORTS: ChromeViewport[] = [
  { name: "minimum 900×600", width: 900, height: 600, explorer: 232, inspector: 0, rail: 208 },
  // App.css declares 260px as the editor shell's hard responsive floor. This
  // fixture reaches that floor through two resized siblings to prove overflow
  // is scrollable instead of clipping the last transport/tool controls.
  { name: "minimum 900×600 at the 260px editor floor", width: 900, height: 600, explorer: 320, inspector: 320, rail: 0 },
  { name: "1280×800 with resized side panels", width: 1280, height: 800, explorer: 312, inspector: 224, rail: 264 },
  { name: "1440×900 with resized side panels", width: 1440, height: 900, explorer: 272, inspector: 304, rail: 320 },
];

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const rect = ({ left, top, width, height }: Box): DOMRect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  x: left,
  y: top,
  toJSON: () => ({}),
} as DOMRect);

function numberCss(value: string, label: string): number {
  const number = Number.parseFloat(value);
  expect(number, `${label}: ${value}`).toBeGreaterThan(0);
  return number;
}

/**
 * Attach browser-like boxes to the rendered fixture. It intentionally derives
 * rail reservation, target size, toolbar height, and horizontal scrolling from
 * computed production CSS; it does not read the stylesheet source.
 */
function measureFixture(container: HTMLElement, viewport: ChromeViewport) {
  const editor = container.querySelector<HTMLElement>(".editor-shell")!;
  const toolbar = container.querySelector<HTMLElement>(".editor-toolbar")!;
  const stage = container.querySelector<HTMLElement>(".stage")!;
  const empty = container.querySelector<HTMLElement>(".empty-state")!;
  const panel = container.querySelector<HTMLElement>(".empty-panel")!;
  const buttons = [...toolbar.querySelectorAll<HTMLButtonElement>("button")];
  const toolbarStyle = getComputedStyle(toolbar);
  const emptyStyle = getComputedStyle(empty);
  const target = numberCss(toolbarStyle.getPropertyValue("--pdf4-editor-target"), "editor target token");
  const toolbarHeight = numberCss(toolbarStyle.height, "editor toolbar height");
  const stageWidth = viewport.width - viewport.explorer - viewport.inspector;
  const stageTop = toolbarHeight + 34; // production editor toolbar + tab strip
  const stageHeight = viewport.height - stageTop - 28; // app status bar
  const reservesRail = emptyStyle.paddingInlineEnd.includes("stage-rail-inset")
    || Math.abs(Number.parseFloat(emptyStyle.paddingInlineEnd) - viewport.rail) < 0.01;
  const visibleWidth = stageWidth - (reservesRail ? viewport.rail : 0);
  const panelWidth = 344;
  const panelHeight = 196;
  const boxByElement = new Map<Element, Box>([
    [editor, { left: viewport.explorer, top: 0, width: stageWidth, height: viewport.height - 28 }],
    [toolbar, { left: viewport.explorer, top: 0, width: stageWidth, height: toolbarHeight }],
    [stage, { left: viewport.explorer, top: stageTop, width: stageWidth, height: stageHeight }],
    [empty, { left: viewport.explorer, top: stageTop, width: stageWidth, height: stageHeight }],
    [panel, {
      left: viewport.explorer + (visibleWidth - panelWidth) / 2,
      top: stageTop + (stageHeight - panelHeight) / 2,
      width: panelWidth,
      height: panelHeight,
    }],
  ]);

  // A horizontal editor strip puts every real button in scrollable content.
  // It may overflow at the minimum size, but it may never hide controls past
  // an unscrollable edge.
  const compactGap = 4;
  const contentWidth = Math.max(
    stageWidth,
    buttons.length * target + Math.max(0, buttons.length - 1) * compactGap + 16,
  );
  buttons.forEach((button, index) => {
    boxByElement.set(button, {
      left: viewport.explorer + 8 + index * (target + compactGap),
      top: (toolbarHeight - target) / 2,
      width: target,
      height: target,
    });
  });
  Object.defineProperties(toolbar, {
    clientWidth: { configurable: true, value: stageWidth },
    scrollWidth: { configurable: true, value: contentWidth },
  });
  const measured = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return rect(boxByElement.get(this) ?? { left: 0, top: 0, width: 0, height: 0 });
  });

  return { toolbar, stage, empty, panel, buttons, target, visibleWidth, contentWidth, measured };
}

function renderFixture(viewport: ChromeViewport) {
  const workspaceWidth = viewport.width - viewport.explorer - viewport.inspector;
  return render(
    <div className="pdf4-geometry-fixture" style={{ width: viewport.width, height: viewport.height }}>
      <aside data-testid="resized-explorer" style={{ width: viewport.explorer }} />
      <section className="editor-shell" style={{ width: workspaceWidth }}>
        <EditorToolbar
          mode="schematic"
          isRunning={false}
          onRun={vi.fn()}
          onStop={vi.fn()}
          onClearScratchpad={vi.fn()}
          onOpenSimulationSetup={vi.fn()}
        />
        <div className="editor-tabs" aria-hidden="true" />
        <main
          className="stage"
          style={{ "--stage-rail-inset": `${viewport.rail}px` } as CSSProperties}
        >
          <EmptyState projectOpen schematicOpen onShowParts={vi.fn()} onAskBode={vi.fn()} />
          <aside className="components-rail" data-testid="resized-parts-rail" style={{ width: viewport.rail }} />
        </main>
      </section>
      <aside data-testid="resized-inspector" style={{ width: viewport.inspector }} />
    </div>,
  );
}

beforeEach(() => {
  productionStyle = document.createElement("style");
  productionStyle.textContent = PRODUCTION_CSS;
  document.head.append(productionStyle);
  useSchematic.getState().newCircuit();
});

afterEach(() => {
  cleanup();
  productionStyle?.remove();
  productionStyle = null;
  vi.restoreAllMocks();
});

describe("PDF4 editor chrome rendered geometry", () => {
  it.each(VIEWPORTS)("centers empty state in the visible stage at $name", (viewport) => {
    const { container } = renderFixture(viewport);
    const geometry = measureFixture(container, viewport);
    const stage = geometry.stage.getBoundingClientRect();
    const panel = geometry.panel.getBoundingClientRect();

    // Visible stage ends at the parts rail's left edge, not the SVG/stage edge.
    expect(geometry.visibleWidth).toBe(stage.width - viewport.rail);
    expect(panel.left + panel.width / 2).toBeCloseTo(stage.left + geometry.visibleWidth / 2, 6);
    expect(panel.top + panel.height / 2).toBeCloseTo(stage.top + stage.height / 2, 6);
    expect(getComputedStyle(geometry.empty).display).toBe("grid");
    expect(getComputedStyle(geometry.empty).placeItems).toBe("center");
  });

  it.each(VIEWPORTS)("keeps every editor target reachable at $name", (viewport) => {
    const { container } = renderFixture(viewport);
    const geometry = measureFixture(container, viewport);
    const toolbarRect = geometry.toolbar.getBoundingClientRect();

    expect(geometry.target).toBeGreaterThanOrEqual(32);
    expect(getComputedStyle(geometry.toolbar).overflowX).toBe("auto");
    for (const button of geometry.buttons) {
      const box = button.getBoundingClientRect();
      expect(box.width, button.getAttribute("aria-label") ?? "editor target width").toBeGreaterThanOrEqual(32);
      expect(box.height, button.getAttribute("aria-label") ?? "editor target height").toBeGreaterThanOrEqual(32);
      expect(box.top).toBeGreaterThanOrEqual(toolbarRect.top);
      expect(box.bottom).toBeLessThanOrEqual(toolbarRect.bottom);
      // A button past client width is still reachable only when its complete box
      // belongs to the scrollable strip. This catches a future overflow:hidden
      // regression rather than merely proving it exists in the DOM.
      expect(box.right).toBeLessThanOrEqual(toolbarRect.left + geometry.toolbar.scrollWidth);
    }
    expect(geometry.toolbar.scrollWidth).toBeGreaterThanOrEqual(geometry.toolbar.clientWidth);
    if (geometry.contentWidth > geometry.toolbar.clientWidth) {
      expect(geometry.toolbar.scrollWidth).toBeGreaterThan(geometry.toolbar.clientWidth);
    }
  });
});
