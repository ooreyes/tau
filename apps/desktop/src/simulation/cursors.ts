/**
 * Measurement cursors (LTspice's "1 & 2" cursors, LTspice parity ). Given the
 * traces on a scope and two cursor positions along the independent axis, report
 * each trace's value at each cursor and the delta between them - the readout a
 * user needs to measure rise time, period, gain, slope, etc. directly off a
 * waveform. Pure logic so it is fully unit-testable; the scope UI just renders
 * the returned numbers.
 */
import { interpolateAt } from "./waveformCompare";

export interface CursorTraceInput {
  label: string;
  /** Physical unit carried through to the readout (V/A/W/etc.). */
  unit?: string;
  values: readonly number[];
}

export interface CursorTraceReadout {
  label: string;
  unit?: string;
  /** Value at cursor 1 / cursor 2. */
  y1: number;
  y2: number;
  /** y2 − y1. */
  dy: number;
  /** Slope dy/dx (NaN when the cursors coincide). */
  slope: number;
}

export interface CursorReadout {
  /** Independent-axis position of each cursor (clamped to the data range). */
  x1: number;
  x2: number;
  /** x2 − x1. */
  dx: number;
  /** 1 / |dx| - LTspice shows this as the "frequency" of the interval (NaN when
   *  the cursors coincide). */
  inverseDx: number;
  traces: CursorTraceReadout[];
}

/** Clamp `x` into `[lo, hi]` (handles lo>hi defensively). */
const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(Math.max(x, Math.min(lo, hi)), Math.max(lo, hi));

/**
 * Map a fraction in `[0,1]` along the axis to an absolute axis value. `0` →
 * first sample, `1` → last sample. Values outside `[0,1]` are clamped.
 */
export function fractionToX(axis: readonly number[], fraction: number): number {
  if (axis.length === 0) return NaN;
  const first = axis[0];
  const last = axis[axis.length - 1];
  return first + clamp(fraction, 0, 1) * (last - first);
}

/**
 * Convert a pointer's client-space X coordinate into the cursor fraction used
 * by the full run. The SVG's axis gutter is excluded, and a zoomed viewport is
 * mapped back into the complete data domain so direct plot dragging and the
 * exact-time fields remain one source of truth.
 */
export function plotClientXToFraction(
  clientX: number,
  bounds: { left: number; width: number },
  viewBoxWidth: number,
  pad: number,
  viewport: { xMin: number; xMax: number },
  axis: readonly number[],
): number {
  if (axis.length === 0 || bounds.width <= 0 || viewBoxWidth <= pad * 2) return NaN;
  const svgX = ((clientX - bounds.left) / bounds.width) * viewBoxWidth;
  const plotFraction = clamp((svgX - pad) / (viewBoxWidth - pad * 2), 0, 1);
  const x = viewport.xMin + plotFraction * (viewport.xMax - viewport.xMin);
  const first = axis[0];
  const span = axis[axis.length - 1] - first;
  return span === 0 ? 0 : clamp((x - first) / span, 0, 1);
}

/**
 * Map a fraction in `[0,1]` to an absolute value along a **log-scaled** axis -
 * the frequency axis of the FFT/Bode plots, where equal slider travel should
 * mean equal decades, not equal hertz. Non-positive leading entries (the FFT's
 * DC bin) are skipped since they have no place on a log axis. Returns NaN when
 * no positive span exists.
 */
export function logFractionToX(axis: readonly number[], fraction: number): number {
  const first = axis.find((v) => v > 0);
  const last = axis.length > 0 ? axis[axis.length - 1] : NaN;
  if (first === undefined || !(last > 0)) return NaN;
  const l0 = Math.log10(first);
  const l1 = Math.log10(last);
  return 10 ** (l0 + clamp(fraction, 0, 1) * (l1 - l0));
}

/**
 * Slope between the two cursors in dB per decade - the rolloff measurement a
 * filter designer reads off an FFT/Bode plot. `y` values must already be in dB.
 * NaN when the cursors coincide or either frequency is non-positive.
 */
export function dbPerDecade(readout: CursorReadout, trace: CursorTraceReadout): number {
  if (!(readout.x1 > 0) || !(readout.x2 > 0) || readout.x1 === readout.x2) return NaN;
  return trace.dy / (Math.log10(readout.x2) - Math.log10(readout.x1));
}

/** One place where a trace passes through a target value. */
export interface TraceCrossing {
  /** Interpolated position on the independent axis. */
  x: number;
  /** Index of the sample starting the segment that contains the crossing. */
  index: number;
  /** True when the trace is increasing through the target. */
  rising: boolean;
}

