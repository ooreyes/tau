import type { ComponentKind, SchematicComponent, SchematicWire } from "../schematic/types";
import { extractCircuit, type ExtractedCircuit, type ExtractedComponent } from "../schematic/netlist";
import { formatEngineering, parseQuantity } from "./quantity";

export interface AnalysisOptions {
  stopTime: number;
  steps: number;
}

/** The interim interactive solver needs enough samples to represent a sine
 * source faithfully. Native ngspice will eventually replace this ceiling. */
export const MIN_SAMPLES_PER_CYCLE = 32;
export const MAX_TRANSIENT_STEPS = 200_000;

export interface TransientResolution {
  maxFrequencyHz: number;
  requiredSteps: number;
  samplesPerCycle: number | null;
}

export interface Trace {
  id: string;
  label: string;
  unit: "V";
  color: string;
  values: number[];
}

export interface AnalysisStats {
  netCount: number;
  componentCount: number;
  sampleCount: number;
  stopTime: number;
  stepSize: number;
}

export type AnalysisResult =
  | {
      ok: true;
      title: string;
      times: number[];
      traces: Trace[];
      stats: AnalysisStats;
      warnings: string[];
      circuit: ExtractedCircuit;
    }
  | {
      ok: false;
      title: string;
      message: string;
      warnings: string[];
      circuit?: ExtractedCircuit;
    };

const TRACE_COLORS = [
  "var(--trace-cyan)",
  "var(--trace-green)",
  "var(--trace-cream)",
  "var(--trace-red)",
  "var(--trace-purple)",
  "var(--trace-amber)",
];

const TRANSIENT_SUPPORTED = new Set<ComponentKind>([
  "resistor",
  "capacitor",
  "inductor",
  "vsource",
  "isource",
  "vac",
  "iac",
  "opamp",
  "switch",
  "testpoint",
  "ground",
]);

/** Tiny conductance added from every non-ground node to ground (SPICE gmin trick).
 *  Prevents singular matrices caused by floating nodes (e.g. unconnected op-amp rails). */
const GMIN = 1e-12;

