/**
 * Steady-state reading for a transient waveform.
 *
 * The schematic readout used to report min/max across the WHOLE `.tran` trace,
 * starting at t=0. On any circuit with reactance that mixes the one-time
 * turn-on excursion into a number presented as the settled operating value. A
 * 1 V / 1 kHz source into R 1k + C 1µ reads `-157 mV … 254 mV` that way, when
 * the capacitor node actually settles to a symmetric ±157 mV — the +254 mV
 * happens once, in the first cycle, while the cap charges from zero, and never
 * again. Reporting it as though the circuit oscillates between those two
 * numbers is simply wrong.
 *
 * So: measure the tail, and check it is actually a tail before trusting it.
 * A waveform is described as `offset ± amplitude` rather than `min … max`
 * because those are the two quantities an engineer reads off a scope, and
 * because it degenerates cleanly - a DC node is offset with no amplitude, a
 * symmetric AC swing is amplitude with no offset.
 */

export interface SettledReading {
  /** Midpoint of the settled window: (max + min) / 2. */
  offset: number;
  /** Half peak-to-peak of the settled window: (max - min) / 2. */
  amplitude: number;
  /** Whether the tail actually stopped changing. False = still in transit, so
   *  the numbers are provisional and must be presented as such. */
  settled: boolean;
}

interface WindowStats {
  offset: number;
  amplitude: number;
}

/** Shortest run we will describe at all. Below this there is no tail to speak
 *  of, and a "settled" claim would be noise. */
const MIN_SAMPLES = 8;

/** Fractional agreement required between the last two windows. 5% is loose
 *  enough that an exponential tail 3-4 time constants in reads as settled, and
 *  tight enough that a ramp or a growing oscillation does not. */
const SETTLE_TOLERANCE = 0.05;

/**
 * Length of one cycle in samples, or null when the tail is not periodic.
 *
 * Settlement is judged by comparing two windows, and that comparison is only
 * meaningful if both cover the same part of the cycle. Fixed fractions of the
 * run do not: a 1 kHz square wave simulated for two periods puts the high level
 * in one quarter and the low level in the next, so two windows of a genuinely
 * settled waveform disagree completely and it reads as "still settling".
 *
 * Detection is by autocorrelation, deliberately not by counting mean-crossings.
 * Crossings find the SHORTEST repeating feature, which is the wrong answer
 * whenever a fast component rides on a slow one: the current in a series RLC
 * driven by a 1 kHz square rings at ~50 kHz, so crossing-counting returns the
 * ringing period, aligns two windows inside different parts of the drive cycle,
 * and reports a settled circuit as unsettled. Autocorrelation locks onto the
 * fundamental instead.
 *
 * The signal is downsampled to a bounded working length first, which keeps this
 * O(1) in the sample count for a 20k-point run. Aliasing the fast ringing away
 * is harmless here - the fundamental is exactly what is being looked for.
 */
const CORRELATION_POINTS = 1024;
/** Normalised correlation a lag must reach to be believed a real period. */
const PERIOD_CONFIDENCE = 0.8;
/** Correlation must fall below this before a peak counts as a real cycle,
 *  rather than the tail of the trivial zero-lag lobe. */
const LOBE_EXIT = 0.3;

