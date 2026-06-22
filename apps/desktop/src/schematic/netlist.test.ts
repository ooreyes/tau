import { describe, expect, it } from "vitest";
import { extractCircuit } from "./netlist";
import type { SchematicComponent, SchematicWire } from "./types";

const wire = (id: string, points: { x: number; y: number }[]): SchematicWire => ({ id, points });

describe("net extraction crossing semantics", () => {
  it("keeps two unmarked wire interiors electrically separate", () => {
    const circuit = extractCircuit([], [
      wire("horizontal", [{ x: 0, y: 0 }, { x: 32, y: 0 }]),
      wire("vertical", [{ x: 16, y: -16 }, { x: 16, y: 16 }]),
    ]);

    expect(circuit.nets).toHaveLength(2);
  });

  it("joins a T when a branch explicitly ends on another wire", () => {
    const circuit = extractCircuit([], [
      wire("bus", [{ x: 0, y: 0 }, { x: 32, y: 0 }]),
      wire("branch", [{ x: 16, y: 0 }, { x: 16, y: 16 }]),
    ]);

    expect(circuit.nets).toHaveLength(1);
    expect(circuit.nets[0].points).toEqual(expect.arrayContaining([
      { x: 0, y: 0 },
      { x: 32, y: 0 },
      { x: 16, y: 16 },
    ]));
  });

  it("joins an intersection when a component pin explicitly marks it", () => {
    const source: SchematicComponent = {
      id: "v1",
      kind: "vsource",
      label: "V1",
      value: "5",
      x: 16,
      y: 32,
      rotation: 0,
    };
    const circuit = extractCircuit([source], [
      wire("horizontal", [{ x: 0, y: 0 }, { x: 32, y: 0 }]),
      wire("vertical", [{ x: 16, y: -16 }, { x: 16, y: 16 }]),
    ]);

    const sourceNet = circuit.nets.find((net) => net.pins.some((pin) => pin.componentId === "v1" && pin.id === "p"));
    expect(sourceNet?.points).toEqual(expect.arrayContaining([
      { x: 0, y: 0 },
      { x: 32, y: 0 },
      { x: 16, y: -16 },
      { x: 16, y: 16 },
    ]));
  });
});
