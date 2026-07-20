/**
 * Clamp-meter (current) probe resolution: a probe with `componentId` set maps
 * to the probed component's branch-current waveform `I(ref)`. Uses a real RC
 * transient run so the id→ref→current chain is exercised end to end.
 *
 * Circuit geometry follows the documented pin layout (GRID = 16):
 *   vsource (rotation 0): p=(x, y-32), n=(x, y+32)
 *   two-terminal (rotation 0): a=(x-32, y), b=(x+32, y)
 */

import { describe, it, expect } from "vitest";
import { runTransientAnalysis } from "./linearTransient";
import { currentProbeTraces, isCurrentProbe } from "./currentProbe";
import type { Probe, SchematicComponent, SchematicWire } from "../schematic/types";

const VS: SchematicComponent = { id: "vs-1", kind: "vsource", x: 0, y: 32, rotation: 0, value: "5V", label: "V1" };
const R: SchematicComponent = { id: "r-1", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" };
const C: SchematicComponent = { id: "c-1", kind: "capacitor", x: 224, y: 0, rotation: 0, value: "1µ", label: "C1" };
const GND_VS: SchematicComponent = { id: "g-1", kind: "ground", x: 0, y: 64, rotation: 0, value: "", label: "" };
const GND_C: SchematicComponent = { id: "g-2", kind: "ground", x: 256, y: 0, rotation: 0, value: "", label: "" };

const wires: SchematicWire[] = [
  { id: "w-1", points: [{ x: 0, y: 0 }, { x: 64, y: 0 }] },
  { id: "w-2", points: [{ x: 128, y: 0 }, { x: 192, y: 0 }] },
];

async function runCircuit() {
  const result = await runTransientAnalysis(
    { components: [VS, R, C, GND_VS, GND_C], wires },
    // `uic` keeps the classic charging waveform this suite asserts on; without
    // it the run starts from the DC operating point (cap already at 5 V).
    { stopTime: 5e-3, steps: 500, uic: true },
  );
  if (!result.ok) throw new Error(result.message);
  return result;
}

const probe = (componentId: string, color = "var(--trace-red)"): Probe => ({
  id: `p-${componentId}`,
  x: 0,
  y: 0,
  color,
  componentId,
});

describe("isCurrentProbe", () => {
  it("distinguishes clamp-meter probes from net probes", () => {
    expect(isCurrentProbe(probe("r-1"))).toBe(true);
    expect(isCurrentProbe({ id: "p", x: 0, y: 0, color: "var(--trace-red)" })).toBe(false);
  });
});

describe("currentProbeTraces", () => {
  it("maps a probed resistor to its I(ref) trace with unit A and the probe's color", async () => {
    const result = await runCircuit();
    const traces = currentProbeTraces(result, [probe("r-1", "var(--trace-purple)")]);
    expect(traces).toHaveLength(1);
    expect(traces[0].id).toBe("I(R1)");
    expect(traces[0].unit).toBe("A");
    expect(traces[0].color).toBe("var(--trace-purple)");
    expect(traces[0].values).toHaveLength(result.times.length);
  });

  it("resolves the physically correct current: I(R1) at t=0 ≈ Vs/R = 5 mA", async () => {
    const result = await runCircuit();
    const [trace] = currentProbeTraces(result, [probe("r-1")]);
    expect(Math.abs(trace.values[0])).toBeCloseTo(5e-3, 4);
    // After 5τ the capacitor is charged and the current has decayed to ~0.
    expect(Math.abs(trace.values[trace.values.length - 1])).toBeLessThan(5e-5);
  });

  it("ignores plain net probes and probes on unknown component ids", async () => {
    const result = await runCircuit();
    const netProbe: Probe = { id: "p-net", x: 160, y: 0, color: "var(--trace-cyan)" };
    expect(currentProbeTraces(result, [netProbe, probe("deleted-id")])).toHaveLength(0);
  });

  it("ignores probes on components without a ref-des (unlabeled/ground)", async () => {
    const result = await runCircuit();
    expect(currentProbeTraces(result, [probe("g-1")])).toHaveLength(0);
  });

  it("deduplicates two probes on the same component", async () => {
    const result = await runCircuit();
    const traces = currentProbeTraces(result, [probe("r-1"), { ...probe("r-1"), id: "p-dup" }]);
    expect(traces).toHaveLength(1);
  });

  it("resolves multiple distinct probes to distinct traces", async () => {
    const result = await runCircuit();
    const traces = currentProbeTraces(result, [probe("r-1"), probe("c-1")]);
    expect(traces.map((t) => t.id).sort()).toEqual(["I(C1)", "I(R1)"]);
  });
});
