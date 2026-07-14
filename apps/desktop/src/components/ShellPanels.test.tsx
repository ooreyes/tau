// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { BottomPanel, ComponentInspector, ComponentsRail, EditorToolbar } from "./ShellPanels";
import type { AnalysisResult } from "../simulation/linearTransient";
import { useSchematic } from "../store/useSchematic";
import { usePanelWidth } from "./panelResize";

/**
 * The simulator view is read-only outside the schematic tab (pan/zoom/probe
 * only — see Canvas's `interactive` prop and App.tsx's keydown gate). This
 * toolbar renders unconditionally regardless of `mode` (App.tsx only swaps
 * the Canvas/Palette/ExplorerPanel), so its own editing controls need their
 * own `mode` gate — this was a second, mouse-driven bypass of the same bug
 * the keyboard gate fixes (§UX).
 */

afterEach(() => cleanup());

function resetStore() {
  useSchematic.setState({
    components: [],
    wires: [],
    counters: {},
    selectedId: null,
    selectedWireId: null,
    selectedWireIds: [],
    selectedIds: [],
    selectedLabelIds: [],
    selectedProbeIds: [],
    tool: { mode: "select" },
    placeRotation: 0,
    placeMirror: false,
    clipboard: null,
    probes: [],
    netLabels: [],
    directives: [],
    past: [],
    future: [],
  });
}

beforeEach(() => resetStore());

const noopToolbarProps = {
  isRunning: false,
  onRun: () => {},
  onStep: () => {},
  onStop: () => {},
  onClearScratchpad: () => {},
};

