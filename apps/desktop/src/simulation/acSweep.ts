/**
 * Small-signal AC frequency-sweep analysis.
 *
 * Builds a complex-valued MNA matrix at each frequency and solves for node
 * voltages. The result gives magnitude (dB) and phase (degrees) for each
 * non-ground net across the swept frequency range.
 *
 * This module is SELF-CONTAINED. It does NOT import or depend on any internals
 * from linearTransient.ts or operatingPoint.ts. It uses only:
 *   - extractCircuit from ../schematic/netlist
 *   - parseQuantity from ./quantity
 *   - types from ../schematic/types
 */

import type { ComponentKind, NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";
import { extractCircuit, type ExtractedCircuit } from "../schematic/netlist";
import { parseQuantity } from "./quantity";
import { resolveComponentValues, EMPTY_SCOPE, type ParamScope } from "./paramScope";
import { mutualTerms, type CouplingSpec, type MutualTerm } from "./coupling";
import { linearBSourceModel, resolveBehavioralTerms, type LinearBehavioral } from "./behavioral";
import { parseAcSpec } from "../engine/acSpec";
import { previewCurrentControlledSwitchMessage } from "../schematic/currentControlledSwitch";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AcOptions {
  startHz: number;
  stopHz: number;
  pointsPerDecade: number;
}

export interface AcTrace {
  id: string;
  label: string;
  magDb: number[];
  phaseDeg: number[];
}

export type AcResult =
  | { ok: true; freqs: number[]; traces: AcTrace[]; warnings: string[] }
  | { ok: false; message: string; warnings: string[] };

/**
 * An AC sweep is driven only by an independent source carrying an `AC <mag>`
 * stimulus - a plain DC source is a short (or an open) at AC. With none of them
 * present the circuit is unexcited and every node sits at exactly zero, which
 * ngspice reports as a clean run rather than as an error, so both engines share
 * this test and refuse instead of drawing a flat trace at the dB floor.
 *
 * Call with param-resolved components: an `AC {amp}` stimulus is only visible
 * once the scope has been applied.
 *
 * A source living inside an imported `.subckt` is not counted; an AC stimulus
 * buried in a macromodel rather than placed on the canvas would be refused here.
 */
export function hasAcExcitation(components: readonly SchematicComponent[]): boolean {
  return components.some(
    (component) =>
      component.kind === "vac" ||
      component.kind === "iac" ||
      ((component.kind === "vsource" || component.kind === "isource") && parseAcSpec(component.value) !== null),
  );
}

/** Shared by both solvers so the same missing stimulus is reported the same way. */
export const NO_AC_SOURCE_MESSAGE =
  "No AC source found. Add a vac or iac component, or an “AC 1” stimulus to a voltage or current source, to excite the circuit for AC analysis.";

// ---------------------------------------------------------------------------
// Complex number helpers
// ---------------------------------------------------------------------------

interface Complex {
  re: number;
  im: number;
}

function cadd(a: Complex, b: Complex): Complex {
  return { re: a.re + b.re, im: a.im + b.im };
}

function cmul(a: Complex, b: Complex): Complex {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

function cdiv(a: Complex, b: Complex): Complex {
  const denom = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / denom, im: (a.im * b.re - a.re * b.im) / denom };
}

function cabs(a: Complex): number {
  return Math.sqrt(a.re * a.re + a.im * a.im);
}

/** Magnitude in dB with a floor at -300 dB when |V| = 0. */
function magToDb(c: Complex): number {
  const mag = cabs(c);
  if (mag === 0) return -300;
  return 20 * Math.log10(mag);
}

function phaseDeg(c: Complex): number {
  return Math.atan2(c.im, c.re) * (180 / Math.PI);
}

// ---------------------------------------------------------------------------
// Complex matrix helpers
// ---------------------------------------------------------------------------

type CMatrix = Complex[][];
type CVector = Complex[];

function zeroCMatrix(size: number): CMatrix {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ re: 0, im: 0 })),
  );
}

function zeroCVector(size: number): CVector {
  return Array.from({ length: size }, () => ({ re: 0, im: 0 }));
}

