/**
 * Reverse-bias inspection for the polarized (electrolytic) capacitor.
 *
 * The netlist treats a polarized capacitor exactly like a plain one, and that
 * is deliberate: an ideal C is the right small-signal model either way, and
 * changing the deck would move every imported `.asc` result. What the netlist
 * cannot do is tell the user that the part is wired backwards. A real aluminium
 * electrolytic has an asymmetric dielectric; drive its marked terminal below
 * the other one and the oxide layer conducts, the part heats, and it eventually
 * vents. So the polarity check is a post-analysis inspection of the terminal
 * voltage the solver already produced, not a device model.
 *
 * This module is pure: it takes a time vector and the part's terminal voltage
 * and returns a finding. `measurementModel.ts` turns the finding into the
 * component advisory the telemetry dock renders.
 */

import { formatEngineering } from "./quantity";

/**
 * The sign convention, established from the three places that already agree on
 * it (all read-only for this unit):
 *
 * - `schematic/pins.ts` gives `polarizedCapacitor` the pins `a` (labelled "+",
 *   local x = -32) and `b` (labelled "−", local x = +32).
 * - `schematic/symbols.tsx` draws the "+" glyph next to the straight plate on
 *   the `a` side; the curved plate, which is the IEC negative electrode, is on
 *   the `b` side.
 * - `engine/spiceNetlist.ts` emits `C<name> <node(a)> <node(b)> <value>`, so
 *   `a` is also the SPICE positive node.
 *
 * The part is therefore reverse-biased exactly when `V(a) - V(b)` is negative.
 * Getting this backwards would flag every correctly wired electrolytic and
 * stay silent on the broken ones, so the caller asserts the pin pair it is
 * handing over rather than assuming the ordering.
 */
export const POLARIZED_CAPACITOR_POSITIVE_PIN = "a";
export const POLARIZED_CAPACITOR_NEGATIVE_PIN = "b";

/**
 * Numerical floor below which a negative terminal voltage is solver residue
 * rather than a reversal, modelled on ngspice's own convergence criterion
 * (`|Δv| <= reltol * |v| + vntol`, defaults reltol 1e-3 and vntol 1 µV).
 *
 * A purely absolute floor is not enough. Two nodes converged to 12 V each may
 * legitimately differ by ~12 mV of iteration residue, so a fixed 1 mV floor
 * would report a phantom reversal on any high-voltage rail. A purely relative
 * floor is not enough either, because a part sitting at 0 V has nothing to
 * scale against. The threshold is therefore the larger of the two, exactly as
 * SPICE combines them.
 *
 * This is deliberately a *numerical* floor and not a device rating. Datasheets
 * do allow aluminium electrolytics roughly 1 V of reverse voltage, but Tau
 * carries no per-part rating data, so quietly tolerating up to 1 V here would
 * be inventing a rating the way the LED advisory explicitly refuses to. We
 * report the measured fact once it is distinguishable from zero.
 */
const ABSOLUTE_NOISE_VOLTS = 1e-3;
const RELATIVE_NOISE = 1e-3;

/** The reverse-bias floor for one waveform, in volts (always positive). */
export function reverseBiasThresholdVolts(values: readonly number[]): number {
  let peakMagnitude = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    const magnitude = Math.abs(value);
    if (magnitude > peakMagnitude) peakMagnitude = magnitude;
  }
  return Math.max(ABSOLUTE_NOISE_VOLTS, RELATIVE_NOISE * peakMagnitude);
}

/**
 * Which fact about the reversal we can honestly claim from one transient run.
 *
 * - `sustained`: the part is still reverse-biased at the final sample. A
 *   transient run cannot prove a true steady state, so this is phrased as what
 *   was measured: the run ended with the part backwards.
 * - `settling`: one contiguous reversal that begins at the first sample and
 *   clears before the run ends. This is the mild case, an inrush or a supply
 *   ramp, and it is reported as such.
 * - `intermittent`: it reverses and clears, but not as a single leading
 *   interval. That covers both a mid-run reversal and an AC swing, neither of
 *   which is honestly describable as "only during startup".
 */
export type ReverseBiasPhase = "sustained" | "settling" | "intermittent";

export interface ReverseBiasFinding {
  phase: ReverseBiasPhase;
  /** Most negative terminal voltage reached, in volts. Always negative. */
  peakReverseVolts: number;
  /** Seconds spent below the threshold, with interpolated crossing times. */
  reverseSeconds: number;
  /** Length of the analysed window, in seconds. */
  windowSeconds: number;
  /** Count of separate reverse-biased intervals. */
  episodes: number;
  /** Threshold actually applied, in volts. */
  thresholdVolts: number;
}

interface Sample {
  time: number;
  value: number;
}

/**
 * Inspect the whole waveform, not just the final sample: a cap that is only
 * backwards while the supply ramps is a different fact from one that is
 * backwards for the entire run, and the final sample alone cannot tell them
 * apart. Returns `null` when the part is never reverse-biased beyond the
 * numerical floor.
 */
