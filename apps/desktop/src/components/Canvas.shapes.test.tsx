// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Canvas } from "./Canvas";
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
