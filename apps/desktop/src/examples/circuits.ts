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
  /** Uses nonlinear devices (MOSFET/BJT/diode) — only the native ngspice engine
   *  can solve it; the interim TypeScript solver rejects it by design. */
  nativeOnly?: boolean;
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
    // V1.p(96,64) → up to (96,32) → right to R1.a(160,32): stays clear of R1's body.
    { id: "div.w1", points: [{ x: 96, y: 64 }, { x: 96, y: 32 }, { x: 160, y: 32 }] },
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
// Circuit 5 — Non-inverting amplifier (gain = 1 + Rf/Rg = 1 + 10k/1k = 11)
//
// GRID = 16. Op-amp pin geometry (rotation 0):
//   opamp at (cx, cy): in+ at (cx-32, cy+16), in- at (cx-32, cy-16), out at (cx+32, cy)
//                       v+ at (cx, cy-32),     v- at (cx, cy+32)   [unconnected]
//
// Component world-pin coordinates:
//   V1   vac  rot=0 at (64, 144):    p=(64,112),   n=(64,176)
//   U1   opamp   rot=0 at (256, 96): in+=(224,112), in-=(224,80), out=(288,96)
//                                     v+=(256,64), v-=(256,128) [unconnected, gmin handles]
//   Rg   resistor rot=0 at (160, 80): a=(128,80),  b=(192,80)
//   Rf   resistor rot=0 at (256, 80): a=(224,80),  b=(288,80)
//   GND_v1 ground at (64,176):  g=(64,176)   — coincides with V1.n
//   GND_rg ground at (96,80):   g=(96,80)    — short wire from Rg.a
//
// Net connections:
//   N1 (input):  V1.p(64,112) ── wire ── U1.in+(224,112)
//   N2 (in-/fb): Rg.b(192,80) ── wire ── Rf.a=U1.in-(224,80)  [coincident Rf.a and in-]
//   N3 (output): Rf.b(288,80) ── wire ── U1.out(288,96)
//   GND:         GND_v1, GND_rg (Rg.a wired to GND_rg)
//
// Gain = 1 + Rf/Rg = 1 + 10k/1k = 11.  1V 1kHz sine → 11V sine at output.
// AC source (vac) ensures visible transient variation in the waveform viewer.
// ---------------------------------------------------------------------------
const NONINVERTING_AMP: ExampleCircuit = {
  id: "opamp-noninv.v1",
  name: "Non-inverting Amplifier",
  description: "Ideal op-amp non-inverting configuration: gain = 1 + Rf/Rg = 11. 1 V 1 kHz input → 11 V sine output.",
  components: [
    { id: "ni.v1",   kind: "vac",      x: 64,  y: 144, rotation: 0,  value: "1 1k",  label: "V1" },
    { id: "ni.u1",   kind: "opamp",    x: 256, y: 96,  rotation: 0,  value: "ideal", label: "U1" },
    { id: "ni.rg",   kind: "resistor", x: 160, y: 80,  rotation: 0,  value: "1k",    label: "Rg" },
    { id: "ni.rf",   kind: "resistor", x: 256, y: 48,  rotation: 0,  value: "10k",   label: "Rf" },
    { id: "ni.gnd1", kind: "ground",   x: 64,  y: 176, rotation: 0,  value: "",      label: "" },
    { id: "ni.gnd2", kind: "ground",   x: 96,  y: 80,  rotation: 0,  value: "",      label: "" },
  ],
  // Rf is lifted to y=48 (clear above the op-amp body) and the feedback is
  // routed up from the in- node and down into the output, so nothing overlaps.
  wires: [
    // V1.p(64,112) → U1.in+(224,112)
    { id: "ni.w1", points: [{ x: 64, y: 112 }, { x: 224, y: 112 }] },
    // Rg.b(192,80) → U1.in-(224,80)
    { id: "ni.w2", points: [{ x: 192, y: 80 }, { x: 224, y: 80 }] },
    // in-(224,80) → up to Rf.a(224,48)
    { id: "ni.w3", points: [{ x: 224, y: 80 }, { x: 224, y: 48 }] },
    // Rf.b(288,48) → down to U1.out(288,96)
    { id: "ni.w4", points: [{ x: 288, y: 48 }, { x: 288, y: 96 }] },
    // Rg.a(128,80) → GND_rg(96,80), with the ground body left of the resistor.
    { id: "ni.w5", points: [{ x: 128, y: 80 }, { x: 96, y: 80 }] },
  ],
};