/**
 * Every position where `values` crosses `target`, left to right - the inverse of
 * reading a value off a cursor: "at what time is this signal 3.3 V?". Linear
 * interpolation inside each segment matches how the scope draws the trace, so a
 * reported crossing always lands on the rendered line.
 *
 * A sample sitting exactly on the target is reported once, at that sample. A
 * flat run exactly equal to the target reports only where it is entered, so a
 * clipped/settled waveform yields one crossing rather than thousands. Segments
 * with a non-finite endpoint are skipped instead of producing a bogus root.
 * `limit` bounds the result for pathological (e.g. noisy) inputs.
 */
export function findTraceCrossings(
  axis: readonly number[],
  values: readonly number[],
  target: number,
  limit = 256,
): TraceCrossing[] {
  const crossings: TraceCrossing[] = [];
  if (!Number.isFinite(target) || axis.length === 0 || values.length !== axis.length) return crossings;

  // Whether the previous sample was itself exactly on the target, so an
  // entered-and-held flat run is not re-reported at every sample.
  let previousWasExact = false;
  for (let i = 0; i < axis.length && crossings.length < limit; i += 1) {
    const y = values[i];
    if (!Number.isFinite(y)) {
      previousWasExact = false;
      continue;
    }
    if (y === target) {
      if (!previousWasExact) crossings.push({ x: axis[i], index: i, rising: risingAt(values, i, target) });
      previousWasExact = true;
      continue;
    }
    previousWasExact = false;
    if (i === 0) continue;
    const prev = values[i - 1];
    // The equality case is owned by the branch above; only a strict straddle
    // produces an interior root.
    if (!Number.isFinite(prev) || prev === target) continue;
    const below = prev < target;
    if (below === y < target) continue;
    const span = y - prev;
    const t = span === 0 ? 0 : (target - prev) / span;
    crossings.push({
      x: axis[i - 1] + t * (axis[i] - axis[i - 1]),
      index: i - 1,
      rising: below,
    });
  }
  return crossings;
}

/** Direction through `target` at an exactly-equal sample, using its neighbours. */
function risingAt(values: readonly number[], index: number, target: number): boolean {
  for (let after = index + 1; after < values.length; after += 1) {
    const y = values[after];
    if (!Number.isFinite(y) || y === target) continue;
    return y > target;
  }
  for (let before = index - 1; before >= 0; before -= 1) {
    const y = values[before];
    if (!Number.isFinite(y) || y === target) continue;
    return y < target;
  }
  return true;
}

/**
 * The crossing closest to `referenceX` - what a cursor should snap to when the
 * user types a value, so the jump is to the nearest matching point rather than
 * always back to the start of the run. Ties prefer the earlier crossing.
 */
export function nearestCrossing(
  crossings: readonly TraceCrossing[],
  referenceX: number,
): TraceCrossing | null {
  let best: TraceCrossing | null = null;
  let bestDistance = Infinity;
  for (const crossing of crossings) {
    const distance = Math.abs(crossing.x - referenceX);
    if (distance < bestDistance) {
      best = crossing;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Map an absolute axis position back to the `[0,1]` fraction the cursor state
 * stores. Inverse of `fractionToX`; a zero-span axis maps to 0.
 */
export function xToFraction(axis: readonly number[], x: number): number {
  if (axis.length === 0) return NaN;
  const first = axis[0];
  const span = axis[axis.length - 1] - first;
  return span === 0 ? 0 : clamp((x - first) / span, 0, 1);
}

/**
 * Compute a two-cursor readout. `x1`/`x2` are absolute positions on the
 * independent axis (e.g. seconds); each is clamped to the axis range and each
 * trace is linearly interpolated there. Throws if the axis is empty or any trace
 * length disagrees with the axis.
 */
export function cursorReadout(
  axis: readonly number[],
  traces: readonly CursorTraceInput[],
  x1: number,
  x2: number,
): CursorReadout {
  if (axis.length === 0) throw new Error("cursorReadout: empty axis.");
  for (const t of traces) {
    if (t.values.length !== axis.length) {
      throw new Error(`cursorReadout: trace "${t.label}" length ${t.values.length} ≠ axis ${axis.length}.`);
    }
  }
  const lo = axis[0];
  const hi = axis[axis.length - 1];
  const cx1 = clamp(x1, lo, hi);
  const cx2 = clamp(x2, lo, hi);
  const dx = cx2 - cx1;

  const traceReadouts: CursorTraceReadout[] = traces.map((t) => {
    const y1 = interpolateAt(axis, t.values, cx1);
    const y2 = interpolateAt(axis, t.values, cx2);
    const dy = y2 - y1;
    return { label: t.label, unit: t.unit, y1, y2, dy, slope: dx === 0 ? NaN : dy / dx };
  });

  return {
    x1: cx1,
    x2: cx2,
    dx,
    inverseDx: dx === 0 ? NaN : 1 / Math.abs(dx),
    traces: traceReadouts,
  };
}