describe("EditorToolbar — read-only outside schematic view (§UX)", () => {
  it("disables Wire, Net label, Undo, Redo, selection deletion, and Clear scratchpad in simulator mode", () => {
    const emptyDoc = { components: [], wires: [], counters: {}, probes: [], netLabels: [], directives: [] };
    // Both past and future populated so canUndo/canRedo would be true if the
    // mode gate weren't there — proves the gate, not just an empty history.
    useSchematic.setState({ past: [emptyDoc], future: [emptyDoc] });
    render(<EditorToolbar mode="simulator" {...noopToolbarProps} />);

    for (const name of ["Wire", "Net label (F4)", "Undo", "Redo", "Delete selection (Delete)", "Clear scratchpad"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("does not undo the document when the disabled Undo button is clicked in simulator mode", () => {
    useSchematic.setState({
      components: [{ id: "r-1", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" }],
      past: [{ components: [], wires: [], counters: {}, probes: [], netLabels: [], directives: [] }],
    });
    render(<EditorToolbar mode="simulator" {...noopToolbarProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(useSchematic.getState().components).toHaveLength(1); // untouched
    expect(useSchematic.getState().past).toHaveLength(1); // history untouched
  });

  it("does not arm the wire tool when the disabled Wire button is clicked in simulator mode", () => {
    render(<EditorToolbar mode="simulator" {...noopToolbarProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Wire" }));
    expect(useSchematic.getState().tool).toEqual({ mode: "select" });
  });

  it("does not open the clear-scratchpad confirmation when clicked in simulator mode", () => {
    const onClearScratchpad = vi.fn();
    render(<EditorToolbar mode="simulator" {...noopToolbarProps} onClearScratchpad={onClearScratchpad} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear scratchpad" }));
    expect(onClearScratchpad).not.toHaveBeenCalled();
  });

  it("keeps Select and Probe enabled in simulator mode (probing must still work)", () => {
    render(<EditorToolbar mode="simulator" {...noopToolbarProps} />);
    expect((screen.getByRole("button", { name: "Select" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Probe" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("enables Wire, Undo (with history), and Clear scratchpad in schematic mode", () => {
    useSchematic.setState({ past: [{ components: [], wires: [], counters: {}, probes: [], netLabels: [], directives: [] }] });
    render(<EditorToolbar mode="schematic" {...noopToolbarProps} />);

    for (const name of ["Wire", "Net label (F4)", "Undo", "Clear scratchpad"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it("offers a direct toolbar action for the selected object", () => {
    useSchematic.setState({
      components: [{ id: "r-1", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" }],
      selectedId: "r-1",
      selectedIds: ["r-1"],
    });
    render(<EditorToolbar mode="schematic" {...noopToolbarProps} />);

    const remove = screen.getByRole("button", { name: "Delete selection (Delete)" }) as HTMLButtonElement;
    expect(remove.disabled).toBe(false);
    fireEvent.click(remove);
    expect(useSchematic.getState().components).toEqual([]);
  });

  it("keeps the selection action disabled when there is nothing to remove", () => {
    render(<EditorToolbar mode="schematic" {...noopToolbarProps} />);
    expect((screen.getByRole("button", { name: "Delete selection (Delete)" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("ComponentInspector — no-selection empty state (§11 Unit A)", () => {
  it("shows the No Selection title and full helper text when nothing is selected", () => {
    render(<ComponentInspector selected={null} />);
    expect(screen.getByText("No Selection")).toBeTruthy();
    expect(
      screen.getByText(
        "Select a component, wire, node, or label to view and edit its properties.",
      ),
    ).toBeTruthy();
  });

  it("renders no input fields or dead controls when nothing is selected", () => {
    const { container } = render(<ComponentInspector selected={null} />);
    expect(container.querySelectorAll("input, select, button").length).toBe(0);
    expect(container.querySelector(".property-grid")).toBeNull();
    expect(container.querySelector(".inspector-summary.empty")).toBeTruthy();
  });
});

describe("ComponentsRail — responsive shell budget", () => {
  function Harness({ maxWidth }: { maxWidth: number }) {
    const resize = usePanelWidth({
      storageKey: "tau.test.componentsRailWidth",
      defaultWidth: 264,
      minWidth: 208,
      maxWidth,
      edge: "left",
    });
    return <ComponentsRail focusSignal={0} onNotice={() => {}} resize={resize} maxWidth={maxWidth} />;
  }

  it("renders the responsive maximum immediately when the shell tightens", () => {
    const { rerender } = render(<Harness maxWidth={240} />);

    const panel = screen.getByRole("complementary", { name: "Components" });
    expect(panel.style.width).toBe("240px");
    expect(screen.getByRole("separator", { name: "Resize properties panel" }).getAttribute("aria-valuemax")).toBe("240");

    rerender(<Harness maxWidth={208} />);
    expect(panel.style.width).toBe("208px");
    expect(screen.getByRole("separator", { name: "Resize properties panel" }).getAttribute("aria-valuemax")).toBe("208");
  });
});

describe("BottomPanel — errors tab states (§11 Unit A3)", () => {
  const failed = {
    ok: false,
    title: "Transient",
    message: "singular matrix at t=0",
    warnings: ["floating node n3"],
  } as AnalysisResult;

  it("shows a compact neutral diagnostic before a simulation has run", () => {
    const { container } = render(<BottomPanel result={null} />);
    expect(screen.getByRole("region", { name: "Simulation diagnostics" })).toBeTruthy();
    const clear = screen.getByRole("status");
    expect(clear.textContent).toContain("Not run");
    expect(container.querySelector(".bottom-panel-state svg")).toBeTruthy();
    expect(screen.getByText("Diagnostics")).toBeTruthy();
    expect(container.querySelector(".bottom-panel.has-error")).toBeNull();
    expect(container.querySelector(".bottom-panel.is-idle")).toBeTruthy();
    expect(container.querySelector(".bottom-panel.is-clean")).toBeNull();
    expect(container.querySelector(".bottom-panel.is-collapsed")).toBeTruthy();
    expect(container.querySelector(".bottom-panel-count")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Errors/ })).toBeNull();
    expect(container.querySelector(".bottom-errors")).toBeNull();
  });

  it("uses the mint all-clear state only after a successful run", () => {
    const result: AnalysisResult = {
      ok: true,
      title: "Transient",
      times: [0],
      traces: [],
      currents: [],
      stats: { netCount: 0, componentCount: 0, sampleCount: 1, stopTime: 0, stepSize: 0 },
      warnings: [],
      circuit: {} as never,
    };
    const { container } = render(<BottomPanel result={result} />);
    expect(screen.getByRole("status").textContent).toContain("No issues");
    expect(container.querySelector(".bottom-panel.is-clean")).toBeTruthy();
    expect(container.querySelector(".bottom-panel.is-idle")).toBeNull();
  });

  it("toggles an issue body from its emphasized header button", () => {
    render(<BottomPanel result={failed} />);
    const toggle = screen.getByRole("button", { name: /^Errors/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole("alert").textContent).toContain("singular matrix");
  });

  it("reopens when a newly reported issue replaces a collapsed one", () => {
    const { rerender } = render(<BottomPanel result={failed} />);
    const toggle = screen.getByRole("button", { name: /^Errors/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    rerender(<BottomPanel result={{ ...failed, message: "timestep too small" } as AnalysisResult} />);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("timestep too small");
  });

  it("goes loud with an error token and a count when the run fails", () => {
    const { container } = render(<BottomPanel result={failed} />);
    expect(container.querySelector(".bottom-panel.has-error")).toBeTruthy();
    // message + warning = 2, in the alarm-red (not warnings-only) badge
    const count = container.querySelector(".bottom-panel-count")!;
    expect(count.textContent).toBe("2");
    expect(count.classList.contains("warnings-only")).toBe(false);
    expect(screen.getByRole("alert").textContent).toBe("singular matrix at t=0");
  });

  it("uses the amber warnings-only badge when the run succeeded with warnings", () => {
    const ok = {
      ok: true,
      title: "Transient",
      times: [0],
      traces: [],
      currents: [],
      stats: { netCount: 1, componentCount: 1, sampleCount: 1, stopTime: 1, stepSize: 1 },
      warnings: ["R2 shorted by wire"],
      circuit: {} as never,
    } as AnalysisResult;
    const { container } = render(<BottomPanel result={ok} />);
    expect(container.querySelector(".bottom-panel.has-warning")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Warnings/ })).toBeTruthy();
    const count = container.querySelector(".bottom-panel-count")!;
    expect(count.textContent).toBe("1");
    expect(count.classList.contains("warnings-only")).toBe(true);
    expect(container.querySelector(".bottom-panel.has-error")).toBeNull();
  });
});
