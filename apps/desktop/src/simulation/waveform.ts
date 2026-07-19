import type { Trace } from "./linearTransient";
import { classifySignal } from "./measurementModel";
import type { Viewport } from "./plotViewport";

export const MAX_WAVEFORM_RENDER_POINTS = 4_096;

export interface WaveformBounds {
  min: number;
  max: number;
}

const WAVEFORM_PADDING_FRACTION = 0.08;
// Native solvers often leave femto-scale numerical residue on a physically
// steady milli/volt-scale signal. Treating that residue as the whole Y domain
// produces unreadable, effectively duplicate tick labels and visually inflates
// solver noise into a waveform. Below one part per billion of the signal scale,
// use the same honest steady-signal framing as an exactly flat trace.
const EFFECTIVELY_FLAT_RELATIVE_SPAN = 1e-9;

function paddedWaveformBounds(rawMin: number, rawMax: number): WaveformBounds {
  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax) || rawMax < rawMin) {
    return { min: -1, max: 1 };
  }

  const rawSpan = rawMax - rawMin;
  const signalScale = Math.max(Math.abs(rawMin), Math.abs(rawMax));
  const effectivelyFlat = rawSpan === 0
    || (signalScale > 0 && rawSpan <= signalScale * EFFECTIVELY_FLAT_RELATIVE_SPAN);
  // A flat trace still needs a non-zero viewport. Scale that viewport to the
  // signal itself so a flat 5 V rail and a flat 5 pV residual both remain
  // meaningful; zero has no natural scale, so use a deliberately tiny finite
  // engineering span instead of the old arbitrary one-volt fallback.
  const padding = !effectivelyFlat
    ? rawSpan * WAVEFORM_PADDING_FRACTION
    : Math.abs(rawMin) > 0
      ? Math.abs(rawMin) * WAVEFORM_PADDING_FRACTION
      : 1e-12;

  return { min: rawMin - padding, max: rawMax + padding };
}

/** Find scope bounds without spreading a large native result into a function call. */
export function waveformBounds(traces: ReadonlyArray<Pick<Trace, "values">>): WaveformBounds {
  let rawMin = Number.POSITIVE_INFINITY;
  let rawMax = Number.NEGATIVE_INFINITY;

  for (const trace of traces) {
    for (const value of trace.values) {
      if (!Number.isFinite(value)) continue;
      if (value < rawMin) rawMin = value;
      if (value > rawMax) rawMax = value;
    }
  }

  return paddedWaveformBounds(rawMin, rawMax);
}

/**
 * Find padded signal bounds only for samples inside the visible time window.
 * This powers Y-only autoscale after an X zoom: an outlier elsewhere in the
 * run must not flatten the portion the engineer is currently inspecting.
 */
export function visibleWaveformBounds(
  times: ReadonlyArray<number>,
  traces: ReadonlyArray<Pick<Trace, "values">>,
  xMin: number,
  xMax: number,
): WaveformBounds {
  const windowMin = Math.min(xMin, xMax);
  const windowMax = Math.max(xMin, xMax);
  let rawMin = Number.POSITIVE_INFINITY;
  let rawMax = Number.NEGATIVE_INFINITY;

  for (const trace of traces) {
    const sampleCount = Math.min(times.length, trace.values.length);
    for (let index = 0; index < sampleCount; index += 1) {
      const time = times[index];
      const value = trace.values[index];
      if (!Number.isFinite(time) || time < windowMin || time > windowMax || !Number.isFinite(value)) continue;
      if (value < rawMin) rawMin = value;
      if (value > rawMax) rawMax = value;
    }
  }

  // A window between sparse samples has no in-window extrema. Falling back
  // to the full signal is safer than producing an arbitrary or invalid axis.
  return Number.isFinite(rawMin) ? paddedWaveformBounds(rawMin, rawMax) : waveformBounds(traces);
}

/**
 * Frame the portion of a transient waveform that carries useful visual detail.
 *
 * A full-run view of a fast periodic signal can contain hundreds of cycles, so
 * even a correct unfilled min/max envelope becomes a visually solid band. For
 * periodic data, Auto Frame shows the final 3-5 cycles (four by default) and
 * computes Y from only that time window. The final cycles are intentional: they
 * retain steady-state behavior while leaving startup visible through the
 * separate Full Run/Home action.
 *
 * Non-periodic data keeps the caller's current X window and only recomputes Y,
 * preserving the previous "autoscale visible" behavior after a manual zoom.
 */
