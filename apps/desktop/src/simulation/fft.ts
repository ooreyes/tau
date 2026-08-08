/**
 * FFT of a transient waveform - LTspice's "View → FFT" on the scope.
 *
 * LTspice resamples the (non-uniformly sampled) transient onto a uniform grid,
 * applies a window, and shows the one-sided amplitude spectrum on a log
 * frequency / dB axis. We do the same: linear-interpolate onto a power-of-two
 * uniform grid over a time window, apply a window function, run a radix-2 FFT,
 * and return the one-sided spectrum scaled so a pure `A·cos(ωt)` reads an
 * amplitude of exactly `A` at its bin.
 *
 * Kept as pure functions (no UI, no MNA) so the maths is unit-testable against
 * hand-computed cases: a DC level lands all energy in bin 0; a single sinusoid
 * at an exact bin frequency reads its true amplitude there.
 */

import type { MeasWaveform } from "./measure";
import { findCurrentTrace, parseCurrentSignal } from "./currents";

/** Window functions offered on the FFT view (LTspice's default is a flavour of these). */
export type WindowFn = "rectangular" | "hann" | "hamming" | "blackman";

export interface Spectrum {
  /** One-sided bin frequencies in Hz (length N/2 + 1, DC … Nyquist). */
  frequencies: number[];
  /** One-sided amplitude (peak) of each bin, in signal units. */
  magnitude: number[];
  /** `20·log10(magnitude)` with a floor so silent bins don't go to −∞. */
  magnitudeDb: number[];
  /** Phase of each bin in degrees, in `(-180, 180]`. */
  phase: number[];
  /**
   * The window the transform was taken through. Carried with the data because
   * the window - not the signal - decides how many bins one component spreads
   * over, and therefore whether two nearby bins are two components or one.
   * See {@link windowMainLobeBins}.
   */
  window: WindowFn;
}

export interface SpectrumOptions {
  /** Window function (default `"hann"`, matching LTspice's default smoothing). */
  window?: WindowFn;
  /** Number of uniform samples (rounded up to a power of two). Default: next pow2 ≥ input length, min 256. */
  points?: number;
  /** Time window start (default: first sample time). */
  tStart?: number;
  /** Time window end (default: last sample time). */
  tEnd?: number;
}

/** dB floor so a zero/near-zero bin reads a finite, very negative number. */
const DB_FLOOR = -300;

/** Smallest sensible FFT size for a readable spectrum. */
const MIN_POINTS = 256;

