/**
 * Arbitrary-expression traces for the stepped transient family (LTspice parity).
 *
 * The main transient scope already overlays `V(a)-V(b)` / `V*I` expressions via
 * {@link evaluatePlotExpression}. A `.step` family is the same waveform per
 * swept member — evaluating one expression against every successful member
 * yields a family of derived curves (one colour per step value), reusing the
 * shared `.meas` / plot-expression compiler so probes and expressions stay in
 * sync.
 */

import { evaluatePlotExpression } from "./plotExpression";
import { inferExpressionUnit } from "./exprUnit";
import type { StepFamilyResult } from "./stepFamily";
import type { Trace } from "./linearTransient";

export interface StepExprMemberSeries {
  /** Swept-member label, e.g. `Rload=1k`. */
  label: string;
  times: number[];
  trace: Trace;
}

export type StepPlotExpressionResult =
  | {
      ok: true;
      /** Expression text (trimmed) — also the SIGNAL meter label. */
      expression: string;
      unit: string;
      series: StepExprMemberSeries[];
    }
  | { ok: false; error: string };

/**
 * Evaluate `expr` against every successful member of a stepped transient
 * family. Fails closed when the expression is empty, the family is missing /
 * failed, no member succeeds, or the expression resolves on zero members
 * (unknown signals). Partial member failures are skipped with the rest kept —
 * same honesty as the probe-based StepPlot (only ok members draw).
 */
export function evaluateStepPlotExpression(
  expr: string,
  family: StepFamilyResult | null,
): StepPlotExpressionResult {
  const trimmed = expr.trim();
  if (!trimmed) return { ok: false, error: "Enter an expression to plot." };
  if (!family || !family.ok) {
    return { ok: false, error: "Run a .step transient sweep first." };
  }

  const series: StepExprMemberSeries[] = [];
  let lastError: string | null = null;
  for (const member of family.members) {
    if (!member.result.ok) continue;
    const evaluated = evaluatePlotExpression(trimmed, member.result, "var(--trace-cyan)");
    if (!evaluated.ok) {
      lastError = evaluated.error;
      continue;
    }
    series.push({
      label: member.label,
      times: member.result.times,
      trace: evaluated.trace,
    });
  }

  if (series.length === 0) {
    return {
      ok: false,
      error: lastError ?? `“${trimmed}” has no finite values across the step family.`,
    };
  }

  return {
    ok: true,
    expression: trimmed,
    unit: inferExpressionUnit(trimmed) || series[0].trace.unit || "V",
    series,
  };
}
