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

/** Current a component pushes INTO the wire at its pin, or null when the pin's
 *  share of the part's current is not knowable from the branch list alone.
 *
 *  Two-terminal parts are exact: `currents` holds the a→b (or p→n) branch
 *  current, so pin `a`/`p` drains the wire and `b`/`n` feeds it. A three-plus
 *  terminal part reports one primary current for the whole device, which says
 *  nothing about how it divides between collector, base and emitter — guessing
 *  there would draw confident arrows in the wrong direction. */
function pinInjection(
  pinId: string,
  componentCurrent: number,
): number | null {
  if (pinId === "a" || pinId === "p") return -componentCurrent;
  if (pinId === "b" || pinId === "n") return componentCurrent;
  return null;
}

export interface FlowSegment {
  /** Stable id: wire id plus the index of the split along it. */
  id: string;
  wireId: string;
  points: Point[];
}

/**
 * Split every wire at each point where something else attaches.
 *
 * A single drawn wire is not necessarily a single conductor as far as current
 * is concerned. A rail drawn from a source across to a load, with a second
 * branch tapped off part-way, carries the full current before the tap and less
 * after it — one polyline, two currents. Animating the whole polyline at one
 * speed is wrong on the busiest wire in most circuits, so the flow model works
 * in segments between attachment points rather than in whole wires.
 */
export function flowSegments(
  wires: readonly SchematicWire[],
  pins: PinIndex,
): FlowSegment[] {
  // A point is an attachment if a pin sits there, or if any wire begins or
  // ends there. Interior points that are merely corners are not.
  const nodes = new Set<string>(pins.keys());
  for (const w of wires) {
    if (w.points.length < 2) continue;
    nodes.add(keyOf(w.points[0]!.x, w.points[0]!.y));
    nodes.add(keyOf(w.points[w.points.length - 1]!.x, w.points[w.points.length - 1]!.y));
  }

  const out: FlowSegment[] = [];
  for (const w of wires) {
    if (w.points.length < 2) continue;
    let current: Point[] = [w.points[0]!];
    let part = 0;
    for (let i = 1; i < w.points.length; i += 1) {
      const p = w.points[i]!;
      current.push(p);
      const isLast = i === w.points.length - 1;
      if (!isLast && nodes.has(keyOf(p.x, p.y))) {
        out.push({ id: `${w.id}#${part}`, wireId: w.id, points: current });
        part += 1;
        current = [p];
      }
    }
    if (current.length >= 2) out.push({ id: `${w.id}#${part}`, wireId: w.id, points: current });
  }
  return out;
}

/**
 * Current in every flow segment, solved over the wire graph rather than read
 * off whichever pin happens to touch an end.
 *
 * The per-wire lookup this replaces only inspected a wire's first and last
 * point, so a segment running junction-to-junction — the middle piece of any
 * rail with something tapped off it — found no pin and reported zero. On screen
 * that is a dead gap in the middle of a wire run while the segments either side
 * animate normally, which reads as a broken visualizer rather than the missing
 * case it is.
 *
 * Treating a net's segments as a graph fixes it properly. Pins inject known
 * currents at points; on a tree, cutting any edge splits the net in two and the
 * current through that edge is exactly the net injection on one side. Real nets
 * are overwhelmingly trees — a loop of bare wire with no component in it is a
 * short, not a design — and a net containing a cycle, or any pin whose share is
 * unknowable, falls back to the endpoint heuristic rather than inventing a
 * number.
 */
