/**
 * Arbitrary-expression traces for the AC `.step` family pane (LTspice parity).
 *
 * Mirrors {@link evaluateStepPlotExpression}: evaluate one Bode expression
 * against every successful stepped AC member so legend math
 * (`abs(V(out))`, `db(V(out))`, …) redraws the whole family.
 */

import { evaluateAcPlotExpression } from "./plotExpressionAc";
import type { AnalysisFamily } from "./stepAnalysisFamily";
import type { AcResult } from "./acSweep";

export interface AcStepExprMemberSeries {
  label: string;
  freqs: number[];
  magDb: number[];
  phaseDeg: number[];
}

export type AcStepPlotExpressionResult =
  | {
      ok: true;
      expression: string;
      series: AcStepExprMemberSeries[];
    }
  | { ok: false; error: string };

/**
 * Evaluate `expr` against every successful member of a stepped AC family.
 * Partial member failures are skipped; fails closed when none resolve.
 */
export function evaluateAcStepPlotExpression(
  expr: string,
  family: AnalysisFamily<AcResult> | null,
): AcStepPlotExpressionResult {
  const trimmed = expr.trim();
  if (!trimmed) return { ok: false, error: "Enter an expression to plot." };
  if (!family || !family.ok) {
    return { ok: false, error: "Run a .step AC sweep first." };
  }

  const series: AcStepExprMemberSeries[] = [];
  let lastError: string | null = null;
  for (const member of family.members) {
    if (!member.result.ok) continue;
    const evaluated = evaluateAcPlotExpression(trimmed, member.result);
    if (!evaluated.ok) {
      lastError = evaluated.error;
      continue;
    }
    series.push({
      label: member.label,
      freqs: member.result.freqs,
      magDb: evaluated.trace.magDb,
      phaseDeg: evaluated.trace.phaseDeg,
    });
  }

  if (series.length === 0) {
    return {
      ok: false,
      error: lastError ?? `“${trimmed}” has no finite values across the AC step family.`,
    };
  }

  return { ok: true, expression: trimmed, series };
}
