// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Canvas } from "./Canvas";
import { buildLabelPlacements, circuitBounds, circuitBoundsWithLabels, sourceValueLabel } from "./Canvas.geometry";
import { useSchematic } from "../store/useSchematic";
import type { SchematicAscShape, SchematicComponent } from "../schematic/types";
import { buildSubcircuitPinOverride, subcircuitBankSides } from "../schematic/subcircuitGeometry";

// Structural, not imported: the store's state interface is module-local, and
// widening its visibility for a test is not this lane's file to change.
type SchematicState = ReturnType<typeof useSchematic.getState>;

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});

const SHAPES: SchematicAscShape[] = [
  { kind: "LINE", width: "Normal", coords: [16, 80, 208, 80] },
  // Box corners in the author's drag order, so the second is up and to the left.
  { kind: "RECTANGLE", width: "Wide", coords: [208, 176, 16, 32] },
  { kind: "CIRCLE", width: "Normal", coords: [-32, 224, -112, -32, 2] },
  { kind: "ARC", width: "Normal", coords: [0, 40, 32, 72, 4, 68, 4, 44] },
];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  useSchematic.setState({
    components: [],
    wires: [],
    probes: [],
    netLabels: [],
    directives: [],
    ascShapes: SHAPES,
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

describe("Canvas - preserved LTspice drawing primitives", () => {
  it("draws every kind of primitive the document carries", () => {
    const { container } = render(<Canvas interactive />);
    const group = container.querySelector(".asc-shapes")!;
    expect(group).not.toBeNull();

    const line = group.querySelector("line.asc-shape")!;
    expect(line.getAttribute("x1")).toBe("16");
    expect(line.getAttribute("x2")).toBe("208");

    // A negative width would draw nothing at all, which is the whole reason the
    // corners are normalised before they reach the element.
    const rect = group.querySelector("rect.asc-shape")!;
    expect(rect.getAttribute("x")).toBe("16");
    expect(rect.getAttribute("y")).toBe("32");
    expect(Number(rect.getAttribute("width"))).toBeGreaterThan(0);
    expect(Number(rect.getAttribute("height"))).toBeGreaterThan(0);

    const ellipse = group.querySelector("ellipse.asc-shape")!;
    expect(ellipse.getAttribute("cx")).toBe("-72");
    expect(ellipse.getAttribute("rx")).toBe("40");
    expect(ellipse.getAttribute("ry")).toBe("128");

    expect(group.querySelector("path.asc-shape")!.getAttribute("d")).toContain("A 16 16");
  });

  it("carries the pen width and the dash style through as classes", () => {
    const { container } = render(<Canvas interactive />);
    expect(container.querySelector("rect.asc-shape")!.getAttribute("class")).toContain("wide");
    expect(container.querySelector("line.asc-shape")!.getAttribute("class")).not.toContain("wide");
    // LTspice's style index 2 is a dotted pen; an absent index stays solid.
    expect(container.querySelector("ellipse.asc-shape")!.getAttribute("class")).toContain("dash-2");
    expect(container.querySelector("line.asc-shape")!.getAttribute("class")).not.toContain("dash-");
  });

  it("draws the artwork behind the circuit so a wire is never hidden by it", () => {
    useSchematic.setState({ wires: [{ id: "w1", points: [{ x: 0, y: 0 }, { x: 64, y: 0 }] }] });
    const { container } = render(<Canvas interactive />);
    const drawn = [...container.querySelectorAll(".asc-shapes, .wire-group")];
    expect(drawn.map((node) => node.classList.contains("asc-shapes"))).toEqual([true, false]);
  });

  it("renders no group at all for a document with no primitives", () => {
    useSchematic.setState({ ascShapes: [] });
    const { container } = render(<Canvas interactive />);
    expect(container.querySelector(".asc-shapes")).toBeNull();
  });
});

describe("Canvas - Cupertino schematic zoom chrome (§10)", () => {
  it("exposes Lucide InstrumentIconButtons (not ASCII +/−/⌂ glyphs)", () => {
    render(<Canvas interactive />);
    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    const zoomOut = screen.getByRole("button", { name: "Zoom out" });
    const fit = screen.getByRole("button", { name: "Fit circuit to view" });
    expect(zoomIn.querySelector(".lucide-zoom-in")).toBeTruthy();
    expect(zoomOut.querySelector(".lucide-zoom-out")).toBeTruthy();
    expect(fit.querySelector(".lucide-scan")).toBeTruthy();
    expect(zoomIn.textContent).not.toMatch(/[+\-−⌂]/);
    expect(document.querySelector('[aria-label="Schematic view"]')).toBeTruthy();
  });
});

describe("Canvas - fit-to-view frames the artwork too", () => {
  const WIDTH = 400;
  const HEIGHT = 300;

  /** Fit the canvas at a known viewport size and read back the world -> screen
   *  transform the circuit is actually drawn with. */
  const fitAndProject = () => {
    render(<Canvas interactive />);
    const canvas = document.querySelector<SVGSVGElement>("svg.canvas")!;
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0, y: 0, left: 0, top: 0,
        right: WIDTH, bottom: HEIGHT, width: WIDTH, height: HEIGHT,
        toJSON: () => ({}),
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Fit circuit to view" }));
    const group = [...canvas.children].find(
      (child) => child.tagName.toLowerCase() === "g" && child.hasAttribute("transform"),
    );
    const match = group
      ?.getAttribute("transform")
      ?.match(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/);
    if (!match) throw new Error("Canvas transform missing");
    const view = { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
    return (wx: number, wy: number) => ({
      x: view.x + wx * view.zoom,
      y: view.y + wy * view.zoom,
    });
  };

  it("keeps a border drawn well outside the circuit on screen", () => {
    // The circuit is one resistor at the origin; the artwork is a title-block
    // border around the whole sheet. Framing the circuit alone fits ~56 world
    // units across a 400px viewport, which puts every corner of the border
    // several screen-widths away with nothing on the canvas to say so.
    useSchematic.setState({
      components: [
        { id: "r1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k", label: "R1" },
      ],
      wires: [],
      ascShapes: [{ kind: "RECTANGLE", width: "Normal", coords: [560, 420, -240, -180] }],
    });

    const project = fitAndProject();
    for (const [wx, wy] of [[-240, -180], [560, -180], [560, 420], [-240, 420]]) {
      const point = project(wx, wy);
      expect(point.x, `x of ${wx},${wy}`).toBeGreaterThanOrEqual(0);
      expect(point.x, `x of ${wx},${wy}`).toBeLessThanOrEqual(WIDTH);
      expect(point.y, `y of ${wx},${wy}`).toBeGreaterThanOrEqual(0);
      expect(point.y, `y of ${wx},${wy}`).toBeLessThanOrEqual(HEIGHT);
    }
    // Still framing it, not merely containing it after zooming out to nothing.
    const left = project(-240, 0).x;
    const right = project(560, 0).x;
    expect(right - left).toBeGreaterThan(WIDTH / 2);
  });

  it("frames a sheet that carries artwork and no circuit at all", () => {
    // With no components and no wires there was nothing to fit, so the view
    // fell back to zoom 1 at the viewport origin - and a drawing anywhere else
    // opened off-screen.
    useSchematic.setState({
      components: [],
      wires: [],
      ascShapes: [{ kind: "LINE", width: "Normal", coords: [1200, 900, 1600, 1300] }],
    });

    const project = fitAndProject();
    for (const [wx, wy] of [[1200, 900], [1600, 1300]]) {
      const point = project(wx, wy);
      expect(point.x, `x of ${wx},${wy}`).toBeGreaterThanOrEqual(0);
      expect(point.x, `x of ${wx},${wy}`).toBeLessThanOrEqual(WIDTH);
      expect(point.y, `y of ${wx},${wy}`).toBeGreaterThanOrEqual(0);
      expect(point.y, `y of ${wx},${wy}`).toBeLessThanOrEqual(HEIGHT);
    }
  });

  it("still ignores the sheet's artwork when only a packed block body is left to frame", () => {
    // A hierarchical import packs flattened bodies from x = 1e6, and a sheet
    // whose only parts are packed has to keep framing them. The artwork belongs
    // to the authored sheet - a block body drops its own on import - so pulling
    // it in here would fit a million units across and show an empty canvas.
    useSchematic.setState({
      components: [
        { id: "b~r1", kind: "resistor", x: 1_000_000, y: 0, rotation: 0, value: "1k", label: "R1" },
      ],
      wires: [],
      ascShapes: [{ kind: "LINE", width: "Normal", coords: [0, 0, 64, 0] }],
    });

    const project = fitAndProject();
    const part = project(1_000_000, 0);
    expect(part.x).toBeGreaterThanOrEqual(0);
    expect(part.x).toBeLessThanOrEqual(WIDTH);
    // The authored-region artwork is off-screen, which is the intended trade.
    expect(project(0, 0).x).toBeLessThan(0);
  });
});

/**
 * P3-11: "Naming a node i should be able to select the text box and hit
 * backspace to delete it."
 *
 * Everything downstream of the keystroke was already healthy - `shortcuts.ts`
 * maps Backspace to "delete", the store's `deleteSelected` already filters
 * `netLabels` by `selectedLabelIds`, and clicking the label already sets that
 * selection. The break was that the label advertises itself as
 * `role="button"`, and App.tsx's window-keydown handler bails out on
 * `closest("input, textarea, select, button, [role='button'], ...")` before it
 * ever resolves a shortcut. Focus the label and the global path is dead by
 * construction, so the label has to answer the delete keys itself.
 */
const APP_TYPING_GUARD =
  "input, textarea, select, button, [role='button'], [role='tab'], [role='dialog'], [contenteditable='true']";

describe("Canvas - a selected net label answers Delete and Backspace (P3-11)", () => {
  const LABEL = { id: "n1", x: 32, y: 64, text: "endn" };

  const renderWithLabel = (extra: Partial<SchematicState> = {}) => {
    useSchematic.setState({
      ascShapes: [],
      wires: [{ id: "w1", points: [{ x: 0, y: 64 }, { x: 128, y: 64 }] }],
      netLabels: [{ ...LABEL }],
      tool: { mode: "select" },
      ...extra,
    });
    const view = render(<Canvas interactive />);
    return { ...view, label: document.querySelector<SVGTextElement>(".net-label-text")! };
  };

  const clickLabel = (label: SVGTextElement) => {
    fireEvent.pointerDown(label, { button: 0, pointerId: 11, clientX: 40, clientY: 40 });
    fireEvent.pointerUp(label, { button: 0, pointerId: 11, clientX: 40, clientY: 40 });
  };

  it("selects the label on click, visibly", () => {
    const { label } = renderWithLabel();
    clickLabel(label);
    expect(useSchematic.getState().selectedLabelIds).toEqual(["n1"]);
    expect(document.querySelector(".net-label-text")!.getAttribute("class")).toContain("selected");
  });

  /* The reason the local handler has to exist at all. If a future change drops
   * `role="button"` from the label, this fails and the reviewer learns that the
   * global shortcut path is now reachable - rather than the local handler
   * quietly becoming dead code. */
  it("documents that the label matches App.tsx's window-keydown swallow guard", () => {
    const { label } = renderWithLabel();
    expect(label.closest(APP_TYPING_GUARD)).toBe(label);
  });

  it("deletes the selected label on Backspace", () => {
    const { label } = renderWithLabel();
    clickLabel(label);
    fireEvent.keyDown(label, { key: "Backspace" });
    expect(useSchematic.getState().netLabels).toHaveLength(0);
  });

  it("deletes the selected label on Delete", () => {
    const { label } = renderWithLabel();
    clickLabel(label);
    fireEvent.keyDown(label, { key: "Delete" });
    expect(useSchematic.getState().netLabels).toHaveLength(0);
  });

  it("restores the label, offset and all, on undo", () => {
    const { label } = renderWithLabel();
    clickLabel(label);
    fireEvent.keyDown(label, { key: "Backspace" });
    // Asserted before the undo so this case still has teeth if the delete
    // regresses: without it, "never deleted" and "deleted then restored" look
    // identical from here.
    expect(useSchematic.getState().netLabels).toHaveLength(0);
    useSchematic.getState().undo();
    expect(useSchematic.getState().netLabels).toEqual([LABEL]);
  });

  it("deletes the whole multi-selection when the label is only part of it", () => {
    const { label } = renderWithLabel({
      components: [{ id: "r1", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" }],
    });
    useSchematic.getState().selectMixed({
      componentIds: ["r1"], wireIds: [], labelIds: ["n1"], probeIds: [],
    });
    fireEvent.keyDown(label, { key: "Backspace" });
    expect(useSchematic.getState().netLabels).toHaveLength(0);
    expect(useSchematic.getState().components).toHaveLength(0);
  });

  /* Tab arrival focuses the label without selecting it. Deleting whatever
   * happened to be selected elsewhere would be the wrong part disappearing
   * under the reader's hands, so the key claims the focused label first. */
  it("claims the focused label instead of deleting an unrelated selection", () => {
    const { label } = renderWithLabel({
      components: [{ id: "r1", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" }],
    });
    useSchematic.getState().select("r1");
    fireEvent.keyDown(label, { key: "Backspace" });
    expect(useSchematic.getState().netLabels).toHaveLength(0);
    expect(useSchematic.getState().components).toHaveLength(1);
  });

  /* The simulator surface reads the circuit and never edits it - the same gate
   * `dispatchShortcutAction` applies to every editing action. */
  it("refuses to delete from the read-only simulator label tool", () => {
    useSchematic.setState({
      ascShapes: [],
      wires: [{ id: "w1", points: [{ x: 0, y: 64 }, { x: 128, y: 64 }] }],
      netLabels: [{ ...LABEL }],
      selectedLabelIds: ["n1"],
      tool: { mode: "label" },
    });
    render(<Canvas interactive={false} />);
    const label = document.querySelector<SVGTextElement>(".net-label-text")!;
    fireEvent.keyDown(label, { key: "Backspace" });
    fireEvent.keyDown(label, { key: "Delete" });
    expect(useSchematic.getState().netLabels).toHaveLength(1);
  });

  /* Backspace inside the rename input edits text. The input is a real
   * `<input>`, so App.tsx's guard already skips it and the label's handler is
   * on a different element; this pins that separation. */
  it("never intercepts Backspace typed into the rename input", () => {
    useSchematic.setState({
      ascShapes: [],
      wires: [{ id: "w1", points: [{ x: 0, y: 64 }, { x: 128, y: 64 }] }],
      netLabels: [{ ...LABEL }],
      tool: { mode: "label" },
    });
    render(<Canvas interactive />);
    fireEvent.pointerDown(document.querySelector("svg.canvas")!, { button: 0, clientX: 32, clientY: 64 });
    const input = screen.getByLabelText("Net label name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ab" } });
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(input.value).toBe("ab");
    expect(useSchematic.getState().netLabels).toHaveLength(1);
  });
});

/**
 * P3-07's last mile. The placer earns "no overlap, ever" by escalating - it may
 * shorten a value, drop it, or reduce a whole label to an ellipsis - and it
 * measures its boxes against exactly the strings it decided on. The canvas used
 * to re-derive the text from the component instead (`sourceValueLabel(c.kind,
 * c.value)`), so any escalated label would have inked the FULL caption inside a
 * rectangle that had been proved clear for a shorter one. The geometry suite
 * cannot catch that: it never renders. This does.
 */
describe("Canvas - the label layer inks exactly what the placer measured (P3-07)", () => {
  /** Dense enough that the ladder has to give something up - see the ladder
   *  case in Canvas.labels.test.ts, which pins the same lattice. */
  const PACKED: SchematicComponent[] = Array.from({ length: 24 }, (_, p) => ({
    id: `x${p}`,
    kind: "resistor",
    x: (p % 4) * 16,
    y: Math.floor(p / 4) * 16,
    rotation: 0,
    value: "2.2Meg",
    label: `R${p}`,
  }));

  const renderedLabelText = () =>
    [...document.querySelectorAll(".label-layer text")].map((node) => node.textContent ?? "");

  it("prints the placement's strings, never the component's own", () => {
    useSchematic.setState({ ascShapes: [], components: PACKED, wires: [], netLabels: [] });
    render(<Canvas interactive />);
    const placements = buildLabelPlacements(PACKED, []);
    const expected = PACKED.flatMap((c) => {
      const placement = placements.get(c.id);
      if (!placement) return [];
      return [placement.refText, placement.valText].filter(Boolean);
    });
    expect(renderedLabelText()).toEqual(expected);
  });

  it("draws nothing at all for a component the placer could not fit", () => {
    useSchematic.setState({ ascShapes: [], components: PACKED, wires: [], netLabels: [] });
    render(<Canvas interactive />);
    const placements = buildLabelPlacements(PACKED, []);
    const omitted = PACKED.filter((c) => !placements.get(c.id));
    // The floor is what makes the invariant constructive rather than lucky, so
    // assert the fixture actually reaches it before asserting the consequence.
    expect(omitted.length, "fixture no longer saturates the placer").toBeGreaterThan(0);
    for (const c of omitted) expect(renderedLabelText()).not.toContain(c.label);
  });

  it("carries an escalated value through to the DOM, ellipsis and all", () => {
    useSchematic.setState({ ascShapes: [], components: PACKED, wires: [], netLabels: [] });
    render(<Canvas interactive />);
    const placements = buildLabelPlacements(PACKED, []);
    const escalated = [...placements.values()].filter(
      (p) => p.elided || !p.valText || p.valText.endsWith("…"),
    );
    expect(escalated.length, "fixture no longer escalates").toBeGreaterThan(0);
    // The full caption of a shortened label must be absent: printing it is the
    // exact regression this describe exists to catch.
    const full = sourceValueLabel("resistor", "2.2Meg");
    const shortened = escalated.filter((p) => p.valText.endsWith("…"));
    expect(shortened.length).toBeGreaterThan(0);
    for (const p of shortened) {
      expect(renderedLabelText()).toContain(p.valText);
      expect(p.valText).not.toBe(full);
    }
  });
});

/**
 * P3-10: "The autocentering button does not work. It needs to work dynamically
 * as the user resizes each tab."
 *
 * Two independent breaks, measured rather than guessed:
 *
 * 1. The parts rail is an *overlay* on the stage (`.stage > .components-rail`
 *    is absolutely positioned, z-index --z-summoned), so the svg's own width
 *    includes the band the rail covers. `fitView` centred in that full width,
 *    which puts the circuit half a rail width right of the visible centre -
 *    132 px at the default 264 px rail. Clicking fit again is idempotent, so
 *    the button reads as doing nothing.
 * 2. The only ResizeObserver in the file returned early for the interactive
 *    canvas (`if (interactive) return`), so the schematic editor tracked no
 *    size change at all.
 *
 * The rail's width is already published as `--stage-rail-inset` on `.stage`
 * (App.tsx, consumed by `.view-controls` in App.css) - the fit reads that
 * number rather than taking a new prop, which keeps Canvas' prop surface (and
 * the assertion in Canvas.simulator.test.tsx that pins it) untouched.
 */
const RESIZE_CALLBACKS: ResizeObserverCallback[] = [];

class RecordingResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    RESIZE_CALLBACKS.push(callback);
  }
  observe() {}
  disconnect() {}
}

describe("Canvas - fit centres in the VISIBLE canvas box and follows a resize (P3-10)", () => {
  /** The reported circuit: a sine source whose caption ("Sine · 1 V @ 1k Hz")
   *  is far wider than the symbol, so an off-centre fit cannot hide behind
   *  symmetric artwork. */
  const CIRCUIT: SchematicComponent[] = [
    { id: "v1", kind: "vsource", x: 0, y: 0, rotation: 0, value: "SINE(0 1 1k)", label: "V1" },
    { id: "c1", kind: "capacitor", x: 128, y: 0, rotation: 0, value: "1u", label: "C1" },
  ];
  const WIRES = [{ id: "w1", points: [{ x: 0, y: -48 }, { x: 128, y: -48 }] }];
  /** App.tsx's default rail width, i.e. the state in the report screenshot. */
  const RAIL = 264;

  let stage: HTMLElement;

  beforeEach(() => {
    RESIZE_CALLBACKS.length = 0;
    vi.stubGlobal("ResizeObserver", RecordingResizeObserver);
    // The fit is scheduled on a frame in every effect that triggers it. Running
    // frames inline makes the assertions read as cause -> effect instead of as
    // a wait, and matches what the browser does before the next paint.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    useSchematic.setState({ ascShapes: [], components: CIRCUIT, wires: WIRES });
  });

  afterEach(() => {
    stage?.remove();
  });

  const mountInStage = (rail: number, size: { w: number; h: number }, insetBottom = 0) => {
    stage = document.createElement("div");
    stage.className = "stage";
    stage.style.setProperty("--stage-rail-inset", `${rail}px`);
    document.body.appendChild(stage);
    render(<Canvas interactive fitInsetBottom={insetBottom} />, { container: stage });
    setSize(size);
    return stage;
  };

  const setSize = (size: { w: number; h: number }) => {
    const canvas = document.querySelector<SVGSVGElement>("svg.canvas")!;
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0, y: 0, left: 0, top: 0,
        right: size.w, bottom: size.h, width: size.w, height: size.h,
        toJSON: () => ({}),
      }),
    });
  };

  const readView = () => {
    const canvas = document.querySelector<SVGSVGElement>("svg.canvas")!;
    const group = [...canvas.children].find(
      (child) => child.tagName.toLowerCase() === "g" && child.hasAttribute("transform"),
    );
    const match = group
      ?.getAttribute("transform")
      ?.match(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/);
    if (!match) throw new Error("Canvas transform missing");
    return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
  };

  const clickFit = () => fireEvent.click(screen.getByRole("button", { name: "Fit circuit to view" }));

  const project = (view: { x: number; y: number; zoom: number }, wx: number, wy: number) => ({
    x: view.x + wx * view.zoom,
    y: view.y + wy * view.zoom,
  });

  /** Where the electrical drawing's own centre is - the same topology centre
   *  `fitView` passes to `fitViewTransform`, so asymmetric label text cannot
   *  drag the answer. */
  const topologyCentre = () => {
    const b = circuitBounds(CIRCUIT, WIRES, undefined, [])!;
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  };

  const SIZES = [{ w: 900, h: 600 }, { w: 1280, h: 800 }, { w: 1440, h: 900 }];

  for (const size of SIZES) {
    for (const rail of [0, RAIL]) {
      it(`centres the circuit in the visible box at ${size.w}x${size.h}, rail ${rail === 0 ? "closed" : "open"}`, () => {
        mountInStage(rail, size);
        clickFit();
        const centre = project(readView(), topologyCentre().x, topologyCentre().y);
        expect(
          Math.abs(centre.x - (size.w - rail) / 2),
          `x error at ${size.w}x${size.h} rail ${rail}`,
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(centre.y - size.h / 2),
          `y error at ${size.w}x${size.h} rail ${rail}`,
        ).toBeLessThanOrEqual(1);
      });

      it(`keeps every label inside the visible box at ${size.w}x${size.h}, rail ${rail === 0 ? "closed" : "open"}`, () => {
        mountInStage(rail, size);
        clickFit();
        const view = readView();
        const bounds = circuitBoundsWithLabels(CIRCUIT, WIRES, [])!;
        for (const [wx, wy] of [
          [bounds.minX, bounds.minY], [bounds.maxX, bounds.minY],
          [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY],
        ]) {
          const point = project(view, wx, wy);
          expect(point.x, `label edge x ${wx}`).toBeGreaterThanOrEqual(0);
          expect(point.x, `label edge x ${wx}`).toBeLessThanOrEqual(size.w - rail);
          expect(point.y, `label edge y ${wy}`).toBeGreaterThanOrEqual(0);
          expect(point.y, `label edge y ${wy}`).toBeLessThanOrEqual(size.h);
        }
      });
    }
  }

  /* The bottom dock is the other surface the visible box excludes. Its
   * reservation predates this item and was already exact, so this pins it
   * against the rail change rather than fixing it: both insets have to apply at
   * once, on their own axis. */
  it("centres inside the bottom dock's reservation as well as the rail's", () => {
    mountInStage(RAIL, { w: 1280, h: 800 }, 220);
    clickFit();
    const centre = project(readView(), topologyCentre().x, topologyCentre().y);
    expect(Math.abs(centre.x - (1280 - RAIL) / 2), "x").toBeLessThanOrEqual(1);
    expect(Math.abs(centre.y - (800 - 220) / 2), "y").toBeLessThanOrEqual(1);
  });

  it("re-fits from any prior pan or zoom, not just from a fresh camera", () => {
    mountInStage(RAIL, { w: 1280, h: 800 });
    clickFit();
    const framed = readView();
    fireEvent.wheel(document.querySelector("svg.canvas")!, { deltaX: 240, deltaY: -160 });
    expect(readView()).not.toEqual(framed);
    clickFit();
    expect(readView()).toEqual(framed);
  });

  it("observes the interactive canvas at all (it used to bail out on `interactive`)", () => {
    mountInStage(RAIL, { w: 1280, h: 800 });
    expect(RESIZE_CALLBACKS.length).toBeGreaterThan(0);
  });

  it("re-fits when the canvas itself resizes", () => {
    mountInStage(RAIL, { w: 1280, h: 800 });
    clickFit();
    const before = readView();
    setSize({ w: 900, h: 600 });
    act(() => {
      for (const cb of RESIZE_CALLBACKS) cb([], {} as ResizeObserver);
    });
    const after = readView();
    expect(after).not.toEqual(before);
    const centre = project(after, topologyCentre().x, topologyCentre().y);
    expect(Math.abs(centre.x - (900 - RAIL) / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre.y - 600 / 2)).toBeLessThanOrEqual(1);
  });

  /* The rail is an overlay, so opening or closing it never resizes the svg -
   * a ResizeObserver cannot see it. The published `--stage-rail-inset` can. */
  it("re-fits when the parts rail opens or closes, which resizes nothing", async () => {
    mountInStage(RAIL, { w: 1280, h: 800 });
    clickFit();
    const withRail = readView();
    await act(async () => {
      stage.style.setProperty("--stage-rail-inset", "0px");
      await Promise.resolve();
    });
    const withoutRail = readView();
    expect(withoutRail).not.toEqual(withRail);
    const centre = project(withoutRail, topologyCentre().x, topologyCentre().y);
    expect(Math.abs(centre.x - 1280 / 2)).toBeLessThanOrEqual(1);
  });

  /* The guarantee this fix must not spend: a re-fit only ever happens while the
   * camera is still the one the last fit chose. */
  it("never stomps a user pan when the canvas resizes", () => {
    mountInStage(RAIL, { w: 1280, h: 800 });
    clickFit();
    fireEvent.wheel(document.querySelector("svg.canvas")!, { deltaX: 240, deltaY: -160 });
    const panned = readView();
    setSize({ w: 900, h: 600 });
    act(() => {
      for (const cb of RESIZE_CALLBACKS) cb([], {} as ResizeObserver);
    });
    expect(readView()).toEqual(panned);
  });

  it("never stomps a user pan when the parts rail opens or closes", async () => {
    mountInStage(RAIL, { w: 1280, h: 800 });
    clickFit();
    fireEvent.wheel(document.querySelector("svg.canvas")!, { deltaX: 240, deltaY: -160 });
    const panned = readView();
    await act(async () => {
      stage.style.setProperty("--stage-rail-inset", "0px");
      await Promise.resolve();
    });
    expect(readView()).toEqual(panned);
  });
});

