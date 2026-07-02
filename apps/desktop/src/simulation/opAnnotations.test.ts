/**
 * OP schematic annotations: positioned voltage/current labels from a real
 * operating-point run over a voltage divider, so net-id and component-id
 * resolution are exercised end to end.
 *
 * Divider (documented pin geometry, GRID = 16):
 *   VS at (0, 32):    p=(0,0),   n=(0,64)   — 10 V
 *   R1 at (96, 0):    a=(64,0),  b=(128,0)  — 1k
 *   R2 at (224, 0):   a=(192,0), b=(256,0)  — 1k, b wired to ground
 *   Wires: (0,0)→(64,0) and (128,0)→(192,0); R2.b→(256,64)→ground at (256,64).
 *   V(out) = mid node = 5 V; I(V1) (MNA convention) = −5 mA.
 */
import { describe, it, expect } from "vitest";
import { runOperatingPoint } from "./operatingPoint";
import { extractCircuit } from "../schematic/netlist";
import { opAnnotations } from "./opAnnotations";
import type { SchematicComponent, SchematicWire } from "../schematic/types";

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

function annotated() {
  const op = runOperatingPoint({ components, wires }, { returnBranches: true });
  const circuit = extractCircuit(components, wires, []);
  return opAnnotations(op, circuit);
}

describe("opAnnotations", () => {
  it("labels each non-ground net with its voltage at the net's topmost-leftmost point", () => {
    const anns = annotated();
    const volts = anns.filter((a) => a.kind === "voltage");
    expect(volts).toHaveLength(2); // source net + divider midpoint; grounds skipped
    // Source net spans (0,0)..(64,0): anchor (0,0), 10 V.
    const src = volts.find((a) => a.x === 0 && a.y === 0);
    expect(src?.text).toBe("10 V");
    // Mid net spans (128,0)..(192,0): anchor (128,0), 5 V.
    const mid = volts.find((a) => a.x === 128 && a.y === 0);
    expect(mid?.text).toBe("5 V");
  });

  it("labels the voltage source with its branch current at the component position", () => {
    const anns = annotated();
    const amps = anns.filter((a) => a.kind === "current");
    expect(amps).toHaveLength(1);
    expect(amps[0]).toMatchObject({ x: 0, y: 32, key: "i:vs-1" });
    // MNA branch current for a sourcing battery is negative: −10V/2k = −5 mA.
    expect(amps[0].text).toBe("-5 mA");
  });

  it("returns [] for a null, failed, or geometry-less input", () => {
    const circuit = extractCircuit(components, wires, []);
    expect(opAnnotations(null, circuit)).toEqual([]);
    expect(opAnnotations({ ok: false, message: "x", warnings: [] }, circuit)).toEqual([]);
    const op = runOperatingPoint({ components, wires });
    expect(opAnnotations(op, null)).toEqual([]);
  });

  it("skips nets and branches that no longer exist in the circuit (stale result)", () => {
    const op = runOperatingPoint({ components, wires }, { returnBranches: true });
    const emptyCircuit = extractCircuit([GND_VS], [], []);
    expect(opAnnotations(op, emptyCircuit)).toEqual([]);
  });

  it("omits branch currents when the OP run did not return branches", () => {
    const op = runOperatingPoint({ components, wires });
    const circuit = extractCircuit(components, wires, []);
    expect(opAnnotations(op, circuit).every((a) => a.kind === "voltage")).toBe(true);
  });
});
