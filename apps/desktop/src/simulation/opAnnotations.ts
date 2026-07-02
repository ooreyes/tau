/**
 * In-place DC operating point annotations (FEATURE_PARITY §6): after an `.op`
 * run, the schematic shows each net's voltage next to the net and each
 * V-source/inductor branch current next to its component — LTspice's ".op data
 * label" readout, but live on the canvas. Pure positioning/formatting logic so
 * it is fully unit-testable; the canvas just renders the returned labels.
 */
import type { OperatingPointResult } from "./operatingPoint";
import type { ExtractedCircuit } from "../schematic/netlist";
import { formatEngineering } from "./quantity";

export interface OpAnnotation {
  /** Stable render key (net id / component id). */
  key: string;
  x: number;
  y: number;
  text: string;
  kind: "voltage" | "current";
}

/** Topmost-then-leftmost of a net's points — a stable, visible anchor. */
function netAnchor(points: readonly { x: number; y: number }[]): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  for (const p of points) {
    if (!best || p.y < best.y || (p.y === best.y && p.x < best.x)) best = p;
  }
  return best;
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
  const annotations: OpAnnotation[] = [];

  for (const net of op.nets) {
    const extracted = circuit.nets.find((n) => n.id === net.id);
    if (!extracted || extracted.isGround) continue;
    const anchor = netAnchor(extracted.points);
    if (!anchor) continue;
    annotations.push({
      key: `v:${net.id}`,
      x: anchor.x,
      y: anchor.y,
      text: formatEngineering(net.voltage, "V", 3),
      kind: "voltage",
    });
  }

  for (const branch of op.branches ?? []) {
    const extracted = circuit.components.find((c) => c.component.id === branch.id);
    if (!extracted) continue;
    annotations.push({
      key: `i:${branch.id}`,
      x: extracted.component.x,
      y: extracted.component.y,
      text: formatEngineering(branch.current, "A", 3),
      kind: "current",
    });
  }

  return annotations;
}