/**
 * The caption-anchor regression (acceptance check A4).
 *
 * `textAnchor` used to be chosen from `labelPoint.x` AFTER `transformPoint`
 * had rotated it. `rotatePoint(90)` maps (x,y) -> (-y,x), so a left-side pin at
 * local (-24,-32) yielded labelPoint.x = +32 -> "end" while its sibling at
 * (-24,+32) yielded -32 -> "start": two captions on the SAME physical side of a
 * rotated block pointed opposite ways. The anchor is a property of the pin's
 * LOCAL side, so it is derived from that and mapped through the rotated side
 * normal instead.
 */
describe("Canvas - a linked block's pin captions anchor off their own side (A4)", () => {
  const ORIENTATIONS: { rotation: 0 | 90 | 180 | 270; mirrored: boolean }[] = [
    { rotation: 0, mirrored: false }, { rotation: 90, mirrored: false },
    { rotation: 180, mirrored: false }, { rotation: 270, mirrored: false },
    { rotation: 0, mirrored: true }, { rotation: 90, mirrored: true },
    { rotation: 180, mirrored: true }, { rotation: 270, mirrored: true },
  ];

  for (const { rotation, mirrored } of ORIENTATIONS) {
    it(`anchors every caption by local side at ${rotation}deg${mirrored ? " mirrored" : ""}`, () => {
      const base: SchematicComponent = {
        id: "x1", kind: "subckt", x: 320, y: 240, rotation, mirrored,
        value: "Boost", label: "X1",
        projectSubcircuit: { sheetPath: "boost.sim", model: "Boost", ports: ["IN", "OUT", "GND"] },
      };
      const comp: SchematicComponent = {
        ...base,
        pinOverride: buildSubcircuitPinOverride(base, ["IN", "OUT", "GND"], ["In", "Out", "BiDir"]),
      };
      useSchematic.setState({ components: [comp], ascShapes: [] } as Partial<SchematicState> as SchematicState);
      render(<Canvas />);

      // Expected side comes from the geometry module reading the persisted
      // bank back - not from a literal typed out next to the implementation.
      const sides = subcircuitBankSides(comp);
      const captions = [...document.querySelectorAll("text.subckt-pin-label[data-subckt-pin]")];
      expect(captions.length).toBe(3);
      const nodeFor = (label: string) => captions
        .find((node) => node.getAttribute("data-subckt-pin-label") === label)!;

      // THE INVARIANT THE BUG BROKE: two captions on the same LOCAL side of a
      // block must run the same way, at every orientation. Before the fix the
      // anchor came from the post-rotation x, so at 90/270 the two left-column
      // captions got opposite anchors.
      const anchorsBySide = new Map<string, Set<string>>();
      for (const [index, label] of ["IN", "OUT", "GND"].entries()) {
        const side = String(sides[index]);
        const anchor = nodeFor(label).getAttribute("text-anchor")!;
        (anchorsBySide.get(side) ?? anchorsBySide.set(side, new Set()).get(side)!).add(anchor);
      }
      for (const [side, anchors] of anchorsBySide) {
        expect([...anchors], `local ${side} captions disagree`).toHaveLength(1);
      }

      // ...and the caption runs INWARD, toward the body it belongs to: that is
      // the only direction that keeps it inside the outline, and the anchor is
      // derived from the rendered position rather than a hand-written table of
      // eight orientations.
      for (const label of ["IN", "OUT", "GND"]) {
        const node = nodeFor(label);
        const x = Number(node.getAttribute("x"));
        const anchor = node.getAttribute("text-anchor")!;
        // "middle" is the honest answer when the block is on its side: the
        // caption hangs off a horizontal edge and there is no left/right to
        // prefer, so it centres on its own lead.
        if (anchor === "middle") {
          expect(rotation === 90 || rotation === 270).toBe(true);
          continue;
        }
        expect(anchor, `${label} at ${rotation}deg runs out through the body wall`)
          .toBe(x < 0 ? "start" : "end");
      }
    });
  }
});

