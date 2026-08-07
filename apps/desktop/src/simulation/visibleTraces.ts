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

/**
 * Which probe owns which trace.
 *
 * A probe's colour is the single authority for how its signal is drawn: the
 * schematic dot and the plotted curve both read it. The plot's own colour
 * picker used to write to a separate local override, so choosing a colour
 * there recoloured the curve and left the probe dot on its old hue — the two
 * ends of the same measurement disagreeing. With this map the picker can write
 * back to the probe instead, and there is only one value to keep in step.
 */
export function probeTraceOwners(
  result: Extract<AnalysisResult, { ok: true }>,
  probes: Probe[],
  wires: SchematicWire[],
): Map<string, string> {
  const owners = new Map<string, string>();
  for (const probe of probes) {
    if (probe.componentId) {
      const extracted = result.circuit.components.find((c) => c.component.id === probe.componentId);
      const ref = extracted?.component.label;
      if (ref) owners.set(`I(${ref})`, probe.id);
      continue;
    }
    const net = netAtPoint(result.circuit.nets, wires, probe);
    if (!net || net.isGround) continue;
    owners.set(net.id, probe.id);
  }
  return owners;
}
