import { transformerWindings } from "../engine/spiceNetlist";
import { motorArmature, relayCoilOhms } from "../schematic/kindGroups";
import type { SchematicComponent } from "../schematic/types";
import {
  type AnalysisOptions,
  MAX_TRANSIENT_STEPS,
  MIN_SAMPLES_PER_CYCLE,
  periodicSourceFrequencyHz,
} from "./linearTransient";
import { parseQuantity } from "./quantity";

/**
 * automatic transient resolution.
 *
 * "Tau automatically chooses simulation settings unless overridden": infer a
 * transient window + step count from the circuit's own RC/RL time constants
 * and its periodic-source frequencies, so a plain Run shows the waveform
 * shape without manual duration/output-point tuning.
 *
 * DOCUMENTED HEURISTIC (not a full pole/zero analysis):
 * - Time constants: every capacitor contributes τ = C·R_typ and every
 *   inductor τ = L/R_typ, where R_typ is the geometric mean of the circuit's
 *   resistor values (1 kΩ when there are no resistors). This ignores the
 *   actual topology - a deliberate simplification; series/parallel structure
 *   would need per-node Thévenin resistances.
 * - Composite parts count as the R/L/C the deck expands them into, read back
 *   through the emitter's own parser so the heuristic and the netlist can
 *   never disagree about what a part is: motor → armature R + L
 *   (`motorArmature`), relay → coil R (`relayCoilOhms`), transformer and
 *   ctTransformer → winding inductances (`transformerWindings`), bulb →
 *   filament R (it shares the resistor branch, exactly as it shares the R
 *   device in the deck).
 * - NOT counted. A limitation is only documented if it is named, so each
 *   remaining hole is listed here with the reason it stays open:
 *   · `tline` - the deck emits a native lossless-line T device, not an R/L/C
 *     expansion. Its `TD` is a propagation delay, not a settling exponential;
 *     folding it into the τ pool would either collapse the window to
 *     nanoseconds or invent a round-trip multiple that nothing measures.
 *   · Static contacts (`switch` / `pushButton` / `spdt` left on a fixed
 *     open/closed state) - the deck stands them in as 1 mΩ / 1 TΩ ideal
 *     contacts. Those numbers describe the contact, not the circuit's
 *     impedance, and either one would move the geometric mean by orders of
 *     magnitude.
 *   · `Rser=` / `Rpar=` / `Cpar=` parasitics on capacitor and inductor values
 *     - the deck expands real companion elements for these, but only the
 *     leading value token is read here. Milliohm ESRs pulled into the
 *     geometric mean would drag R_typ far below any real load resistance and
 *     inflate every RC τ in the circuit.
 *   · Macromodel and model-card internals - the R/C inside `opamp`,
 *     `comparator`, `timer555` and the digital parts, junction capacitances
 *     on `.model` cards, and everything inside a `subckt` body. None of that
 *     is reachable from a component value string, so it needs a different
 *     mechanism (reading the built deck back), not a wider scan.
 * - Window: long enough to show 5 cycles of the SLOWEST periodic source and
 *   the settling of the slowest time constant (7·τ ≈ settle to <0.1%),
 *   whichever is longer.
 * - Steps: dense enough for the `detail` level's samples/cycle on the FASTEST
 *   source and its samples per fastest time constant, floored at that
 *   level's minimum point count and capped at the solver's step limit. If
 *   the cap binds, the window shrinks so per-cycle density is preserved
 *   (shape over duration).
 */

const DEFAULT_STOP_TIME_S = 0.006;
const FALLBACK_R_OHMS = 1_000;
const CYCLES_OF_SLOWEST = 5;
const SETTLE_TAU_MULTIPLE = 7;

/** First whitespace token of a component value, so `100p IC=1` parses as
 *  100p; NaN (a skip, never a throw) when the token is unparsable. */
const leadingQuantity = (value: string, unit: string): number => {
  try {
    return parseQuantity(value.trim().split(/\s+/)[0] ?? "", unit);
  } catch {
    return NaN;
  }
};

export interface AutoResolutionInputs {
  /** Fastest periodic-source frequency (Hz), 0 when all sources are DC. */
  maxSourceHz: number;
  /** Slowest periodic-source frequency (Hz), 0 when all sources are DC. */
  minSourceHz: number;
  /** Slowest estimated time constant (s), 0 when there are no C/L parts. */
  maxTauSeconds: number;
  /** Fastest estimated time constant (s), 0 when there are no C/L parts. */
  minTauSeconds: number;
}

export type TransientDetailLevel = "quick" | "balanced" | "precision";

