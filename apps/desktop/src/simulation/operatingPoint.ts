/**
 * DC Operating-Point Analysis (.op)
 *
 * Computes the DC steady-state node voltages via Modified Nodal Analysis.
 * The DC simplifications are:
 *   - Capacitors → OPEN circuit (omitted entirely)
 *   - Inductors  → SHORT circuit (treated as a 0 V voltage source / wire)
 *   - Resistors  → stamped normally
 *   - DC Voltage sources → stamped normally
 *
 * This module is SELF-CONTAINED. It does NOT import or depend on any
 * internals from linearTransient.ts. It uses only:
 *   - extractCircuit from ../schematic/netlist
 *   - parseQuantity from ./quantity
 */

import type { SchematicComponent, SchematicWire } from "../schematic/types";
import { extractCircuit, type ExtractedCircuit } from "../schematic/netlist";
import { parseQuantity } from "./quantity";

// ---------------------------------------------------------------------------
// Result type (mirrors linearTransient's style)
// ---------------------------------------------------------------------------

export type OperatingPointResult =
  | {
      ok: true;
      nets: { id: string; voltage: number }[];
      warnings: string[];
    }
  | {
      ok: false;
      message: string;
      warnings: string[];
    };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function runOperatingPoint(schematic: {
  components: SchematicComponent[];
  wires: SchematicWire[];
}): OperatingPointResult {
  let circuit: ExtractedCircuit | undefined;

  try {
    circuit = extractCircuit(schematic.components, schematic.wires);

    if (schematic.components.length === 0) {
      return fail("Place components before running analysis.", circuit);
    }
    if (!circuit.groundNetId) {
      return fail(
        "Add a ground symbol so node voltages have a reference.",
        circuit,
      );
    }
    if (!schematic.components.some((c) => c.kind === "vsource")) {
      return fail("Add a voltage source to excite the circuit.", circuit);
    }

    // Non-ground nets become unknowns (node voltages)
    const nonGroundNets = circuit.nets.filter((n) => !n.isGround);
    if (nonGroundNets.length === 0) {
      return fail("Connect at least one non-ground node.", circuit);
    }

    // Voltage sources and inductors (treated as 0 V sources) each add one
    // extra unknown (branch current).
    const voltageSources = circuit.components.filter(
      ({ component }) => component.kind === "vsource",
    );
    const inductors = circuit.components.filter(
      ({ component }) => component.kind === "inductor",
    );

    const nodeIndex = new Map(
      nonGroundNets.map((net, idx) => [net.id, idx]),
    );
    const voltageSourceOffset = nonGroundNets.length;
    const inductorOffset = voltageSourceOffset + voltageSources.length;
    const size = nonGroundNets.length + voltageSources.length + inductors.length;

    if (size === 0) {
      return fail("The circuit has no unknowns to solve.", circuit);
    }

    // Allocate MNA matrix and RHS
    const matrix = zeroMatrix(size);
    const rhs = Array<number>(size).fill(0);

    // Stamp each component
    for (const entry of circuit.components) {
      switch (entry.component.kind) {
        case "resistor": {
          const resistance = positiveValue(entry.component, "Ω");
          const g = 1 / resistance;
          const a = nodeIdx(entry.pins["a"], nodeIndex);
          const b = nodeIdx(entry.pins["b"], nodeIndex);
          stampConductance(matrix, a, b, g);
          break;
        }

        case "capacitor":
          // Open circuit at DC — skip entirely
          break;

        case "inductor": {
          // Short circuit at DC: treat as a 0 V voltage source
          const iIdx =
            inductorOffset +
            inductors.findIndex(
              (l) => l.component.id === entry.component.id,
            );
          const a = nodeIdx(entry.pins["a"], nodeIndex);
          const b = nodeIdx(entry.pins["b"], nodeIndex);
          stampVoltageSource(matrix, rhs, a, b, iIdx, 0);
          break;
        }

        case "vsource": {
          const sIdx =
            voltageSourceOffset +
            voltageSources.findIndex(
              (v) => v.component.id === entry.component.id,
            );
          const p = nodeIdx(entry.pins["p"], nodeIndex);
          const n = nodeIdx(entry.pins["n"], nodeIndex);
          const v = parseQuantity(entry.component.value, "V");
          stampVoltageSource(matrix, rhs, p, n, sIdx, v);
          break;
        }

        case "ground":
          // Ground pins are absorbed into the reference — nothing to stamp
          break;
      }
    }

    const solution = solveLinearSystem(matrix, rhs);

    const nets = nonGroundNets.map((net, idx) => ({
      id: net.id,
      voltage: solution[idx],
    }));

    // Add the ground net explicitly at 0 V
    nets.unshift({ id: circuit.groundNetId, voltage: 0 });

    return {
      ok: true,
      nets,
      warnings: circuit.warnings,
    };
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Unknown analysis error.",
      circuit,
    );
  }
}

// ---------------------------------------------------------------------------
// MNA helpers (self-contained, not shared with linearTransient)
// ---------------------------------------------------------------------------

function zeroMatrix(size: number): number[][] {
  return Array.from({ length: size }, () => Array<number>(size).fill(0));
}

function nodeIdx(net: string | undefined, index: Map<string, number>): number {
  if (!net || net === "0") return -1;
  return index.get(net) ?? -1;
}

function stampConductance(
  matrix: number[][],
  a: number,
  b: number,
  g: number,
) {
  if (a >= 0) matrix[a][a] += g;
  if (b >= 0) matrix[b][b] += g;
  if (a >= 0 && b >= 0) {
    matrix[a][b] -= g;
    matrix[b][a] -= g;
  }
}

function stampVoltageSource(
  matrix: number[][],
  rhs: number[],
  positive: number,
  negative: number,
  sourceIndex: number,
  voltage: number,
) {
  if (positive >= 0) {
    matrix[positive][sourceIndex] += 1;
    matrix[sourceIndex][positive] += 1;
  }
  if (negative >= 0) {
    matrix[negative][sourceIndex] -= 1;
    matrix[sourceIndex][negative] -= 1;
  }
  rhs[sourceIndex] += voltage;
}

/**
 * Gaussian elimination with partial pivoting.
 * Throws if the matrix is singular.
 */
function solveLinearSystem(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  // Augmented matrix [A | b]
  const a = matrix.map((row, i) => [...row, rhs[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivot
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) {
      throw new Error(
        "Matrix is singular. Check for floating nodes, voltage-source loops, or missing ground connections.",
      );
    }
    if (pivot !== col) {
      const tmp = a[pivot];
      a[pivot] = a[col];
      a[col] = tmp;
    }

    const pivotVal = a[col][col];
    for (let j = col; j <= n; j++) a[col][j] /= pivotVal;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) a[row][j] -= factor * a[col][j];
    }
  }

  return a.map((row) => row[n]);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function positiveValue(component: SchematicComponent, unit: string): number {
  const v = parseQuantity(component.value, unit);
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(
      `${component.label || component.id} must have a positive ${unit} value.`,
    );
  }
  return v;
}

function fail(
  message: string,
  circuit?: ExtractedCircuit,
): OperatingPointResult {
  return {
    ok: false,
    message,
    warnings: circuit?.warnings ?? [],
  };
}
