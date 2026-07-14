// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Canvas } from "./Canvas";
import { useSchematic } from "../store/useSchematic";

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

// Net label drag (Fix 2) captures the pointer on the dragged `<text>` so a
// fast drag still delivers pointermove/up to it — jsdom doesn't implement
// pointer capture at all (see ui/primitives.test.tsx for the same gap on
// Radix primitives), so every test in this file needs the same no-op stubs.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  useSchematic.setState({
    components: [{ id: "r1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k", label: "R1" }],
    wires: [{ id: "w1", points: [{ x: 0, y: 20 }, { x: 20, y: 20 }] }],
    probes: [],
    netLabels: [],
    directives: [".tran 1m"],
    selectedId: null,
    selectedWireId: null,
    selectedWireIds: [],
    selectedIds: [],
    selectedLabelIds: [],
    selectedProbeIds: [],
    tool: { mode: "select" },
    past: [],
    future: [],
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Canvas — simulator mutation boundary", () => {
  it("selects a component without changing probes or circuit topology", () => {
    render(<Canvas interactive={false} />);
    const before = useSchematic.getState();
    const topology = {
      components: structuredClone(before.components),
      wires: structuredClone(before.wires),
      directives: [...before.directives],
      probes: [...before.probes],
    };

    fireEvent.pointerDown(document.querySelector("svg.canvas")!, { button: 0, clientX: 0, clientY: 0 });

    const after = useSchematic.getState();
    expect(after.selectedId).toBe("r1");
    expect({
      components: after.components,
      wires: after.wires,
      directives: after.directives,
      probes: after.probes,
    }).toEqual(topology);
  });

  it("adds and directly removes a voltage probe dot without changing topology", () => {
    useSchematic.setState({ tool: { mode: "probe" } });
    render(<Canvas interactive={false} />);

    fireEvent.pointerDown(document.querySelector(".wire-group")!, { button: 0, clientX: 10, clientY: 20 });
    expect(useSchematic.getState().probes).toHaveLength(1);
    expect(useSchematic.getState().probes[0].componentId).toBeUndefined();

    fireEvent.keyDown(screen.getByRole("button", { name: "Remove voltage probe" }), { key: "Enter" });
    expect(useSchematic.getState().probes).toEqual([]);
    expect(useSchematic.getState().components[0].value).toBe("1k");
    expect(useSchematic.getState().wires).toHaveLength(1);
  });

  it("adds, edits, and removes a node name inline", () => {
    useSchematic.setState({ tool: { mode: "label" } });
    render(<Canvas interactive={false} />);

    fireEvent.pointerDown(document.querySelector(".wire-group")!, { button: 0, clientX: 10, clientY: 20 });
    const input = screen.getByRole("textbox", { name: "Net label name" });
    fireEvent.change(input, { target: { value: "output" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useSchematic.getState().netLabels.map((label) => label.text)).toEqual(["output"]);

    // Click-without-drag: label text now supports drag-to-reposition (Fix 2),
    // so opening the rename draft is a pointerdown+pointerup pair below the
    // drag threshold, not pointerdown alone.
    const labelText = screen.getByRole("button", { name: "Rename node output" });
    fireEvent.pointerDown(labelText, { clientX: 0, clientY: 0 });
    fireEvent.pointerUp(labelText, { clientX: 0, clientY: 0 });
    const rename = screen.getByRole("textbox", { name: "Net label name" });
    fireEvent.change(rename, { target: { value: "" } });
    fireEvent.keyDown(rename, { key: "Enter" });
    expect(useSchematic.getState().netLabels).toEqual([]);
  });
});

