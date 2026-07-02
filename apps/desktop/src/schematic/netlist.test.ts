import { describe, expect, it } from "vitest";
import { extractCircuit, netAtPoint } from "./netlist";
import type { NetLabel, SchematicComponent, SchematicWire } from "./types";

const wire = (id: string, points: { x: number; y: number }[]): SchematicWire => ({ id, points });
const label = (id: string, x: number, y: number, text: string): NetLabel => ({ id, x, y, text });
const resistor = (id: string, x: number, y: number): SchematicComponent => ({
  id, kind: "resistor", label: id.toUpperCase(), value: "1k", x, y, rotation: 0,
});

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

describe("net labels are electrical", () => {
  // r1 spans pins (68,0)-(132,0); r2 spans (268,0)-(332,0) — physically apart.
  const r1 = resistor("r1", 100, 0);
  const r2 = resistor("r2", 300, 0);

  it("merges physically separate nets that share a label name", () => {
    const labelled = extractCircuit([r1, r2], [], [
      label("l1", 132, 0, "vcc"),
      label("l2", 268, 0, "vcc"),
    ]);
    const unlabelled = extractCircuit([r1, r2], []);
    // Without labels the four pins are four nets; the shared label joins two.
    expect(unlabelled.nets).toHaveLength(4);
    expect(labelled.nets).toHaveLength(3);
    const net = labelled.nets.find((n) => n.id === "vcc");
    expect(net).toBeDefined();
    expect(net?.pins.map((p) => p.componentId).sort()).toEqual(["r1", "r2"]);
  });

  it("does not merge nets carrying different label names", () => {
    const circuit = extractCircuit([r1, r2], [], [
      label("l1", 132, 0, "a"),
      label("l2", 268, 0, "b"),
    ]);
    expect(circuit.nets).toHaveLength(4);
  });

  it("treats a label named 0 as ground", () => {
    const circuit = extractCircuit([r1], [], [label("g", 132, 0, "0")]);
    const ground = circuit.nets.find((n) => n.isGround);
    expect(ground).toBeDefined();
    expect(circuit.groundNetId).toBe("0");
    expect(ground?.points).toContainEqual({ x: 132, y: 0 });
  });

  it("treats GND (any case) as ground too", () => {
    const circuit = extractCircuit([r1], [], [label("g", 132, 0, "GnD")]);
    expect(circuit.groundNetId).toBe("0");
  });

  it("names a net after its label so V(name) resolves", () => {
    const circuit = extractCircuit([r1], [], [label("l", 132, 0, "OUT")]);
    expect(circuit.nets.some((n) => n.id === "OUT")).toBe(true);
  });

  it("splits a wire when a label lands on its interior", () => {
    // A single long wire from r1.b to r2.a; a label mid-wire still names it.
    const circuit = extractCircuit([r1, r2], [
      wire("bus", [{ x: 132, y: 0 }, { x: 268, y: 0 }]),
    ], [label("l", 200, 0, "bus")]);
    const bus = circuit.nets.find((n) => n.id === "bus");
    expect(bus?.pins.map((p) => p.componentId).sort()).toEqual(["r1", "r2"]);
  });

  it("ignores blank labels", () => {
    const circuit = extractCircuit([r1, r2], [], [
      label("l1", 132, 0, "  "),
      label("l2", 268, 0, ""),
    ]);
    expect(circuit.nets).toHaveLength(4);
  });
});

describe("netAtPoint (probe resolution)", () => {
  // r1 spans pins (68,0)-(132,0); r2 spans (268,0)-(332,0), joined by a bus wire.
  const r1 = resistor("r1", 100, 0);
  const r2 = resistor("r2", 300, 0);
  const bus = wire("bus", [{ x: 132, y: 0 }, { x: 268, y: 0 }]);

  it("resolves an exact net point (wire endpoint / pin)", () => {
    const circuit = extractCircuit([r1, r2], [bus]);
    const net = netAtPoint(circuit.nets, [bus], { x: 132, y: 0 });
    expect(net).not.toBeNull();
    expect(net?.pins.map((p) => p.componentId).sort()).toEqual(["r1", "r2"]);
  });

  it("resolves a mid-segment point that is not a recorded net point", () => {
    const circuit = extractCircuit([r1, r2], [bus]);
    const midNet = circuit.nets.find((n) => n.pins.length === 2);
    // Precondition for the regression: the interior grid point is NOT stored.
    expect(midNet?.points.some((p) => p.x === 200 && p.y === 0)).toBe(false);
    const net = netAtPoint(circuit.nets, [bus], { x: 200, y: 0 });
    expect(net?.id).toBe(midNet?.id);
  });

  it("resolves a mid-segment point on a vertical wire", () => {
    const drop = wire("drop", [{ x: 132, y: 0 }, { x: 132, y: 96 }]);
    const circuit = extractCircuit([r1], [drop]);
    const net = netAtPoint(circuit.nets, [drop], { x: 132, y: 48 });
    expect(net?.pins.some((p) => p.componentId === "r1")).toBe(true);
  });

  it("returns null off every wire and net point", () => {
    const circuit = extractCircuit([r1, r2], [bus]);
    expect(netAtPoint(circuit.nets, [bus], { x: 200, y: 16 })).toBeNull();
    expect(netAtPoint(circuit.nets, [bus], { x: 999, y: 999 })).toBeNull();
  });

  it("returns the ground net (callers decide whether to filter it)", () => {
    const circuit = extractCircuit([r1], [bus], [label("g", 268, 0, "0")]);
    const net = netAtPoint(circuit.nets, [bus], { x: 200, y: 0 });
    expect(net?.isGround).toBe(true);
  });
});
