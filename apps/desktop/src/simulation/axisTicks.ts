/**
 * Scope axis tick generation — the "nice number" algorithm (Heckbert/d3 style:
 * steps of 1/2/5×10^n) shared by every plot context (TRAN, AC mag/phase, DC
 * sweep, FFT, noise, step families). Pure and DOM-free so it is fully
 * unit-testable; `SimulationPanel.tsx` / `PlotAxes.tsx` only consume the
 * computed tick list.
 *
 * SI-prefix formatting reuses {@link formatEngineering} (simulation/quantity.ts)
 * — the same authority `EngineeringInput` and every metric readout uses —
 * rather than duplicating a prefix table here.
 */
import { formatEngineering } from "./quantity";

export type AxisScale = "linear" | "log";

export interface AxisTick {
  /** Data-space value this tick sits at. */
  value: number;
  /** Position along the axis in `[0,1]` (0 = domain min, 1 = domain max). */
  frac: number;
  /** Rendered label, e.g. "2ms", "1kHz", "40 dB". */
  label: string;
  /** True when this tick is (numerically) zero — callers draw the zero-line stronger. */
  isZero: boolean;
}

/** Units whose values are already logarithmic/angular and must NOT be run
 *  through SI-prefix scaling ("40dB" must never become "40µdB"-style nonsense). */
const NO_SI_PREFIX_UNITS = new Set(["dB", "°", "deg", "%"]);

/** Kill float accumulation noise (`0.1 + 0.2` → `0.30000000000000004`) without
 *  being sensitive to the value's magnitude — 12 significant digits is far
 *  more precision than any tick label needs, but enough to distinguish two
 *  ticks that differ only in the 15th digit due to arithmetic. */
function cleanFloat(v: number): number {
  if (v === 0 || !Number.isFinite(v)) return v;
  return Number(v.toPrecision(12));
}

/** Heckbert's "nice number": round `range` to the nearest 1, 2, 5, or 10 ×
 *  10^exponent. `round=true` picks the closest of those (used for the step
 *  size); `round=false` rounds UP (used for the overall span). */
function niceNum(range: number, round: boolean): number {
  if (!(range > 0)) return 1;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * 10 ** exponent;
}

/**
 * Generate "nice" tick values covering `[min, max]` (LTspice/Desmos style: the
 * ticks land on round 1/2/5×10^n steps, not raw fractions of the span).
 * Handles reversed domains, zero-span (flat trace) domains, and domains that
 * straddle zero. Always returns at least one tick.
 */
export function niceTicks(min: number, max: number, targetCount = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  let lo = min;
  let hi = max;
  if (lo > hi) [lo, hi] = [hi, lo];
  if (hi - lo < 1e-300) {
    // Zero-span (or effectively so) domain — synthesize a small span around
    // the value (or around 0 when the value itself is 0) so there is still
    // something to show, matching the existing "pad a flat trace" behavior
    // used elsewhere in SimulationPanel.tsx.
    const base = lo === 0 ? 1 : Math.abs(lo);
    lo -= base * 0.5;
    hi += base * 0.5;
  }
  const count = Math.max(2, Math.trunc(targetCount));
  const span = niceNum(hi - lo, false);
  const step = niceNum(span / (count - 1), true);
  const niceMin = Math.floor(lo / step) * step;
  const niceMax = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  const n = Math.round((niceMax - niceMin) / step);
  for (let i = 0; i <= n; i++) {
    ticks.push(cleanFloat(niceMin + i * step));
  }
  return ticks;
}

/**
 * Generate log-decade tick values for a strictly-positive domain (frequency
 * axes, log-magnitude noise density). One tick per decade normally; when the
 * domain spans fewer than 2 decades, adds 2×/5× sub-decade marks so a narrow
 * sweep (e.g. 1kHz–5kHz) still shows more than one or two ticks. When the
 * domain spans many decades, thins by an integer stride so the label count
 * stays near `targetCount`. Returns `[]` for a non-positive or degenerate domain.
 */
export function logTicks(min: number, max: number, targetCount = 6): number[] {
  if (!(min > 0) || !(max > 0) || !(max > min)) return [];
  const lo = Math.floor(Math.log10(min));
  const hi = Math.ceil(Math.log10(max));
  const decades = hi - lo;
  if (decades <= 0) return [10 ** lo];

  // Decide sub-decade-vs-stride mode off the ACTUAL span (log10(max/min)), not
  // the outward-rounded [lo,hi] used for decade alignment — a domain that
  // spans exactly one decade (e.g. 500 Hz–5 kHz) should still get 1/2/5
  // sub-ticks, not just its two rounded decade endpoints.
  const actualSpan = Math.log10(max / min);
  if (actualSpan < 2) {
    const ticks: number[] = [];
    for (let k = lo - 1; k <= hi; k++) {
      for (const m of [1, 2, 5]) {
        const v = m * 10 ** k;
        if (v >= min * 0.999 && v <= max * 1.001) ticks.push(cleanFloat(v));
      }
    }
    // Deep zoom on a log axis (Desmos-style wheel zoom can shrink the window
    // to well under a decade) can leave a window with NO 1/2/5×10^n value
    // inside it at all — e.g. a 3.10kHz–3.14kHz window contains none of
    // {1,2,3,5}×10^{2,3,4}. Rather than render zero ticks, degrade
    // gracefully to plain nice-number ticks over the actual (now near-linear
    // at this scale) visible range.
    if (ticks.length < 2) return niceTicks(min, max, targetCount);
    return ticks;
  }

  const count = Math.max(2, Math.trunc(targetCount));
  const stride = Math.max(1, Math.ceil((decades + 1) / count));
  const ticks: number[] = [];
  for (let k = lo; k <= hi; k += stride) ticks.push(cleanFloat(10 ** k));
  // Always include the top decade so the visible range doesn't dead-end short.
  if (ticks[ticks.length - 1] !== cleanFloat(10 ** hi)) ticks.push(cleanFloat(10 ** hi));
  return ticks;
}

