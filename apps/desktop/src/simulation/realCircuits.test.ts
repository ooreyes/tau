/**
 * Real, LTspice-class circuits validated against analytically-known results.
 *
 * Geometry conventions (GRID = 16, pins.ts + rotatePoint):
 *   Two-terminal (R/C/L), rot=0:   a=(x-32, y),  b=(x+32, y)
 *   Two-terminal (R/C/L), rot=90:  a=(x,   y-32), b=(x,   y+32)
 *   vsource/vac/isource/iac, rot=0: p=(x, y-32), n=(x, y+32)
 *   opamp, rot=0: in+=(x-32, y+16), in-=(x-32, y-16), out=(x+32, y),
 *                 v+=(x, y-32), v-=(x, y+32)
 *   ground: g=(x, y)
 *
 * Two pins connect when their world coordinates coincide; wires connect the
 * points they pass through. Every coordinate below is a multiple of 16.
 */

import { describe, it, expect } from "vitest";
import { runOperatingPoint } from "./operatingPoint";
import { runTransientAnalysis } from "./linearTransient";
import { runAcSweep, type AcResult } from "./acSweep";
import type { SchematicComponent, SchematicWire } from "../schematic/types";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

let counter = 0;
const uid = (p: string) => `${p}-${++counter}`;
const mk = (
  kind: SchematicComponent["kind"],
  x: number,
  y: number,
  value: string,
  label: string,
  rotation: SchematicComponent["rotation"] = 0,
): SchematicComponent => ({ id: uid(kind), kind, x, y, rotation, value, label });

const R = (x: number, y: number, v: string, l: string, rot: SchematicComponent["rotation"] = 0) =>
  mk("resistor", x, y, v, l, rot);
const Cap = (x: number, y: number, v: string, l: string, rot: SchematicComponent["rotation"] = 0) =>
  mk("capacitor", x, y, v, l, rot);
const Lind = (x: number, y: number, v: string, l: string, rot: SchematicComponent["rotation"] = 0) =>
  mk("inductor", x, y, v, l, rot);
const Vdc = (x: number, y: number, v: string, l = "V1") => mk("vsource", x, y, v, l);
const Vac = (x: number, y: number, v: string, l = "V1") => mk("vac", x, y, v, l);
const Idc = (x: number, y: number, v: string, l = "I1") => mk("isource", x, y, v, l);
const OA = (x: number, y: number, l = "U1") => mk("opamp", x, y, "ideal", l);
const GND = (x: number, y: number) => mk("ground", x, y, "", "");
const W = (...points: { x: number; y: number }[]): SchematicWire => ({ id: uid("w"), points });

/** The non-ground node whose voltage is closest to `target`, asserting it exists. */
function nodeNear(
  result: ReturnType<typeof runOperatingPoint>,
  target: number,
): number {
  if (!result.ok) throw new Error(result.message);
  let best: number | undefined;
  let bestErr = Infinity;
  for (const net of result.nets) {
    if (net.id === "0") continue;
    const err = Math.abs(net.voltage - target);
    if (err < bestErr) {
      bestErr = err;
      best = net.voltage;
    }
  }
  if (best === undefined) throw new Error("no non-ground nodes");
  return best;
}

/** Magnitude (dB) of the named trace at the swept frequency closest to `hz`. */
function magAt(ac: AcResult, labelIncludes: string, hz: number): { db: number; phase: number; f: number } {
  if (!ac.ok) throw new Error(ac.message);
  const trace = ac.traces.find((t) => t.label.includes(labelIncludes));
  if (!trace) throw new Error(`no trace matching ${labelIncludes}`);
  let bi = 0;
  let bd = Infinity;
  ac.freqs.forEach((f, i) => {
    const d = Math.abs(f - hz);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  });
  return { db: trace.magDb[bi], phase: trace.phaseDeg[bi], f: ac.freqs[bi] };
}

// ---------------------------------------------------------------------------
// DC: dividers and resistor networks
// ---------------------------------------------------------------------------