/** Stamp a complex admittance between two nodes (a, b = -1 means ground). */
function stampCAdmittance(matrix: CMatrix, a: number, b: number, y: Complex) {
  if (a >= 0) matrix[a][a] = cadd(matrix[a][a], y);
  if (b >= 0) matrix[b][b] = cadd(matrix[b][b], y);
  if (a >= 0 && b >= 0) {
    const neg: Complex = { re: -y.re, im: -y.im };
    matrix[a][b] = cadd(matrix[a][b], neg);
    matrix[b][a] = cadd(matrix[b][a], neg);
  }
}

/** Stamp a voltage source (complex) into the complex MNA matrix.
 *  sourceIndex is the column/row of the branch-current unknown. */
function stampCVoltageSource(
  matrix: CMatrix,
  rhs: CVector,
  positive: number,
  negative: number,
  sourceIndex: number,
  voltage: Complex,
) {
  const one: Complex = { re: 1, im: 0 };
  const negOne: Complex = { re: -1, im: 0 };
  if (positive >= 0) {
    matrix[positive][sourceIndex] = cadd(matrix[positive][sourceIndex], one);
    matrix[sourceIndex][positive] = cadd(matrix[sourceIndex][positive], one);
  }
  if (negative >= 0) {
    matrix[negative][sourceIndex] = cadd(matrix[negative][sourceIndex], negOne);
    matrix[sourceIndex][negative] = cadd(matrix[sourceIndex][negative], negOne);
  }
  rhs[sourceIndex] = cadd(rhs[sourceIndex], voltage);
}

/** Gaussian elimination with partial pivoting for complex systems.
 *  Throws a string if the matrix is singular. */
function solveCLinearSystem(matrix: CMatrix, rhs: CVector): CVector {
  const n = rhs.length;
  // Build augmented matrix [A | b] (rows of n+1 complex entries)
  const a: Complex[][] = matrix.map((row, i) => [...row, rhs[i]]);

  for (let col = 0; col < n; col += 1) {
    // Find pivot row (max |.|)
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (cabs(a[row][col]) > cabs(a[pivot][col])) pivot = row;
    }
    if (cabs(a[pivot][col]) < 1e-30) {
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
    for (let j = col; j <= n; j += 1) {
      a[col][j] = cdiv(a[col][j], pivotVal);
    }

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (factor.re === 0 && factor.im === 0) continue;
      for (let j = col; j <= n; j += 1) {
        const sub = cmul(factor, a[col][j]);
        a[row][j] = { re: a[row][j].re - sub.re, im: a[row][j].im - sub.im };
      }
    }
  }

  return a.map((row) => row[n]);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const GMIN = 1e-12;

const AC_SUPPORTED = new Set<ComponentKind>([
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
  "cccs",
  "ccvs",
  "bsource",
  "switch",
  "testpoint",
  "ground",
]);

/** Extract amplitude from a vac/iac value string.
 *  Parsing mirrors linearTransient.signalValue:
 *    1 token  → amplitude only (e.g. "1V")
 *    2 tokens → amplitude frequency (e.g. "1 1k")
 *    3 tokens → offset amplitude frequency (e.g. "0 1 1k") */
function acAmplitude(value: string, unit: "V" | "A"): number {
  const tokens = value.trim().split(/[\s,;@]+/).filter(Boolean);
  if (tokens.length === 0) throw new Error(`AC ${unit} source needs an amplitude.`);
  if (tokens.length === 1) return parseQuantity(tokens[0], unit);
  if (tokens.length === 2) return parseQuantity(tokens[0], unit);
  // 3+ tokens: [offset, amplitude, frequency]
  return parseQuantity(tokens[1], unit);
}

/** Complex AC phasor from a source value's `AC <mag> [phase]` spec.
 *  Returns 0+0j when the value has no AC stimulus (DC source → short/open). */
function acPhasor(value: string): { re: number; im: number } {
  const ac = parseAcSpec(value);
  if (!ac) return { re: 0, im: 0 };
  const rad = (ac.phase * Math.PI) / 180;
  return { re: ac.mag * Math.cos(rad), im: ac.mag * Math.sin(rad) };
}

function nodeIdx(net: string | undefined, index: Map<string, number>): number {
  if (!net || net === "0") return -1;
  return index.get(net) ?? -1;
}

