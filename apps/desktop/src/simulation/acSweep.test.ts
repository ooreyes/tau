/**
 * Tests for the AC frequency-sweep solver (acSweep.ts).
 *
 * Circuit connectivity geometry (all rotation 0 unless stated):
 *   GRID = 16
 *   Two-terminal (R, C, L): pin "a" at (x-32, y), pin "b" at (x+32, y)
 *   vac/vsource/isource/iac: pin "p" at (x, y-32), pin "n" at (x, y+32)
 *   ground: pin "g" at (x, y)
 *
 * Pins connect when their world coordinates coincide.
 */

import { describe, it, expect } from "vitest";
import { runAcSweep } from "./acSweep";
import type { SchematicComponent, SchematicWire } from "../schematic/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0;
function uid(prefix: string) {
  return `${prefix}-${++idCounter}`;
}

function vac(x: number, y: number, value: string, label = "V1"): SchematicComponent {
  return { id: uid("vac"), kind: "vac", x, y, rotation: 0, value, label };
}

function vsource(x: number, y: number, value: string, label = "V1"): SchematicComponent {
  return { id: uid("vs"), kind: "vsource", x, y, rotation: 0, value, label };
}

function resistor(x: number, y: number, value: string, label = "R1"): SchematicComponent {
  return { id: uid("r"), kind: "resistor", x, y, rotation: 0, value, label };
}

function capacitor(x: number, y: number, value: string, label = "C1"): SchematicComponent {
  return { id: uid("c"), kind: "capacitor", x, y, rotation: 0, value, label };
}

function ground(x: number, y: number): SchematicComponent {
  return { id: uid("gnd"), kind: "ground", x, y, rotation: 0, value: "", label: "" };
}

function diode(x: number, y: number, value = "D", label = "D1"): SchematicComponent {
  return { id: uid("d"), kind: "diode", x, y, rotation: 0, value, label };
}

function sw(x: number, y: number, value: string, label = "S1"): SchematicComponent {
  return { id: uid("s"), kind: "switch", x, y, rotation: 0, value, label };
}

function wire(points: { x: number; y: number }[]): SchematicWire {
  return { id: uid("w"), points };
}

// ---------------------------------------------------------------------------
// RC low-pass filter test circuit
// ---------------------------------------------------------------------------
//
// Component layout (all rotation 0):
//
//   VAC at (0, 32):    p=(0,0),   n=(0,64)
//   R   at (96, 0):    a=(64,0),  b=(128,0)
//   C   at (224, 0):   a=(192,0), b=(256,0)
//   GND_vac at (0,64): g=(0,64)   - coincides with VAC.n
//   GND_cap at (256,0):g=(256,0)  - coincides with C.b
//
//   Wire: VAC.p (0,0) → R.a (64,0)    horizontal
//   Wire: R.b (128,0) → C.a (192,0)   horizontal
//
// Nets (after extractCircuit):
//   NET "source":  {VAC.p, R.a}     - driven node = VAC amplitude
//   NET "out":     {R.b, C.a}       - output node (the RC midpoint)
//   NET "0":       {VAC.n, C.b, GND pins} - ground
//
// fc = 1 / (2π × R × C)
// With R = 1000 Ω, C = 159.155e-9 F:
//   fc = 1 / (2π × 1000 × 159.155e-9)
//      = 1 / (2π × 159.155e-6)
//      ≈ 1000 Hz
//
// RC filter transfer function: H(f) = 1 / (1 + j2πfRC)
//   |H(fc)| = 1/√2 → -3.01 dB
//   ∠H(fc) = -45°
//   |H(10fc)| = 1/√(1+100) ≈ 0.0995 → ≈ -20 dB (exactly -20.04 dB)

const R_VALUE = "1k";        // 1000 Ω
const C_VALUE = "159.155n";  // 159.155 nF  → fc ≈ 1000 Hz

// Build the circuit
const VAC = vac(0, 32, "1", "V1");    // amplitude = 1 V, single-token form
const R1 = resistor(96, 0, R_VALUE, "R1");
const C1 = capacitor(224, 0, C_VALUE, "C1");
const GND_vac = ground(0, 64);
const GND_cap = ground(256, 0);

