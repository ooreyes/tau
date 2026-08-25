// @vitest-environment jsdom
/**
 * The results drawer's own behaviour, none of which existed before stage 4a.
 *
 * The state word, the run facts and the issue count moved here out of the
 * analysis panel, so the assertions that used to sit in SimulationPanel's
 * status-strip tests are re-made here against the surface that now owns them.
 * The rest is new: three heights, three tabs, and the two focus rules the
 * redesign brief calls correctness rather than style.
 *
 * The rules being pinned, and why each is a bug rather than a preference:
 *
 * - A collapsed or inactive panel is out of the ACCESSIBILITY TREE, never
 *   merely translated off-screen: one that stays in the tree makes `getByRole`
 *   ambiguous and lets a screen-reader user tab into something nobody can see.
 * - ...but it stays MOUNTED. Unmounting would satisfy the rule above and
 *   destroy the analysis panel's cursors, typed expressions and imported
 *   reference data every time someone glanced at Measurements.
 * - Escape only collapses the drawer when focus is inside it. Canvas-focused
 *   Escape has to keep meaning "cancel the current tool", and a document-level
 *   listener that does not check silently takes that over.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ResultsDrawer, RESULTS_DRAWER_NAME } from "./ResultsDrawer";

// This jsdom build has localStorage disabled (typeof localStorage ===
// "undefined", the guard panelResize relies on). Install an in-memory Storage
// so the drawer's persisted drag height is actually exercised rather than
// silently skipped - same shim as panelResize.test.tsx.
const storageBacking = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storageBacking.get(key) ?? null,
    setItem: (key: string, value: string) => void storageBacking.set(key, String(value)),
    removeItem: (key: string) => void storageBacking.delete(key),
    clear: () => storageBacking.clear(),
    key: (index: number) => [...storageBacking.keys()][index] ?? null,
    get length() {
      return storageBacking.size;
    },
  } as Storage,
});

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

function renderDrawer(overrides: Partial<Parameters<typeof ResultsDrawer>[0]> = {}) {
  return render(
    <ResultsDrawer
      status="complete"
      statusLine="30 ms · 3001 samples"
      waveforms={<button type="button">Waveform control</button>}
      measurements={<div>Measurement rows</div>}
      errors={<div>Diagnostics</div>}
      {...overrides}
    />,
  );
}

const drawer = () => screen.getByRole("complementary", { name: RESULTS_DRAWER_NAME });

/**
 * The text of whichever tab panel is actually on screen.
 *
 * Every offered panel stays mounted so SimulationPanel does not lose the
 * thirty-odd pieces of state no store owns (typed expressions, cursors, trace
 * colours, imported reference data) on a click to Measurements and back. The
 * ones not showing carry `hidden`, which computes to `display: none` and takes
 * them out of the accessibility tree - that is the rule, and it is why these
 * assertions go through roles and the `hidden` attribute rather than through
 * `queryByText`, which happily finds a `display: none` node.
 */
const shownBody = () =>
  [...document.querySelectorAll<HTMLElement>(".results-drawer-body")]
    .filter((panel) => !panel.hidden)
    .map((panel) => panel.textContent)
    .join("|");

