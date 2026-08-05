import { describe, expect, it } from "vitest";
import { extractCircuit } from "../schematic/netlist";
import { getComponentPins } from "../schematic/pins";
import type { SchematicComponent, SchematicWire } from "../schematic/types";
import { runOperatingPoint } from "./operatingPoint";
import {
  flowDotsForWires,
  opComponentCurrents,
  peakAbsCurrent,
  wireFlowCurrent,
} from "./wireCurrentFlow";

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

function buildPinIndex() {
  const pinIndex = new Map<string, { componentId: string; pinId: string }[]>();
  for (const c of components) {
    for (const p of getComponentPins(c)) {
      const k = `${p.x},${p.y}`;
      const list = pinIndex.get(k) ?? [];
      list.push({ componentId: c.id, pinId: p.id });
      pinIndex.set(k, list);
    }
  }
  return pinIndex;
}

describe("wireCurrentFlow (current mode)", () => {
  it("builds real OP currents for the source and both resistors", () => {
    const op = runOperatingPoint({ components, wires }, { returnBranches: true });
    expect(op.ok).toBe(true);
    const circuit = extractCircuit(components, wires, []);
    const currents = opComponentCurrents(op, circuit);
    expect(currents.get("vs-1")).toBeCloseTo(-0.005, 9);
    expect(currents.get("r-1")).toBeCloseTo(0.005, 9);
    expect(currents.get("r-2")).toBeCloseTo(0.005, 9);
    expect(peakAbsCurrent(currents)).toBeCloseTo(0.005, 9);
  });

  it("attributes series wire flow from the adjacent source/resistor pin", () => {
    const op = runOperatingPoint({ components, wires }, { returnBranches: true });
    const circuit = extractCircuit(components, wires, []);
    const currents = opComponentCurrents(op, circuit);
    const pinIndex = buildPinIndex();
    const flow = wireFlowCurrent(wires[0], pinIndex, currents);
    expect(Math.abs(flow)).toBeCloseTo(0.005, 9);
  });

  it("emits visible flow dots only from real non-zero currents", () => {
    const op = runOperatingPoint({ components, wires }, { returnBranches: true });
    const circuit = extractCircuit(components, wires, []);
    const currents = opComponentCurrents(op, circuit);
    const pinIndex = buildPinIndex();
    const phase = new Map<string, number>();
    const dots = flowDotsForWires(wires, pinIndex, currents, phase, 0.05);
    expect(dots.length).toBeGreaterThan(0);
    expect(dots.every((d) => Number.isFinite(d.x) && Number.isFinite(d.y) && d.opacity > 0)).toBe(true);
    expect(flowDotsForWires(wires, pinIndex, new Map(), new Map(), 0.05)).toEqual([]);
  });
});