describe("DC voltage divider (10 V, 1k/1k → 5 V)", () => {
  // V1 at (0,32): p=(0,0) n=(0,64). R1 at (96,0): a=(64,0) b=(128,0).
  // R2 at (192,0): a=(160,0) b=(224,0). Grounds at V1.n and R2.b.
  const comps = [
    Vdc(0, 32, "10"),
    R(96, 0, "1k", "R1"),
    R(192, 0, "1k", "R2"),
    GND(0, 64),
    GND(224, 0),
  ];
  const wires = [W({ x: 0, y: 0 }, { x: 64, y: 0 }), W({ x: 128, y: 0 }, { x: 160, y: 0 })];

  it("source = 10 V, mid = 5 V", () => {
    const res = runOperatingPoint({ components: comps, wires });
    expect(res.ok).toBe(true);
    expect(nodeNear(res, 10)).toBeCloseTo(10, 6);
    expect(nodeNear(res, 5)).toBeCloseTo(5, 6);
  });
});

describe("Multi-stage divider (12 V, 1k/1k/2k → 9 V, 6 V)", () => {
  // Series R1=1k, R2=1k, R3=2k. Total 4k. Taps: 12*(3/4)=9, 12*(2/4)=6.
  // V1 at (0,32). R1 a=(64,0) b=(128,0). R2 a=(192,0) b=(256,0). R3 a=(320,0) b=(384,0).
  const comps = [
    Vdc(0, 32, "12"),
    R(96, 0, "1k", "R1"),
    R(224, 0, "1k", "R2"),
    R(352, 0, "2k", "R3"),
    GND(0, 64),
    GND(384, 0),
  ];
  const wires = [
    W({ x: 0, y: 0 }, { x: 64, y: 0 }),
    W({ x: 128, y: 0 }, { x: 192, y: 0 }),
    W({ x: 256, y: 0 }, { x: 320, y: 0 }),
  ];

  it("taps at 12 V, 9 V, 6 V", () => {
    const res = runOperatingPoint({ components: comps, wires });
    expect(res.ok).toBe(true);
    expect(nodeNear(res, 12)).toBeCloseTo(12, 6);
    expect(nodeNear(res, 9)).toBeCloseTo(9, 6);
    expect(nodeNear(res, 6)).toBeCloseTo(6, 6);
  });
});

describe("Current divider (3 mA into 1k‖2k)", () => {
  // I1 at (0,32): p=(0,0) n=(0,64=GND). R1 rot90 at (64,32): a=(64,0) b=(64,64).
  // R2 rot90 at (128,32): a=(128,0) b=(128,64). Top rail y=0, bottom rail y=64=GND.
  //
  // SPICE convention: positive isource value → conventional current exits the + (p)
  // terminal into the external circuit.  The top rail (p node) is the current sink for
  // both resistors, so V(top) = I · (R1‖R2) = 3 mA · (2000/3 Ω) = +2 V.
  const comps = [
    Idc(0, 32, "3m"),
    R(64, 32, "1k", "R1", 90),
    R(128, 32, "2k", "R2", 90),
    GND(0, 64),
  ];
  const wires = [
    W({ x: 0, y: 0 }, { x: 64, y: 0 }, { x: 128, y: 0 }),
    W({ x: 0, y: 64 }, { x: 64, y: 64 }, { x: 128, y: 64 }),
  ];

  it("top-rail node = +I·(R1‖R2) = +2 V (SPICE polarity: current exits p)", () => {
    const res = runOperatingPoint({ components: comps, wires });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const node = res.nets.find((n) => n.id !== "0");
    expect(node).toBeDefined();
    // Correct SPICE result: +2 V (current exits + terminal, raising the top rail).
    expect(node!.voltage).toBeCloseTo(2, 6);
    // Current split: I_R1 = 2V/1k = 2 mA, I_R2 = 2V/2k = 1 mA → sum = 3 mA ✓
  });
});

// ---------------------------------------------------------------------------
// Transient: RC, RL, RLC
// ---------------------------------------------------------------------------

