/**
 * Small-signal noise analysis (`.noise`).
 *
 * LTspice/SPICE syntax:
 *
 *   .noise <output> <input-source> <oct|dec|lin> <N> <Fstart> <Fstop>
 *
 * where `<output>` is `V(node)` or `V(a,b)` and `<input-source>` is the name of
 * an independent source (used to refer the output noise back to the input).
 *
 * The solver builds the same complex MNA system as `acSweep.ts` at each
 * frequency, then uses the ADJOINT (transpose) method to obtain, in a single
 * extra solve per frequency, the transimpedance from every internal noise
 * source to the output port:
 *
 *   Let A be the MNA matrix. A current I injected into node k produces
 *   V(out) = (A⁻¹)[out][k]·I (superposition). Solving Aᵀ z = e_out gives
 *   z[k] = (A⁻¹)[out][k] for every k at once - exactly the transimpedance from
 *   node k to the output. For a noise current source between nodes (na, nb) the
 *   transimpedance is z[na] − z[nb].
 *
 * The only intrinsic noise generators in the linear element set are resistors,
 * whose thermal-noise current PSD is S_i = 4·k·T / R  [A²/Hz]. Each resistor's
 * contribution to the output voltage-noise PSD is |z[na] − z[nb]|²·S_i; summing
 * over resistors gives the total output noise PSD. The input-referred noise is
 * the output noise divided by the magnitude of the input→output gain (a normal
 * AC solve with the input source driven at 1).
 *
 * Self-contained: depends only on `extractCircuit`, `parseQuantity`, the param
 * scope, and types - no internals from the other solvers.
 */

import type { ComponentKind, NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";
import { isIndependentVoltageBranchKind } from "../schematic/kindGroups";
import { extractCircuit, type ExtractedCircuit } from "../schematic/netlist";
import { parseQuantity } from "./quantity";
import { resolveComponentValues, EMPTY_SCOPE, type ParamScope } from "./paramScope";
import { previewCurrentControlledSwitchMessage } from "../schematic/currentControlledSwitch";
import { previewChargeDefinedCapacitorMessage, previewNegativeCapacitorMessage } from "../schematic/behavioralCapacitor";
import { previewVendorOpampMessage } from "../engine/opampModel";

// ---------------------------------------------------------------------------
// Physical constants
// ---------------------------------------------------------------------------

/** Boltzmann constant, J/K. */
export const BOLTZMANN = 1.380649e-23;
/** Default analysis temperature (27 °C), matching ngspice/LTspice TNOM. */
export const NOISE_TEMP_KELVIN = 300.15;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface NoiseSweep {
  startHz: number;
  stopHz: number;
  pointsPerDecade: number;
}

export interface NoiseSpec {
  /** Output voltage port: V(pos) or V(pos,neg). */
  output: { pos: string; neg?: string };
  /** Independent-source label used as the input reference, matched case-insensitively. */
  source: string;
  sweep: NoiseSweep;
}

export type NoiseResult =
  | {
      ok: true;
      spec: NoiseSpec;
      freqs: number[];
      /** Output-referred noise spectral density, V/√Hz. */
      onoise: number[];
      /** Input-referred noise spectral density: V/√Hz (voltage input) or A/√Hz (current input). */
      inoise: number[];
      /** Unit string for inoise ("V/√Hz" or "A/√Hz"). */
      inoiseUnit: string;
      /** Integrated total output noise over the band, V (RMS). */
      totalOutputNoise: number;
      /** Integrated total input-referred noise over the band, V or A (RMS). */
      totalInputNoise: number;
      warnings: string[];
    }
  | { ok: false; message: string; warnings: string[] };

// ---------------------------------------------------------------------------
// Complex helpers
// ---------------------------------------------------------------------------

interface Complex {
  re: number;
  im: number;
}

const C0: Complex = { re: 0, im: 0 };

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
  return Math.hypot(a.re, a.im);
}

type CMatrix = Complex[][];
type CVector = Complex[];

