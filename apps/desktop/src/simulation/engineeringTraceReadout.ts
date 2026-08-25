import type { Trace, TraceUnit } from "./linearTransient";
import { classifySignal, noiseFloorForUnit, traceStatistics, windowedTraceStatistics, type SignalClassification } from "./measurementModel";

export interface TraceReadoutCursor {
  /** Cursor position on the trace's horizontal time axis. */
  time: number;
  /**
   * Optional value supplied by the plot's cursor engine. When omitted, the
   * readout linearly interpolates between the adjacent finite samples.
   */
  value?: number;
  /** Short instrument label, for example "C1" or "A". */
  label?: string;
}

export interface EngineeringTraceReadoutModel {
  traceId: string;
  label: string;
  unit: TraceUnit;
  minimum: number;
  maximum: number;
  average: number;
  rms: number;
  final: number;
  peakToPeak: number;
  visibleWindow?: { tMin: number; tMax: number; peakToPeak: number };
  classification: SignalClassification;
  frequency?: number;
  period?: number;
  cursor?: {
    label: string;
    time: number;
    value: number;
  };
}

/**
 * Read a waveform at an arbitrary time using the same straight-line segments
 * shown by Tau's scope. Out-of-domain and non-finite samples remain unavailable
 * instead of being silently clamped or fabricated as zero.
 */
export function interpolateTraceValue(
  times: readonly number[],
  values: readonly number[],
  time: number,
): number | null {
  if (!Number.isFinite(time)) return null;
  const count = Math.min(times.length, values.length);
  if (count === 0) return null;

  for (let index = 0; index < count; index += 1) {
    const sampleTime = times[index];
    const sampleValue = values[index];
    if (!Number.isFinite(sampleTime)) continue;
    if (sampleTime === time) return Number.isFinite(sampleValue) ? sampleValue : null;
    if (sampleTime > time) {
      if (index === 0) return null;
      const previousTime = times[index - 1];
      const previousValue = values[index - 1];
      if (
        !Number.isFinite(previousTime)
        || !Number.isFinite(previousValue)
        || !Number.isFinite(sampleValue)
        || !(sampleTime > previousTime)
        || time < previousTime
      ) return null;
      const fraction = (time - previousTime) / (sampleTime - previousTime);
      return previousValue + fraction * (sampleValue - previousValue);
    }
  }
  return null;
}

/** Build the compact engineering summary consumed by waveform headers. */
export function buildEngineeringTraceReadout(
  trace: Pick<Trace, "id" | "label" | "unit" | "values">,
  times: readonly number[],
  cursor?: TraceReadoutCursor,
  visibleWindow?: { tMin: number; tMax: number },
): EngineeringTraceReadoutModel | null {
  const statistics = traceStatistics(times, trace.values);
  if (!statistics) return null;
  const classification = classifySignal(times, trace.values, noiseFloorForUnit(trace.unit));
  const cursorValue = cursor
    ? Number.isFinite(cursor.value)
      ? cursor.value!
      : interpolateTraceValue(times, trace.values, cursor.time)
    : null;
  const visibleStats = visibleWindow
    ? windowedTraceStatistics(times, trace.values, visibleWindow.tMin, visibleWindow.tMax)
    : null;

  return {
    traceId: trace.id,
    label: trace.label,
    unit: trace.unit,
    minimum: statistics.min,
    maximum: statistics.max,
    average: statistics.average,
    rms: statistics.rms,
    final: statistics.final,
    peakToPeak: statistics.max - statistics.min,
    visibleWindow: visibleStats && visibleWindow
      ? { tMin: visibleWindow.tMin, tMax: visibleWindow.tMax, peakToPeak: visibleStats.max - visibleStats.min }
      : undefined,
    classification,
    frequency: classification.frequency,
    period: classification.period,
    cursor: cursor && cursorValue !== null
      ? { label: cursor.label?.trim() || "Cursor", time: cursor.time, value: cursorValue }
      : undefined,
  };
}