export function runTransientAnalysis(
  schematic: { components: SchematicComponent[]; wires: SchematicWire[] },
  options: AnalysisOptions,
): AnalysisResult {
  let circuit: ExtractedCircuit | undefined;
  try {
    circuit = extractCircuit(schematic.components, schematic.wires);
    validateOptions(options);

    const resolution = inspectTransientResolution(schematic.components, options);
    validateTransientResolution(resolution, options);

    if (schematic.components.length === 0) {
      return fail("No circuit", "Place components before running analysis.", circuit);
    }
    const unsupported = schematic.components.filter((component) => !TRANSIENT_SUPPORTED.has(component.kind));
    if (unsupported.length > 0) {
      return fail(
        "Unsupported model",
        `${unsupported.map((component) => component.label || component.kind).join(", ")} ${unsupported.length === 1 ? "is" : "are"} placeable and wireable, but the interim solver only supports R/C/L, voltage/current sources, AC sine sources, switches, grounds, and test points. Full models need the planned ngspice engine.`,
        circuit,
      );
    }
    if (!circuit.groundNetId) {
      return fail("No reference", "Add a ground symbol so node voltages have a reference.", circuit);
    }
    if (!schematic.components.some((component) => ["vsource", "isource", "vac", "iac"].includes(component.kind))) {
      return fail("No source", "Add a voltage or current source to excite the circuit. The interim solver requires an explicit independent source.", circuit);
    }

    const nonGroundNets = circuit.nets.filter((net) => !net.isGround);
    if (nonGroundNets.length === 0) {
      return fail("No signal nodes", "Connect at least one non-ground node.", circuit);
    }

    const nodeIndex = new Map(nonGroundNets.map((net, index) => [net.id, index]));
    const voltageSources = circuit.components.filter(({ component }) => component.kind === "vsource" || component.kind === "vac");
    const inductors = circuit.components.filter(({ component }) => component.kind === "inductor");
    const opamps = circuit.components.filter(({ component }) => component.kind === "opamp");
    const voltageSourceOffset = nonGroundNets.length;
    const inductorOffset = voltageSourceOffset + voltageSources.length;
    const opampOffset = inductorOffset + inductors.length;
    const size = nonGroundNets.length + voltageSources.length + inductors.length + opamps.length;
    if (size === 0) return fail("Empty matrix", "The circuit has no unknowns to solve.", circuit);

    const stepSize = options.stopTime / options.steps;
    const times: number[] = [];
    const traceValues = nonGroundNets.map(() => [] as number[]);
    const capacitorVoltage = new Map<string, number>();
    const inductorCurrent = new Map<string, number>();

    for (let step = 0; step <= options.steps; step += 1) {
      const time = step * stepSize;
      const matrix = zeroMatrix(size);
      const rhs = Array(size).fill(0) as number[];

      // SPICE gmin: when op-amps are present, add GMIN from every non-ground
      // node to ground so floating nodes (e.g. unconnected op-amp v+/v- rails)
      // resolve to ~0 V rather than making the matrix singular.
      // Applied only when op-amps are in the circuit to avoid masking genuine
      // floating-node errors in resistive/reactive-only circuits.
      if (opamps.length > 0) {
        for (let i = 0; i < nonGroundNets.length; i += 1) {
          matrix[i][i] += GMIN;
        }
      }

      for (const entry of circuit.components) {
        switch (entry.component.kind) {
          case "resistor":
            stampConductance(matrix, netIndex(entry.pins.a, nodeIndex), netIndex(entry.pins.b, nodeIndex), resistanceToConductance(entry));
            break;
          case "capacitor": {
            const capacitance = positiveValue(entry, "F");
            const conductance = capacitance / stepSize;
            const a = netIndex(entry.pins.a, nodeIndex);
            const b = netIndex(entry.pins.b, nodeIndex);
            const previousVoltage = capacitorVoltage.get(entry.component.id) ?? 0;
            stampConductance(matrix, a, b, conductance);
            stampCurrent(rhs, a, b, -conductance * previousVoltage);
            break;
          }
          case "vsource": {
            const sourceIndex = voltageSourceOffset + voltageSources.findIndex((source) => source.component.id === entry.component.id);
            stampVoltageSource(matrix, rhs, netIndex(entry.pins.p, nodeIndex), netIndex(entry.pins.n, nodeIndex), sourceIndex, parseQuantity(entry.component.value, "V"));
            break;
          }
          case "vac": {
            const sourceIndex = voltageSourceOffset + voltageSources.findIndex((source) => source.component.id === entry.component.id);
            stampVoltageSource(matrix, rhs, netIndex(entry.pins.p, nodeIndex), netIndex(entry.pins.n, nodeIndex), sourceIndex, signalValue(entry.component.value, "V", time));
            break;
          }
          case "isource":
            stampCurrent(rhs, netIndex(entry.pins.p, nodeIndex), netIndex(entry.pins.n, nodeIndex), parseQuantity(entry.component.value, "A"));
            break;
          case "iac":
            stampCurrent(rhs, netIndex(entry.pins.p, nodeIndex), netIndex(entry.pins.n, nodeIndex), signalValue(entry.component.value, "A", time));
            break;
          case "inductor": {
            const inductorIndex = inductorOffset + inductors.findIndex((source) => source.component.id === entry.component.id);
            const inductance = positiveValue(entry, "H");
            const resistance = inductance / stepSize;
            stampInductor(
              matrix,
              rhs,
              netIndex(entry.pins.a, nodeIndex),
              netIndex(entry.pins.b, nodeIndex),
              inductorIndex,
              resistance,
              inductorCurrent.get(entry.component.id) ?? 0,
            );
            break;
          }
          case "opamp": {
            // Ideal op-amp (nullor): adds one extra unknown io (output branch current).
            // The constraint row enforces V(in+) = V(in-) (virtual short).
            // Output current io is injected into the out net KCL row.
            // Input pins draw NO current. Power pins (v+/v-) are ignored (gmin handles them).
            const ioIndex = opampOffset + opamps.findIndex((op) => op.component.id === entry.component.id);
            const outNode = netIndex(entry.pins["out"], nodeIndex);
            const inPlusNode = netIndex(entry.pins["in+"], nodeIndex);
            const inMinusNode = netIndex(entry.pins["in-"], nodeIndex);
            // Output current injection into out KCL row
            if (outNode >= 0) matrix[outNode][ioIndex] += 1;
            // Virtual-short constraint row: V(in+) - V(in-) = 0
            if (inPlusNode >= 0) matrix[ioIndex][inPlusNode] += 1;
            if (inMinusNode >= 0) matrix[ioIndex][inMinusNode] -= 1;
            // rhs[ioIndex] = 0 (already zero from initialisation)
            break;
          }
          case "switch":
            if (entry.component.value.trim().toLowerCase().startsWith("closed")) {
              stampConductance(matrix, netIndex(entry.pins.a, nodeIndex), netIndex(entry.pins.b, nodeIndex), 1e9);
            }
            break;
          case "testpoint":
          case "ground":
            break;
        }
      }

      const solution = solveLinearSystem(matrix, rhs);
      times.push(time);
      for (let i = 0; i < nonGroundNets.length; i += 1) traceValues[i].push(solution[i]);

      for (const entry of circuit.components) {
        if (entry.component.kind === "capacitor") {
          capacitorVoltage.set(entry.component.id, voltageBetween(entry.pins.a, entry.pins.b, nodeIndex, solution));
        } else if (entry.component.kind === "inductor") {
          const currentIndex = inductorOffset + inductors.findIndex((source) => source.component.id === entry.component.id);
          inductorCurrent.set(entry.component.id, solution[currentIndex]);
        }
      }
    }

    return {
      ok: true,
      title: "Transient",
      times,
      traces: nonGroundNets.map((net, index) => ({
        id: net.id,
        label: `V(${nodeName(net)})`,
        unit: "V",
        color: TRACE_COLORS[index % TRACE_COLORS.length],
        values: traceValues[index],
      })),
      stats: {
        netCount: circuit.nets.length,
        componentCount: circuit.components.length,
        sampleCount: times.length,
        stopTime: options.stopTime,
        stepSize,
      },
      warnings: circuit.warnings,
      circuit,
    };
  } catch (error) {
    return fail("Analysis failed", error instanceof Error ? error.message : "Unknown analysis error.", circuit);
  }
}

