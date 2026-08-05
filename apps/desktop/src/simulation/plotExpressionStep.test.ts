import { describe, expect, it } from "vitest";
import { evaluateStepPlotExpression } from "./plotExpressionStep";
import type { StepFamilyResult } from "./stepFamily";
import type { AnalysisResult } from "./linearTransient";

function okMember(
  label: string,
  value: number,
  times: number[],
  out: number[],
  mid?: number[],
): StepFamilyResult["members"][number] {
  const traces = [
    {
      id: "n_out",
      label: "V(out)",
      unit: "V" as const,
      color: "var(--trace-cyan)",
      values: out,
    },
  ];
  if (mid) {
    traces.push({
      id: "n_mid",
      label: "V(mid)",
      unit: "V" as const,
      color: "var(--trace-green)",
      values: mid,
    });
  }
  const result: Extract<AnalysisResult, { ok: true }> = {
    ok: true,
    title: "Transient",
    times,
    traces,
    currents: [
      {
        ref: "R1",
        label: "I(R1)",
        values: out.map((v) => v / 1000),
      },
    ],
    stats: {
      netCount: traces.length,
      componentCount: 1,
      sampleCount: times.length,
      stopTime: times[times.length - 1] ?? 0,
      stepSize: 1e-3,
    },
    warnings: [],
    circuit: {
      groundNetId: null,
      warnings: [],
      nets: [
        { id: "n_out", points: [], pins: [], isGround: false, labelCount: 0 },
        ...(mid
          ? [{ id: "n_mid", points: [], pins: [], isGround: false, labelCount: 0 }]
          : []),
      ],
      components: [],
    },
  };
  return { label, value, result, measurements: [] };
}

function family(members: StepFamilyResult["members"]): StepFamilyResult {
  return {
    ok: true,
    spec: { kind: "param", name: "R", values: members.map((m) => m.value) },
    members,
    warnings: [],
  };
}

describe("evaluateStepPlotExpression", () => {
  it("evaluates V(out)-V(mid) on every successful member", () => {
    const result = evaluateStepPlotExpression(
      "V(out)-V(mid)",
      family([
        okMember("R=1k", 1000, [0, 1e-3], [2, 4], [1, 1]),
        okMember("R=2k", 2000, [0, 2e-3], [3, 5], [1, 2]),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.expression).toBe("V(out)-V(mid)");
    expect(result.unit).toBe("V");
    expect(result.series).toHaveLength(2);
    expect(result.series[0].label).toBe("R=1k");
    expect(result.series[0].trace.values).toEqual([1, 3]);
    expect(result.series[1].trace.values).toEqual([2, 3]);
  });

  it("infers amps for I(R1) across the family", () => {
    const result = evaluateStepPlotExpression(
      "I(R1)",
      family([okMember("R=1k", 1000, [0, 1e-3], [2, 4])]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unit).toBe("A");
    expect(result.series[0].trace.values).toEqual([0.002, 0.004]);
  });

  it("skips failed members and keeps successful ones", () => {
    const members: StepFamilyResult["members"] = [
      okMember("R=1k", 1000, [0, 1e-3], [1, 2]),
      {
        label: "R=bad",
        value: 0,
        result: { ok: false, title: "Transient", message: "singular", warnings: [] },
        measurements: [],
      },
      okMember("R=3k", 3000, [0, 1e-3], [3, 6]),
    ];
    const result = evaluateStepPlotExpression("2*V(out)", family(members));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.series.map((s) => s.label)).toEqual(["R=1k", "R=3k"]);
    expect(result.series[0].trace.values).toEqual([2, 4]);
    expect(result.series[1].trace.values).toEqual([6, 12]);
  });

  it("fails closed on empty / missing family / unknown signal", () => {
    expect(evaluateStepPlotExpression("", family([okMember("R=1", 1, [0], [1])])).ok).toBe(false);
    expect(evaluateStepPlotExpression("V(out)", null).ok).toBe(false);
    expect(
      evaluateStepPlotExpression("V(out)", { ok: false, members: [], warnings: [], message: "no" }).ok,
    ).toBe(false);
    const bad = evaluateStepPlotExpression(
      "V(missing)",
      family([okMember("R=1k", 1000, [0, 1e-3], [1, 2])]),
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error).toMatch(/missing|finite|signal/i);
  });
});
