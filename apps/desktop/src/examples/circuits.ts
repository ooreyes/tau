/**
 * Built-in example circuits for the Tau circuit simulator.
 *
 * GRID = 16. ALL component x/y and wire point coordinates are multiples of 16.
 *
 * Pin world-coordinate formulas (from pins.ts + rotatePoint):
 *   resistor/capacitor/inductor, rot=0:  a=(x-32, y),   b=(x+32, y)
 *   resistor/capacitor/inductor, rot=90: a=(x,    y-32), b=(x,    y+32)
 *   vsource, rot=0:                      p=(x,    y-32), n=(x,    y+32)
 *   ground:                              g=(x,    y)
 */

import type { SchematicComponent, SchematicWire } from "../schematic/types";

export interface ExampleCircuit {
  id: string;
  name: string;
  description: string;
  components: SchematicComponent[];
  wires: SchematicWire[];
}

// ---------------------------------------------------------------------------
// Circuit 1 — RC Charging (the flagship; τ = RC = 1 ms)
//
// Components and world pin coordinates:
//   V1  vsource rot=0 at (96, 96):      p=(96,64),   n=(96,128)
//   R1  resistor rot=0 at (192, 64):    a=(160,64),  b=(224,64)
//   C1  capacitor rot=90 at (224, 96):  a=(224,64),  b=(224,128)
//   GND1 ground at (96, 128):           g=(96,128)
//   GND2 ground at (224, 128):          g=(224,128)
//
// Net connections:
//   N1 (top): V1.p(96,64) ─── wire ─── R1.a(160,64)
//   N2 (RC node): R1.b(224,64) == C1.a(224,64)  [coincident, no wire needed]
//   GND: V1.n(96,128) == GND1.g(96,128)  [coincident]
//        C1.b(224,128) == GND2.g(224,128) [coincident]
//
// τ = R × C = 1000 Ω × 1×10⁻⁶ F = 1 ms
// ---------------------------------------------------------------------------
const RC_CHARGING: ExampleCircuit = {
  id: "rc.v1",
  name: "RC Charging",
  description: "Classic RC series circuit: 5 V source charges a 1 µF capacitor through a 1 kΩ resistor. τ = RC = 1 ms.",
  components: [
    { id: "rc1.v1",   kind: "vsource",   x: 96,  y: 96,  rotation: 0, value: "5",   label: "V1" },
    { id: "rc1.r1",   kind: "resistor",  x: 192, y: 64,  rotation: 0, value: "1k",  label: "R1" },
    { id: "rc1.c1",   kind: "capacitor", x: 224, y: 96,  rotation: 90, value: "1µ", label: "C1" },
    { id: "rc1.gnd1", kind: "ground",    x: 96,  y: 128, rotation: 0, value: "",    label: "" },
    { id: "rc1.gnd2", kind: "ground",    x: 224, y: 128, rotation: 0, value: "",    label: "" },
  ],
  wires: [
    // V1.p(96,64) → R1.a(160,64): horizontal segment along y=64
    { id: "rc1.w1", points: [{ x: 96, y: 64 }, { x: 160, y: 64 }] },
  ],
};

// ---------------------------------------------------------------------------
// Circuit 2 — RC Low-Pass Filter (R=10 kΩ, C=10 nF, τ = 100 µs)
//
// Components and world pin coordinates:
//   V1   vsource rot=0 at (96, 96):      p=(96,64),   n=(96,128)
//   R1   resistor rot=0 at (192, 64):    a=(160,64),  b=(224,64)
//   C1   capacitor rot=90 at (224, 96):  a=(224,64),  b=(224,128)
//   GND1 ground at (96, 128):            g=(96,128)
//   GND2 ground at (224, 128):           g=(224,128)
//
// Net connections:
//   N1 (input): V1.p(96,64) ─── wire ─── R1.a(160,64)
//   N2 (output / filter node): R1.b(224,64) == C1.a(224,64) [coincident]
//   GND: V1.n(96,128) == GND1.g(96,128) [coincident]
//        C1.b(224,128) == GND2.g(224,128) [coincident]
//
// τ = R × C = 10,000 Ω × 10×10⁻⁹ F = 100 µs
// Corner frequency f_c = 1/(2πτ) ≈ 1.59 kHz
// ---------------------------------------------------------------------------
const RC_LOWPASS: ExampleCircuit = {
  id: "rc-lpf.v1",
  name: "RC Low-Pass",
  description: "RC low-pass filter: source → 10 kΩ → output node → 10 nF → GND. τ = 100 µs, f_c ≈ 1.59 kHz.",
  components: [
    { id: "lpf.v1",   kind: "vsource",   x: 96,  y: 96,  rotation: 0, value: "5",    label: "V1" },
    { id: "lpf.r1",   kind: "resistor",  x: 192, y: 64,  rotation: 0, value: "10k",  label: "R1" },
    { id: "lpf.c1",   kind: "capacitor", x: 224, y: 96,  rotation: 90, value: "10n", label: "C1" },
    { id: "lpf.gnd1", kind: "ground",    x: 96,  y: 128, rotation: 0, value: "",     label: "" },
    { id: "lpf.gnd2", kind: "ground",    x: 224, y: 128, rotation: 0, value: "",     label: "" },
  ],
  wires: [
    // V1.p(96,64) → R1.a(160,64): horizontal segment along y=64
    { id: "lpf.w1", points: [{ x: 96, y: 64 }, { x: 160, y: 64 }] },
  ],
};

