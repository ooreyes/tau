// LTspice `.meas dc` directive support for DC-sweep results.
//
// A DC sweep produces a real-valued node-voltage series indexed by the swept
// source value, so it has exactly the same shape as a transient result with the
// independent axis being the source value instead of time. We therefore reuse
// the transient measurement machinery (`evaluateMeasurement` / `compileExpr`)
// by adapting a DcSweepResult into a MeasWaveform whose `times` carry the swept
// values. Examples (over a `.dc Vin 0 5 0.1` sweep):
//   .meas dc vmax   MAX V(out)
//   .meas dc trip   WHEN V(out)=2.5        ; the Vin value where V(out) hits 2.5
//   .meas dc vat    FIND V(out) AT=3
//   .meas dc gain   PARAM (vmax-vmin)/5
//
// Only directives explicitly typed `dc` are evaluated here; untyped/`tran` ones
// belong to runMeasurements and `ac` ones to runAcMeasurements.

import { type FuncDef, type Scope } from "./expr";
import {
  evaluateMeasurement,
  parseMeasDirective,
  type MeasResult,
  type MeasWaveform,
} from "./measure";
import type { DcSweepResult } from "./dcSweep";

/**
 * Adapt a successful {@link DcSweepResult} into a {@link MeasWaveform}: the
 * swept-source values become the axis and each net's voltage series becomes a
 * trace. Ground nets are kept (a `.meas` could still reference `V(0)`).
 */
export function dcResultToWaveform(result: Extract<DcSweepResult, { ok: true }>): MeasWaveform {
  return {
    times: result.sweep,
    traces: result.nets.map((n) => ({ id: n.id, label: n.label, values: n.voltages })),
  };
}

/**
 * Run every `.meas dc` directive against a DC-sweep result, in order, so later
 * measurements can reference earlier ones by name. A failed sweep yields no
 * measurements.
 */
export function runDcMeasurements(
  directives: ReadonlyArray<string>,
  result: DcSweepResult,
  scope: Scope = {},
  funcs: Record<string, FuncDef> = {},
): MeasResult[] {
  if (!result.ok) return [];
  const wf = dcResultToWaveform(result);
  const running: Scope = { ...scope };
  const results: MeasResult[] = [];
  for (const line of directives) {
    const spec = parseMeasDirective(line);
    if (!spec || spec.analysis !== "dc") continue;
    const r = evaluateMeasurement(spec, wf, running, funcs);
    results.push(r);
    if (r.value !== null && Number.isFinite(r.value)) {
      running[spec.name.toLowerCase()] = r.value;
    }
  }
  return results;
}
