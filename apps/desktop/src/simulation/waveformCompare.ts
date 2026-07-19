/**
 * Quantitative waveform comparison - the heart of the acceptance test
 * ("reproduce LTspice's waveforms exactly", LTspice parity KEY GOAL). Given a
 * Tau result series and a reference series (typically loaded from an LTspice
 * `.raw`, which is sampled at different time points), it resamples the reference
 * onto the test's time grid over the overlapping interval and reports error
 * metrics so agreement can be judged numerically instead of by eye.
 */

/** Linear interpolation of `values(times)` at `t`, clamped to the endpoints.
 *  `times` must be ascending. Exported for the `.raw` overlay resampler. */
export function interpolateAt(times: readonly number[], values: readonly number[], t: number): number {
  const last = times.length - 1;
  if (last < 0) return NaN;
  if (t <= times[0]) return values[0];
  if (t >= times[last]) return values[last];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  const span = times[hi] - times[lo];
  if (span === 0) return values[lo];
  return values[lo] + ((t - times[lo]) / span) * (values[hi] - values[lo]);
}

/**
 * Resample `(srcT, srcV)` onto the `targetT` time points by linear
 * interpolation. Points of `targetT` outside the source's time range are
 * clamped to the nearest source endpoint (matching {@link interpolateAt}).
 */
export function resampleOnto(
  srcT: readonly number[],
  srcV: readonly number[],
  targetT: readonly number[],
): number[] {
  return targetT.map((t) => interpolateAt(srcT, srcV, t));
}

export interface CompareMetrics {
  /** Number of test points inside the overlapping time range. */
  samples: number;
  /** Overlapping time interval [start, end] both series cover. */
  overlap: [number, number];
  /** Largest absolute difference test − reference over the overlap. */
  maxAbsError: number;
  /** Root-mean-square absolute difference over the overlap. */
  rmsError: number;
  /** Peak-to-peak amplitude of the reference over the overlap (for scaling). */
  referenceRange: number;
  /** `rmsError` as a fraction of `referenceRange` (0 when the ref is flat). */
  normalizedRms: number;
  /** Max abs error as a fraction of `referenceRange`. */
  normalizedMax: number;
}

export interface CompareOptions {
  /** Pass threshold on `normalizedRms` (default 0.05 = 5% of full scale). */
  rmsTolerance?: number;
  /** Pass threshold on `normalizedMax` (default 0.10 = 10% of full scale). */
  maxTolerance?: number;
}

export interface CompareResult extends CompareMetrics {
  /** True when both normalized metrics are within tolerance. */
  pass: boolean;
}

/**
 * Compare a test waveform against a reference. Both are `(time, value)` arrays
 * with ascending time; they need not share sample points. The reference is
 * interpolated onto each test time inside the overlapping interval. Returns
 * absolute and reference-normalized error metrics plus a pass/fail verdict.
 *
 * Throws if either series is empty or the time ranges do not overlap.
 */
export function compareWaveforms(
  testT: readonly number[],
  testV: readonly number[],
  refT: readonly number[],
  refV: readonly number[],
  options: CompareOptions = {},
): CompareResult {
  if (testT.length === 0 || refT.length === 0) {
    throw new Error("compareWaveforms: both series must be non-empty.");
  }
  const start = Math.max(testT[0], refT[0]);
  const end = Math.min(testT[testT.length - 1], refT[refT.length - 1]);
  if (end < start) throw new Error("compareWaveforms: time ranges do not overlap.");

  let sumSq = 0;
  let maxAbs = 0;
  let samples = 0;
  let refMin = Infinity;
  let refMax = -Infinity;
  for (let i = 0; i < testT.length; i += 1) {
    const t = testT[i];
    if (t < start || t > end) continue;
    const ref = interpolateAt(refT, refV, t);
    const diff = testV[i] - ref;
    sumSq += diff * diff;
    if (Math.abs(diff) > maxAbs) maxAbs = Math.abs(diff);
    if (ref < refMin) refMin = ref;
    if (ref > refMax) refMax = ref;
    samples += 1;
  }
  if (samples === 0) throw new Error("compareWaveforms: no test samples inside the overlap.");

  const rms = Math.sqrt(sumSq / samples);
  const referenceRange = refMax - refMin;
  const scale = referenceRange > 0 ? referenceRange : 1;
  const normalizedRms = rms / scale;
  const normalizedMax = maxAbs / scale;

  const rmsTolerance = options.rmsTolerance ?? 0.05;
  const maxTolerance = options.maxTolerance ?? 0.1;

  return {
    samples,
    overlap: [start, end],
    maxAbsError: maxAbs,
    rmsError: rms,
    referenceRange,
    normalizedRms,
    normalizedMax,
    pass: normalizedRms <= rmsTolerance && normalizedMax <= maxTolerance,
  };
}
