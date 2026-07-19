// Arbitrary-expression traces for the DC-sweep pane (LTspice parity).
//
// A DC sweep produces a real-valued node-voltage series indexed by the swept
// source value - the same shape as a transient result. So, exactly like the
// transient expression plot (`plotExpression.ts`), we adapt the sweep into the
// `.meas` MeasWaveform (`dcResultToWaveform`) and reuse the transient expression
// compiler (`compileExpr`) to evaluate any expression of the swept node voltages
// (`V(out)-V(in)`, `V(a)/V(b)`, a scaled difference) at every sweep point.
// One evaluator drives measurements, the transient scope, and this DC overlay.

import { type FuncDef, type Scope } from "./expr";
import { compileExpr } from "./measure";
import { dcResultToWaveform } from "./measureDc";
import type { DcSweepResult, DcSweepNet } from "./dcSweep";

export type PlotDcExpressionResult =
  | { ok: true; trace: DcSweepNet }
  | { ok: false; error: string };

/**
 * Evaluate `expr` (e.g. `V(out)-V(in)`, `V(a)/V(b)`) against a successful DC
 * sweep, sampling it at every swept-source value, and return it as a {@link
 * DcSweepNet} ready to overlay on the DC plot (`ground: false` so the pane always
 * draws it). Fails when the expression is empty, the result is not a successful
 * DC sweep, or the expression resolves to no finite sample (unknown signal /
 * malformed expression).
 */
export function evaluateDcPlotExpression(
  expr: string,
  result: DcSweepResult | null,
  scope: Scope = {},
  funcs: Record<string, FuncDef> = {},
): PlotDcExpressionResult {
  const trimmed = expr.trim();
  if (!trimmed) return { ok: false, error: "Enter an expression to plot." };
  if (!result || !result.ok) return { ok: false, error: "Run a DC sweep first." };

  const wf = dcResultToWaveform(result);
  const compiled = compileExpr(trimmed, wf, scope, funcs);

  const voltages: number[] = new Array(wf.times.length);
  let anyFinite = false;
  for (let i = 0; i < wf.times.length; i++) {
    const v = compiled.at(i);
    voltages[i] = v;
    if (Number.isFinite(v)) anyFinite = true;
  }
  if (!anyFinite) {
    return { ok: false, error: `“${trimmed}” has no finite values - check the signal names.` };
  }

  return {
    ok: true,
    trace: { id: `expr:${trimmed}`, label: trimmed, voltages, ground: false },
  };
}
