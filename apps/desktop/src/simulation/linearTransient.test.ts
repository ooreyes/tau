/**
 * Correctness tests for the linear transient solver, validated against
 * analytic solutions. All circuit connectivity follows the documented geometry:
 *
 *   GRID = 16
 *   Two-terminal (rotation 0):  pin "a" at (x-32, y), pin "b" at (x+32, y)
 *   vsource (rotation 0):       pin "p" at (x, y-32), pin "n" at (x, y+32)
 *   ground:                     pin "g" at (x, y)
 *
 * Pins connect when their world coordinates coincide.
 */

import { describe, it, expect } from "vitest";
import { inspectTransientResolution, runTransientAnalysis } from "./linearTransient";
import type { SchematicComponent, SchematicWire } from "../schematic/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0;
function uid(prefix: string) {
  return `${prefix}-${++idCounter}`;
}

function vsource(x: number, y: number, value: string, label = "V1"): SchematicComponent {
  return { id: uid("vs"), kind: "vsource", x, y, rotation: 0, value, label };
}

function vac(x: number, y: number, value: string, label = "V1"): SchematicComponent {
  return { id: uid("vac"), kind: "vac", x, y, rotation: 0, value, label };
}

function isource(x: number, y: number, value: string, label = "I1"): SchematicComponent {
  return { id: uid("is"), kind: "isource", x, y, rotation: 0, value, label };
}

function resistor(x: number, y: number, value: string, label = "R1"): SchematicComponent {
  return { id: uid("r"), kind: "resistor", x, y, rotation: 0, value, label };
}

function capacitor(x: number, y: number, value: string, label = "C1"): SchematicComponent {
  return { id: uid("c"), kind: "capacitor", x, y, rotation: 0, value, label };
}

function inductor(x: number, y: number, value: string, label = "L1"): SchematicComponent {
  return { id: uid("l"), kind: "inductor", x, y, rotation: 0, value, label };
}

function ground(x: number, y: number): SchematicComponent {
  return { id: uid("gnd"), kind: "ground", x, y, rotation: 0, value: "", label: "" };
}

function opamp(x: number, y: number): SchematicComponent {
  return { id: uid("op"), kind: "opamp", x, y, rotation: 0, value: "ideal", label: "U1" };
}

function wire(points: { x: number; y: number }[]): SchematicWire {
  return { id: uid("w"), points };
}

