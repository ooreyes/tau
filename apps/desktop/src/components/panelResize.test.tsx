// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  clampPanelWidth,
  clearPanelWidth,
  hasStoredPanelWidth,
  loadPanelWidth,
  savePanelWidth,
  usePanelWidth,
  PanelResizeHandle,
  type PanelWidthConfig,
} from "./panelResize";

// This jsdom build has localStorage disabled (typeof localStorage ===
// "undefined" - the same guard the module itself relies on). Install an
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
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
  it("reclamps a persisted width when a responsive host tightens its maximum", () => {
    const { rerender } = render(<Harness cfg={config({ defaultWidth: 420, maxWidth: 480 })} />);
    expect(panelWidth()).toBe(420);

    rerender(<Harness cfg={config({ defaultWidth: 420, maxWidth: 260 })} />);
    expect(panelWidth()).toBe(260);
    expect(screen.getByRole("separator").getAttribute("aria-valuemax")).toBe("260");
  });

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
    expect(panelWidth()).toBe(264); // released - moves no longer resize
  });

  it("removes window drag listeners if its panel unmounts mid-gesture", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<Harness cfg={config({ edge: "left" })} />);
    fireEvent.pointerDown(screen.getByRole("separator"), { button: 0, clientX: 400, pointerId: 1 });

    unmount();

    const removed = remove.mock.calls.map(([type]) => type);
    expect(removed).toContain("pointermove");
    expect(removed).toContain("pointerup");
    expect(removed).toContain("pointercancel");
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

// edge="top"/"bottom" repurpose the same machinery for a *height* (the
// simulator's telemetry dock drags its top edge) - the field names stay
// width-flavored (see PanelWidthConfig) but the pointer axis and ARIA
// orientation both flip to vertical/horizontal respectively.
describe("usePanelWidth drag behavior - vertical edges (dock height)", () => {
  it("edge=top (bottom-docked panel): dragging the border up grows the height", () => {
    render(<Harness cfg={config({ edge: "top", defaultWidth: 200, minWidth: 120, maxWidth: 400 })} />);
    const handle = screen.getByRole("separator");
    fireEvent.pointerDown(handle, { button: 0, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 340, pointerId: 1 }); // 60px up
    expect(panelWidth()).toBe(260);
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(loadPanelWidth(config({ edge: "top", defaultWidth: 200, minWidth: 120, maxWidth: 400 }))).toBe(260);
  });

  it("clamps a vertical drag to min/max", () => {
    render(<Harness cfg={config({ edge: "top", defaultWidth: 200, minWidth: 120, maxWidth: 400 })} />);
    const handle = screen.getByRole("separator");
    fireEvent.pointerDown(handle, { button: 0, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: -2000, pointerId: 1 });
    expect(panelWidth()).toBe(400); // max
    fireEvent.pointerMove(window, { clientY: 4000, pointerId: 1 });
    expect(panelWidth()).toBe(120); // min
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("resizes via ArrowUp/ArrowDown, not ArrowLeft/ArrowRight", () => {
    render(<Harness cfg={config({ edge: "top", defaultWidth: 200, minWidth: 120, maxWidth: 400 })} />);
    const handle = screen.getByRole("separator");
    fireEvent.keyDown(handle, { key: "ArrowLeft" }); // wrong axis - no-op
    expect(panelWidth()).toBe(200);
    fireEvent.keyDown(handle, { key: "ArrowUp" }); // border up = taller
    expect(panelWidth()).toBe(216);
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(panelWidth()).toBe(200);
  });

  it("exposes a horizontal ARIA orientation for a vertical-drag handle", () => {
    render(<Harness cfg={config({ edge: "top" })} />);
    expect(screen.getByRole("separator").getAttribute("aria-orientation")).toBe("horizontal");
  });
});

// `loadPanelWidth` folds "nothing stored" into the default, so a caller whose
// resting size belongs to a stylesheet (the results drawer's `height: 46%`)
// cannot use it to tell "never chosen" from "chosen, and it happens to equal
// the default". These two answer that, and let such a caller hand the axis
// back.
describe("hasStoredPanelWidth / clearPanelWidth", () => {
  it("reports only a usable stored number as stored", () => {
    expect(hasStoredPanelWidth("tau.test.panelWidth")).toBe(false);
    savePanelWidth("tau.test.panelWidth", 320);
    expect(hasStoredPanelWidth("tau.test.panelWidth")).toBe(true);
    // Junk is not a choice: the loader falls back to the default for these, so
    // claiming they are stored would put a caller on a size it never derived.
    localStorage.setItem("tau.test.panelWidth", "wide");
    expect(hasStoredPanelWidth("tau.test.panelWidth")).toBe(false);
    localStorage.setItem("tau.test.panelWidth", "   ");
    expect(hasStoredPanelWidth("tau.test.panelWidth")).toBe(false);
  });

  it("forgets a stored size", () => {
    savePanelWidth("tau.test.panelWidth", 320);
    clearPanelWidth("tau.test.panelWidth");
    expect(hasStoredPanelWidth("tau.test.panelWidth")).toBe(false);
    expect(loadPanelWidth(config())).toBe(264); // back to the default
  });

  it("survives a storage that throws (private mode / quota)", () => {
    const get = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const remove = vi.spyOn(localStorage, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(hasStoredPanelWidth("tau.test.panelWidth")).toBe(false);
    expect(() => clearPanelWidth("tau.test.panelWidth")).not.toThrow();
    get.mockRestore();
    remove.mockRestore();
  });
});
