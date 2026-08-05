/**
 * Arbitrary-expression traces for the DC `.step` family pane (LTspice parity).
 *
 * Mirrors {@link evaluateStepPlotExpression}: evaluate one DC expression
 * against every successful stepped DC member so legend math
 * (`abs(V(out))`, `-(V(out))`, …) redraws the whole family.
 */

import { evaluateDcPlotExpression } from "./plotExpressionDc";
import type { AnalysisFamily } from "./stepAnalysisFamily";
import type { DcSweepResult } from "./dcSweep";

export interface DcStepExprMemberSeries {
  label: string;
  sweep: number[];
  voltages: number[];
}

export type DcStepPlotExpressionResult =
  | {
      ok: true;
      expression: string;
      series: DcStepExprMemberSeries[];
    }
  | { ok: false; error: string };

/**
 * Evaluate `expr` against every successful member of a stepped DC family.
 * Partial member failures are skipped; fails closed when none resolve.
 */
export function evaluateDcStepPlotExpression(
  expr: string,
  family: AnalysisFamily<DcSweepResult> | null,
): DcStepPlotExpressionResult {
  const trimmed = expr.trim();
  if (!trimmed) return { ok: false, error: "Enter an expression to plot." };
  if (!family || !family.ok) {
    return { ok: false, error: "Run a .step DC sweep first." };
  }

  const series: DcStepExprMemberSeries[] = [];
  let lastError: string | null = null;
  for (const member of family.members) {
    if (!member.result.ok) continue;
    const evaluated = evaluateDcPlotExpression(trimmed, member.result);
    if (!evaluated.ok) {
      lastError = evaluated.error;
      continue;
    }
    series.push({
      label: member.label,
      sweep: member.result.sweep,
      voltages: evaluated.trace.voltages,
    });
  }

  if (series.length === 0) {
    return {
      ok: false,
      error: lastError ?? `“${trimmed}” has no finite values across the DC step family.`,
    };
  }

  return { ok: true, expression: trimmed, series };
}