/** Round `n` up to the next power of two (≥ 1). */
export function nextPow2(n: number): number {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * In-place iterative radix-2 Cooley-Tukey FFT. `re` and `im` are the real and
 * imaginary parts; their length **must** be a power of two. Computes the forward
 * transform `X[k] = Σ x[n]·e^(-i 2π k n / N)`.
 */
export function fftRadix2(re: number[], im: number[]): void {
  const n = re.length;
  if (n !== im.length) throw new Error("fftRadix2: re/im length mismatch");
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) throw new Error("fftRadix2: length must be a power of two");

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  // Butterflies, doubling the transform length each stage.
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe;
        im[i + k + len / 2] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/** Window coefficient `w[i]` for an `N`-point window. */
export function windowValue(window: WindowFn, i: number, n: number): number {
  if (n <= 1) return 1;
  const x = (2 * Math.PI * i) / (n - 1);
  switch (window) {
    case "rectangular":
      return 1;
    case "hann":
      return 0.5 - 0.5 * Math.cos(x);
    case "hamming":
      return 0.54 - 0.46 * Math.cos(x);
    case "blackman":
      return 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
    default:
      return 1;
  }
}

/**
 * How many bins on each side of a component the window's main lobe covers.
 *
 * A window multiplies the signal in time, so it convolves the spectrum with the
 * window's own transform: a single component at bin `m` reappears at `m ± k` for
 * every `k` the window's kernel is non-zero at. Written as a discrete kernel
 * over integer bin offsets these are exact:
 *
 *   rectangular  [1]                          → 0 bins  (integer offsets are nulls)
 *   hann         [-¼, ½, -¼]                  → 1 bin
 *   hamming      [-0.23, 0.54, -0.23]         → 1 bin
 *   blackman     [0.04, -¼, 0.42, -¼, 0.04]   → 2 bins
 *
 * DC is always exactly on bin 0, so these are exactly the bins a DC term
 * contaminates - the bins in which no independent component can be resolved.
 */
export function windowMainLobeBins(window: WindowFn): number {
  switch (window) {
    case "rectangular":
      return 0;
    case "blackman":
      return 2;
    case "hann":
    case "hamming":
    default:
      return 1;
  }
}

/** Linear interpolation of `values(times)` at `t` (clamped to the endpoints). */
function interpolate(times: number[], values: number[], t: number): number {
  if (t <= times[0]) return values[0];
  const last = times.length - 1;
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
 * Compute the one-sided amplitude spectrum of a waveform. The waveform is
 * resampled onto a uniform grid of `N` (power-of-two) points over the time
 * window, windowed, and transformed. Amplitudes are normalized so a sinusoid at
 * an exact bin reads its true peak amplitude (DC and Nyquist bins carry no
 * doubling). Returns the DC … Nyquist half of the spectrum.
 */
export function waveformSpectrum(
  times: number[],
  values: number[],
  opts: SpectrumOptions = {},
): Spectrum {
  if (times.length !== values.length) {
    throw new Error("waveformSpectrum: times and values length mismatch");
  }
  if (times.length < 2) throw new Error("waveformSpectrum: need at least two samples");

  const tStart = opts.tStart ?? times[0];
  const tEnd = opts.tEnd ?? times[times.length - 1];
  if (!(tEnd > tStart)) throw new Error("waveformSpectrum: time window must be positive");

  const window = opts.window ?? "hann";
  const n = nextPow2(Math.max(opts.points ?? Math.max(times.length, MIN_POINTS), 2));

  // Uniform resample over [tStart, tEnd). The sample spacing dt sets the bin
  // width: fs = N/(tEnd - tStart), so bin k is at k·fs/N = k/(tEnd - tStart).
  const span = tEnd - tStart;
  const dt = span / n;
  const re = new Array<number>(n);
  const im = new Array<number>(n).fill(0);
  let windowSum = 0;
  for (let i = 0; i < n; i++) {
    const w = windowValue(window, i, n);
    windowSum += w;
    re[i] = interpolate(times, values, tStart + i * dt) * w;
  }

  fftRadix2(re, im);

  const half = n / 2;
  const frequencies: number[] = [];
  const magnitude: number[] = [];
  const magnitudeDb: number[] = [];
  const phase: number[] = [];
  // Coherent-gain normalization: a unit-amplitude sinusoid at a bin integrates
  // to windowSum/2 in the bin; doubling folds the negative-frequency twin.
  const norm = windowSum > 0 ? 2 / windowSum : 0;
  const fs = 1 / dt;
  for (let k = 0; k <= half; k++) {
    const onlyHalf = k === 0 || k === half; // DC and Nyquist have no twin to fold.
    const mag = Math.hypot(re[k], im[k]) * norm * (onlyHalf ? 0.5 : 1);
    frequencies.push((k * fs) / n);
    magnitude.push(mag);
    magnitudeDb.push(mag > 0 ? Math.max(DB_FLOOR, 20 * Math.log10(mag)) : DB_FLOOR);
    phase.push((Math.atan2(im[k], re[k]) * 180) / Math.PI);
  }

  return { frequencies, magnitude, magnitudeDb, phase, window };
}

/**
 * The bin with the largest amplitude above DC.
 *
 * This is a raw peak search: it always names a frequency, including for a
 * spectrum that has no periodic content at all (the largest non-DC bin of a
 * settled DC waveform is its window's leakage). Anything user-facing must go
 * through `spectrumInsights`, which decides whether a tone exists before
 * naming one.
 */
export function dominantFrequency(spectrum: Spectrum): number {
  let best = 0;
  let bestMag = -Infinity;
  // Skip bin 0 (DC) so a signal with a DC offset still reports its real tone.
  for (let k = 1; k < spectrum.frequencies.length; k++) {
    if (spectrum.magnitude[k] > bestMag) {
      bestMag = spectrum.magnitude[k];
      best = spectrum.frequencies[k];
    }
  }
  return best;
}

export interface ThdResult {
  /** Fundamental frequency in Hz, snapped to the nearest FFT bin. */
  fundamentalHz: number;
  /** Fundamental amplitude (signal units). */
  fundamental: number;
  /** Total harmonic distortion as a fraction (0.05 = 5%). */
  thd: number;
  /** Number of harmonic bins summed (2nd … up to Nyquist). */
  harmonics: number;
}

/** Index of the uniformly-spaced bin nearest `target` Hz. */
function nearestBin(frequencies: number[], target: number): number {
  const df = frequencies.length > 1 ? frequencies[1] - frequencies[0] : 1;
  if (!(df > 0)) return 0;
  return Math.min(frequencies.length - 1, Math.max(0, Math.round(target / df)));
}

/**
 * Total harmonic distortion read from an amplitude spectrum. The fundamental is
 * the supplied frequency (snapped to its nearest bin) or, if omitted, the
 * loudest bin above DC; harmonics are the bins nearest `2f₀, 3f₀, …` up to
 * Nyquist. THD = √(Σ harmonic²) / fundamental. Exact for a leakage-free
 * (exact-bin, rectangular-window) signal; an estimate under a smoothing window.
 */
export function spectrumThd(
  spectrum: Spectrum,
  fundamentalHz?: number,
  maxHarmonics = 9,
): ThdResult {
  const { frequencies, magnitude } = spectrum;
  const nyquist = frequencies[frequencies.length - 1];
  const targetHz = fundamentalHz ?? dominantFrequency(spectrum);
  const fundIdx = nearestBin(frequencies, targetHz);
  const f0Hz = frequencies[fundIdx];
  const fundamental = magnitude[fundIdx];
  if (!(fundamental > 0) || !(f0Hz > 0)) {
    return { fundamentalHz: f0Hz, fundamental, thd: 0, harmonics: 0 };
  }
  let sumSq = 0;
  let count = 0;
  for (let h = 2; h <= maxHarmonics + 1; h++) {
    const hf = h * f0Hz;
    if (hf > nyquist) break;
    const idx = nearestBin(frequencies, hf);
    if (idx === fundIdx) continue; // guard against a degenerate spacing collapsing onto f₀
    sumSq += magnitude[idx] * magnitude[idx];
    count++;
  }
  return { fundamentalHz: f0Hz, fundamental, thd: Math.sqrt(sumSq) / fundamental, harmonics: count };
}

/** Resolve an FFT output signal (`V(node)`, bare node, or `I(ref)`) to a value series. */
function resolveSignal(waveform: MeasWaveform, output: string): number[] | null {
  const text = output.trim();
  const current = parseCurrentSignal(text);
  if (current) {
    const found = findCurrentTrace(waveform.currents, current.ref, current.terminal);
    return found ? [...found.values] : null;
  }
  const voltage = /^v\(([^)]+)\)$/i.exec(text);
  const node = (voltage ? voltage[1] : text).trim().toLowerCase();
  // Match the net id, the bare label, or the label's inner name - trace labels
  // are display names like `V(R1·C1)` whose inner name is NOT the net id, and
  // the viewer's signal pickers feed those labels back here verbatim.
  const trace = waveform.traces.find((t) => {
    if (t.id.toLowerCase() === node || t.label.toLowerCase() === node) return true;
    const inner = /^v\(([^)]+)\)$/i.exec(t.label);
    return inner !== null && inner[1].trim().toLowerCase() === node;
  });
  return trace ? trace.values : null;
}

/**
 * Compute the FFT spectrum of a named signal in a transient result. Returns
 * null if the signal does not resolve, so the caller can report a clear error.
 */
export function runWaveformFft(
  waveform: MeasWaveform,
  output: string,
  opts: SpectrumOptions = {},
): Spectrum | null {
  const values = resolveSignal(waveform, output);
  if (!values) return null;
  return waveformSpectrum(waveform.times, values, opts);
}