/** A friendly node name derived from the parts it touches, e.g. "R1·C1" instead of "N001". */
function nodeName(net: { id: string; pins: { componentLabel: string }[] }): string {
  const labels = [...new Set(net.pins.map((p) => p.componentLabel).filter(Boolean))];
  return labels.length > 0 ? labels.slice(0, 2).join("·") : net.id;
}

function fail(title: string, message: string, circuit?: ExtractedCircuit): AnalysisResult {
  return {
    ok: false,
    title,
    message,
    warnings: circuit?.warnings ?? [],
    circuit,
  };
}

function validateOptions(options: AnalysisOptions) {
  if (!Number.isFinite(options.stopTime) || options.stopTime <= 0) {
    throw new Error("Stop time must be greater than zero.");
  }
  if (!Number.isInteger(options.steps) || options.steps < 8 || options.steps > MAX_TRANSIENT_STEPS) {
    throw new Error(`Steps must be an integer from 8 to ${MAX_TRANSIENT_STEPS.toLocaleString("en-US")}.`);
  }
}

/** Inspect the highest periodic source before running, so the UI can display a
 * meaningful samples-per-cycle figure and the solver can prevent aliasing. */
export function inspectTransientResolution(
  components: SchematicComponent[],
  options: AnalysisOptions,
): TransientResolution {
  let maxFrequencyHz = 0;
  for (const component of components) {
    if (component.kind !== "vac" && component.kind !== "iac") continue;
    const frequency = parseSineSource(component.value, component.kind === "vac" ? "V" : "A").frequency;
    if (!Number.isFinite(frequency) || frequency < 0) {
      throw new Error(`${component.label || component.id} needs a non-negative frequency.`);
    }
    maxFrequencyHz = Math.max(maxFrequencyHz, frequency);
  }
  const samplesPerCycle = maxFrequencyHz > 0 ? options.steps / (options.stopTime * maxFrequencyHz) : null;
  return {
    maxFrequencyHz,
    requiredSteps: maxFrequencyHz > 0 ? Math.ceil(options.stopTime * maxFrequencyHz * MIN_SAMPLES_PER_CYCLE) : 0,
    samplesPerCycle,
  };
}

