/**
 * Pure measurement model for the simulator dashboard.
 *
 * It turns a successful transient result into per-component voltage, current,
 * and instantaneous-power series, then attaches the same statistics and signal
 * classification used for ordinary plot traces.  Keeping this outside React
 * makes the electrical polarity and summary maths independently testable.
 */

import type { ComponentKind } from "../schematic/types";
import type { AnalysisResult, TraceUnit } from "./linearTransient";

type SuccessResult = Extract<AnalysisResult, { ok: true }>;

export interface TraceStatistics {
  min: number;
  max: number;
  average: number;
  rms: number;
  final: number;
}

export type SignalClass = "steady" | "transient" | "periodic";

export interface SignalClassification {
  kind: SignalClass;
  /** Estimated period/frequency from rising mean crossings, for periodic data. */
  period?: number;
  frequency?: number;
}

export interface MeasuredSeries {
  id: string;
  label: string;
  unit: TraceUnit;
  /** Bounded samples for the UI sparkline; full native vectors are never retained. */
  values: number[];
  statistics: TraceStatistics;
  classification: SignalClassification;
}

export interface ComponentMeasurement {
  componentId: string;
  ref: string;
  kind: ComponentKind;
  voltage?: MeasuredSeries;
  current?: MeasuredSeries;
  power?: MeasuredSeries;
}

/**
 * Summarize finite samples. AVG and RMS are trapezoidal, hence correct for the
 * non-uniform time vectors produced by ngspice rather than biased by sample
 * density. Isolated/single samples fall back to ordinary sample statistics.
 */
export function traceStatistics(times: readonly number[], values: readonly number[]): TraceStatistics | null {
  const count = Math.min(times.length, values.length);
  let min = Infinity;
  let max = -Infinity;
  let validCount = 0;
  let sampleSum = 0;
  let sampleSquareSum = 0;
  let final = Number.NaN;
  for (let i = 0; i < count; i++) {
    if (!Number.isFinite(times[i]) || !Number.isFinite(values[i])) continue;
    validCount += 1;
    sampleSum += values[i];
    sampleSquareSum += values[i] * values[i];
    final = values[i];
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
  }
  if (validCount === 0) return null;

  let duration = 0;
  let integral = 0;
  let squareIntegral = 0;
  for (let i = 1; i < count; i++) {
    const dt = times[i] - times[i - 1];
    const a = values[i - 1];
    const b = values[i];
    if (!(dt > 0) || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    duration += dt;
    integral += ((a + b) / 2) * dt;
    squareIntegral += ((a * a + b * b) / 2) * dt;
  }

  const sampleAverage = sampleSum / validCount;
  const sampleRms = Math.sqrt(sampleSquareSum / validCount);
  return {
    min,
    max,
    average: duration > 0 ? integral / duration : sampleAverage,
    rms: duration > 0 ? Math.sqrt(squareIntegral / duration) : sampleRms,
    final,
  };
}

/**
 * Classify a trace as constant/steady, repeating, or a one-shot transient.
 * Periodicity is intentionally based on interpolated rising mean crossings:
 * it works for sine, square, and clipped circuit waveforms without treating a
 * large DC offset as the oscillation threshold. Three stable periods are
 * required, which avoids labelling a single overshoot as periodic.
 */
export function classifySignal(times: readonly number[], values: readonly number[]): SignalClassification {
  const count = Math.min(times.length, values.length);
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let validCount = 0;
  for (let i = 0; i < count; i++) {
    const t = times[i];
    const v = values[i];
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    validCount += 1;
  }
  if (validCount < 2) return { kind: "steady" };
  const range = max - min;
  const scale = Math.max(Math.abs(min), Math.abs(max));
  if (range <= Math.max(scale * 1e-9, 1e-30)) return { kind: "steady" };

  const mean = sum / validCount;
  const crossings: number[] = [];
  let previousTime: number | null = null;
  let previousValue: number | null = null;
  for (let i = 0; i < count; i++) {
    const time = times[i];
    const value = values[i];
    if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
    if (previousTime !== null && previousValue !== null && previousValue < mean && value >= mean && time > previousTime) {
      const fraction = (mean - previousValue) / (value - previousValue);
      crossings.push(previousTime + fraction * (time - previousTime));
    }
    previousTime = time;
    previousValue = value;
  }

  if (crossings.length >= 4) {
    const periods = crossings.slice(1).map((crossing, i) => crossing - crossings[i]).filter((p) => p > 0);
    const ordered = [...periods].sort((a, b) => a - b);
    const period = ordered[Math.floor(ordered.length / 2)];
    let maxRelativeError = 0;
    for (const candidate of periods) {
      maxRelativeError = Math.max(maxRelativeError, Math.abs(candidate - period) / period);
    }
    // Stable crossing intervals alone also describe a damped ringing transient.
    // Require broadly stable amplitude between the first and second halves.
    const halfway = Math.floor(count / 2);
    const halfRange = (start: number, end: number): number => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = start; i < end; i++) {
        if (!Number.isFinite(times[i]) || !Number.isFinite(values[i])) continue;
        if (values[i] < lo) lo = values[i];
        if (values[i] > hi) hi = values[i];
      }
      return hi - lo;
    };
    const earlyRange = halfRange(0, halfway);
    const lateRange = halfRange(halfway, count);
    const amplitudeRatio = Math.min(earlyRange, lateRange) / Math.max(earlyRange, lateRange);
    if (Number.isFinite(period) && period > 0 && maxRelativeError <= 0.08 && amplitudeRatio >= 0.75) {
      return { kind: "periodic", period, frequency: 1 / period };
    }
  }
  return { kind: "transient" };
}