export function autoFrameWaveform(
  times: ReadonlyArray<number>,
  traces: ReadonlyArray<Pick<Trace, "values">>,
  currentX: { xMin: number; xMax: number },
  requestedCycles = 4,
): Viewport {
  let timeMin = Number.POSITIVE_INFINITY;
  let timeMax = Number.NEGATIVE_INFINITY;
  for (const time of times) {
    if (!Number.isFinite(time)) continue;
    if (time < timeMin) timeMin = time;
    if (time > timeMax) timeMax = time;
  }

  const fallbackX = Number.isFinite(currentX.xMin)
    && Number.isFinite(currentX.xMax)
    && currentX.xMax > currentX.xMin
    ? currentX
    : Number.isFinite(timeMin) && timeMax > timeMin
      ? { xMin: timeMin, xMax: timeMax }
      : { xMin: 0, xMax: 1 };

  // Use the slowest periodic trace in a multi-trace pane. Its four cycles give
  // every faster trace at least four cycles too, avoiding a frame that hides a
  // legitimate low-frequency signal just because another trace oscillates fast.
  let period = 0;
  for (const trace of traces) {
    const sampleCount = Math.min(times.length, trace.values.length);
    // First classify the complete run. If startup behavior makes that honestly
    // transient, retry progressively smaller trailing windows: Auto Frame is a
    // steady-state inspection command, and four stable cycles at the end are
    // enough even when oscillator startup or one initial spike is not periodic.
    const starts = [0, Math.floor(sampleCount / 2), Math.floor(sampleCount * 3 / 4)];
    for (const start of starts) {
      const classification = classifySignal(
        start === 0 ? times : times.slice(start, sampleCount),
        start === 0 ? trace.values : trace.values.slice(start, sampleCount),
      );
      if (classification.kind === "periodic" && classification.period && Number.isFinite(classification.period)) {
        period = Math.max(period, classification.period);
        break;
      }
    }
  }

  let xMin = fallbackX.xMin;
  let xMax = fallbackX.xMax;
  if (period > 0 && Number.isFinite(timeMin) && Number.isFinite(timeMax) && timeMax > timeMin) {
    const cycles = Math.min(5, Math.max(3, Number.isFinite(requestedCycles) ? requestedCycles : 4));
    xMax = timeMax;
    xMin = Math.max(timeMin, xMax - period * cycles);
  }

  const y = visibleWaveformBounds(times, traces, xMin, xMax);
  return { xMin, xMax, yMin: y.min, yMax: y.max };
}

/**
 * Select an evenly spaced, first-and-last preserving subset for SVG rendering.
 * Simulation data is kept intact; this only limits the number of path commands.
 */
export function displaySampleIndices(length: number, maxPoints = MAX_WAVEFORM_RENDER_POINTS): number[] {
  if (!Number.isSafeInteger(length) || length <= 0) return [];
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 2) return [0];
  if (length <= maxPoints) return Array.from({ length }, (_, index) => index);

  const last = length - 1;
  const interval = Math.ceil(last / (maxPoints - 1));
  const indices: number[] = [];
  for (let index = 0; index < last; index += interval) indices.push(index);
  if (indices[indices.length - 1] !== last) indices.push(last);
  return indices;
}

/**
 * Select transient samples for an SVG polyline without aliasing away narrow
 * pulses. Dense data is bucketed by horizontal pixel and preserves the first,
 * last, minimum, and maximum sample in each column. That produces a bounded
 * min/max envelope made only of engineering lines, never an area-to-baseline.
 */
export function waveformEnvelopeIndices(
  times: ReadonlyArray<number>,
  values: ReadonlyArray<number>,
  xMin: number,
  xMax: number,
  pixelColumns: number,
): number[] {
  const sampleCount = Math.min(times.length, values.length);
  if (sampleCount <= 0) return [];

  const windowMin = Math.min(xMin, xMax);
  const windowMax = Math.max(xMin, xMax);
  const xSpan = windowMax - windowMin;
  if (!(xSpan > 0)) return [];

  const visible: number[] = [];
  let leading: number | null = null;
  let trailing: number | null = null;
  for (let index = 0; index < sampleCount; index += 1) {
    const time = times[index];
    const value = values[index];
    if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
    if (time < windowMin) {
      leading = index;
    } else if (time <= windowMax) {
      visible.push(index);
    } else if (trailing === null) {
      trailing = index;
    }
  }

  if (visible.length === 0) {
    return leading !== null && trailing !== null ? [leading, trailing] : [];
  }

  const columns = Number.isFinite(pixelColumns) ? Math.max(1, Math.floor(pixelColumns)) : 1;
  const edgeCount = Number(leading !== null) + Number(trailing !== null);
  if (visible.length + edgeCount <= columns * 2) {
    return [
      ...(leading === null ? [] : [leading]),
      ...visible,
      ...(trailing === null ? [] : [trailing]),
    ];
  }

  interface Bucket {
    first: number;
    last: number;
    min: number;
    max: number;
  }
  const buckets = new Map<number, Bucket>();
  for (const index of visible) {
    const fraction = (times[index] - windowMin) / xSpan;
    const column = Math.min(columns - 1, Math.max(0, Math.floor(fraction * columns)));
    const bucket = buckets.get(column);
    if (!bucket) {
      buckets.set(column, { first: index, last: index, min: index, max: index });
      continue;
    }
    bucket.last = index;
    if (values[index] < values[bucket.min]) bucket.min = index;
    if (values[index] > values[bucket.max]) bucket.max = index;
  }

  const selected = new Set<number>();
  if (leading !== null) selected.add(leading);
  for (const bucket of buckets.values()) {
    selected.add(bucket.first);
    selected.add(bucket.min);
    selected.add(bucket.max);
    selected.add(bucket.last);
  }
  if (trailing !== null) selected.add(trailing);
  return [...selected].sort((a, b) => a - b);
}
