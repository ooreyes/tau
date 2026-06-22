import type { Trace } from "./linearTransient";

export const MAX_WAVEFORM_RENDER_POINTS = 4_096;

export interface WaveformBounds {
  min: number;
  max: number;
}

/** Find scope bounds without spreading a large native result into a function call. */
export function waveformBounds(traces: ReadonlyArray<Pick<Trace, "values">>): WaveformBounds {
  let rawMin = 0;
  let rawMax = 0;

  for (const trace of traces) {
    for (const value of trace.values) {
      if (!Number.isFinite(value)) continue;
      if (value < rawMin) rawMin = value;
      if (value > rawMax) rawMax = value;
    }
  }

  const span = rawMax - rawMin || 1;
  return {
    min: rawMin - span * 0.08,
    max: rawMax + span * 0.08,
  };
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
