/**
 * Coverage for DC `.step` family expression traces.
 */

import { describe, it, expect } from "vitest";
import { evaluateDcStepPlotExpression } from "./plotExpressionDcStep";
import type { AnalysisFamily } from "./stepAnalysisFamily";
import type { DcSweepResult } from "./dcSweep";

function member(label: string, voltages: number[]): AnalysisFamily<DcSweepResult>["members"][number] {
  return {
    label,
    value: 1,
    result: {
      ok: true,
      source: "V1",
      sweep: [0, 1, 2],
      nets: [{ id: "n1", label: "V(out)", voltages, ground: false }],
      warnings: [],
    },
  };
}

function family(members: AnalysisFamily<DcSweepResult>["members"]): AnalysisFamily<DcSweepResult> {
  return { ok: true, spec: { kind: "param", name: "R", values: [1, 2] }, members, warnings: [] };
}

describe("evaluateDcStepPlotExpression", () => {
  it("abs(V(out)) evaluates per stepped member", () => {
    const fam = family([member("R=1", [0, -0.5, -1]), member("R=2", [0, -0.25, -0.5])]);
    const plotted = evaluateDcStepPlotExpression("abs(V(out))", fam);
    expect(plotted.ok).toBe(true);
    if (!plotted.ok) return;
    expect(plotted.expression).toBe("abs(V(out))");
    expect(plotted.series).toHaveLength(2);
    expect(plotted.series[0].voltages).toEqual([0, 0.5, 1]);
    expect(plotted.series[1].voltages).toEqual([0, 0.25, 0.5]);
  });

  it("fails closed on empty / missing / unknown", () => {
    expect(evaluateDcStepPlotExpression("", family([member("R=1", [0, 1, 2])])).ok).toBe(false);
    expect(evaluateDcStepPlotExpression("V(out)", null).ok).toBe(false);
    expect(evaluateDcStepPlotExpression("V(out)", { ok: false, members: [], warnings: [] }).ok).toBe(false);
    expect(evaluateDcStepPlotExpression("V(nope)", family([member("R=1", [0, 1, 2])])).ok).toBe(false);
  });
});