const components = [VAC, R1, C1, GND_vac, GND_cap];
const wires = [
  wire([{ x: 0, y: 0 }, { x: 64, y: 0 }]),    // VAC.p → R.a
  wire([{ x: 128, y: 0 }, { x: 192, y: 0 }]), // R.b → C.a
];

const acOptions = {
  startHz: 10,
  stopHz: 100_000,
  pointsPerDecade: 20,
};

// ---------------------------------------------------------------------------
// Helper: find the trace whose average passband magnitude is closest to 0 dB
// (the output / RC-midpoint trace in a unity-gain passband approximation).
// At very low frequencies (f << fc), the RC output ≈ 0 dB.
// At the source node the response is always 0 dB. The OUT node rolls off.
// We identify the out trace as the one that has a magnitude ≈ -3 dB at fc.
// ---------------------------------------------------------------------------

function findOutTrace(result: { ok: true; freqs: number[]; traces: { id: string; label: string; magDb: number[]; phaseDeg: number[] }[] }) {
  // Find the index of the frequency closest to fc = 1000 Hz
  const fcIdx = result.freqs.reduce((best, f, idx) => {
    return Math.abs(f - 1000) < Math.abs(result.freqs[best] - 1000) ? idx : best;
  }, 0);

  // The OUT trace should be ~-3 dB at fc; source trace is ~0 dB there
  return result.traces.find((trace) => {
    const magAtFc = trace.magDb[fcIdx];
    return magAtFc < -1.5 && magAtFc > -6;
  });
}

// ---------------------------------------------------------------------------
// Test suite 1 - RC low-pass analytical validation
// ---------------------------------------------------------------------------