// ---------------------------------------------------------------------------
// Circuit 6 — Inverting amplifier (gain = -Rf/Rin = -10k/1k = -10)
//
// Component world-pin coordinates:
//   V1   vac  rot=0 at (64, 112):    p=(64,80),    n=(64,144)
//   U1   opamp   rot=0 at (256, 96): in+=(224,112), in-=(224,80), out=(288,96)
//                                     v+=(256,64), v-=(256,128) [unconnected]
//   Rin  resistor rot=0 at (160, 80): a=(128,80),  b=(192,80)
//   Rf   resistor rot=0 at (256, 80): a=(224,80),  b=(288,80)
//   GND_v1  ground at (64,144):  g=(64,144)  — coincides with V1.n
//   GND_in+ ground at (224,112): g=(224,112) — ties in+ to GND
//
// Net connections:
//   N1 (Vin):    V1.p(64,80) ── wire ── Rin.a(128,80)
//   N2 (in-/fb): Rin.b(192,80) ── wire ── Rf.a=in-(224,80)  [coincident Rf.a and in-]
//   N3 (output): Rf.b(288,80) ── wire ── U1.out(288,96)
//   GND:         GND_v1, GND_in+ (all ground kind)
//
// Gain = -Rf/Rin = -10k/1k = -10.  1V 1kHz sine → −10V inverted sine at output.
// ---------------------------------------------------------------------------
const INVERTING_AMP: ExampleCircuit = {
  id: "opamp-inv.v1",
  name: "Inverting Amplifier",
  description: "Ideal op-amp inverting configuration: gain = -Rf/Rin = -10. 1 V 1 kHz input → −10 V inverted sine output.",
  components: [
    { id: "inv.v1",   kind: "vac",      x: 64,  y: 112, rotation: 0,  value: "1 1k",  label: "V1" },
    { id: "inv.u1",   kind: "opamp",    x: 256, y: 96,  rotation: 0,  value: "ideal", label: "U1" },
    { id: "inv.rin",  kind: "resistor", x: 160, y: 80,  rotation: 0,  value: "1k",    label: "Rin" },
    { id: "inv.rf",   kind: "resistor", x: 256, y: 48,  rotation: 0,  value: "10k",   label: "Rf" },
    { id: "inv.gnd1", kind: "ground",   x: 64,  y: 144, rotation: 0,  value: "",      label: "" },
    { id: "inv.gnd2", kind: "ground",   x: 224, y: 144, rotation: 0,  value: "",      label: "" },
  ],
  // Rf lifted to y=48 above the op-amp; in+ tied to ground below via a short
  // lead so the ground symbol doesn't sit on top of the op-amp triangle.
  wires: [
    // V1.p(64,80) → Rin.a(128,80)
    { id: "inv.w1", points: [{ x: 64, y: 80 }, { x: 128, y: 80 }] },
    // Rin.b(192,80) → U1.in-(224,80)
    { id: "inv.w2", points: [{ x: 192, y: 80 }, { x: 224, y: 80 }] },
    // in-(224,80) → up to Rf.a(224,48)
    { id: "inv.w3", points: [{ x: 224, y: 80 }, { x: 224, y: 48 }] },
    // Rf.b(288,48) → down to U1.out(288,96)
    { id: "inv.w4", points: [{ x: 288, y: 48 }, { x: 288, y: 96 }] },
    // U1.in+(224,112) → GND2(224,144)
    { id: "inv.w5", points: [{ x: 224, y: 112 }, { x: 224, y: 144 }] },
  ],
};

// ---------------------------------------------------------------------------
// Circuit 7 — Unity buffer (voltage follower, gain = 1)
//
// Component world-pin coordinates:
//   V1   vac  rot=0 at (64, 144):    p=(64,112),   n=(64,176)
//   U1   opamp   rot=0 at (192, 96): in+=(160,112), in-=(160,80), out=(224,96)
//                                     v+=(192,64), v-=(192,128) [unconnected]
//   GND_v1 ground at (64,176): g=(64,176) — V1.n
//
// Net connections:
//   N1 (input):  V1.p(64,112) ── wire ── U1.in+(160,112)
//   N2 (output): U1.out(224,96) ── wire → (224,80) → U1.in-(160,80)
//                [output fed back directly to in-: unity gain]
//   GND:         GND_v1
//
// Gain = 1 (Vout = Vin). 1V 1kHz sine → 1V sine at output (in-phase).
// AC source produces visible waveform variation in the viewer.
// ---------------------------------------------------------------------------
const UNITY_BUFFER: ExampleCircuit = {
  id: "opamp-buffer.v1",
  name: "Unity Buffer",
  description: "Ideal op-amp voltage follower: output tracks input with gain = 1. Low source impedance, 1 kHz sine demo.",
  components: [
    { id: "buf.v1",   kind: "vac",    x: 64,  y: 144, rotation: 0, value: "1 1k",  label: "V1" },
    { id: "buf.u1",   kind: "opamp",  x: 192, y: 96,  rotation: 0, value: "ideal", label: "U1" },
    { id: "buf.gnd1", kind: "ground", x: 64,  y: 176, rotation: 0, value: "",      label: "" },
  ],
  wires: [
    // V1.p(64,112) → U1.in+(160,112): horizontal along y=112
    { id: "buf.w1", points: [{ x: 64, y: 112 }, { x: 160, y: 112 }] },
    // Feedback: out(224,96) → up to (224,64) → left to (160,64) → down to
    // in-(160,80), routed above the op-amp body so the wire never crosses it.
    { id: "buf.w2", points: [{ x: 224, y: 96 }, { x: 224, y: 64 }, { x: 160, y: 64 }, { x: 160, y: 80 }] },
  ],
};

