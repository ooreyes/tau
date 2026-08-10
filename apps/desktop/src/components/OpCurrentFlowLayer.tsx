/**
 * EveryCircuit-like animated current-flow dots on schematic wires, driven only
 * by a real current map (OP MNA + derived R, or a `.tran` sample).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Current flow is a decorative reading, not a sampled waveform. Rebuilding its
 * SVG paths/dots at a ProMotion display's 120 Hz spends twice the CPU and
 * battery for no useful extra information. Thirty visual updates a second
 * keeps the motion legible while bounding the expensive flow-field walk and
 * React reconciliation on large schematics.
 */
export const FLOW_UPDATE_INTERVAL_MS = 1000 / 30;

/** The elapsed, capped animation advance to render, or null until the next
 * visual frame is due. Exported so the cadence remains an explicit contract. */
export function flowUpdateDeltaSeconds(elapsedMs: number): number | null {
  if (elapsedMs < FLOW_UPDATE_INTERVAL_MS) return null;
  // A resumed tab must not make dots jump through an arbitrarily large path.
  return Math.min(64, elapsedMs) / 1000;
}

/** Live subscription to the OS reduced-motion preference. */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mq = window.matchMedia(REDUCED_MOTION_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.(REDUCED_MOTION_QUERY).matches),
    () => false,
  );
}
import type { SchematicWire } from "../schematic/types";
import {
  flowFieldForWires,
  peakAbsCurrent,
  type FlowField,
  type PinIndex,
  type TerminalCurrents,
} from "../simulation/wireCurrentFlow";

export function OpCurrentFlowLayer({
  currents,
  terminals,
  labelPoints,
  wires,
  pinIndex,
  active,
}: {
  /** Component-id → amps (a→b / MNA). Null/empty clears the layer. */
  currents: ReadonlyMap<string, number> | null;
  /** Per-terminal currents, so a transistor's base/emitter wires can animate. */
  terminals?: TerminalCurrents;
  /** Net-label anchors: boundaries where current leaves the drawn geometry. */
  labelPoints?: readonly { x: number; y: number }[];
  wires: SchematicWire[];
  pinIndex: PinIndex;
  /** When false, clear dots (no bias readout / empty current map). */
  active: boolean;
}) {
  const [field, setField] = useState<FlowField>({ dots: [], arrows: [] });
  const phase = useRef(new Map<string, number>());
  const raf = useRef<number | undefined>(undefined);
  const last = useRef<number | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const live = active && currents && currents.size > 0 ? currents : null;

  useEffect(() => {
    if (!live) {
      setField({ dots: [], arrows: [] });
      phase.current = new Map();
      return;
    }
    // Reduced motion: place the dots once and leave them. A CSS media query
    // cannot help here — the movement is a JS animation loop, so honouring the
    // preference means not scheduling it. Direction is still legible from the
    // arrowheads the dots are laid along; a still frame beats a moving one the
    // reader has asked not to see.
    if (reducedMotion) {
      setField(flowFieldForWires(
        wires, pinIndex, live, phase.current, 0, peakAbsCurrent(live),
        terminals, labelPoints,
      ));
      return;
    }
    // Make the reading available immediately; subsequent fields advance at a
    // bounded cadence below. This avoids turning a performance optimisation
    // into an extra frame of perceived latency when Current Mode is enabled.
    setField(flowFieldForWires(
      wires, pinIndex, live, phase.current, 0, peakAbsCurrent(live),
      terminals, labelPoints,
    ));
    last.current = null;
    const tick = (now: number) => {
      // requestAnimationFrame still schedules on the browser's paint cadence,
      // but only every ~33 ms needs the O(wires × segments) geometry work and
      // a React state update. That is a 50% reduction at 60 Hz and 75% on
      // 120 Hz displays, without changing the simulated values.
      if (last.current === null) {
        last.current = now;
      } else {
        const dtSeconds = flowUpdateDeltaSeconds(now - last.current);
        if (dtSeconds !== null) {
          last.current = now;
          setField(flowFieldForWires(
            wires, pinIndex, live, phase.current, dtSeconds, peakAbsCurrent(live),
            terminals, labelPoints,
          ));
        }
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [live, wires, pinIndex, terminals, labelPoints, reducedMotion]);

  if (field.dots.length === 0 && field.arrows.length === 0) return null;
  return (
    <g className="flow-layer" aria-hidden="true">
      {/* Direction markers first, so the moving dots read on top of them. */}
      {field.arrows.map((a, i) => (
        <path
          key={`arrow-${i}`}
          className="flow-arrow"
          d="M -3.4 -3 L 3.4 0 L -3.4 3 Z"
          transform={`translate(${a.x} ${a.y}) rotate(${a.angle})`}
          opacity={a.opacity * 0.55}
        />
      ))}
      {field.dots.map((d, i) => (
        <circle
          key={i}
          className="flow-dot"
          cx={d.x}
          cy={d.y}
          r={2.8}
          style={{ opacity: d.opacity }}
        />
      ))}
    </g>
  );
}