function validateTransientResolution(resolution: TransientResolution, options: AnalysisOptions) {
  if (resolution.maxFrequencyHz <= 0) return;
  const frequency = formatEngineering(resolution.maxFrequencyHz, "Hz", 3);
  if (resolution.requiredSteps > MAX_TRANSIENT_STEPS) {
    const maxStopTime = MAX_TRANSIENT_STEPS / (resolution.maxFrequencyHz * MIN_SAMPLES_PER_CYCLE);
    throw new Error(
      `${frequency} across ${formatEngineering(options.stopTime, "s", 3)} needs ${formatStepCount(resolution.requiredSteps)} steps at ${MIN_SAMPLES_PER_CYCLE} samples/cycle. `
      + `The interactive solver is capped at ${formatStepCount(MAX_TRANSIENT_STEPS)}. Reduce STOP to ${formatEngineering(maxStopTime, "s", 3)} or less, or use AC analysis.`,
    );
  }
  if ((resolution.samplesPerCycle ?? Infinity) < MIN_SAMPLES_PER_CYCLE) {
    throw new Error(
      `Transient resolution is too low for ${frequency}: ${formatStepCount(options.steps)} steps gives ${formatSamplesPerCycle(resolution.samplesPerCycle)} samples/cycle. `
      + `Use at least ${formatStepCount(resolution.requiredSteps)} steps (${MIN_SAMPLES_PER_CYCLE} samples/cycle), reduce STOP, or use AC analysis.`,
    );
  }
}

const formatStepCount = (value: number) => value.toLocaleString("en-US");
const formatSamplesPerCycle = (value: number | null) => value === null ? "--" : Number(value.toPrecision(3)).toString();

function resistanceToConductance(entry: ExtractedComponent): number {
  return 1 / positiveValue(entry, "Ω");
}

function positiveValue(entry: ExtractedComponent, unit: string): number {
  const value = parseQuantity(entry.component.value, unit);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${entry.component.label || entry.component.id} must have a positive ${unit} value.`);
  }
  return value;
}

function signalValue(value: string, unit: "V" | "A", time: number): number {
  const source = parseSineSource(value, unit);
  return source.offset + source.amplitude * Math.sin(2 * Math.PI * source.frequency * time);
}

function parseSineSource(value: string, unit: "V" | "A") {
  const tokens = value.trim().split(/[\s,;@]+/).filter(Boolean);
  if (tokens.length === 0) throw new Error(`AC ${unit} source needs amplitude and frequency.`);
  if (tokens.length === 1) return { offset: 0, amplitude: parseQuantity(tokens[0], unit), frequency: 0 };

  const offset = tokens.length >= 3 ? parseQuantity(tokens[0], unit) : 0;
  const amplitude = parseQuantity(tokens.length >= 3 ? tokens[1] : tokens[0], unit);
  const frequency = parseQuantity(tokens.length >= 3 ? tokens[2] : tokens[1], "Hz");
  return { offset, amplitude, frequency };
}

function netIndex(net: string | undefined, nodeIndex: Map<string, number>): number {
  if (!net || net === "0") return -1;
  return nodeIndex.get(net) ?? -1;
}

function zeroMatrix(size: number): number[][] {
  return Array.from({ length: size }, () => Array(size).fill(0) as number[]);
}

function stampConductance(matrix: number[][], a: number, b: number, conductance: number) {
  if (a >= 0) matrix[a][a] += conductance;
  if (b >= 0) matrix[b][b] += conductance;
  if (a >= 0 && b >= 0) {
    matrix[a][b] -= conductance;
    matrix[b][a] -= conductance;
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

function stampInductor(
  matrix: number[][],
  rhs: number[],
  a: number,
  b: number,
  inductorIndex: number,
  resistance: number,
  previousCurrent: number,
) {
  if (a >= 0) {
    matrix[a][inductorIndex] += 1;
    matrix[inductorIndex][a] += 1;
  }
  if (b >= 0) {
    matrix[b][inductorIndex] -= 1;
    matrix[inductorIndex][b] -= 1;
  }
  matrix[inductorIndex][inductorIndex] -= resistance;
  rhs[inductorIndex] -= resistance * previousCurrent;
}

function voltageBetween(
  aNet: string | undefined,
  bNet: string | undefined,
  nodeIndex: Map<string, number>,
  solution: number[],
): number {
  const a = netIndex(aNet, nodeIndex);
  const b = netIndex(bNet, nodeIndex);
  return (a >= 0 ? solution[a] : 0) - (b >= 0 ? solution[b] : 0);
}

function solveLinearSystem(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) {
      throw new Error("Matrix is singular. Check for floating nodes, voltage-source loops, or missing ground connections.");
    }
    if (pivot !== col) [a[pivot], a[col]] = [a[col], a[pivot]];

    const pivotValue = a[col][col];
    for (let item = col; item <= n; item += 1) a[col][item] /= pivotValue;

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (factor === 0) continue;
      for (let item = col; item <= n; item += 1) a[row][item] -= factor * a[col][item];
    }
  }

  return a.map((row) => row[n]);
}
