/**
 * EveryCircuit-like animated current-flow dots on schematic wires, driven only
 * by a real operating-point current map (engine MNA branches + derived R).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { SchematicWire } from "../schematic/types";
import type { ExtractedCircuit } from "../schematic/netlist";
import type { OperatingPointResult } from "../simulation/operatingPoint";
import {
  flowDotsForWires,
  opComponentCurrents,
  type FlowDot,
  type PinIndex,
} from "../simulation/wireCurrentFlow";

export function OpCurrentFlowLayer({
  op,
  circuit,
  wires,
  pinIndex,
  active,
}: {
  op: OperatingPointResult | null;
  circuit: ExtractedCircuit | null;
  wires: SchematicWire[];
  pinIndex: PinIndex;
  /** When false, clear dots (schematic edit mode / no OP). */
  active: boolean;
}) {
  const [dots, setDots] = useState<FlowDot[]>([]);
  const phase = useRef(new Map<string, number>());
  const raf = useRef<number | undefined>(undefined);
  const last = useRef(0);

  const currents = useMemo(() => {
    if (!active || !op?.ok || !circuit) return null;
    return opComponentCurrents(op, circuit);
  }, [active, op, circuit]);

  useEffect(() => {
    if (!currents || currents.size === 0) {
      setDots([]);
      phase.current = new Map();
      return;
    }
    const tick = (now: number) => {
      const dtMs = Math.min(64, now - (last.current || now));
      last.current = now;
      setDots(flowDotsForWires(wires, pinIndex, currents, phase.current, dtMs / 1000));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [currents, wires, pinIndex]);

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