describe("AC sweep - RC low-pass filter (fc ≈ 1 kHz)", () => {
  it("returns ok=true for valid RC circuit", () => {
    const result = runAcSweep({ components, wires }, acOptions);
    expect(result.ok).toBe(true);
  });

  it("freqs array is log-spaced from 10 Hz to 100 kHz", () => {
    const result = runAcSweep({ components, wires }, acOptions);
    if (!result.ok) throw new Error(result.message);

    expect(result.freqs.length).toBeGreaterThan(0);
    expect(result.freqs[0]).toBeCloseTo(10, 3);
    expect(result.freqs[result.freqs.length - 1]).toBeCloseTo(100_000, 0);
    // Log-spacing: each step ≈ 10^(1/20)
    const ratio = result.freqs[1] / result.freqs[0];
    expect(ratio).toBeCloseTo(Math.pow(10, 1 / 20), 3);
  });

  it("each trace has magDb and phaseDeg arrays of the same length as freqs", () => {
    const result = runAcSweep({ components, wires }, acOptions);
    if (!result.ok) throw new Error(result.message);

    for (const trace of result.traces) {
      expect(trace.magDb.length).toBe(result.freqs.length);
      expect(trace.phaseDeg.length).toBe(result.freqs.length);
    }
  });

  it("output node magnitude ≈ -3 dB at fc ≈ 1 kHz (±0.6 dB)", () => {
    const result = runAcSweep({ components, wires }, acOptions);
    if (!result.ok) throw new Error(result.message);

    const outTrace = findOutTrace(result);
    expect(outTrace).toBeDefined();
    if (!outTrace) return;

    const fcIdx = result.freqs.reduce((best, f, idx) =>
      Math.abs(f - 1000) < Math.abs(result.freqs[best] - 1000) ? idx : best, 0);

    const magAtFc = outTrace.magDb[fcIdx];
    expect(magAtFc).toBeGreaterThan(-3.0 - 0.6);
    expect(magAtFc).toBeLessThan(-3.0 + 0.6);
  });

  it("output node phase ≈ -45° at fc ≈ 1 kHz (±5°)", () => {
    const result = runAcSweep({ components, wires }, acOptions);
    if (!result.ok) throw new Error(result.message);

    const outTrace = findOutTrace(result);
    expect(outTrace).toBeDefined();
    if (!outTrace) return;

    const fcIdx = result.freqs.reduce((best, f, idx) =>
      Math.abs(f - 1000) < Math.abs(result.freqs[best] - 1000) ? idx : best, 0);

    const phaseAtFc = outTrace.phaseDeg[fcIdx];
    expect(phaseAtFc).toBeGreaterThan(-45 - 5);
    expect(phaseAtFc).toBeLessThan(-45 + 5);
  });

  it("output node rolls off at ~-20 dB/decade: at 10 kHz the magnitude ≈ -20 dB (±2 dB)", () => {
    // At 10 kHz (10× fc) the exact RC response is:
    //   |H(10kHz)| = 1/√(1 + (10)²) ≈ 0.0995 → -20.04 dB
    const result = runAcSweep({ components, wires }, acOptions);
    if (!result.ok) throw new Error(result.message);

    const outTrace = findOutTrace(result);
    expect(outTrace).toBeDefined();
    if (!outTrace) return;

    const f10kIdx = result.freqs.reduce((best, f, idx) =>
      Math.abs(f - 10_000) < Math.abs(result.freqs[best] - 10_000) ? idx : best, 0);

    const magAt10k = outTrace.magDb[f10kIdx];
    expect(magAt10k).toBeGreaterThan(-20 - 2);
    expect(magAt10k).toBeLessThan(-20 + 2);
  });

  it("output node passband magnitude ≈ 0 dB at very low frequency (10 Hz)", () => {
    // At f << fc, H ≈ 1 → 0 dB
    const result = runAcSweep({ components, wires }, acOptions);
    if (!result.ok) throw new Error(result.message);

    const outTrace = findOutTrace(result);
    expect(outTrace).toBeDefined();
    if (!outTrace) return;

    // 10 Hz is the first frequency
    const magAt10Hz = outTrace.magDb[0];
    expect(magAt10Hz).toBeGreaterThan(-0.5);
    expect(magAt10Hz).toBeLessThan(0.1);
  });

  it("traces have human-readable labels (V(...))", () => {
    const result = runAcSweep({ components, wires }, acOptions);
    if (!result.ok) throw new Error(result.message);

    for (const trace of result.traces) {
      expect(trace.label).toMatch(/^V\(.+\)$/);
    }
  });
});

// ---------------------------------------------------------------------------
// Test suite 2 - Graceful failure guards (ok === false, never throws)
// ---------------------------------------------------------------------------

describe("AC sweep - graceful failure cases", () => {
  it("no ground symbol → ok=false", () => {
    // VAC + R, no ground at all
    const V1 = vac(0, 32, "1", "V1");
    const Rx = resistor(96, 0, "1k", "R1");
    const result = runAcSweep(
      { components: [V1, Rx], wires: [wire([{ x: 0, y: 0 }, { x: 64, y: 0 }])] },
      acOptions,
    );
    expect(result.ok).toBe(false);
  });

  it("no AC source (only vsource) → ok=false", () => {
    // DC vsource + R + ground; no vac/iac → AC analysis has no excitation
    const V1 = vsource(0, 32, "5V", "V1");
    const Rx = resistor(96, 0, "1k", "R1");
    const G1 = ground(0, 64);
    const G2 = ground(128, 0);
    const result = runAcSweep(
      {
        components: [V1, Rx, G1, G2],
        wires: [wire([{ x: 0, y: 0 }, { x: 64, y: 0 }])],
      },
      acOptions,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message.toLowerCase()).toMatch(/ac source/);
    }
  });

  it("no source at all → ok=false", () => {
    const Rx = resistor(96, 0, "1k", "R1");
    const G1 = ground(128, 0);
    const result = runAcSweep(
      { components: [Rx, G1], wires: [] },
      acOptions,
    );
    expect(result.ok).toBe(false);
  });

  it("unsupported model part → ok=false with a clear message", () => {
    const V1 = vac(0, 32, "1", "V1");
    const D1 = diode(96, 0, "1N4148", "D1");
    const G1 = ground(0, 64);
    const result = runAcSweep(
      {
        components: [V1, D1, G1],
        wires: [wire([{ x: 0, y: 0 }, { x: 64, y: 0 }])],
      },
      acOptions,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("ngspice");
  });
});

