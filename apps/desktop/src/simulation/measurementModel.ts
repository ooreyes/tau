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
import { formatEngineering } from "./quantity";
import { findCurrentTrace } from "./currents";

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
  advisories?: ComponentAdvisory[];
}

export interface ComponentAdvisory {
  kind: "direct-led-drive";
  severity: "warning";
  title: string;
  message: string;
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
 * Absolute "this is solver noise, not signal" floor per physical quantity,
 * matching the tolerances a SPICE engine itself converges to (ngspice's
 * `abstol` 1 pA and `vntol` 1 µV, loosened one decade for headroom).
 *
 * A purely relative tolerance is not enough. For a dead 5 pA leakage current,
 * `scale * 1e-9` is 5e-21 A - far below double-precision noise - so femtoamp
 * jitter got classified as signal, and the period detector then invented a
 * frequency for it (a 15.9 kHz "oscillation" on a physically dead node).
 * Below these floors a quantity is indistinguishable from zero movement.
 */
const SIGNAL_NOISE_FLOOR: Record<TraceUnit, number> = {
  A: 1e-12,
  V: 1e-9,
  // Power is a product of the two, so its floor is their product.
  W: 1e-15,
  "Ω": 0,
  S: 0,
  "": 0,
};

export function noiseFloorForUnit(unit: TraceUnit | undefined): number {
  return unit ? SIGNAL_NOISE_FLOOR[unit] ?? 0 : 0;
}

/**
 * Classify a trace as constant/steady, repeating, or a one-shot transient.
 *
 * Periodicity uses interpolated mean crossings in both directions so a single
 * clean cycle (e.g. 10 Hz over 100 ms) still yields a period estimate: rising
 * crossings alone need ≥2 full cycles for one interval, while half-periods from
 * rise+fall crossings resolve one cycle. Amplitude must stay broadly stable so
 * a single overshoot or damped ring is not labelled periodic.
 */
export function classifySignal(
  times: readonly number[],
  values: readonly number[],
  /** Absolute floor below which movement is noise. See SIGNAL_NOISE_FLOOR. */
  absoluteFloor = 0,
): SignalClassification {
  const count = Math.min(times.length, values.length);
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let validCount = 0;
  let firstTime = Number.NaN;
  let lastTime = Number.NaN;
  for (let i = 0; i < count; i++) {
    const t = times[i];
    const v = values[i];
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    validCount += 1;
    if (!Number.isFinite(firstTime)) firstTime = t;
    lastTime = t;
  }
  if (validCount < 2) return { kind: "steady" };
  const range = max - min;
  const scale = Math.max(Math.abs(min), Math.abs(max));
  if (range <= Math.max(scale * 1e-9, absoluteFloor, 1e-30)) return { kind: "steady" };

  const mean = sum / validCount;
  const crossings: Array<{ time: number; direction: "rising" | "falling" }> = [];
  let previousTime: number | null = null;
  let previousValue: number | null = null;
  for (let i = 0; i < count; i++) {
    const time = times[i];
    const value = values[i];
    if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
    if (
      previousTime !== null
      && previousValue !== null
      && time > previousTime
      && previousValue !== mean
      && value !== mean
      && (previousValue - mean) * (value - mean) < 0
    ) {
      const fraction = (mean - previousValue) / (value - previousValue);
      crossings.push({
        time: previousTime + fraction * (time - previousTime),
        direction: value > previousValue ? "rising" : "falling",
      });
    }
    previousTime = time;
    previousValue = value;
  }

  // Same-direction crossings are one full period apart regardless of waveform
  // duty cycle. Alternating rise/fall intervals are not interchangeable for a
  // pulse train (20% duty produces 0.2T and 0.8T), so using their median as a
  // half-period both rejected PWM and biased its reported frequency.
  if (crossings.length >= 2) {
    const directionalPeriods = (["rising", "falling"] as const).flatMap((direction) => {
      const selected = crossings.filter((crossing) => crossing.direction === direction);
      return selected.slice(1)
        .map((crossing, i) => crossing.time - selected[i].time)
        .filter((period) => period > 0);
    });
    const halfPeriods = crossings.slice(1)
      .map((crossing, i) => crossing.time - crossings[i].time)
      .filter((period) => period > 0);
    const periodCandidates = directionalPeriods.length > 0 ? directionalPeriods : halfPeriods.map((half) => 2 * half);
    const singleHalfPeriodFallback = directionalPeriods.length === 0 && halfPeriods.length === 1;
    if (periodCandidates.length >= 1) {
      const ordered = [...periodCandidates].sort((a, b) => a - b);
      const period = ordered[Math.floor(ordered.length / 2)];
      let maxRelativeError = 0;
      for (const candidate of periodCandidates) {
        maxRelativeError = Math.max(maxRelativeError, Math.abs(candidate - period) / period);
      }
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
      const duration = lastTime - firstTime;
      const cyclesInWindow = period > 0 && duration > 0 ? duration / period : 0;
      const stableIntervals = directionalPeriods.length > 0 && maxRelativeError <= 0.08;
      const singleCycleOk = singleHalfPeriodFallback
        && maxRelativeError <= 0.08
        && amplitudeRatio >= 0.85
        && cyclesInWindow >= 0.75
        && cyclesInWindow <= 1.6;
      if (
        Number.isFinite(period)
        && period > 0
        && amplitudeRatio >= 0.75
        && (stableIntervals || singleCycleOk)
      ) {
        return { kind: "periodic", period, frequency: 1 / period };
      }
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

interface OrientedBranch {
  componentId: string;
  positiveNet: string;
  negativeNet: string;
}

interface BranchIncidence {
  branch: OrientedBranch;
  /** +1 at the positive terminal and -1 at the negative terminal. */
  sign: 1 | -1;
}

/**
 * Fill branch currents that are exactly determined by KCL at an unbranched
 * two-pin net. ngspice normally retains source/inductor branch vectors but not
 * semiconductor currents in a transient plot. In a source-LED loop, for
 * example, the source current therefore proves the LED current sample-for-
 * sample. We deliberately do not guess at a branched node or a net containing
 * a multi-terminal device.
 */
function deriveSeriesBranchCurrents(
  circuitComponents: SuccessResult["circuit"]["components"],
  currentsByComponentId: Map<string, number[]>,
): Map<string, number[]> {
  const branches: OrientedBranch[] = [];
  const pinCountByNet = new Map<string, number>();

  for (const { component, pins } of circuitComponents) {
    // Ground/test-point symbols name or observe a net; they are not conductive
    // branches and therefore do not make an otherwise two-branch node a KCL
    // junction.
    if (component.kind !== "ground" && component.kind !== "testpoint") {
      for (const net of Object.values(pins)) {
        pinCountByNet.set(net, (pinCountByNet.get(net) ?? 0) + 1);
      }
    }
    // A voltage polarity can be meaningful across one pair of a transistor,
    // op-amp, or other multi-terminal device, but one terminal current cannot
    // be propagated through that device by series KCL (Ic != Ie when Ib is
    // nonzero). Only components whose extracted circuit truly has two pins
    // participate in exact branch-current inference.
    if (Object.keys(pins).length !== 2) continue;
    const pair = terminalPair(pins);
    if (!pair || pair[0] === pair[1]) continue;
    branches.push({ componentId: component.id, positiveNet: pair[0], negativeNet: pair[1] });
  }

  const incidencesByNet = new Map<string, BranchIncidence[]>();
  const addIncidence = (net: string, incidence: BranchIncidence) => {
    const incidences = incidencesByNet.get(net) ?? [];
    incidences.push(incidence);
    incidencesByNet.set(net, incidences);
  };
  for (const branch of branches) {
    addIncidence(branch.positiveNet, { branch, sign: 1 });
    addIncidence(branch.negativeNet, { branch, sign: -1 });
  }

  // A known current can propagate through a chain of unbranched two-terminal
  // parts, so repeat until a pass adds nothing. The map grows monotonically.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [net, incidences] of incidencesByNet) {
      if (pinCountByNet.get(net) !== 2 || incidences.length !== 2) continue;
      if (incidences[0].branch.componentId === incidences[1].branch.componentId) continue;
      const known = incidences.filter(({ branch }) => currentsByComponentId.has(branch.componentId));
      if (known.length !== 1) continue;
      const missing = incidences.find(({ branch }) => !currentsByComponentId.has(branch.componentId));
      if (!missing) continue;
      const source = currentsByComponentId.get(known[0].branch.componentId);
      if (!source) continue;
      const scale = -(known[0].sign / missing.sign);
      currentsByComponentId.set(missing.branch.componentId, source.map((value) => {
        const inferred = value * scale;
        return inferred === 0 ? 0 : inferred;
      }));
      changed = true;
    }
  }
  return currentsByComponentId;
}

const DIRECT_IDEAL_VOLTAGE_SOURCE_KINDS: ReadonlySet<ComponentKind> = new Set(["vsource", "vac", "vpulse"]);

function sameUnorderedPair(a: readonly [string, string], b: readonly [string, string]): boolean {
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
}

function ledAdvisories(
  entry: SuccessResult["circuit"]["components"][number],
  current: MeasuredSeries | undefined,
  circuitComponents: SuccessResult["circuit"]["components"],
): ComponentAdvisory[] | undefined {
  if (entry.component.kind !== "led" || !current) return undefined;
  const ledPair = terminalPair(entry.pins);
  if (!ledPair) return undefined;
  const source = circuitComponents.find((candidate) => {
    if (!DIRECT_IDEAL_VOLTAGE_SOURCE_KINDS.has(candidate.component.kind)) return false;
    const sourcePair = terminalPair(candidate.pins);
    return sourcePair ? sameUnorderedPair(ledPair, sourcePair) : false;
  });
  const peakCurrent = Math.max(Math.abs(current.statistics.min), Math.abs(current.statistics.max));
  // Direct topology alone is not evidence of high current: a reverse-biased or
  // sub-threshold LED can legitimately have a completed, zero-current result.
  // Require a real measured/modelled current before surfacing the advisory,
  // while deliberately avoiding an invented device-rating threshold.
  if (!source || !Number.isFinite(peakCurrent) || peakCurrent <= Number.EPSILON) return undefined;

  const sourceName = source.component.label || "ideal voltage source";
  return [{
    kind: "direct-led-drive",
    severity: "warning",
    title: "Direct LED drive · no external limiter",
    message: `${entry.component.label || "LED"} model predicts ${formatEngineering(peakCurrent, "A", 3)} with ${sourceName} directly across it. Tau has no device-rating data for this part, so this is not an overcurrent determination. Add a series resistor or current regulator, then compare against the selected LED rating.`,
  }];
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
    classification: classifySignal(times, values, noiseFloorForUnit(unit)),
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
  // A part's own current, never one of its terminals: a Map built over the
  // whole list would let a BJT's LAST trace - its emitter - stand in for the
  // part, reporting a different number with the opposite sign.
  const passiveCurrentsByComponentId = new Map<string, number[]>();
  for (const { component } of circuitComponents) {
    if (!component.label) continue;
    const rawCurrent = findCurrentTrace(result.currents, component.label)?.values;
    if (!rawCurrent) continue;
    const currentSign = component.kind === "isource" || component.kind === "iac" ? -1 : 1;
    passiveCurrentsByComponentId.set(component.id, rawCurrent.map((value) => value * currentSign));
  }
  deriveSeriesBranchCurrents(circuitComponents, passiveCurrentsByComponentId);
  const zeros = new Array(result.times.length).fill(0) as number[];
  const netValues = (net: string): readonly number[] | null => {
    if (net === "0" || groundNets.has(net)) return zeros;
    return voltageByNet.get(net) ?? null;
  };

  const rows: ComponentMeasurement[] = [];
  for (const entry of circuitComponents) {
    const { component, pins } = entry;
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

    const passiveCurrent = passiveCurrentsByComponentId.get(component.id);
    if (passiveCurrent) row.current = makeSeries(result.times, `I(${ref})`, `I(${ref})`, "A", passiveCurrent);
    if (voltageValues && passiveCurrent) {
      const power = voltageValues.map((voltage, i) =>
        Number.isFinite(voltage) && Number.isFinite(passiveCurrent[i])
          ? voltage * passiveCurrent[i]
          : Number.NaN,
      );
      row.power = makeSeries(result.times, `P(${ref})`, `P(${ref})`, "W", power);
    }
    row.advisories = ledAdvisories(entry, row.current, circuitComponents);
    rows.push(row);
  }
  return rows;
}