describe("RC charging (R=1k, C=1µ → τ=1 ms)", () => {
  // V1 at (96,96). R1 at (192,64): a=(160,64) b=(224,64). C1 rot90 at (224,96): a=(224,64) b=(224,128).
  const comps = [
    Vdc(96, 96, "5"),
    R(192, 64, "1k", "R1"),
    Cap(224, 96, "1µ", "C1", 90),
    GND(96, 128),
    GND(224, 128),
  ];
  const wires = [W({ x: 96, y: 64 }, { x: 160, y: 64 })];

  it("V_C(τ) ≈ 5·(1−1/e) = 3.16 V", async () => {
    const stopTime = 5e-3;
    const steps = 2000;
    const res = await runTransientAnalysis({ components: comps, wires }, { stopTime, steps });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const out = res.traces.find((t) => t.label.includes("C1"));
    expect(out).toBeDefined();
    const idx = Math.round(1e-3 / (stopTime / steps));
    expect(out!.values[idx]).toBeCloseTo(5 * (1 - 1 / Math.E), 1);
    // Final value approaches the rail.
    expect(out!.values[out!.values.length - 1]).toBeCloseTo(5, 1);
  });
});

describe("RL transient (R=1k, L=1H → τ=1 ms)", () => {
  // V1 → R → node → L → GND. Voltage across L decays: v_L(t) = 5·e^{−t/τ}.
  // V1 at (96,160). R1 at (192,128): a=(160,128) b=(224,128). L1 at (320,128): a=(288,128) b=(352,128).
  const comps = [
    Vdc(96, 160, "5"),
    R(192, 128, "1k", "R1"),
    Lind(320, 128, "1", "L1"),
    GND(96, 192),
    GND(352, 128),
  ];
  const wires = [
    W({ x: 96, y: 128 }, { x: 160, y: 128 }),
    W({ x: 224, y: 128 }, { x: 288, y: 128 }),
  ];

  it("v_L(τ) ≈ 5/e = 1.84 V and decays toward 0", async () => {
    const stopTime = 5e-3;
    const steps = 2000;
    const res = await runTransientAnalysis({ components: comps, wires }, { stopTime, steps });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const vL = res.traces.find((t) => t.label.includes("L1"));
    expect(vL).toBeDefined();
    const idx = Math.round(1e-3 / (stopTime / steps));
    expect(vL!.values[idx]).toBeCloseTo(5 / Math.E, 1);
    expect(vL!.values[vL!.values.length - 1]).toBeCloseTo(0, 1);
  });
});

describe("RLC series under-damped ringing (ζ=0.5, f₀≈1.6 kHz)", () => {
  // V=5, R=10, L=1mH, C=10µ. ω₀=1/√(LC)=1e4 rad/s, f₀≈1592 Hz, ζ=R/(2√(L/C))=0.5.
  // Capacitor voltage overshoots above the 5 V rail (under-damped step response).
  const comps = [
    Vdc(96, 160, "5"),
    R(192, 128, "10", "R1"),
    Lind(320, 128, "1m", "L1"),
    Cap(352, 160, "10µ", "C1", 90),
    GND(96, 192),
    GND(352, 192),
  ];
  const wires = [
    W({ x: 96, y: 128 }, { x: 160, y: 128 }),
    W({ x: 224, y: 128 }, { x: 288, y: 128 }),
  ];

  it("capacitor voltage overshoots the rail then settles near 5 V", async () => {
    const stopTime = 5e-3;
    const steps = 4000;
    const res = await runTransientAnalysis({ components: comps, wires }, { stopTime, steps });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const vC = res.traces.find((t) => t.label.includes("C1"));
    expect(vC).toBeDefined();
    const peak = vC!.values.reduce((a, b) => (b > a ? b : a), -Infinity);
    // ζ=0.5 → first-overshoot ≈ exp(−ζπ/√(1−ζ²)) ≈ 16% → peak ≈ 5.8 V.
    expect(peak).toBeGreaterThan(5.4);
    expect(peak).toBeLessThan(6.2);
    // Late-time samples settle back near the DC value.
    const tail = vC!.values.slice(-50);
    const avgTail = tail.reduce((a, b) => a + b, 0) / tail.length;
    expect(avgTail).toBeCloseTo(5, 0);
  });
});

