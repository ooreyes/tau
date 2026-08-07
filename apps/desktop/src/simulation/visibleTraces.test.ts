import { describe, expect, it } from "vitest";
import { probeTraceOwners, visibleTransientTraces } from "./visibleTraces";
import type { AnalysisResult } from "./linearTransient";
import type { NetLabel, Probe, SchematicWire } from "../schematic/types";
import { extractCircuit } from "../schematic/netlist";
import type { SchematicComponent } from "../schematic/types";

/**
 * The probe and its curve must never disagree about colour. The schematic dot
 * and the plotted trace are two views of one measurement, and the plot's colour
 * picker used to write to a private override — so recolouring the curve left
 * the probe on its old hue.
 */
const VS: SchematicComponent = { id: "v", kind: "vsource", x: 0, y: 32, rotation: 0, value: "10V", label: "V1" };
const R1: SchematicComponent = { id: "r", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" };
const G: SchematicComponent = { id: "g", kind: "ground", x: 0, y: 64, rotation: 0, value: "", label: "" };
const components = [VS, R1, G];
const wires: SchematicWire[] = [{ id: "w1", points: [{ x: 0, y: 0 }, { x: 64, y: 0 }] }];

function okResult(): Extract<AnalysisResult, { ok: true }> {
  const circuit = extractCircuit(components, wires, []);
  const net = circuit.nets.find((n) => !n.isGround)!;
  return {
    ok: true,
    title: "t",
    times: [0, 1],
    traces: [{ id: net.id, label: `V(${net.id})`, unit: "V", color: "var(--trace-green)", values: [0, 1] }],
    currents: [{ ref: "R1", label: "I(R1)", values: [0, 1e-3] }],
    circuit,
    stats: { sampleCount: 2, netCount: 2, componentCount: 3, stopTime: 1, stepSize: 1 },
    warnings: [],
  } as unknown as Extract<AnalysisResult, { ok: true }>;
}

describe("probe / trace colour ownership", () => {
  it("maps a net probe to the trace it produces", () => {
    const result = okResult();
    const net = result.circuit.nets.find((n) => !n.isGround)!;
    const probe: Probe = { id: "p1", x: 0, y: 0, color: "var(--trace-red)" } as Probe;
    expect(probeTraceOwners(result, [probe], wires).get(net.id)).toBe("p1");
  });

  it("maps a current probe to its I(ref) trace", () => {
    const result = okResult();
    const probe = { id: "p2", x: 96, y: 0, color: "var(--trace-cyan)", componentId: "r" } as Probe;
    expect(probeTraceOwners(result, [probe], wires).get("I(R1)")).toBe("p2");
  });

  it("claims no owner for a trace with no probe behind it", () => {
    const result = okResult();
    expect(probeTraceOwners(result, [], wires).size).toBe(0);
  });

  it("draws the trace in the probe's colour, so changing one changes both", () => {
    const result = okResult();
    const net = result.circuit.nets.find((n) => !n.isGround)!;
    const probe: Probe = { id: "p1", x: 0, y: 0, color: "var(--trace-red)" } as Probe;
    const visible = visibleTransientTraces(result, [probe], wires, [] as NetLabel[]);
    expect(visible.find((t) => t.id === net.id)?.color).toBe("var(--trace-red)");

    // Recolour the probe: the curve follows, because it reads the same value.
    const recoloured = visibleTransientTraces(
      result, [{ ...probe, color: "var(--trace-purple)" }], wires, [] as NetLabel[],
    );
    expect(recoloured.find((t) => t.id === net.id)?.color).toBe("var(--trace-purple)");
  });
});
