// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  clampPanelWidth,
  loadPanelWidth,
  savePanelWidth,
  usePanelWidth,
  PanelResizeHandle,
  type PanelWidthConfig,
} from "./panelResize";

// This jsdom build has localStorage disabled (typeof localStorage ===
// "undefined" — the same guard the module itself relies on). Install an
// in-memory Storage so the persistence path is actually exercised.
const backing = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => void backing.set(key, String(value)),
    removeItem: (key: string) => void backing.delete(key),
    clear: () => backing.clear(),
    key: (index: number) => [...backing.keys()][index] ?? null,
    get length() {
      return backing.size;
    },
  } as Storage,
});

afterEach(() => cleanup());
beforeEach(() => localStorage.clear());

const config = (over: Partial<PanelWidthConfig> = {}): PanelWidthConfig => ({
  storageKey: "tau.test.panelWidth",
  defaultWidth: 264,
  minWidth: 200,
  maxWidth: 480,
  edge: "left",
  ...over,
});

describe("clampPanelWidth", () => {
  it("clamps to min/max and rounds to whole pixels", () => {
    expect(clampPanelWidth(300.4, 200, 480)).toBe(300);
    expect(clampPanelWidth(120, 200, 480)).toBe(200);
    expect(clampPanelWidth(9999, 200, 480)).toBe(480);
    expect(clampPanelWidth(-50, 200, 480)).toBe(200);
  });
});

describe("loadPanelWidth / savePanelWidth", () => {
  it("returns the default when nothing is stored", () => {
    expect(loadPanelWidth(config())).toBe(264);
  });

  it("round-trips a saved width", () => {
    savePanelWidth("tau.test.panelWidth", 333);
    expect(loadPanelWidth(config())).toBe(333);
  });

  it("falls back to the default on unparsable junk", () => {
    localStorage.setItem("tau.test.panelWidth", "not-a-number");
    expect(loadPanelWidth(config())).toBe(264);
    localStorage.setItem("tau.test.panelWidth", "");
    expect(loadPanelWidth(config())).toBe(264);
  });

  it("clamps a stored width that is outside the CURRENT min/max", () => {
    // e.g. bounds tightened in a later release than the one that saved it.
    localStorage.setItem("tau.test.panelWidth", "5000");
    expect(loadPanelWidth(config())).toBe(480);
    localStorage.setItem("tau.test.panelWidth", "10");
    expect(loadPanelWidth(config())).toBe(200);
  });
});

function Harness({ cfg }: { cfg: PanelWidthConfig }) {
  const resize = usePanelWidth(cfg);
  return (
    <aside data-testid="panel" style={{ width: resize.width }}>
      <PanelResizeHandle
        edge={cfg.edge}
        label="Resize test panel"
        width={resize.width}
        minWidth={cfg.minWidth}
        maxWidth={cfg.maxWidth}
        dragging={resize.dragging}
        onPointerDown={resize.onPointerDown}
        onKeyDown={resize.onKeyDown}
      />
    </aside>
  );
}

const panelWidth = () =>
  Number.parseInt((screen.getByTestId("panel") as HTMLElement).style.width, 10);

describe("usePanelWidth drag behavior", () => {
  it("edge=left (right-docked panel): dragging the border left widens", () => {
    render(<Harness cfg={config({ edge: "left" })} />);
    const handle = screen.getByRole("separator");
    fireEvent.pointerDown(handle, { button: 0, clientX: 400, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 340, pointerId: 1 }); // 60px left
    expect(panelWidth()).toBe(324);
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(loadPanelWidth(config())).toBe(324); // persisted on release
  });

  it("edge=right (left-docked panel): dragging the border right widens", () => {
    render(<Harness cfg={config({ edge: "right", defaultWidth: 226 })} />);
    const handle = screen.getByRole("separator");
    fireEvent.pointerDown(handle, { button: 0, clientX: 226, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 300, pointerId: 1 });
    expect(panelWidth()).toBe(300);
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("clamps during the drag, not just at the end", () => {
    render(<Harness cfg={config({ edge: "left" })} />);
    const handle = screen.getByRole("separator");
    fireEvent.pointerDown(handle, { button: 0, clientX: 400, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: -2000, pointerId: 1 });
    expect(panelWidth()).toBe(480); // max
    fireEvent.pointerMove(window, { clientX: 4000, pointerId: 1 });
    expect(panelWidth()).toBe(200); // min
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("ignores non-primary buttons and stops tracking after release", () => {
    render(<Harness cfg={config({ edge: "left" })} />);
    const handle = screen.getByRole("separator");
    fireEvent.pointerDown(handle, { button: 2, clientX: 400, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 300, pointerId: 1 });
    expect(panelWidth()).toBe(264); // untouched
    fireEvent.pointerDown(handle, { button: 0, clientX: 400, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 200, pointerId: 1 });
    expect(panelWidth()).toBe(264); // released — moves no longer resize
  });

  it("resizes and persists via arrow keys (separator keyboard support)", () => {
    render(<Harness cfg={config({ edge: "left" })} />);
    const handle = screen.getByRole("separator");
    fireEvent.keyDown(handle, { key: "ArrowLeft" }); // border left = wider
    expect(panelWidth()).toBe(280);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(panelWidth()).toBe(264);
    expect(loadPanelWidth(config())).toBe(264);
  });

  it("exposes the separator ARIA value state", () => {
    render(<Harness cfg={config()} />);
    const handle = screen.getByRole("separator");
    expect(handle.getAttribute("aria-valuenow")).toBe("264");
    expect(handle.getAttribute("aria-valuemin")).toBe("200");
    expect(handle.getAttribute("aria-valuemax")).toBe("480");
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
  });
});
