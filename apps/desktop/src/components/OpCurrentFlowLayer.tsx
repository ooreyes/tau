/**
 * EveryCircuit-like animated current-flow dots on schematic wires, driven only
 * by a real current map (OP MNA + derived R, or a `.tran` sample).
 */
import { useEffect, useRef, useState } from "react";
import type { SchematicWire } from "../schematic/types";
import {
  flowDotsForWires,
  type FlowDot,
  type PinIndex,
} from "../simulation/wireCurrentFlow";

export function OpCurrentFlowLayer({
  currents,
  wires,
  pinIndex,
  active,
}: {
  /** Component-id → amps (a→b / MNA). Null/empty clears the layer. */
  currents: ReadonlyMap<string, number> | null;
  wires: SchematicWire[];
  pinIndex: PinIndex;
  /** When false, clear dots (schematic edit mode / no bias readout). */
  active: boolean;
}) {
  const [dots, setDots] = useState<FlowDot[]>([]);
  const phase = useRef(new Map<string, number>());
  const raf = useRef<number | undefined>(undefined);
  const last = useRef(0);

  const live = active && currents && currents.size > 0 ? currents : null;

  useEffect(() => {
    if (!live) {
      setDots([]);
      phase.current = new Map();
      return;
    }
    const tick = (now: number) => {
      const dtMs = Math.min(64, now - (last.current || now));
      last.current = now;
      setDots(flowDotsForWires(wires, pinIndex, live, phase.current, dtMs / 1000));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [live, wires, pinIndex]);

  if (dots.length === 0) return null;
  return (
    <g className="flow-layer" aria-hidden="true">
      {dots.map((d, i) => (
        <circle
          key={i}
          className="flow-dot"
          cx={d.x}
          cy={d.y}
          r={2.2}
          style={{ opacity: d.opacity }}
        />
      ))}
    </g>
  );
}