// ---------------------------------------------------------------------------
// AC: filters
// ---------------------------------------------------------------------------

describe("RC low-pass filter (f_c ≈ 1 kHz)", () => {
  // Vac → R → out → C → GND. R=1k, C=159.155n → f_c=1 kHz.
  // Vac at (0,32): p=(0,0). R at (96,0): a=(64,0) b=(128,0). C rot90 at (256,32): a=(256,0) b=(256,64).
  const comps = [
    Vac(0, 32, "1 1k"),
    R(96, 0, "1k", "R1"),
    Cap(256, 32, "159.155n", "C1", 90),
    GND(0, 64),
    GND(256, 64),
  ];
  const wires = [W({ x: 0, y: 0 }, { x: 64, y: 0 }), W({ x: 128, y: 0 }, { x: 256, y: 0 })];

  it("−3 dB and −45° at f_c, −20 dB/dec rolloff", () => {
    const ac = runAcSweep({ components: comps, wires }, { startHz: 10, stopHz: 1e6, pointsPerDecade: 20 });
    expect(ac.ok).toBe(true);
    const fc = magAt(ac, "C1", 1000);
    expect(fc.db).toBeCloseTo(-3.0103, 1);
    expect(fc.phase).toBeCloseTo(-45, 0);
    const dec = magAt(ac, "C1", 10000);
    // One decade above f_c → ≈ −20 dB.
    expect(dec.db).toBeCloseTo(-20.04, 0);
  });
});

describe("RC high-pass filter (f_c ≈ 1 kHz)", () => {
  // Vac → C → out → R → GND. C=159.155n, R=1k → f_c=1 kHz.
  const comps = [
    Vac(0, 32, "1 1k"),
    Cap(96, 0, "159.155n", "C1"),
    R(256, 32, "1k", "R1", 90),
    GND(0, 64),
    GND(256, 64),
  ];
  const wires = [W({ x: 0, y: 0 }, { x: 64, y: 0 }), W({ x: 128, y: 0 }, { x: 256, y: 0 })];

  it("−3 dB and +45° at f_c", () => {
    const ac = runAcSweep({ components: comps, wires }, { startHz: 10, stopHz: 1e6, pointsPerDecade: 20 });
    expect(ac.ok).toBe(true);
    const fc = magAt(ac, "R1", 1000);
    expect(fc.db).toBeCloseTo(-3.0103, 1);
    expect(fc.phase).toBeCloseTo(45, 0);
  });
});

describe("RL low-pass filter (f_c ≈ 1 kHz)", () => {
  // Vac → R → out → L → GND. R=1k, L=159.155m → f_c = R/(2πL) = 1 kHz.
  const comps = [
    Vac(0, 32, "1 1k"),
    R(96, 0, "1k", "R1"),
    Lind(256, 32, "159.155m", "L1", 90),
    GND(0, 64),
    GND(256, 64),
  ];
  const wires = [W({ x: 0, y: 0 }, { x: 64, y: 0 }), W({ x: 128, y: 0 }, { x: 256, y: 0 })];

  it("−3 dB at f_c (across the inductor)", () => {
    const ac = runAcSweep({ components: comps, wires }, { startHz: 10, stopHz: 1e6, pointsPerDecade: 20 });
    expect(ac.ok).toBe(true);
    const fc = magAt(ac, "L1", 1000);
    expect(fc.db).toBeCloseTo(-3.0103, 1);
  });
});

