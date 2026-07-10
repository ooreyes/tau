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

const keyOf = (x: number, y: number) => `${x},${y}`;

function measure(points: Point[]): { lengths: number[]; total: number } {
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  return { lengths, total: lengths[lengths.length - 1] };
}

/** Position AND unit tangent at arc-distance `d` along a polyline. */
function pointAndTangentAt(
  points: Point[],
  lengths: number[],
  total: number,
  distance: number,
): { x: number; y: number; tx: number; ty: number } {
  const d = Math.max(0, Math.min(total, distance));
  for (let i = 1; i < points.length; i += 1) {
    if (d <= lengths[i]) {
      const segLen = lengths[i] - lengths[i - 1] || 1;
      const t = (d - lengths[i - 1]) / segLen;
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      const len = Math.hypot(dx, dy) || 1;
      return {
        x: points[i - 1].x + dx * t,
        y: points[i - 1].y + dy * t,
        tx: dx / len,
        ty: dy / len,
      };
    }
  }
  const a = points[points.length - 2] ?? points[0];
  const b = points[points.length - 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: b.x, y: b.y, tx: (b.x - a.x) / len, ty: (b.y - a.y) / len };
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

/** |I|/peak below which a conductor reads as carrying no current. */
const MIN_MAG = 4e-3;
/** ms to sweep the whole transient window once (then it loops). Larger = slower. */
export const FLOW_PLAY_MS = 9000;
/** Visual state updates are throttled to this period — direction/strength may
 *  only change 10× a second, so oscillating sims read as steady arrows that
 *  flip occasionally instead of strobing dot streams. */
const UPDATE_MS = 100;
/** World-unit spacing between direction arrows along a conductor. */
const ARROW_SPACING = 44;

/**
 * "Current speed: N×" label text for the viz playhead: the fraction of real
 * simulated time shown per wall-clock second. Honest and compact — no
 * "1,000× vs real time" scare figures.
 */
export function flowSpeedLabel(tEndSeconds: number): string {
  if (tEndSeconds <= 0) return "";
  const f = tEndSeconds / (FLOW_PLAY_MS / 1000);
  const shown = f >= 0.95 ? "1" : f >= 0.01 ? f.toFixed(2).replace(/0$/, "") : f.toExponential(1);
  return `Current speed: ${shown}×`;
}

interface Arrow {
  x: number;
  y: number;
  angle: number; // degrees, direction of positive flow at this anchor
}

interface ConductorState {
  dir: 1 | -1;
  mag: number; // EMA-smoothed |I|/peak
  live: boolean; // above threshold this sample?
}

/**
 * Stable directional current arrows (§UX checklist 4). Fixed arrowheads along
 * every conducting wire/leg point in the instantaneous flow direction; opacity
 * and size encode relative magnitude. No travelling dots, no per-frame churn:
 * the sim playhead advances in real simulation time, and the rendered state is
 * throttled + hysteresis-smoothed so nothing strobes.
 */
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
  const [states, setStates] = useState<Map<string, ConductorState>>(new Map());
  const raf = useRef<number | undefined>(undefined);
  const last = useRef<number>(0);
  const lastEmit = useRef<number>(0);
  const playT = useRef<number>(0);
  const smoothed = useRef<Map<string, ConductorState>>(new Map());

  // Fixed arrow anchors (position + tangent) per conductor — geometry only,
  // computed once per schematic edit, never per animation frame.
  const anchors = useMemo(() => {
    const out = new Map<string, Arrow[]>();
    for (const w of wires) {
      const { lengths, total } = measure(w.points);
      if (total <= 1) continue;
      const count = Math.max(1, Math.floor(total / ARROW_SPACING));
      const arrows: Arrow[] = [];
      for (let k = 0; k < count; k += 1) {
        const d = (total * (k + 0.5)) / count;
        const p = pointAndTangentAt(w.points, lengths, total, d);
        arrows.push({ x: p.x, y: p.y, angle: (Math.atan2(p.ty, p.tx) * 180) / Math.PI });
      }
      out.set(`w${w.id}`, arrows);
    }
    for (const l of legs) {
      const total = Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);
      if (total <= 1) continue;
      const angle = (Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x) * 180) / Math.PI;
      out.set(`l${l.id}`, [{ x: (l.a.x + l.b.x) / 2, y: (l.a.y + l.b.y) / 2, angle }]);
    }
    return out;
  }, [wires, legs]);

  const peak = useMemo(() => peakCurrent(result), [result]);

  useEffect(() => {
    if (!playing) {
      setStates(new Map());
      smoothed.current = new Map();
      return;
    }
    const tEnd = result.times[result.times.length - 1] || 1;
    const norm = peak > 0 ? peak : 1;

    const fold = (key: string, signed: number, next: Map<string, ConductorState>) => {
      const prev = smoothed.current.get(key);
      const rawMag = Math.abs(signed) / norm;
      const live = rawMag >= MIN_MAG;
      // Hysteresis: below threshold the arrow keeps its last direction and
      // just fades — a current wobbling around zero can't flip-flop the glyphs.
      const dir: 1 | -1 = live ? (signed >= 0 ? 1 : -1) : (prev?.dir ?? 1);
      const mag = prev ? prev.mag + 0.5 * (rawMag - prev.mag) : rawMag; // EMA
      next.set(key, { dir, mag, live });
    };

    const tick = (now: number) => {
      const dtMs = Math.min(64, now - (last.current || now));
      last.current = now;
      // The playhead sweeps REAL simulation time (0 → tEnd), looping.
      playT.current = (playT.current + (dtMs / FLOW_PLAY_MS) * tEnd) % tEnd;

      if (now - lastEmit.current >= UPDATE_MS) {
        lastEmit.current = now;
        const idx = Math.round((playT.current / tEnd) * (result.times.length - 1));
        const currents = componentCurrents(result, Math.max(0, Math.min(result.times.length - 1, idx)));
        const next = new Map<string, ConductorState>();
        for (const w of wires) {
          if (!anchors.has(`w${w.id}`)) continue;
          fold(`w${w.id}`, wireFlow(w, pinIndex, currents), next);
        }
        for (const l of legs) {
          if (!anchors.has(`l${l.id}`)) continue;
          const signed = currents.get(l.id);
          if (signed !== undefined) fold(`l${l.id}`, signed, next);
        }
        smoothed.current = next;
        setStates(next);
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing, anchors, wires, legs, pinIndex, result, peak]);

  return (
    <g className="flow-layer" aria-hidden="true">
      {[...states].map(([key, s]) => {
        const glyphs = anchors.get(key);
        if (!glyphs || (!s.live && s.mag < MIN_MAG)) return null;
        const opacity = s.live ? Math.min(1, 0.4 + Math.sqrt(s.mag) * 0.6) : 0.15;
        const scale = 0.85 + Math.min(1, s.mag) * 0.5;
        return glyphs.map((a, i) => (
          <path
            key={`${key}:${i}`}
            className="flow-arrow"
            d="M 4.5 0 L -3 3.4 L -1.4 0 L -3 -3.4 Z"
            transform={`translate(${a.x} ${a.y}) rotate(${s.dir === 1 ? a.angle : a.angle + 180}) scale(${scale})`}
            style={{ opacity }}
          />
        ));
      })}
    </g>
  );
}
