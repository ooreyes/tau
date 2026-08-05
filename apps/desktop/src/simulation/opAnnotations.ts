/**
 * In-place DC operating point annotations (LTspice + EveryCircuit-style
 * current mode): after an `.op` run, the schematic shows each net's voltage
 * and each part's branch current. Voltages from the OP net list; currents from
 * MNA source/inductor branches plus derived resistor currents — never faked.
 */
import { primaryBranches, type OperatingPointResult } from "./operatingPoint";
import type { ExtractedCircuit } from "../schematic/netlist";
import { formatEngineering } from "./quantity";
import { deriveDcRcBranches } from "./currents";

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

  const seenCurrentIds = new Set<string>();
  // One label per part. A multi-terminal device contributes a branch per
  // terminal under one component id — only the untagged primary belongs here.
  for (const branch of primaryBranches(op.branches)) {
    const extracted = circuit.components.find((c) => c.component.id === branch.id);
    if (!extracted) continue;
    seenCurrentIds.add(branch.id);
    annotations.push({
      key: `i:${branch.id}`,
      x: extracted.component.x,
      y: extracted.component.y,
      text: formatEngineering(branch.current, "A", 3),
      kind: "current",
    });
  }

  // Resistor currents from node voltages (EveryCircuit shows every branch).
  // Capacitors are 0 A at a converged DC point — omit rather than spam "0 A".
  const voltageByNet = new Map(op.nets.map((net) => [net.id, net.voltage]));
  for (const branch of deriveDcRcBranches(circuit.components, voltageByNet)) {
    if (seenCurrentIds.has(branch.id)) continue;
    if (Math.abs(branch.current) < 1e-15) continue;
    const extracted = circuit.components.find((c) => c.component.id === branch.id);
    if (!extracted) continue;
    if (extracted.component.kind !== "resistor") continue;
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
