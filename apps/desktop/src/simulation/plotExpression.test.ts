import { describe, it, expect } from "vitest";
import { evaluatePlotExpression } from "./plotExpression";
import type { AnalysisResult } from "./linearTransient";

// A minimal successful transient result with two node traces (in, out) and one
// branch current I(R1). Hand-chosen values make the derived expressions obvious.
function fixture(): AnalysisResult {
  return {
    ok: true,
    title: "test",
    times: [0, 1, 2],
    traces: [
      { id: "in", label: "in", unit: "V", color: "#f00", values: [1, 2, 3] },
      { id: "out", label: "out", unit: "V", color: "#0f0", values: [0.5, 1, 1.5] },
    ],
    currents: [{ ref: "R1", label: "I(R1)", values: [10, 20, 30] }],
    stats: { netCount: 2, componentCount: 2, sampleCount: 3, stopTime: 2, stepSize: 1 },
    warnings: [],
    circuit: undefined as never,
  };
}

describe("evaluatePlotExpression", () => {
  it("plots a node difference V(out)-V(in)", () => {
    const r = evaluatePlotExpression("V(out)-V(in)", fixture(), "#abc");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.trace.values).toEqual([-0.5, -1, -1.5]);
    expect(r.trace.label).toBe("V(out)-V(in)");
    expect(r.trace.color).toBe("#abc");
    expect(r.trace.id).toBe("expr:V(out)-V(in)");
  });

  it("plots instantaneous power V(out)*I(R1)", () => {
    const r = evaluatePlotExpression("V(out)*I(R1)", fixture(), "#abc");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.trace.values).toEqual([5, 20, 45]); // 0.5*10, 1*20, 1.5*30
  });

  it("supports functions and constants from the expression engine", () => {
    const r = evaluatePlotExpression("2*V(in)+1", fixture(), "#abc");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.trace.values).toEqual([3, 5, 7]);
  });

  it("errors on an empty expression", () => {
    const r = evaluatePlotExpression("   ", fixture(), "#abc");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/Enter an expression/);
  });

  it("errors when there is no successful transient result", () => {
    const r = evaluatePlotExpression("V(out)", null, "#abc");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/Run a transient/);

    const failed: AnalysisResult = { ok: false, title: "x", message: "no", warnings: [] };
    expect(evaluatePlotExpression("V(out)", failed, "#abc").ok).toBe(false);
  });

  it("errors when the expression resolves to no finite values (unknown signal)", () => {
    const r = evaluatePlotExpression("V(nope)", fixture(), "#abc");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/no finite values/);
  });

  it("plots whole-expression ddt(…) via numerical differentiation", () => {
    // V(in) = [1,2,3] over t=[0,1,2] → unit ramp slope 1
    const r = evaluatePlotExpression("ddt(V(in))", fixture(), "#abc");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.trace.values).toEqual([1, 1, 1]);
    expect(r.trace.label).toBe("ddt(V(in))");
    expect(r.trace.id).toBe("expr:ddt(V(in))");
    expect(r.trace.unit).toBe("");
  });
});
