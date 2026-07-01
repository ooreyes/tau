/**
 * Coverage for AC-pane expression traces (FEATURE_PARITY §6 plot arbitrary
 * expressions in the AC pane).
 *
 * `evaluateAcPlotExpression` reuses the `.meas ac` compiler, so a `db(V(out))`
 * expression must exactly reproduce the underlying trace's dB magnitude, and a
 * transfer-function difference `db(V(out))-db(V(in))` must be self-consistent.
 * Verified against a hand-set RC low-pass (fc ≈ 1 kHz).
 */

import { describe, it, expect } from "vitest";
import { evaluateAcPlotExpression } from "./plotExpressionAc";
import { runAcSweep } from "./acSweep";
import type { SchematicComponent } from "../schematic/types";

// V1(AC 1) --R(1k)-- out --C(159.155n)-- gnd.  fc = 1/(2π·1k·159.155n) ≈ 1 kHz.
function rcLowpass(): SchematicComponent[] {
  return [
    { id: "v1", label: "V1", kind: "vac", x: 0, y: 0, rotation: 0, value: "1",
      pinOverride: [
        { id: "p", label: "+", x: 0, y: 0 },
        { id: "n", label: "-", x: 0, y: 100 },
      ] },
    { id: "r1", label: "R1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k",
      pinOverride: [
        { id: "a", label: "a", x: 0, y: 0 },
        { id: "b", label: "b", x: 0, y: 50 },
      ] },
    { id: "c1", label: "C1", kind: "capacitor", x: 0, y: 0, rotation: 0, value: "159.155n",
      pinOverride: [
        { id: "a", label: "a", x: 0, y: 50 },
        { id: "b", label: "b", x: 0, y: 100 },
      ] },
    { id: "g", label: "", kind: "ground", x: 0, y: 100, rotation: 0, value: "",
      pinOverride: [{ id: "g", label: "gnd", x: 0, y: 100 }] },
  ];
}

const acOptions = { startHz: 10, stopHz: 100_000, pointsPerDecade: 20 };

function sweep() {
  const r = runAcSweep({ components: rcLowpass(), wires: [] }, acOptions);
  if (!r.ok) throw new Error(r.message);
  return r;
}

/** The rolled-off output trace = the one most attenuated at the top of the sweep. */
function outTrace(result: ReturnType<typeof sweep>) {
  const last = result.freqs.length - 1;
  return result.traces.reduce((lo, t) => (t.magDb[last] < lo.magDb[last] ? t : lo));
}

describe("evaluateAcPlotExpression", () => {
  it("db(V(out)) reproduces the output trace's magnitude exactly", () => {
    const result = sweep();
    const out = outTrace(result);
    const expr = `db(${out.label})`; // e.g. db(V(out))
    const plotted = evaluateAcPlotExpression(expr, result);
    expect(plotted.ok).toBe(true);
    if (!plotted.ok) return;
    expect(plotted.trace.magDb.length).toBe(result.freqs.length);
    plotted.trace.magDb.forEach((v, i) => expect(v).toBeCloseTo(out.magDb[i], 9));
    expect(plotted.trace.phaseDeg.every((p) => p === 0)).toBe(true);
    expect(plotted.trace.label).toBe(expr);
  });

  it("db(V(out))-db(V(in)) is a self-consistent transfer response (0 dB at DC-ish)", () => {
    const result = sweep();
    const out = outTrace(result);
    // The input node trace is the one near 0 dB across the whole sweep.
    const inTrace = result.traces.find((t) => t.id !== out.id && t.magDb.every((d) => Math.abs(d) < 1e-6));
    expect(inTrace).toBeDefined();
    if (!inTrace) return;
    const plotted = evaluateAcPlotExpression(`db(${out.label})-db(${inTrace.label})`, result);
    expect(plotted.ok).toBe(true);
    if (!plotted.ok) return;
    // Input is unity (0 dB), so the transfer equals the output magnitude, and it
    // is ≈ 0 dB at the low end and rolls off (more negative) at the high end.
    expect(plotted.trace.magDb[0]).toBeCloseTo(out.magDb[0], 6);
    expect(plotted.trace.magDb[0]).toBeGreaterThan(-0.5);
    expect(plotted.trace.magDb[result.freqs.length - 1]).toBeLessThan(-20);
  });

  it("rejects an empty expression", () => {
    const plotted = evaluateAcPlotExpression("   ", sweep());
    expect(plotted.ok).toBe(false);
    if (plotted.ok) return;
    expect(plotted.error).toMatch(/Enter an expression/);
  });

  it("requires a successful AC result", () => {
    const plotted = evaluateAcPlotExpression("db(V(out))", null);
    expect(plotted.ok).toBe(false);
    if (plotted.ok) return;
    expect(plotted.error).toMatch(/Run an AC analysis/);
  });

  it("flags an unknown signal name as non-finite", () => {
    const plotted = evaluateAcPlotExpression("db(V(nope))", sweep());
    expect(plotted.ok).toBe(false);
    if (plotted.ok) return;
    expect(plotted.error).toMatch(/no finite values/);
  });

  it("uses the provided scope for scalar terms", () => {
    const result = sweep();
    const out = outTrace(result);
    const plotted = evaluateAcPlotExpression(`db(${out.label})+K`, result, { K: 10 });
    expect(plotted.ok).toBe(true);
    if (!plotted.ok) return;
    plotted.trace.magDb.forEach((v, i) => expect(v).toBeCloseTo(out.magDb[i] + 10, 9));
  });
});
