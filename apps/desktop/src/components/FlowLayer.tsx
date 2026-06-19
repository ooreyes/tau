import { useEffect, useMemo, useRef, useState } from "react";
import type { Point, SchematicWire } from "../schematic/types";
import type { AnalysisResult } from "../simulation/linearTransient";
import { componentCurrents, peakCurrent } from "../simulation/currents";

type OkResult = Extract<AnalysisResult, { ok: true }>;
type PinIndex = Map<string, { componentId: string; pinId: string }[]>;

/** A straight conductor between a two-terminal part's pins (pin a -> pin b). */
export interface FlowLeg {
  id: string;
  a: Point;
  b: Point;
}

interface Dot {
  x: number;
  y: number;
  o: number;
}

const keyOf = (x: number, y: number) => `${x},${y}`;

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

/**
 * Current entering a wire at its first point (+ = travels points[0] -> last),
 * read from the adjacent R/C pin that carries the same series current.
 */
function wireFlow(wire: SchematicWire, pins: PinIndex, currents: Map<string, number>): number {
  const enteringFrom = (p: Point, towardEnd: boolean): number | null => {
    for (const pin of pins.get(keyOf(p.x, p.y)) ?? []) {
      const i = currents.get(pin.componentId);
      if (i === undefined) continue;
      const entering = pin.pinId === "a" ? -i : pin.pinId === "b" ? i : 0;
      return towardEnd ? entering : -entering;
    }
    return null;
  };
  const start = enteringFrom(wire.points[0], true);
  if (start !== null) return start;
  const end = enteringFrom(wire.points[wire.points.length - 1], false);
  return end ?? 0;
}

const MIN_MAG = 4e-3;
/** ms to sweep the whole transient window once (then it loops). Larger = slower. */
export const FLOW_PLAY_MS = 9000;

export function FlowLayer({
  wires,
  legs,
  pinIndex,
  result,
  playing,
}: {
  wires: SchematicWire[];
  legs: FlowLeg[];
  pinIndex: PinIndex;
  result: OkResult;
  playing: boolean;
}) {
  const [dots, setDots] = useState<Dot[]>([]);
  const phase = useRef<Map<string, number>>(new Map());
  const raf = useRef<number | undefined>(undefined);
  const last = useRef<number>(0);
  const playT = useRef<number>(0);

  const geom = useMemo(
    () => wires.map((w) => ({ wire: w, ...measure(w.points) })).filter((g) => g.total > 1),
    [wires],
  );
  const legGeom = useMemo(
    () => legs.map((l) => ({ ...l, total: Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y) })).filter((g) => g.total > 1),
    [legs],
  );
  const peak = useMemo(() => peakCurrent(result), [result]);

  useEffect(() => {
    if (!playing) {
      setDots([]);
      return;
    }
    const tEnd = result.times[result.times.length - 1] || 1;
    const playMs = FLOW_PLAY_MS; // sweep the whole transient once, then loop
    const norm = peak > 0 ? peak : 1;

    const emit = (next: Dot[], key: string, total: number, signed: number, dtMs: number, at: (t: number) => Point) => {
      const mag = Math.abs(signed) / norm;
      if (mag < MIN_MAG) return;
      const dir = signed >= 0 ? 1 : -1;
      const speed = 9 + mag * 60; // world units / second — gentle so flow is readable
      const advanced = (phase.current.get(key) ?? 0) + dir * speed * (dtMs / 1000);
      phase.current.set(key, advanced);
      const count = Math.min(16, Math.max(1, Math.round(total / 24)));
      const o = Math.min(1, 0.45 + mag * 0.85);
      for (let k = 0; k < count; k += 1) {
        const d = (((advanced + (k * total) / count) % total) + total) % total;
        next.push({ ...at(d), o });
      }
    };

    const tick = (now: number) => {
      const dtMs = Math.min(64, now - (last.current || now));
      last.current = now;
      playT.current = (playT.current + (dtMs / playMs) * tEnd) % tEnd;
      const idx = Math.round((playT.current / tEnd) * (result.times.length - 1));
      const currents = componentCurrents(result, Math.max(0, Math.min(result.times.length - 1, idx)));

      const next: Dot[] = [];
      for (const g of geom) {
        const signed = wireFlow(g.wire, pinIndex, currents);
        emit(next, `w${g.wire.id}`, g.total, signed, dtMs, (d) => posAt(g.wire.points, g.lengths, g.total, d));
      }
      for (const g of legGeom) {
        const signed = currents.get(g.id);
        if (signed === undefined) continue;
        emit(next, `l${g.id}`, g.total, signed, dtMs, (d) => {
          const t = d / g.total;
          return { x: g.a.x + (g.b.x - g.a.x) * t, y: g.a.y + (g.b.y - g.a.y) * t };
        });
      }
      setDots(next);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing, geom, legGeom, pinIndex, result, peak]);

  return (
    <g className="flow-layer" aria-hidden="true">
      {dots.map((d, i) => (
        <circle key={i} className="flow-dot" cx={d.x} cy={d.y} r={2.4} style={{ opacity: d.o }} />
      ))}
    </g>
  );
}
