// LTspice `.meas noise` directive support for noise-analysis results.
//
// A noise analysis yields two real-valued spectral densities versus frequency:
// the output-referred noise `V(onoise)` and the input-referred noise
// `V(inoise)`. LTspice exposes exactly those two trace names in `.meas noise`
// (and on the noise plot), so we adapt a NoiseResult into a MeasWaveform whose
// axis is frequency and whose two traces are `onoise`/`inoise`, then reuse the
// transient measurement core. Examples (over a `.noise V(out) V1 dec 10 1 1Meg`):
//   .meas noise nfloor  MIN V(onoise)
//   .meas noise n1k     FIND V(onoise) AT=1k
//   .meas noise corner  WHEN V(onoise)=10n
//
// Only directives explicitly typed `noise` are evaluated here.

import { type FuncDef, type Scope } from "./expr";
import {
  evaluateMeasurement,
  parseMeasDirective,
  type MeasResult,
  type MeasWaveform,
} from "./measure";
import type { NoiseResult } from "./noise";

/**
 * Adapt a successful {@link NoiseResult} into a {@link MeasWaveform}: frequency
 * becomes the axis and the two spectral densities become `onoise`/`inoise`
 * traces (resolvable as `V(onoise)`/`V(inoise)`).
 */
export function noiseResultToWaveform(result: Extract<NoiseResult, { ok: true }>): MeasWaveform {
  return {
    times: result.freqs,
    traces: [
      { id: "onoise", label: "onoise", values: result.onoise },
      { id: "inoise", label: "inoise", values: result.inoise },
    ],
  };
}

/**
 * Run every `.meas noise` directive against a noise result, in order, so later
 * measurements can reference earlier ones by name. A failed analysis yields no
 * measurements.
 */
export function runNoiseMeasurements(
  directives: ReadonlyArray<string>,
  result: NoiseResult,
  scope: Scope = {},
  funcs: Record<string, FuncDef> = {},
): MeasResult[] {
  if (!result.ok) return [];
  const wf = noiseResultToWaveform(result);
  const running: Scope = { ...scope };
  const results: MeasResult[] = [];
  for (const line of directives) {
    const spec = parseMeasDirective(line);
    if (!spec || spec.analysis !== "noise") continue;
    const r = evaluateMeasurement(spec, wf, running, funcs);
    results.push(r);
    if (r.value !== null && Number.isFinite(r.value)) {
      running[spec.name.toLowerCase()] = r.value;
    }
  }
  return results;
}
