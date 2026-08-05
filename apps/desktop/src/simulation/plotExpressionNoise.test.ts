/**
 * Coverage for noise-pane expression traces (LTspice parity).
 *
 * `evaluateNoisePlotExpression` adapts a NoiseResult into the `.meas` waveform
 * (`V(onoise)` / `V(inoise)`) and reuses `compileExpr`.
 */

import { describe, it, expect } from "vitest";
import { evaluateNoisePlotExpression } from "./plotExpressionNoise";
import type { NoiseResult } from "./noise";

function flatNoise(): Extract<NoiseResult, { ok: true }> {
  const onoise = [4e-9, 4e-9, 5e-9, 8e-9];
  return {
    ok: true,
    spec: { output: { pos: "out" }, source: "V1", sweep: { startHz: 1, stopHz: 1e3, pointsPerDecade: 1 } },
    freqs: [1, 10, 100, 1000],
    onoise,
    inoise: onoise.map((v) => v / 10),
    inoiseUnit: "V/√Hz",
    totalOutputNoise: 1e-5,
    totalInputNoise: 1e-6,
    warnings: [],
  };
}

describe("evaluateNoisePlotExpression", () => {
  it("abs(V(onoise)) reproduces the output density (already non-negative)", () => {
    const result = flatNoise();
    const plotted = evaluateNoisePlotExpression("abs(V(onoise))", result);
    expect(plotted.ok).toBe(true);
    if (!plotted.ok) return;
    expect(plotted.trace.label).toBe("abs(V(onoise))");
    expect(plotted.trace.values).toEqual(result.onoise);
  });

  it("db(V(onoise)) is 20·log10 of the density", () => {
    const result = flatNoise();
    const plotted = evaluateNoisePlotExpression("db(V(onoise))", result);
    expect(plotted.ok).toBe(true);
    if (!plotted.ok) return;
    for (let i = 0; i < result.onoise.length; i++) {
      expect(plotted.trace.values[i]).toBeCloseTo(20 * Math.log10(result.onoise[i]), 10);
    }
  });

  it("resolves V(inoise) as well", () => {
    const result = flatNoise();
    const plotted = evaluateNoisePlotExpression("V(inoise)", result);
    expect(plotted.ok).toBe(true);
    if (!plotted.ok) return;
    expect(plotted.trace.values).toEqual(result.inoise);
  });

  it("fails closed on empty / missing / unknown signals", () => {
    expect(evaluateNoisePlotExpression("", flatNoise()).ok).toBe(false);
    expect(evaluateNoisePlotExpression("V(onoise)", null).ok).toBe(false);
    expect(evaluateNoisePlotExpression("V(onoise)", { ok: false, message: "no", warnings: [] }).ok).toBe(false);
    expect(evaluateNoisePlotExpression("V(nope)", flatNoise()).ok).toBe(false);
  });
});
