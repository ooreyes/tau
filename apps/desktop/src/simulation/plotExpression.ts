// Arbitrary-expression waveform traces (FEATURE_PARITY §6 "plot arbitrary
// expressions": V(a)-V(b), I(R1)*V(out), power V(out)*I(out)).
//
// LTspice lets you plot any expression of the simulated signals, not just a
// single node. A transient AnalysisResult already carries everything an
// expression needs — node-voltage traces and per-device branch currents — and
// the `.meas` engine already knows how to compile an expression that mixes
// `V(...)`/`I(...)` signals with scalars into a per-sample evaluator. We reuse
// that compiler here to turn an expression string into a derived trace sampled
// at every transient time point, so the same code path drives measurements and
// plotting (no second expression evaluator to keep in sync).

import { type FuncDef, type Scope } from "./expr";
import { compileExpr, type MeasWaveform } from "./measure";
import type { AnalysisResult, Trace } from "./linearTransient";

export type PlotExpressionResult =
  | { ok: true; trace: Trace }
  | { ok: false; error: string };

/** The minimal transient shape an expression trace needs (a subset of AnalysisResult). */
function toWaveform(result: Extract<AnalysisResult, { ok: true }>): MeasWaveform {
  return { times: result.times, traces: result.traces, currents: result.currents };
}

/**
 * Evaluate `expr` (e.g. `V(out)-V(in)`, `V(out)*I(R1)`) against a successful
 * transient result, sampling it at every time point, and return it as a {@link
 * Trace} ready to overlay on the scope. Fails when the expression is empty, the
 * result is not a successful transient, or the expression resolves to no finite
 * sample (an unknown signal name or a malformed expression).
 */
export function evaluatePlotExpression(
  expr: string,
  result: AnalysisResult | null,
  color: string,
  scope: Scope = {},
  funcs: Record<string, FuncDef> = {},
): PlotExpressionResult {
  const trimmed = expr.trim();
  if (!trimmed) return { ok: false, error: "Enter an expression to plot." };
  if (!result || !result.ok) return { ok: false, error: "Run a transient analysis first." };

  const wf = toWaveform(result);
  const compiled = compileExpr(trimmed, wf, scope, funcs);

  const values: number[] = new Array(wf.times.length);
  let anyFinite = false;
  for (let i = 0; i < wf.times.length; i++) {
    const v = compiled.at(i);
    values[i] = v;
    if (Number.isFinite(v)) anyFinite = true;
  }
  if (!anyFinite) {
    return { ok: false, error: `“${trimmed}” has no finite values — check the signal names.` };
  }

  return {
    ok: true,
    trace: { id: `expr:${trimmed}`, label: trimmed, unit: "V", color, values },
  };
}
