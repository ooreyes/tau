import type { AnalysisResult, Trace } from "./linearTransient";
import type { Probe } from "../schematic/types";
import { findCurrentTrace } from "./currents";

type SuccessResult = Extract<AnalysisResult, { ok: true }>;

/** A probe with `componentId` set is a clamp-meter current probe, not a net probe. */
export const isCurrentProbe = (probe: Probe): boolean => probe.componentId !== undefined;

/**
 * Resolve clamp-meter probes to plottable current traces: the probed component's
 * ref-des names its branch-current waveform `I(ref)` in `result.currents`.
 * Probes on deleted/unlabeled components (no matching ref) resolve to nothing.
 */
export function currentProbeTraces(result: SuccessResult, probes: Probe[]): Trace[] {
  const traces: Trace[] = [];
  for (const probe of probes) {
    if (!probe.componentId) continue;
    const extracted = result.circuit.components.find((c) => c.component.id === probe.componentId);
    const ref = extracted?.component.label;
    if (!ref) continue;
    // The part's own current, not one of its terminals - a clamp meter round a
    // transistor reads what `I(ref)` means everywhere else in Tau.
    const current = findCurrentTrace(result.currents, ref);
    if (!current) continue;
    const id = `I(${ref})`;
    if (traces.some((t) => t.id === id)) continue;
    traces.push({ id, label: current.label, unit: "A", color: probe.color, values: current.values });
  }
  return traces;
}
