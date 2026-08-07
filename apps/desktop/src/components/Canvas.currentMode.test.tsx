// @vitest-environment jsdom
/**
 * Current mode is the animated flow-dot overlay: real branch current moving
 * along the wires. It carries no numeric readouts — values live in the
 * measurement panels, where they can be read without covering the drawing.
 *
 * Two properties matter here. It must draw from a real OP or `.tran` result and
 * never invent one, and it must be genuinely dismissable: `currentVisualizer`
 * false hides the layer rather than freezing it, so an overlay the user does
 * not want costs them nothing.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { Canvas } from "./Canvas";
import { useSchematic } from "../store/useSchematic";
import { runOperatingPoint } from "../simulation/operatingPoint";
import type { SchematicComponent, SchematicWire } from "../schematic/types";

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});

const VS: SchematicComponent = { id: "vs-1", kind: "vsource", x: 0, y: 32, rotation: 0, value: "10V", label: "V1" };
const R1: SchematicComponent = { id: "r-1", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" };
const R2: SchematicComponent = { id: "r-2", kind: "resistor", x: 224, y: 0, rotation: 0, value: "1k", label: "R2" };
const GND_VS: SchematicComponent = { id: "g-1", kind: "ground", x: 0, y: 64, rotation: 0, value: "", label: "" };
const GND_R2: SchematicComponent = { id: "g-2", kind: "ground", x: 256, y: 0, rotation: 0, value: "", label: "" };
const components = [VS, R1, R2, GND_VS, GND_R2];
const wires: SchematicWire[] = [
  { id: "w-1", points: [{ x: 0, y: 0 }, { x: 64, y: 0 }] },
  { id: "w-2", points: [{ x: 128, y: 0 }, { x: 192, y: 0 }] },
];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  useSchematic.setState({
    components,
    wires,
    probes: [],
    netLabels: [],
    directives: [".op"],
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

const okOp = () =>
  runOperatingPoint({ components, wires }, { returnBranches: true });

describe("Canvas - current mode", () => {
  it("draws no numeric readouts on the schematic", () => {
    // The schematic used to print "V ±157 mV" / "I ±978 µA" beside every net
    // and part. They covered the drawing and were removed; the canvas must stay
    // clean even with a converged result in hand.
    render(<Canvas op={okOp()} interactive />);
    expect(document.querySelectorAll(".op-annotation")).toHaveLength(0);
  });

  it("shows the flow layer on the editor canvas after a real OP", async () => {
    const op = okOp();
    expect(op.ok).toBe(true);
    render(<Canvas op={op} interactive />);
    // Dots are placed on the first animation frame, so the layer mounts a tick
    // after render rather than synchronously.
    await waitFor(() => expect(document.querySelector(".flow-layer")).not.toBeNull());
    expect(document.querySelectorAll(".flow-layer .flow-dot").length).toBeGreaterThan(0);
    // The badge lives in App's simulator header, not on Canvas itself.
    expect(screen.queryByLabelText("Current mode on")).toBeNull();
  });

  it("hides the flow layer entirely when current mode is off", async () => {
    render(<Canvas op={okOp()} interactive currentVisualizer={false} />);
    // Give the animation the same chance to start that the "on" case gets, so
    // this proves the layer stays absent rather than merely not-yet-mounted.
    await new Promise((r) => setTimeout(r, 60));
    expect(document.querySelector(".flow-layer")).toBeNull();
  });

  it("does not invent a flow overlay without an OP/TRAN result", () => {
    render(<Canvas interactive />);
    expect(document.querySelectorAll(".flow-layer .flow-dot")).toHaveLength(0);
  });

  it("drives flow from a real .tran sample when one is available", async () => {
    const { runTransientAnalysis } = await import("../simulation/linearTransient");
    const tran = await runTransientAnalysis({ components, wires }, { stopTime: 1e-3, steps: 64 });
    expect(tran.ok).toBe(true);
    render(<Canvas tran={tran} interactive />);
    await waitFor(() => expect(document.querySelector(".flow-layer")).not.toBeNull());
  });
});
