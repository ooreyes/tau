/**
 * Tests for the DC operating-point solver.
 *
 * Circuit connectivity geometry (all rotation 0 unless stated):
 *   GRID = 16
 *   Two-terminal: pin "a" at (x-32, y), pin "b" at (x+32, y)
 *   vsource: pin "p" at (x, y-32), pin "n" at (x, y+32)
 *   ground: pin "g" at (x, y)
 */

import { describe, it, expect } from "vitest";
import { runOperatingPoint } from "./operatingPoint";
import { extractCircuit } from "../schematic/netlist";
import type { SchematicComponent, SchematicWire } from "../schematic/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let counter = 0;
function uid(prefix: string) {
  return `${prefix}-${++counter}`;
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

function inductor(x: number, y: number, value: string, label = "L1"): SchematicComponent {
  return { id: uid("l"), kind: "inductor", x, y, rotation: 0, value, label };
}

function ground(x: number, y: number): SchematicComponent {
  return { id: uid("gnd"), kind: "ground", x, y, rotation: 0, value: "", label: "" };
}

function wire(points: { x: number; y: number }[]): SchematicWire {
  return { id: uid("w"), points };
}

// ---------------------------------------------------------------------------
// Test 1 - Resistive voltage divider
// ---------------------------------------------------------------------------
describe("DC operating point - resistive voltage divider", () => {
  /**
   * VS=10V at (0,32): p=(0,0), n=(0,64)
   * R1=1kΩ at (96,0): a=(64,0), b=(128,0)
   * R2=1kΩ at (192,0): a=(160,0), b=(224,0)
   * GND at (0,64): g=(0,64) - VS.n
   * GND at (224,0): g=(224,0) - R2.b
   * Wire: (0,0)→(64,0), (128,0)→(160,0)
   *
   * Expected: mid-node ≈ 5V, source node = 10V
   */
  const V1 = vsource(0, 32, "10V", "V1");
  const R1 = resistor(96, 0, "1k", "R1");
  const R2 = resistor(192, 0, "1k", "R2");
  const GND_vs = ground(0, 64);
  const GND_r2 = ground(224, 0);

  const components = [V1, R1, R2, GND_vs, GND_r2];
  const wires = [
    wire([{ x: 0, y: 0 }, { x: 64, y: 0 }]),
    wire([{ x: 128, y: 0 }, { x: 160, y: 0 }]),
  ];

  it("returns ok=true", () => {
    const result = runOperatingPoint({ components, wires });
    expect(result.ok).toBe(true);
  });

  it("includes ground net at 0 V", () => {
    const result = runOperatingPoint({ components, wires });
    if (!result.ok) throw new Error(result.message);
    const gnd = result.nets.find(n => n.id === "0");
    expect(gnd).toBeDefined();
    expect(gnd?.label).toBe("GND");
    expect(gnd?.voltage).toBe(0);
  });

  it("returns friendly node labels for display", () => {
    const result = runOperatingPoint({ components, wires });
    if (!result.ok) throw new Error(result.message);
    const sourceNet = result.nets.find(n => n.label.includes("V1") && n.label.includes("R1"));
    expect(sourceNet?.label).toMatch(/^V\(.+\)$/);
  });

  it("source node is 10 V (within 0.1%)", () => {
    const result = runOperatingPoint({ components, wires });
    if (!result.ok) throw new Error(result.message);
    // Source node: the net containing VS.p(0,0) and R1.a(64,0)
    const sourceNet = result.nets.find(n => n.id !== "0" && Math.abs(n.voltage - 10) < 0.5);
    expect(sourceNet).toBeDefined();
    if (sourceNet) {
      expect(Math.abs(sourceNet.voltage - 10) / 10).toBeLessThan(0.001);
    }
  });

  it("mid-node is 5 V (within 0.1%)", () => {
    const result = runOperatingPoint({ components, wires });
    if (!result.ok) throw new Error(result.message);
    const midNet = result.nets.find(n => n.id !== "0" && Math.abs(n.voltage - 5) < 0.5);
    expect(midNet).toBeDefined();
    if (midNet) {
      expect(Math.abs(midNet.voltage - 5) / 5).toBeLessThan(0.001);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 2 - Asymmetric divider (R1=2k, R2=1k) → mid = 10/3 V
// ---------------------------------------------------------------------------
describe("DC operating point - asymmetric divider", () => {
  /**
   * VS=10V, R1=2k, R2=1k
   * Expected mid = 10 * R2/(R1+R2) = 10 * 1/3 ≈ 3.333 V
   */
  const V1 = vsource(0, 32, "10V", "V1");
  const R1 = resistor(96, 0, "2k", "R1");
  const R2 = resistor(192, 0, "1k", "R2");
  const GND_vs = ground(0, 64);
  const GND_r2 = ground(224, 0);

  const components = [V1, R1, R2, GND_vs, GND_r2];
  const wires = [
    wire([{ x: 0, y: 0 }, { x: 64, y: 0 }]),
    wire([{ x: 128, y: 0 }, { x: 160, y: 0 }]),
  ];

  it("returns ok=true", () => {
    const result = runOperatingPoint({ components, wires });
    expect(result.ok).toBe(true);
  });

  it("mid-node ≈ 3.333 V (within 0.1%)", () => {
    const result = runOperatingPoint({ components, wires });
    if (!result.ok) throw new Error(result.message);
    const expected = 10 / 3;
    const midNet = result.nets.find(n => n.id !== "0" && Math.abs(n.voltage - expected) < 1);
    expect(midNet).toBeDefined();
    if (midNet) {
      expect(Math.abs(midNet.voltage - expected) / expected).toBeLessThan(0.001);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 3 - Capacitor treated as open (ignored)
// ---------------------------------------------------------------------------
describe("DC operating point - capacitor as open circuit", () => {
  /**
   * VS=5V, R=1kΩ, C=1µF in parallel with R.
   *   At DC, C is open → C carries no current → divider behaves the same.
   *
   *   VS at (0,32): p=(0,0), n=(0,64)
   *   R at (96,0): a=(64,0), b=(128,0)
   *   C at (96,64): a=(64,64), b=(128,64)  ← parallel branch (different y)
   *   GND at (0,64): g=(0,64)
   *   GND at (128,0): g=(128,0)
   *
   *   Wire: VS.p(0,0)→R.a(64,0), VS.n(0,64)→C.a(64,64) via wire
   *   Wire: R.b(128,0)→GND(128,0) coincide; C.b(128,64)→GND(0,64) via wire
   *
   *   Actually simpler: just one series R, C shunted to ground doesn't change DC:
   *
   *   VS at (0,32): p=(0,0), n=(0,64)
   *   R at (96,0): a=(64,0), b=(128,0)
   *   C at (224,0): a=(192,0), b=(256,0)   ← series cap is OPEN → node 192 floats
   *
   *   To avoid floating: use R to ground and cap in parallel.
   *   VS → R → GND, cap across R (open at DC → same as no cap).
   *
   *   VS at (0,32): p=(0,0), n=(0,64)
   *   R  at (96,0): a=(64,0), b=(128,0)
   *   GND at (0,64)
   *   GND at (128,0): g=(128,0) - R.b
   *   Wire: VS.p(0,0)→R.a(64,0)
   *
   *   Cap in parallel with R → cap.a connects to (64,0)=R.a (VS+), cap.b connects to (128,0)=R.b (GND).
   *   C at (96,0): same position as R would make pin collisions with R - use different y.
   *   Cap at (96,100): a=(64,100), b=(128,100)
   *   Wire: (64,0)→(64,100)→... but let's just place cap coinciding with R pins.
   *   C at (96,0) same as R → pins coincide perfectly, cap in parallel with R.
   *   That's fine - the cap is open, so no impact.
   *
   *   Simplest: cap in series with another R, both grounded. VS→R1→mid→cap (open)→...
   *   mid floats because cap is open. That's bad.
   *
   *   Use: VS → R → GND. Separately, cap across the VS (open → no effect on DC).
   *   VS at (0,32): p=(0,0), n=(0,64)
   *   R at (96,0): a=(64,0), b=(128,0)
   *   GND at (0,64): VS.n
   *   GND at (128,0): R.b
   *   Cap at (0,0): a=(-32,0), b=(32,0)  - across VS.p side + some floating node
   *   That's messy.
   *
   *   CLEANEST: same R-only circuit + add a cap in parallel (same pins).
   *   The cap is open → result should be same single-resistor circuit: VS node = 5V.
   */
  const V1 = vsource(0, 32, "5V", "V1");
  const R = resistor(96, 0, "1k", "R1");
  // Cap at same x as R: a=(64,0), b=(128,0) - in parallel with R
  const C = capacitor(96, 0, "1µ", "C1");
  const GND_vs = ground(0, 64);
  const GND_r = ground(128, 0);

  const components = [V1, R, C, GND_vs, GND_r];
  const wires = [
    wire([{ x: 0, y: 0 }, { x: 64, y: 0 }]),
  ];

  it("returns ok=true", () => {
    const result = runOperatingPoint({ components, wires });
    expect(result.ok).toBe(true);
  });

  it("node voltage is 5 V (cap open → no effect)", () => {
    const result = runOperatingPoint({ components, wires });
    if (!result.ok) throw new Error(result.message);
    const vsNode = result.nets.find(n => n.id !== "0" && Math.abs(n.voltage - 5) < 1);
    expect(vsNode).toBeDefined();
    if (vsNode) {
      expect(Math.abs(vsNode.voltage - 5) / 5).toBeLessThan(0.001);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 4 - Inductor treated as short
// ---------------------------------------------------------------------------
describe("DC operating point - inductor as short circuit", () => {
  /**
   * VS=10V → L (short) → GND. With L as wire, VS sees a dead short.
   * The L branch current is 10/0... wait, L is a 0V source: V_L=0.
   * So V(+terminal) = V(-terminal). If VS.p → L.a → L.b → GND, then
   * L.b = GND = 0, L.a = 0 (short), so VS+ is forced to 0? No:
   * VS forces its node to 10V, and L is a 0V source across its own pins.
   * This creates a voltage conflict unless nodes are set up correctly.
   *
   * Let's build: VS → R → L → GND.
   * At DC: L is short. So effectively VS → R → GND (L wire adds no voltage drop).
   * The mid-node (between R.b and L.a) = GND = 0 V.
   * Source node = 10 V.
   *
   *   VS at (0,32): p=(0,0), n=(0,64)
   *   R  at (96,0): a=(64,0), b=(128,0)
   *   L  at (192,0): a=(160,0), b=(224,0)
   *   GND at (0,64): VS.n
   *   GND at (224,0): L.b
   *   Wire: VS.p(0,0)→R.a(64,0), R.b(128,0)→L.a(160,0)
   *
   *   With L as 0V source between L.a(160,0) and L.b(224,0)=GND:
   *   L.a = L.b = 0 V (short to GND).
   *   So V(R.b) = V(L.a) = 0 V → all current flows through R → GND via L.
   *   Source node = 10V, R.b / L.a node = 0V.
   */
  const V1 = vsource(0, 32, "10V", "V1");
  const R = resistor(96, 0, "1k", "R1");
  const L = inductor(192, 0, "1m", "L1");
  const GND_vs = ground(0, 64);
  const GND_l = ground(224, 0);

  const components = [V1, R, L, GND_vs, GND_l];
  const wires = [
    wire([{ x: 0, y: 0 }, { x: 64, y: 0 }]),
    wire([{ x: 128, y: 0 }, { x: 160, y: 0 }]),
  ];

  it("returns ok=true", () => {
    const result = runOperatingPoint({ components, wires });
    expect(result.ok).toBe(true);
  });

  it("source node is 10 V", () => {
    const result = runOperatingPoint({ components, wires });
    if (!result.ok) throw new Error(result.message);
    const sourceNet = result.nets.find(n => n.id !== "0" && Math.abs(n.voltage - 10) < 1);
    expect(sourceNet).toBeDefined();
    if (sourceNet) {
      expect(Math.abs(sourceNet.voltage - 10) / 10).toBeLessThan(0.001);
    }
  });

  it("inductor node (shorted to GND) is 0 V", () => {
    const result = runOperatingPoint({ components, wires });
    if (!result.ok) throw new Error(result.message);
    // R.b / L.a node should be at 0 V (inductor shorts it to ground)
    const shortedNet = result.nets.find(n => n.id !== "0" && Math.abs(n.voltage) < 0.01);
    expect(shortedNet).toBeDefined();
    if (shortedNet) {
      expect(shortedNet.voltage).toBeCloseTo(0, 3);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 5 - Simple resistor network (T-network)
// ---------------------------------------------------------------------------
describe("DC operating point - T-resistor network", () => {
  /**
   * T-network (pi-topology without the right leg):
   *   VS=12V → Ra=3k → mid → Rb=1k → GND
   *   V(mid) = 12 * 1/(3+1) = 3V
   *
   *   VS at (0,32): p=(0,0), n=(0,64)
   *   Ra at (96,0): a=(64,0), b=(128,0)      R=3k
   *   Rb at (192,0): a=(160,0), b=(224,0)     R=1k
   *   GND at (0,64): VS.n
   *   GND at (224,0): Rb.b
   *   Wire: VS.p(0,0)→Ra.a(64,0), Ra.b(128,0)→Rb.a(160,0)
   */
  const V1 = vsource(0, 32, "12V", "V1");
  const Ra = resistor(96, 0, "3k", "Ra");
  const Rb = resistor(192, 0, "1k", "Rb");
  const GND_vs = ground(0, 64);
  const GND_rb = ground(224, 0);

  const components = [V1, Ra, Rb, GND_vs, GND_rb];
  const wires = [
    wire([{ x: 0, y: 0 }, { x: 64, y: 0 }]),
    wire([{ x: 128, y: 0 }, { x: 160, y: 0 }]),
  ];

  it("returns ok=true", () => {
    const result = runOperatingPoint({ components, wires });
    expect(result.ok).toBe(true);
  });

  it("mid-node ≈ 3 V (Rb/(Ra+Rb) * VS)", () => {
    const result = runOperatingPoint({ components, wires });
    if (!result.ok) throw new Error(result.message);
    const expected = 12 * (1 / (3 + 1)); // = 3 V
    const midNet = result.nets.find(n => n.id !== "0" && Math.abs(n.voltage - expected) < 1);
    expect(midNet).toBeDefined();
    if (midNet) {
      expect(Math.abs(midNet.voltage - expected) / expected).toBeLessThan(0.001);
    }
  });

  it("source node ≈ 12 V", () => {
    const result = runOperatingPoint({ components, wires });
    if (!result.ok) throw new Error(result.message);
    const sourceNet = result.nets.find(n => n.id !== "0" && Math.abs(n.voltage - 12) < 1);
    expect(sourceNet).toBeDefined();
    if (sourceNet) {
      expect(Math.abs(sourceNet.voltage - 12) / 12).toBeLessThan(0.001);
    }
  });
});

// ---------------------------------------------------------------------------
// Seven-segment loads preserve the solved pin voltages for simulator rendering
// ---------------------------------------------------------------------------
describe("DC operating point - seven-segment node voltages", () => {
  it("returns the actual driven segment and common-reference voltages", () => {
    const display: SchematicComponent = {
      id: uid("seg"),
      kind: "sevenSeg",
      x: 96,
      y: 0,
      rotation: 0,
      value: "",
      label: "U1",
    };
    // U1.A=(56,-32), U1.COM=(56,32); V1.P=(0,0), V1.N=(0,64).
    const components = [
      vsource(0, 32, "5V", "V1"),
      display,
      ground(0, 64),
      ground(56, 32),
    ];
    const wires = [wire([{ x: 0, y: 0 }, { x: 0, y: -32 }, { x: 56, y: -32 }])];
    const circuit = extractCircuit(components, wires);
    const entry = circuit.components.find(({ component }) => component.id === display.id);
    const result = runOperatingPoint({ components, wires });

    expect(result.ok).toBe(true);
    expect(entry).toBeDefined();
    if (!result.ok || !entry) return;
    const segment = result.nets.find((net) => net.id === entry.pins.a);
    const common = result.nets.find((net) => net.id === entry.pins.com);
    expect(segment?.voltage).toBeCloseTo(5, 6);
    expect(common?.voltage).toBeCloseTo(0, 6);
  });
});

// ---------------------------------------------------------------------------
// Test 6 - Failure cases
// ---------------------------------------------------------------------------
describe("DC operating point - failure cases", () => {
  it("no ground → ok=false", () => {
    const V1 = vsource(0, 32, "5V", "V1");
    const R = resistor(96, 0, "1k", "R1");
    const components = [V1, R];
    const wires = [wire([{ x: 0, y: 0 }, { x: 64, y: 0 }])];

    const result = runOperatingPoint({ components, wires });
    expect(result.ok).toBe(false);
  });

  it("no voltage source → ok=false", () => {
    const R = resistor(96, 0, "1k", "R1");
    const GND = ground(128, 0);
    const components = [R, GND];
    const wires: SchematicWire[] = [];

    const result = runOperatingPoint({ components, wires });
    expect(result.ok).toBe(false);
  });

  it("empty schematic → ok=false", () => {
    const result = runOperatingPoint({ components: [], wires: [] });
    expect(result.ok).toBe(false);
  });

  it("singular circuit (VS+ shorted to GND) → ok=false", () => {
    // VS with both p and n grounded → singular (VS forces 5V but ground forces 0V on same node)
    const V1 = vsource(0, 32, "5V", "V1");
    const GND_n = ground(0, 64);   // VS.n=(0,64) coincides
    const GND_p = ground(0, 0);    // VS.p=(0,0) coincides - forces VS+ to GND
    const components = [V1, GND_n, GND_p];
    const wires: SchematicWire[] = [];

    const result = runOperatingPoint({ components, wires });
    expect(result.ok).toBe(false);
  });

  it("does not throw - all failures return {ok: false}", () => {
    // Verify none of the failure cases throw
    const cases = [
      runOperatingPoint({ components: [], wires: [] }),
      runOperatingPoint({
        components: [vsource(0, 32, "5V"), ground(0, 64)],
        wires: [],
      }),
      runOperatingPoint({
        components: [resistor(96, 0, "1k"), ground(128, 0)],
        wires: [],
      }),
    ];
    for (const result of cases) {
      expect(typeof result.ok).toBe("boolean");
      if (!result.ok) {
        expect(typeof result.message).toBe("string");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Test 7 - Junction diodes (Newton iteration over the shared companion model)
// ---------------------------------------------------------------------------
describe("DC operating point - junction diodes", () => {
  function diode(x: number, y: number, kind: "diode" | "led" | "zener", value = "", label = "D1"): SchematicComponent {
    return { id: uid("d"), kind, x, y, rotation: 0, value, label };
  }

  /**
   * VS=5V at (0,32): p=(0,0), n=(0,64)
   * R1=1kΩ at (96,0): a=(64,0), b=(128,0)
   * D1 at (192,0): a=(160,0), k=(224,0)
   * GND at (0,64) - VS.n; GND at (224,0) - D1.k
   * Wire: (0,0)→(64,0), (128,0)→(160,0)
   */
  function forwardBiased(kind: "diode" | "led" | "zener", value = "") {
    const components = [
      vsource(0, 32, "5V", "V1"),
      resistor(96, 0, "1k", "R1"),
      diode(192, 0, kind, value),
      ground(0, 64),
      ground(224, 0),
    ];
    const wires = [
      wire([{ x: 0, y: 0 }, { x: 64, y: 0 }]),
      wire([{ x: 128, y: 0 }, { x: 160, y: 0 }]),
    ];
    return runOperatingPoint({ components, wires });
  }

  it("forward silicon diode drops ≈ 0.6-0.75 V through 1 kΩ from 5 V", () => {
    const result = forwardBiased("diode");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const anode = result.nets.find((net) => /R1.*D1|D1.*R1/.test(net.label));
    expect(anode).toBeDefined();
    expect(anode!.voltage).toBeGreaterThan(0.55);
    expect(anode!.voltage).toBeLessThan(0.8);
  });

  it("forward LED sits near its ≈ 2 V forward voltage", () => {
    const result = forwardBiased("led");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const anode = result.nets.find((net) => /R1.*D1|D1.*R1/.test(net.label));
    expect(anode).toBeDefined();
    expect(anode!.voltage).toBeGreaterThan(1.5);
    expect(anode!.voltage).toBeLessThan(2.5);
  });

  it("a reverse-biased diode blocks - the load node pulls to the rail", () => {
    // Same topology but the diode flipped (rotation 180 swaps a/k): the node
    // between R1 and the cathode floats up to 5 V with only leakage flowing.
    const flipped: SchematicComponent = { id: uid("d"), kind: "diode", x: 192, y: 0, rotation: 180, value: "", label: "D1" };
    const components = [
      vsource(0, 32, "5V", "V1"),
      resistor(96, 0, "1k", "R1"),
      flipped,
      ground(0, 64),
      ground(224, 0),
    ];
    const wires = [
      wire([{ x: 0, y: 0 }, { x: 64, y: 0 }]),
      wire([{ x: 128, y: 0 }, { x: 160, y: 0 }]),
    ];
    const result = runOperatingPoint({ components, wires });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const node = result.nets.find((net) => /R1.*D1|D1.*R1/.test(net.label));
    expect(node).toBeDefined();
    expect(node!.voltage).toBeGreaterThan(4.9);
  });

  it("a 5.1 V zener fed 12 V through 1 kΩ regulates near its breakdown", () => {
    // Cathode to the resistor, anode to ground: reverse-biased into breakdown.
    const flippedZener: SchematicComponent = { id: uid("d"), kind: "zener", x: 192, y: 0, rotation: 180, value: "5.1", label: "D1" };
    const components = [
      vsource(0, 32, "12V", "V1"),
      resistor(96, 0, "1k", "R1"),
      flippedZener,
      ground(0, 64),
      ground(224, 0),
    ];
    const wires = [
      wire([{ x: 0, y: 0 }, { x: 64, y: 0 }]),
      wire([{ x: 128, y: 0 }, { x: 160, y: 0 }]),
    ];
    const result = runOperatingPoint({ components, wires });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const node = result.nets.find((net) => /R1.*D1|D1.*R1/.test(net.label));
    expect(node).toBeDefined();
    // Breakdown knee plus the exponential's ≈ 0.7 V of slope at ~6 mA.
    expect(node!.voltage).toBeGreaterThan(5.0);
    expect(node!.voltage).toBeLessThan(6.0);
  });
});