describe("Canvas — schematic selection chrome", () => {
  it("selects an individual component through the canvas pointer gesture", () => {
    useSchematic.setState({ wires: [] });
    render(<Canvas interactive />);
    const canvas = document.querySelector("svg.canvas")!;

    // jsdom's zero-size SVG leaves the initial world origin at client (0, 0),
    // which lets this exercise Canvas's real componentAt → Zustand path.
    fireEvent.pointerDown(canvas, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });

    expect(useSchematic.getState().selectedId).toBe("r1");
    expect(useSchematic.getState().selectedIds).toEqual(["r1"]);
    expect(document.querySelector(".component.selected")).not.toBeNull();
  });

  it("draws a marquee and commits its component selection to Zustand", () => {
    useSchematic.setState({ wires: [] });
    render(<Canvas interactive />);
    const canvas = document.querySelector("svg.canvas")!;

    fireEvent.pointerDown(canvas, { button: 0, clientX: -50, clientY: -50, pointerId: 2 });
    fireEvent.pointerMove(canvas, { clientX: 50, clientY: 50, pointerId: 2 });

    const marquee = document.querySelector(".select-box");
    expect(marquee).not.toBeNull();
    expect(marquee?.getAttribute("width")).toBe("100");
    expect(marquee?.getAttribute("height")).toBe("100");

    fireEvent.pointerUp(canvas, { button: 0, clientX: 50, clientY: 50, pointerId: 2 });

    expect(document.querySelector(".select-box")).toBeNull();
    expect(useSchematic.getState().selectedId).toBe("r1");
    expect(useSchematic.getState().selectedIds).toEqual(["r1"]);
    expect(document.querySelector(".component.selected")).not.toBeNull();
  });

  it("keeps deletion out of the drawing overlay", () => {
    useSchematic.setState({ selectedId: "r1", selectedIds: ["r1"] });
    render(<Canvas interactive />);

    expect(screen.queryByRole("button", { name: "Delete selection" })).toBeNull();
    expect(document.querySelector(".selection-delete-pill")).toBeNull();
  });
});

describe("Canvas — net label drag (Fix 2)", () => {
  it("drags a net label's text to a new dx/dy with exactly one undo entry, not one per pointermove", () => {
    useSchematic.setState({
      tool: { mode: "label" },
      netLabels: [{ id: "l1", x: 0, y: 20, text: "OUT", dx: 10, dy: -10 }],
    });
    render(<Canvas interactive={false} />);
    const historyBefore = useSchematic.getState().past.length;

    const labelText = screen.getByRole("button", { name: "Rename node OUT" });
    fireEvent.pointerDown(labelText, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(labelText, { clientX: 108, clientY: 106 }); // past the click/drag threshold
    fireEvent.pointerMove(labelText, { clientX: 115, clientY: 112 }); // still mid-drag — no extra undo entry
    fireEvent.pointerUp(labelText, { clientX: 115, clientY: 112 });

    const label = useSchematic.getState().netLabels[0];
    expect(label.dx).toBeCloseTo(10 + 15);
    expect(label.dy).toBeCloseTo(-10 + 12);
    expect(useSchematic.getState().past.length).toBe(historyBefore + 1);
    // A drag must not also open the rename draft.
    expect(screen.queryByRole("textbox", { name: "Net label name" })).toBeNull();

    useSchematic.getState().undo();
    expect(useSchematic.getState().netLabels[0]).toMatchObject({ dx: 10, dy: -10 });
  });

  it("click-without-drag on a net label selects it in the schematic editor's select tool", () => {
    useSchematic.setState({
      tool: { mode: "select" },
      netLabels: [{ id: "l1", x: 0, y: 20, text: "OUT", dx: 10, dy: -10 }],
    });
    render(<Canvas interactive fitSignal={0} />);

    const labelText = screen.getByRole("button", { name: "Net label OUT" });
    fireEvent.pointerDown(labelText, { clientX: 50, clientY: 50 });
    fireEvent.pointerUp(labelText, { clientX: 50, clientY: 50 });
    expect(useSchematic.getState().selectedLabelIds).toEqual(["l1"]);

    // A second gesture that moves past the threshold drags instead of re-selecting.
    const historyBefore = useSchematic.getState().past.length;
    fireEvent.pointerDown(labelText, { clientX: 50, clientY: 50 });
    fireEvent.pointerMove(labelText, { clientX: 62, clientY: 44 });
    fireEvent.pointerUp(labelText, { clientX: 62, clientY: 44 });
    const label = useSchematic.getState().netLabels[0];
    expect(label.dx).toBeCloseTo(10 + 12);
    expect(label.dy).toBeCloseTo(-10 - 6);
    expect(useSchematic.getState().past.length).toBe(historyBefore + 1);
  });
});