describe("AC sweep - switch primitive", () => {
  it("closed switch connects the AC source to the load node", () => {
    const V1 = vac(0, 32, "1", "V1");
    const S1 = sw(96, 0, "closed", "S1");
    const R1 = resistor(192, 0, "1k", "R1");
    const G1 = ground(0, 64);
    const G2 = ground(224, 0);

    const result = runAcSweep(
      {
        components: [V1, S1, R1, G1, G2],
        wires: [
          wire([{ x: 0, y: 0 }, { x: 64, y: 0 }]),
          wire([{ x: 128, y: 0 }, { x: 160, y: 0 }]),
        ],
      },
      { startHz: 1_000, stopHz: 10_000, pointsPerDecade: 1 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const loadTrace = result.traces.find((trace) => trace.label.includes("S1") && trace.label.includes("R1"));
    expect(loadTrace).toBeDefined();
    expect(loadTrace?.magDb[0]).toBeCloseTo(0, 3);
  });
});

// ---------------------------------------------------------------------------
// A plain vsource carrying an LTspice `AC <mag>` stimulus (imported via Value2)
// must drive the AC sweep exactly like a dedicated vac source. Same RC low-pass
// as suite 1, swapping VAC for a vsource whose value is "SINE(0 1 1) AC 1".
// ---------------------------------------------------------------------------

describe("AC sweep - vsource with an LTspice AC spec drives the sweep", () => {
  const VS = vsource(0, 32, "SINE(0 1 1) AC 1", "V1");
  const R1b = resistor(96, 0, R_VALUE, "R1");
  const C1b = capacitor(224, 0, C_VALUE, "C1");
  const G1 = ground(0, 64);
  const G2 = ground(256, 0);
  const comps = [VS, R1b, C1b, G1, G2];
  const wiresB = [
    wire([{ x: 0, y: 0 }, { x: 64, y: 0 }]),
    wire([{ x: 128, y: 0 }, { x: 192, y: 0 }]),
  ];

  it("excites the circuit (no 'No AC source' failure) and rolls off at fc", () => {
    const result = runAcSweep({ components: comps, wires: wiresB }, acOptions);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const outTrace = findOutTrace(result);
    expect(outTrace).toBeDefined();
    if (!outTrace) return;
    const fcIdx = result.freqs.reduce(
      (best, f, idx) => (Math.abs(f - 1000) < Math.abs(result.freqs[best] - 1000) ? idx : best),
      0,
    );
    expect(outTrace.magDb[fcIdx]).toBeCloseTo(-3.01, 0);
  });
});

describe("AC sweep - current source with an AC spec", () => {
  it("injects an AC current into a load resistor", () => {
    // I1 (AC 1 A) across R=1k → |V(R)| = 1·1000 = 1000 V = 60 dB, flat with frequency.
    const I1: SchematicComponent = {
      id: uid("is"), kind: "isource", x: 0, y: 32, rotation: 0, value: "0 AC 1", label: "I1",
    };
    const R1c = resistor(96, 0, "1k", "R1");
    const G1 = ground(0, 64);
    const G2 = ground(128, 0);
    const result = runAcSweep(
      {
        components: [I1, R1c, G1, G2],
        wires: [wire([{ x: 0, y: 0 }, { x: 64, y: 0 }])],
      },
      { startHz: 100, stopHz: 10_000, pointsPerDecade: 2 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const rTrace = result.traces.find((t) => t.label.includes("R1"));
    expect(rTrace).toBeDefined();
    expect(rTrace?.magDb[0]).toBeCloseTo(60, 1);
    // Purely resistive → flat across the band.
    expect(rTrace?.magDb[rTrace.magDb.length - 1]).toBeCloseTo(60, 1);
  });
});