function dominantPeriodSamples(values: readonly number[], from: number, to: number): number | null {
  const span = to - from;
  if (span < 8) return null;

  const m = Math.min(span, CORRELATION_POINTS);
  const stride = span / m;
  const a = new Float64Array(m);
  let sum = 0;
  for (let j = 0; j < m; j += 1) {
    const v = values[from + Math.floor(j * stride)]!;
    a[j] = Number.isFinite(v) ? v : 0;
    sum += a[j]!;
  }
  const mean = sum / m;
  let energy = 0;
  for (let j = 0; j < m; j += 1) {
    a[j] = a[j]! - mean;
    energy += a[j]! * a[j]!;
  }
  if (energy <= 0) return null; // flat DC - no period, and none needed

  const maxLag = Math.floor(m / 2);
  const r = new Float64Array(maxLag + 1);
  for (let lag = 2; lag <= maxLag; lag += 1) {
    let dot = 0;
    let norm = 0;
    for (let j = 0; j + lag < m; j += 1) {
      dot += a[j]! * a[j + lag]!;
      norm += a[j]! * a[j]!;
    }
    r[lag] = norm > 0 ? dot / norm : 0;
  }

  // Skip the zero-lag lobe before looking for a peak. Any smooth waveform
  // correlates ~1.0 with itself shifted by one or two samples simply because
  // neighbouring samples are nearly equal, so a plain global maximum picks a
  // 2-sample "period". That collapsed the settled window to a sliver of one
  // cycle and reported a 157 mV sine as "-152 mV ±1.57 mV". Walk past the lobe
  // until correlation has decisively fallen, and only then take the best peak.
  let lag = 2;
  while (lag <= maxLag && r[lag]! > LOBE_EXIT) lag += 1;

  let bestLag = 0;
  let bestScore = 0;
  for (; lag <= maxLag; lag += 1) {
    if (r[lag]! > bestScore) {
      bestScore = r[lag]!;
      bestLag = lag;
    }
  }
  if (bestLag === 0 || bestScore < PERIOD_CONFIDENCE) return null;
  const period = Math.round(bestLag * stride);
  return period > 1 ? period : null;
}

function windowStats(values: readonly number[], from: number, to: number): WindowStats | null {
  let min = Infinity;
  let max = -Infinity;
  let seen = 0;
  for (let i = from; i < to; i += 1) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    seen += 1;
  }
  if (seen === 0) return null;
  return { offset: (max + min) / 2, amplitude: (max - min) / 2 };
}

/**
 * Describe the settled portion of `values`, or return null when there is not
 * enough of a waveform to describe.
 *
 * The last quarter is the reported window; the quarter before it is the
 * control. If the two agree on both offset and amplitude, the waveform has
 * stopped moving and the reading is marked settled. A still-charging RC, a
 * ramp, or a diverging oscillation fails that comparison and is returned with
 * `settled: false` so the caller can say so rather than quoting a number that
 * is still on its way somewhere.
 */
export function settledReading(values: readonly number[]): SettledReading | null {
  const n = values.length;
  if (n === 0) return null;
  // Too short to judge a tail, but dropping the readout entirely would leave a
  // blank where the user expects a number. Describe the whole run and mark it
  // unsettled - "here is what it did, and no, it has not stopped moving".
  if (n < MIN_SAMPLES) {
    const all = windowStats(values, 0, n);
    return all ? { ...all, settled: false } : null;
  }

  // Prefer whole cycles. Falling back to a fixed quarter is right for a
  // non-periodic waveform - an RC charging to a DC level, or a ramp - where
  // there is no cycle to align to.
  const period = dominantPeriodSamples(values, 0, n);
  const half = Math.floor(n / 2);
  // A run of exactly two periods is the common case (`.tran` stopped on a cycle
  // boundary), and it rounds to a period a sample or two longer than half the
  // trace. Demanding a strict `n >= 2 * period` rejected precisely those runs
  // and silently dropped back to misaligned quarter-windows, which is what made
  // a settled 1 kHz circuit report "~settling". Allow the slack, then clamp.
  const slack = Math.max(2, Math.round(half * 0.01));
  const span = period !== null && period <= half + slack
    ? Math.min(period, half)
    : Math.max(2, Math.floor(n / 4));

  const tail = windowStats(values, n - span, n);
  const control = windowStats(values, Math.max(0, n - 2 * span), n - span);
  if (!tail) return null;
  if (!control) return { ...tail, settled: false };

  // Compare against the signal's own size, so the tolerance means the same
  // thing for a 5 V rail and a 50 µV noise floor. The floor keeps a dead-flat
  // zero signal from dividing by nothing and reading as unsettled forever.
  const scale = Math.max(Math.abs(tail.amplitude), Math.abs(tail.offset), 1e-12);
  const settled =
    Math.abs(control.amplitude - tail.amplitude) <= SETTLE_TOLERANCE * scale
    && Math.abs(control.offset - tail.offset) <= SETTLE_TOLERANCE * scale;

  return { ...tail, settled };
}