describe("Canvas - a linked block says its own name, and says when it is stale", () => {
  const LINK = { sheetPath: "boost.sim", model: "Boost", ports: ["IN", "OUT", "GND"] };
  const block = (): SchematicComponent => {
    const base: SchematicComponent = {
      id: "x1", kind: "subckt", x: 320, y: 240, rotation: 0, mirrored: false,
      value: "Boost", label: "X1", projectSubcircuit: LINK,
    };
    return { ...base, pinOverride: buildSubcircuitPinOverride(base, LINK.ports, ["In", "Out", "BiDir"]) };
  };
  const mount = (props: Parameters<typeof Canvas>[0] = {}) => {
    useSchematic.setState({ components: [block()], ascShapes: [] } as Partial<SchematicState> as SchematicState);
    return render(<Canvas {...props} />);
  };

  it("names the block and drops the generic X glyph once it has names", () => {
    mount();
    expect(document.querySelector("text.subckt-model-label")?.textContent).toBe("Boost");
    // The X glyph is that exact path; an unlinked X device still keeps it.
    const glyphs = [...document.querySelectorAll("path")]
      .filter((node) => node.getAttribute("d") === "M -7 -7 L 7 7 M -7 7 L 7 -7");
    expect(glyphs).toHaveLength(0);
  });

  it("keeps the X glyph on a subcircuit that cannot name itself", () => {
    const bare: SchematicComponent = {
      id: "x2", kind: "subckt", x: 320, y: 240, rotation: 0, mirrored: false,
      value: "", label: "X2",
      pinOverride: [{ id: "p1", label: "", x: 272, y: 240 }, { id: "p2", label: "", x: 368, y: 240 }],
    };
    useSchematic.setState({ components: [bare], ascShapes: [] } as Partial<SchematicState> as SchematicState);
    render(<Canvas />);
    expect([...document.querySelectorAll("path")]
      .filter((n) => n.getAttribute("d") === "M -7 -7 L 7 7 M -7 7 L 7 -7")).toHaveLength(1);
  });

  it("draws no drift annotation at all when nothing has drifted", () => {
    mount();
    expect(document.querySelector(".subckt-body-drift")).toBeNull();
    expect(document.querySelector(".subckt-drift-lamp")).toBeNull();
    expect(document.querySelector("text.subckt-pin-label.drifted")).toBeNull();
  });

  it("annotates a stale block in words, marks the pins at issue, and never moves it", () => {
    const clean = mount();
    const pinsBefore = [...document.querySelectorAll("text.subckt-pin-label")]
      .map((n) => `${n.getAttribute("x")},${n.getAttribute("y")},${n.getAttribute("text-anchor")}`);
    cleanup();
    const sentence = "boost.sim reordered its connections: IN, OUT, GND -> IN, GND, OUT.";
    const onReviewDrift = vi.fn();
    mount({
      subcircuitDrift: new Map([["x1", { kind: "drifted" as const, sentence, pins: ["p2", "p3"] }]]),
      onReviewDrift,
    });
    void clean;

    // The sentence, not the colour, is what carries the state.
    expect(screen.getByRole("button", { name: sentence })).toBeTruthy();
    expect(document.querySelector(".component.subckt-drifted")?.getAttribute("aria-label")).toBe(sentence);
    expect(document.querySelector(".subckt-body-drift.transient")).toBeTruthy();

    // Only the pins the change is about are underlined.
    expect([...document.querySelectorAll("text.subckt-pin-label.drifted")]
      .map((n) => n.getAttribute("data-subckt-pin"))).toEqual(["p2", "p3"]);

    // NOT ONE PIXEL MOVED: the stored contract is what will be netlisted.
    expect([...document.querySelectorAll("text.subckt-pin-label")]
      .map((n) => `${n.getAttribute("x")},${n.getAttribute("y")},${n.getAttribute("text-anchor")}`))
      .toEqual(pinsBefore);
    expect(useSchematic.getState().components[0].pinOverride).toEqual(block().pinOverride);

    // A 28-unit target = --control-hit, over WCAG 2.2 SC 2.5.8's 24 floor.
    const hit = document.querySelector(".subckt-drift-lamp-hit")!;
    expect(hit.getAttribute("width")).toBe("28");
    expect(hit.getAttribute("height")).toBe("28");
    fireEvent.click(document.querySelector(".subckt-drift-lamp")!);
    expect(onReviewDrift).toHaveBeenCalledWith("x1");
  });

  it("draws a missing sheet's lamp solid rather than dashed", () => {
    mount({
      subcircuitDrift: new Map([["x1", {
        kind: "missing-sheet" as const,
        sentence: "boost.sim is missing from this project.",
      }]]),
    });
    expect(document.querySelector(".subckt-body-drift")).toBeTruthy();
    expect(document.querySelector(".subckt-body-drift.transient")).toBeNull();
    expect(document.querySelector(".subckt-drift-lamp.transient")).toBeNull();
  });

  it("opens the linked sheet on a double-click anywhere on the body (D7)", () => {
    const onOpenLinkedSheet = vi.fn();
    mount({ onOpenLinkedSheet });
    const svg = document.querySelector("svg.canvas")!;
    // 30 units off-centre: the whole body is the target, not a corner glyph.
    fireEvent.doubleClick(svg, { clientX: 0, clientY: 0 });
    // (0,0) is off the part; nothing opens.
    expect(onOpenLinkedSheet).not.toHaveBeenCalled();
    fireEvent.doubleClick(svg, { clientX: 320, clientY: 240 });
    expect(onOpenLinkedSheet).toHaveBeenCalledWith("x1");
    // Opening the sheet replaces the value editor, so no inline edit opened.
    expect(document.querySelector("input.value-edit-input")).toBeNull();
  });
});