const DETAIL_PROFILES: Record<TransientDetailLevel, {
  minimumPoints: number;
  samplesPerCycle: number;
  samplesPerFastestTau: number;
}> = {
  quick: { minimumPoints: 32, samplesPerCycle: MIN_SAMPLES_PER_CYCLE, samplesPerFastestTau: 2 },
  balanced: { minimumPoints: 240, samplesPerCycle: MIN_SAMPLES_PER_CYCLE * 2, samplesPerFastestTau: 4 },
  precision: { minimumPoints: 480, samplesPerCycle: MIN_SAMPLES_PER_CYCLE * 4, samplesPerFastestTau: 8 },
};

/**
 * Translate the UI's engineer-facing waveform-detail choice into the exact
 * output point count SPICE needs. This is deliberately about plotted temporal
 * detail, not a promise about solver wall-clock time or convergence accuracy.
 */
export function transientDetailSteps(
  inputs: AutoResolutionInputs,
  stopTime: number,
  detail: TransientDetailLevel,
  maxSteps = MAX_TRANSIENT_STEPS,
): number {
  const profile = DETAIL_PROFILES[detail];
  const ceilSafe = (value: number) => Math.ceil(value * (1 - 1e-12));
  let steps = profile.minimumPoints;
  if (inputs.maxSourceHz > 0) {
    steps = Math.max(steps, ceilSafe(stopTime * inputs.maxSourceHz * profile.samplesPerCycle));
  }
  if (inputs.minTauSeconds > 0) {
    steps = Math.max(steps, ceilSafe((stopTime / inputs.minTauSeconds) * profile.samplesPerFastestTau));
  }
  return Math.min(maxSteps, steps);
}

/** Scan the schematic for the frequency/time-constant figures the heuristic
 *  needs. Malformed or non-positive values are skipped, never thrown - auto
 *  mode must degrade to the defaults, not block a run. */
export function collectAutoResolutionInputs(
  components: readonly SchematicComponent[],
): AutoResolutionInputs {
  let maxSourceHz = 0;
  let minSourceHz = Infinity;
  const resistances: number[] = [];
  const taus: { kind: "C" | "L"; value: number }[] = [];

  for (const component of components) {
    if (component.kind === "resistor" || component.kind === "bulb" || component.kind === "potentiometer") {
      const r = leadingQuantity(component.value, "Ω");
      if (Number.isFinite(r) && r > 0) resistances.push(r);
      continue;
    }
    if (component.kind === "capacitor" || component.kind === "polarizedCapacitor") {
      const c = leadingQuantity(component.value, "F");
      if (Number.isFinite(c) && c > 0) taus.push({ kind: "C", value: c });
      continue;
    }
    if (component.kind === "inductor") {
      const l = leadingQuantity(component.value, "H");
      if (Number.isFinite(l) && l > 0) taus.push({ kind: "L", value: l });
      continue;
    }
    // Composite parts below are not primitives in the deck: `case "motor"` and
    // its neighbours in ../engine/spiceNetlist.ts expand each one into ordinary
    // R/L/C devices, so the circuit ngspice actually solves has time constants
    // a kind-only scan never sees. Each branch therefore reads the values back
    // through the *same* parser the emitter calls instead of re-parsing the
    // value string - that is what keeps the heuristic pointed at the netlist
    // rather than at a second, drifting interpretation of the same text.
    if (component.kind === "motor") {
      // A motor is series armature R + L, so 100 V DC into "10 1m" is a
      // first-order L/R step with τ = 100 µs. Missing that made a DC-motor
      // circuit look memoryless: it took the 6 ms default window and hid the
      // entire inrush inside the first 2% of the plot.
      const armature = motorArmature(component.value);
      if (armature.resistance > 0) resistances.push(armature.resistance);
      if (armature.inductance > 0) taus.push({ kind: "L", value: armature.inductance });
      continue;
    }
    if (component.kind === "relay") {
      // The coil is a plain resistor between COIL+/COIL-; the contact is a
      // voltage-controlled switch, which carries no impedance of its own. The
      // coil resistance is therefore the relay's whole contribution here.
      const coil = relayCoilOhms(component.value);
      if (coil > 0) resistances.push(coil);
      continue;
    }
    if (component.kind === "transformer" || component.kind === "ctTransformer") {
      // Both kinds emit coupled inductors: L1 plus either the full secondary
      // or, center-tapped, two half-windings of L2/4 (L ∝ N²). Counting the
      // winding inductances the way the standalone inductor branch counts L
      // inherits that branch's topology blindness - coupling k is ignored, so
      // this represents the magnetizing τ and not the faster leakage τ.
      // `transformerWindings` throws on a malformed `L1=`/`L2=`/`k=` field;
      // auto mode degrades to the defaults rather than blocking a run, and the
      // run itself reports the bad value.
      let windings: ReturnType<typeof transformerWindings>;
      try {
        windings = transformerWindings(component.value);
      } catch {
        continue;
      }
      if (windings.primary > 0) taus.push({ kind: "L", value: windings.primary });
      const secondary = component.kind === "ctTransformer" ? windings.secondary / 4 : windings.secondary;
      if (secondary > 0) taus.push({ kind: "L", value: secondary });
      continue;
    }
    let frequency: number | null = null;
    try {
      frequency = periodicSourceFrequencyHz(component);
    } catch {
      frequency = null; // malformed source value - the run itself will report it
    }
    if (frequency !== null && Number.isFinite(frequency) && frequency > 0) {
      maxSourceHz = Math.max(maxSourceHz, frequency);
      minSourceHz = Math.min(minSourceHz, frequency);
    }
  }

  const rTyp =
    resistances.length > 0
      ? Math.exp(resistances.reduce((sum, r) => sum + Math.log(r), 0) / resistances.length)
      : FALLBACK_R_OHMS;
  let maxTauSeconds = 0;
  let minTauSeconds = Infinity;
  for (const entry of taus) {
    const tau = entry.kind === "C" ? entry.value * rTyp : entry.value / rTyp;
    maxTauSeconds = Math.max(maxTauSeconds, tau);
    minTauSeconds = Math.min(minTauSeconds, tau);
  }

  return {
    maxSourceHz,
    minSourceHz: Number.isFinite(minSourceHz) ? minSourceHz : 0,
    maxTauSeconds,
    minTauSeconds: Number.isFinite(minTauSeconds) ? minTauSeconds : 0,
  };
}

