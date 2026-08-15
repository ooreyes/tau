// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { loadPanelWidth, usePanelWidth, PanelResizeHandle, type PanelWidthConfig } from "./panelResize";

/**
 * PDF6 item 8 - "the sliding the component window and the magnifying and home
 * tool bar feels incredibly laggy".
 *
 * The lag was React render pressure, not CSS: `usePanelWidth` committed state on
 * every `pointermove`, so each pixel of a resize re-rendered the panel and
 * everything downstream of it - on the schematic tab, the whole canvas subtree -
 * and the parts rail's edge plus the zoom cluster anchored to it trailed the
 * pointer. These tests pin the fix by COUNTING renders, because the only honest
 * measure of "faster" here is how much work a gesture asks for. The first test
 * measures both paths in one run, so the before number is observed rather than
 * remembered.
 */

// This jsdom build has localStorage disabled (the module guards on exactly
// that); install an in-memory Storage so persistence is really exercised.
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
  storageKey: "tau.test.pdf6PanelWidth",
  defaultWidth: 264,
  minWidth: 208,
  maxWidth: 480,
  edge: "left",
  ...over,
});

let renders = 0;

/**
 * The shape every real caller has: the panel applies the hook's width to its own
 * inline style and renders the separator inside itself (`.components-rail`,
 * `.explorer-panel`, `.assistant-panel`, `.results-drawer`).
 *
 * `sizes` publishes the width a second time as a custom property on an ancestor,
 * the way App publishes the parts rail as `--stage-rail-inset` on the stage for
 * the floating zoom cluster to sit clear of.
 */
function LivePanel({
  cfg,
  handleMax,
  applyInlineWidth = true,
}: {
  cfg: PanelWidthConfig;
  handleMax?: number;
  applyInlineWidth?: boolean;
}) {
  renders += 1;
  const resize = usePanelWidth(cfg);
  return (
    <div data-testid="stage" style={{ "--stage-rail-inset": `${resize.width}px` } as React.CSSProperties}>
      <aside data-testid="panel" style={applyInlineWidth ? { width: resize.width } : undefined}>
        <PanelResizeHandle
          edge={cfg.edge}
          label="Resize test panel"
          width={resize.width}
          minWidth={cfg.minWidth}
          maxWidth={handleMax ?? cfg.maxWidth}
          dragging={resize.dragging}
          onPointerDown={resize.onPointerDown}
          onKeyDown={resize.onKeyDown}
        />
      </aside>
    </div>
  );
}

const panel = () => screen.getByTestId("panel") as HTMLElement;
const panelWidth = () => Number.parseInt(panel().style.width, 10);
const handle = () => screen.getByRole("separator");

/** Drag the border of a right-docked panel `distance` px to the left (= wider),
 *  in `samples` pointer moves, and report how many renders the gesture cost. */
function drag(distance: number, samples: number): { duringMoves: number; total: number } {
  const before = renders;
  fireEvent.pointerDown(handle(), { button: 0, clientX: 800, pointerId: 1 });
  const afterDown = renders;
  for (let step = 1; step <= samples; step += 1) {
    fireEvent.pointerMove(window, { clientX: 800 - (distance * step) / samples, pointerId: 1 });
  }
  const duringMoves = renders - afterDown;
  fireEvent.pointerUp(window, { pointerId: 1 });
  return { duringMoves, total: renders - before };
}