/** Map a data value to its fractional position `[0,1]` within `[min,max]`,
 *  honoring the axis scale. Returns `NaN` for values with no position on a
 *  log axis (non-positive value, or a non-positive/degenerate domain). */
export function valueToFraction(value: number, min: number, max: number, scale: AxisScale = "linear"): number {
  if (scale === "log") {
    if (!(value > 0) || !(min > 0) || !(max > 0)) return NaN;
    const l0 = Math.log10(min);
    const l1 = Math.log10(max);
    if (l1 === l0) return 0.5;
    return (Math.log10(value) - l0) / (l1 - l0);
  }
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}

/** Inverse of {@link valueToFraction}: map a `[0,1]` axis fraction back to a
 *  data value. */
export function fractionToValue(frac: number, min: number, max: number, scale: AxisScale = "linear"): number {
  if (scale === "log") {
    if (!(min > 0) || !(max > 0)) return NaN;
    const l0 = Math.log10(min);
    const l1 = Math.log10(max);
    return 10 ** (l0 + frac * (l1 - l0));
  }
  return min + frac * (max - min);
}

/**
 * Format a single tick's value for display. SI-prefix units (V, A, s, Hz, W,
 * Ω, V/√Hz, …) reuse {@link formatEngineering} so tick labels always agree
 * with every other numeric readout in the app. Angular/logarithmic units
 * (dB, °, %) are never SI-scaled — "40dB" must never read "40µdB".
 */
export function formatTickLabel(value: number, unit = ""): string {
  const v = cleanFloat(value);
  if (NO_SI_PREFIX_UNITS.has(unit)) {
    const rounded = Number(v.toPrecision(4));
    return unit === "°" ? `${rounded}°` : `${rounded} ${unit}`;
  }
  return formatEngineering(v, unit, 3);
}

export interface ComputeAxisTicksOptions {
  scale?: AxisScale;
  targetCount?: number;
  unit?: string;
}

/**
 * The one-stop entry point the plot chrome uses: compute nice/log ticks for
 * `[min, max]`, drop any that fall outside the visible range (can happen at
 * the domain edges for log ticks), format each with {@link formatTickLabel},
 * and flag the zero tick (if present) so the caller can draw a stronger
 * zero-line.
 */
export function computeAxisTicks(min: number, max: number, opts: ComputeAxisTicksOptions = {}): AxisTick[] {
  const scale = opts.scale ?? "linear";
  const targetCount = opts.targetCount ?? 5;
  const unit = opts.unit ?? "";
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];

  const raw = scale === "log" ? logTicks(min, max, targetCount) : niceTicks(min, max, targetCount);
  const seen = new Set<number>();
  const ticks: AxisTick[] = [];
  const EPS = 1e-6;
  for (const value of raw) {
    const frac = valueToFraction(value, min, max, scale);
    if (!Number.isFinite(frac) || frac < -EPS || frac > 1 + EPS) continue;
    const key = cleanFloat(value);
    if (seen.has(key)) continue;
    seen.add(key);
    ticks.push({
      value,
      frac: Math.min(1, Math.max(0, frac)),
      label: formatTickLabel(value, unit),
      isZero: Math.abs(value) < 1e-15 * Math.max(1, Math.abs(max - min)),
    });
  }
  ticks.sort((a, b) => a.frac - b.frac);
  return ticks;
}

/**
 * Pick a target tick count from a measured pixel size so labels stay legible
 * (don't collide) as a plot pane shrinks — e.g. multi-pane layouts at the
 * app's 900×600 minimum window size. `minSpacingPx` is the minimum pixel gap
 * a single tick label needs; the result is clamped to `[minCount, maxCount]`.
 */
export function pickTickCount(sizePx: number, minSpacingPx = 55, minCount = 2, maxCount = 7): number {
  if (!Number.isFinite(sizePx) || sizePx <= 0) return maxCount;
  const count = Math.floor(sizePx / minSpacingPx) + 1;
  return Math.min(maxCount, Math.max(minCount, count));
}