// ---------------------------------------------------------------------------
// Circuit 3 — Voltage Divider (V=10 V, R1=1 kΩ top, R2=1 kΩ bottom → Vmid = 5 V)
//
// Components and world pin coordinates:
//   V1   vsource rot=0 at (96, 96):     p=(96,64),    n=(96,128)
//   R1   resistor rot=90 at (160, 64):  a=(160,32),   b=(160,96)
//   R2   resistor rot=90 at (160, 128): a=(160,96),   b=(160,160)
//   GND1 ground at (96, 128):           g=(96,128)
//   GND2 ground at (160, 160):          g=(160,160)
//
// Net connections:
//   N1 (top rail): V1.p(96,64) ─── wire(L-shape) ─── R1.a(160,32)
//   N2 (mid node): R1.b(160,96) == R2.a(160,96) [coincident; Vmid = 5 V DC]
//   GND: V1.n(96,128) == GND1.g(96,128) [coincident]
//        R2.b(160,160) == GND2.g(160,160) [coincident]
//
// Vmid = V × R2/(R1+R2) = 10 × 1k/2k = 5 V
// ---------------------------------------------------------------------------
const VOLTAGE_DIVIDER: ExampleCircuit = {
  id: "divider.v1",
  name: "Voltage Divider",
  description: "Resistive voltage divider: 10 V through two equal 1 kΩ resistors. Mid-node settles at 5 V.",
  components: [
    { id: "div.v1",   kind: "vsource",  x: 96,  y: 96,  rotation: 0,  value: "10", label: "V1" },
    { id: "div.r1",   kind: "resistor", x: 160, y: 64,  rotation: 90, value: "1k", label: "R1" },
    { id: "div.r2",   kind: "resistor", x: 160, y: 128, rotation: 90, value: "1k", label: "R2" },
    { id: "div.gnd1", kind: "ground",   x: 96,  y: 128, rotation: 0,  value: "",   label: "" },
    { id: "div.gnd2", kind: "ground",   x: 160, y: 160, rotation: 0,  value: "",   label: "" },
  ],
  wires: [
    // V1.p(96,64) → right to (160,64) → up to R1.a(160,32): L-shaped
    { id: "div.w1", points: [{ x: 96, y: 64 }, { x: 160, y: 64 }, { x: 160, y: 32 }] },
  ],
};

// ---------------------------------------------------------------------------
// Circuit 4 — RLC Series (under-damped ringing, ζ = 0.5)
//
// Values: V=5 V, R=10 Ω, L=1 mH, C=10 µF
//   ω₀ = 1/√(LC) = 1/√(1e-3 × 10e-6) = 10,000 rad/s → f₀ ≈ 1592 Hz
//   ζ  = R/(2√(L/C)) = 10 / (2√(100)) = 10/20 = 0.5  → under-damped
//   Period ≈ 628 µs, so ~8 full oscillation cycles within 5 ms.
//
// Components and world pin coordinates:
//   V1   vsource rot=0 at (96, 160):    p=(96,128),   n=(96,192)
//   R1   resistor rot=0 at (192, 128):  a=(160,128),  b=(224,128)
//   L1   inductor rot=0 at (320, 128):  a=(288,128),  b=(352,128)
//   C1   capacitor rot=90 at (352, 160): a=(352,128), b=(352,192)
//   GND1 ground at (96, 192):           g=(96,192)
//   GND2 ground at (352, 192):          g=(352,192)
//
// Net connections:
//   N1: V1.p(96,128) ─── wire ─── R1.a(160,128)
//   N2: R1.b(224,128) ─── wire ─── L1.a(288,128)
//   N3: L1.b(352,128) == C1.a(352,128) [coincident]
//   GND: V1.n(96,192) == GND1.g(96,192) [coincident]
//        C1.b(352,192) == GND2.g(352,192) [coincident]
// ---------------------------------------------------------------------------
const RLC_SERIES: ExampleCircuit = {
  id: "rlc.v1",
  name: "RLC Series",
  description: "Series RLC: 5 V, R=10 Ω, L=1 mH, C=10 µF. ζ=0.5 → under-damped ringing at ≈1.6 kHz (~8 cycles in 5 ms).",
  components: [
    { id: "rlc.v1",   kind: "vsource",   x: 96,  y: 160, rotation: 0,  value: "5",    label: "V1" },
    { id: "rlc.r1",   kind: "resistor",  x: 192, y: 128, rotation: 0,  value: "10",   label: "R1" },
    { id: "rlc.l1",   kind: "inductor",  x: 320, y: 128, rotation: 0,  value: "1m",   label: "L1" },
    { id: "rlc.c1",   kind: "capacitor", x: 352, y: 160, rotation: 90, value: "10µ",  label: "C1" },
    { id: "rlc.gnd1", kind: "ground",    x: 96,  y: 192, rotation: 0,  value: "",     label: "" },
    { id: "rlc.gnd2", kind: "ground",    x: 352, y: 192, rotation: 0,  value: "",     label: "" },
  ],
  wires: [
    // V1.p(96,128) → R1.a(160,128): horizontal along y=128
    { id: "rlc.w1", points: [{ x: 96, y: 128 }, { x: 160, y: 128 }] },
    // R1.b(224,128) → L1.a(288,128): horizontal along y=128
    { id: "rlc.w2", points: [{ x: 224, y: 128 }, { x: 288, y: 128 }] },
  ],
};

// ---------------------------------------------------------------------------
// Exported library
// ---------------------------------------------------------------------------
export const EXAMPLE_CIRCUITS: ExampleCircuit[] = [
  RC_CHARGING,
  RC_LOWPASS,
  VOLTAGE_DIVIDER,
  RLC_SERIES,
];
