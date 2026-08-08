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
import { extractCircuit } from "../schematic/netlist";
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

  it("stays off on the editor canvas even with a converged result", async () => {
    // Current Mode is a reading of a completed run, so it belongs to the
    // simulator. Moving current on the canvas you are still drawing into is
    // noise, and the overlay defaults off for exactly that reason.
    const op = okOp();
    expect(op.ok).toBe(true);
    render(<Canvas op={op} interactive />);
    await new Promise((r) => setTimeout(r, 60));
    expect(document.querySelector(".flow-layer")).toBeNull();
    // The toggle lives in App's simulator header, not on Canvas itself.
    expect(screen.queryByLabelText("Current Mode on")).toBeNull();
  });

  it("shows the flow layer when the simulator opts in", async () => {
    const op = okOp();
    render(<Canvas op={op} interactive={false} currentVisualizer />);
    // Dots are placed on the first animation frame, so the layer mounts a tick
    // after render rather than synchronously.
    await waitFor(() => expect(document.querySelector(".flow-layer")).not.toBeNull());
    expect(document.querySelectorAll(".flow-layer .flow-dot").length).toBeGreaterThan(0);
  });

  it("hides the flow layer entirely when current mode is off", async () => {
    render(<Canvas op={okOp()} interactive={false} currentVisualizer={false} />);
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
    render(<Canvas tran={tran} interactive={false} currentVisualizer />);
    await waitFor(() => expect(document.querySelector(".flow-layer")).not.toBeNull());
  });
});

describe("Canvas - reduced motion", () => {
  const mockReducedMotion = (reduce: boolean) => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: reduce && q.includes("prefers-reduced-motion"),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }));
  };

  it("still shows the flow layer, but does not animate it", async () => {
    // The movement is a JS rAF loop, so a CSS media query cannot stop it —
    // honouring the preference has to mean not scheduling frames. The dots
    // must still be drawn: hiding the data would punish the preference.
    mockReducedMotion(true);
    render(<Canvas op={okOp()} interactive={false} currentVisualizer />);
    await waitFor(() => expect(document.querySelector(".flow-layer")).not.toBeNull());

    const at = () => [...document.querySelectorAll(".flow-layer .flow-dot")]
      .map((d) => `${d.getAttribute("cx")},${d.getAttribute("cy")}`).join("|");
    const first = at();
    expect(first.length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 250));
    expect(at(), "dots moved despite prefers-reduced-motion").toBe(first);
  });

  it("animates normally when the preference is not set", async () => {
    mockReducedMotion(false);
    render(<Canvas op={okOp()} interactive={false} currentVisualizer />);
    await waitFor(() => expect(document.querySelector(".flow-layer")).not.toBeNull());
    const at = () => [...document.querySelectorAll(".flow-layer .flow-dot")]
      .map((d) => `${d.getAttribute("cx")},${d.getAttribute("cy")}`).join("|");
    const first = at();
    await new Promise((r) => setTimeout(r, 250));
    expect(at()).not.toBe(first);
  });
});

/**
 * An LED that looks identical passing 20 mA and nothing at all throws away the
 * reason it was drawn. Unlike the flow dots this is not a debugging aid, so it
 * is deliberately NOT behind the Current Mode toggle -- but it is held to the
 * same honesty bar: no result, no light.
 */
describe("Canvas - LED glow", () => {
  const LED = { id: "d-1", kind: "led", x: 224, y: 0, rotation: 0, value: "LED", label: "D1" } as SchematicComponent;
  const withLed = () => useSchematic.setState({ components: [VS, R1, LED, GND_VS, GND_R2], wires });
  // `tranComponentCurrents` walks `result.circuit`, so the fixture carries a
  // real extracted circuit rather than a hand-shaped stub.
  const tranAt = (amps: number, parts = [VS, R1, LED, GND_VS, GND_R2]) => ({
    ok: true as const,
    times: [0, 1e-3],
    traces: [],
    currents: [{ ref: "D1", label: "I(D1)", values: [amps, amps] }],
    circuit: extractCircuit(parts, wires, []),
    stats: { netCount: 3, componentCount: parts.length, sampleCount: 2, stopTime: 1e-3, stepSize: 5e-4 },
    warnings: [],
    title: "tran",
  });

  it("draws nothing before a run", () => {
    withLed();
    render(<Canvas interactive={false} />);
    expect(document.querySelectorAll(".led-glow")).toHaveLength(0);
  });

  it("lights the LED from a solved forward current", () => {
    withLed();
    render(<Canvas interactive={false} tran={tranAt(18e-3) as never} />);
    const glow = document.querySelectorAll(".led-glow");
    expect(glow).toHaveLength(1);
    // Near the 20 mA rating, so the halo should be close to its full radius.
    // That radius is now the extent of a gradient that has faded to nothing
    // well before it - the disc a reader actually sees is roughly half this -
    // so it is smaller than the flat outlined disc this replaced.
    // `LedGlowLayer.test.tsx` is where the shape of that falloff is asserted.
    expect(Number(glow[0].getAttribute("r"))).toBeGreaterThan(19);
  });

  it("stays dark when the same LED is reverse-biased", () => {
    withLed();
    render(<Canvas interactive={false} tran={tranAt(-18e-3) as never} />);
    expect(document.querySelectorAll(".led-glow")).toHaveLength(0);
  });

  it("does not need Current Mode switched on", () => {
    // The flow overlay is opt-in; a lit lamp is what the part does.
    withLed();
    render(<Canvas interactive={false} currentVisualizer={false} tran={tranAt(18e-3) as never} />);
    expect(document.querySelectorAll(".led-glow")).toHaveLength(1);
  });

  it("grows with drive, so two LEDs at different currents read differently", () => {
    const D2 = { ...LED, id: "d-2", label: "D2", x: 320 } as SchematicComponent;
    useSchematic.setState({ components: [VS, R1, LED, D2, GND_VS, GND_R2], wires });
    const result = {
      ...tranAt(18e-3, [VS, R1, LED, D2, GND_VS, GND_R2]),
      currents: [
        { ref: "D1", label: "I(D1)", values: [18e-3, 18e-3] },
        { ref: "D2", label: "I(D2)", values: [3e-4, 3e-4] },
      ],
    };
    render(<Canvas interactive={false} tran={result as never} />);
    const radii = [...document.querySelectorAll(".led-glow")].map((e) => Number(e.getAttribute("r")));
    expect(radii).toHaveLength(2);
    expect(Math.max(...radii)).toBeGreaterThan(Math.min(...radii) + 4);
  });
});