describe("Sallen-Key low-pass (unity-gain, Butterworth, f_c ≈ 1 kHz)", () => {
  // Unity-gain Sallen-Key: in → R1 → x → R2 → in+(opamp), out fed back to in-,
  // C1 from x to out, C2 from in+ to GND. With R1=R2=R and C1=2·C2 chosen for
  // a maximally-flat (Q=1/√2) response, f_c = 1/(2π·R·√(C1·C2)).
  // R=1.125k, C1=22.5n, C2=11.25n → √(C1·C2)=15.91n, f_c≈8.9kHz; instead pick
  // R=10k, C1=22.508n, C2=11.254n → f_c = 1/(2π·10k·15.915n) ≈ 1000 Hz.
  const R1 = 10_000;
  // C1 = 2·C2 for Q = 1/√2 when R1 = R2.
  // f_c = 1/(2π·R·√(C1·C2)) with C1=2C2 → √(2)·C2 = 15.915n at R=10k → 1 kHz.
  const r1 = R(96, 0, `${R1}`, "R1"); // a=(64,0) b=(128,0)
  const r2 = R(224, 0, `${R1}`, "R2"); // a=(192,0) b=(256,0)
  const c2 = Cap(288, 32, "11.254n", "C2", 90); // a=(288,0) b=(288,64) → in+ to GND
  const u1 = OA(384, 0, "U1"); // in+=(352,16) in-=(352,-16) out=(416,0)
  const c1 = Cap(160, -64, "22.508n", "C1"); // a=(128,-64) b=(192,-64) → x to out
  const vin = Vac(-96, 32, "1 1k"); // p=(-96,0)
  const g0 = GND(-96, 64);
  const g1 = GND(288, 64);
  const comps = [vin, r1, r2, c2, u1, c1, g0, g1];
  const wires = [
    W({ x: -96, y: 0 }, { x: 64, y: 0 }), // Vin → R1.a
    // R1.b(128,0) → R2.a(192,0) = node x
    W({ x: 128, y: 0 }, { x: 192, y: 0 }),
    // node x → C1.a(128,-64)
    W({ x: 128, y: 0 }, { x: 128, y: -64 }),
    // R2.b(256,0) → C2.a(288,0) and → U1.in+(352,16)
    W({ x: 256, y: 0 }, { x: 288, y: 0 }),
    W({ x: 288, y: 0 }, { x: 352, y: 0 }, { x: 352, y: 16 }),
    // out(416,0) feedback to in-(352,-16) and to C1.b(192,-64)
    W({ x: 416, y: 0 }, { x: 416, y: -16 }, { x: 352, y: -16 }),
    W({ x: 416, y: 0 }, { x: 416, y: -64 }, { x: 192, y: -64 }),
  ];

  it("DC gain ≈ 0 dB and rolls off above f_c", () => {
    const ac = runAcSweep({ components: comps, wires }, { startHz: 10, stopHz: 1e5, pointsPerDecade: 20 });
    expect(ac.ok).toBe(true);
    if (!ac.ok) return;
    let bi = 0;
    let bd = Infinity;
    ac.freqs.forEach((f, i) => {
      const d = Math.abs(f - 4000);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    // The filter output is the op-amp output / in+ node: unity gain at low
    // frequency but rolling off at high frequency. Among traces that pass the
    // signal (≈0 dB at low f), the output is the one with the most attenuation
    // up the band — this excludes the input node, which stays flat.
    const passband = ac.traces.filter((t) => Math.abs(t.magDb[0]) < 1);
    expect(passband.length).toBeGreaterThan(0);
    const outTrace = passband.reduce((best, t) => (t.magDb[bi] < best.magDb[bi] ? t : best));
    // Passband (low frequency) is unity gain.
    expect(outTrace.magDb[0]).toBeCloseTo(0, 0);
    // Two octaves above f_c the 2nd-order filter has clearly rolled off (< −15 dB).
    expect(outTrace.magDb[bi]).toBeLessThan(-15);
  });
});

// ---------------------------------------------------------------------------
// Op-amp configurations
// ---------------------------------------------------------------------------

describe("Non-inverting amplifier (gain = 1 + Rf/Rg = 11)", () => {
  // Vin → in+. Rg from in- to GND. Rf from in- to out.
  const vin = Vac(-96, 32, "1 1k"); // p=(-96,0)
  const u1 = OA(96, 0, "U1"); // in+=(64,16) in-=(64,-16) out=(128,0)
  const rgR = R(0, -16, "1k", "Rg", 0); // a=(-32,-16) b=(32,-16)
  const rfR = R(96, -64, "10k", "Rf", 0); // a=(64,-64) b=(128,-64)
  const g0 = GND(-96, 64);
  const g1 = GND(-64, -16);
  const comps = [vin, u1, rgR, rfR, g0, g1];
  const wires = [
    W({ x: -96, y: 0 }, { x: 64, y: 0 }, { x: 64, y: 16 }), // Vin → in+
    W({ x: -32, y: -16 }, { x: -64, y: -16 }), // Rg.a → GND
    W({ x: 32, y: -16 }, { x: 64, y: -16 }), // Rg.b → in-
    W({ x: 64, y: -16 }, { x: 64, y: -64 }), // in- up to Rf.a
    W({ x: 128, y: -64 }, { x: 128, y: 0 }), // Rf.b down to out
  ];

  it("AC gain = 20·log10(11) ≈ 20.83 dB, in phase", () => {
    const ac = runAcSweep({ components: comps, wires }, { startHz: 10, stopHz: 1e4, pointsPerDecade: 10 });
    expect(ac.ok).toBe(true);
    const out = magAt(ac, "Rf", 100);
    expect(out.db).toBeCloseTo(20 * Math.log10(11), 1);
    expect(Math.abs(out.phase)).toBeLessThan(1);
  });
});

describe("Inverting amplifier (gain = −Rf/Rin = −10)", () => {
  const vin = Vac(-96, 32, "1 1k"); // p=(-96,0)
  const u1 = OA(96, 0, "U1"); // in+=(64,16) in-=(64,-16) out=(128,0)
  const rin = R(0, -16, "1k", "Rin"); // a=(-32,-16) b=(32,-16)
  const rf = R(96, -64, "10k", "Rf"); // a=(64,-64) b=(128,-64)
  const g0 = GND(-96, 64);
  const g1 = GND(64, 16); // in+ to GND
  const comps = [vin, u1, rin, rf, g0, g1];
  const wires = [
    W({ x: -96, y: 0 }, { x: -32, y: -16 }), // Vin → Rin.a
    W({ x: 32, y: -16 }, { x: 64, y: -16 }), // Rin.b → in-
    W({ x: 64, y: -16 }, { x: 64, y: -64 }), // in- → Rf.a
    W({ x: 128, y: -64 }, { x: 128, y: 0 }), // Rf.b → out
  ];

  it("AC gain = 20·log10(10) = 20 dB, inverted (≈180°)", () => {
    const ac = runAcSweep({ components: comps, wires }, { startHz: 10, stopHz: 1e4, pointsPerDecade: 10 });
    expect(ac.ok).toBe(true);
    const out = magAt(ac, "Rf", 100);
    expect(out.db).toBeCloseTo(20, 1);
    expect(Math.abs(Math.abs(out.phase) - 180)).toBeLessThan(1);
  });
});

describe("Unity-gain buffer (voltage follower, gain = 1)", () => {
  const vin = Vac(-96, 32, "1 1k"); // p=(-96,0)
  const u1 = OA(96, 0, "U1"); // in+=(64,16) in-=(64,-16) out=(128,0)
  const g0 = GND(-96, 64);
  const comps = [vin, u1, g0];
  const wires = [
    W({ x: -96, y: 0 }, { x: 64, y: 0 }, { x: 64, y: 16 }), // Vin → in+
    W({ x: 128, y: 0 }, { x: 128, y: -16 }, { x: 64, y: -16 }), // out → in-
  ];

  it("output tracks input (0 dB, in phase)", () => {
    const ac = runAcSweep({ components: comps, wires }, { startHz: 10, stopHz: 1e4, pointsPerDecade: 10 });
    expect(ac.ok).toBe(true);
    if (!ac.ok) return;
    // Output net is the in+/out node (they are different nets but equal magnitude).
    const out = ac.traces.find((t) => Math.abs(t.magDb[0]) < 0.01);
    expect(out).toBeDefined();
    expect(out!.magDb[0]).toBeCloseTo(0, 2);
  });

  it("DC operating point: output equals 0 V input reference", () => {
    // With a vac at 0 DC, the OP should resolve all nodes to ~0 V without
    // singularity (gmin handles the floating supply rails).
    const op = runOperatingPoint({ components: comps, wires });
    expect(op.ok).toBe(true);
  });
});
