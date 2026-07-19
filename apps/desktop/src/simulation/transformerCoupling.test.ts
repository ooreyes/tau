/**
 * End-to-end mutual-inductance (`K` coupling) tests through the interim TS
 * solvers (acSweep + linearTransient). The coupling specs come from
 * parseCouplingSpecs(); the solvers stamp the cross terms.
 *
 * Geometry (GRID = 16, rotation 0):
 *   inductor (a,b): pin "a" at (x-32, y), pin "b" at (x+32, y)
 *   vsource/vac (p,n): pin "p" at (x, y-32), pin "n" at (x, y+32)
 *   ground "g": at (x, y)
 *   net label: names the net containing any pin at its coordinate
 *
 * Open-circuit transformer (secondary unloaded, so KCL forces I₂ = 0):
 *   V(out) = (M / L1) · V(in) = k·√(L2/L1) · V(in)
 * With L1 = 1 mH, L2 = 4 mH, k = 1: M = √(1m·4m) = 2 mH, so V(out) = 2·V(in).
 */

import { describe, it, expect } from "vitest";
import { runAcSweep } from "./acSweep";
import { runTransientAnalysis } from "./linearTransient";
import { parseCouplingSpecs } from "./coupling";
import type { NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";

let idCounter = 0;
const uid = (p: string) => `${p}-${++idCounter}`;

const vsource = (x: number, y: number, value: string, label: string): SchematicComponent => ({
  id: uid("vs"), kind: "vsource", x, y, rotation: 0, value, label,
});
const inductor = (x: number, y: number, value: string, label: string): SchematicComponent => ({
  id: uid("l"), kind: "inductor", x, y, rotation: 0, value, label,
});
const ground = (x: number, y: number): SchematicComponent => ({
  id: uid("gnd"), kind: "ground", x, y, rotation: 0, value: "", label: "",
});
const wire = (points: { x: number; y: number }[]): SchematicWire => ({ id: uid("w"), points });
const labelAt = (text: string, p: { x: number; y: number }): NetLabel => ({ id: uid("nl"), x: p.x, y: p.y, text });

// Build the open-circuit transformer once; reused by every test.
//   V1 at (0,0):    p=(0,-32) → in,   n=(0,32) → gnd
//   L1 at (96,-32): a=(64,-32) → in,  b=(128,-32) → gnd
//   L2 at (96, 96): a=(64,96)  → out, b=(128,96)  → gnd
function transformer(primaryValue: string): {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels: NetLabel[];
} {
  const V1 = vsource(0, 0, primaryValue, "V1");
  const L1 = inductor(96, -32, "1m", "L1");
  const L2 = inductor(96, 96, "4m", "L2");
  return {
    components: [
      V1, L1, L2,
      ground(0, 32),     // V1.n
      ground(128, -32),  // L1.b
      ground(128, 96),   // L2.b
    ],
    wires: [
      wire([{ x: 0, y: -32 }, { x: 64, y: -32 }]), // V1.p → L1.a (node "in")
    ],
    netLabels: [labelAt("in", { x: 64, y: -32 }), labelAt("out", { x: 64, y: 96 })],
  };
}

const AC = { startHz: 100, stopHz: 100_000, pointsPerDecade: 10 };

describe("mutual inductance - AC (acSweep)", () => {
  it("steps a 1:2-turns transformer up by √(L2/L1) = 2 (≈ +6.02 dB)", () => {
    const { components, wires, netLabels } = transformer("1 AC 1");
    const couplings = parseCouplingSpecs(["K1 L1 L2 1"]);
    const result = runAcSweep({ components, wires, netLabels, couplings }, AC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const out = result.traces.find((t) => t.id === "out");
    expect(out).toBeDefined();
    // Frequency-independent for an ideal transformer: every point ≈ +6.0206 dB.
    for (const db of out!.magDb) expect(db).toBeCloseTo(20 * Math.log10(2), 3);
  });

  it("scales the transfer by the coupling coefficient k = 0.5 (≈ +0.0 dB)", () => {
    const { components, wires, netLabels } = transformer("1 AC 1");
    const couplings = parseCouplingSpecs(["K1 L1 L2 0.5"]);
    const result = runAcSweep({ components, wires, netLabels, couplings }, AC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const out = result.traces.find((t) => t.id === "out")!;
    // V(out) = 0.5·√4 = 1.0 → 0 dB.
    for (const db of out.magDb) expect(db).toBeCloseTo(0, 3);
  });

  it("leaves the secondary dead when no K directive couples the windings", () => {
    const { components, wires, netLabels } = transformer("1 AC 1");
    const result = runAcSweep({ components, wires, netLabels, couplings: [] }, AC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const out = result.traces.find((t) => t.id === "out")!;
    // Uncoupled: V(out) ≈ 0 ⇒ magDb hugely negative (no transfer).
    for (const db of out.magDb) expect(db).toBeLessThan(-100);
  });
});

describe("mutual inductance - transient (linearTransient)", () => {
  it("holds V(out) = 2·V(in) at every step for an ideal open-circuit transformer", async () => {
    // DC primary: I₂ = 0 (open secondary) and I₁ ramps, so the flux-coupling
    // relation V(out) = (M/L1)·V(in) = 2·V(in) holds instantaneously.
    const { components, wires, netLabels } = transformer("1");
    const couplings = parseCouplingSpecs(["K1 L1 L2 1"]);
    const result = await runTransientAnalysis(
      { components, wires, netLabels, couplings },
      { stopTime: 1e-3, steps: 50 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const vin = result.traces.find((t) => t.id === "in")!;
    const vout = result.traces.find((t) => t.id === "out")!;
    expect(vin).toBeDefined();
    expect(vout).toBeDefined();
    for (let i = 1; i < vin.values.length; i += 1) {
      expect(vin.values[i]).toBeCloseTo(1, 6);
      expect(vout.values[i]).toBeCloseTo(2, 6);
    }
  });

  it("produces no secondary voltage when the windings are uncoupled", async () => {
    const { components, wires, netLabels } = transformer("1");
    const result = await runTransientAnalysis(
      { components, wires, netLabels, couplings: [] },
      { stopTime: 1e-3, steps: 50 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const vout = result.traces.find((t) => t.id === "out")!;
    for (let i = 1; i < vout.values.length; i += 1) expect(vout.values[i]).toBeCloseTo(0, 9);
  });
});
