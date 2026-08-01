/**
 * `.four` - Fourier analysis of a transient waveform.
 *
 * SPICE/LTspice `.four <freq> [<Nharmonics>] [<Nperiods>] <output> [<output> …]`
 * computes the DC component, the fundamental at `freq`, and its harmonics over the
 * **last period** of the transient result, plus total harmonic distortion (THD).
 *
 * The coefficients are obtained by direct trapezoidal integration of
 *   a_k = (2/T)∫ x(t)·cos(kωt) dt,  b_k = (2/T)∫ x(t)·sin(kωt) dt
 * over the last period `T = 1/freq` (DC is the mean). This is exact for a densely
 * sampled input and needs no resampling/interpolation error budget. The waveform
 * convention is `x(t) = a₀ + Σ a_k·cos(kωt) + b_k·sin(kωt)`, so a pure
 * `A·sin(ωt)` yields a fundamental magnitude of exactly `A`.
 */

import type { MeasWaveform } from "./measure";
import { findCurrentTrace, parseCurrentSignal } from "./currents";

/** A single Fourier component (DC is harmonic 0, fundamental is harmonic 1). */
export interface FourierHarmonic {
  /** Harmonic number: 0 = DC, 1 = fundamental, 2 = 2nd harmonic, … */
  harmonic: number;
  /** Frequency of this harmonic in Hz (`harmonic · freq`). */
  frequency: number;
  /** Magnitude (same units as the signal). */
  magnitude: number;
  /** Phase in degrees, in `(-180, 180]`. Zero for DC. */
  phase: number;
  /** Magnitude normalized to the fundamental (fundamental = 1). */
  normalized: number;
}

export interface FourierResult {
  /** The analyzed output signal text, e.g. `V(out)`. */
  output: string;
  /** Fundamental frequency in Hz. */
  frequency: number;
  /** DC component (mean over the last period). */
  dc: number;
  /** DC, fundamental, then harmonics 2..N. */
  harmonics: FourierHarmonic[];
  /** Total harmonic distortion as a fraction (0.05 = 5%). */
  thd: number;
}

export interface FourierSpec {
  /** Fundamental frequency in Hz. */
  freq: number;
  /** Number of harmonics to report including the fundamental (default 10). */
  harmonics: number;
  /** Output signals, e.g. `["V(out)", "I(R1)"]`. */
  outputs: string[];
}

const DEFAULT_HARMONICS = 10;

/** Parse a SI-suffixed number (`1k`, `2.2meg`, `10n`); returns NaN on failure. */
function parseNumber(token: string): number {
  const m = /^([+-]?[\d.]+(?:e[+-]?\d+)?)(meg|mil|[afpnumkgt])?$/i.exec(token.trim());
  if (!m) return Number(token);
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return NaN;
  const suffix = (m[2] ?? "").toLowerCase();
  const scale: Record<string, number> = {
    f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, m: 1e-3, mil: 25.4e-6,
    k: 1e3, meg: 1e6, g: 1e9, t: 1e12,
  };
  return suffix ? base * (scale[suffix] ?? 1) : base;
}

const isInteger = (token: string): boolean => /^\d+$/.test(token.trim());

/**
 * Parse a `.four` directive. Leading `.`/`!` and surrounding whitespace are
 * tolerated. After the frequency, up to two bare integers are read as
 * `[Nharmonics] [Nperiods]` (Nperiods is parsed but unused - we always use the
 * last period); the remaining tokens are output signals. Returns null if the
 * directive is not a `.four` or has no frequency/outputs.
 */
export function parseFourDirective(directive: string): FourierSpec | null {
  const trimmed = directive.trim().replace(/^[.!]+/, "");
  const m = /^four\b\s*(.*)$/i.exec(trimmed);
  if (!m) return null;
  const tokens = m[1].split(/[\s,]+/).filter(Boolean);
  if (tokens.length < 2) return null;

  const freq = parseNumber(tokens[0]);
  if (!Number.isFinite(freq) || freq <= 0) return null;

  let i = 1;
  let harmonics = DEFAULT_HARMONICS;
  // Optional [Nharmonics] [Nperiods] - only consume bare integers, never an output.
  if (i < tokens.length && isInteger(tokens[i])) {
    harmonics = Math.max(1, Number(tokens[i]));
    i += 1;
    if (i < tokens.length && isInteger(tokens[i])) {
      i += 1; // Nperiods - accepted but we always analyze the last period
    }
  }

  const outputs = tokens.slice(i);
  if (outputs.length === 0) return null;
  return { freq, harmonics, outputs };
}

