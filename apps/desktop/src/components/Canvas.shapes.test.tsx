// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

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
