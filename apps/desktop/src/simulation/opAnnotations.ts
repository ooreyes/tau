/**
 * In-place schematic annotations (LTspice + EveryCircuit-style current mode):
 * after an `.op` or `.tran` run, the schematic shows each net's voltage and
 * each part's branch current. Numbers come only from the engine / derived RC
 * path — never faked.
 */
import { primaryBranches, type OperatingPointResult } from "./operatingPoint";
import type { ExtractedCircuit } from "../schematic/netlist";
import { formatEngineeringRange, formatSettledReading, type ValueRange } from "./quantity";
import type { SettledReading } from "./settlement";
import { deriveDcRcBranches } from "./currents";
import type { AnalysisResult } from "./linearTransient";
import {
  nearestSampleIndex,
  tranComponentCurrents,
  tranComponentCurrentsSettled,
  tranNetVoltages,
  tranNetVoltagesSettled,
} from "./wireCurrentFlow";

export interface OpAnnotation {
  /** Stable render key (net id / component id). */
  key: string;
  x: number;
  y: number;
  text: string;
  kind: "voltage" | "current";
}

/** Topmost-then-leftmost of a net's points - a stable, visible anchor. */
function netAnchor(points: readonly { x: number; y: number }[]): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  for (const p of points) {
    if (!best || p.y < best.y || (p.y === best.y && p.x < best.x)) best = p;
  }
  return best;
}

/**
 * Readouts carry their quantity as a one-letter prefix. Colour alone was
 * carrying that meaning - cyan for a node voltage, green for a branch current -
 * which is invisible to anyone who has not been told the convention, and to
 * anyone who cannot separate the two hues. Two characters is the cheapest fix
 * that does not put more text over the drawing.
 */
const QUANTITY_PREFIX = { voltage: "V", current: "I" } as const;

const readingText = (
  value: number | ValueRange | SettledReading,
  unit: string,
  kind: OpAnnotation["kind"],
): string => {
  const body = typeof value === "object" && "amplitude" in value
    ? formatSettledReading(value, unit, 3)
    : formatEngineeringRange(value, unit, 3);
  return `${QUANTITY_PREFIX[kind]} ${body}`;
};

function voltageAnnotations(
  circuit: ExtractedCircuit,
  voltageByNet: ReadonlyMap<string, number | ValueRange | SettledReading>,
): OpAnnotation[] {
  const annotations: OpAnnotation[] = [];
  for (const [netId, voltage] of voltageByNet) {
    const extracted = circuit.nets.find((n) => n.id === netId);
    if (!extracted || extracted.isGround) continue;
    const anchor = netAnchor(extracted.points);
    if (!anchor) continue;
    annotations.push({
      key: `v:${netId}`,
      x: anchor.x,
      y: anchor.y,
      text: readingText(voltage, "V", "voltage"),
      kind: "voltage",
    });
  }
  return annotations;
}

function currentAnnotations(
  circuit: ExtractedCircuit,
  currents: ReadonlyMap<string, number | ValueRange | SettledReading>,
): OpAnnotation[] {
  const annotations: OpAnnotation[] = [];
  for (const [id, current] of currents) {
    const extracted = circuit.components.find((c) => c.component.id === id);
    if (!extracted) continue;
    const isNearZero = (c: number | ValueRange | SettledReading) => {
      if (typeof c === "number") return Math.abs(c) < 1e-15;
      if ("amplitude" in c) return Math.abs(c.offset) < 1e-15 && Math.abs(c.amplitude) < 1e-15;
      return Math.abs(c.min) < 1e-15 && Math.abs(c.max) < 1e-15;
    };
    // Skip empty R/C spam; still label sources/inductors that report 0 A.
    if (
      isNearZero(current)
      && (extracted.component.kind === "resistor"
        || extracted.component.kind === "bulb"
        || extracted.component.kind === "capacitor"
        || extracted.component.kind === "polarizedCapacitor")
    ) {
      continue;
    }
    annotations.push({
      key: `i:${id}`,
      x: extracted.component.x,
      y: extracted.component.y,
      text: readingText(current, "A", "current"),
      kind: "current",
    });
  }
  return annotations;
}

/**
 * Resolve an OP result against the schematic's extracted geometry into
 * positioned labels. Ground nets are skipped (always 0 V); nets or branch
 * components that no longer exist in the circuit are skipped, so a stale OP
 * result degrades to fewer labels instead of misplacing any.
 */
export function opAnnotations(
  op: OperatingPointResult | null,
  circuit: ExtractedCircuit | null,
): OpAnnotation[] {
  if (!op || !op.ok || !circuit) return [];

  const voltageByNet = new Map(op.nets.map((net) => [net.id, net.voltage]));
  const currents = new Map<string, number>();
  for (const branch of primaryBranches(op.branches)) {
    currents.set(branch.id, branch.current);
  }
  // Resistor currents from node voltages (EveryCircuit shows every branch).
  // Capacitors are 0 A at a converged DC point — omit rather than spam "0 A".
  for (const branch of deriveDcRcBranches(circuit.components, voltageByNet)) {
    if (currents.has(branch.id)) continue;
    if (circuit.components.find((c) => c.component.id === branch.id)?.component.kind !== "resistor") {
      continue;
    }
    currents.set(branch.id, branch.current);
  }

  return [
    ...voltageAnnotations(circuit, voltageByNet),
    ...currentAnnotations(circuit, currents),
  ];
}

/**
 * Static settlement readout from a successful `.tran`: the STEADY-STATE
 * voltage and branch current, not the whole-run extremes.
 *
 * With an explicit `timeSeconds` this still reports the instantaneous sample -
 * that path is driven by a scope cursor, where the reader is deliberately
 * asking "what is it at this instant".
 */
export function tranAnnotations(
  result: AnalysisResult | null,
  circuit: ExtractedCircuit | null,
  timeSeconds?: number | null,
): OpAnnotation[] {
  if (!result || !result.ok || !circuit || result.times.length === 0) return [];
  if (timeSeconds != null) {
    const sampleIndex = nearestSampleIndex(result.times, timeSeconds);
    const voltageByNet = tranNetVoltages(result, sampleIndex);
    const currents = tranComponentCurrents(result, sampleIndex);
    return [
      ...voltageAnnotations(circuit, voltageByNet),
      ...currentAnnotations(circuit, currents),
    ];
  }
  const voltageByNet = tranNetVoltagesSettled(result);
  const currents = tranComponentCurrentsSettled(result);
  return [
    ...voltageAnnotations(circuit, voltageByNet),
    ...currentAnnotations(circuit, currents),
  ];
}

