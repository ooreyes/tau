// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Canvas } from "./Canvas";
import { useSchematic } from "../store/useSchematic";
import { getComponentPins } from "../schematic/pins";
import { extractCircuit, type ExtractedCircuit } from "../schematic/netlist";
import { buildSubcircuitPinOverride } from "../schematic/subcircuitGeometry";
import type { AnalysisResult } from "../simulation/linearTransient";
import {
  SEVEN_SEGMENT_DIGIT_PATTERNS,
  SEVEN_SEGMENT_SEGMENTS,
  type SevenSegmentSegment,
} from "./simulator/SevenSegmentDisplay";

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
// fast drag still delivers pointermove/up to it - jsdom doesn't implement
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

/**
 * The simulator canvas refuses every edit except one: operating a contact.
 * That carve-out is deliberate -- a switch is drawn in order to be thrown --
 * so it needs its own boundary tests, both that it works and that it did not
 * quietly reopen the surface to editing.
 */
describe("Canvas - operating a contact during simulation", () => {
  const placeContact = (kind: "switch" | "pushButton" | "spdt" | "relay", value: string) => {
    useSchematic.setState({
      components: [{ id: "s1", kind, x: 0, y: 0, rotation: 0, value, label: "S1" }],
      selectedId: null,
      past: [],
      future: [],
    });
  };
  const clickBody = (onActuate?: () => void) => {
    const svg = document.querySelector("svg.canvas")!;
    fireEvent.pointerDown(svg, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(svg, { button: 0, clientX: 0, clientY: 0 });
    return onActuate;
  };
  const valueOf = () => useSchematic.getState().components[0].value;

  it("toggles a switch and tells the app to re-solve", () => {
    placeContact("switch", "open");
    const onActuate = vi.fn();
    render(<Canvas interactive={false} onActuate={onActuate} />);

    clickBody();
    expect(valueOf()).toBe("closed");
    // Blanking the plot would be the wrong answer here: the reader threw the
    // switch precisely to see the new result.
    expect(onActuate).toHaveBeenCalled();

    clickBody();
    expect(valueOf()).toBe("open");
  });

  it("holds a push button closed and releases it on pointer up", () => {
    placeContact("pushButton", "open");
    render(<Canvas interactive={false} />);
    const svg = document.querySelector("svg.canvas")!;

    fireEvent.pointerDown(svg, { button: 0, clientX: 0, clientY: 0 });
    expect(valueOf()).toMatch(/^closed/);
    fireEvent.pointerUp(svg, { button: 0, clientX: 0, clientY: 0 });
    expect(valueOf()).toMatch(/^open/);
  });

  it("explains that a relay is thrown by its coil instead of swallowing the click", () => {
    placeContact("relay", "100");
    render(<Canvas interactive={false} />);
    clickBody();
    expect(valueOf()).toBe("100");
    expect(screen.getByRole("status").textContent).toMatch(/coil/i);
  });

  it("leaves a part with no contact entirely alone", () => {
    render(<Canvas interactive={false} />);
    const before = structuredClone(useSchematic.getState().components);
    clickBody();
    expect(useSchematic.getState().components).toEqual(before);
  });

  it("does not reopen the canvas to editing", () => {
    placeContact("switch", "open");
    render(<Canvas interactive={false} />);
    const before = useSchematic.getState();
    clickBody();
    const after = useSchematic.getState();
    // One contact moved; nothing else about the circuit did.
    expect(after.components).toHaveLength(before.components.length);
    expect(after.wires).toEqual(before.wires);
    expect(after.directives).toEqual(before.directives);
    // And it is undoable, like any other change to the circuit.
    expect(after.past.length).toBeGreaterThan(before.past.length);
  });

  it("stays inert on the editing canvas, where a click means select or drag", () => {
    placeContact("switch", "open");
    render(<Canvas interactive />);
    clickBody();
    expect(valueOf()).toBe("open");
  });
});

/**
 * The potentiometer is the other operable part, and the only one whose gesture
 * is a drag. jsdom's zero-size SVG leaves world == client coordinates, so a
 * clientX delta is a world delta: full wiper travel is 40 units.
 */
describe("Canvas - dragging a potentiometer wiper during simulation", () => {
  const placePot = (value = "10k") => {
    useSchematic.setState({
      components: [{ id: "rv1", kind: "potentiometer", x: 0, y: 0, rotation: 0, value, label: "RV1" }],
      wires: [],
      selectedId: null,
      past: [],
      future: [],
    });
  };
  const valueOf = () => useSchematic.getState().components[0].value;
  /** Centre x of the drawn wiper arrow, in symbol-local units. */
  const arrowX = () => {
    const d = document.querySelector("[data-wiper]")!.getAttribute("d")!;
    const xs = [...d.matchAll(/-?[\d.]+/g)].map(Number).filter((_, i) => i % 2 === 0);
    return (Math.min(...xs) + Math.max(...xs)) / 2;
  };

  it("commits the tap on release and re-solves exactly once", () => {
    placePot();
    const onActuate = vi.fn();
    render(<Canvas interactive={false} onActuate={onActuate} />);
    const svg = document.querySelector("svg.canvas")!;

    fireEvent.pointerDown(svg, { button: 0, clientX: 0, clientY: 0, pointerId: 30 });
    fireEvent.pointerMove(svg, { clientX: 4, clientY: 0, pointerId: 30 });
    fireEvent.pointerMove(svg, { clientX: 8, clientY: 0, pointerId: 30 });

    // Mid-drag the arrow has moved but the circuit has not: a re-solve per
    // pointermove would queue a hundred ngspice runs over one gesture.
    expect(arrowX()).toBeCloseTo(8, 6);
    expect(valueOf()).toBe("10k");
    expect(onActuate).not.toHaveBeenCalled();

    fireEvent.pointerUp(svg, { button: 0, clientX: 8, clientY: 0, pointerId: 30 });

    expect(valueOf()).toBe("10k Wiper=0.7");
    expect(onActuate).toHaveBeenCalledTimes(1);
    // One gesture, one undo entry.
    expect(useSchematic.getState().past).toHaveLength(1);
    useSchematic.getState().undo();
    expect(valueOf()).toBe("10k");
  });

  it("runs the tap to both end stops and back", () => {
    placePot();
    render(<Canvas interactive={false} />);
    const svg = document.querySelector("svg.canvas")!;

    fireEvent.pointerDown(svg, { button: 0, clientX: 0, clientY: 0, pointerId: 31 });
    fireEvent.pointerMove(svg, { clientX: 400, clientY: 0, pointerId: 31 });
    fireEvent.pointerUp(svg, { button: 0, clientX: 400, clientY: 0, pointerId: 31 });
    expect(valueOf()).toBe("10k Wiper=1");

    fireEvent.pointerDown(svg, { button: 0, clientX: 0, clientY: 0, pointerId: 32 });
    fireEvent.pointerMove(svg, { clientX: -400, clientY: 0, pointerId: 32 });
    fireEvent.pointerUp(svg, { button: 0, clientX: -400, clientY: 0, pointerId: 32 });
    expect(valueOf()).toBe("10k Wiper=0");
  });

  it("leaves the wiper alone for a click that never moved", () => {
    placePot("10k Wiper=0.25");
    const onActuate = vi.fn();
    render(<Canvas interactive={false} onActuate={onActuate} />);
    const svg = document.querySelector("svg.canvas")!;

    fireEvent.pointerDown(svg, { button: 0, clientX: 0, clientY: 0, pointerId: 33 });
    fireEvent.pointerUp(svg, { button: 0, clientX: 0, clientY: 0, pointerId: 33 });

    expect(valueOf()).toBe("10k Wiper=0.25");
    expect(onActuate).not.toHaveBeenCalled();
    expect(useSchematic.getState().past).toHaveLength(0);
    // Clicking a part on the simulator canvas still means "inspect it".
    expect(useSchematic.getState().selectedId).toBe("rv1");
  });

  it("snaps the arrow back when the gesture is cancelled", () => {
    placePot();
    render(<Canvas interactive={false} />);
    const svg = document.querySelector("svg.canvas")!;

    fireEvent.pointerDown(svg, { button: 0, clientX: 0, clientY: 0, pointerId: 34 });
    fireEvent.pointerMove(svg, { clientX: 16, clientY: 0, pointerId: 34 });
    expect(arrowX()).toBeCloseTo(16, 6);
    fireEvent.pointerCancel(svg, { pointerId: 34 });

    expect(valueOf()).toBe("10k");
    expect(arrowX()).toBeCloseTo(0, 6);
  });

  it("stays inert on the editing canvas, where a drag moves the part", () => {
    placePot();
    render(<Canvas interactive />);
    const svg = document.querySelector("svg.canvas")!;

    fireEvent.pointerDown(svg, { button: 0, clientX: 0, clientY: 0, pointerId: 35 });
    fireEvent.pointerMove(svg, { clientX: 32, clientY: 0, pointerId: 35 });
    fireEvent.pointerUp(svg, { button: 0, clientX: 32, clientY: 0, pointerId: 35 });

    expect(valueOf()).toBe("10k");
    expect(useSchematic.getState().components[0]).toMatchObject({ x: 32, y: 0 });
  });
});

/**
 * Nothing used to tell a reader a part was operable before they clicked it.
 * The affordance is deliberately quiet, so these assert it exists at all and,
 * just as importantly, that it does not appear on parts that are not operable.
 */
describe("Canvas - hover affordance for operable parts", () => {
  const place = (kind: "switch" | "potentiometer" | "relay" | "resistor", value: string) => {
    useSchematic.setState({
      components: [{ id: "x1", kind, x: 0, y: 0, rotation: 0, value, label: "X1" }],
      wires: [],
      tool: { mode: "select" },
    });
  };
  const cursor = () => document.querySelector<SVGSVGElement>("svg.canvas")!.style.cursor;
  const hoverBody = () => {
    fireEvent.pointerMove(document.querySelector("svg.canvas")!, { clientX: 0, clientY: 0, pointerId: 40 });
  };

  it("advertises a contact with the pointer cursor and firms the symbol under it", () => {
    place("switch", "open");
    render(<Canvas interactive={false} />);
    expect(cursor()).toBe("default");
    expect(document.querySelector(".component.operable-hover")).toBeNull();

    hoverBody();
    expect(cursor()).toBe("pointer");
    expect(document.querySelector(".component.operable-hover")).not.toBeNull();

    // Off the part, the affordance goes away rather than sticking.
    fireEvent.pointerMove(document.querySelector("svg.canvas")!, { clientX: 800, clientY: 800, pointerId: 40 });
    expect(cursor()).toBe("default");
    expect(document.querySelector(".component.operable-hover")).toBeNull();
  });

  it("says which way a wiper slides", () => {
    place("potentiometer", "10k");
    render(<Canvas interactive={false} />);
    hoverBody();
    // A pot is dragged, not clicked, and the cursor is where that is said.
    expect(cursor()).toBe("ew-resize");
    expect(document.querySelector(".component.operable-wiper")).not.toBeNull();
    expect(document.querySelector(".component title")?.textContent).toBe("Drag the X1 wiper");
  });

  it("explains a relay on hover without offering to operate it", () => {
    place("relay", "100");
    render(<Canvas interactive={false} />);
    hoverBody();
    expect(cursor()).toBe("default");
    expect(document.querySelector(".component.operable")).toBeNull();
    expect(document.querySelector(".component title")?.textContent).toMatch(/coil/i);
  });

  it("says nothing about a part that does nothing", () => {
    place("resistor", "1k");
    render(<Canvas interactive={false} />);
    hoverBody();
    expect(cursor()).toBe("default");
    expect(document.querySelector(".component.operable")).toBeNull();
    expect(document.querySelector(".component title")).toBeNull();
  });

  it("keeps the affordance off the editing canvas, where a click means select", () => {
    place("switch", "open");
    render(<Canvas interactive />);
    hoverBody();
    expect(document.querySelector(".component.operable")).toBeNull();
    expect(document.querySelector(".component title")).toBeNull();
  });
});

describe("Canvas - simulator mutation boundary", () => {
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
    // Probe identity lives on the marker/waveform; schematic conductors stay
    // neutral so a trace color never looks like electrical wire state.
    expect(document.querySelector(".wire-group.probed")).toBeNull();

    fireEvent.keyDown(screen.getByRole("button", { name: "Remove voltage probe" }), { key: "Enter" });
    expect(useSchematic.getState().probes).toEqual([]);
    expect(document.querySelector(".wire-group.probed")).toBeNull();
    expect(useSchematic.getState().components[0].value).toBe("1k");
    expect(useSchematic.getState().wires).toHaveLength(1);
  });

  it("leaves a component body alone when the Probe tool clicks it", () => {
    // A node has a voltage; a branch has a current. The probe used to become a
    // clamp meter whenever it happened to land on a part, so the same tool
    // meant two different measurements depending on where the pointer fell.
    useSchematic.setState({ tool: { mode: "probe" } });
    render(<Canvas interactive={false} />);

    fireEvent.pointerDown(document.querySelector("svg.canvas")!, { button: 0, clientX: 0, clientY: 0 });
    expect(useSchematic.getState().probes).toEqual([]);
  });

  it("clamps an ammeter on a component body and takes it off again", () => {
    useSchematic.setState({ tool: { mode: "ammeter" } });
    render(<Canvas interactive={false} />);

    fireEvent.pointerDown(document.querySelector("svg.canvas")!, { button: 0, clientX: 0, clientY: 0 });
    expect(useSchematic.getState().probes).toEqual([
      expect.objectContaining({ componentId: "r1", x: 0, y: 0 }),
    ]);
    expect(screen.getByRole("button", { name: "Remove current probe" })).toBeTruthy();

    fireEvent.pointerDown(document.querySelector("svg.canvas")!, { button: 0, clientX: 0, clientY: 0 });
    expect(useSchematic.getState().probes).toEqual([]);
  });

  it("clamps an ammeter on a wire by resolving it to the part in series", () => {
    // Dropping a clamp on a wire is the bench gesture, but a wire is not a
    // branch: it has to resolve to the one part whose current it carries. R1's
    // `a` pin sits at (-32,0); this wire runs to it.
    useSchematic.setState({
      tool: { mode: "ammeter" },
      wires: [{ id: "lead", points: [{ x: -96, y: 0 }, { x: -32, y: 0 }] }],
    });
    render(<Canvas interactive={false} />);

    fireEvent.pointerDown(document.querySelector(".wire-group")!, { button: 0, clientX: -64, clientY: 0 });
    expect(useSchematic.getState().probes).toEqual([
      expect.objectContaining({ componentId: "r1" }),
    ]);
  });

  it("refuses an ammeter on empty canvas and says why", () => {
    // A click that silently does nothing reads as a broken tool.
    useSchematic.setState({ tool: { mode: "ammeter" }, components: [], wires: [] });
    render(<Canvas interactive={false} />);

    fireEvent.pointerDown(document.querySelector("svg.canvas")!, { button: 0, clientX: 900, clientY: 900 });
    expect(useSchematic.getState().probes).toEqual([]);
    expect(screen.getByRole("status").textContent).toMatch(/component or a wire/i);
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

describe("Canvas - simulator fit viewport", () => {
  it("keeps only the bottom obstruction in the public fit contract", () => {
    const supported: ComponentProps<typeof Canvas> = { fitInsetBottom: 120 };
    expect(supported).toEqual({ fitInsetBottom: 120 });

    const obsolete: ComponentProps<typeof Canvas> = {
      // @ts-expect-error Components is a summoned overlay, never a fit reservation.
      fitInsetRight: 264,
    };
    expect(obsolete).toEqual({ fitInsetRight: 264 });
  });

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
    // viewport has 204px after fit padding, so height is the constrained axis
    // and the fit wants 204/96 = 2.125x.
    //
    // It gets 2x, because the fit clamps there. One rotated resistor is not a
    // circuit worth magnifying past life size, and the cap became load-bearing
    // when the canvas stopped being a column and became the window: a
    // four-part RC filled 1400px and read as a cartoon.
    expect(204 / 96).toBeGreaterThan(2);
    expect(view.zoom).toBeCloseTo(2, 6);
    // Centred either way. The part still sits in the middle of the viewport;
    // the clamp only means it does not touch the fit padding.
    expect(view.x + 100 * view.zoom).toBeCloseTo(200, 6);
    expect(view.y + 200 * view.zoom).toBeCloseTo(150, 6);
    const margin = (300 - 96 * view.zoom) / 2;
    expect(view.y + 152 * view.zoom).toBeCloseTo(margin, 6);
    expect(300 - (view.y + 248 * view.zoom)).toBeCloseTo(margin, 6);
  });
});

describe("Canvas - placement preview", () => {
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

describe("Canvas - schematic selection chrome", () => {
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

  it("preserves the grab offset when dragging a component from its edge", () => {
    useSchematic.setState({ wires: [] });
    render(<Canvas interactive />);
    const canvas = document.querySelector("svg.canvas")!;

    fireEvent.pointerDown(canvas, { button: 0, clientX: 20, clientY: 0, pointerId: 12 });
    fireEvent.pointerMove(canvas, { clientX: 52, clientY: 0, pointerId: 12 });
    fireEvent.pointerUp(canvas, { button: 0, clientX: 52, clientY: 0, pointerId: 12 });

    expect(useSchematic.getState().components[0]).toMatchObject({ x: 32, y: 0 });
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

  it("Shift+clicks a wire into a mixed multi-selection without starting a drag", () => {
    useSchematic.setState({
      selectedIds: ["r1"],
      selectedId: "r1",
      tool: { mode: "select" },
    });
    render(<Canvas interactive />);
    const wireHit = document.querySelector(".wire-group")!;

    fireEvent.pointerDown(wireHit, {
      button: 0, clientX: 20, clientY: 20, pointerId: 20, shiftKey: true,
    });
    fireEvent.pointerUp(wireHit, {
      button: 0, clientX: 20, clientY: 20, pointerId: 20, shiftKey: true,
    });

    expect(useSchematic.getState().selectedIds).toEqual(["r1"]);
    expect(useSchematic.getState().selectedWireIds).toEqual(["w1"]);
    expect(useSchematic.getState().components[0]).toMatchObject({ x: 0, y: 0 });
    expect(useSchematic.getState().wires[0].points).toEqual([{ x: 0, y: 20 }, { x: 20, y: 20 }]);
  });

  it("drags an unselected wire on the first pointer gesture", () => {
    useSchematic.setState({
      components: [{ id: "r1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k", label: "R1" }],
      wires: [{ id: "w1", points: [{ x: 64, y: 64 }, { x: 128, y: 64 }] }],
      tool: { mode: "select" },
    });
    render(<Canvas interactive />);
    const canvas = document.querySelector("svg.canvas")!;
    const wireHit = document.querySelector(".wire-group")!;

    fireEvent.pointerDown(wireHit, { button: 0, clientX: 64, clientY: 64, pointerId: 21 });
    fireEvent.pointerMove(canvas, { clientX: 96, clientY: 96, pointerId: 21 });
    fireEvent.pointerUp(canvas, { button: 0, clientX: 96, clientY: 96, pointerId: 21 });

    expect(useSchematic.getState().selectedWireIds).toEqual(["w1"]);
    expect(useSchematic.getState().wires[0].points).toEqual([{ x: 96, y: 96 }, { x: 160, y: 96 }]);
    // The unselected resistor stays put — only the wire translated.
    expect(useSchematic.getState().components[0]).toMatchObject({ x: 0, y: 0 });
  });

  it("Shift+clicks a probe into an existing selection", () => {
    useSchematic.setState({
      probes: [{ id: "p1", x: 10, y: 20, color: "var(--trace-red)", netId: "N001" }],
      selectedIds: ["r1"],
      selectedId: "r1",
      tool: { mode: "select" },
    });
    render(<Canvas interactive />);

    const marker = screen.getByRole("button", { name: "Select voltage probe" });
    fireEvent.pointerDown(marker, { button: 0, shiftKey: true, pointerId: 22 });

    expect(useSchematic.getState().selectedIds).toEqual(["r1"]);
    expect(useSchematic.getState().selectedProbeIds).toEqual(["p1"]);
  });

  it("selects and deletes an individual probe without selecting or deleting its wire", () => {
    useSchematic.setState({
      probes: [{ id: "p1", x: 10, y: 20, color: "var(--trace-red)", netId: "N001" }],
      tool: { mode: "select" },
    });
    render(<Canvas interactive />);

    const marker = screen.getByRole("button", { name: "Select voltage probe" });
    expect(marker.classList.contains("actionable")).toBe(true);
    // Accessibility activation emits click without pointerdown; it must still
    // select the marker instead of falling through to the conductor.
    fireEvent.click(marker);
    expect(useSchematic.getState().selectedProbeIds).toEqual(["p1"]);
    expect(useSchematic.getState().selectedWireIds).toEqual([]);

    useSchematic.getState().deleteSelected();
    expect(useSchematic.getState().probes).toEqual([]);
    expect(useSchematic.getState().wires.map((wire) => wire.id)).toEqual(["w1"]);
  });

  it("drags every object in a mixed marquee selection as one circuit", () => {
    useSchematic.setState({
      netLabels: [{ id: "l1", x: 10, y: 20, text: "OUT" }],
      probes: [{ id: "p1", x: 10, y: 20, color: "var(--trace-red)" }],
      tool: { mode: "select" },
    });
    useSchematic.getState().selectMixed({
      componentIds: ["r1"], wireIds: ["w1"], labelIds: ["l1"], probeIds: ["p1"],
    });
    render(<Canvas interactive />);
    const canvas = document.querySelector("svg.canvas")!;

    fireEvent.pointerDown(canvas, { button: 0, clientX: 0, clientY: 0, pointerId: 8 });
    fireEvent.pointerMove(canvas, { clientX: 32, clientY: 32, pointerId: 8 });
    fireEvent.pointerUp(canvas, { button: 0, clientX: 32, clientY: 32, pointerId: 8 });

    const moved = useSchematic.getState();
    expect(moved.components[0]).toMatchObject({ x: 32, y: 32 });
    expect(moved.wires[0].points).toEqual([{ x: 32, y: 52 }, { x: 52, y: 52 }]);
    expect(moved.netLabels[0]).toMatchObject({ x: 42, y: 52 });
    expect(moved.probes[0]).toMatchObject({ x: 42, y: 52 });
  });

  it("moves imported absolute pin geometry with an individual component", () => {
    useSchematic.setState({
      components: [{
        id: "r1",
        kind: "resistor",
        x: 0,
        y: 0,
        rotation: 0,
        value: "1k",
        label: "R1",
        pinOverride: [
          { id: "a", label: "A", x: -32, y: 0 },
          { id: "b", label: "B", x: 32, y: 0 },
        ],
      }],
      wires: [{ id: "w1", points: [{ x: 32, y: 0 }, { x: 96, y: 0 }] }],
    });
    render(<Canvas interactive />);
    const canvas = document.querySelector("svg.canvas")!;

    fireEvent.pointerDown(canvas, { button: 0, clientX: 0, clientY: 0, pointerId: 9 });
    fireEvent.pointerMove(canvas, { clientX: 32, clientY: 32, pointerId: 9 });
    fireEvent.pointerUp(canvas, { button: 0, clientX: 32, clientY: 32, pointerId: 9 });

    const moved = useSchematic.getState().components[0];
    expect(moved).toMatchObject({ x: 32, y: 32 });
    expect(getComponentPins(moved).map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 0, y: 32 },
      { x: 64, y: 32 },
    ]);
    expect(useSchematic.getState().wires[0].points[0]).toEqual({ x: 64, y: 32 });
    expect(document.querySelectorAll(".snap-dot")).toHaveLength(0);
  });

  it("renders imported pin targets at the same coordinates used by snapping and netlisting", () => {
    useSchematic.setState({
      components: [{
        id: "r1", kind: "resistor", x: 100, y: 80, rotation: 0, value: "1k", label: "R1",
        pinOverride: [
          { id: "a", label: "A", x: 60, y: 80 },
          { id: "b", label: "B", x: 140, y: 80 },
        ],
      }],
      wires: [],
      tool: { mode: "wire" },
    });
    render(<Canvas interactive />);

    const targets = [...document.querySelectorAll<SVGCircleElement>(".component .pin-target")];
    expect(targets.map((target) => ({ cx: target.getAttribute("cx"), cy: target.getAttribute("cy") }))).toEqual([
      { cx: "-40", cy: "0" },
      { cx: "40", cy: "0" },
    ]);
    // Fit-scale maps Tau's ±32 pin bank onto the 80-unit LTspice span, so the
    // symbol pins land on pinOverride and no repair leads are needed.
    expect(document.querySelectorAll(".import-pin-lead")).toHaveLength(0);
  });

  it("renders every terminal and readable name on a native multi-pin subcircuit block", () => {
    const base = {
      id: "x1", kind: "subckt" as const, x: 96, y: 192, rotation: 0 as const,
      value: "deadtime", label: "X1",
    };
    useSchematic.setState({
      components: [{
        ...base,
        pinOverride: buildSubcircuitPinOverride(base, ["vcc", "vee", "pwm", "gp", "gn"]),
      }],
      wires: [],
      tool: { mode: "wire" },
    });
    render(<Canvas interactive />);

    expect([...document.querySelectorAll(".subckt-pin-label")].map((node) => node.textContent))
      .toEqual(["vcc", "vee", "pwm", "gp", "gn"]);
    expect(document.querySelectorAll(".component .pin-target")).toHaveLength(5);
    expect(document.querySelectorAll(".import-pin-lead")).toHaveLength(0);
    const body = document.querySelector(".component .symbol rect")!;
    expect(body.getAttribute("height")).toBe("88");
  });

  it("clears marquee and moving snap markers when a pointer gesture is canceled", () => {
    useSchematic.setState({ wires: [] });
    render(<Canvas interactive />);
    const canvas = document.querySelector("svg.canvas")!;

    fireEvent.pointerDown(canvas, { button: 0, clientX: 0, clientY: 0, pointerId: 10 });
    expect(document.querySelectorAll(".snap-dot").length).toBeGreaterThan(0);
    fireEvent.pointerCancel(canvas, { pointerId: 10 });
    expect(document.querySelectorAll(".snap-dot")).toHaveLength(0);

    fireEvent.pointerDown(canvas, { button: 0, clientX: 100, clientY: 100, pointerId: 11 });
    fireEvent.pointerMove(canvas, { clientX: 140, clientY: 140, pointerId: 11 });
    expect(document.querySelector(".select-box")).not.toBeNull();
    fireEvent.pointerCancel(canvas, { pointerId: 11 });
    expect(document.querySelector(".select-box")).toBeNull();
  });

  it("rolls back a partially moved component when capture is canceled", () => {
    useSchematic.setState({ wires: [] });
    render(<Canvas interactive />);
    const canvas = document.querySelector("svg.canvas")!;

    fireEvent.pointerDown(canvas, { button: 0, clientX: 0, clientY: 0, pointerId: 13 });
    fireEvent.pointerMove(canvas, { clientX: 32, clientY: 32, pointerId: 13 });
    expect(useSchematic.getState().components[0]).toMatchObject({ x: 32, y: 32 });
    fireEvent.pointerCancel(canvas, { pointerId: 13 });

    expect(useSchematic.getState().components[0]).toMatchObject({ x: 0, y: 0 });
    expect(useSchematic.getState().past).toHaveLength(0);
    expect(document.querySelectorAll(".snap-dot")).toHaveLength(0);
  });

  it("finishes a wire on a component pin while keeping the Wire tool active", () => {
    useSchematic.setState({
      components: [
        { id: "r1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k", label: "R1" },
        { id: "r2", kind: "resistor", x: 128, y: 0, rotation: 0, value: "1k", label: "R2" },
      ],
      wires: [],
      tool: { mode: "wire" },
    });
    render(<Canvas interactive />);
    const canvas = document.querySelector("svg.canvas")!;

    fireEvent.pointerDown(canvas, { button: 0, clientX: 32, clientY: 0 });
    fireEvent.pointerMove(canvas, { clientX: 96, clientY: 0 });
    fireEvent.pointerDown(canvas, { button: 0, clientX: 96, clientY: 0 });

    expect(useSchematic.getState().wires).toHaveLength(1);
    expect(useSchematic.getState().wires[0].points).toEqual([{ x: 32, y: 0 }, { x: 96, y: 0 }]);
    expect(useSchematic.getState().tool).toEqual({ mode: "wire" });
    expect(document.querySelector(".wire.preview")).toBeNull();
  });

  it("keeps deletion out of the drawing overlay", () => {
    useSchematic.setState({ selectedId: "r1", selectedIds: ["r1"] });
    render(<Canvas interactive />);

    expect(screen.queryByRole("button", { name: "Erase selection" })).toBeNull();
    expect(document.querySelector(".selection-delete-pill")).toBeNull();
  });
});

describe("Canvas - simulator seven-segment reflection", () => {
  const display = {
    id: "u1",
    kind: "sevenSeg" as const,
    x: 0,
    y: 0,
    rotation: 0 as const,
    value: "",
    label: "U1",
  };
  const commonAnodeDisplay = { ...display, value: "common anode" };

  function displayCircuit(component = display): { circuit: ExtractedCircuit; entry: ExtractedCircuit["components"][number] } {
    const circuit = extractCircuit([component], [], []);
    const entry = circuit.components.find(({ component: extracted }) => extracted.id === component.id);
    if (!entry) throw new Error("seven-segment fixture did not extract its component");
    return { circuit, entry };
  }

  function operatingPointFor(
    activeSegments: readonly SevenSegmentSegment[],
    commonVoltage: number,
    activeVoltage: number,
    component = display,
  ) {
    const { circuit, entry } = displayCircuit(component);
    const active = new Set(activeSegments);
    const voltageByNet = new Map<string, number>();
    for (const segment of SEVEN_SEGMENT_SEGMENTS) {
      voltageByNet.set(entry.pins[segment], active.has(segment) ? activeVoltage : commonVoltage);
    }
    voltageByNet.set(entry.pins.com, commonVoltage);
    return {
      circuit,
      result: {
        ok: true as const,
        nets: circuit.nets.map((net) => ({
          id: net.id,
          label: net.isGround ? "GND" : `V(${net.id})`,
          voltage: voltageByNet.get(net.id) ?? 0,
        })),
        warnings: [],
      },
    };
  }

  function transientFor(
    circuit: ExtractedCircuit,
    entry: ExtractedCircuit["components"][number],
    samples: readonly (readonly SevenSegmentSegment[])[],
    commonVoltage: number,
    activeVoltage: number,
  ): AnalysisResult {
    const traces = circuit.nets.filter((net) => !net.isGround).map((net) => ({
      id: net.id,
      label: `V(${net.id})`,
      unit: "V" as const,
      color: "var(--trace-green)",
      values: samples.map((activeSegments) => {
        const active = new Set(activeSegments);
        const segment = SEVEN_SEGMENT_SEGMENTS.find((candidate) => entry.pins[candidate] === net.id);
        return segment && active.has(segment) ? activeVoltage : commonVoltage;
      }),
    }));
    return {
      ok: true,
      title: "Transient",
      times: samples.map((_sample, index) => index),
      traces,
      currents: [],
      stats: { netCount: circuit.nets.length, componentCount: 1, sampleCount: samples.length, stopTime: samples.length - 1, stepSize: 1 },
      warnings: [],
      circuit,
    };
  }

  it("renders a valid digit from the actual operating-point nodes", () => {
    useSchematic.setState({ components: [display], wires: [], netLabels: [] });
    const { result } = operatingPointFor(SEVEN_SEGMENT_DIGIT_PATTERNS[5], 0, 5);
    render(<Canvas interactive={false} op={result} />);

    const rendered = screen.getByTestId("seven-segment-display");
    expect(rendered.getAttribute("data-display-status")).toBe("digit");
    expect(rendered.getAttribute("data-digit")).toBe("5");
    expect(rendered.querySelector('[data-segment="a"]')?.classList.contains("is-active")).toBe(true);
    expect(rendered.querySelector('[data-segment="b"]')?.classList.contains("is-active")).toBe(false);
    expect(useSchematic.getState().components[0].value).toBe("");
  });

  it("shows common-anode active-low nodes without changing the schematic", () => {
    useSchematic.setState({ components: [commonAnodeDisplay], wires: [], netLabels: [] });
    const { result } = operatingPointFor(SEVEN_SEGMENT_DIGIT_PATTERNS[3], 5, 0, commonAnodeDisplay);
    render(<Canvas interactive={false} op={result} />);

    expect(screen.getByTestId("seven-segment-display").getAttribute("data-digit")).toBe("3");
    expect(useSchematic.getState().components[0].value).toBe("common anode");
  });

  it("tracks a live transient sample when the schematic readout moves", () => {
    useSchematic.setState({ components: [display], wires: [], netLabels: [] });
    const { circuit, entry } = displayCircuit();
    const tran = transientFor(
      circuit,
      entry,
      [SEVEN_SEGMENT_DIGIT_PATTERNS[1], SEVEN_SEGMENT_DIGIT_PATTERNS[8]],
      0,
      5,
    );
    const view = render(<Canvas interactive={false} tran={tran} readoutTime={0} />);

    expect(screen.getByTestId("seven-segment-display").getAttribute("data-digit")).toBe("1");
    view.rerender(<Canvas interactive={false} tran={tran} readoutTime={1} />);
    expect(screen.getByTestId("seven-segment-display").getAttribute("data-digit")).toBe("8");
  });

  it("renders a blank unavailable display when no completed result exists", () => {
    useSchematic.setState({ components: [display], wires: [], netLabels: [] });
    render(<Canvas interactive={false} />);

    const rendered = screen.getByTestId("seven-segment-display");
    expect(rendered.getAttribute("data-display-status")).toBe("no-result");
    expect(rendered.hasAttribute("data-digit")).toBe(false);
    expect(rendered.querySelectorAll(".is-active")).toHaveLength(0);
  });
});

describe("Canvas - net label drag (Fix 2)", () => {
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
    fireEvent.pointerMove(labelText, { clientX: 115, clientY: 112 }); // still mid-drag - no extra undo entry
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
