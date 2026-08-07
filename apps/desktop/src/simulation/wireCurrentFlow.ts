/**
 * EveryCircuit-style current mode helpers: map real OP/transient branch
 * currents onto wires for animated flow dots. Numbers come only from the
 * engine / derived RC path — never invented.
 */
import type { ComponentKind, Point, SchematicWire } from "../schematic/types";
import type { ExtractedCircuit } from "../schematic/netlist";
import { deriveDcRcBranches, findCurrentTrace } from "./currents";
import type { AnalysisResult } from "./linearTransient";
import { primaryBranches, type OperatingPointResult } from "./operatingPoint";
import { terminalRole } from "./terminalRoles";

export type PinIndex = Map<
  string,
  { componentId: string; pinId: string; kind?: ComponentKind }[]
>;

/** Per-terminal currents: componentId -> terminal -> amps INTO that terminal.
 *  Both engines already report these for BJTs and MOSFETs; the flow model used
 *  to discard them one call before use. */
export type TerminalCurrents = ReadonlyMap<string, ReadonlyMap<string, number>>;

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

/** Terminal currents from a native `.op`, keyed component -> terminal -> amps
 *  into that terminal. Engines report these for BJTs and MOSFETs; without them
 *  a transistor's base and emitter wires cannot be animated at all. */
export function opTerminalCurrents(op: OperatingPointResult): TerminalCurrents {
  const out = new Map<string, Map<string, number>>();
  if (!op.ok) return out;
  for (const branch of op.branches ?? []) {
    if (!branch.terminal) continue;
    const per = out.get(branch.id) ?? new Map<string, number>();
    per.set(branch.terminal, branch.current);
    out.set(branch.id, per);
  }
  return out;
}

/** Terminal currents at one `.tran` sample, same shape as `opTerminalCurrents`. */
export function tranTerminalCurrents(
  result: Extract<AnalysisResult, { ok: true }>,
  sampleIndex: number,
): TerminalCurrents {
  const out = new Map<string, Map<string, number>>();
  const i = Math.max(0, Math.min(sampleIndex, result.times.length - 1));
  const byRef = new Map<string, string>();
  for (const { component } of result.circuit.components) {
    if (component.label) byRef.set(component.label.toLowerCase(), component.id);
  }
  for (const trace of result.currents) {
    if (!trace.terminal) continue;
    const id = byRef.get(trace.ref.toLowerCase());
    if (!id) continue;
    const amps = trace.values[i];
    if (!Number.isFinite(amps)) continue;
    const per = out.get(id) ?? new Map<string, number>();
    per.set(trace.terminal, amps as number);
    out.set(id, per);
  }
  return out;
}

/**
 * What a pin does to the wire it sits on.
 *
 * `amps` is the current flowing INTO the wire. `boundary` means the pin carries
 * current we cannot quantify — a ground symbol (where the net's current leaves),
 * an op-amp output, a multi-element expansion. A boundary is emphatically not
 * zero: treating ground as zero-injection is what made every wire running to a
 * ground symbol read 0 A, and made the answer depend on which direction the
 * user happened to draw the wire.
 */
type PinEffect =
  | { kind: "amps"; amps: number }
  | { kind: "boundary" }
  | { kind: "none" };

const NO_EFFECT: PinEffect = { kind: "none" };
const BOUNDARY: PinEffect = { kind: "boundary" };

