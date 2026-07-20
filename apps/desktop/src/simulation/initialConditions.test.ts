/**
 * Per-instance initial conditions (`IC=` on a capacitor/inductor) in the interim
 * TS transient solver (LTspice parity).
 *
 * LTspice writes the IC after the value (`C1 n1 n2 1u IC=2`) and runs the
 * transient with `uic` so the value holds at t=0. The TS solver seeds the
 * companion-model state from the parsed IC token; without it the run used to
 * throw (`parseQuantity("1u IC=2")` is unparseable) - now the magnitude parses
 * and the IC seeds the start.
 *
 * Geometry (GRID = 16, rotation 0):
 *   two-terminal (R, C, L): pin "a" at (x-32, y), "b" at (x+32, y)
 *   isource (p,n): "p" at (x, y-32), "n" at (x, y+32)
 *   net label names the net containing any pin at its coordinate
 *
 * RC discharge with C=1µF, R=1kΩ ⇒ τ = RC = 1 ms. Backward-Euler companion:
 *   V[n] = IC / (1 + h/RC)^(n+1)  →  at t = τ (1 ms), ≈ IC·e⁻¹ = 0.7358·IC.
 */

import { describe, it, expect } from "vitest";
import { runTransientAnalysis } from "./linearTransient";
import type { NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";

let idCounter = 0;
const uid = (p: string) => `${p}-${++idCounter}`;

const capacitor = (x: number, y: number, value: string, label: string): SchematicComponent => ({
  id: uid("c"), kind: "capacitor", x, y, rotation: 0, value, label,
});
const inductor = (x: number, y: number, value: string, label: string): SchematicComponent => ({
  id: uid("l"), kind: "inductor", x, y, rotation: 0, value, label,
});
const resistor = (x: number, y: number, value: string, label: string): SchematicComponent => ({
  id: uid("r"), kind: "resistor", x, y, rotation: 0, value, label,
});
const isource = (x: number, y: number, value: string, label: string): SchematicComponent => ({
  id: uid("i"), kind: "isource", x, y, rotation: 0, value, label,
});
const ground = (x: number, y: number): SchematicComponent => ({
  id: uid("gnd"), kind: "ground", x, y, rotation: 0, value: "", label: "",
});
const labelAt = (text: string, p: { x: number; y: number }): NetLabel => ({ id: uid("nl"), x: p.x, y: p.y, text });

// RC node `cap` to ground, plus a 0 A current source so the solver's
// "needs a source" guard is satisfied (it injects nothing).
//   C.a=(64,0), R.a=(64,96), I1.p=(200,-32) → all labeled "cap"
//   C.b=(128,0), R.b=(128,96), I1.n=(200,32) → all ground
function rcDischarge(capValue: string): {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels: NetLabel[];
} {
  return {
    components: [
      capacitor(96, 0, capValue, "C1"),
      resistor(96, 96, "1k", "R1"),
      isource(200, 0, "0", "I1"),
      ground(128, 0),
      ground(128, 96),
      ground(200, 32),
    ],
    wires: [],
    netLabels: [
      labelAt("cap", { x: 64, y: 0 }),
      labelAt("cap", { x: 64, y: 96 }),
      labelAt("cap", { x: 200, y: -32 }),
    ],
  };
}

describe("initial conditions - capacitor IC=", () => {
  it("a charged cap discharges through R from its IC (does not throw on `1u IC=2`)", async () => {
    const { components, wires, netLabels } = rcDischarge("1u IC=2");
    const result = await runTransientAnalysis({ components, wires, netLabels }, { stopTime: 1e-3, steps: 1000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cap = result.traces.find((t) => t.id === "cap")!;
    expect(cap).toBeDefined();
    // Starts at ≈ IC (one BE step: 2/(1+1e-3) ≈ 1.998 V).
    expect(cap.values[0]).toBeCloseTo(2, 1);
    expect(cap.values[0]).toBeGreaterThan(1.99);
    // At t = RC = 1 ms decays to ≈ IC·e⁻¹ = 0.7358 V.
    expect(cap.values[cap.values.length - 1]).toBeCloseTo(2 * Math.exp(-1), 1);
    // Monotonically decreasing toward 0.
    for (let i = 1; i < cap.values.length; i += 1) {
      expect(cap.values[i]).toBeLessThanOrEqual(cap.values[i - 1] + 1e-12);
    }
  });

  it("without IC the same node starts at 0 (no source to charge it)", async () => {
    const { components, wires, netLabels } = rcDischarge("1u");
    const result = await runTransientAnalysis({ components, wires, netLabels }, { stopTime: 1e-3, steps: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cap = result.traces.find((t) => t.id === "cap")!;
    for (const v of cap.values) expect(v).toBeCloseTo(0, 9);
  });
});

describe("initial conditions - inductor IC=", () => {
  it("an inductor seeded with IC delivers that current at t=0 and decays through R", async () => {
    // RL loop: L (IC=1 A) and R=1Ω from node `n1` to ground ⇒ τ = L/R = 1 s.
    // I(L1)[0] ≈ IC, decaying as I = IC·e^(−tR/L).
    const components: SchematicComponent[] = [
      inductor(96, 0, "1 IC=1", "L1"),
      resistor(96, 96, "1", "R1"),
      isource(200, 0, "0", "I1"),
      ground(128, 0),
      ground(128, 96),
      ground(200, 32),
    ];
    const netLabels = [
      labelAt("n1", { x: 64, y: 0 }),
      labelAt("n1", { x: 64, y: 96 }),
      labelAt("n1", { x: 200, y: -32 }),
    ];
    const result = await runTransientAnalysis({ components, wires: [], netLabels }, { stopTime: 1, steps: 1000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const il = result.currents.find((c) => c.ref === "L1");
    expect(il).toBeDefined();
    // |I(L1)| starts near the 1 A IC and decays toward 0.
    expect(Math.abs(il!.values[0])).toBeCloseTo(1, 1);
    expect(Math.abs(il!.values[0])).toBeGreaterThan(0.99);
    expect(Math.abs(il!.values[il!.values.length - 1])).toBeLessThan(0.4); // ≈ e⁻¹ = 0.368
    expect(Math.abs(il!.values[il!.values.length - 1])).toBeLessThan(Math.abs(il!.values[0]));
  });
});

// ---------------------------------------------------------------------------
// DC operating-point seeding (no `uic`): reactive parts start at their bias
// ---------------------------------------------------------------------------

const vsource = (x: number, y: number, value: string, label: string): SchematicComponent => ({
  id: uid("v"), kind: "vsource", x, y, rotation: 0, value, label,
});
const vac = (x: number, y: number, value: string, label: string): SchematicComponent => ({
  id: uid("vac"), kind: "vac", x, y, rotation: 0, value, label,
});

// 5 V through R1=1k into R2=1k with C1 across R2: the mid node biases at 2.5 V.
//   V1.p=(0,0) + R1.a=(64,0) → "in"; R1.b=(128,0) + R2.a=(160,48) + C1.a=(160,96) → "mid"
//   Grounds on V1.n=(0,64), R2.b=(224,48), C1.b=(224,96).
function biasedRc(capValue: string) {
  return {
    components: [
      vsource(0, 32, "5", "V1"),
      resistor(96, 0, "1k", "R1"),
      resistor(192, 48, "1k", "R2"),
      capacitor(192, 96, capValue, "C1"),
      ground(0, 64),
      ground(224, 48),
      ground(224, 96),
    ],
    wires: [] as SchematicWire[],
    netLabels: [
      labelAt("in", { x: 0, y: 0 }),
      labelAt("in", { x: 64, y: 0 }),
      labelAt("mid", { x: 128, y: 0 }),
      labelAt("mid", { x: 160, y: 48 }),
      labelAt("mid", { x: 160, y: 96 }),
    ],
  };
}

describe("DC operating-point seeding (no uic)", () => {
  it("a cap on a biased divider starts at its DC voltage and stays flat", async () => {
    const { components, wires, netLabels } = biasedRc("1u");
    const result = await runTransientAnalysis({ components, wires, netLabels }, { stopTime: 1e-3, steps: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mid = result.traces.find((t) => t.id === "mid")!;
    expect(mid).toBeDefined();
    expect(mid.values[0]).toBeCloseTo(2.5, 6);
    expect(mid.values[mid.values.length - 1]).toBeCloseTo(2.5, 6);
  });

  it("an explicit IC= beats the operating point and converges toward the bias", async () => {
    // C1 seeded at 1 V by IC=; the divider pulls it to 2.5 V with
    // τ = (R1‖R2)·C = 500 µs, so 5 ms ≈ 10τ lands on the bias.
    const { components, wires, netLabels } = biasedRc("1u IC=1");
    const result = await runTransientAnalysis({ components, wires, netLabels }, { stopTime: 5e-3, steps: 500 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mid = result.traces.find((t) => t.id === "mid")!;
    expect(mid.values[0]).toBeCloseTo(1, 1);
    expect(mid.values[mid.values.length - 1]).toBeCloseTo(2.5, 2);
  });

  it("an inductor in a DC path starts at its bias current", async () => {
    // 5 V → R1=1k → L1 → GND: DC current 5 mA, flat for the whole run.
    const components = [
      vsource(0, 32, "5", "V1"),
      resistor(96, 0, "1k", "R1"),
      inductor(192, 0, "1m", "L1"),
      ground(0, 64),
      ground(224, 0),
    ];
    const netLabels = [
      labelAt("in", { x: 0, y: 0 }),
      labelAt("in", { x: 64, y: 0 }),
      labelAt("n1", { x: 128, y: 0 }),
      labelAt("n1", { x: 160, y: 0 }),
    ];
    const result = await runTransientAnalysis({ components, wires: [], netLabels }, { stopTime: 1e-3, steps: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const il = result.currents.find((c) => c.ref === "L1")!;
    expect(il).toBeDefined();
    expect(il.values[0]).toBeCloseTo(5e-3, 9);
    expect(il.values[il.values.length - 1]).toBeCloseTo(5e-3, 9);
  });

  it("falls back to zero state with a warning when the OP is singular", async () => {
    // A sine source directly across an ideal inductor: at DC both are 0 V
    // constraints on the same node pair, so the operating point is singular.
    // The run still succeeds - it just starts from zero state like uic.
    const components = [
      vac(0, 32, "1 1k", "V1"),
      inductor(96, 0, "1m", "L1"),
      ground(0, 64),
      ground(128, 0),
    ];
    const netLabels = [
      labelAt("n1", { x: 0, y: 0 }),
      labelAt("n1", { x: 64, y: 0 }),
    ];
    const result = await runTransientAnalysis({ components, wires: [], netLabels }, { stopTime: 1e-3, steps: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => /operating point could not be computed/i.test(w))).toBe(true);
    const il = result.currents.find((c) => c.ref === "L1")!;
    expect(il).toBeDefined();
    expect(Math.abs(il.values[0])).toBeLessThan(1e-6);
  });
});