/** Friendly node name - mirrors linearTransient.nodeName. */
function nodeName(net: { id: string; pins: { componentLabel: string }[] }): string {
  const labels = [...new Set(net.pins.map((p) => p.componentLabel).filter(Boolean))];
  return labels.length > 0 ? labels.slice(0, 2).join("·") : net.id;
}

function positiveValue(value: string, id: string, label: string, unit: string): number {
  const v = parseQuantity(value, unit);
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`${label || id} must have a positive ${unit} value.`);
  }
  return v;
}

function fail(message: string, circuit?: ExtractedCircuit): AcResult {
  return { ok: false, message, warnings: circuit?.warnings ?? [] };
}

// ---------------------------------------------------------------------------
// Frequency sweep generation
// ---------------------------------------------------------------------------

function logFrequencies(startHz: number, stopHz: number, pointsPerDecade: number): number[] {
  if (startHz <= 0 || stopHz <= startHz || pointsPerDecade < 1) {
    throw new Error("Invalid sweep options: require startHz > 0, stopHz > startHz, pointsPerDecade ≥ 1.");
  }
  const freqs: number[] = [];
  const logStart = Math.log10(startHz);
  const logStop = Math.log10(stopHz);
  const logStep = 1 / pointsPerDecade;
  // Iterate from logStart to logStop inclusive
  for (let lf = logStart; lf <= logStop + logStep * 0.5; lf += logStep) {
    const f = Math.pow(10, Math.min(lf, logStop));
    freqs.push(f);
    if (lf + logStep > logStop + logStep * 0.5) break;
  }
  // Always include stopHz exactly if not already included within 0.001% tolerance
  if (freqs.length === 0 || Math.abs(freqs[freqs.length - 1] / stopHz - 1) > 1e-5) {
    freqs.push(stopHz);
  }
  return freqs;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function runAcSweep(
  schematic: { components: SchematicComponent[]; wires: SchematicWire[]; netLabels?: NetLabel[]; params?: ParamScope; couplings?: CouplingSpec[] },
  options: AcOptions,
): AcResult {
  let circuit: ExtractedCircuit | undefined;
  try {
    const components = resolveComponentValues(schematic.components, schematic.params ?? EMPTY_SCOPE);
    circuit = extractCircuit(components, schematic.wires, schematic.netLabels ?? []);

    const currentSwitchMessage = previewCurrentControlledSwitchMessage(components);
    if (currentSwitchMessage) return fail(currentSwitchMessage, circuit);

    if (!circuit.groundNetId) {
      return fail("Add a ground symbol so node voltages have a reference.", circuit);
    }

    const unsupported = components.filter((component) => !AC_SUPPORTED.has(component.kind));
    if (unsupported.length > 0) {
      return fail(
        `${unsupported.map((component) => component.label || component.kind).join(", ")} ${unsupported.length === 1 ? "is" : "are"} placeable and wireable, but this preview solver's AC sweep supports only R/C/L, voltage/current sources, ideal op amps, switches, grounds, and test points. Full device models need the ngspice engine, which runs in the desktop app.`,
        circuit,
      );
    }

    if (!hasAcExcitation(components)) {
      return fail(NO_AC_SOURCE_MESSAGE, circuit);
    }

    const nonGroundNets = circuit.nets.filter((net) => !net.isGround);
    if (nonGroundNets.length === 0) {
      return fail("Connect at least one non-ground node.", circuit);
    }

    // Build index maps mirroring linearTransient exactly
    const nodeIndex = new Map(nonGroundNets.map((net, idx) => [net.id, idx]));

    // Voltage sources in AC analysis: vac sources are active, vsource = 0 V (short)
    const voltageSources = circuit.components.filter(
      ({ component }) => component.kind === "vsource" || component.kind === "vac",
    );
    // Inductors: add branch current unknown (like linearTransient)
    const inductors = circuit.components.filter(({ component }) => component.kind === "inductor");
    // Op-amps: add output branch current unknown
    const opamps = circuit.components.filter(({ component }) => component.kind === "opamp");
    // A switch's NC+/NC- control pair is optional; left unwired it forms
    // single-pin nets that are all-zero rows in the matrix. Same floating-node
    // case as an unconnected op-amp rail, so it takes the same gmin shunt.
    const hasSwitch = circuit.components.some(({ component }) => component.kind === "switch");
    const vcvss = circuit.components.filter(({ component }) => component.kind === "vcvs");
    const cccss = circuit.components.filter(({ component }) => component.kind === "cccs");
    const ccvss = circuit.components.filter(({ component }) => component.kind === "ccvs");
    // Behavioral sources: only the small-signal Σ coeff·V(node) coupling matters
    // at AC (the constant DC bias drops, like an independent source → 0).
    const paramScope = schematic.params ?? EMPTY_SCOPE;
    const bModels = new Map<string, LinearBehavioral>();
    for (const e of circuit.components) {
      if (e.component.kind !== "bsource") continue;
      bModels.set(e.component.id, linearBSourceModel(e.component.label, e.component.value, paramScope.scope, paramScope.funcs));
    }
    const vBsources = circuit.components.filter(({ component }) => component.kind === "bsource" && bModels.get(component.id)?.type === "V");
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
      nonGroundNets.length + voltageSources.length + inductors.length + opamps.length +
      vcvss.length + cccss.length + ccvss.length * 2 + vBsources.length;

    if (size === 0) return fail("The circuit has no unknowns to solve.", circuit);

    // Mutual inductance: K directives couple inductor branch currents. M is
    // constant in frequency, so compute the pairwise terms once (indices map
    // into the inductors array → branch unknown inductorOffset + index).
    const mutuals: MutualTerm[] =
      schematic.couplings && schematic.couplings.length > 0
        ? mutualTerms(
            inductors.map(({ component }) => ({
              label: component.label,
              inductance: positiveValue(component.value, component.id, component.label, "H"),
            })),
            schematic.couplings,
          )
        : [];

    const freqs = logFrequencies(options.startHz, options.stopHz, options.pointsPerDecade);

    // Per-net arrays of (magDb, phaseDeg) across frequencies
    const magDbArrays: number[][] = nonGroundNets.map(() => []);
    const phaseArrays: number[][] = nonGroundNets.map(() => []);

    for (const f of freqs) {
      const omega = 2 * Math.PI * f;

      const matrix = zeroCMatrix(size);
      const rhs = zeroCVector(size);

      // SPICE gmin when op-amps or switches present
      if (opamps.length > 0 || hasSwitch) {
        const gminC: Complex = { re: GMIN, im: 0 };
        for (let i = 0; i < nonGroundNets.length; i += 1) {
          matrix[i][i] = cadd(matrix[i][i], gminC);
        }
      }

      for (const entry of circuit.components) {
        const { component, pins } = entry;

        switch (component.kind) {
          case "resistor": {
            const R = positiveValue(component.value, component.id, component.label, "Ω");
            const G: Complex = { re: 1 / R, im: 0 };
            stampCAdmittance(
              matrix,
              nodeIdx(pins["a"], nodeIndex),
              nodeIdx(pins["b"], nodeIndex),
              G,
            );
            break;
          }

          case "capacitor": {
            // Admittance = jωC
            const C = positiveValue(component.value, component.id, component.label, "F");
            const Y: Complex = { re: 0, im: omega * C };
            stampCAdmittance(
              matrix,
              nodeIdx(pins["a"], nodeIndex),
              nodeIdx(pins["b"], nodeIndex),
              Y,
            );
            break;
          }

          case "inductor": {
            // Inductor treated as voltage source: V_L = jωL * I_L
            // Use the extra branch current unknown (same as linearTransient's inductor stamp
            // but with complex impedance on the diagonal)
            const L = positiveValue(component.value, component.id, component.label, "H");
            const iIdx =
              inductorOffset + inductors.findIndex((l) => l.component.id === component.id);
            const a = nodeIdx(pins["a"], nodeIndex);
            const b = nodeIdx(pins["b"], nodeIndex);
            // Stamp like a voltage source with V = jωL * I (diagonal = -jωL)
            const one: Complex = { re: 1, im: 0 };
            const negOne: Complex = { re: -1, im: 0 };
            const negJomegaL: Complex = { re: 0, im: -omega * L };
            if (a >= 0) {
              matrix[a][iIdx] = cadd(matrix[a][iIdx], one);
              matrix[iIdx][a] = cadd(matrix[iIdx][a], one);
            }
            if (b >= 0) {
              matrix[b][iIdx] = cadd(matrix[b][iIdx], negOne);
              matrix[iIdx][b] = cadd(matrix[iIdx][b], negOne);
            }
            matrix[iIdx][iIdx] = cadd(matrix[iIdx][iIdx], negJomegaL);
            // rhs[iIdx] = 0 (no DC component in AC analysis)
            break;
          }

          case "vsource": {
            // A plain DC voltage source is a short (0 V) at AC; but LTspice lets
            // any V source carry an `AC <mag> [phase]` stimulus (imported onto the
            // value via SYMATTR Value2). When present, drive it as that phasor.
            const sIdx =
              voltageSourceOffset +
              voltageSources.findIndex((v) => v.component.id === component.id);
            stampCVoltageSource(
              matrix, rhs,
              nodeIdx(pins["p"], nodeIndex),
              nodeIdx(pins["n"], nodeIndex),
              sIdx,
              acPhasor(component.value),
            );
            break;
          }

          case "vac": {
            // AC voltage source: amplitude∠0° = amplitude + j0
            const sIdx =
              voltageSourceOffset +
              voltageSources.findIndex((v) => v.component.id === component.id);
            const amplitude = acAmplitude(component.value, "V");
            stampCVoltageSource(
              matrix, rhs,
              nodeIdx(pins["p"], nodeIndex),
              nodeIdx(pins["n"], nodeIndex),
              sIdx,
              { re: amplitude, im: 0 },
            );
            break;
          }

          case "isource": {
            // DC current source → open (0 A) at AC, unless it carries an
            // `AC <mag> [phase]` stimulus (imported onto the value via Value2).
            const phasor = acPhasor(component.value);
            if (phasor.re !== 0 || phasor.im !== 0) {
              const p = nodeIdx(pins["p"], nodeIndex);
              const n = nodeIdx(pins["n"], nodeIndex);
              if (p >= 0) rhs[p] = { re: rhs[p].re + phasor.re, im: rhs[p].im + phasor.im };
              if (n >= 0) rhs[n] = { re: rhs[n].re - phasor.re, im: rhs[n].im - phasor.im };
            }
            break;
          }

          case "iac": {
            // AC current source: amplitude∠0° injected from n→p (p is positive terminal)
            const amplitude = acAmplitude(component.value, "A");
            const p = nodeIdx(pins["p"], nodeIndex);
            const n = nodeIdx(pins["n"], nodeIndex);
            // Current flows from n into p: KCL: p node gains current, n node loses current
            if (p >= 0) rhs[p] = { re: rhs[p].re + amplitude, im: rhs[p].im };
            if (n >= 0) rhs[n] = { re: rhs[n].re - amplitude, im: rhs[n].im };
            break;
          }

          case "opamp": {
            // Ideal op-amp (nullor): same stamp as linearTransient but complex
            const ioIdx =
              opampOffset + opamps.findIndex((op) => op.component.id === component.id);
            const outNode = nodeIdx(pins["out"], nodeIndex);
            const inPlusNode = nodeIdx(pins["in+"], nodeIndex);
            const inMinusNode = nodeIdx(pins["in-"], nodeIndex);
            const one: Complex = { re: 1, im: 0 };
            const negOne: Complex = { re: -1, im: 0 };
            if (outNode >= 0) matrix[outNode][ioIdx] = cadd(matrix[outNode][ioIdx], one);
            if (inPlusNode >= 0) matrix[ioIdx][inPlusNode] = cadd(matrix[ioIdx][inPlusNode], one);
            if (inMinusNode >= 0) matrix[ioIdx][inMinusNode] = cadd(matrix[ioIdx][inMinusNode], negOne);
            break;
          }

          case "vccs": {
            // VCCS (G): I(op→on) = gm·(V(cp) − V(cn)). Real transconductance.
            const gm = parseQuantity(component.value, "A/V");
            const op = nodeIdx(pins["op"], nodeIndex);
            const on = nodeIdx(pins["on"], nodeIndex);
            const cp = nodeIdx(pins["cp"], nodeIndex);
            const cn = nodeIdx(pins["cn"], nodeIndex);
            const g: Complex = { re: gm, im: 0 };
            const ng: Complex = { re: -gm, im: 0 };
            if (op >= 0 && cp >= 0) matrix[op][cp] = cadd(matrix[op][cp], g);
            if (op >= 0 && cn >= 0) matrix[op][cn] = cadd(matrix[op][cn], ng);
            if (on >= 0 && cp >= 0) matrix[on][cp] = cadd(matrix[on][cp], ng);
            if (on >= 0 && cn >= 0) matrix[on][cn] = cadd(matrix[on][cn], g);
            break;
          }

          case "vcvs": {
            // VCVS (E): V(op) − V(on) = gain·(V(cp) − V(cn)). Adds a branch unknown.
            const gain = parseQuantity(component.value, "V/V");
            const iIdx = vcvsOffset + vcvss.findIndex((e) => e.component.id === component.id);
            const op = nodeIdx(pins["op"], nodeIndex);
            const on = nodeIdx(pins["on"], nodeIndex);
            const cp = nodeIdx(pins["cp"], nodeIndex);
            const cn = nodeIdx(pins["cn"], nodeIndex);
            const one: Complex = { re: 1, im: 0 };
            const negOne: Complex = { re: -1, im: 0 };
            if (op >= 0) {
              matrix[op][iIdx] = cadd(matrix[op][iIdx], one);
              matrix[iIdx][op] = cadd(matrix[iIdx][op], one);
            }
            if (on >= 0) {
              matrix[on][iIdx] = cadd(matrix[on][iIdx], negOne);
              matrix[iIdx][on] = cadd(matrix[iIdx][on], negOne);
            }
            if (cp >= 0) matrix[iIdx][cp] = cadd(matrix[iIdx][cp], { re: -gain, im: 0 });
            if (cn >= 0) matrix[iIdx][cn] = cadd(matrix[iIdx][cn], { re: gain, im: 0 });
            break;
          }

          case "cccs": {
            // CCCS (F): I(op→on) = gain·I_sense(cp→cn). Real gain; one sense unknown.
            const gain = parseQuantity(component.value, "A/A");
            const senseIdx = cccsOffset + cccss.findIndex((f) => f.component.id === component.id);
            const op = nodeIdx(pins["op"], nodeIndex);
            const on = nodeIdx(pins["on"], nodeIndex);
            const cp = nodeIdx(pins["cp"], nodeIndex);
            const cn = nodeIdx(pins["cn"], nodeIndex);
            const one: Complex = { re: 1, im: 0 };
            const negOne: Complex = { re: -1, im: 0 };
            // Internal 0 V sense source across cp→cn.
            if (cp >= 0) {
              matrix[cp][senseIdx] = cadd(matrix[cp][senseIdx], one);
              matrix[senseIdx][cp] = cadd(matrix[senseIdx][cp], one);
            }
            if (cn >= 0) {
              matrix[cn][senseIdx] = cadd(matrix[cn][senseIdx], negOne);
              matrix[senseIdx][cn] = cadd(matrix[senseIdx][cn], negOne);
            }
            // Output current = gain·I_sense.
            if (op >= 0) matrix[op][senseIdx] = cadd(matrix[op][senseIdx], { re: gain, im: 0 });
            if (on >= 0) matrix[on][senseIdx] = cadd(matrix[on][senseIdx], { re: -gain, im: 0 });
            break;
          }

          case "ccvs": {
            // CCVS (H): V(op) − V(on) = r·I_sense(cp→cn). Sense + output unknowns.
            const r = parseQuantity(component.value, "V/A");
            const hi = ccvss.findIndex((h) => h.component.id === component.id);
            const senseIdx = ccvsOffset + hi * 2;
            const outIdx = ccvsOffset + hi * 2 + 1;
            const op = nodeIdx(pins["op"], nodeIndex);
            const on = nodeIdx(pins["on"], nodeIndex);
            const cp = nodeIdx(pins["cp"], nodeIndex);
            const cn = nodeIdx(pins["cn"], nodeIndex);
            const one: Complex = { re: 1, im: 0 };
            const negOne: Complex = { re: -1, im: 0 };
            // Internal 0 V sense source across cp→cn.
            if (cp >= 0) {
              matrix[cp][senseIdx] = cadd(matrix[cp][senseIdx], one);
              matrix[senseIdx][cp] = cadd(matrix[senseIdx][cp], one);
            }
            if (cn >= 0) {
              matrix[cn][senseIdx] = cadd(matrix[cn][senseIdx], negOne);
              matrix[senseIdx][cn] = cadd(matrix[senseIdx][cn], negOne);
            }
            // Output branch couples into op (+) and on (−).
            if (op >= 0) {
              matrix[op][outIdx] = cadd(matrix[op][outIdx], one);
              matrix[outIdx][op] = cadd(matrix[outIdx][op], one);
            }
            if (on >= 0) {
              matrix[on][outIdx] = cadd(matrix[on][outIdx], negOne);
              matrix[outIdx][on] = cadd(matrix[outIdx][on], negOne);
            }
            // Constraint: V(op) − V(on) − r·I_sense = 0.
            matrix[outIdx][senseIdx] = cadd(matrix[outIdx][senseIdx], { re: -r, im: 0 });
            break;
          }

          case "bsource": {
            // Small-signal: V/I = Σ coeff·V(node); the constant bias drops at AC.
            const model = bModels.get(component.id)!;
            const p = nodeIdx(pins["p"], nodeIndex);
            const n = nodeIdx(pins["n"], nodeIndex);
            const terms = resolveBehavioralTerms(model, component.label, netByName);
            if (model.type === "V") {
              const iIdx = bsourceOffset + vBsources.findIndex((b) => b.component.id === component.id);
              const one: Complex = { re: 1, im: 0 };
              const negOne: Complex = { re: -1, im: 0 };
              if (p >= 0) {
                matrix[p][iIdx] = cadd(matrix[p][iIdx], one);
                matrix[iIdx][p] = cadd(matrix[iIdx][p], one);
              }
              if (n >= 0) {
                matrix[n][iIdx] = cadd(matrix[n][iIdx], negOne);
                matrix[iIdx][n] = cadd(matrix[iIdx][n], negOne);
              }
              // Constraint: V(p) − V(n) − Σ coeff·V(node) = 0.
              for (const { index, coeff } of terms) {
                if (index >= 0) matrix[iIdx][index] = cadd(matrix[iIdx][index], { re: -coeff, im: 0 });
              }
            } else {
              // I(p→n) = Σ coeff·V(node): a transconductance from each node.
              for (const { index, coeff } of terms) {
                if (index < 0) continue;
                if (p >= 0) matrix[p][index] = cadd(matrix[p][index], { re: coeff, im: 0 });
                if (n >= 0) matrix[n][index] = cadd(matrix[n][index], { re: -coeff, im: 0 });
              }
            }
            break;
          }

          case "switch":
            if (component.value.trim().toLowerCase().startsWith("closed")) {
              stampCAdmittance(
                matrix,
                nodeIdx(pins["a"], nodeIndex),
                nodeIdx(pins["b"], nodeIndex),
                { re: 1e9, im: 0 },
              );
            }
            break;

          case "testpoint":
          case "ground":
            break;
        }
      }

      // Mutual-inductance coupling: V_La = jωLa·Ia + jωM·Ib (and symmetric), so
      // each pair adds the cross term −jωM to both inductor branch rows.
      for (const term of mutuals) {
        const ia = inductorOffset + term.a;
        const ib = inductorOffset + term.b;
        const negJomegaM: Complex = { re: 0, im: -omega * term.m };
        matrix[ia][ib] = cadd(matrix[ia][ib], negJomegaM);
        matrix[ib][ia] = cadd(matrix[ib][ia], negJomegaM);
      }

      // Solve complex MNA at this frequency
      let solution: CVector;
      try {
        solution = solveCLinearSystem(matrix, rhs);
      } catch (err) {
        return fail(
          err instanceof Error ? err.message : "Singular matrix during AC sweep.",
          circuit,
        );
      }

      for (let i = 0; i < nonGroundNets.length; i += 1) {
        magDbArrays[i].push(magToDb(solution[i]));
        phaseArrays[i].push(phaseDeg(solution[i]));
      }
    }

    const traces: AcTrace[] = nonGroundNets.map((net, idx) => ({
      id: net.id,
      label: `V(${nodeName(net)})`,
      magDb: magDbArrays[idx],
      phaseDeg: phaseArrays[idx],
    }));

    return {
      ok: true,
      freqs,
      traces,
      warnings: circuit.warnings,
    };
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Unknown AC analysis error.",
      circuit,
    );
  }
}