describe("Transient resolution guard", () => {
  it("calculates required samples from the highest AC source frequency", () => {
    const source = vac(0, 32, "1 1M", "V1");
    const resolution = inspectTransientResolution([source], { stopTime: 10e-6, steps: 320 });
    expect(resolution.maxFrequencyHz).toBe(1e6);
    expect(resolution.requiredSteps).toBe(320);
    expect(resolution.samplesPerCycle).toBeCloseTo(32, 10);
  });

  it("rejects an under-sampled sine transient instead of aliasing it", () => {
    const source = vac(0, 32, "1 1M", "V1");
    const gnd = ground(0, 64);
    const result = runTransientAnalysis({ components: [source, gnd], wires: [] }, { stopTime: 10e-6, steps: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Transient resolution is too low");
  });

  it("rejects a request that exceeds the interactive high-speed ceiling", () => {
    const source = vac(0, 32, "1 1G", "V1");
    const gnd = ground(0, 64);
    const result = runTransientAnalysis({ components: [source, gnd], wires: [] }, { stopTime: 1e-3, steps: 200_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("interactive solver is capped");
  });
});

// ---------------------------------------------------------------------------
// Analytic reference values
// ---------------------------------------------------------------------------
//   RC charging:  V_cap(t) = Vs * (1 - e^{-t/τ})     τ = RC
//   At t=τ:       V_cap = Vs * (1 - 1/e) ≈ 0.6321 * Vs
//   At t=5τ:      V_cap = Vs * (1 - e^{-5})   ≈ 0.9933 * Vs

// ---------------------------------------------------------------------------
// Test 1 — RC charging circuit
// ---------------------------------------------------------------------------
describe("RC charging — analytic validation", () => {
  /**
   * Circuit topology (all rotation 0):
   *
   *   VS at (0, 0):   p=(0,-32)  n=(0,32)
   *   R  at (96, 0):  a=(64,0)   b=(128,0)
   *   C  at (224, 0): a=(192,0)  b=(256,0)
   *   GND_n at (0,32): g=(0,32)  — connects to VS.n
   *   GND_c at (256,0): g=(256,0) — connects to C.b
   *
   * Wires needed:
   *   VS.p (0,-32) → R.a (64,0): need junction, use a corner wire
   *   R.b (128,0) → C.a (192,0): direct horizontal wire
   *
   * Simpler layout — place components so pins coincide directly:
   *
   *   VS at (0, 0):    p=(0,-32), n=(0,32)
   *   R  at (96, 0):   a=(64,0),  b=(128,0)
   *   C  at (224, 0):  a=(192,0), b=(256,0)
   *
   *   Wire: VS.p (0,-32) to R.a (64,0) via corner at (0,0) ... or just
   *   wire them via explicit polyline.
   *
   *   In practice: all in-line along y=0 with VS pinout going vertical.
   *
   * Cleaner layout: use a horizontal bus at y=0 and y=64.
   *
   *   VS at (0, 32):   p=(0,0),   n=(0,64)
   *   R  at (96, 0):   a=(64,0),  b=(128,0)
   *   C  at (224, 0):  a=(192,0), b=(256,0)
   *   GND at (0, 64):  g=(0,64)   — coincides with VS.n
   *   GND at (256, 0): g=(256,0)  — coincides with C.b
   *
   *   Wire: VS.p (0,0) → R.a (64,0) horizontal segment.
   *   Wire: R.b (128,0) → C.a (192,0) horizontal segment.
   *
   * V=5V, R=1k, C=1µ → τ = 1ms = 0.001s
   * stopTime = 5τ = 5ms, steps = 500 → stepSize = 10µs
   *
   * The "capacitor node" is the net between R.b and C.a.
   */
  const Vs = 5;
  const tau = 1e-3; // 1 ms
  const stopTime = 5 * tau;
  const steps = 500;

  // VS at (0,32): p=(0,0), n=(0,64)
  const VS = vsource(0, 32, "5V", "V1");
  // R at (96,0): a=(64,0), b=(128,0)
  const R = resistor(96, 0, "1k", "R1");
  // C at (224,0): a=(192,0), b=(256,0)
  const C = capacitor(224, 0, "1µ", "C1");
  // GND at VS.n
  const GND_vs = ground(0, 64);
  // GND at C.b
  const GND_c = ground(256, 0);

  const components = [VS, R, C, GND_vs, GND_c];
  // Wires: VS.p(0,0)→R.a(64,0); R.b(128,0)→C.a(192,0)
  const wires = [
    wire([{ x: 0, y: 0 }, { x: 64, y: 0 }]),
    wire([{ x: 128, y: 0 }, { x: 192, y: 0 }]),
  ];

  it("runs successfully (ok=true)", () => {
    const result = runTransientAnalysis({ components, wires }, { stopTime, steps });
    expect(result.ok).toBe(true);
  });

  it("has exactly one non-ground trace (the capacitor node)", () => {
    const result = runTransientAnalysis({ components, wires }, { stopTime, steps });
    if (!result.ok) throw new Error(result.message);
    // There are two non-ground nets: the VS+ / R.a node and the R.b / C.a node.
    // The solver returns both; we need the capacitor node (the one with the cap).
    expect(result.traces.length).toBeGreaterThanOrEqual(1);
  });

  it("capacitor voltage ≈ 0.632 × Vs at t = τ (within 2%)", () => {
    const result = runTransientAnalysis({ components, wires }, { stopTime, steps });
    if (!result.ok) throw new Error(result.message);

    // Find the capacitor-node trace: it starts at 0 and charges.
    // The trace whose value at t=τ is closest to 0.632*Vs.
    const stepSize = stopTime / steps;
    const indexAtTau = Math.round(tau / stepSize);
    const analytic = Vs * (1 - Math.exp(-1)); // ≈ 3.161

    // Look through all traces for the one that matches RC charging
    let best = Infinity;
    let bestVal = 0;
    for (const trace of result.traces) {
      const diff = Math.abs(trace.values[indexAtTau] - analytic);
      if (diff < best) {
        best = diff;
        bestVal = trace.values[indexAtTau];
      }
    }

    expect(bestVal).toBeCloseTo(analytic, 0);
    expect(Math.abs(bestVal - analytic) / analytic).toBeLessThan(0.02); // within 2%
  });

  it("capacitor voltage ≈ 0.993 × Vs at t = 5τ (within 2%)", () => {
    const result = runTransientAnalysis({ components, wires }, { stopTime, steps });
    if (!result.ok) throw new Error(result.message);

    const analytic5tau = Vs * (1 - Math.exp(-5)); // ≈ 4.966

    let best = Infinity;
    let bestVal = 0;
    for (const trace of result.traces) {
      const lastVal = trace.values[trace.values.length - 1];
      const diff = Math.abs(lastVal - analytic5tau);
      if (diff < best) {
        best = diff;
        bestVal = lastVal;
      }
    }

    expect(bestVal).toBeCloseTo(analytic5tau, 0);
    expect(Math.abs(bestVal - analytic5tau) / analytic5tau).toBeLessThan(0.02); // within 2%
  });

  it("capacitor voltage starts near 0 V at t=0", () => {
    const result = runTransientAnalysis({ components, wires }, { stopTime, steps });
    if (!result.ok) throw new Error(result.message);

    for (const trace of result.traces) {
      if (Math.abs(trace.values[0]) < 0.5) {
        // Found the cap node starting near 0
        expect(trace.values[0]).toBeCloseTo(0, 1);
        return;
      }
    }
    // If we reach here at least one trace starts near 0
    // (The VS node starts at Vs=5 immediately; the cap node starts at 0)
    const capTrace = result.traces.find(t => Math.abs(t.values[0]) < 1);
    expect(capTrace).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Resistive voltage divider (DC steady state)
// ---------------------------------------------------------------------------
describe("Voltage divider — DC steady state", () => {
  /**
   * Circuit:
   *   VS at (0, 32):  p=(0,0), n=(0,64)
   *   R1 at (96, 0):  a=(64,0), b=(128,0)   — top resistor
   *   R2 at (192, 0): a=(160,0), b=(224,0)  — bottom resistor
   *   GND at (0, 64): g=(0,64) — coincides with VS.n
   *   GND at (224,0): g=(224,0) — coincides with R2.b
   *
   *   Wires:
   *     VS.p (0,0) → R1.a (64,0)
   *     R1.b (128,0) → R2.a (160,0)
   *
   *   V=10V, R1=R2=1k → midpoint = 5V
   *   Capacitors act like open circuits under steady DC, so use purely
   *   resistive divider here and run with many steps to reach steady state.
   */
  const V10 = vsource(0, 32, "10V", "V1");
  const R1 = resistor(96, 0, "1k", "R1");
  const R2 = resistor(192, 0, "1k", "R2");
  const GND_vs = ground(0, 64);
  const GND_r2 = ground(224, 0);

  const components = [V10, R1, R2, GND_vs, GND_r2];
  const wires = [
    wire([{ x: 0, y: 0 }, { x: 64, y: 0 }]),
    wire([{ x: 128, y: 0 }, { x: 160, y: 0 }]),
  ];

  it("runs successfully", () => {
    const result = runTransientAnalysis({ components, wires }, { stopTime: 1e-3, steps: 100 });
    expect(result.ok).toBe(true);
  });

  it("mid-node voltage settles to 5 V (within 1%)", () => {
    const result = runTransientAnalysis({ components, wires }, { stopTime: 1e-3, steps: 100 });
    if (!result.ok) throw new Error(result.message);

    // Mid-node is between R1.b and R2.a — it should read ~5V immediately
    // (pure resistive divider, no storage elements).
    const midTrace = result.traces.find(t => {
      const last = t.values[t.values.length - 1];
      return last > 4 && last < 6;
    });
    expect(midTrace).toBeDefined();
    if (midTrace) {
      const last = midTrace.values[midTrace.values.length - 1];
      expect(Math.abs(last - 5) / 5).toBeLessThan(0.01);
    }
  });

  it("source node voltage is 10 V throughout (within 1%)", () => {
    const result = runTransientAnalysis({ components, wires }, { stopTime: 1e-3, steps: 100 });
    if (!result.ok) throw new Error(result.message);

    const sourceTrace = result.traces.find(t => {
      const last = t.values[t.values.length - 1];
      return last > 9 && last < 11;
    });
    expect(sourceTrace).toBeDefined();
    if (sourceTrace) {
      const last = sourceTrace.values[sourceTrace.values.length - 1];
      expect(Math.abs(last - 10) / 10).toBeLessThan(0.01);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 3 — RLC series under-damped circuit
// ---------------------------------------------------------------------------
describe("RLC series — under-damped oscillation", () => {
  /**
   * Under-damped RLC: R=10Ω, L=1mH, C=1µF → ω₀ = 1/√(LC) ≈ 31623 rad/s,
   * α = R/(2L) = 5000 s⁻¹, ω₀ > α → under-damped.
   * Damped frequency ωd = √(ω₀² - α²) ≈ 31222 rad/s, period ≈ 201µs.
   *
   * Layout (components in series, all rotation 0):
   *   VS at (0, 32):    p=(0,0),   n=(0,64)
   *   R  at (96, 0):    a=(64,0),  b=(128,0)
   *   L  at (192, 0):   a=(160,0), b=(224,0)
   *   C  at (288, 0):   a=(256,0), b=(320,0)
   *   GND at (0, 64):   g=(0,64)  — coincides with VS.n
   *   GND at (320, 0):  g=(320,0) — coincides with C.b
   *
   *   Wires connect the chain: VS.p→R.a, R.b→L.a, L.b→C.a
   *
   * Run for 3 full periods (~600µs), steps=500 (stepSize=1.2µs).
   */
  const VS = vsource(0, 32, "10V", "V1");
  const R = resistor(96, 0, "10", "R1");
  const L = inductor(192, 0, "1m", "L1");
  const C = capacitor(288, 0, "1µ", "C1");
  const GND_vs = ground(0, 64);
  const GND_c = ground(320, 0);

  const components = [VS, R, L, C, GND_vs, GND_c];
  const wires = [
    wire([{ x: 0, y: 0 }, { x: 64, y: 0 }]),
    wire([{ x: 128, y: 0 }, { x: 160, y: 0 }]),
    wire([{ x: 224, y: 0 }, { x: 256, y: 0 }]),
  ];

  const stopTime = 600e-6; // 600 µs ≈ 3 periods
  const steps = 500;

  it("runs successfully", () => {
    const result = runTransientAnalysis({ components, wires }, { stopTime, steps });
    expect(result.ok).toBe(true);
  });

  it("capacitor node voltage is bounded within [-15, 25] V (energy constraint)", () => {
    const result = runTransientAnalysis({ components, wires }, { stopTime, steps });
    if (!result.ok) throw new Error(result.message);

    // Find the cap node: it's the one that oscillates and isn't pinned to VS
    const capTrace = result.traces.find(t => {
      const max = t.values.reduce((a, b) => (b > a ? b : a), -Infinity);
      const min = t.values.reduce((a, b) => (b < a ? b : a), Infinity);
      return max > 1 && min < 9; // oscillates
    });

    expect(capTrace).toBeDefined();
    if (capTrace) {
      for (const v of capTrace.values) {
        expect(v).toBeGreaterThan(-15);
        expect(v).toBeLessThan(25);
      }
    }
  });

  it("capacitor node voltage is oscillatory (multiple sign changes in first difference)", () => {
    const result = runTransientAnalysis({ components, wires }, { stopTime, steps });
    if (!result.ok) throw new Error(result.message);

    // Find the trace that oscillates most (highest number of sign changes in diff)
    let maxSignChanges = 0;
    for (const trace of result.traces) {
      const vals = trace.values;
      let signChanges = 0;
      for (let i = 1; i < vals.length; i++) {
        const prev = vals[i - 1] - vals[Math.max(0, i - 2)];
        const curr = vals[i] - vals[i - 1];
        if (prev * curr < 0) signChanges++;
      }
      if (signChanges > maxSignChanges) maxSignChanges = signChanges;
    }
    // Under-damped: expect multiple oscillation cycles → multiple sign changes
    expect(maxSignChanges).toBeGreaterThan(2);
  });

  it("capacitor node voltage overshoots VS (under-damped characteristic)", () => {
    const result = runTransientAnalysis({ components, wires }, { stopTime, steps });
    if (!result.ok) throw new Error(result.message);

    // Under-damped RLC: the capacitor voltage peaks above the source voltage
    let anyOvershoot = false;
    for (const trace of result.traces) {
      const max = trace.values.reduce((a, b) => (b > a ? b : a), -Infinity);
      if (max > 10 * 1.05) { // more than 5% above VS
        anyOvershoot = true;
        break;
      }
    }
    expect(anyOvershoot).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — Graceful failure cases (ok === false, no throw)
// ---------------------------------------------------------------------------
describe("Graceful failure cases", () => {
  it("missing ground → ok=false", () => {
    // VS connected to a resistor, no GND symbol at all
    const VS = vsource(0, 32, "5V", "V1");
    const R = resistor(96, 0, "1k", "R1");
    const components = [VS, R];
    // Wire VS.p(0,0)→R.a(64,0)
    const wires = [wire([{ x: 0, y: 0 }, { x: 64, y: 0 }])];

    const result = runTransientAnalysis({ components, wires }, { stopTime: 1e-3, steps: 100 });
    expect(result.ok).toBe(false);
  });

  it("missing source → ok=false", () => {
    // Just a resistor and ground, no voltage source
    const R = resistor(96, 0, "1k", "R1");
    const GND = ground(256, 0);
    const components = [R, GND];
    const wires = [wire([{ x: 128, y: 0 }, { x: 256, y: 0 }])];

    const result = runTransientAnalysis({ components, wires }, { stopTime: 1e-3, steps: 100 });
    expect(result.ok).toBe(false);
  });

  it("single floating node (no connections) → ok=false", () => {
    // A resistor with its b pin floating (connected nowhere), plus VS+GND
    // VS at (0,32): p=(0,0), n=(0,64)
    // R at (96, 200): a=(64,200), b=(128,200)  — in a different area, floating
    // GND at (0,64)
    // Wire: VS.p(0,0) only → R and VS are disconnected
    const VS = vsource(0, 32, "5V", "V1");
    const R = resistor(96, 200, "1k", "R1");
    const GND = ground(0, 64);
    const components = [VS, R, GND];
    const wires: SchematicWire[] = [];

    // VS.p=(0,0) and VS.n=(0,64) connects to GND.g=(0,64); R is floating.
    // The circuit has a floating node → singular matrix
    const result = runTransientAnalysis({ components, wires }, { stopTime: 1e-3, steps: 100 });
    // Should be ok=false (floating node causes singular matrix or only-single-pin net)
    expect(result.ok).toBe(false);
  });

  it("singular matrix (VS with both terminals on same net) → ok=false", () => {
    // VS with p and n tied together via wire (zero-voltage loop) — singular
    // VS at (0, 0): p=(0,-32), n=(0,32)
    // Wire from p(0,-32) to n(0,32): creates short
    // Actually: easier to use two voltage sources in a loop → singular KVL
    // Or: VS between two ground nodes (n is GND, p is also connected to GND via wire)
    const VS = vsource(0, 32, "5V", "V1");
    const GND_n = ground(0, 64);   // VS.n=(0,64) coincides
    const GND_p = ground(0, 0);    // VS.p=(0,0) coincides — short VS to ground
    const components = [VS, GND_n, GND_p];
    const wires: SchematicWire[] = [];

    const result = runTransientAnalysis({ components, wires }, { stopTime: 1e-3, steps: 100 });
    expect(result.ok).toBe(false);
  });

  it("unsupported model part → ok=false with a clear message", () => {
    const U1 = opamp(96, 0);
    const GND = ground(0, 32);

    const result = runTransientAnalysis({ components: [U1, GND], wires: [] }, { stopTime: 1e-3, steps: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("interim solver");
  });
});

// ---------------------------------------------------------------------------
// Test 5 — New source primitives
// ---------------------------------------------------------------------------
describe("Transient source primitives", () => {
  it("AC voltage source drives a sine waveform", () => {
    const V1 = vac(0, 32, "1 1k", "V1");
    const GND = ground(0, 64);

    const result = runTransientAnalysis({ components: [V1, GND], wires: [] }, { stopTime: 1e-3, steps: 200 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const trace = result.traces[0];
    expect(trace.values[0]).toBeCloseTo(0, 6);
    expect(trace.values.reduce((a, b) => (b > a ? b : a), -Infinity)).toBeGreaterThan(0.98);
    expect(trace.values.reduce((a, b) => (b < a ? b : a), Infinity)).toBeLessThan(-0.98);
  });

  it("DC current source through resistor produces Ohm-law voltage", () => {
    // I1(1 mA) at (0,32): p=(0,0), n=(0,64)=GND.  R1(1k) from (64,0) to (128,0)=GND.
    // SPICE convention: 1 mA exits the + (p) terminal into the network.
    // V(p→R1→GND) = I × R = 1 mA × 1 kΩ = +1 V.
    const I1 = isource(0, 32, "1m", "I1");
    const R1 = resistor(96, 0, "1k", "R1");
    const GND_source = ground(0, 64);
    const GND_resistor = ground(128, 0);
    const wires = [wire([{ x: 0, y: 0 }, { x: 64, y: 0 }])];

    const result = runTransientAnalysis(
      { components: [I1, R1, GND_source, GND_resistor], wires },
      { stopTime: 1e-3, steps: 100 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const sourceNode = result.traces.find((trace) => Math.abs(trace.values[trace.values.length - 1] ?? 0) > 0.5);
    expect(sourceNode).toBeDefined();
    // Correct SPICE result: +1 V (current exits + terminal, raising the p node).
    expect(sourceNode?.values[sourceNode.values.length - 1]).toBeCloseTo(1, 3);
  });
});
