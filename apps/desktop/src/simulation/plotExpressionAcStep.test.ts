/**
 * Coverage for AC `.step` family expression traces.
 */

import { describe, it, expect } from "vitest";
import { evaluateAcStepPlotExpression } from "./plotExpressionAcStep";
import type { AnalysisFamily } from "./stepAnalysisFamily";
import type { AcResult } from "./acSweep";

function member(label: string, magDb: number[]): AnalysisFamily<AcResult>["members"][number] {
  return {
    label,
    value: 1,
    result: {
      ok: true,
      freqs: [10, 100, 1000],
      traces: [{ id: "n1", label: "V(out)", magDb, phaseDeg: [0, -45, -90] }],
      warnings: [],
    },
  };
}

function family(members: AnalysisFamily<AcResult>["members"]): AnalysisFamily<AcResult> {
  return { ok: true, spec: { kind: "param", name: "R", values: [1, 2] }, members, warnings: [] };
}

describe("evaluateAcStepPlotExpression", () => {
  it("abs(V(out)) evaluates per stepped member", () => {
    const fam = family([member("R=1", [0, -3, -20]), member("R=2", [0, -6, -40])]);
    const plotted = evaluateAcStepPlotExpression("abs(V(out))", fam);
    expect(plotted.ok).toBe(true);
    if (!plotted.ok) return;
    expect(plotted.expression).toBe("abs(V(out))");
    expect(plotted.series).toHaveLength(2);
    expect(plotted.series[0].label).toBe("R=1");
    // abs of complex mag is still the linear magnitude; compiler yields finite samples.
    expect(plotted.series.every((s) => s.magDb.every((v) => Number.isFinite(v)))).toBe(true);
  });

  it("fails closed on empty / missing / unknown", () => {
    expect(evaluateAcStepPlotExpression("", family([member("R=1", [0, -3, -20])])).ok).toBe(false);
    expect(evaluateAcStepPlotExpression("V(out)", null).ok).toBe(false);
    expect(evaluateAcStepPlotExpression("V(out)", { ok: false, members: [], warnings: [] }).ok).toBe(false);
    expect(evaluateAcStepPlotExpression("V(nope)", family([member("R=1", [0, -3, -20])])).ok).toBe(false);
  });
});