describe("results drawer - the readout that survives a collapse", () => {
  it("states what happened and what it cost, in one line", () => {
    renderDrawer();
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Complete");
    expect(status.textContent).toContain("30 ms · 3001 samples");
  });

  it("colours the lamp by state, never by mode", () => {
    const { rerender } = renderDrawer({ status: "running" });
    expect(drawer().querySelector(".results-drawer-status--running")).not.toBeNull();

    rerender(<ResultsDrawer status="error" statusLine="singular matrix" errors={<div>Diagnostics</div>} />);
    expect(drawer().querySelector(".results-drawer-status--error")).not.toBeNull();
    expect(screen.getByRole("status").textContent).toContain("singular matrix");
  });

  it("keeps the whole readout legible when collapsed to peek", () => {
    renderDrawer({ preferredHeight: "peek", errorBadge: { text: "2", tone: "warning" } });
    // Peek is why there is no restore orb: it still says what happened, how
    // long it took, and that there are two things to look at.
    expect(screen.getByRole("status").textContent).toContain("Complete");
    expect(screen.getByRole("status").textContent).toContain("3001 samples");
    expect(screen.getByRole("tab", { name: /Errors/ }).textContent).toContain("2");
  });

  it("offers Stop only while a run is in flight", () => {
    const onStop = vi.fn();
    const { rerender } = renderDrawer({ status: "complete", onStop });
    expect(screen.queryByRole("button", { name: "Stop simulation" })).toBeNull();

    rerender(<ResultsDrawer status="running" onStop={onStop} waveforms={<div>Plots</div>} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop simulation" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

describe("results drawer - heights", () => {
  it("takes its body out of the accessibility tree at peek", () => {
    renderDrawer({ preferredHeight: "peek" });
    // Not `toBeVisible`, and not "is it in the DOM": a translated-off-screen
    // panel passes both and is still fully exposed to a screen reader. What
    // has to be true is that nothing in there is reachable.
    expect(screen.queryByRole("button", { name: "Waveform control" })).toBeNull();
    expect(shownBody()).toBe("");
    expect(drawer().className).toContain("results-drawer--peek");
  });

  it("cycles peek to half to full and back on its one control", () => {
    renderDrawer({ preferredHeight: "peek" });
    const size = () => screen.getByRole("button", { name: /^Resize results/ });

    expect(size().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(size());
    expect(drawer().className).toContain("results-drawer--half");
    expect(screen.getByRole("button", { name: "Waveform control" })).toBeTruthy();
    expect(size().getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(size());
    expect(drawer().className).toContain("results-drawer--full");
    fireEvent.click(size());
    expect(drawer().className).toContain("results-drawer--peek");
    expect(screen.queryByRole("button", { name: "Waveform control" })).toBeNull();
  });

  it("adopts what the mode wants when the mode changes", () => {
    // The specific regression: the drawer mounted in the schematic (peek, on
    // Errors), and treating those as mount-only defaults left it collapsed on
    // Errors after switching to the simulator, where the whole point is that
    // the waveforms are in front of you.
    const { rerender } = render(
      <ResultsDrawer status="idle" preferredHeight="peek" preferredTab="errors" errors={<div>Diagnostics</div>} />,
    );
    expect(shownBody()).toBe("");

    rerender(
      <ResultsDrawer
        status="complete"
        preferredHeight="half"
        preferredTab="waveforms"
        waveforms={<div>Plots</div>}
        errors={<div>Diagnostics</div>}
      />,
    );
    expect(shownBody()).toBe("Plots");
    expect(drawer().className).toContain("results-drawer--half");
  });

  it("opens onto Errors when it mounts with issues already waiting", () => {
    // Dropping a netlist into an empty workspace opens the first schematic
    // and produces its import warnings in the same commit, so the drawer's
    // first render already has them. Treating only later changes as new left
    // "Opened with 1 warning" as a dead end with no way to read it.
    render(
      <ResultsDrawer
        status="idle"
        preferredHeight="peek"
        errorBadge={{ text: "1", tone: "warning" }}
        errors={<div>X1: subcircuit instance not imported</div>}
      />,
    );
    expect(shownBody()).toContain("X1: subcircuit instance not imported");
    expect(drawer().className).toContain("results-drawer--half");
  });

  it("leaves an already-open drawer on the tab the reader chose", () => {
    const { rerender } = renderDrawer({ preferredTab: "waveforms" });
    rerender(
      <ResultsDrawer
        status="complete"
        waveforms={<button type="button">Waveform control</button>}
        errors={<div>Diagnostics</div>}
        errorBadge={{ text: "2", tone: "warning" }}
      />,
    );
    // The count is on the Errors tab either way. Yanking someone off their
    // plots mid-run to show a warning they can already see is worse.
    expect(shownBody()).toBe("Waveform control");
    expect(screen.getByRole("tab", { name: /Errors/ }).textContent).toContain("2");
  });

  it("stops yanking itself open when only the live edit count moved (P3-14)", () => {
    // The auto-raise above was written for import warnings, which arrive once.
    // The Errors surface now also counts LIVE document diagnostics, so the
    // badge changes on almost every keystroke - place a part and two
    // floating-pin rows appear, wire it and they go. Raising a deliberately
    // peeked drawer each time would fight the person drawing the circuit.
    const { rerender } = render(
      <ResultsDrawer
        status="idle"
        preferredHeight="peek"
        errorBadge={{ text: "3", tone: "error" }}
        badgeRaiseKey={null}
        errors={<div>Diagnostics</div>}
      />,
    );
    expect(drawer().className).toContain("results-drawer--peek");

    // Same key, different count: still an edit, still no interruption.
    rerender(
      <ResultsDrawer
        status="idle"
        preferredHeight="peek"
        errorBadge={{ text: "5", tone: "error" }}
        badgeRaiseKey={null}
        errors={<div>Diagnostics</div>}
      />,
    );
    expect(drawer().className).toContain("results-drawer--peek");

    // A run failing or an import reporting is what the raise was FOR, and the
    // caller says so by moving the key.
    rerender(
      <ResultsDrawer
        status="error"
        preferredHeight="peek"
        errorBadge={{ text: "6", tone: "error" }}
        badgeRaiseKey="run:singular matrix"
        errors={<div>Diagnostics</div>}
      />,
    );
    expect(drawer().className).toContain("results-drawer--half");
  });

  it("raises itself when a run lands, but not merely because it mounted", () => {
    const { rerender } = render(
      <ResultsDrawer status="idle" preferredHeight="peek" raiseSignal={0} errors={<div>Diagnostics</div>} />,
    );
    // An effect keyed on a value fires once at mount. Without the skip, the
    // drawer would open the moment the app did, overriding the peek the
    // schematic asks for, before anything had run.
    expect(drawer().className).toContain("results-drawer--peek");

    rerender(
      <ResultsDrawer status="complete" preferredHeight="peek" raiseSignal={1} errors={<div>Diagnostics</div>} />,
    );
    expect(drawer().className).toContain("results-drawer--half");
  });
});

describe("results drawer - tabs", () => {
  it("shows one tab per surface that has something to show", () => {
    renderDrawer();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Waveforms",
      "Measurements",
      "Errors",
    ]);
  });

  it("renders the ONE surface it has as a section heading, not as a one-tab strip (was: a single Errors tab)", () => {
    // The schematic has no waveforms, and a tab that opens onto nothing is
    // worse than an absent one: it reads as a broken feature.
    //
    // The expectation moved with P3-14. This used to assert
    // `getAllByRole("tab") === ["Errors"]`, which was a chooser with one
    // choice - and once the schematic dock became Errors-only that is the
    // state it lives in permanently. A tab you can never switch away from is
    // a heading; the report asks for "just having an errors section". A
    // `role="tabpanel"` with no `tablist` was also invalid ARIA.
    renderDrawer({ waveforms: null, measurements: null, errorBadge: { text: "3", tone: "error" } });
    expect(screen.queryAllByRole("tab")).toEqual([]);
    const heading = screen.getByRole("heading", { name: /Errors/ });
    expect(heading.className).toContain("results-drawer-section");
    // The count is the whole readout at peek, so it has to survive the
    // demotion from tab to heading.
    expect(heading.textContent).toContain("3");
    expect(heading.querySelector(".results-drawer-badge--error")).not.toBeNull();
    expect(shownBody()).toBe("Diagnostics");
    // The body is no longer a tabpanel, because nothing labels it as one.
    const body = document.querySelector(".results-drawer-body")!;
    expect(body.getAttribute("role")).toBeNull();
    expect(body.getAttribute("aria-labelledby")).toBeNull();
  });

  it("falls back to the surface that is still offered when the active one goes (was: to a one-tab strip)", () => {
    const { rerender } = renderDrawer({ preferredTab: "waveforms" });
    expect(shownBody()).toBe("Waveform control");

    // Leaving the simulator drops Waveforms. A stale `tab` would leave an
    // empty body under a tab strip that no longer contains it.
    rerender(
      <ResultsDrawer status="complete" preferredHeight="half" waveforms={null} errors={<div>Diagnostics</div>} />,
    );
    expect(shownBody()).toBe("Diagnostics");
    // Moved with P3-14: what is left is one surface, so the strip goes away
    // entirely rather than shrinking to a single tab. Previously
    // `getAllByRole("tab")).toHaveLength(1)`.
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "Errors" })).toBeTruthy();
  });

  it("switches body with the tab", () => {
    renderDrawer();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Measurements" }), { button: 0 });
    expect(shownBody()).toBe("Measurement rows");
    expect(screen.queryByRole("button", { name: "Waveform control" })).toBeNull();
  });

  it("keeps the panel it switched away from, node for node", () => {
    // The whole reason the inactive panels are hidden rather than removed.
    // SimulationPanel owns about thirty pieces of state no store holds -
    // expression traces the user typed, cursor positions, per-trace colours,
    // reference `.raw` data imported from disk. Same node means same React
    // instance means all of it survived the round trip.
    renderDrawer();
    const waveforms = screen.getByRole("button", { name: "Waveform control" });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Measurements" }), { button: 0 });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Waveforms" }), { button: 0 });
    expect(screen.getByRole("button", { name: "Waveform control" })).toBe(waveforms);
  });

  it("opens onto the tab that was clicked, from peek", () => {
    // The strip stays legible at peek, badge and all, so clicking Errors on
    // the strength of that badge has to do something. It used to move the
    // underline and nothing else.
    renderDrawer({ preferredHeight: "peek" });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Errors" }), { button: 0 });
    expect(drawer().className).toContain("results-drawer--half");
    expect(shownBody()).toBe("Diagnostics");
  });

  it("points each tab at its own panel, and each panel back at its tab", () => {
    // One shared id used to go to all three, naming an element that stopped
    // existing the moment the drawer collapsed. `aria-controls` has to
    // resolve, and a tab has to control a tabpanel.
    renderDrawer();
    for (const label of ["Waveforms", "Measurements", "Errors"]) {
      const tab = screen.getByRole("tab", { name: new RegExp(`^${label}`) });
      const panel = document.getElementById(tab.getAttribute("aria-controls") ?? "");
      expect(panel, `${label} controls nothing`).not.toBeNull();
      expect(panel!.getAttribute("role")).toBe("tabpanel");
      expect(panel!.getAttribute("aria-labelledby")).toBe(tab.id);
    }
  });
});

