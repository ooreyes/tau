/**
 * Tests for ideal op-amp simulation in both the transient and OP solvers.
 *
 * Circuit geometry (all rotation 0 unless stated, GRID = 16):
 *   two-terminal (rot 0): a=(x-32, y), b=(x+32, y)
 *   vsource     (rot 0): p=(x, y-32), n=(x, y+32)
 *   opamp       (rot 0): in+=(x-32, y+16), in-=(x-32, y-16), out=(x+32, y)
 *                         v+=(x, y-32), v-=(x, y+32) [unconnected in all tests]
 *   ground             : g=(x, y)
 *
 * All op-amp v+/v- pins are intentionally left unconnected; the gmin trick
 * anchors those nets to ~0 V so the matrix stays non-singular.
 */

import { describe, it, expect } from "vitest";
import { runTransientAnalysis } from "./linearTransient";
import { runOperatingPoint } from "./operatingPoint";
import type { SchematicComponent, SchematicWire } from "../schematic/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idN = 0;
function uid(prefix: string) {
  return `${prefix}-${++idN}`;
}

function vsource(x: number, y: number, value: string, label = "V1"): SchematicComponent {
  return { id: uid("vs"), kind: "vsource", x, y, rotation: 0, value, label };
}

function resistor(x: number, y: number, value: string, label = "R"): SchematicComponent {
  return { id: uid("r"), kind: "resistor", x, y, rotation: 0, value, label };
}

function capacitor(x: number, y: number, value: string, label = "C"): SchematicComponent {
  return { id: uid("c"), kind: "capacitor", x, y, rotation: 90, value, label };
}

function opamp(x: number, y: number, label = "U1"): SchematicComponent {
  return { id: uid("op"), kind: "opamp", x, y, rotation: 0, value: "ideal", label };
}

function ground(x: number, y: number): SchematicComponent {
  return { id: uid("gnd"), kind: "ground", x, y, rotation: 0, value: "", label: "" };
}

function wire(points: { x: number; y: number }[]): SchematicWire {
  return { id: uid("w"), points };
}