describe("Canvas - candidate nets are visible while the label tool is armed (A6)", () => {
  const arm = (mode: "select" | "label") => {
    useSchematic.setState({
      components: [{ id: "r1", kind: "resistor", x: 96, y: 96, rotation: 0, value: "1k", label: "R1" } as SchematicComponent],
      wires: [{ id: "w1", points: [{ x: 96, y: 128 }, { x: 224, y: 128 }] }],
      ascShapes: [],
      tool: { mode },
    } as Partial<SchematicState> as SchematicState);
    render(<Canvas />);
  };

  it("shows no candidate marks at all with the select tool", () => {
    arm("select");
    expect(document.querySelector(".net-candidate-layer")).toBeNull();
  });

  it("marks every electrical net once the label tool is armed", () => {
    arm("label");
    const layer = document.querySelector(".net-candidate-layer")!;
    expect(layer.querySelectorAll(".net-candidate-mark").length).toBeGreaterThan(0);
    // Decoration only - net resolution stays snappedCursor -> netAtPoint.
    expect(layer.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Canvas - a net says what it is FOR, in the draft already open (D5b)", () => {
  const NET = { id: "w1", points: [{ x: 96, y: 128 }, { x: 224, y: 128 }] };
  const armLabelTool = () => {
    useSchematic.setState({
      components: [
        { id: "r1", kind: "resistor", x: 96, y: 96, rotation: 0, value: "1k", label: "R1" } as SchematicComponent,
      ],
      wires: [NET],
      netLabels: [],
      projectPorts: [],
      ascShapes: [],
      tool: { mode: "label" },
    } as Partial<SchematicState> as SchematicState);
  };
  const openDraft = () => fireEvent.pointerDown(document.querySelector("svg.canvas")!, {
    button: 0, clientX: 128, clientY: 128,
  });

  it("shows no direction control at all until the commit seam is wired", () => {
    armLabelTool();
    render(<Canvas />);
    openDraft();
    // Today's behaviour, byte for byte: a name field and nothing else.
    expect(screen.getByLabelText("Net label name")).toBeTruthy();
    expect(document.querySelector(".net-port-direction")).toBeNull();
  });

  it("offers four segments, defaults to Internal, and clears the 24px floor", () => {
    armLabelTool();
    render(<Canvas onCommitNetLabelPort={() => ({ ok: true })} />);
    openDraft();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Internal", "Input", "Output", "Both ways"]);
    expect(radios.filter((r) => r.getAttribute("aria-checked") === "true").map((r) => r.textContent))
      .toEqual(["Internal"]);
    // The 28px floor is a stylesheet fact; assert the class the sheet keys on
    // is present so App.css cannot silently stop styling this row.
    expect(document.querySelectorAll(".net-port-direction-segment")).toHaveLength(4);
  });

  it("commits the direction that was EXPLICITLY chosen, never an inherited one", () => {
    armLabelTool();
    const onCommitNetLabelPort = vi.fn(() => ({ ok: true }));
    render(<Canvas onCommitNetLabelPort={onCommitNetLabelPort} />);
    openDraft();
    fireEvent.change(screen.getByLabelText("Net label name"), { target: { value: "VIN" } });
    fireEvent.click(screen.getByRole("radio", { name: "Input" }));
    fireEvent.keyDown(screen.getByLabelText("Net label name"), { key: "Enter" });
    expect(onCommitNetLabelPort).toHaveBeenCalledWith(128, 128, "VIN", "In");
  });

  it("leaves the draft open with the store's own reason when the commit is refused", () => {
    armLabelTool();
    render(<Canvas onCommitNetLabelPort={() => ({ ok: false, error: "A port named VIN already exists." })} />);
    openDraft();
    fireEvent.change(screen.getByLabelText("Net label name"), { target: { value: "VIN" } });
    fireEvent.click(screen.getByRole("radio", { name: "Output" }));
    fireEvent.keyDown(screen.getByLabelText("Net label name"), { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toBe("A port named VIN already exists.");
    expect(screen.getByLabelText("Net label name")).toBeTruthy();
    // Nothing was written - the choice is still on screen to correct.
    expect(useSchematic.getState().netLabels).toEqual([]);
  });

  /**
   * KEYBOARD REACHABILITY. The name input commits on blur ("click-away
   * confirms"), so Tab out of it destroys the draft. That makes the direction
   * segments mouse-only: a keyboard user can never mark a net as an
   * input or an output at all, which fails WCAG 2.1.1 and makes the whole
   * drawing-first authoring act inaccessible - not merely awkward.
   */
  it("survives Tab out of the name field into the direction row", () => {
    armLabelTool();
    const onCommitNetLabelPort = vi.fn(() => ({ ok: true }));
    render(<Canvas onCommitNetLabelPort={onCommitNetLabelPort} />);
    openDraft();
    const input = screen.getByLabelText("Net label name");
    fireEvent.change(input, { target: { value: "VIN" } });
    // Tab moves focus to the row; the browser reports it as `relatedTarget`.
    fireEvent.blur(input, { relatedTarget: screen.getByRole("radio", { name: "Internal" }) });
    expect(onCommitNetLabelPort).not.toHaveBeenCalled();
    expect(document.querySelector(".net-port-direction")).not.toBeNull();
  });

  it("is a real radiogroup: arrows move the choice, Enter commits it", () => {
    armLabelTool();
    const onCommitNetLabelPort = vi.fn(() => ({ ok: true }));
    render(<Canvas onCommitNetLabelPort={onCommitNetLabelPort} />);
    openDraft();
    fireEvent.change(screen.getByLabelText("Net label name"), { target: { value: "VIN" } });
    const seg = () => screen.getByRole("radio", { name: "Internal" });
    fireEvent.blur(screen.getByLabelText("Net label name"), { relatedTarget: seg() });
    // Roving tabindex, so Tab lands on the CHECKED segment, not all four.
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("tabindex")))
      .toEqual(["0", "-1", "-1", "-1"]);
    fireEvent.keyDown(seg(), { key: "ArrowRight" });
    expect(screen.getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true")
      .map((r) => r.textContent)).toEqual(["Input"]);
    fireEvent.keyDown(screen.getByRole("radio", { name: "Input" }), { key: "Enter" });
    expect(onCommitNetLabelPort).toHaveBeenCalledWith(128, 128, "VIN", "In");
  });

  it("refuses the interface on an .asc sheet at the gesture, in the sheet's own words", () => {
    armLabelTool();
    const reason = "An .asc sheet cannot carry a Tau sheet interface - save it as .sim first";
    render(<Canvas onCommitNetLabelPort={() => ({ ok: true })} sheetInterfaceDisabledReason={reason} />);
    openDraft();
    expect(screen.getByRole("note").textContent).toBe(reason);
    // Internal stays live: an ordinary net label on an .asc sheet is still fine.
    const disabled = (name: string) =>
      (screen.getByRole("radio", { name }) as HTMLButtonElement).disabled;
    expect(disabled("Internal")).toBe(false);
    for (const name of ["Input", "Output", "Both ways"]) expect(disabled(name)).toBe(true);
  });
});

describe("Canvas - a marked net wears its direction and its ordinal (D5d)", () => {
  const mountMarked = () => {
    useSchematic.setState({
      components: [],
      wires: [{ id: "w1", points: [{ x: 96, y: 128 }, { x: 224, y: 128 }] }],
      netLabels: [
        { id: "l1", x: 96, y: 128, text: "VIN", port: "In" },
        { id: "l2", x: 224, y: 128, text: "VOUT", port: "Out" },
        { id: "l3", x: 160, y: 160, text: "GND", port: "BiDir" },
        { id: "l4", x: 160, y: 192, text: "n001" },
      ],
      projectPorts: [
        { name: "VIN", labelId: "l1", direction: "In" },
        { name: "VOUT", labelId: "l2", direction: "Out" },
        { name: "GND", labelId: "l3", direction: "BiDir" },
      ],
      ascShapes: [],
      tool: { mode: "select" },
    } as Partial<SchematicState> as SchematicState);
    render(<Canvas />);
  };

  it("draws a tag only on the marked nets, one per port", () => {
    mountMarked();
    expect([...document.querySelectorAll(".net-port-tag")].map((n) => n.getAttribute("data-net-port")))
      .toEqual(["In", "Out", "BiDir"]);
  });

  it("prints the 1-based terminal number the parent will wire to", () => {
    mountMarked();
    expect([...document.querySelectorAll("text.net-port-ordinal")].map((n) => n.textContent))
      .toEqual(["1", "2", "3"]);
  });

  it("points an input's apex INTO the net and an output's AWAY from it", () => {
    mountMarked();
    const dOf = (dir: string) => document
      .querySelector(`.net-port-tag[data-net-port="${dir}"] .net-port-tag-body`)!
      .getAttribute("d")!;
    // The apex is the single x-extreme vertex: leftmost for In, rightmost for Out.
    const xs = (d: string) => [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)]
      .map((m) => [Number(m[1]), Number(m[2])] as const);
    const apexCount = (d: string, pick: (v: number[]) => boolean) => xs(d).filter((p) => pick([...p])).length;
    const inD = dOf("In");
    const outD = dOf("Out");
    expect(apexCount(inD, ([x, y]) => x === Math.min(...xs(inD).map(([px]) => px)) && y === 0)).toBe(1);
    expect(apexCount(outD, ([x, y]) => x === Math.max(...xs(outD).map(([px]) => px)) && y === 0)).toBe(1);
    // Both ways is blunt at both ends - two vertices on the centre line.
    const biD = dOf("BiDir");
    expect(xs(biD).filter(([, y]) => y === 0)).toHaveLength(2);
  });

  it("says the same thing in words, so the glyph is never the only channel", () => {
    mountMarked();
    expect(document.querySelector('.net-port-tag[data-net-port="In"] title')?.textContent)
      .toBe("VIN - sheet input, terminal 1");
  });
});

/**
 * THE UNSTYLED-MARK GATE.
 *
 * An SVG shape with no `fill` rule and no `fill` attribute is not invisible -
 * SVG's initial fill is opaque BLACK, and its initial pointer-events is
 * `visiblePainted`. So a new canvas mark whose class has no rule in App.css
 * does not "wait for the stylesheet to land": it ships as a black blob on the
 * instrument face, in both themes, ignoring "colour is measurement" entirely.
 *
 * This gate is derived from BOTH artefacts and restates neither: the class
 * tokens come out of the rendered DOM, the styled set comes out of App.css.
 */
describe("Canvas - every painted mark declares its own ink (no black-blob defaults)", () => {
  const PAINTED = "circle, rect, path, ellipse, line, text, polygon, polyline";

  const styledClasses = (): Set<string> => {
    // vitest runs with cwd = apps/desktop; `import.meta.url` is not a file URL
    // under the jsdom environment, so resolve off the package root instead.
    const css = readFileSync(resolve(process.cwd(), "src/App.css"), "utf8");
    // Only selector text, never declaration values, or `var(--x)` names and
    // `color-mix` arguments would masquerade as styled class names.
    const set = new Set<string>();
    for (const block of css.split("}")) {
      const selector = block.slice(block.lastIndexOf("{") >= 0 ? 0 : 0, block.indexOf("{"));
      for (const match of selector.matchAll(/\.([A-Za-z_][\w-]*)/g)) set.add(match[1]);
    }
    return set;
  };

  /** Marks that paint with neither a rule for their base class nor an
   *  explicit fill/stroke of their own. */
  const unstyledMarks = (root: ParentNode): string[] => {
    const styled = styledClasses();
    const bad = new Set<string>();
    for (const node of root.querySelectorAll(PAINTED)) {
      const tokens = (node.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
      if (!tokens.length) continue;
      const declaresInk = node.hasAttribute("fill") || node.hasAttribute("stroke");
      if (declaresInk) continue;
      if (tokens.some((token) => styled.has(token))) continue;
      bad.add(`${node.tagName.toLowerCase()}.${tokens.join(".")}`);
    }
    return [...bad].sort();
  };

  it("finds the gate itself trustworthy - a knowingly unstyled mark IS reported", () => {
    const { container } = render(
      <svg><circle className="tau-definitely-not-in-app-css" r={3} /></svg>,
    );
    expect(unstyledMarks(container)).toEqual(["circle.tau-definitely-not-in-app-css"]);
  });

  it("leaves no unstyled mark on a linked block, stale or clean", () => {
    const LINK = { sheetPath: "boost.sim", model: "Boost", ports: ["IN", "OUT", "GND"] };
    const base: SchematicComponent = {
      id: "x1", kind: "subckt", x: 320, y: 240, rotation: 0, mirrored: false,
      value: "Boost", label: "X1", projectSubcircuit: LINK,
    };
    useSchematic.setState({
      components: [{ ...base, pinOverride: buildSubcircuitPinOverride(base, LINK.ports, ["In", "Out", "BiDir"]) }],
      wires: [], netLabels: [], ascShapes: [], tool: { mode: "select" },
    } as Partial<SchematicState> as SchematicState);
    const { container } = render(
      <Canvas
        subcircuitDrift={new Map([["x1", { kind: "drifted" as const, sentence: "boost.sim reordered its connections.", pins: ["p2"] }]])}
        onReviewDrift={() => {}}
      />,
    );
    expect(unstyledMarks(container)).toEqual([]);
  });

  it("leaves no unstyled mark while the label tool is armed over a net", () => {
    useSchematic.setState({
      components: [], ascShapes: [],
      wires: [{ id: "w1", points: [{ x: 96, y: 128 }, { x: 224, y: 128 }] }],
      netLabels: [{ id: "l1", x: 96, y: 128, text: "VIN", port: "In" }],
      projectPorts: [{ name: "VIN", labelId: "l1", direction: "In" }],
      tool: { mode: "label" },
    } as Partial<SchematicState> as SchematicState);
    const { container } = render(<Canvas interactive />);
    const svg = container.querySelector("svg")!;
    svg.getBoundingClientRect = () => ({ x: 0, y: 0, width: 900, height: 600, top: 0, left: 0, right: 900, bottom: 600, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerMove(svg, { clientX: 160, clientY: 128 });
    // The puck is the whole 24-unit pick target; if it never rendered this
    // case would be vacuous, so prove it is there before judging its ink.
    expect(container.querySelector(".net-pick-puck")).not.toBeNull();
    expect(unstyledMarks(container)).toEqual([]);
  });
});