describe("results drawer - Escape belongs to whatever holds focus", () => {
  it("collapses to peek when Escape arrives with focus inside", () => {
    renderDrawer();
    const control = screen.getByRole("button", { name: "Waveform control" });
    control.focus();
    expect(document.activeElement).toBe(control);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(drawer().className).toContain("results-drawer--peek");
    // Peek hides the body, so focus has to be moved deliberately or it sits
    // on a `display: none` node, the browser drops it to <body>, and the next
    // Tab restarts from the top of the document.
    expect(drawer().contains(document.activeElement)).toBe(true);
  });

  it("ignores Escape when focus is outside, so the canvas keeps it", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    try {
      renderDrawer();
      outside.focus();
      fireEvent.keyDown(document, { key: "Escape" });
      // Still open. On the canvas, Escape cancels the current tool; a drawer
      // that swallowed it would take that away from every schematic gesture.
      expect(drawer().className).toContain("results-drawer--half");
      expect(shownBody()).toBe("Waveform control");
    } finally {
      outside.remove();
    }
  });

  it("does not act on an Escape another surface already handled", () => {
    renderDrawer();
    screen.getByRole("button", { name: "Waveform control" }).focus();
    const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    event.preventDefault();
    document.dispatchEvent(event);
    expect(drawer().className).toContain("results-drawer--half");
  });
});

