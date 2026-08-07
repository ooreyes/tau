// @vitest-environment jsdom
/**
 * Current mode must paint on the *editor* canvas after a real OP — not only
 * when interactive={false} (simulator view). Omar-visible regression.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

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
const wires: SchematicWire[] = [
  { id: "w-1", points: [{ x: 0, y: 0 }, { x: 64, y: 0 }] },
  { id: "w-2", points: [{ x: 128, y: 0 }, { x: 192, y: 0 }] },
];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  useSchematic.setState({
    components: [VS, R1, R2, GND_VS, GND_R2],
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

describe("Canvas - current mode on editor", () => {
  it("shows OP voltage/current annotations when interactive (editor) after a real OP", () => {
    const op = runOperatingPoint(
      { components: [VS, R1, R2, GND_VS, GND_R2], wires },
      { returnBranches: true },
    );
    expect(op.ok).toBe(true);
    render(<Canvas op={op} interactive />);

    const volts = [...document.querySelectorAll(".op-annotation.voltage")].map((el) => el.textContent);
    const amps = [...document.querySelectorAll(".op-annotation.current")].map((el) => el.textContent);
    // Each readout names its quantity, so the cyan/green convention is not the
    // only thing telling a voltage from a current.
    expect(volts).toEqual(expect.arrayContaining(["V 10 V", "V 5 V"]));
    expect(amps).toEqual(expect.arrayContaining(["I -5 mA", "I 5 mA"]));
    // No stale "Current mode" chrome on Canvas itself — badge lives in App sim header.
    expect(screen.queryByLabelText("Current mode on")).toBeNull();
  });

  it("does not invent annotations without an OP/TRAN result", () => {
    render(<Canvas interactive />);
    expect(document.querySelectorAll(".op-annotation")).toHaveLength(0);
  });

  it("keeps readouts static while Live playback scrubs the waveform", async () => {
    // The reported complaint was numbers "actively cycling". Live playback
    // drives `readoutTime` every animation frame to animate the flow dots; the
    // READOUTS must stay on the settled value regardless, or the schematic goes
    // back to flickering through instantaneous samples. This is a structural
    // guarantee - `tranAnnotations` is called without a time - and structural
    // guarantees are exactly the ones a later edit reinstates by accident.
    // The waveform must actually MOVE, or the test cannot tell a settled
    // reading from an instantaneous one: on a DC divider every sample equals
    // the settled value, and passing `readoutTime` through would go unnoticed.
    const { extractCircuit } = await import("../schematic/netlist");
    const circuit = extractCircuit([VS, R1, R2, GND_VS, GND_R2], wires, []);
    const net = circuit.nets.find((n) => !n.isGround)!;
    const samples = 64;
    const times = Array.from({ length: samples }, (_, i) => (i / (samples - 1)) * 1e-3);
    const sine = times.map((_, i) => 5 * Math.sin((2 * Math.PI * i) / 16));

    const tran = {
      ok: true as const,
      title: "Live scrub fixture",
      times,
      traces: [{ id: net.id, label: `V(${net.id})`, unit: "V", color: "#000", values: sine }],
      currents: [{ ref: "R1", label: "I(R1)", values: sine.map((v) => v / 1000) }],
      circuit,
      stats: { sampleCount: samples, netCount: 2, componentCount: 3, stopTime: 1e-3, stepSize: 1e-5 },
      warnings: [],
    };
    // Sanity: the trace really does swing, so a per-sample readout would differ.
    expect(Math.max(...sine) - Math.min(...sine)).toBeGreaterThan(1);

    const readAll = () => [...document.querySelectorAll(".op-annotation")]
      .map((el) => el.textContent);

    render(<Canvas tran={tran as never} interactive readoutTime={null} />);
    const paused = readAll();
    expect(paused.length).toBeGreaterThan(0);
    cleanup();

    // Sweep the scrub position across the whole waveform, as Live does.
    for (const fraction of [0, 0.17, 0.4, 0.63, 0.85, 1]) {
      const t = times[0]! + fraction * (times[times.length - 1]! - times[0]!);
      render(<Canvas tran={tran as never} interactive readoutTime={t} />);
      expect(readAll(), `readouts changed at scrub fraction ${fraction}`).toEqual(paused);
      cleanup();
    }
  });
});