const TERMINAL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["a", "b"],
  ["a", "k"],
  ["p", "n"],
  ["op", "on"],
  ["d", "s"],
  ["c", "e"],
  ["out", "com"],
  ["q", "com"],
];

function terminalPair(pins: Record<string, string>): readonly [string, string] | null {
  for (const [positive, negative] of TERMINAL_PAIRS) {
    if (pins[positive] !== undefined && pins[negative] !== undefined) return [pins[positive], pins[negative]];
  }
  return null;
}

function makeSeries(
  times: readonly number[],
  id: string,
  label: string,
  unit: TraceUnit,
  values: number[],
): MeasuredSeries | undefined {
  const statistics = traceStatistics(times, values);
  if (!statistics) return undefined;
  return {
    id,
    label,
    unit,
    values: decimateFinite(values, 96),
    statistics,
    classification: classifySignal(times, values),
  };
}

function decimateFinite(values: readonly number[], maxSamples: number): number[] {
  if (values.length <= maxSamples) return values.filter(Number.isFinite);
  const out: number[] = [];
  const step = (values.length - 1) / (maxSamples - 1);
  for (let i = 0; i < maxSamples; i++) {
    const value = values[Math.round(i * step)];
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

/** Build one measurement row per labelled schematic component. */
export function componentMeasurements(result: SuccessResult): ComponentMeasurement[] {
  const voltageByNet = new Map(result.traces.map((trace) => [trace.id, trace.values]));
  // Older/imported result fixtures may not carry extracted-circuit detail;
  // telemetry degrades to an empty table instead of taking down the viewer.
  const nets = result.circuit?.nets ?? [];
  const circuitComponents = result.circuit?.components ?? [];
  const groundNets = new Set(nets.filter((net) => net.isGround).map((net) => net.id));
  const currentByRef = new Map(result.currents.map((trace) => [trace.ref.toLowerCase(), trace.values]));
  const zeros = new Array(result.times.length).fill(0) as number[];
  const netValues = (net: string): readonly number[] | null => {
    if (net === "0" || groundNets.has(net)) return zeros;
    return voltageByNet.get(net) ?? null;
  };

  const rows: ComponentMeasurement[] = [];
  for (const { component, pins } of circuitComponents) {
    if (!component.label) continue;
    const ref = component.label;
    const row: ComponentMeasurement = { componentId: component.id, ref, kind: component.kind };

    const pair = terminalPair(pins);
    let voltageValues: number[] | null = null;
    if (pair) {
      const positive = netValues(pair[0]);
      const negative = netValues(pair[1]);
      if (positive && negative) {
        voltageValues = result.times.map((_, i) =>
          Number.isFinite(positive[i]) && Number.isFinite(negative[i]) ? positive[i] - negative[i] : Number.NaN,
        );
        row.voltage = makeSeries(result.times, `V(${ref})`, `V(${ref})`, "V", voltageValues);
      }
    }

    const rawCurrent = currentByRef.get(ref.toLowerCase());
    const currentSign = component.kind === "isource" || component.kind === "iac" ? -1 : 1;
    const passiveCurrent = rawCurrent?.map((value) => value * currentSign);
    if (passiveCurrent) row.current = makeSeries(result.times, `I(${ref})`, `I(${ref})`, "A", passiveCurrent);
    if (voltageValues && passiveCurrent) {
      const power = voltageValues.map((voltage, i) =>
        Number.isFinite(voltage) && Number.isFinite(passiveCurrent[i])
          ? voltage * passiveCurrent[i]
          : Number.NaN,
      );
      row.power = makeSeries(result.times, `P(${ref})`, `P(${ref})`, "W", power);
    }
    rows.push(row);
  }
  return rows;
}