export function inspectReverseBias(
  times: readonly number[],
  values: readonly number[],
): ReverseBiasFinding | null {
  const count = Math.min(times.length, values.length);
  const samples: Sample[] = [];
  for (let i = 0; i < count; i++) {
    if (!Number.isFinite(times[i]) || !Number.isFinite(values[i])) continue;
    samples.push({ time: times[i], value: values[i] });
  }
  if (samples.length === 0) return null;

  const thresholdVolts = reverseBiasThresholdVolts(samples.map((sample) => sample.value));
  const isReverse = (sample: Sample): boolean => sample.value < -thresholdVolts;

  let peakReverseVolts = 0;
  for (const sample of samples) {
    if (isReverse(sample) && sample.value < peakReverseVolts) peakReverseVolts = sample.value;
  }
  if (peakReverseVolts === 0) return null;

  // Interpolate the threshold crossing inside each straddling segment so a
  // coarse time axis does not quantise the reported duration up to a whole
  // step. ngspice picks its own timestep, so segments are not uniform.
  const intervals: Array<readonly [number, number]> = [];
  let openStart: number | null = isReverse(samples[0]) ? samples[0].time : null;
  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1];
    const current = samples[i];
    const previousReverse = isReverse(previous);
    const currentReverse = isReverse(current);
    if (previousReverse === currentReverse) continue;
    const span = current.time - previous.time;
    const rise = current.value - previous.value;
    let crossing = previous.time;
    if (span > 0 && rise !== 0) {
      const fraction = Math.min(1, Math.max(0, (-thresholdVolts - previous.value) / rise));
      crossing = previous.time + fraction * span;
    } else if (span > 0) {
      crossing = current.time;
    }
    if (currentReverse) {
      openStart = crossing;
    } else {
      intervals.push([openStart ?? previous.time, crossing]);
      openStart = null;
    }
  }
  const endsReverse = openStart !== null;
  if (openStart !== null) intervals.push([openStart, samples[samples.length - 1].time]);

  let reverseSeconds = 0;
  for (const [start, end] of intervals) {
    if (end > start) reverseSeconds += end - start;
  }
  const windowSeconds = Math.max(0, samples[samples.length - 1].time - samples[0].time);

  const startsAtRunStart = intervals.length > 0 && intervals[0][0] <= samples[0].time;
  const phase: ReverseBiasPhase = endsReverse
    ? "sustained"
    : intervals.length === 1 && startsAtRunStart
      ? "settling"
      : "intermittent";

  return {
    phase,
    peakReverseVolts,
    reverseSeconds,
    windowSeconds,
    episodes: intervals.length,
    thresholdVolts,
  };
}

/**
 * The one physical consequence, repeated in every variant so the advisory
 * always says what goes wrong and not merely that something is off.
 */
const CONSEQUENCE = "An electrolytic conducts and degrades when its positive terminal is the lower one.";
const REMEDY = "Swap the part or the wiring so the terminal marked + sits at the higher potential.";

/**
 * Structurally a `ComponentAdvisory` from `measurementModel.ts`. It is spelled
 * out rather than imported so this module stays free of a cycle back into the
 * measurement model that consumes it.
 */
export interface ReverseBiasAdvisory {
  kind: "reverse-biased-electrolytic";
  severity: "warning";
  title: string;
  message: string;
}

/** Render a finding as the advisory text. Voice per DESIGN_SYSTEM.md §6. */
export function describeReverseBias(ref: string, finding: ReverseBiasFinding): ReverseBiasAdvisory {
  const peak = formatEngineering(finding.peakReverseVolts, "V", 3);
  if (finding.phase === "sustained") {
    return {
      kind: "reverse-biased-electrolytic",
      severity: "warning",
      title: "Reverse-biased electrolytic · sustained",
      message: `${ref}: reverse-biased to ${peak} and still reverse-biased when the run ends. ${CONSEQUENCE} ${REMEDY}`,
    };
  }
  if (finding.phase === "settling") {
    return {
      kind: "reverse-biased-electrolytic",
      severity: "warning",
      title: "Reverse-biased electrolytic · during settling",
      message: `${ref}: reverse-biased to ${peak} for the first ${formatEngineering(finding.reverseSeconds, "s", 3)} of the run, then recovers. ${CONSEQUENCE} A reversal only while the circuit settles is milder than a steady one, so confirm the startup path is intended.`,
    };
  }
  const episodes = finding.episodes > 1 ? `, over ${finding.episodes} separate intervals` : "";
  return {
    kind: "reverse-biased-electrolytic",
    severity: "warning",
    title: "Reverse-biased electrolytic · intermittent",
    message: `${ref}: reverse-biased to ${peak} for ${formatEngineering(finding.reverseSeconds, "s", 3)} of the ${formatEngineering(finding.windowSeconds, "s", 3)} run${episodes}. ${CONSEQUENCE} ${REMEDY}`,
  };
}

/**
 * Convenience for the measurement model: inspect and describe in one call.
 * `values` must be `V(a) - V(b)` for the part, per the sign convention above.
 */
export function reverseBiasAdvisory(
  ref: string,
  times: readonly number[],
  values: readonly number[],
): ReverseBiasAdvisory | null {
  const finding = inspectReverseBias(times, values);
  return finding ? describeReverseBias(ref, finding) : null;
}
