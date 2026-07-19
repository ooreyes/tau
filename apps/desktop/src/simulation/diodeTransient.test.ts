/**
 * Junction-diode (diode/LED/zener) support in the interim transient solver.
 * Connectivity follows the documented geometry (see linearTransient.test.ts):
 * two-terminal parts at rotation 0 put pin "a" at (x−32, y) and pin "b"/"k"
 * at (x+32, y); vsource puts "p" at (x, y−32) and "n" at (x, y+32).
 */

import { describe, it, expect } from "vitest";
import { runTransientAnalysis } from "./linearTransient";
import { diodeCurrent, diodeSpecFor, parseZenerBreakdown } from "./diodeCompanion";
import type { SchematicComponent, SchematicWire } from "../schematic/types";

let idCounter = 0;
function uid(prefix: string) {
  return `${prefix}-${++idCounter}`;
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

function diode(x: number, y: number, kind: "diode" | "led" | "zener", value: string, label = "D1"): SchematicComponent {
  return { id: uid("d"), kind, x, y, rotation: 0, value, label };
}

function ground(x: number, y: number): SchematicComponent {
  return { id: uid("gnd"), kind: "ground", x, y, rotation: 0, value: "", label: "" };
}

function wire(points: { x: number; y: number }[]): SchematicWire {
  return { id: uid("w"), points };
}

/**
 *  V1(5) p(0,-32) ── R(1k) ── D ── ground rail back to V1.n
 *  Layout: V p at (0,-32); R at (96,-32) spans (64,-32)-(128,-32);
 *  D at (192,-32) spans (160,-32)-(224,-32); wires close the loop at y=64.
 */
function seriesDiodeCircuit(kind: "diode" | "led" | "zener", model: string, volts = 5) {
  const v = vsource(0, 0, String(volts));
  const r = resistor(96, -32, "1k");
  const d = diode(192, -32, kind, model, "D1");
  const g = ground(0, 64);
  const wires = [
    wire([{ x: 0, y: -32 }, { x: 64, y: -32 }]),
    wire([{ x: 128, y: -32 }, { x: 160, y: -32 }]),
    wire([{ x: 224, y: -32 }, { x: 224, y: 64 }, { x: 0, y: 64 }]),
    wire([{ x: 0, y: 32 }, { x: 0, y: 64 }]),
  ];
  return { components: [v, r, d, g], wires, diodeId: d.id };
}

async function run(circuit: { components: SchematicComponent[]; wires: SchematicWire[] }) {
  const result = await runTransientAnalysis(circuit, { stopTime: 1e-3, steps: 50 });
  expect(result.ok, result.ok ? "" : result.message).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result;
}

function lastValue(values: number[]): number {
  return values[values.length - 1];
}

describe("diode transient support", () => {
  it("solves the classic V-R-diode loop with a silicon forward drop", async () => {
    const circuit = seriesDiodeCircuit("diode", "D");
    const result = await run(circuit);
    const diodeTrace = result.traces.find((t) => {
      const v = lastValue(t.values);
      return v > 0.4 && v < 1.0;
    });
    expect(diodeTrace, "expected a node sitting at the diode forward drop").toBeTruthy();
    const vd = lastValue(diodeTrace!.values);
    expect(vd).toBeGreaterThan(0.55);
    expect(vd).toBeLessThan(0.8);
    const id = result.currents.find((c) => c.ref === "D1");
    expect(id).toBeTruthy();
    // (5 − Vd)/1k ≈ 4.3 mA
    expect(lastValue(id!.values)).toBeGreaterThan(3.8e-3);
    expect(lastValue(id!.values)).toBeLessThan(4.6e-3);
  });

  it("gives an LED its ~2 V forward drop (the LED+R+V smoke circuit)", async () => {
    const circuit = seriesDiodeCircuit("led", "LED");
    const result = await run(circuit);
    const ledTrace = result.traces.find((t) => {
      const v = lastValue(t.values);
      return v > 1.5 && v < 2.6;
    });
    expect(ledTrace, "expected a node sitting at the LED forward drop").toBeTruthy();
    const id = result.currents.find((c) => c.ref === "D1");
    // (5 − ~2 V)/1k ≈ 3 mA
    expect(lastValue(id!.values)).toBeGreaterThan(2.4e-3);
    expect(lastValue(id!.values)).toBeLessThan(3.6e-3);
  });

  it("clamps a reverse-biased zener at its rated breakdown", async () => {
    // 12 V drives 1k into the zener's CATHODE (reverse bias): the midpoint
    // clamps near the 5.1 V rating. Geometry flips the zener so k faces the
    // resistor: place it rotated 180 via swapped wiring instead - wire the
    // resistor into the k pin at (x+32) by routing across.
    const v = vsource(0, 0, "12");
    const r = resistor(96, -32, "1k");
    const z = diode(192, 32, "zener", "5V1", "DZ");
    const g = ground(0, 64);
    // R right end (128,-32) → down to (224,32) = zener k; zener a (160,32) → ground rail.
    const wires = [
      wire([{ x: 0, y: -32 }, { x: 64, y: -32 }]),
      wire([{ x: 128, y: -32 }, { x: 224, y: -32 }, { x: 224, y: 32 }]),
      wire([{ x: 160, y: 32 }, { x: 160, y: 64 }, { x: 0, y: 64 }]),
      wire([{ x: 0, y: 32 }, { x: 0, y: 64 }]),
    ];
    const result = await run({ components: [v, r, z, g], wires });
    const clamped = result.traces.find((t) => {
      const value = lastValue(t.values);
      return value > 4.6 && value < 5.9;
    });
    expect(clamped, "expected the divider midpoint clamped near 5.1 V").toBeTruthy();
  });

  it("rectifies a sine into a smoothing capacitor (half-wave rectifier)", async () => {
    // SINE source → diode → C(10u) ∥ R(10k) to ground: output stays positive
    // and near the peak minus one forward drop.
    const v = vsource(0, 0, "SINE(0 5 1k)");
    const d = diode(96, -32, "diode", "D", "D1");
    const r = resistor(224, 16, "10k");
    const c = capacitor(288, 16, "10u");
    const g = ground(0, 64);
    const wires = [
      wire([{ x: 0, y: -32 }, { x: 64, y: -32 }]),
      // diode k → output node feeding both R and C tops (rotate them onto x-axis spans)
      wire([{ x: 128, y: -32 }, { x: 192, y: -32 }, { x: 192, y: 16 }]),
      wire([{ x: 256, y: 16 }, { x: 256, y: 64 }]),
      wire([{ x: 320, y: 16 }, { x: 320, y: 64 }]),
      wire([{ x: 0, y: 32 }, { x: 0, y: 64 }, { x: 320, y: 64 }]),
    ];
    const result = await runTransientAnalysis(
      { components: [v, d, r, c, g], wires },
      { stopTime: 5e-3, steps: 500 },
    );
    expect(result.ok, result.ok ? "" : result.message).toBe(true);
    if (!result.ok) return;
    const out = result.traces.find((t) => Math.max(...t.values) > 3 && Math.min(...t.values) > -0.5);
    expect(out, "expected a rectified, mostly-positive output node").toBeTruthy();
  });

  it("still reports a helpful message for genuinely unsupported parts", async () => {
    const v = vsource(0, 0, "5");
    const g = ground(0, 64);
    const m: SchematicComponent = { id: uid("m"), kind: "nmos", x: 96, y: -32, rotation: 0, value: "NMOS", label: "M1" };
    const result = await runTransientAnalysis({ components: [v, m, g], wires: [] }, { stopTime: 1e-3, steps: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("diodes/LEDs/zeners");
  });
});

describe("diode companion model", () => {
  it("parses zener breakdown ratings", () => {
    expect(parseZenerBreakdown("5V1")).toBeCloseTo(5.1);
    expect(parseZenerBreakdown("5.1")).toBeCloseTo(5.1);
    expect(parseZenerBreakdown("BZX55C5V1")).toBeCloseTo(5.1);
    expect(parseZenerBreakdown("zener")).toBeNull();
  });

  it("LED default model drops ~2 V at 10 mA", () => {
    const spec = diodeSpecFor("led", "LED");
    expect(diodeCurrent(spec, 2.0)).toBeGreaterThan(3e-3);
    expect(diodeCurrent(spec, 2.0)).toBeLessThan(40e-3);
  });
});
