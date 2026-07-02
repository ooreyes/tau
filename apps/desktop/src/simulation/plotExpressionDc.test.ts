/**
 * Coverage for DC-pane expression traces (FEATURE_PARITY §6 plot arbitrary
 * expressions in the DC pane).
 *
 * `evaluateDcPlotExpression` adapts a DC sweep into the `.meas` waveform and
 * reuses the transient expression compiler, so an expression of the swept node
 * voltages evaluates per sweep point. Verified against a hand-computed divider
 * sweep (V(mid) = Vsweep/2).
 */

import { describe, it, expect } from "vitest";
import { evaluateDcPlotExpression } from "./plotExpressionDc";
import { runDcSweep } from "./dcSweep";
import type { SchematicComponent } from "../schematic/types";

// V1 --R1(1k)-- mid --R2(1k)-- gnd.  V(mid) = Vsweep/2 over `.dc V1 0 10 2`.
function divider(): SchematicComponent[] {
  return [
    { id: "v1", label: "V1", kind: "vsource", x: 0, y: 0, rotation: 0, value: "5",
      pinOverride: [
        { id: "p", label: "+", x: 0, y: 0 },
        { id: "n", label: "-", x: 0, y: 100 },
      ] },
    { id: "r1", label: "R1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k",
      pinOverride: [
        { id: "a", label: "a", x: 0, y: 0 },
        { id: "b", label: "b", x: 0, y: 50 },
      ] },
    { id: "r2", label: "R2", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k",
      pinOverride: [
        { id: "a", label: "a", x: 0, y: 50 },
        { id: "b", label: "b", x: 0, y: 100 },
      ] },
    { id: "g", label: "", kind: "ground", x: 0, y: 100, rotation: 0, value: "",
      pinOverride: [{ id: "g", label: "gnd", x: 0, y: 100 }] },
  ];
}

const dcSpec = { source: "V1", start: 0, stop: 10, step: 2 };

function sweep() {
  const r = runDcSweep({ components: divider(), wires: [] }, dcSpec);
  if (!r.ok) throw new Error(r.message);
  return r;
}

/** The divider's top (source) net = the one equal to the sweep value itself. */
function topLabel(result: ReturnType<typeof sweep>): string {
  const top = result.nets.find((n) => !n.ground && n.voltages.every((v, k) => Math.abs(v - result.sweep[k]) < 1e-9));
  if (!top) throw new Error("no source-node trace");
  return top.label;
}
/** The divider midpoint net (= Vsweep/2). */
function midLabel(result: ReturnType<typeof sweep>): string {
  const mid = result.nets.find((n) => !n.ground && n.voltages.every((v, k) => Math.abs(v - result.sweep[k] / 2) < 1e-9));
  if (!mid) throw new Error("no midpoint trace");
  return mid.label;
}

describe("evaluateDcPlotExpression", () => {
  it("evaluates a node difference across the sweep (Vtop - Vmid = Vsweep/2)", () => {
    const result = sweep();
    const expr = `${topLabel(result)}-${midLabel(result)}`; // V(top)-V(mid)
    const plotted = evaluateDcPlotExpression(expr, result);
    expect(plotted.ok).toBe(true);
    if (!plotted.ok) return;
    expect(plotted.trace.ground).toBe(false);
    expect(plotted.trace.label).toBe(expr);
    // Vtop - Vmid = Vsweep - Vsweep/2 = Vsweep/2 = [0,1,2,3,4,5].
    expect(plotted.trace.voltages).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("evaluates a scaled expression with a scope scalar", () => {
    const result = sweep();
    const plotted = evaluateDcPlotExpression(`${midLabel(result)}*G`, result, { G: 2 });
    expect(plotted.ok).toBe(true);
    if (!plotted.ok) return;
    // Vmid*2 = Vsweep = [0,2,4,6,8,10].
    expect(plotted.trace.voltages).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it("rejects an empty expression", () => {
    const plotted = evaluateDcPlotExpression("  ", sweep());
    expect(plotted.ok).toBe(false);
    if (plotted.ok) return;
    expect(plotted.error).toMatch(/Enter an expression/);
  });

  it("requires a successful DC sweep", () => {
    const plotted = evaluateDcPlotExpression("V(out)", null);
    expect(plotted.ok).toBe(false);
    if (plotted.ok) return;
    expect(plotted.error).toMatch(/Run a DC sweep/);
  });

  it("flags an unknown signal as non-finite", () => {
    const plotted = evaluateDcPlotExpression("V(nope)*2", sweep());
    expect(plotted.ok).toBe(false);
    if (plotted.ok) return;
    expect(plotted.error).toMatch(/no finite values/);
  });
});
