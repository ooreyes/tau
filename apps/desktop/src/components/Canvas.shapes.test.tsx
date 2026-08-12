// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Canvas } from "./Canvas";
import { circuitBounds, circuitBoundsWithLabels } from "./Canvas.geometry";
import { useSchematic } from "../store/useSchematic";
import type { SchematicAscShape } from "../schematic/types";

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

  const renderWithLabel = (extra: Parameters<typeof useSchematic.setState>[0] = {}) => {
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
  const CIRCUIT = [
    { id: "v1", kind: "vsource" as const, x: 0, y: 0, rotation: 0, value: "SINE(0 1 1k)", label: "V1" },
    { id: "c1", kind: "capacitor" as const, x: 128, y: 0, rotation: 0, value: "1u", label: "C1" },
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
