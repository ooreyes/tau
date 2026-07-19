/**
 * Build scope overlays from a parsed LTspice `.raw` reference (LTspice parity). For each Tau trace
 * whose name matches a reference variable, the reference is resampled onto Tau's
 * time grid (so it draws as one more `Trace`) and compared numerically, turning
 * "do the waveforms match?" into a per-signal pass/fail with an RMS error.
 */
import type { Trace } from "./linearTransient";
import type { RawData } from "../io/rawImport";
import { resampleOnto, compareWaveforms } from "./waveformCompare";

export interface ReferenceComparison {
  label: string;
  normalizedRms: number;
  maxAbsError: number;
  pass: boolean;
}

export interface ReferenceOverlay {
  /** Reference traces resampled onto the Tau time grid, ready to plot. */
  traces: Trace[];
  /** Per-matched-signal agreement metrics. */
  comparisons: ReferenceComparison[];
  /** Reference variable names that matched no Tau trace (diagnostics). */
  unmatched: string[];
}

export interface TauSignal {
  label: string;
  values: readonly number[];
}

/** Case/space-insensitive signal-name key so `V(out)` matches `v( out )`. */
const nameKey = (s: string): string => s.toLowerCase().replace(/\s+/g, "");

/**
 * Match reference variables (index 0 is the axis, skipped) to Tau traces by
 * name, resample each match onto `times`, and compare. `times` is Tau's
 * independent axis; the reference axis is `data.values[0]`.
 */
export function buildReferenceOverlay(
  data: RawData,
  times: readonly number[],
  tauSignals: readonly TauSignal[],
  colors: readonly string[],
): ReferenceOverlay {
  const refAxis = data.values[0] ?? [];
  const tauByName = new Map(tauSignals.map((s) => [nameKey(s.label), s]));

  const traces: Trace[] = [];
  const comparisons: ReferenceComparison[] = [];
  const unmatched: string[] = [];

  for (const variable of data.variables) {
    if (variable.index === 0) continue; // the axis itself
    const refValues = data.values[variable.index] ?? [];
    const match = tauByName.get(nameKey(variable.name));
    if (!match) {
      unmatched.push(variable.name);
      continue;
    }
    const resampled = resampleOnto(refAxis, refValues, times);
    traces.push({
      id: `ref:${variable.name}`,
      label: `${variable.name} (ref)`,
      unit: "V",
      color: colors[traces.length % colors.length] ?? "var(--muted)",
      values: resampled,
    });
    if (refAxis.length > 0 && times.length > 0) {
      try {
        const cmp = compareWaveforms(times, match.values, refAxis, refValues);
        comparisons.push({
          label: variable.name,
          normalizedRms: cmp.normalizedRms,
          maxAbsError: cmp.maxAbsError,
          pass: cmp.pass,
        });
      } catch {
        // Non-overlapping ranges: skip the metric but still show the overlay.
      }
    }
  }

  return { traces, comparisons, unmatched };
}
