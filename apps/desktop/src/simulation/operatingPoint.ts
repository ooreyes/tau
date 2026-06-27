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

import type { ComponentKind, NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";
import { extractCircuit, type ExtractedCircuit } from "../schematic/netlist";
import { parseQuantity } from "./quantity";
import { resolveComponentValues, EMPTY_SCOPE, type ParamScope } from "./paramScope";

// ---------------------------------------------------------------------------
// Result type (mirrors linearTransient's style)
// ---------------------------------------------------------------------------

export type OperatingPointResult =
  | {
      ok: true;
      nets: { id: string; label: string; voltage: number }[];
      /**
       * Independent-voltage-source and inductor branch currents (the MNA
       * auxiliary unknowns), present only when {@link OpOptions.returnBranches}
       * is set. `current` is the raw MNA unknown: for a voltage source it equals
       * the current flowing INTO its + node from the source branch, i.e. the
       * NEGATIVE of the conventional current delivered out of the + terminal.
       */
      branches?: { id: string; label: string; current: number }[];
      warnings: string[];
    }
  | {
      ok: false;
      message: string;
      warnings: string[];
    };

/** Optional, purely-additive knobs used by small-signal analyses (`.tf`). */
export interface OpOptions {
  /**
   * Extra DC current injected INTO the given nets (amps). A positive value adds
   * current into that node's KCL — i.e. an ideal test current source from ground
   * into the net. Used to probe output impedance. Nets are matched by net id
   * (the same id reported back in `nets[].id`).
   */
  injectCurrents?: { netId: string; amps: number }[];
  /** Also return independent voltage-source / inductor branch currents. */
  returnBranches?: boolean;
}

const OP_SUPPORTED = new Set<ComponentKind>([
  "resistor",
  "capacitor",
  "inductor",
  "vsource",
  "isource",
  "vac",
  "iac",
  "opamp",
  "vcvs",
  "vccs",
  "switch",
  "testpoint",
  "ground",
]);

/** Tiny conductance added from every non-ground node to ground (SPICE gmin trick).
 *  Prevents singular matrices caused by floating nodes (e.g. unconnected op-amp rails). */
const GMIN = 1e-12;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function runOperatingPoint(
  schematic: {
    components: SchematicComponent[];
    wires: SchematicWire[];
    netLabels?: NetLabel[];
    params?: ParamScope;
  },
  options: OpOptions = {},
): OperatingPointResult {
  let circuit: ExtractedCircuit | undefined;

  try {
    const components = resolveComponentValues(schematic.components, schematic.params ?? EMPTY_SCOPE);
    circuit = extractCircuit(components, schematic.wires, schematic.netLabels ?? []);

    if (components.length === 0) {
      return fail("Place components before running analysis.", circuit);
    }
    const unsupported = components.filter((component) => !OP_SUPPORTED.has(component.kind));
    if (unsupported.length > 0) {
      return fail(
        `${unsupported.map((component) => component.label || component.kind).join(", ")} ${unsupported.length === 1 ? "is" : "are"} placeable and wireable, but operating point currently supports only R/C/L, voltage/current sources, AC sources at 0 DC, switches, grounds, and test points.`,
        circuit,
      );
    }
    if (!circuit.groundNetId) {
      return fail(
        "Add a ground symbol so node voltages have a reference.",
        circuit,
      );
    }
    if (!components.some((c) => ["vsource", "isource", "vac", "iac"].includes(c.kind))) {
      return fail("Add a voltage or current source to excite the circuit.", circuit);
    }

    // Non-ground nets become unknowns (node voltages)
    const nonGroundNets = circuit.nets.filter((n) => !n.isGround);
    if (nonGroundNets.length === 0) {
      return fail("Connect at least one non-ground node.", circuit);
    }

    // Voltage sources and inductors (treated as 0 V sources) each add one
    // extra unknown (branch current). Op-amps add one extra unknown (output
    // branch current io) whose constraint row enforces V(in+) = V(in-).
    const voltageSources = circuit.components.filter(
      ({ component }) => component.kind === "vsource" || component.kind === "vac",
    );
    const inductors = circuit.components.filter(
      ({ component }) => component.kind === "inductor",
    );
    const opamps = circuit.components.filter(
      ({ component }) => component.kind === "opamp",
    );
    // VCVS (E) adds a branch-current unknown, like an independent voltage source.
    const vcvss = circuit.components.filter(
      ({ component }) => component.kind === "vcvs",
    );

    const nodeIndex = new Map(
      nonGroundNets.map((net, idx) => [net.id, idx]),
    );
    const voltageSourceOffset = nonGroundNets.length;
    const inductorOffset = voltageSourceOffset + voltageSources.length;
    const opampOffset = inductorOffset + inductors.length;
    const vcvsOffset = opampOffset + opamps.length;
    const size = nonGroundNets.length + voltageSources.length + inductors.length + opamps.length + vcvss.length;

    if (size === 0) {
      return fail("The circuit has no unknowns to solve.", circuit);
    }

    // Allocate MNA matrix and RHS
    const matrix = zeroMatrix(size);
    const rhs = Array<number>(size).fill(0);

    // SPICE gmin: when op-amps are present, add GMIN from every non-ground
    // node to ground so floating nodes (e.g. unconnected op-amp v+/v- rails)
    // resolve to ~0 V rather than making the matrix singular.
    // Applied only when op-amps are in the circuit to avoid masking genuine
    // floating-node errors in resistive/reactive-only circuits.
    if (opamps.length > 0) {
      for (let i = 0; i < nonGroundNets.length; i++) {
        matrix[i][i] += GMIN;
      }
    }

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

        case "vac": {
          const sIdx =
            voltageSourceOffset +
            voltageSources.findIndex(
              (v) => v.component.id === entry.component.id,
            );
          const p = nodeIdx(entry.pins["p"], nodeIndex);
          const n = nodeIdx(entry.pins["n"], nodeIndex);
          stampVoltageSource(matrix, rhs, p, n, sIdx, 0);
          break;
        }

        case "isource": {
          const p = nodeIdx(entry.pins["p"], nodeIndex);
          const n = nodeIdx(entry.pins["n"], nodeIndex);
          // SPICE convention: positive value → conventional current exits the + (p) terminal
          // into the external circuit, i.e., the source injects current INTO node p and
          // withdraws from node n.  stampCurrent(rhs, from, to, I) subtracts from "from"
          // and adds to "to", so stamp from n to p.
          stampCurrent(rhs, n, p, parseQuantity(entry.component.value, "A"));
          break;
        }

        case "iac":
          // Pure AC current source contributes 0 A at DC.
          break;

        case "opamp": {
          // Ideal op-amp (nullor): adds one extra unknown io (output branch current).
          // The constraint row enforces V(in+) = V(in-) (virtual short).
          // Output current io is injected into the out net KCL row.
          // Input pins draw NO current. Power pins (v+/v-) are ignored (gmin handles them).
          const ioIdx =
            opampOffset +
            opamps.findIndex((op) => op.component.id === entry.component.id);
          const outNode = nodeIdx(entry.pins["out"], nodeIndex);
          const inPlusNode = nodeIdx(entry.pins["in+"], nodeIndex);
          const inMinusNode = nodeIdx(entry.pins["in-"], nodeIndex);
          // Output current injection into out KCL row
          if (outNode >= 0) matrix[outNode][ioIdx] += 1;
          // Virtual-short constraint row: V(in+) - V(in-) = 0
          if (inPlusNode >= 0) matrix[ioIdx][inPlusNode] += 1;
          if (inMinusNode >= 0) matrix[ioIdx][inMinusNode] -= 1;
          // rhs[ioIdx] = 0 (already zero from initialisation)
          break;
        }

        case "vccs": {
          // VCCS (G): I(op→on) = gm·(V(cp) − V(cn)). Pure transconductance stamp,
          // no extra unknown. Current leaves op into the device (+gm row) and
          // enters on (−gm row), matching ngspice `G op on cp cn gm`.
          const gm = parseQuantity(entry.component.value, "A/V");
          const op = nodeIdx(entry.pins["op"], nodeIndex);
          const on = nodeIdx(entry.pins["on"], nodeIndex);
          const cp = nodeIdx(entry.pins["cp"], nodeIndex);
          const cn = nodeIdx(entry.pins["cn"], nodeIndex);
          stampVCCS(matrix, op, on, cp, cn, gm);
          break;
        }

        case "vcvs": {
          // VCVS (E): V(op) − V(on) = gain·(V(cp) − V(cn)). Like a voltage source
          // whose value is the controlled term; adds one branch-current unknown.
          const gain = parseQuantity(entry.component.value, "V/V");
          const iIdx =
            vcvsOffset +
            vcvss.findIndex((e) => e.component.id === entry.component.id);
          const op = nodeIdx(entry.pins["op"], nodeIndex);
          const on = nodeIdx(entry.pins["on"], nodeIndex);
          const cp = nodeIdx(entry.pins["cp"], nodeIndex);
          const cn = nodeIdx(entry.pins["cn"], nodeIndex);
          stampVCVS(matrix, op, on, cp, cn, iIdx, gain);
          break;
        }

        case "switch":
          if (entry.component.value.trim().toLowerCase().startsWith("closed")) {
            const a = nodeIdx(entry.pins["a"], nodeIndex);
            const b = nodeIdx(entry.pins["b"], nodeIndex);
            stampConductance(matrix, a, b, 1e9);
          }
          break;

        case "testpoint":
        case "ground":
          // Ground pins are absorbed into the reference — nothing to stamp
          break;
      }
    }

    // Optional test-current injection (e.g. output-impedance probe): add the
    // requested current into each named net's KCL row. Unknown net ids are
    // ignored (the caller learns valid ids from a prior baseline solve).
    if (options.injectCurrents) {
      for (const { netId, amps } of options.injectCurrents) {
        const idx = nodeIndex.get(netId);
        if (idx !== undefined) rhs[idx] += amps;
      }
    }

    const solution = solveLinearSystem(matrix, rhs);

    const nets = nonGroundNets.map((net, idx) => ({
      id: net.id,
      label: `V(${nodeName(net)})`,
      voltage: solution[idx],
    }));

    // Add the ground net explicitly at 0 V
    nets.unshift({ id: circuit.groundNetId, label: "GND", voltage: 0 });

    let branches: { id: string; label: string; current: number }[] | undefined;
    if (options.returnBranches) {
      branches = [];
      voltageSources.forEach((v, i) => {
        branches!.push({
          id: v.component.id,
          label: `I(${v.component.label || v.component.id})`,
          current: solution[voltageSourceOffset + i],
        });
      });
      inductors.forEach((l, i) => {
        branches!.push({
          id: l.component.id,
          label: `I(${l.component.label || l.component.id})`,
          current: solution[inductorOffset + i],
        });
      });
    }

    return {
      ok: true,
      nets,
      ...(branches ? { branches } : {}),
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

function stampCurrent(rhs: number[], a: number, b: number, currentFromAToB: number) {
  if (a >= 0) rhs[a] -= currentFromAToB;
  if (b >= 0) rhs[b] += currentFromAToB;
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

/** Voltage-controlled current source: I(op→on) = gm·(V(cp) − V(cn)). */
function stampVCCS(
  matrix: number[][],
  op: number,
  on: number,
  cp: number,
  cn: number,
  gm: number,
) {
  if (op >= 0 && cp >= 0) matrix[op][cp] += gm;
  if (op >= 0 && cn >= 0) matrix[op][cn] -= gm;
  if (on >= 0 && cp >= 0) matrix[on][cp] -= gm;
  if (on >= 0 && cn >= 0) matrix[on][cn] += gm;
}

/** Voltage-controlled voltage source: V(op) − V(on) = gain·(V(cp) − V(cn)).
 *  `branchIndex` is the auxiliary branch-current unknown. */
function stampVCVS(
  matrix: number[][],
  op: number,
  on: number,
  cp: number,
  cn: number,
  branchIndex: number,
  gain: number,
) {
  // Output branch current couples into the KCL of op (+) and on (−).
  if (op >= 0) {
    matrix[op][branchIndex] += 1;
    matrix[branchIndex][op] += 1;
  }
  if (on >= 0) {
    matrix[on][branchIndex] -= 1;
    matrix[branchIndex][on] -= 1;
  }
  // Constraint row: V(op) − V(on) − gain·(V(cp) − V(cn)) = 0.
  if (cp >= 0) matrix[branchIndex][cp] -= gain;
  if (cn >= 0) matrix[branchIndex][cn] += gain;
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

function nodeName(net: { id: string; pins: { componentLabel: string }[] }): string {
  const labels = [...new Set(net.pins.map((pin) => pin.componentLabel).filter(Boolean))];
  return labels.length > 0 ? labels.slice(0, 2).join("·") : net.id;
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
