import type { NetLabel, Probe, SchematicWire } from "../schematic/types";
import { netAtPoint } from "../schematic/netlist";
import { currentProbeTraces } from "./currentProbe";
import type { AnalysisResult, Trace } from "./linearTransient";

/**
 * The simulator has one signal-selection authority: named nodes and probe
 * dots. Plots are consequences of those interests, never separately managed
 * objects. Probe colors win when a named node is also probed.
 */
export function visibleTransientTraces(
  result: Extract<AnalysisResult, { ok: true }>,
  probes: Probe[],
  wires: SchematicWire[],
  netLabels: NetLabel[],
): Trace[] {
  const visible = new Map<string, Trace>();

  for (const label of netLabels) {
    const net = netAtPoint(result.circuit.nets, wires, label);
    if (!net || net.isGround) continue;
    const trace = result.traces.find((candidate) => candidate.id === net.id);
    if (trace) visible.set(trace.id, trace);
  }

  for (const probe of probes) {
    if (probe.componentId) continue;
    const net = netAtPoint(result.circuit.nets, wires, probe);
    if (!net || net.isGround) continue;
    const trace = result.traces.find((candidate) => candidate.id === net.id);
    if (trace) visible.set(trace.id, { ...trace, color: probe.color });
  }

  for (const trace of currentProbeTraces(result, probes)) visible.set(trace.id, trace);
  return [...visible.values()];
}
