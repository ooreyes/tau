// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ComponentInspector, EditorToolbar } from "./ShellPanels";
import { useSchematic } from "../store/useSchematic";

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
  it("disables Wire, Net label, Undo, Redo, and Clear scratchpad in simulator mode", () => {
    const emptyDoc = { components: [], wires: [], counters: {}, probes: [], netLabels: [], directives: [] };
    // Both past and future populated so canUndo/canRedo would be true if the
    // mode gate weren't there — proves the gate, not just an empty history.
    useSchematic.setState({ past: [emptyDoc], future: [emptyDoc] });
    render(<EditorToolbar mode="simulator" {...noopToolbarProps} />);

    for (const name of ["Wire", "Net label (F4)", "Undo", "Redo", "Clear scratchpad"]) {
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
