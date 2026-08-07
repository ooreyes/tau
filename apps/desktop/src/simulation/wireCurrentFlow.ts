/**
 * EveryCircuit-style current mode helpers: map real OP/transient branch
 * currents onto wires for animated flow dots. Numbers come only from the
 * engine / derived RC path — never invented.
 */
import type { Point, SchematicWire } from "../schematic/types";
import type { ExtractedCircuit } from "../schematic/netlist";
import { deriveDcRcBranches, findCurrentTrace } from "./currents";
import type { AnalysisResult } from "./linearTransient";
import { primaryBranches, type OperatingPointResult } from "./operatingPoint";

export type PinIndex = Map<string, { componentId: string; pinId: string }[]>;

const keyOf = (x: number, y: number) => `${x},${y}`;

/** DC component currents keyed by SchematicComponent id (a→b / + convention). */
export function opComponentCurrents(
  op: OperatingPointResult,
  circuit: ExtractedCircuit,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!op.ok) return out;
  for (const branch of primaryBranches(op.branches)) {
    out.set(branch.id, branch.current);
  }
  const voltageByNet = new Map(op.nets.map((net) => [net.id, net.voltage]));
  for (const branch of deriveDcRcBranches(circuit.components, voltageByNet)) {
    if (!out.has(branch.id)) out.set(branch.id, branch.current);
  }
  return out;
}

/** Index of the sample nearest to `timeSeconds` (clamped to the waveform). */
export function nearestSampleIndex(times: readonly number[], timeSeconds: number): number {
  if (times.length === 0) return 0;
  if (!(timeSeconds > times[0])) return 0;
  const last = times.length - 1;
  if (!(timeSeconds < times[last])) return last;
  let best = 0;
  let bestErr = Math.abs(times[0] - timeSeconds);
  for (let i = 1; i < times.length; i += 1) {
    const err = Math.abs(times[i] - timeSeconds);
    if (err < bestErr) {
      best = i;
      bestErr = err;
    }
  }
  return best;
}

/**
 * Instantaneous branch currents from a successful `.tran` result, keyed by
 * SchematicComponent id. Uses engine / derived `result.currents` only.
 */
export function tranComponentCurrents(
  result: Extract<AnalysisResult, { ok: true }>,
  sampleIndex: number,
): Map<string, number> {
  const out = new Map<string, number>();
  const i = Math.max(0, Math.min(sampleIndex, result.times.length - 1));
  for (const { component } of result.circuit.components) {
    if (!component.label) continue;
    const trace = findCurrentTrace(result.currents, component.label);
    if (!trace) continue;
    const amps = trace.values[i];
    if (!Number.isFinite(amps)) continue;
    out.set(component.id, amps);
  }
  return out;
}

/** Instantaneous net voltages from a successful `.tran` result (net id → V). */
export function tranNetVoltages(
  result: Extract<AnalysisResult, { ok: true }>,
  sampleIndex: number,
): Map<string, number> {
  const out = new Map<string, number>();
  const i = Math.max(0, Math.min(sampleIndex, result.times.length - 1));
  for (const trace of result.traces) {
    if (trace.unit !== "V") continue;
    const v = trace.values[i];
    if (!Number.isFinite(v)) continue;
    out.set(trace.id, v);
  }
  return out;
}

/**
 * Current entering a wire at its first point (+ = travels points[0] → last),
 * read from an adjacent two-terminal pin that carries the same series current.
 */
export function wireFlowCurrent(
  wire: SchematicWire,
  pins: PinIndex,
  currents: ReadonlyMap<string, number>,
): number {
  const enteringFrom = (p: Point, towardEnd: boolean): number | null => {
    for (const pin of pins.get(keyOf(p.x, p.y)) ?? []) {
      const i = currents.get(pin.componentId);
      if (i === undefined) continue;
      // R/C: a→b positive. Sources: p→n MNA branch (into +) is negative when
      // delivering; pin p therefore sees −i leaving into the wire when i < 0.
      const entering =
        pin.pinId === "a" || pin.pinId === "p" ? -i
        : pin.pinId === "b" || pin.pinId === "n" ? i
        : 0;
      return towardEnd ? entering : -entering;
    }
    return null;
  };
  if (wire.points.length < 2) return 0;
  const start = enteringFrom(wire.points[0], true);
  if (start !== null) return start;
  const end = enteringFrom(wire.points[wire.points.length - 1], false);
  return end ?? 0;
}

export function peakAbsCurrent(currents: ReadonlyMap<string, number>): number {
  let peak = 0;
  for (const v of currents.values()) {
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  return peak;
}

export interface FlowDot {
  x: number;
  y: number;
  opacity: number;
}

function measure(points: Point[]): { lengths: number[]; total: number } {
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  return { lengths, total: lengths[lengths.length - 1] };
}

function posAt(points: Point[], lengths: number[], total: number, distance: number): Point {
  if (total <= 0) return points[0];
  const d = ((distance % total) + total) % total;
  for (let i = 1; i < points.length; i += 1) {
    if (d <= lengths[i]) {
      const segLen = lengths[i] - lengths[i - 1] || 1;
      const t = (d - lengths[i - 1]) / segLen;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
      };
    }
  }
  return points[points.length - 1];
}

/** |I|/peak below which a wire is treated as carrying no visible current. */
export const FLOW_MIN_MAG = 4e-3;

/**
 * Place flow dots along wires from real signed currents. `phaseByWire` holds
 * per-wire arc-distance phase (mutated) so the caller can animate.
 */
export function flowDotsForWires(
  wires: readonly SchematicWire[],
  pins: PinIndex,
  currents: ReadonlyMap<string, number>,
  phaseByWire: Map<string, number>,
  dtSeconds: number,
  peak = peakAbsCurrent(currents),
): FlowDot[] {
  const norm = peak > 0 ? peak : 1;
  const dots: FlowDot[] = [];
  for (const wire of wires) {
    if (wire.points.length < 2) continue;
    const { lengths, total } = measure(wire.points);
    if (total <= 1) continue;
    const signed = wireFlowCurrent(wire, pins, currents);
    const mag = Math.abs(signed) / norm;
    if (mag < FLOW_MIN_MAG) continue;
    const dir = signed >= 0 ? 1 : -1;
    const speed = 9 + mag * 60;
    const advanced = (phaseByWire.get(wire.id) ?? 0) + dir * speed * dtSeconds;
    phaseByWire.set(wire.id, advanced);
    const count = Math.min(16, Math.max(1, Math.round(total / 24)));
    const opacity = Math.min(1, 0.45 + mag * 0.85);
    for (let k = 0; k < count; k += 1) {
      const d = (((advanced + (k * total) / count) % total) + total) % total;
      dots.push({ ...posAt(wire.points, lengths, total, d), opacity });
    }
  }
  return dots;
}