/** Linear interpolation of the value at time `t` within a sorted time series. */
function interpolate(times: number[], values: number[], t: number): number {
  if (t <= times[0]) return values[0];
  const last = times.length - 1;
  if (t >= times[last]) return values[last];
  // Binary search for the bracketing interval.
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  const span = times[hi] - times[lo];
  if (span === 0) return values[lo];
  const frac = (t - times[lo]) / span;
  return values[lo] + frac * (values[hi] - values[lo]);
}

/**
 * Compute the Fourier components of `values(times)` at fundamental `freq`,
 * reporting `numHarmonics` harmonics (including the fundamental) plus DC and THD.
 * Uses trapezoidal integration over the last full period.
 */
export function computeFourier(
  times: number[],
  values: number[],
  freq: number,
  numHarmonics = DEFAULT_HARMONICS,
): FourierResult {
  if (times.length !== values.length) {
    throw new Error("computeFourier: times and values length mismatch");
  }
  if (times.length < 2) throw new Error("computeFourier: need at least two samples");
  if (!(freq > 0)) throw new Error("computeFourier: frequency must be positive");

  const period = 1 / freq;
  const tEnd = times[times.length - 1];
  let tStart = tEnd - period;
  if (tStart < times[0]) tStart = times[0]; // not a full period available - use what we have
  const span = tEnd - tStart;

  // Build the (t, x) grid covering the last period: interpolated endpoints plus
  // every interior sample, so trapezoidal integration tracks the real waveform.
  const grid: Array<{ t: number; x: number }> = [];
  grid.push({ t: tStart, x: interpolate(times, values, tStart) });
  for (let k = 0; k < times.length; k += 1) {
    if (times[k] > tStart && times[k] < tEnd) grid.push({ t: times[k], x: values[k] });
  }
  grid.push({ t: tEnd, x: values[values.length - 1] });

  const omega = (2 * Math.PI) / span; // one period maps to 2π over [tStart, tEnd]

  // Trapezoidal integral of f over the grid.
  const integrate = (f: (t: number, x: number) => number): number => {
    let sum = 0;
    for (let k = 1; k < grid.length; k += 1) {
      const dt = grid[k].t - grid[k - 1].t;
      sum += 0.5 * dt * (f(grid[k - 1].t, grid[k - 1].x) + f(grid[k].t, grid[k].x));
    }
    return sum;
  };

  const dc = integrate((_t, x) => x) / span;

  const harmonics: FourierHarmonic[] = [
    { harmonic: 0, frequency: 0, magnitude: Math.abs(dc), phase: 0, normalized: 0 },
  ];

  let fundamental = 0;
  let distortionSq = 0;
  for (let n = 1; n <= numHarmonics; n += 1) {
    const a = (2 / span) * integrate((t, x) => x * Math.cos(n * omega * (t - tStart)));
    const b = (2 / span) * integrate((t, x) => x * Math.sin(n * omega * (t - tStart)));
    const magnitude = Math.hypot(a, b);
    // x = a·cos + b·sin = mag·cos(θ - φ) with φ = atan2(b, a).
    const phase = (Math.atan2(b, a) * 180) / Math.PI;
    if (n === 1) fundamental = magnitude;
    else distortionSq += magnitude * magnitude;
    harmonics.push({ harmonic: n, frequency: n * freq, magnitude, phase, normalized: 0 });
  }

  // Normalize to the fundamental and finish THD. A signal with no real
  // fundamental (e.g. pure DC) has an ill-defined THD; treat a fundamental that
  // is negligible against the signal's overall scale as zero so it reads 0%.
  const scale = harmonics.reduce((m, h) => Math.max(m, h.magnitude), Math.abs(dc));
  const fundamentalIsReal = fundamental > 1e-9 * scale;
  for (const h of harmonics) {
    h.normalized = fundamentalIsReal ? h.magnitude / fundamental : 0;
  }
  const thd = fundamentalIsReal ? Math.sqrt(distortionSq) / fundamental : 0;

  return { output: "", frequency: freq, dc, harmonics, thd };
}

/** Resolve a `.four` output signal (`V(node)`, bare node, or `I(ref)`) to a value series. */
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
 * Run `.four` analyses over a transient result. Each spec output resolves to a
 * trace/current and is analyzed independently; signals that don't resolve are
 * skipped. Returns one {@link FourierResult} per resolved output.
 */
export function runFourier(waveform: MeasWaveform, spec: FourierSpec): FourierResult[] {
  const results: FourierResult[] = [];
  for (const output of spec.outputs) {
    const values = resolveSignal(waveform, output);
    if (!values) continue;
    const result = computeFourier(waveform.times, values, spec.freq, spec.harmonics);
    result.output = output;
    results.push(result);
  }
  return results;
}