function zeroCMatrix(size: number): CMatrix {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => ({ ...C0 })));
}

function zeroCVector(size: number): CVector {
  return Array.from({ length: size }, () => ({ ...C0 }));
}

function transpose(m: CMatrix): CMatrix {
  const n = m.length;
  const t = zeroCMatrix(n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      t[j][i] = { ...m[i][j] };
    }
  }
  return t;
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

/** Gaussian elimination with partial pivoting for complex systems. Throws on singular. */
function solveCLinearSystem(matrix: CMatrix, rhs: CVector): CVector {
  const n = rhs.length;
  const a: Complex[][] = matrix.map((row, i) => [...row.map((c) => ({ ...c })), { ...rhs[i] }]);

  for (let col = 0; col < n; col += 1) {
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
    for (let j = col; j <= n; j += 1) a[col][j] = cdiv(a[col][j], pivotVal);
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
// Directive parsing
// ---------------------------------------------------------------------------

const NOISE_SUPPORTED = new Set<ComponentKind>([
  "resistor",
  "capacitor",
  "polarizedCapacitor",
  "inductor",
  "vsource",
  "isource",
  "vac",
  "iac",
  "logicConstant",
  "opamp",
  "switch",
  "testpoint",
  "ground",
]);

const SOURCE_KINDS = new Set<ComponentKind>(["vsource", "isource", "vac", "iac", "logicConstant"]);

/**
 * Parse a `.noise` directive into a {@link NoiseSpec}. Accepts an optional
 * leading "." or "!". Returns `null` for anything that is not a usable request.
 *
 *   .noise V(out) V1 dec 10 1 100k
 *   .noise V(a,b) I1 oct 5 100 1meg
 */
export function parseNoiseDirective(line: string): NoiseSpec | null {
  const cleaned = line.trim().replace(/^[.!]/, "").trim();
  const m = cleaned.match(/^noise\b\s+(.*)$/is);
  if (!m) return null;
  const body = m[1].trim();

  // Output: V(...) group (may contain a comma), then the rest are tokens.
  const grouped = body.match(/^v\s*\(([^)]*)\)\s+(.*)$/is);
  if (!grouped) return null;
  const inner = grouped[1].trim();
  const rest = grouped[2].trim().split(/[\s,]+/).filter(Boolean);
  if (rest.length < 5) return null;

  const nodes = inner.split(",").map((s) => s.trim()).filter(Boolean);
  if (nodes.length === 0) return null;

  const source = rest[0];
  const sweepWord = rest[1].toLowerCase();
  if (sweepWord !== "dec" && sweepWord !== "oct" && sweepWord !== "lin") return null;

  const npoints = quantityOrNull(rest[2]);
  const startHz = quantityOrNull(rest[3]);
  const stopHz = quantityOrNull(rest[4]);
  if (npoints === null || startHz === null || stopHz === null) return null;
  if (!(npoints > 0) || !(startHz > 0) || !(stopHz > startHz)) return null;

  let pointsPerDecade: number;
  if (sweepWord === "lin") {
    const decades = Math.log10(stopHz / startHz);
    pointsPerDecade = decades > 0 ? npoints / decades : npoints;
  } else if (sweepWord === "oct") {
    pointsPerDecade = npoints * Math.log2(10);
  } else {
    pointsPerDecade = npoints;
  }
  pointsPerDecade = Math.max(1, Math.round(pointsPerDecade));

  return {
    output: { pos: nodes[0], neg: nodes[1] },
    source,
    sweep: { startHz, stopHz, pointsPerDecade },
  };
}

function quantityOrNull(token: string): number | null {
  try {
    const v = parseQuantity(token);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function logFrequencies(startHz: number, stopHz: number, pointsPerDecade: number): number[] {
  const freqs: number[] = [];
  const logStart = Math.log10(startHz);
  const logStop = Math.log10(stopHz);
  const logStep = 1 / pointsPerDecade;
  for (let lf = logStart; lf <= logStop + logStep * 0.5; lf += logStep) {
    freqs.push(Math.pow(10, Math.min(lf, logStop)));
    if (lf + logStep > logStop + logStep * 0.5) break;
  }
  if (freqs.length === 0 || Math.abs(freqs[freqs.length - 1] / stopHz - 1) > 1e-5) {
    freqs.push(stopHz);
  }
  return freqs;
}

function positiveValue(value: string, id: string, label: string, unit: string): number {
  const v = parseQuantity(value, unit);
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`${label || id} must have a positive ${unit} value.`);
  }
  return v;
}

function nodeIdx(net: string | undefined, index: Map<string, number>): number {
  if (!net || net === "0") return -1;
  return index.get(net) ?? -1;
}

function netIndexByName(
  name: string,
  nonGroundNets: { id: string }[],
  index: Map<string, number>,
): number | "ground" | null {
  const lower = name.toLowerCase();
  if (lower === "0" || lower === "gnd" || lower === "ground") return "ground";
  const net = nonGroundNets.find((n) => n.id.toLowerCase() === lower);
  if (!net) return null;
  return index.get(net.id) ?? null;
}

function fail(message: string, circuit?: ExtractedCircuit): NoiseResult {
  return { ok: false, message, warnings: circuit?.warnings ?? [] };
}

interface Schematic {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels?: NetLabel[];
  params?: ParamScope;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function runNoiseAnalysis(schematic: Schematic, spec: NoiseSpec): NoiseResult {
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

    if (!circuit.groundNetId) {
      return fail("Add a ground symbol so node voltages have a reference.", circuit);
    }

    const unsupported = components.filter((c) => !NOISE_SUPPORTED.has(c.kind));
    if (unsupported.length > 0) {
      return fail(
        `${unsupported.map((c) => c.label || c.kind).join(", ")} ${unsupported.length === 1 ? "is" : "are"} not supported by this noise solver, which currently handles R/C/L, sources, ideal op amps, switches, grounds, and test points (only resistors generate noise). Full device noise needs the native ngspice engine, which the desktop app runs.`,
        circuit,
      );
    }

    // Input source lookup.
    const input = components.find((c) => c.label.toLowerCase() === spec.source.toLowerCase());
    if (!input) {
      return fail(`.noise input source "${spec.source}" not found in the circuit.`, circuit);
    }
    if (!SOURCE_KINDS.has(input.kind)) {
      return fail(`.noise input "${spec.source}" is a ${input.kind}, not an independent source.`, circuit);
    }
    const inputIsVoltage = input.kind === "vsource" || input.kind === "vac";

    const nonGroundNets = circuit.nets.filter((net) => !net.isGround);
    if (nonGroundNets.length === 0) {
      return fail("Connect at least one non-ground node.", circuit);
    }
    const nodeIndex = new Map(nonGroundNets.map((net, idx) => [net.id, idx]));

    // Output port indices.
    const posIdx = netIndexByName(spec.output.pos, nonGroundNets, nodeIndex);
    if (posIdx === null) {
      return fail(`.noise output node "${spec.output.pos}" not found. Label the net (e.g. add a "${spec.output.pos}" net label).`, circuit);
    }
    let negIdx: number | "ground" = "ground";
    if (spec.output.neg !== undefined) {
      const ni = netIndexByName(spec.output.neg, nonGroundNets, nodeIndex);
      if (ni === null) return fail(`.noise output node "${spec.output.neg}" not found.`, circuit);
      negIdx = ni;
    }

    // Branch unknown bookkeeping (mirror acSweep: voltage sources, inductors, op-amps).
    const voltageSources = circuit.components.filter(
      ({ component }) => isIndependentVoltageBranchKind(component.kind),
    );
    const inductors = circuit.components.filter(({ component }) => component.kind === "inductor");
    const opamps = circuit.components.filter(({ component }) => component.kind === "opamp");
    // A switch's NC+/NC- control pair is optional; left unwired it forms
    // single-pin nets that are all-zero rows in the matrix. Same floating-node
    // case as an unconnected op-amp rail, so it takes the same gmin shunt.
    const hasSwitch = circuit.components.some(({ component }) => component.kind === "switch");
    const voltageSourceOffset = nonGroundNets.length;
    const inductorOffset = voltageSourceOffset + voltageSources.length;
    const opampOffset = inductorOffset + inductors.length;
    const size = nonGroundNets.length + voltageSources.length + inductors.length + opamps.length;
    if (size === 0) return fail("The circuit has no unknowns to solve.", circuit);

    const GMIN = 1e-12;

    // Resistors (the noise generators) - precompute their node index pairs + value.
    const resistors = circuit.components
      .filter(({ component }) => component.kind === "resistor")
      .map(({ component, pins }) => ({
        R: positiveValue(component.value, component.id, component.label, "Ω"),
        a: nodeIdx(pins["a"], nodeIndex),
        b: nodeIdx(pins["b"], nodeIndex),
      }));

    const freqs = logFrequencies(spec.sweep.startHz, spec.sweep.stopHz, spec.sweep.pointsPerDecade);
    const onoise: number[] = [];
    const inoise: number[] = [];

    const fourKT = 4 * BOLTZMANN * NOISE_TEMP_KELVIN;

    for (const f of freqs) {
      const omega = 2 * Math.PI * f;
      const matrix = zeroCMatrix(size);

      if (opamps.length > 0 || hasSwitch) {
        const gminC: Complex = { re: GMIN, im: 0 };
        for (let i = 0; i < nonGroundNets.length; i += 1) matrix[i][i] = cadd(matrix[i][i], gminC);
      }

      for (const entry of circuit.components) {
        const { component, pins } = entry;
        switch (component.kind) {
          case "resistor": {
            const R = positiveValue(component.value, component.id, component.label, "Ω");
            stampCAdmittance(matrix, nodeIdx(pins["a"], nodeIndex), nodeIdx(pins["b"], nodeIndex), { re: 1 / R, im: 0 });
            break;
          }
          case "polarizedCapacitor":
          case "capacitor": {
            const Cc = positiveValue(component.value, component.id, component.label, "F");
            stampCAdmittance(matrix, nodeIdx(pins["a"], nodeIndex), nodeIdx(pins["b"], nodeIndex), { re: 0, im: omega * Cc });
            break;
          }
          case "inductor": {
            const L = positiveValue(component.value, component.id, component.label, "H");
            const iIdx = inductorOffset + inductors.findIndex((l) => l.component.id === component.id);
            const a = nodeIdx(pins["a"], nodeIndex);
            const b = nodeIdx(pins["b"], nodeIndex);
            const one: Complex = { re: 1, im: 0 };
            const negOne: Complex = { re: -1, im: 0 };
            if (a >= 0) {
              matrix[a][iIdx] = cadd(matrix[a][iIdx], one);
              matrix[iIdx][a] = cadd(matrix[iIdx][a], one);
            }
            if (b >= 0) {
              matrix[b][iIdx] = cadd(matrix[b][iIdx], negOne);
              matrix[iIdx][b] = cadd(matrix[iIdx][b], negOne);
            }
            matrix[iIdx][iIdx] = cadd(matrix[iIdx][iIdx], { re: 0, im: -omega * L });
            break;
          }
          case "logicConstant":
          case "vsource":
          case "vac": {
            // Companion stamp only - source amplitude does not affect the system matrix.
            const sIdx = voltageSourceOffset + voltageSources.findIndex((v) => v.component.id === component.id);
            const one: Complex = { re: 1, im: 0 };
            const negOne: Complex = { re: -1, im: 0 };
            const p = nodeIdx(pins["p"], nodeIndex);
            const n = nodeIdx(pins["n"], nodeIndex);
            if (p >= 0) {
              matrix[p][sIdx] = cadd(matrix[p][sIdx], one);
              matrix[sIdx][p] = cadd(matrix[sIdx][p], one);
            }
            if (n >= 0) {
              matrix[n][sIdx] = cadd(matrix[n][sIdx], negOne);
              matrix[sIdx][n] = cadd(matrix[sIdx][n], negOne);
            }
            break;
          }
          case "isource":
          case "iac":
            // Current sources contribute nothing to the system matrix.
            break;
          case "opamp": {
            const ioIdx = opampOffset + opamps.findIndex((op) => op.component.id === component.id);
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
          case "switch":
            if (component.value.trim().toLowerCase().startsWith("closed")) {
              stampCAdmittance(matrix, nodeIdx(pins["a"], nodeIndex), nodeIdx(pins["b"], nodeIndex), { re: 1e9, im: 0 });
            }
            break;
          case "testpoint":
          case "ground":
            break;
        }
      }

      // --- Adjoint solve: transimpedance from every node to the output port ---
      const eOut = zeroCVector(size);
      if (posIdx !== "ground") eOut[posIdx] = { re: 1, im: 0 };
      if (negIdx !== "ground") eOut[negIdx] = cadd(eOut[negIdx], { re: -1, im: 0 });
      const z = solveCLinearSystem(transpose(matrix), eOut);
      const transAt = (idx: number): Complex => (idx >= 0 ? z[idx] : C0);

      let outPsd = 0; // V²/Hz
      for (const r of resistors) {
        const T = { re: transAt(r.a).re - transAt(r.b).re, im: transAt(r.a).im - transAt(r.b).im };
        const tmag2 = T.re * T.re + T.im * T.im;
        outPsd += tmag2 * (fourKT / r.R);
      }
      const onoiseDensity = Math.sqrt(outPsd);
      onoise.push(onoiseDensity);

      // --- Forward gain solve: input source driven at 1 ---
      const rhs = zeroCVector(size);
      if (inputIsVoltage) {
        const sIdx = voltageSourceOffset + voltageSources.findIndex((v) => v.component.id === input.id);
        if (sIdx >= voltageSourceOffset) rhs[sIdx] = { re: 1, im: 0 };
      } else {
        // Current input: inject 1 A from n into p.
        const entry = circuit.components.find((e) => e.component.id === input.id);
        const p = entry ? nodeIdx(entry.pins["p"], nodeIndex) : -1;
        const n = entry ? nodeIdx(entry.pins["n"], nodeIndex) : -1;
        if (p >= 0) rhs[p] = cadd(rhs[p], { re: 1, im: 0 });
        if (n >= 0) rhs[n] = cadd(rhs[n], { re: -1, im: 0 });
      }
      const x = solveCLinearSystem(matrix, rhs);
      const readPort = (idx: number | "ground"): Complex => (idx === "ground" ? C0 : x[idx]);
      const gainC = { re: readPort(posIdx).re - readPort(negIdx).re, im: readPort(posIdx).im - readPort(negIdx).im };
      const gainMag = cabs(gainC);
      inoise.push(gainMag > 0 ? onoiseDensity / gainMag : 0);
    }

    // Integrate PSD (density²) over frequency → mean-square → RMS.
    const totalOutputNoise = Math.sqrt(integrateSquared(freqs, onoise));
    const totalInputNoise = Math.sqrt(integrateSquared(freqs, inoise));

    const warnings = [...circuit.warnings];
    if (resistors.length === 0) {
      warnings.push("No resistors in the circuit - the linear noise solver reports zero noise.");
    }

    return {
      ok: true,
      spec,
      freqs,
      onoise,
      inoise,
      inoiseUnit: inputIsVoltage ? "V/√Hz" : "A/√Hz",
      totalOutputNoise,
      totalInputNoise,
      warnings,
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Unknown noise analysis error.", circuit);
  }
}

/** Trapezoidal integral of density² (the noise PSD) over the frequency axis. */
function integrateSquared(freqs: number[], density: number[]): number {
  let sum = 0;
  for (let i = 1; i < freqs.length; i += 1) {
    const df = freqs[i] - freqs[i - 1];
    const p0 = density[i - 1] * density[i - 1];
    const p1 = density[i] * density[i];
    sum += 0.5 * (p0 + p1) * df;
  }
  return sum;
}