export function segmentFlowCurrents(
  segments: readonly FlowSegment[],
  pins: PinIndex,
  currents: ReadonlyMap<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  const endsOf = (s: FlowSegment) => [
    keyOf(s.points[0]!.x, s.points[0]!.y),
    keyOf(s.points[s.points.length - 1]!.x, s.points[s.points.length - 1]!.y),
  ] as const;

  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let root = k;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    return root;
  };
  const add = (k: string) => { if (!parent.has(k)) parent.set(k, k); };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const s of segments) {
    const [a, b] = endsOf(s);
    add(a); add(b); union(a, b);
  }

  const injection = new Map<string, number>();
  const netUnknown = new Set<string>();
  for (const [point, list] of pins) {
    if (!parent.has(point)) continue; // pin sits on no segment end
    const root = find(point);
    for (const pin of list) {
      const i = currents.get(pin.componentId);
      if (i === undefined) continue;
      const inj = pinInjection(pin.pinId, i);
      if (inj === null) { netUnknown.add(root); continue; }
      injection.set(point, (injection.get(point) ?? 0) + inj);
    }
  }

  const adjacency = new Map<string, { seg: FlowSegment; a: string; b: string }[]>();
  const push = (k: string, e: { seg: FlowSegment; a: string; b: string }) => {
    const list = adjacency.get(k);
    if (list) list.push(e); else adjacency.set(k, [e]);
  };
  for (const s of segments) {
    const [a, b] = endsOf(s);
    const edge = { seg: s, a, b };
    push(a, edge);
    if (b !== a) push(b, edge);
  }

  const doneNets = new Set<string>();
  for (const s of segments) {
    const root = find(endsOf(s)[0]);
    if (doneNets.has(root)) continue;
    doneNets.add(root);

    const netNodes = [...parent.keys()].filter((k) => find(k) === root);
    const edgeCount = netNodes.reduce((n, k) => n + (adjacency.get(k)?.length ?? 0), 0) / 2;

    const start = endsOf(s)[0];
    const seen = new Set<string>([start]);
    const order: { seg: FlowSegment; from: string; to: string }[] = [];
    const usedEdge = new Set<string>();
    const stack = [start];
    let cyclic = false;
    while (stack.length > 0) {
      const node = stack.pop()!;
      for (const edge of adjacency.get(node) ?? []) {
        if (usedEdge.has(edge.seg.id)) continue;
        const other = edge.a === node ? edge.b : edge.a;
        if (other === node) { usedEdge.add(edge.seg.id); continue; }
        if (seen.has(other)) { cyclic = true; continue; }
        usedEdge.add(edge.seg.id);
        seen.add(other);
        order.push({ seg: edge.seg, from: node, to: other });
        stack.push(other);
      }
    }

    // A cycle, an unknowable pin, or an unreachable piece all mean the split is
    // not unique. Leave those to the fallback rather than guess.
    if (cyclic || netUnknown.has(root) || order.length !== edgeCount) continue;

    const subtree = new Map<string, number>();
    for (const node of seen) subtree.set(node, injection.get(node) ?? 0);
    for (let i = order.length - 1; i >= 0; i -= 1) {
      const { seg, from, to } = order[i]!;
      const below = subtree.get(to) ?? 0;
      subtree.set(from, (subtree.get(from) ?? 0) + below);
      // `below` flows child → parent; positive output means points[0] → last.
      out.set(seg.id, endsOf(seg)[0] === to ? below : -below);
    }
  }

  for (const s of segments) {
    if (!out.has(s.id)) {
      out.set(s.id, wireFlowCurrent({ id: s.id, points: s.points } as SchematicWire, pins, currents));
    }
  }
  return out;
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

/** |I|/peak below which a wire is treated as carrying no current at all. Set
 *  low enough to be a numerical-noise gate rather than a visibility policy —
 *  how *faint* a small current looks is decided by the log scale below. */
export const FLOW_MIN_MAG = 1e-9;
/** Decades of current compressed into the visible speed/opacity range. */
const FLOW_DECADES = 4;
/** Floor for the scaled magnitude, so the smallest shown current still moves. */
const FLOW_MIN_VISIBLE_MAG = 0.09;

/**
 * Place flow dots from real signed currents. `phaseByWire` holds per-segment
 * arc-distance phase (mutated) so the caller can animate.
 *
 * Works in flow segments rather than whole wires: a rail with a branch tapped
 * off it carries a different current before and after the tap, and animating
 * the whole polyline at one speed misrepresents the busiest wire in most
 * circuits.
 */export function flowDotsForWires(
  wires: readonly SchematicWire[],
  pins: PinIndex,
  currents: ReadonlyMap<string, number>,
  phaseByWire: Map<string, number>,
  dtSeconds: number,
  peak = peakAbsCurrent(currents),
): FlowDot[] {
  const norm = peak > 0 ? peak : 1;
  const segments = flowSegments(wires, pins);
  const solved = segmentFlowCurrents(segments, pins, currents);
  const dots: FlowDot[] = [];
  for (const segment of segments) {
    const { lengths, total } = measure(segment.points);
    if (total <= 1) continue;
    const signed = solved.get(segment.id) ?? 0;
    const ratio = Math.abs(signed) / norm;
    if (ratio < FLOW_MIN_MAG) continue;
    // Log scale, because branch currents span decades. A 100 F cap beside a 1k
    // resistor puts nine orders of magnitude between the two branches; on a
    // linear scale the resistor's wires sit at 1e-9 of peak and simply stop
    // animating, which reads as "this branch is broken" rather than "this
    // branch carries very little". Compressing four decades into the speed and
    // opacity range keeps a small current visibly slow instead of absent.
    const mag = Math.max(
      FLOW_MIN_VISIBLE_MAG,
      Math.min(1, 1 + Math.log10(ratio) / FLOW_DECADES),
    );
    const dir = signed >= 0 ? 1 : -1;
    const speed = 9 + mag * 60;
    const advanced = (phaseByWire.get(segment.id) ?? 0) + dir * speed * dtSeconds;
    phaseByWire.set(segment.id, advanced);
    const count = Math.min(16, Math.max(1, Math.round(total / 24)));
    const opacity = Math.min(1, 0.45 + mag * 0.85);
    for (let k = 0; k < count; k += 1) {
      const d = (((advanced + (k * total) / count) % total) + total) % total;
      dots.push({ ...posAt(segment.points, lengths, total, d), opacity });
    }
  }
  return dots;
}