/**
 * The second dock: the simulator's analysis pane, beside the circuit.
 *
 * Every case above renders without `orientation` and is therefore the bottom
 * drawer, unchanged. That is the point of making the dock an explicit prop
 * rather than inferring it from a measured width - in JSDOM every rect is
 * zero, so an inferred dock would have made all of them silently exercise
 * whichever branch zero happens to select.
 */
describe("results drawer - docked right", () => {
  /**
   * The one measurement JSDOM will not give us for free, stubbed.
   *
   * `getBoundingClientRect` returns all zeros in JSDOM, which is exactly why
   * the cover-axis bug was invisible: a scalar `height` cover reads 0 in every
   * test and ~700 in the real window. Stubbing a plausible pane rect - narrow
   * and full-column-height - is the only way to assert which axis is being
   * charged, and that assertion is the whole reason `DrawerCover` is a pair.
   */
  function stubPaneRect(width: number, height: number) {
    const spy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    return () => spy.mockRestore();
  }

  it("charges its width to the right axis and nothing to the bottom", () => {
    const restore = stubPaneRect(480, 700);
    try {
      const onCoverChange = vi.fn();
      renderDrawer({ orientation: "right", onCoverChange });
      // 700 is the full column height. Reported as `bottom` it would flow into
      // Canvas's `fitInsetBottom` and into `inspectorViewport.maxY`, leaving
      // the inspector an 8px-tall band to live in - no crash, no failing
      // assertion anywhere, just a shell that does not work.
      expect(onCoverChange).toHaveBeenLastCalledWith({ bottom: 0, right: 480 });
    } finally {
      restore();
    }
  });

  it("charges its height to the bottom axis when docked bottom", () => {
    const restore = stubPaneRect(480, 700);
    try {
      const onCoverChange = vi.fn();
      renderDrawer({ onCoverChange });
      expect(onCoverChange).toHaveBeenLastCalledWith({ bottom: 700, right: 0 });
    } finally {
      restore();
    }
  });

  it("retracts both axes when it unmounts", () => {
    const restore = stubPaneRect(480, 700);
    try {
      const onCoverChange = vi.fn();
      const { unmount } = renderDrawer({ orientation: "right", onCoverChange });
      unmount();
      // Otherwise the inspector keeps reserving a column for a pane that is
      // no longer on screen. The bottom dock has always retracted; the right
      // one has to as well, or switching docks leaves a stale reservation.
      expect(onCoverChange).toHaveBeenLastCalledWith({ bottom: 0, right: 0 });
    } finally {
      restore();
    }
  });

  it("offers no size control, because it has no size to cycle", () => {
    renderDrawer({ orientation: "right" });
    // The three heights answer "how much circuit am I covering?", and docked
    // right the answer is none - the circuit is beside it. A control still
    // rendered here would cycle a class with no rule behind it, which is the
    // silently-inert control the shell contract exists to forbid. Width is
    // the negotiable axis and it belongs to the divider, which App renders.
    expect(screen.queryByRole("button", { name: /^Resize results/ })).toBeNull();
  });

  it("does not wear a height class that would fight its own column", () => {
    renderDrawer({ orientation: "right", preferredHeight: "half" });
    expect(drawer().className).toContain("results-drawer--dock-right");
    for (const height of ["peek", "half", "full"]) {
      expect(drawer().className).not.toContain(`results-drawer--${height}`);
    }
  });

  it("keeps its body open through an Escape from inside", () => {
    renderDrawer({ orientation: "right" });
    screen.getByRole("button", { name: "Waveform control" }).focus();

    fireEvent.keyDown(document, { key: "Escape" });

    // There is no collapsed state here, so Escape must not invent one. If it
    // set `peek` anyway the body would vanish from the accessibility tree
    // while the pane kept its full width - a blank column with no way back,
    // because the size control that used to reopen it is gone.
    expect(shownBody()).toBe("Waveform control");
  });

  it("still switches tabs, which is the chrome that does survive the move", () => {
    renderDrawer({ orientation: "right" });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Measurements" }), { button: 0 });
    expect(shownBody()).toBe("Measurement rows");
  });
});

