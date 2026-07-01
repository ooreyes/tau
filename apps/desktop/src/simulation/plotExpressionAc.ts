// Arbitrary-expression traces for the AC (Bode) pane (FEATURE_PARITY §6
// "plot arbitrary expressions … in the AC pane").
//
// The transient scope can already overlay any expression of the simulated
// signals (`plotExpression.ts`). LTspice offers the same in the frequency
// domain — plot `db(V(out))-db(V(in))` (a transfer function), `mag(V(a,b))`,
// or a raw ratio across the sweep. `.meas ac` already compiles exactly this
// mix of magnitude/phase-wrapped signals into a per-frequency evaluator
// (`compileAcExpr`), so we reuse it here: the same compiler drives AC
// measurements and AC expression plotting (one evaluator to keep in sync).
//
// The compiled expression yields a real value per frequency; we return it as a
// Bode trace whose `magDb` array carries that value directly. LTspice plots the
// expression as written — so wrap in `db(...)` for a dB curve, leave bare for a
// linear-magnitude curve — matching how the transient pane plots the literal
// expression. Phase is left flat (0°): a scalar expression has no phase axis.

import { type FuncDef, type Scope } from "./expr";
import { compileAcExpr, type AcMeasData } from "./measureAc";
import type { AcResult, AcTrace } from "./acSweep";

export type PlotAcExpressionResult =
  | { ok: true; trace: AcTrace }
  | { ok: false; error: string };

/**
 * Evaluate `expr` (e.g. `db(V(out))-db(V(in))`, `mag(V(a,b))`, `V(out)/V(in)`)
 * against a successful AC result, sampling it at every swept frequency, and
 * return it as an {@link AcTrace} ready to overlay on the Bode magnitude plot.
 * Fails when the expression is empty, the result is not a successful AC sweep,
 * or the expression resolves to no finite sample (an unknown signal name or a
 * malformed expression).
 */
export function evaluateAcPlotExpression(
  expr: string,
  result: AcResult | null,
  scope: Scope = {},
  funcs: Record<string, FuncDef> = {},
): PlotAcExpressionResult {
  const trimmed = expr.trim();
  if (!trimmed) return { ok: false, error: "Enter an expression to plot." };
  if (!result || !result.ok) return { ok: false, error: "Run an AC analysis first." };

  const data: AcMeasData = { freqs: result.freqs, traces: result.traces };
  const compiled = compileAcExpr(trimmed, data, scope, funcs);

  const magDb: number[] = new Array(result.freqs.length);
  let anyFinite = false;
  for (let i = 0; i < result.freqs.length; i++) {
    const v = compiled.at(i);
    magDb[i] = v;
    if (Number.isFinite(v)) anyFinite = true;
  }
  if (!anyFinite) {
    return { ok: false, error: `“${trimmed}” has no finite values — check the signal names.` };
  }

  return {
    ok: true,
    trace: {
      id: `expr:${trimmed}`,
      label: trimmed,
      magDb,
      phaseDeg: new Array(result.freqs.length).fill(0),
    },
  };
}
