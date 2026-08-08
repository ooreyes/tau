/**
 * DC Operating-Point Analysis (.op)
 *
 * Computes the DC steady-state node voltages via Modified Nodal Analysis.
 * The DC simplifications are:
 *   - Capacitors → OPEN circuit (omitted entirely)
 *   - Inductors  → SHORT circuit (treated as a 0 V voltage source / wire)
 *   - Resistors  → stamped normally
 *   - DC Voltage sources → stamped normally
 *   - Diodes/LEDs/zeners → Newton iteration over the shared junction
 *     companion model (the same one the transient solver uses)
 *
 * This module is SELF-CONTAINED. It does NOT import or depend on any
 * internals from linearTransient.ts. It uses only:
 *   - extractCircuit from ../schematic/netlist
 *   - parseQuantity from ./quantity
 */

import type { ComponentKind, NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";
import { isIndependentVoltageBranchKind, isSpdtThrowToNo, isStaticContactClosed, logicConstantVolts, motorArmature, photodiodePhotocurrentAmps } from "../schematic/kindGroups";
import { extractCircuit, type ExtractedCircuit } from "../schematic/netlist";
import { parseQuantity } from "./quantity";
import { resolveComponentValues, EMPTY_SCOPE, type ParamScope } from "./paramScope";
import { linearBSourceModel, resolveBehavioralTerms, type BehavioralTerm, type LinearBehavioral } from "./behavioral";
import { stripAcSpec } from "../engine/acSpec";
import { parseTransientSource, isFunctionSource } from "./sourceWaveform";
import { DIODE_KINDS, diodeConductance, diodeCurrent, diodeSpecFor, limitDiodeVoltage } from "./diodeCompanion";
import { previewCurrentControlledSwitchMessage } from "../schematic/currentControlledSwitch";
import { previewChargeDefinedCapacitorMessage, previewNegativeCapacitorMessage } from "../schematic/behavioralCapacitor";
import { previewVendorOpampMessage } from "../engine/opampModel";

// ---------------------------------------------------------------------------
// Result type (mirrors linearTransient's style)
// ---------------------------------------------------------------------------

export interface DeviceOperatingPoint {
  id: string;
  label: string;
  region?: "cutoff" | "forward-active" | "reverse-active" | "linear" | "saturation" | "conducting";
  parameters: { name: string; value: number; unit: "V" | "S" }[];
}

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
       *
       * A part that reports several terminals contributes SEVERAL entries under
       * one component `id`: the untagged one is the part's own current, the
       * tagged ones its individual terminals (`terminal: "b"` labelled
       * `Ib(Q1)`), each the current INTO that terminal. `id` is therefore not
       * unique - resolve one-per-part through {@link primaryBranches} rather
       * than by building a lookup over the list, which would let the last
       * terminal answer for the part.
       */
      branches?: { id: string; label: string; current: number; terminal?: string }[];
      /** Native ngspice bias/small-signal data for semiconductor primitives. */
      devices?: DeviceOperatingPoint[];
      warnings: string[];
    }
  | {
      ok: false;
      message: string;
      warnings: string[];
    };

/**
 * The branches that are a part's OWN current, dropping the per-terminal entries
 * a device like a BJT contributes alongside it.
 *
 * A multi-terminal part occupies its component id more than once, so a consumer
 * that wants one entry per part - a canvas label, an inductor's seed current -
 * has to say which one. Doing it through here states "the untagged entry is the
 * part's own current" once instead of per call site; a Map built over the whole
 * list would answer with whichever terminal came last, a different number with
 * the opposite sign.
 */
export function primaryBranches<T extends { terminal?: string }>(
  branches: ReadonlyArray<T> | undefined,
): T[] {
  return (branches ?? []).filter((branch) => !branch.terminal);
}

/** Optional, purely-additive knobs used by small-signal analyses (`.tf`). */
export interface OpOptions {
  /**
   * Extra DC current injected INTO the given nets (amps). A positive value adds
   * current into that node's KCL - i.e. an ideal test current source from ground
   * into the net. Used to probe output impedance. Nets are matched by net id
   * (the same id reported back in `nets[].id`).
   */
  injectCurrents?: { netId: string; amps: number }[];
  /** Also return independent voltage-source / inductor branch currents. */
  returnBranches?: boolean;
}

