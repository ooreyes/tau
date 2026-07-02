/**
 * Measurement cursors (LTspice's "1 & 2" cursors, FEATURE_PARITY §6). Given the
 * traces on a scope and two cursor positions along the independent axis, report
 * each trace's value at each cursor and the delta between them — the readout a
 * user needs to measure rise time, period, gain, slope, etc. directly off a
 * waveform. Pure logic so it is fully unit-testable; the scope UI just renders
 * the returned numbers.
 */
import { interpolateAt } from "./waveformCompare";

export interface CursorTraceInput {
  label: string;
  values: readonly number[];
}

export interface CursorTraceReadout {
  label: string;
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
  /** 1 / |dx| — LTspice shows this as the "frequency" of the interval (NaN when
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
 * Map a fraction in `[0,1]` to an absolute value along a **log-scaled** axis —
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
 * Slope between the two cursors in dB per decade — the rolloff measurement a
 * filter designer reads off an FFT/Bode plot. `y` values must already be in dB.
 * NaN when the cursors coincide or either frequency is non-positive.
 */
export function dbPerDecade(readout: CursorReadout, trace: CursorTraceReadout): number {
  if (!(readout.x1 > 0) || !(readout.x2 > 0) || readout.x1 === readout.x2) return NaN;
  return trace.dy / (Math.log10(readout.x2) - Math.log10(readout.x1));
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
    return { label: t.label, y1, y2, dy, slope: dx === 0 ? NaN : dy / dx };
  });

  return {
    x1: cx1,
    x2: cx2,
    dx,
    inverseDx: dx === 0 ? NaN : 1 / Math.abs(dx),
    traces: traceReadouts,
  };
}