function pinEffect(
  pin: { componentId: string; pinId: string; kind?: ComponentKind },
  currents: ReadonlyMap<string, number>,
  terminals: TerminalCurrents,
): PinEffect {
  // Without a kind we cannot resolve a role safely, and guessing from the pin
  // id alone is the original bug. Fall back to the two-terminal reading only
  // for ids that are unambiguous across every kind.
  if (!pin.kind) {
    const i = currents.get(pin.componentId);
    if (i === undefined) return BOUNDARY;
    if (pin.pinId === "p") return { kind: "amps", amps: -i };
    if (pin.pinId === "n") return { kind: "amps", amps: i };
    return BOUNDARY;
  }

  const role = terminalRole(pin.kind, pin.pinId);
  switch (role.role) {
    case "none":
      return NO_EFFECT;
    case "terminal": {
      const amps = terminals.get(pin.componentId)?.get(role.terminal);
      // The engine did not report this terminal (a preview run, or a device
      // whose vectors were not saved), or reported something non-finite after a
      // failed solve. Unknown, not zero - a NaN here would reach the renderer
      // as NaN dot coordinates and silently blank the layer.
      if (amps === undefined || !Number.isFinite(amps)) return BOUNDARY;
      // Reported current flows INTO the terminal, so the wire loses it.
      return { kind: "amps", amps: -amps };
    }
    case "series": {
      const i = currents.get(pin.componentId);
      if (i === undefined || !Number.isFinite(i)) return BOUNDARY;
      return { kind: "amps", amps: role.sign * i };
    }
    default:
      return BOUNDARY;
  }
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
export const KCL_TOLERANCE = 1e-6;

export function segmentFlowCurrents(
  segments: readonly FlowSegment[],
  pins: PinIndex,
  currents: ReadonlyMap<string, number>,
  terminals: TerminalCurrents = new Map(),
  /** Points where current leaves the drawn geometry without passing through a
   *  pin — net labels. A label ties this net to another somewhere else on the
   *  sheet, so it is a boundary in exactly the same sense as a ground symbol.
   *  Without this the solver sees an unbalanced net and refuses it. */
  labelPoints: readonly { x: number; y: number }[] = [],
): Map<string, number> {
  const out = new Map<string, number>();
  const endsOf = (s: FlowSegment) => [
    keyOf(s.points[0]!.x, s.points[0]!.y),
    keyOf(s.points[s.points.length - 1]!.x, s.points[s.points.length - 1]!.y),
  ] as const;

  // Path-compressed, union-by-rank. Without both, unioning a wire chain in
  // draw order degenerates into a linked list and `find` walks it — which made
  // this whole solve quadratic in the wire count, on a function that used to run
  // every animation frame.
  const parent = new Map<string, string>();
  const rank = new Map<string, number>();
  const find = (k: string): string => {
    let root = k;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    // Second pass points every node on the path straight at the root.
    let cur = k;
    while (cur !== root) {
      const next = parent.get(cur) ?? root;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const add = (k: string) => {
    if (!parent.has(k)) { parent.set(k, k); rank.set(k, 0); }
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    const da = rank.get(ra) ?? 0;
    const db = rank.get(rb) ?? 0;
    if (da < db) parent.set(ra, rb);
    else if (da > db) parent.set(rb, ra);
    else { parent.set(rb, ra); rank.set(ra, da + 1); }
  };

  for (const s of segments) {
    const [a, b] = endsOf(s);
    add(a); add(b); union(a, b);
  }

  // Injections, plus the nodes where current leaves through something we
  // cannot quantify. A boundary is a real terminal, not a zero.
  const injection = new Map<string, number>();
  const boundariesByNet = new Map<string, Set<string>>();
  for (const label of labelPoints) {
    const point = keyOf(label.x, label.y);
    if (!parent.has(point)) continue;
    const root = find(point);
    const set = boundariesByNet.get(root) ?? new Set<string>();
    set.add(point);
    boundariesByNet.set(root, set);
  }
  for (const [point, list] of pins) {
    if (!parent.has(point)) continue; // pin sits on no segment end
    const root = find(point);
    for (const pin of list) {
      const effect = pinEffect(pin, currents, terminals);
      if (effect.kind === "none") continue;
      if (effect.kind === "boundary") {
        const set = boundariesByNet.get(root) ?? new Set<string>();
        set.add(point);
        boundariesByNet.set(root, set);
        continue;
      }
      injection.set(point, (injection.get(point) ?? 0) + effect.amps);
    }
  }

  const adjacency = new Map<string, { seg: FlowSegment; a: string; b: string }[]>();
  const push = (k: string, e: { seg: FlowSegment; a: string; b: string }) => {
    const list = adjacency.get(k);
    if (list) list.push(e); else adjacency.set(k, [e]);
  };
  // Self-loop segments carry no meaningful current and used to break the
  // edge-count guard: they contributed 1 to the degree sum but 0 to the DFS
  // order, so `order.length !== edgeCount` rejected the whole net and left a
  // dead gap mid-rail. Drop them up front and count real edges directly.
  const realEdges: { seg: FlowSegment; a: string; b: string }[] = [];
  for (const s of segments) {
    const [a, b] = endsOf(s);
    if (a === b) continue;
    const edge = { seg: s, a, b };
    realEdges.push(edge);
    push(a, edge);
    push(b, edge);
  }
  const edgeCountByNet = new Map<string, number>();
  for (const e of realEdges) {
    const r = find(e.a);
    edgeCountByNet.set(r, (edgeCountByNet.get(r) ?? 0) + 1);
  }

  const nodesByRoot = new Map<string, string[]>();
  for (const k of parent.keys()) {
    const r = find(k);
    const list = nodesByRoot.get(r);
    if (list) list.push(k); else nodesByRoot.set(r, [k]);
  }

  const doneNets = new Set<string>();
  for (const s of segments) {
    const root = find(endsOf(s)[0]);
    if (doneNets.has(root)) continue;
    doneNets.add(root);

    const netNodes = nodesByRoot.get(root) ?? [];
    const boundaries = boundariesByNet.get(root) ?? new Set<string>();

    // Two or more unquantified terminals and the split is genuinely ambiguous.
    if (boundaries.size > 1) continue;

    // Root the walk AT the boundary when there is one. Everything below a tree
    // edge is then a subtree whose injections are all known, and the boundary's
    // own unknown current never enters any sum - which is exactly what makes a
    // wire to a ground symbol carry its true current instead of zero, and makes
    // the answer independent of which way the wire was drawn.
    const start = boundaries.size === 1
      ? [...boundaries][0]!
      : endsOf(s)[0];

    // With no boundary at all the net must balance on its own. A residual here
    // means a pin was mapped wrongly or an engine convention disagrees, and it
    // is far better to draw nothing than to animate a fabricated split. This
    // one gate catches every future (kind, pin) mistake as well as today's.
    if (boundaries.size === 0) {
      let sum = 0;
      let scale = 0;
      for (const node of netNodes) {
        const v = injection.get(node) ?? 0;
        sum += v;
        scale = Math.max(scale, Math.abs(v));
      }
      if (scale > 0 && Math.abs(sum) > KCL_TOLERANCE * scale) continue;
    }

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
        if (seen.has(other)) { cyclic = true; continue; }
        usedEdge.add(edge.seg.id);
        seen.add(other);
        order.push({ seg: edge.seg, from: node, to: other });
        stack.push(other);
      }
    }

    // A cycle or an unreachable piece means the split is not unique.
    if (cyclic || order.length !== (edgeCountByNet.get(root) ?? 0)) continue;

    const subtree = new Map<string, number>();
    for (const node of seen) subtree.set(node, injection.get(node) ?? 0);
    for (let i = order.length - 1; i >= 0; i -= 1) {
      const { seg, from, to } = order[i]!;
      const below = subtree.get(to) ?? 0;
      subtree.set(from, (subtree.get(from) ?? 0) + below);
      // `below` flows child → parent; positive output means points[0] → last.
      const signed = endsOf(seg)[0] === to ? below : -below;
      // `-below` yields -0 for a dead branch; normalise so callers comparing
      // against 0 behave, and so a readout never renders "-0 A".
      out.set(seg.id, signed === 0 ? 0 : signed);
    }
  }

  // Anything the solve declined draws nothing rather than a guess. The old
  // endpoint heuristic filled these in, but it produced contradictions -
  // adjacent segments of one series path disagreeing - and "unknown" rendered
  // identically to "zero amps".
  for (const s of segments) {
    if (!out.has(s.id)) out.set(s.id, 0);
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

/** A static direction marker at a segment's midpoint.
 *
 *  Dots alone encode direction only through motion, which fails three readers
 *  at once: anyone with `prefers-reduced-motion`, anyone looking at a paused
 *  frame or a screenshot, and anyone who simply cannot track a 2.8px dot. An
 *  arrowhead is readable standing still. */
export interface FlowArrow {
  x: number;
  y: number;
  /** Degrees, pointing the way conventional current flows. */
  angle: number;
  opacity: number;
}

export interface FlowField {
  dots: FlowDot[];
  arrows: FlowArrow[];
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

/** |I|/peak below which a wire is treated as carrying no current at all. */
export const FLOW_MIN_MAG = 1e-9;

/**
 * The magnitude scale is ABSOLUTE, not relative to the circuit's own peak.
 *
 * It used to divide by `peakAbsCurrent(currents)`, recomputed every frame. In a
 * single-branch circuit that is the branch's own current, so the ratio was
 * always exactly 1 and the animation ran at one fixed speed no matter what:
 * a 100 ohm loop and a 1 Mohm loop were pixel-identical across four decades of
 * current. For anyone using this to learn Ohm's law that is the worst possible
 * failure, so speed now means amps.
 *
 * 1 A saturates the scale; each decade below costs 1/FLOW_DECADES of the range,
 * so 1 µA lands at the floor and still creeps rather than freezing.
 */
const FLOW_REF_AMPS = 1;
const FLOW_DECADES = 6;
/** Absolute floor. Below a picoamp is solver noise, not a current. */
const FLOW_FLOOR_AMPS = 1e-12;
/** Floor for the scaled magnitude, so the smallest shown current still moves. */
const FLOW_MIN_VISIBLE_MAG = 0.09;

/** Speed/opacity weight for a current, on the absolute log scale. */
export function flowMagnitude(amps: number): number {
  const a = Math.abs(amps);
  if (!(a > FLOW_FLOOR_AMPS)) return 0;
  return Math.max(
    FLOW_MIN_VISIBLE_MAG,
    Math.min(1, 1 + Math.log10(a / FLOW_REF_AMPS) / FLOW_DECADES),
  );
}

/**
 * Place flow dots from real signed currents. `phaseByWire` holds per-segment
 * arc-distance phase (mutated) so the caller can animate.
 *
 * Works in flow segments rather than whole wires: a rail with a branch tapped
 * off it carries a different current before and after the tap, and animating
 * the whole polyline at one speed misrepresents the busiest wire in most
 * circuits.
 */export function flowFieldForWires(
  wires: readonly SchematicWire[],
  pins: PinIndex,
  currents: ReadonlyMap<string, number>,
  phaseByWire: Map<string, number>,
  dtSeconds: number,
  /** Retained for API compatibility; magnitude is now absolute, so the
   *  circuit's own peak no longer scales the animation. */
  _peak = peakAbsCurrent(currents),
  terminals: TerminalCurrents = new Map(),
  labelPoints: readonly { x: number; y: number }[] = [],
): FlowField {
  const segments = flowSegments(wires, pins);
  const solved = segmentFlowCurrents(segments, pins, currents, terminals, labelPoints);
  const dots: FlowDot[] = [];
  const arrows: FlowArrow[] = [];
  for (const segment of segments) {
    const { lengths, total } = measure(segment.points);
    if (total <= 1) continue;
    const signed = solved.get(segment.id) ?? 0;
    const mag = flowMagnitude(signed);
    if (mag <= 0) continue;
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

    // One arrowhead per segment, at the midpoint, tangent to the path there.
    const mid = total / 2;
    const ahead = posAt(segment.points, lengths, total, Math.min(total, mid + 1));
    const behind = posAt(segment.points, lengths, total, Math.max(0, mid - 1));
    const angle = Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * (180 / Math.PI);
    arrows.push({
      ...posAt(segment.points, lengths, total, mid),
      angle: dir >= 0 ? angle : angle + 180,
      opacity,
    });
  }
  return { dots, arrows };
}

/** Dots only — the original shape, kept so existing callers and tests that do
 *  not care about direction markers stay unchanged. */
export function flowDotsForWires(
  ...args: Parameters<typeof flowFieldForWires>
): FlowDot[] {
  return flowFieldForWires(...args).dots;
}