const OP_SUPPORTED = new Set<ComponentKind>([
  "resistor",
  "bulb",
  "capacitor",
  "polarizedCapacitor",
  "inductor",
  "vsource",
  "isource",
  "vac",
  "iac",
  "logicConstant",
  "opamp",
  "vcvs",
  "vccs",
  "cccs",
  "ccvs",
  "bsource",
  "switch",
  "pushButton",
  "spdt",
  "motor",
  "ground",
  "diode",
  "led",
  "zener",
  "photodiode",
  "sevenSeg",
]);

/** Tiny conductance added from every non-ground node to ground (SPICE gmin trick).
 *  Prevents singular matrices caused by floating nodes (e.g. unconnected op-amp rails). */
const GMIN = 1e-12;

/** Newton iteration budget when junction diodes are present - matches the
 *  transient solver's SPICE itl-style ceiling; convergence normally takes < 10. */
const NEWTON_MAX_ITERATIONS = 100;

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
    const chargeCapacitorMessage = previewChargeDefinedCapacitorMessage(schematic.components);
    if (chargeCapacitorMessage) return fail(chargeCapacitorMessage, circuit);
    const components = resolveComponentValues(schematic.components, schematic.params ?? EMPTY_SCOPE);
    const vendorOpampMessage = previewVendorOpampMessage(components);
    if (vendorOpampMessage) return fail(vendorOpampMessage, circuit);
    const negativeCapacitorMessage = previewNegativeCapacitorMessage(components);
    if (negativeCapacitorMessage) return fail(negativeCapacitorMessage, circuit);
    circuit = extractCircuit(components, schematic.wires, schematic.netLabels ?? []);

    const currentSwitchMessage = previewCurrentControlledSwitchMessage(components);
    if (currentSwitchMessage) return fail(currentSwitchMessage, circuit);

    if (components.length === 0) {
      return fail("Place components before running analysis.", circuit);
    }
    const unsupported = components.filter((component) => !OP_SUPPORTED.has(component.kind));
    if (unsupported.length > 0) {
      return fail(
        `${unsupported.map((component) => component.label || component.kind).join(", ")} ${unsupported.length === 1 ? "is" : "are"} placeable and wireable, but operating point currently supports only R/C/L, voltage/current sources, AC sources at 0 DC, diodes/LEDs/zeners, op-amps, controlled sources, switches, and grounds.`,
        circuit,
      );
    }
    if (!circuit.groundNetId) {
      return fail(
        "Add a ground symbol so node voltages have a reference.",
        circuit,
      );
    }
    if (!components.some((c) => ["vsource", "isource", "vac", "iac", "bsource", "logicConstant", "photodiode"].includes(c.kind))) {
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
      ({ component }) => isIndependentVoltageBranchKind(component.kind),
    );
    const inductors = circuit.components.filter(
      ({ component }) => component.kind === "inductor",
    );
    const opamps = circuit.components.filter(
      ({ component }) => component.kind === "opamp",
    );
    // A switch's NC+/NC- control pair is optional; left unwired it forms
    // single-pin nets that are all-zero rows in the matrix. Same floating-node
    // case as an unconnected op-amp rail, so it takes the same gmin shunt.
    const hasSwitch = circuit.components.some(({ component }) => component.kind === "switch");
    // VCVS (E) adds a branch-current unknown, like an independent voltage source.
    const vcvss = circuit.components.filter(
      ({ component }) => component.kind === "vcvs",
    );
    // CCCS (F): 1 extra unknown (the zero-volt control-sense branch current).
    const cccss = circuit.components.filter(
      ({ component }) => component.kind === "cccs",
    );
    // CCVS (H): 2 extra unknowns (control-sense branch + output branch current).
    const ccvss = circuit.components.filter(
      ({ component }) => component.kind === "ccvs",
    );
    // Behavioral sources (B): linearize each to constant + Σ coeff·V(node).
    // V-type behaves like a (multi-input) VCVS and adds one branch unknown;
    // I-type is a transconductance-style stamp with no extra unknown.
    const scope = (schematic.params ?? EMPTY_SCOPE);
    const bModels = new Map<string, LinearBehavioral>();
    for (const e of circuit.components) {
      if (e.component.kind !== "bsource") continue;
      bModels.set(
        e.component.id,
        linearBSourceModel(e.component.label, e.component.value, scope.scope, scope.funcs),
      );
    }
    const vBsources = circuit.components.filter(
      ({ component }) => component.kind === "bsource" && bModels.get(component.id)?.type === "V",
    );
    // Junction diodes add no unknowns; they are Newton-iterated companion
    // stamps layered over the constant part of the matrix after assembly.
    const diodes = circuit.components.filter(({ component }) => DIODE_KINDS.has(component.kind));

    const nodeIndex = new Map(
      nonGroundNets.map((net, idx) => [net.id, idx]),
    );
    // Resolve a behavioral expression's node name (e.g. V(out)) to a matrix
    // index; ground / "0" → −1. Net ids are the (sanitized) net-label names.
    const netByName = new Map<string, number>();
    nonGroundNets.forEach((net, idx) => netByName.set(net.id.toLowerCase(), idx));
    const voltageSourceOffset = nonGroundNets.length;
    const inductorOffset = voltageSourceOffset + voltageSources.length;
    const opampOffset = inductorOffset + inductors.length;
    const vcvsOffset = opampOffset + opamps.length;
    const cccsOffset = vcvsOffset + vcvss.length;
    const ccvsOffset = cccsOffset + cccss.length;
    const bsourceOffset = ccvsOffset + ccvss.length * 2;
    const size =
      nonGroundNets.length +
      voltageSources.length +
      inductors.length +
      opamps.length +
      vcvss.length +
      cccss.length +
      ccvss.length * 2 +
      vBsources.length;

    if (size === 0) {
      return fail("The circuit has no unknowns to solve.", circuit);
    }

    // Allocate MNA matrix and RHS
    const matrix = zeroMatrix(size);
    const rhs = Array<number>(size).fill(0);

    // SPICE gmin: when op-amps, diodes or switches are present, add GMIN from every
    // non-ground node to ground so floating nodes (e.g. unconnected op-amp
    // v+/v- rails, or a node isolated behind a reverse-biased diode) resolve
    // to ~0 V rather than making the matrix singular. Applied only for those
    // devices to avoid masking genuine floating-node errors elsewhere.
    if (opamps.length > 0 || diodes.length > 0 || hasSwitch) {
      for (let i = 0; i < nonGroundNets.length; i++) {
        matrix[i][i] += GMIN;
      }
    }

    // Stamp each component
    for (const entry of circuit.components) {
      switch (entry.component.kind) {
        case "resistor":
        case "bulb": {
          const resistance = positiveValue(entry.component, "Ω");
          const g = 1 / resistance;
          const a = nodeIdx(entry.pins["a"], nodeIndex);
          const b = nodeIdx(entry.pins["b"], nodeIndex);
          stampConductance(matrix, a, b, g);
          break;
        }

        case "motor": {
          // At DC the armature inductance is a short — stamp cold R only.
          const { resistance } = motorArmature(entry.component.value);
          const g = 1 / resistance;
          const a = nodeIdx(entry.pins["a"], nodeIndex);
          const b = nodeIdx(entry.pins["b"], nodeIndex);
          stampConductance(matrix, a, b, g);
          break;
        }

        case "polarizedCapacitor":
        case "capacitor":
          // Open circuit at DC - skip entirely
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
          const v = isFunctionSource(entry.component.value)
            ? parseTransientSource(entry.component.value, "V").dc
            : parseQuantity(stripAcSpec(entry.component.value), "V");
          stampVoltageSource(matrix, rhs, p, n, sIdx, v);
          break;
        }

        case "logicConstant": {
          const sIdx =
            voltageSourceOffset +
            voltageSources.findIndex(
              (v) => v.component.id === entry.component.id,
            );
          const p = nodeIdx(entry.pins["p"], nodeIndex);
          const n = nodeIdx(entry.pins["n"], nodeIndex);
          let v: number;
          try {
            v = logicConstantVolts(entry.component.value);
          } catch {
            v = parseQuantity(entry.component.value, "V");
          }
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
          const i = isFunctionSource(entry.component.value)
            ? parseTransientSource(entry.component.value, "A").dc
            : parseQuantity(stripAcSpec(entry.component.value), "A");
          stampCurrent(rhs, n, p, i);
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

        case "cccs": {
          // CCCS (F): I(op→on) = gain·I_sense, where I_sense is the current
          // through an internal 0 V source across the control pair (cp→cn).
          const gain = parseQuantity(entry.component.value, "A/A");
          const senseIdx =
            cccsOffset +
            cccss.findIndex((f) => f.component.id === entry.component.id);
          const op = nodeIdx(entry.pins["op"], nodeIndex);
          const on = nodeIdx(entry.pins["on"], nodeIndex);
          const cp = nodeIdx(entry.pins["cp"], nodeIndex);
          const cn = nodeIdx(entry.pins["cn"], nodeIndex);
          stampCCCS(matrix, op, on, cp, cn, senseIdx, gain);
          break;
        }

        case "ccvs": {
          // CCVS (H): V(op) − V(on) = r·I_sense (transresistance).
          const r = parseQuantity(entry.component.value, "V/A");
          const i = ccvss.findIndex((h) => h.component.id === entry.component.id);
          const senseIdx = ccvsOffset + i * 2;
          const outIdx = ccvsOffset + i * 2 + 1;
          const op = nodeIdx(entry.pins["op"], nodeIndex);
          const on = nodeIdx(entry.pins["on"], nodeIndex);
          const cp = nodeIdx(entry.pins["cp"], nodeIndex);
          const cn = nodeIdx(entry.pins["cn"], nodeIndex);
          stampCCVS(matrix, op, on, cp, cn, senseIdx, outIdx, r);
          break;
        }

        case "bsource": {
          const model = bModels.get(entry.component.id)!;
          const p = nodeIdx(entry.pins["p"], nodeIndex);
          const n = nodeIdx(entry.pins["n"], nodeIndex);
          const terms = resolveBehavioralTerms(model, entry.component.label, netByName);
          if (model.type === "V") {
            const branchIndex =
              bsourceOffset +
              vBsources.findIndex((b) => b.component.id === entry.component.id);
            stampLinearVSource(matrix, rhs, p, n, branchIndex, model.constant, terms);
          } else {
            stampLinearISource(matrix, rhs, p, n, model.constant, terms);
          }
          break;
        }

        case "switch":
        case "pushButton":
          if (isStaticContactClosed(entry.component.value)) {
            const a = nodeIdx(entry.pins["a"], nodeIndex);
            const b = nodeIdx(entry.pins["b"], nodeIndex);
            stampConductance(matrix, a, b, 1e9);
          }
          break;

        case "spdt": {
          const com = nodeIdx(entry.pins["com"], nodeIndex);
          const thrown = isSpdtThrowToNo(entry.component.value)
            ? nodeIdx(entry.pins["no"], nodeIndex)
            : nodeIdx(entry.pins["nc"], nodeIndex);
          stampConductance(matrix, com, thrown, 1e9);
          break;
        }

        case "sevenSeg": {
          // High-Z segment loads (1 GΩ) match the deck's R_… 1G emission.
          const com = nodeIdx(entry.pins["com"], nodeIndex);
          for (const id of ["a", "b", "c", "d", "e", "f", "g", "dp"] as const) {
            const seg = nodeIdx(entry.pins[id], nodeIndex);
            if (seg < 0 && com < 0) continue;
            stampConductance(matrix, seg, com, 1e-9);
          }
          break;
        }

        case "diode":
        case "led":
        case "zener":
        case "photodiode":
          // Nonlinear - stamped per Newton iteration below, not here.
          break;

        case "ground":
          // Ground pins are absorbed into the reference - nothing to stamp
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

    // Linear circuits solve in one shot. With junction diodes the assembled
    // matrix/rhs above is the constant part; Newton-iterate the diode
    // companions on top of a copy until the junction voltages settle
    // (SPICE-style reltol/vntol), with pnjlim damping each update.
    let solution: number[];
    if (diodes.length === 0) {
      solution = solveLinearSystem(matrix, rhs);
    } else {
      const diodeSpecs = new Map(
        diodes.map((entry) => [entry.component.id, diodeSpecFor(entry.component.kind, entry.component.value)]),
      );
      const guesses = new Map(diodes.map((entry) => [entry.component.id, 0]));
      let converged: number[] | null = null;
      for (let iteration = 0; iteration < NEWTON_MAX_ITERATIONS; iteration++) {
        const newtonMatrix = matrix.map((row) => [...row]);
        const newtonRhs = [...rhs];
        for (const entry of diodes) {
          const spec = diodeSpecs.get(entry.component.id)!;
          const junction = guesses.get(entry.component.id)!;
          const conductance = diodeConductance(spec, junction);
          const equivalent = diodeCurrent(spec, junction) - conductance * junction;
          const anode = nodeIdx(entry.pins["a"], nodeIndex);
          const cathode = nodeIdx(entry.pins["k"], nodeIndex);
          stampConductance(newtonMatrix, anode, cathode, conductance);
          stampCurrent(newtonRhs, anode, cathode, equivalent);
          if (entry.component.kind === "photodiode") {
            // Iph flows K→A (reverse photocurrent).
            stampCurrent(newtonRhs, cathode, anode, photodiodePhotocurrentAmps(entry.component.value));
          }
        }
        const attempt = solveLinearSystem(newtonMatrix, newtonRhs);
        let settled = true;
        for (const entry of diodes) {
          const spec = diodeSpecs.get(entry.component.id)!;
          const previous = guesses.get(entry.component.id)!;
          const anode = nodeIdx(entry.pins["a"], nodeIndex);
          const cathode = nodeIdx(entry.pins["k"], nodeIndex);
          const junction =
            (anode >= 0 ? attempt[anode] : 0) - (cathode >= 0 ? attempt[cathode] : 0);
          const next = limitDiodeVoltage(spec, junction, previous);
          if (Math.abs(next - previous) > 1e-6 + 1e-3 * Math.abs(next)) settled = false;
          guesses.set(entry.component.id, next);
        }
        if (settled) {
          converged = attempt;
          break;
        }
      }
      if (!converged) {
        return fail("The diode models did not converge at the DC operating point. Simplify the circuit or check diode orientation.", circuit);
      }
      solution = converged;
    }

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

/** Linear behavioral V-source: V(p) − V(n) = constant + Σ coeff·V(node). Adds a
 *  branch unknown (like a VCVS with a constant offset and multiple inputs). */
function stampLinearVSource(
  matrix: number[][],
  rhs: number[],
  p: number,
  n: number,
  branchIndex: number,
  constant: number,
  terms: BehavioralTerm[],
) {
  stampVoltageSource(matrix, rhs, p, n, branchIndex, constant);
  for (const { index, coeff } of terms) {
    if (index >= 0) matrix[branchIndex][index] -= coeff;
  }
}

/** Linear behavioral I-source: I(p→n) = constant + Σ coeff·V(node). No extra
 *  unknown - a constant current plus VCCS coupling terms. */
function stampLinearISource(
  matrix: number[][],
  rhs: number[],
  p: number,
  n: number,
  constant: number,
  terms: BehavioralTerm[],
) {
  stampCurrent(rhs, p, n, constant);
  for (const { index, coeff } of terms) {
    stampVCCS(matrix, p, n, index, -1, coeff);
  }
}

/**
 * Stamp the internal zero-volt sense source across a current-controlled source's
 * control pair (cp→cn). `senseIdx` is its branch-current unknown: the current
 * flowing INTO cp and out of cn through the (ideal ammeter) sense branch, i.e.
 * the controlling current I(cp→cn). Constraint row enforces V(cp) − V(cn) = 0.
 */
function stampSenseBranch(
  matrix: number[][],
  cp: number,
  cn: number,
  senseIdx: number,
) {
  if (cp >= 0) {
    matrix[cp][senseIdx] += 1;
    matrix[senseIdx][cp] += 1;
  }
  if (cn >= 0) {
    matrix[cn][senseIdx] -= 1;
    matrix[senseIdx][cn] -= 1;
  }
}

/** Current-controlled current source: I(op→on) = gain·I_sense(cp→cn). */
function stampCCCS(
  matrix: number[][],
  op: number,
  on: number,
  cp: number,
  cn: number,
  senseIdx: number,
  gain: number,
) {
  stampSenseBranch(matrix, cp, cn, senseIdx);
  // Output current gain·I_sense leaves op and enters on.
  if (op >= 0) matrix[op][senseIdx] += gain;
  if (on >= 0) matrix[on][senseIdx] -= gain;
}

/** Current-controlled voltage source: V(op) − V(on) = r·I_sense(cp→cn).
 *  `outIdx` is the output branch-current unknown. */
function stampCCVS(
  matrix: number[][],
  op: number,
  on: number,
  cp: number,
  cn: number,
  senseIdx: number,
  outIdx: number,
  r: number,
) {
  stampSenseBranch(matrix, cp, cn, senseIdx);
  // Output branch current couples into the KCL of op (+) and on (−).
  if (op >= 0) {
    matrix[op][outIdx] += 1;
    matrix[outIdx][op] += 1;
  }
  if (on >= 0) {
    matrix[on][outIdx] -= 1;
    matrix[outIdx][on] -= 1;
  }
  // Constraint row: V(op) − V(on) − r·I_sense = 0.
  matrix[outIdx][senseIdx] -= r;
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