describe("PDF6 item 8 - panel resize render pressure", () => {
  it("commits React state once for a whole drag while the edge tracks every sample", () => {
    // Before: the same 30-sample gesture on a panel that does NOT publish an
    // inline size, which is the path the hook used to take for everything.
    render(<LivePanel cfg={config()} applyInlineWidth={false} />);
    const fallback = drag(120, 30);
    expect(fallback.duringMoves).toBe(30);
    cleanup();

    // After: identical gesture, on the panel shape every real caller has. The
    // storage reset is what makes the two comparable - the first drag persisted
    // its result, and a second panel restoring it would start 120px wider.
    localStorage.clear();
    renders = 0;
    render(<LivePanel cfg={config()} />);
    const live = drag(120, 30);
    // Zero renders between pointerdown and pointerup: 30 -> 0.
    expect(live.duringMoves).toBe(0);
    // The saving is the samples and nothing but the samples: the rest of the
    // gesture (raising the drag flag, and the release that commits the size) is
    // untouched, so the whole-gesture count drops by exactly the 30 moves.
    expect(live.total).toBe(fallback.total - 30);
    // And it is live, not deferred: the panel wore each sample as it arrived.
    expect(panelWidth()).toBe(384);
  });

  it("paints every sample of the drag, not just the released size", () => {
    render(<LivePanel cfg={config()} />);
    fireEvent.pointerDown(handle(), { button: 0, clientX: 800, pointerId: 1 });
    const seen: number[] = [];
    for (const x of [790, 760, 700, 640, 641]) {
      fireEvent.pointerMove(window, { clientX: x, pointerId: 1 });
      seen.push(panelWidth());
    }
    expect(seen).toEqual([274, 304, 364, 424, 423]);
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("keeps the width a second surface publishes in step with the panel", () => {
    // App publishes the rail's width as `--stage-rail-inset` on the stage, and
    // the canvas zoom cluster is positioned from it. React is idle during the
    // drag, so if the gesture did not carry that value too, the cluster would
    // freeze mid-slide and jump on release - which is the half of the report
    // about "the magnifying and home tool bar".
    render(<LivePanel cfg={config()} />);
    fireEvent.pointerDown(handle(), { button: 0, clientX: 800, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 700, pointerId: 1 });
    expect(panelWidth()).toBe(364);
    expect(screen.getByTestId("stage").style.getPropertyValue("--stage-rail-inset")).toBe("364px");
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(screen.getByTestId("stage").style.getPropertyValue("--stage-rail-inset")).toBe("364px");
  });

  it("still clamps to min/max during the drag, not only at the end", () => {
    render(<LivePanel cfg={config()} />);
    fireEvent.pointerDown(handle(), { button: 0, clientX: 800, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: -2000, pointerId: 1 });
    expect(panelWidth()).toBe(480);
    fireEvent.pointerMove(window, { clientX: 4000, pointerId: 1 });
    expect(panelWidth()).toBe(208);
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(panelWidth()).toBe(208);
  });

  it("stops the live edge at the tighter ceiling the separator publishes", () => {
    // A responsive host (componentsRailMaxWidth, resolveAnalysisPane, the
    // drawer's measured host) renders a smaller maximum than the static config
    // and announces it on the separator. Following the pointer past that wall
    // and snapping back on release is what a control that "ignores the first
    // third of a gesture" feels like.
    render(<LivePanel cfg={config()} handleMax={320} />);
    fireEvent.pointerDown(handle(), { button: 0, clientX: 800, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 400, pointerId: 1 });
    expect(panelWidth()).toBe(320);
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("persists exactly the released size, on pointerup and on pointercancel", () => {
    render(<LivePanel cfg={config()} />);
    drag(60, 8);
    expect(panelWidth()).toBe(324);
    expect(loadPanelWidth(config())).toBe(324);

    // A cancelled gesture persists what it reached, exactly as before: the
    // pointer was lifted by the system, not the size withdrawn by the user.
    fireEvent.pointerDown(handle(), { button: 0, clientX: 800, pointerId: 2 });
    fireEvent.pointerMove(window, { clientX: 780, pointerId: 2 });
    fireEvent.pointerCancel(window, { pointerId: 2 });
    expect(panelWidth()).toBe(344);
    expect(loadPanelWidth(config())).toBe(344);
  });

  it("reports the live size to a render caused by something else mid-drag", () => {
    // A drag deliberately leaves React state behind, so an unrelated render (a
    // running simulation, a streaming answer) must not stamp the stale committed
    // width back over the panel the user is still dragging.
    let bumpNeighbour: (() => void) | null = null;
    function Host() {
      const [tick, setTick] = useState(0);
      bumpNeighbour = () => setTick((value) => value + 1);
      return (
        <>
          <span data-testid="tick">{tick}</span>
          <LivePanel cfg={config()} />
        </>
      );
    }
    render(<Host />);
    fireEvent.pointerDown(handle(), { button: 0, clientX: 800, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 700, pointerId: 1 });
    expect(panelWidth()).toBe(364);

    act(() => bumpNeighbour?.());
    expect(screen.getByTestId("tick").textContent).toBe("1");
    expect(panelWidth()).toBe(364);
    expect(handle().getAttribute("aria-valuenow")).toBe("364");

    // ...and the size that gesture reaches is still the one that gets stored.
    fireEvent.pointerMove(window, { clientX: 660, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(loadPanelWidth(config())).toBe(404);
  });

  it("stops a gesture in flight when the panel unmounts", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<LivePanel cfg={config()} />);
    fireEvent.pointerDown(handle(), { button: 0, clientX: 800, pointerId: 1 });

    unmount();

    const removed = remove.mock.calls.map(([type]) => type);
    expect(removed).toContain("pointermove");
    expect(removed).toContain("pointerup");
    expect(removed).toContain("pointercancel");
    // Nothing left listening, so a late sample cannot write to a detached panel.
    expect(() => fireEvent.pointerMove(window, { clientX: 600, pointerId: 1 })).not.toThrow();
  });
});
