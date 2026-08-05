// Arbitrary-expression traces for the noise pane (LTspice parity).
//
// A `.noise` result exposes exactly two densities — `V(onoise)` and
// `V(inoise)` — via {@link noiseResultToWaveform}. Reuse the transient
// expression compiler (`compileExpr`) so legend math (`abs(V(onoise))`,
// `db(V(inoise))`, …) and `.meas noise` stay on one evaluator.

import { type FuncDef, type Scope } from "./expr";
import { compileExpr } from "./measure";
import { noiseResultToWaveform } from "./measureNoise";
import type { NoiseResult } from "./noise";

export interface NoiseExprTrace {
  id: string;
  label: string;
  values: number[];
}

export type PlotNoiseExpressionResult =
  | { ok: true; trace: NoiseExprTrace }
  | { ok: false; error: string };

/**
 * Evaluate `expr` (e.g. `abs(V(onoise))`, `db(V(inoise))`) against a successful
 * noise analysis, sampling it at every swept frequency. Fails when the
 * expression is empty, the result is missing / failed, or no finite sample
 * resolves.
 */
export function evaluateNoisePlotExpression(
  expr: string,
  result: NoiseResult | null,
  scope: Scope = {},
  funcs: Record<string, FuncDef> = {},
): PlotNoiseExpressionResult {
  const trimmed = expr.trim();
  if (!trimmed) return { ok: false, error: "Enter an expression to plot." };
  if (!result || !result.ok) return { ok: false, error: "Run a noise analysis first." };

  const wf = noiseResultToWaveform(result);
  const compiled = compileExpr(trimmed, wf, scope, funcs);

  const values: number[] = new Array(wf.times.length);
  let anyFinite = false;
  for (let i = 0; i < wf.times.length; i++) {
    const v = compiled.at(i);
    values[i] = v;
    if (Number.isFinite(v)) anyFinite = true;
  }
  if (!anyFinite) {
    return { ok: false, error: `“${trimmed}” has no finite values - check the signal names.` };
  }

  return {
    ok: true,
    trace: { id: `expr:${trimmed}`, label: trimmed, values },
  };
}
