// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Canvas } from "./Canvas";
import { useSchematic } from "../store/useSchematic";

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  readonly observed: Element[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this);
  }

  observe(target: Element) {
    this.observed.push(target);
  }
  disconnect() {}

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
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
  ResizeObserverStub.instances = [];
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
    expect(document.querySelector(".wire-group.probed")).not.toBeNull();
    expect((document.querySelector(".wire-group.probed") as HTMLElement | null)?.style.color)
      .toMatch(/var\(--trace-/);

    fireEvent.keyDown(screen.getByRole("button", { name: "Remove voltage probe" }), { key: "Enter" });
    expect(useSchematic.getState().probes).toEqual([]);
    expect(document.querySelector(".wire-group.probed")).toBeNull();
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

  it("keeps simulator node naming topology-neutral by rejecting a shared net name", () => {
    useSchematic.setState({
      tool: { mode: "label" },
      wires: [
        { id: "w1", points: [{ x: 0, y: 20 }, { x: 20, y: 20 }] },
        { id: "w2", points: [{ x: 100, y: 20 }, { x: 120, y: 20 }] },
      ],
      netLabels: [{ id: "l1", x: 10, y: 20, text: "OUT" }],
    });
    render(<Canvas interactive={false} />);

    fireEvent.pointerDown(document.querySelectorAll(".wire-group")[1], { button: 0, clientX: 110, clientY: 20 });
    const input = screen.getByRole("textbox", { name: "Net label name" });
    fireEvent.change(input, { target: { value: "out" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByRole("alert").textContent).toContain("join or split electrical nodes");
    expect(useSchematic.getState().netLabels).toEqual([{ id: "l1", x: 10, y: 20, text: "OUT" }]);

    fireEvent.change(input, { target: { value: "SENSE" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useSchematic.getState().netLabels.map((label) => label.text)).toEqual(["OUT", "SENSE"]);
  });
});

describe("Canvas — simulator fit viewport", () => {
  it("centers topology in the visible SVG and refits after its wrapper resizes", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    useSchematic.setState({
      components: [
        { id: "v1", kind: "vsource", x: 0, y: 0, rotation: 0, value: "5", label: "VERY_LONG_INPUT_SOURCE" },
        { id: "r1", kind: "resistor", x: 160, y: 0, rotation: 0, value: "1k", label: "R1" },
      ],
      wires: [{ id: "w1", points: [{ x: 0, y: 0 }, { x: 160, y: 0 }] }],
    });

    render(<Canvas interactive={false} />);
    const canvas = document.querySelector<SVGSVGElement>("svg.canvas")!;
    let width = 400;
    let height = 260;
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) }),
    });
    const observer = ResizeObserverStub.instances[ResizeObserverStub.instances.length - 1];
    expect(observer.observed).toContain(canvas);
    expect(observer.observed).toContain(canvas.parentElement);

    const transform = () => {
      const group = [...canvas.children].find((child) => child.tagName.toLowerCase() === "g" && child.hasAttribute("transform"));
      const match = group?.getAttribute("transform")?.match(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/);
      if (!match) throw new Error("Canvas transform missing");
      return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
    };

    act(() => observer.trigger());
    let view = transform();
    // The rendered topology spans x=-32…208 after its real symbol footprints
    // and frame margin are included, so its visual center is 88. The
    // deliberately long V1 label must not pull that center toward the label.
    expect(view.x + 88 * view.zoom).toBeCloseTo(width / 2, 6);
    expect(view.y).toBeCloseTo(height / 2, 6);

    height = 160; // telemetry dock grew; only the black SVG remains visible.
    act(() => observer.trigger());
    view = transform();
    expect(view.x + 88 * view.zoom).toBeCloseTo(width / 2, 6);
    expect(view.y).toBeCloseTo(height / 2, 6);
  });

  it("Home centers and fits the full rotated footprint of a vertical resistor", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    useSchematic.setState({
      components: [{ id: "r1", kind: "resistor", x: 100, y: 200, rotation: 90, value: "", label: "" }],
      wires: [],
    });

    render(<Canvas interactive={false} />);
    const canvas = document.querySelector<SVGSVGElement>("svg.canvas")!;
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, toJSON: () => ({}) }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Fit circuit to view" }));
    const group = [...canvas.children].find((child) => child.tagName.toLowerCase() === "g" && child.hasAttribute("transform"));
    const match = group?.getAttribute("transform")?.match(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/);
    if (!match) throw new Error("Canvas transform missing");
    const view = { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };

    // Rotated body+pins span 56×96 including the world margin. The 300px-high
    // viewport has 204px after fit padding, so height is the constrained axis.
    expect(view.zoom).toBeCloseTo(204 / 96, 6);
    expect(view.x + 100 * view.zoom).toBeCloseTo(200, 6);
    expect(view.y + 200 * view.zoom).toBeCloseTo(150, 6);
    expect(view.y + 152 * view.zoom).toBeCloseTo(48, 6);
    expect(300 - (view.y + 248 * view.zoom)).toBeCloseTo(48, 6);
  });
});

describe("Canvas — placement preview", () => {
  it("centers a vertical resistor on the pointer and removes the stale dashed ghost after placement", () => {
    useSchematic.setState({
      components: [],
      wires: [{ id: "vertical", points: [{ x: 0, y: -96 }, { x: 0, y: 96 }] }],
      tool: { mode: "place", kind: "resistor" },
      placeRotation: 90,
    });
    render(<Canvas interactive />);
    const canvas = document.querySelector<SVGSVGElement>("svg.canvas")!;

    // jsdom's zero-size canvas keeps screen/world origin at (0,0).
    fireEvent.pointerMove(canvas, { clientX: 0, clientY: 0, pointerId: 11 });
    const ghost = document.querySelector<SVGGElement>(".ghost")!;
    expect(ghost.getAttribute("transform")).toBe("translate(0 0)");
    expect(ghost.querySelector(".symbol")?.getAttribute("transform")).toBe("rotate(90)");

    fireEvent.pointerDown(canvas, { button: 0, clientX: 0, clientY: 0, pointerId: 11 });

    expect(document.querySelector(".ghost")).toBeNull();
    expect(useSchematic.getState().components[0]).toMatchObject({
      kind: "resistor",
      x: 0,
      y: 0,
      rotation: 90,
    });
    // The original conductor is cut back to the two pins, so the resistor is
    // not visually or electrically bypassed by a wire through its center.
    expect(useSchematic.getState().wires.map((wire) => wire.points)).toEqual([
      [{ x: 0, y: -96 }, { x: 0, y: -32 }],
      [{ x: 0, y: 32 }, { x: 0, y: 96 }],
    ]);
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
