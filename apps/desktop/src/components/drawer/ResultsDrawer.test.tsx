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
 * - A collapsed surface is unmounted, never translated off-screen. A hidden
 *   panel that stays in the accessibility tree makes `getByRole` ambiguous
 *   and lets a screen-reader user tab into something nobody can see.
 * - Escape only collapses the drawer when focus is inside it. Canvas-focused
 *   Escape has to keep meaning "cancel the current tool", and a document-level
 *   listener that does not check silently takes that over.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ResultsDrawer, RESULTS_DRAWER_NAME } from "./ResultsDrawer";

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
  it("unmounts its body at peek rather than hiding it", () => {
    renderDrawer({ preferredHeight: "peek" });
    // Not `toBeVisible`: a translated-off-screen panel passes that and still
    // sits in the accessibility tree. Absence is the assertion.
    expect(screen.queryByText("Waveform control")).toBeNull();
    expect(drawer().className).toContain("results-drawer--peek");
  });

  it("cycles peek to half to full and back on its one control", () => {
    renderDrawer({ preferredHeight: "peek" });
    const size = () => screen.getByRole("button", { name: /^Resize results/ });

    expect(size().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(size());
    expect(drawer().className).toContain("results-drawer--half");
    expect(screen.getByText("Waveform control")).toBeTruthy();
    expect(size().getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(size());
    expect(drawer().className).toContain("results-drawer--full");
    fireEvent.click(size());
    expect(drawer().className).toContain("results-drawer--peek");
    expect(screen.queryByText("Waveform control")).toBeNull();
  });

  it("adopts what the mode wants when the mode changes", () => {
    // The specific regression: the drawer mounted in the schematic (peek, on
    // Errors), and treating those as mount-only defaults left it collapsed on
    // Errors after switching to the simulator, where the whole point is that
    // the waveforms are in front of you.
    const { rerender } = render(
      <ResultsDrawer status="idle" preferredHeight="peek" preferredTab="errors" errors={<div>Diagnostics</div>} />,
    );
    expect(screen.queryByText("Diagnostics")).toBeNull();

    rerender(
      <ResultsDrawer
        status="complete"
        preferredHeight="half"
        preferredTab="waveforms"
        waveforms={<div>Plots</div>}
        errors={<div>Diagnostics</div>}
      />,
    );
    expect(screen.getByText("Plots")).toBeTruthy();
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
    expect(screen.getByText("X1: subcircuit instance not imported")).toBeTruthy();
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
    expect(screen.getByText("Waveform control")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Errors/ }).textContent).toContain("2");
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

  it("does not offer a tab with no content behind it", () => {
    // The schematic has no waveforms, and a tab that opens onto nothing is
    // worse than an absent one: it reads as a broken feature.
    renderDrawer({ waveforms: null, measurements: null });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Errors"]);
    expect(screen.getByText("Diagnostics")).toBeTruthy();
  });

  it("falls back to a real tab when the active one stops being offered", () => {
    const { rerender } = renderDrawer({ preferredTab: "waveforms" });
    expect(screen.getByText("Waveform control")).toBeTruthy();

    // Leaving the simulator drops Waveforms. A stale `tab` would leave an
    // empty body under a tab strip that no longer contains it.
    rerender(
      <ResultsDrawer status="complete" preferredHeight="half" waveforms={null} errors={<div>Diagnostics</div>} />,
    );
    expect(screen.getByText("Diagnostics")).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });

  it("switches body with the tab", () => {
    renderDrawer();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Measurements" }), { button: 0 });
    expect(screen.getByText("Measurement rows")).toBeTruthy();
    expect(screen.queryByText("Waveform control")).toBeNull();
  });
});

describe("results drawer - Escape belongs to whatever holds focus", () => {
  it("collapses to peek when Escape arrives with focus inside", () => {
    renderDrawer();
    const control = screen.getByText("Waveform control");
    control.focus();
    expect(document.activeElement).toBe(control);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(drawer().className).toContain("results-drawer--peek");
    // Peek unmounts the body, so focus has to be moved deliberately or the
    // browser drops it to <body> and the next Tab restarts from the top.
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
      expect(screen.getByText("Waveform control")).toBeTruthy();
    } finally {
      outside.remove();
    }
  });

  it("does not act on an Escape another surface already handled", () => {
    renderDrawer();
    screen.getByText("Waveform control").focus();
    const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    event.preventDefault();
    document.dispatchEvent(event);
    expect(drawer().className).toContain("results-drawer--half");
  });
});
