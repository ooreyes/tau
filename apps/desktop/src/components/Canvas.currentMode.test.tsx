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
import {
  FLOW_DOT_SPACING_PX,
  FLOW_SPEED_FLOOR_PX_S,
  flowSpeedPxPerSecond,
  flowMagnitude,
  quantizeFlowMagnitude,
} from "../simulation/wireCurrentFlow";
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

describe("Current Mode animation model", () => {
  /**
   * There is deliberately no frame cadence to pin any more. The dots are a
   * `stroke-dashoffset` animation, so the browser paces them at the display's
   * own refresh rate and no JS runs per frame. The old 30 Hz gate is gone
   * because owning it was the bug: its dependencies were rebuilt ~30x/second by
   * the schematic readout, the loop was torn down that often, and it never
   * survived long enough to clear its own 33 ms threshold — measured 3.4 px/s
   * against an intended 46. What is worth pinning instead is that speed still
   * means amps, and that it is now legible.
   */
  const speedAt = (amps: number) =>
    flowSpeedPxPerSecond(quantizeFlowMagnitude(flowMagnitude(amps)));

  it("keeps dot speed monotonic in amps across the whole scale", () => {
    // Never slower for more current, anywhere. Below 1 µA the magnitude scale
    // is documented as pinned to its floor, so those decades tie rather than
    // ordering - which is why this is non-decreasing and the strict ordering is
    // asserted separately over the band that actually resolves.
    const decades = [1e-12, 1e-9, 1e-6, 1e-3, 1e-2, 1e-1, 1, 10];
    const speeds = decades.map(speedAt);
    for (let i = 1; i < speeds.length; i += 1) {
      expect(speeds[i], `${decades[i]} A must not be slower than ${decades[i - 1]} A`)
        .toBeGreaterThanOrEqual(speeds[i - 1]);
    }
  });

  it("resolves every decade from the floor at 1 µA up to 1 A", () => {
    // This is the property the absolute scale exists for: a 100 Ω loop and a
    // 1 MΩ loop must not animate identically. Ties here would put four decades
    // of Ohm's law back on one speed.
    const decades = [1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 1e-1, 1];
    const speeds = decades.map(speedAt);
    for (let i = 1; i < speeds.length; i += 1) {
      expect(speeds[i], `${decades[i]} A must be faster than ${decades[i - 1]} A`)
        .toBeGreaterThan(speeds[i - 1]);
    }
  });

  it("moves a 5 mA branch fast enough to read as flowing current", () => {
    // The switched-divider fixture's load current. At the old 9 + mag*60 map
    // this was 46 px/s — about 2.2 dots past a point per second, which reads as
    // a crawl. One dot-gap per ~0.23 s is the bar.
    const speed = flowSpeedPxPerSecond(quantizeFlowMagnitude(flowMagnitude(5e-3)));
    expect(speed).toBeGreaterThan(90);
    expect(FLOW_DOT_SPACING_PX / speed).toBeLessThan(0.3);
  });

  it("never freezes a current it has decided to show", () => {
    // A picoamp is below the floor and draws nothing at all; anything the layer
    // does draw has to move, or it reads as a broken visualiser.
    expect(flowMagnitude(1e-13)).toBe(0);
    expect(flowSpeedPxPerSecond(quantizeFlowMagnitude(flowMagnitude(1e-9))))
      .toBeGreaterThanOrEqual(FLOW_SPEED_FLOOR_PX_S);
  });
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

  /**
   * These two used to sample `cx`/`cy` across a `setTimeout` and assert the dots
   * had (or had not) moved. That could only ever work while a JS loop owned the
   * motion, and it was a timing race even then. The motion is now a CSS
   * animation, which jsdom does not run, so the honest contract to pin is the
   * one the component actually decides: whether it hands the browser an
   * animation to play at all, and how fast.
   */
  const dots = () => [...document.querySelectorAll<SVGPathElement>(".flow-layer .flow-dot")];

  it("still draws the flow layer, but hands it no animation", async () => {
    // The dots must still be drawn: hiding the reading would punish the
    // preference. Direction stays legible from the static arrowheads.
    mockReducedMotion(true);
    render(<Canvas op={okOp()} interactive={false} currentVisualizer />);
    await waitFor(() => expect(document.querySelector(".flow-layer")).not.toBeNull());

    expect(dots().length).toBeGreaterThan(0);
    for (const dot of dots()) {
      expect(dot.style.animation, "animated despite prefers-reduced-motion").toBe("none");
      expect(dot.style.animationDuration).toBe("");
    }
    expect(document.querySelectorAll(".flow-layer .flow-arrow").length).toBeGreaterThan(0);
  });

  it("animates normally when the preference is not set", async () => {
    mockReducedMotion(false);
    render(<Canvas op={okOp()} interactive={false} currentVisualizer />);
    await waitFor(() => expect(document.querySelector(".flow-layer")).not.toBeNull());

    expect(dots().length).toBeGreaterThan(0);
    for (const dot of dots()) {
      expect(dot.style.animation).toBe("");
      // A finite, positive period, and the dash geometry the keyframe is
      // written against - without `pathLength` the shared 0 -> -1 travel would
      // mean a different distance on every wire.
      const seconds = Number.parseFloat(dot.style.animationDuration);
      expect(Number.isFinite(seconds)).toBe(true);
      expect(seconds).toBeGreaterThan(0);
      expect(Number(dot.getAttribute("pathLength"))).toBeGreaterThanOrEqual(1);
      expect(["normal", "reverse"]).toContain(dot.style.animationDirection);
    }
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