// ---------------------------------------------------------------------------
// Circuit 8 — Class-D switching output stage (CMOS half-bridge + LC filter)
//
// A complementary MOSFET half-bridge switched by a PWM gate drive, with an LC
// reconstruction filter into the load — the power stage of a Class-D amplifier.
// Nonlinear (MOSFETs) → solves on the native ngspice engine only.
//
// Net / world-pin map (GRID = 16):
//   V1  vsource (0,0):     p=(0,-32)=VDD,  n=(0,32)=GND
//   VG  vpulse  (0,256):   p=(0,224)=IN,   n=(0,288)=GND   (0→12 V, 100 kHz, 45% duty)
//   M1  pmos    (256,0):   d=(272,-32)=SW, g=(224,0)=IN,   s=(272,32)=VDD,  b=(288,0)=VDD
//   M2  nmos    (256,256): d=(272,224)=SW, g=(224,256)=IN, s=(272,288)=GND, b=(288,256)=GND
//   L1  inductor(640,224): a=(608,224)=SW, b=(672,224)=OUT
//   C1  cap rot90 (768,320): a=(768,288)=OUT, b=(768,352)=GND
//   RL  res rot90 (896,320): a=(896,288)=OUT, b=(896,352)=GND
//   grounds at V1.n, VG.n, M2.s, M2.b, C1.b, RL.b
//
// PMOS conducts when the gate is low (SW→VDD); NMOS conducts when the gate is
// high (SW→GND). The LC filter averages the PWM, so OUT ≈ duty × VDD.
// Verified: builder emits 5 nets and real ngspice solves it (SW switches, OUT
// settles to the filtered average).
// ---------------------------------------------------------------------------
const CLASS_D: ExampleCircuit = {
  id: "classd.v1",
  name: "Class-D Output Stage",
  description: "Complementary MOSFET half-bridge with a PWM gate drive and an LC reconstruction filter — a Class-D amplifier power stage. Needs the native ngspice engine.",
  nativeOnly: true,
  components: [
    { id: "cd.v1", kind: "vsource",   x: 0,   y: 0,   rotation: 0,  value: "12",            label: "V1" },
    { id: "cd.vg", kind: "vpulse",    x: 0,   y: 256, rotation: 0,  value: "0 12 100k 0.45", label: "VG" },
    { id: "cd.m1", kind: "pmos",      x: 256, y: 0,   rotation: 0,  value: "",               label: "M1" },
    { id: "cd.m2", kind: "nmos",      x: 256, y: 256, rotation: 0,  value: "",               label: "M2" },
    { id: "cd.l1", kind: "inductor",  x: 640, y: 224, rotation: 0,  value: "1m",             label: "L1" },
    { id: "cd.c1", kind: "capacitor", x: 768, y: 320, rotation: 90, value: "100n",           label: "C1" },
    { id: "cd.rl", kind: "resistor",  x: 896, y: 320, rotation: 90, value: "1k",             label: "RL" },
    { id: "cd.g1", kind: "ground",    x: 0,   y: 32,  rotation: 0,  value: "",               label: "" },
    { id: "cd.g2", kind: "ground",    x: 0,   y: 288, rotation: 0,  value: "",               label: "" },
    { id: "cd.g3", kind: "ground",    x: 272, y: 288, rotation: 0,  value: "",               label: "" },
    { id: "cd.g4", kind: "ground",    x: 288, y: 256, rotation: 0,  value: "",               label: "" },
    { id: "cd.g5", kind: "ground",    x: 768, y: 352, rotation: 0,  value: "",               label: "" },
    { id: "cd.g6", kind: "ground",    x: 896, y: 352, rotation: 0,  value: "",               label: "" },
  ],
  wires: [
    { id: "cd.w_vdd",  points: [{ x: 0, y: -32 }, { x: 0, y: -128 }, { x: 304, y: -128 }, { x: 304, y: 32 }, { x: 272, y: 32 }] },
    { id: "cd.w_vddb", points: [{ x: 288, y: 0 }, { x: 304, y: 0 }] },
    { id: "cd.w_in",   points: [{ x: 0, y: 224 }, { x: 160, y: 224 }, { x: 160, y: 0 }, { x: 224, y: 0 }] },
    { id: "cd.w_in2",  points: [{ x: 160, y: 224 }, { x: 224, y: 224 }, { x: 224, y: 256 }] },
    { id: "cd.w_sw",   points: [{ x: 272, y: -32 }, { x: 240, y: -32 }, { x: 240, y: 224 }, { x: 272, y: 224 }] },
    { id: "cd.w_swl",  points: [{ x: 272, y: 224 }, { x: 608, y: 224 }] },
    { id: "cd.w_out",  points: [{ x: 672, y: 224 }, { x: 768, y: 224 }, { x: 768, y: 288 }] },
    { id: "cd.w_out2", points: [{ x: 768, y: 224 }, { x: 896, y: 224 }, { x: 896, y: 288 }] },
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
  NONINVERTING_AMP,
  INVERTING_AMP,
  UNITY_BUFFER,
  CLASS_D,
];