/** Pure core of the heuristic, unit-testable on hand-computed inputs. */
export function autoTransientOptions(
  inputs: AutoResolutionInputs,
  detail: TransientDetailLevel = "balanced",
): AnalysisOptions {
  const { maxSourceHz, minSourceHz, maxTauSeconds, minTauSeconds } = inputs;
  const profile = DETAIL_PROFILES[detail];

  const windowCandidates: number[] = [];
  if (minSourceHz > 0) windowCandidates.push(CYCLES_OF_SLOWEST / minSourceHz);
  if (maxTauSeconds > 0) windowCandidates.push(SETTLE_TAU_MULTIPLE * maxTauSeconds);
  if (windowCandidates.length === 0) return { stopTime: DEFAULT_STOP_TIME_S, steps: profile.minimumPoints };
  let stopTime = Math.max(...windowCandidates);

  // ceil with a relative epsilon so float artifacts (0.007/1e-6 →
  // 7000.000000000001) don't manufacture an extra step.
  const ceilSafe = (x: number) => Math.ceil(x * (1 - 1e-12));
  const stepsFor = (window: number): number => {
    let required = profile.minimumPoints;
    if (maxSourceHz > 0) required = Math.max(required, ceilSafe(window * maxSourceHz * profile.samplesPerCycle));
    if (minTauSeconds > 0) required = Math.max(required, ceilSafe((window / minTauSeconds) * profile.samplesPerFastestTau));
    return required;
  };

  let steps = stepsFor(stopTime);
  if (steps > MAX_TRANSIENT_STEPS) {
    // The cap binds: keep sample density (waveform shape) and give up window
    // length instead, but never show less than one cycle of the slowest source.
    const density = steps / stopTime; // samples per second the circuit wants
    stopTime = MAX_TRANSIENT_STEPS / density;
    if (minSourceHz > 0) stopTime = Math.max(stopTime, 1 / minSourceHz);
    steps = Math.min(MAX_TRANSIENT_STEPS, stepsFor(stopTime));
  }

  return { stopTime, steps };
}

/** Auto transient options for a schematic (the one-call form the app uses). */
export function suggestTransientOptions(
  components: readonly SchematicComponent[],
  detail: TransientDetailLevel = "balanced",
): AnalysisOptions {
  return autoTransientOptions(collectAutoResolutionInputs(components), detail);
}

export interface AcSweepDefaults {
  startHz: number;
  stopHz: number;
  pointsPerDecade: number;
}

/** AC sweep defaults centered on the circuit's own source frequencies: two
 *  decades below the slowest and two above the fastest, snapped outward to
 *  clean decades, with the classic 10 Hz-1 MHz when every source is DC. */
export function suggestAcSweep(components: readonly SchematicComponent[]): AcSweepDefaults {
  const { minSourceHz, maxSourceHz } = collectAutoResolutionInputs(components);
  if (maxSourceHz <= 0) return { startHz: 10, stopHz: 1e6, pointsPerDecade: 20 };
  const startHz = Math.max(1e-3, 10 ** Math.floor(Math.log10(minSourceHz) - 2));
  const stopHz = 10 ** Math.ceil(Math.log10(maxSourceHz) + 2);
  return { startHz, stopHz, pointsPerDecade: 20 };
}