/**
 * The top edge is draggable (DRAWER lane).
 *
 * The reported defect: "the error window is not resizable, I should be able to
 * drag up or down". The drawer's only height control was the button that cycles
 * peek/half/full, so the three heights the stylesheet knows were the ONLY
 * heights reachable - a user who wants 260px of errors and the rest of the
 * circuit had no way to ask for it.
 *
 * These assertions go through the measured/inline geometry rather than a class
 * name on purpose: the discrete heights are percentages the stylesheet owns
 * (`height: 46%`), so the only honest evidence that a drag did something is the
 * pixel height the component put on the element.
 */
describe("results drawer - the top edge drags", () => {
  const handle = () => screen.getByRole("separator", { name: /resize results drawer/i });
  const px = () => Number.parseFloat(drawer().style.height || "0");

  /** Make the drawer measurable: jsdom rects are all zero, and the drag has to
   *  start from the height that is currently on screen. */
  const stubHeight = (height: number) => {
    const el = drawer();
    el.getBoundingClientRect = () =>
      ({ x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 600, width: 900, height, toJSON: () => ({}) }) as DOMRect;
  };

  /** Tell the drawer how tall its host column is, the way a window resize does. */
  const stubHost = (height: number) => {
    const host = drawer().parentElement as HTMLElement;
    Object.defineProperty(host, "clientHeight", { configurable: true, value: height });
    fireEvent(window, new Event("resize"));
    return host;
  };

  it("has a separator on its top edge with a name and the splitter ARIA", () => {
    renderDrawer({ preferredHeight: "half" });
    expect(handle().getAttribute("aria-orientation")).toBe("horizontal");
    // A separator that reports no range is not a splitter, it is a line.
    expect(Number(handle().getAttribute("aria-valuemin"))).toBeGreaterThan(0);
    expect(Number(handle().getAttribute("aria-valuemax"))).toBeGreaterThan(
      Number(handle().getAttribute("aria-valuemin")),
    );
  });

  it("grows when dragged up and shrinks when dragged down", () => {
    renderDrawer({ preferredHeight: "half" });
    stubHeight(300);
    stubHost(900);

    fireEvent.pointerDown(handle(), { button: 0, clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 520, pointerId: 1 }); // 80px up
    expect(px()).toBe(380);
    fireEvent.pointerMove(window, { clientY: 660, pointerId: 1 }); // 60px below the start
    expect(px()).toBe(240);
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("never drags off-screen: the head stays whole and the canvas stays usable", () => {
    renderDrawer({ preferredHeight: "half" });
    stubHeight(300);
    const host = stubHost(700);

    fireEvent.pointerDown(handle(), { button: 0, clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: -4000, pointerId: 1 });
    const atMax = px();
    // Derived from the host, not from the component's own constant: whatever
    // the maximum is, it has to leave a band of circuit worth looking at.
    expect(host.clientHeight - atMax).toBeGreaterThanOrEqual(180);
    expect(atMax).toBeGreaterThan(300); // the drag did move it
    fireEvent.pointerMove(window, { clientY: -8000, pointerId: 1 });
    expect(px()).toBe(atMax); // clamped, not creeping

    fireEvent.pointerMove(window, { clientY: 9000, pointerId: 1 });
    const atMin = px();
    // The floor keeps the head row - lamp, tabs, size control - fully visible.
    expect(atMin).toBeGreaterThanOrEqual(drawer().querySelector<HTMLElement>(".results-drawer-head")!.offsetHeight);
    expect(atMin).toBeGreaterThanOrEqual(24);
    expect(atMin).toBeLessThan(300);
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("resizes from the keyboard, both directions", () => {
    renderDrawer({ preferredHeight: "half" });
    stubHeight(300);
    stubHost(900);

    fireEvent.keyDown(handle(), { key: "ArrowLeft" }); // wrong axis
    expect(drawer().style.height).toBe("");

    fireEvent.keyDown(handle(), { key: "ArrowUp" });
    const taller = px();
    expect(taller).toBeGreaterThan(300);
    fireEvent.keyDown(handle(), { key: "ArrowDown" });
    expect(px()).toBeLessThan(taller);
  });

  it("keeps a dragged height across a reload", () => {
    const first = renderDrawer({ preferredHeight: "half" });
    stubHeight(300);
    stubHost(900);
    fireEvent.pointerDown(handle(), { button: 0, clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 555, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    const dragged = px();
    expect(dragged).toBe(345);
    first.unmount();

    renderDrawer({ preferredHeight: "half" });
    expect(px()).toBe(dragged);
  });

  it("hands the height back to the cycle button when it is clicked", () => {
    renderDrawer({ preferredHeight: "half" });
    stubHeight(300);
    stubHost(900);
    fireEvent.pointerDown(handle(), { button: 0, clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(px()).toBe(400);

    fireEvent.click(screen.getByRole("button", { name: /^Resize results/ }));
    // Last gesture wins. The override has to go, or the button - and Escape,
    // and the run-finished raise - become controls that silently do nothing.
    expect(drawer().style.height).toBe("");
    expect(drawer().className).toContain("results-drawer--full");
    // ...and the cleared choice must not come back on the next reload.
    cleanup();
    renderDrawer({ preferredHeight: "half" });
    expect(drawer().style.height).toBe("");
  });

  it("collapses on Escape even when a drag set the height", () => {
    renderDrawer({ preferredHeight: "half" });
    stubHeight(300);
    stubHost(900);
    fireEvent.pointerDown(handle(), { button: 0, clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    screen.getByRole("button", { name: "Waveform control" }).focus();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(drawer().style.height).toBe("");
    expect(shownBody()).toBe("");
  });

  it("keeps the body reachable while a drag overrides a peeked height", () => {
    renderDrawer({ preferredHeight: "peek" });
    stubHeight(34);
    stubHost(900);
    fireEvent.pointerDown(handle(), { button: 0, clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    // Dragging a peeked drawer open is the whole gesture; leaving `collapsed`
    // keyed on the stale discrete word would have grown a 234px empty box.
    expect(px()).toBeGreaterThan(200);
    expect(shownBody()).toBe("Waveform control");
  });

  it("offers no height handle docked right, where height is not negotiable", () => {
    renderDrawer({ orientation: "right" });
    expect(screen.queryByRole("separator", { name: /resize results drawer/i })).toBeNull();
  });
});

describe("results drawer resize handle - hit target", () => {
  it("gives the top-edge handle a hit area at or above the 24px floor", () => {
    // WCAG 2.2 SC 2.5.8's floor, read out of the stylesheet rather than
    // asserted as a literal: the handle asks for a token, so resolve the token
    // from App.css and check the number that actually lands on screen.
    const css = readFileSync(join(__dirname, "../../styles/resultsDrawerResize.css"), "utf8");
    const appCss = readFileSync(join(__dirname, "../../App.css"), "utf8");
    const rule = css.slice(css.indexOf(".results-drawer--dock-bottom > .panel-resize-handle--top"));
    const height = /height:\s*([^;]+);/.exec(rule)?.[1]?.trim();
    expect(height, "the top-edge handle must set its own hit height").toBeTruthy();
    const token = /var\((--[a-z-]+)\)/.exec(height!)?.[1];
    expect(token, `handle height must come from a token, got ${height}`).toBeTruthy();
    const resolved = new RegExp(`\\${token}:\\s*(\\d+)px`).exec(appCss)?.[1];
    expect(Number(resolved)).toBeGreaterThanOrEqual(24);
  });

  it("reserves the open component rail and wraps long diagnostics", () => {
    const appCss = readFileSync(join(__dirname, "../../App.css"), "utf8");
    const drawerRule = /\.results-drawer--dock-bottom\s*\{([^}]*)\}/s.exec(appCss)?.[1] ?? "";
    expect(drawerRule).toContain("right: var(--components-rail-inset, 0px)");
    const diagnosticsCss = readFileSync(join(__dirname, "../../styles/pdf6Diagnostics.css"), "utf8");
    expect(diagnosticsCss).toContain("overflow-wrap: anywhere");
    expect(diagnosticsCss).toContain("min-width: 0");
  });
});

describe("results drawer - a persisted height cannot outlive the room for it", () => {
  it("re-clamps a stored height when the window shrinks under it", () => {
    // The regression this forbids: a height dragged on a large display is
    // restored verbatim on a small one, covering the circuit entirely with no
    // visible edge left to drag back.
    localStorage.setItem("tau.resultsDrawer.height", "520");
    render(
      <ResultsDrawer
        status="complete"
        waveforms={<button type="button">Waveform control</button>}
        errors={<div>Diagnostics</div>}
      />,
    );
    const el = screen.getByRole("complementary", { name: RESULTS_DRAWER_NAME });
    const host = el.parentElement as HTMLElement;
    Object.defineProperty(host, "clientHeight", { configurable: true, value: 300 });
    fireEvent(window, new Event("resize"));

    const height = Number.parseFloat(el.style.height);
    expect(height).toBeGreaterThan(0);
    expect(host.clientHeight - height).toBeGreaterThanOrEqual(180);
  });
});

/**
 * VERIFY pass over the draggable top edge: the cases the drag itself does not
 * cover. Each of these failed before the fix in this block landed.
 */
describe("results drawer - the drag handle's edges", () => {
  const handle = () => screen.getByRole("separator", { name: /resize results drawer/i });

  const stubHeight = (height: number) => {
    const el = drawer();
    el.getBoundingClientRect = () =>
      ({ x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 600, width: 900, height, toJSON: () => ({}) }) as DOMRect;
  };
  const stubHost = (height: number) => {
    const host = drawer().parentElement as HTMLElement;
    Object.defineProperty(host, "clientHeight", { configurable: true, value: height });
    fireEvent(window, new Event("resize"));
    return host;
  };

  it("ignores a non-primary button: a right-click on the edge is not a resize", () => {
    // `usePanelWidth.onPointerDown` bails on any button but 0, so no drag
    // starts - but the drawer used to switch itself to a pixel height anyway,
    // because seeding ran first and unconditionally. On a PEEKED drawer that
    // was visible: the pixel height suppressed `collapsed` and the body
    // appeared, from a context-menu click that was never a gesture at all.
    renderDrawer({ preferredHeight: "peek" });
    stubHeight(34);
    stubHost(900);
    expect(shownBody()).toBe("");

    fireEvent.pointerDown(handle(), { button: 2, pointerId: 1, clientY: 600 });

    expect(drawer().style.height).toBe("");
    expect(shownBody()).toBe("");
    // ...and the real gesture still works right afterwards, so the guard did
    // not just disable the handle.
    fireEvent.pointerDown(handle(), { button: 0, pointerId: 2, clientY: 600 });
    fireEvent.pointerMove(window, { clientY: 400, pointerId: 2 });
    fireEvent.pointerUp(window, { pointerId: 2 });
    expect(Number.parseFloat(drawer().style.height)).toBeGreaterThan(200);
  });

  it("stays inside the window when it shrinks mid-drag", () => {
    // A drag in flight while the host shrinks (a window resize, or a side rail
    // opening) must not leave the pointer's number on screen: the ceiling that
    // moved is the one that has to be honoured.
    renderDrawer({ preferredHeight: "half" });
    stubHeight(300);
    stubHost(900);
    fireEvent.pointerDown(handle(), { button: 0, pointerId: 1, clientY: 600 });
    fireEvent.pointerMove(window, { clientY: 200, pointerId: 1 }); // 400px up
    expect(Number.parseFloat(drawer().style.height)).toBe(700);

    const host = stubHost(420); // the window shrank under the drag
    fireEvent.pointerMove(window, { clientY: 190, pointerId: 1 });
    const live = Number.parseFloat(drawer().style.height);
    expect(host.clientHeight - live).toBeGreaterThanOrEqual(180);
    fireEvent.pointerUp(window, { pointerId: 1 });
    // The size that got persisted is the clamped one, not the pointer's.
    expect(Number(localStorage.getItem("tau.resultsDrawer.height"))).toBe(live);
  });

  it("ships its geometry: the handle's stylesheet is in the app's module graph", () => {
    // The hit-target test above proves the stylesheet ASKS for a 24px+ strip.
    // It cannot prove the strip reaches a user: an unimported stylesheet
    // leaves the handle on the shared 8px rule, i.e. under the WCAG 2.2
    // SC 2.5.8 floor and with its hairline 20px adrift. Assert the import
    // exists in a shipped module, not in a test.
    const root = join(__dirname, "../..");
    const sources = ["App.tsx", "main.tsx", "components/drawer/ResultsDrawer.tsx"].map((rel) =>
      readFileSync(join(root, rel), "utf8"),
    );
    expect(
      sources.some((src) => /import\s+"[^"]*resultsDrawerResize\.css"/.test(src)),
      "resultsDrawerResize.css is not imported anywhere that ships",
    ).toBe(true);
  });
});
