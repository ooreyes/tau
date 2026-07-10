// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Canvas } from "./Canvas";
import { useSchematic } from "../store/useSchematic";

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

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

    fireEvent.pointerDown(screen.getByRole("button", { name: "Rename node output" }));
    const rename = screen.getByRole("textbox", { name: "Net label name" });
    fireEvent.change(rename, { target: { value: "" } });
    fireEvent.keyDown(rename, { key: "Enter" });
    expect(useSchematic.getState().netLabels).toEqual([]);
  });
});