// ---------------------------------------------------------------------------
// Test 1 - Inverting amplifier (gain = -Rf/Rin = -10k/1k = -10)
//
// Layout:
//   V1  vsource at (64,112):  p=(64,80),   n=(64,144)
//   U1  opamp   at (256,96):  in+=(224,112), in-=(224,80), out=(288,96)
//   Rin resistor at (160,80): a=(128,80),  b=(192,80)
//   Rf  resistor at (256,80): a=(224,80),  b=(288,80)    [Rf.a coincides with in-]
//   GND_v1 at (64,144):  V1.n
//   GND_in+ at (224,112): ties in+ to GND
//
// Wires:
//   V1.p(64,80)   → Rin.a(128,80): horizontal
//   Rin.b(192,80) → in-(224,80) = Rf.a: horizontal
//   Rf.b(288,80)  → out(288,96): vertical
//
// Expected: Vout = -Rf/Rin * Vin = -10 * 1 = -10 V
// ---------------------------------------------------------------------------
describe("Inverting amplifier - gain = -Rf/Rin = -10", () => {
  const V1   = vsource(64, 112, "1", "V1");
  const U1   = opamp(256, 96, "U1");
  const Rin  = resistor(160, 80, "1k", "Rin");
  const Rf   = resistor(256, 80, "10k", "Rf");
  const gndV1 = ground(64, 144);   // V1.n
  const gndPlus = ground(224, 112); // in+ → GND

  const components = [V1, U1, Rin, Rf, gndV1, gndPlus];
  const wires = [
    // V1.p(64,80) → Rin.a(128,80)
    wire([{ x: 64, y: 80 }, { x: 128, y: 80 }]),
    // Rin.b(192,80) → in-(224,80) = Rf.a
    wire([{ x: 192, y: 80 }, { x: 224, y: 80 }]),
    // Rf.b(288,80) → out(288,96)
    wire([{ x: 288, y: 80 }, { x: 288, y: 96 }]),
  ];

  it("DC operating-point: Vout ≈ -10 V (within 1%)", () => {
    const result = runOperatingPoint({ components, wires });
    expect(result.ok, result.ok ? "" : `OP failed: ${(result as { message: string }).message}`).toBe(true);
    if (!result.ok) return;

    // The output net is the one containing U1.out(288,96) and Rf.b(288,80)
    // It should be the most negative non-ground net.
    const outNet = result.nets.reduce((best, net) => {
      if (net.id === "0") return best;
      return !best || net.voltage < best.voltage ? net : best;
    }, null as { id: string; voltage: number } | null);

    expect(outNet).not.toBeNull();
    expect(Math.abs((outNet!.voltage - (-10)) / -10)).toBeLessThan(0.01);
  });

  it("transient last-sample: Vout ≈ -10 V (within 1%)", async () => {
    // Add a load cap for transient variation
    const Cout = capacitor(352, 128, "100n", "Cout");
    const gndCout = ground(352, 160); // Cout.b (rot=90 → b at (352, 160))
    const wires2 = [
      ...wires,
      // out(288,96) → Cout.a(352,96)
      wire([{ x: 288, y: 96 }, { x: 352, y: 96 }]),
    ];
    const result = await runTransientAnalysis(
      { components: [...components, Cout, gndCout], wires: wires2 },
      { stopTime: 2e-4, steps: 200 },
    );
    expect(result.ok, result.ok ? "" : `Transient failed: ${(result as { message: string }).message}`).toBe(true);
    if (!result.ok) return;

    // Find the most-negative trace (the output).
    const outTrace = result.traces.reduce((best, t) => {
      const last = t.values[t.values.length - 1];
      return last < (best?.values[best.values.length - 1] ?? Infinity) ? t : best;
    }, null as typeof result.traces[0] | null);

    expect(outTrace).not.toBeNull();
    const finalVout = outTrace!.values[outTrace!.values.length - 1];
    expect(Math.abs((finalVout - (-10)) / -10)).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------------------
// Test 2 - Non-inverting amplifier (gain = 1 + Rf/Rg = 1 + 10k/1k = 11)
//
// Layout:
//   V1  vsource at (64,144):  p=(64,112),  n=(64,176)
//   U1  opamp   at (256,96):  in+=(224,112), in-=(224,80), out=(288,96)
//   Rg  resistor at (160,80): a=(128,80),  b=(192,80)    [Rg from GND to in-]
//   Rf  resistor at (256,80): a=(224,80),  b=(288,80)    [Rf.a coincides with in-]
//   GND_v1  at (64,176):  V1.n
//   GND_rg  at (128,80):  Rg.a → GND
//
// Wires:
//   V1.p(64,112)  → in+(224,112): horizontal
//   Rg.b(192,80)  → in-(224,80) = Rf.a: horizontal
//   Rf.b(288,80)  → out(288,96): vertical
//
// Expected: Vout = (1 + Rf/Rg) * Vin = 11 * 1 = 11 V
// ---------------------------------------------------------------------------
describe("Non-inverting amplifier - gain = 1 + Rf/Rg = 11", () => {
  const V1   = vsource(64, 144, "1", "V1");
  const U1   = opamp(256, 96, "U1");
  const Rg   = resistor(160, 80, "1k", "Rg");
  const Rf   = resistor(256, 80, "10k", "Rf");
  const gndV1 = ground(64, 176);   // V1.n
  const gndRg = ground(128, 80);   // Rg.a → GND

  const components = [V1, U1, Rg, Rf, gndV1, gndRg];
  const wires = [
    // V1.p(64,112) → in+(224,112)
    wire([{ x: 64, y: 112 }, { x: 224, y: 112 }]),
    // Rg.b(192,80) → in-(224,80) = Rf.a
    wire([{ x: 192, y: 80 }, { x: 224, y: 80 }]),
    // Rf.b(288,80) → out(288,96)
    wire([{ x: 288, y: 80 }, { x: 288, y: 96 }]),
  ];

  it("DC operating-point: Vout = (1 + Rf/Rg) * Vin ≈ 11 V (within 1%)", () => {
    const result = runOperatingPoint({ components, wires });
    expect(result.ok, result.ok ? "" : `OP failed: ${(result as { message: string }).message}`).toBe(true);
    if (!result.ok) return;

    // Find the output net: most positive non-ground net near expected 11 V
    const expected = 11;
    const outNet = result.nets.find((n) => n.id !== "0" && Math.abs(n.voltage - expected) < 2);
    expect(outNet).toBeDefined();
    if (outNet) {
      expect(Math.abs((outNet.voltage - expected) / expected)).toBeLessThan(0.01);
    }
  });

  it("transient last-sample: Vout ≈ 11 V (within 1%)", async () => {
    const Cout = capacitor(352, 128, "100n", "Cout");
    const gndCout = ground(352, 160);
    const wires2 = [
      ...wires,
      wire([{ x: 288, y: 96 }, { x: 352, y: 96 }]),
    ];
    const result = await runTransientAnalysis(
      { components: [...components, Cout, gndCout], wires: wires2 },
      { stopTime: 2e-4, steps: 200 },
    );
    expect(result.ok, result.ok ? "" : `Transient failed: ${(result as { message: string }).message}`).toBe(true);
    if (!result.ok) return;

    const expected = 11;
    const outTrace = result.traces.find(
      (t) => Math.abs(t.values[t.values.length - 1] - expected) < 2,
    );
    expect(outTrace).toBeDefined();
    if (outTrace) {
      const finalVout = outTrace.values[outTrace.values.length - 1];
      expect(Math.abs((finalVout - expected) / expected)).toBeLessThan(0.01);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 3 - Unity buffer (voltage follower, gain = 1)
//
// Layout:
//   V1   vsource at (64,144):  p=(64,112),  n=(64,176)
//   U1   opamp   at (192,96):  in+=(160,112), in-=(160,80), out=(224,96)
//   GND_v1 at (64,176): V1.n
//
// Wires:
//   V1.p(64,112) → in+(160,112): horizontal
//   out(224,96)  → (224,80) → in-(160,80): L-shaped (direct feedback)
//
// Expected: Vout = Vin = 1 V (gain = 1)
// ---------------------------------------------------------------------------
describe("Unity buffer - gain = 1", () => {
  const V1     = vsource(64, 144, "1", "V1");
  const U1     = opamp(192, 96, "U1");
  const gndV1  = ground(64, 176);

  const components = [V1, U1, gndV1];
  const wires = [
    // V1.p(64,112) → in+(160,112)
    wire([{ x: 64, y: 112 }, { x: 160, y: 112 }]),
    // Feedback: out(224,96) → (224,80) → in-(160,80)
    wire([{ x: 224, y: 96 }, { x: 224, y: 80 }, { x: 160, y: 80 }]),
  ];

  it("DC operating-point: Vout ≈ 1 V (Vin, within 1%)", () => {
    const result = runOperatingPoint({ components, wires });
    expect(result.ok, result.ok ? "" : `OP failed: ${(result as { message: string }).message}`).toBe(true);
    if (!result.ok) return;

    // The output net should be the net containing out(224,96) and in-(160,80).
    // It should read ~1 V.
    const expected = 1;
    const outNet = result.nets.find((n) => n.id !== "0" && Math.abs(n.voltage - expected) < 0.1);
    expect(outNet).toBeDefined();
    if (outNet) {
      expect(Math.abs((outNet.voltage - expected) / expected)).toBeLessThan(0.01);
    }
  });

  it("transient last-sample: Vout ≈ 1 V (within 1%)", async () => {
    const Cout = capacitor(288, 128, "100n", "Cout");
    const gndCout = ground(288, 160);
    const wires2 = [
      ...wires,
      // out(224,96) → Cout.a(288,96)
      wire([{ x: 224, y: 96 }, { x: 288, y: 96 }]),
    ];
    const result = await runTransientAnalysis(
      { components: [...components, Cout, gndCout], wires: wires2 },
      { stopTime: 2e-4, steps: 200 },
    );
    expect(result.ok, result.ok ? "" : `Transient failed: ${(result as { message: string }).message}`).toBe(true);
    if (!result.ok) return;

    const expected = 1;
    const outTrace = result.traces.find(
      (t) => Math.abs(t.values[t.values.length - 1] - expected) < 0.1,
    );
    expect(outTrace).toBeDefined();
    if (outTrace) {
      const finalVout = outTrace.values[outTrace.values.length - 1];
      expect(Math.abs((finalVout - expected) / expected)).toBeLessThan(0.01);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 4 - gmin smoke test: op-amp with unconnected v+/v- rails
//
// A minimal inverting-amp circuit where v+ and v- are deliberately left
// floating (no connection, no ground). The solver must return ok=true
// (gmin anchors the floating nodes to ~0 V, preventing a singular matrix).
// ---------------------------------------------------------------------------
describe("gmin smoke test - unconnected op-amp power rails", () => {
  /**
   * Same inverting-amp as Test 1, but we explicitly confirm the v+/v- pins
   * of the op-amp have NO connection (no ground, no wire). This tests the
   * gmin path: without gmin those floating nets would make the matrix singular.
   *
   * The op-amp at (256,96) has v+ at (256,64) and v- at (256,128).
   * Neither coordinate appears in any component or wire below.
   */
  const V1      = vsource(64, 112, "1", "V1");
  const U1      = opamp(256, 96, "U1");
  const Rin     = resistor(160, 80, "1k", "Rin");
  const Rf      = resistor(256, 80, "10k", "Rf");
  const gndV1   = ground(64, 144);
  const gndPlus = ground(224, 112); // in+ grounded; v+ and v- are NOT connected

  const components = [V1, U1, Rin, Rf, gndV1, gndPlus];
  const wires = [
    wire([{ x: 64, y: 80 }, { x: 128, y: 80 }]),    // V1.p → Rin.a
    wire([{ x: 192, y: 80 }, { x: 224, y: 80 }]),   // Rin.b → in-
    wire([{ x: 288, y: 80 }, { x: 288, y: 96 }]),   // Rf.b → out
  ];

  it("transient solver returns ok=true despite floating v+/v- rails", async () => {
    const result = await runTransientAnalysis(
      { components, wires },
      { stopTime: 1e-4, steps: 50 },
    );
    expect(result.ok).toBe(true);
  });

  it("OP solver returns ok=true despite floating v+/v- rails", () => {
    const result = runOperatingPoint({ components, wires });
    expect(result.ok).toBe(true);
  });
});
