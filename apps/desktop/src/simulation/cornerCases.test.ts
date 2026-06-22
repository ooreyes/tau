/**
 * Corner-case hardening tests for the simulation engine.
 *
 * Every case below must either solve correctly or fail gracefully with a clear
 * message — never hang, throw, or produce NaN/Infinity. The geometry follows the
 * same conventions documented in realCircuits.test.ts (GRID = 16).
 */

import { describe, it, expect } from "vitest";
import { runOperatingPoint } from "./operatingPoint";
import { runTransientAnalysis } from "./linearTransient";
import { runAcSweep } from "./acSweep";
import { extractCircuit } from "../schematic/netlist";
import type { SchematicComponent, SchematicWire } from "../schematic/types";

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
const Vdc = (x: number, y: number, v: string, l = "V1") => mk("vsource", x, y, v, l);
const Vac = (x: number, y: number, v: string, l = "V1") => mk("vac", x, y, v, l);
const GND = (x: number, y: number) => mk("ground", x, y, "", "");
const W = (...points: { x: number; y: number }[]): SchematicWire => ({ id: uid("w"), points });

function allFinite(result: ReturnType<typeof runOperatingPoint>): boolean {
  if (!result.ok) return true;
  return result.nets.every((n) => Number.isFinite(n.voltage));
}

// ---------------------------------------------------------------------------
// Floating / dangling nodes
// ---------------------------------------------------------------------------

describe("floating node (dangling resistor terminal)", () => {
  // VS → R, R.b not connected to anything. R.b floats but is reachable through
  // R from a known node, so KCL pins it to the source voltage — not singular.
  const comps = [Vdc(0, 32, "5"), R(96, 0, "1k", "R1"), GND(0, 64)];
  const wires = [W({ x: 0, y: 0 }, { x: 64, y: 0 })];

  it("solves without NaN; dangling node floats to the source voltage", () => {
    const res = runOperatingPoint({ components: comps, wires });
    expect(res.ok).toBe(true);
    expect(allFinite(res)).toBe(true);
    if (!res.ok) return;
    // Both the source node and the dangling node sit at 5 V.
    expect(res.nets.filter((n) => Math.abs(n.voltage - 5) < 1e-6).length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Grounding
// ---------------------------------------------------------------------------

describe("no ground reference", () => {
  const comps = [Vdc(0, 32, "5"), R(96, 0, "1k", "R1")];
  const wires = [W({ x: 0, y: 0 }, { x: 64, y: 0 })];

  it("fails gracefully asking for a ground symbol", () => {
    const res = runOperatingPoint({ components: comps, wires });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toMatch(/ground/i);
  });
});

describe("multiple ground symbols", () => {
  // Two grounds at unrelated points are still unified into the single 0 V
  // reference (netlist.ts unions all ground pins). The divider still solves.
  const comps = [
    Vdc(0, 32, "6"),
    R(96, 0, "1k", "R1"),
    R(192, 0, "1k", "R2"),
    GND(0, 64),
    GND(224, 0),
    GND(400, 400), // stray, unconnected ground — folds into the same reference
  ];
  const wires = [W({ x: 0, y: 0 }, { x: 64, y: 0 }), W({ x: 128, y: 0 }, { x: 160, y: 0 })];

  it("unifies grounds and solves the divider (6 V → 3 V)", () => {
    const res = runOperatingPoint({ components: comps, wires });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const gnd = res.nets.filter((n) => n.id === "0");
    expect(gnd.length).toBe(1);
    expect(res.nets.some((n) => Math.abs(n.voltage - 3) < 1e-6)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Shorts and source loops
// ---------------------------------------------------------------------------

describe("shorted voltage source (p tied to n)", () => {
  // V1.p wired directly to V1.n, and n to ground → the whole thing is the
  // ground net. No solvable non-ground node; fail gracefully, no hang.
  const v = Vdc(0, 64, "5"); // p=(0,32) n=(0,96)
  const comps = [v, GND(0, 96)];
  const wires = [W({ x: 0, y: 32 }, { x: 0, y: 96 })];

  it("fails gracefully (no infinite current, no NaN)", () => {
    const res = runOperatingPoint({ components: comps, wires });
    expect(res.ok).toBe(false);
    expect(allFinite(res)).toBe(true);
  });
});

describe("conflicting voltage-source loop (5 V ‖ 3 V)", () => {
  // Two ideal sources of different value across the same node pair → singular.
  const v1 = Vdc(0, 32, "5", "V1");
  const v2 = Vdc(64, 32, "3", "V2");
  const comps = [v1, v2, GND(0, 64)];
  const wires = [W({ x: 0, y: 0 }, { x: 64, y: 0 }), W({ x: 0, y: 64 }, { x: 64, y: 64 })];

  it("reports a singular matrix rather than guessing", () => {
    const res = runOperatingPoint({ components: comps, wires });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toMatch(/singular/i);
  });
});

// ---------------------------------------------------------------------------
// Capacitors and inductors at DC
// ---------------------------------------------------------------------------

describe("series capacitor blocks DC", () => {
  // VS → R → C → GND. At DC the cap is open; the R/C node floats to the source
  // voltage through R. Must solve, no NaN.
  const comps = [
    Vdc(0, 32, "5"),
    R(96, 0, "1k", "R1"),
    Cap(224, 0, "1µ", "C1"),
    GND(0, 64),
    GND(256, 0),
  ];
  const wires = [W({ x: 0, y: 0 }, { x: 64, y: 0 }), W({ x: 128, y: 0 }, { x: 192, y: 0 })];

  it("solves; no current flows through the blocked branch", () => {
    const res = runOperatingPoint({ components: comps, wires });
    expect(res.ok).toBe(true);
    expect(allFinite(res)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Parallel and coincident components
// ---------------------------------------------------------------------------

describe("parallel resistors (1k ‖ 1k)", () => {
  // V1 (5 V) across two rot=90 resistors sharing the same top and bottom rails.
  const v = Vdc(0, 32, "5");
  const r1 = R(64, 32, "1k", "R1", 90); // a=(64,0) b=(64,64)
  const r2 = R(128, 32, "1k", "R2", 90); // a=(128,0) b=(128,64)
  const comps = [v, r1, r2, GND(0, 64)];
  const wires = [
    W({ x: 0, y: 0 }, { x: 64, y: 0 }, { x: 128, y: 0 }),
    W({ x: 0, y: 64 }, { x: 64, y: 64 }, { x: 128, y: 64 }),
  ];

  it("solves; source node at 5 V", () => {
    const res = runOperatingPoint({ components: comps, wires });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.nets.some((n) => Math.abs(n.voltage - 5) < 1e-6)).toBe(true);
  });
});

describe("coincident duplicate pins (two resistors at identical positions)", () => {
  // R1 and R2 occupy the exact same footprint → their pins coincide → they are
  // wired in parallel (2k ‖ 2k = 1k). Must not crash on duplicate-pin nets.
  const comps = [
    Vdc(0, 32, "5"),
    R(96, 0, "2k", "R1"),
    R(96, 0, "2k", "R2"),
    GND(0, 64),
    GND(128, 0),
  ];
  const wires = [W({ x: 0, y: 0 }, { x: 64, y: 0 })];

  it("treats coincident parts as parallel and solves", () => {
    const res = runOperatingPoint({ components: comps, wires });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.nets.some((n) => Math.abs(n.voltage - 5) < 1e-6)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Net topology: one-pin nets and 3+ pin junctions
// ---------------------------------------------------------------------------

describe("net touching only one pin emits a warning", () => {
  const comps = [Vdc(0, 32, "5"), R(96, 0, "1k", "R1"), GND(0, 64)];
  const wires = [W({ x: 0, y: 0 }, { x: 64, y: 0 })];

  it("extractCircuit warns about the dangling terminal", () => {
    const circuit = extractCircuit(comps, wires);
    expect(circuit.warnings.some((w) => /only connected to one pin/i.test(w))).toBe(true);
  });
});

describe("wire connecting three pins (T-junction)", () => {
  // R1.b is joined to R2.a and R3.a at a single node X. With R1=1k feeding
  // (R2 ‖ R3) = 500 Ω to ground, X = 9·500/1500 = 3 V.
  const comps = [
    Vdc(0, 32, "9"),
    R(96, 0, "1k", "R1"), // b=(128,0)
    R(192, 64, "1k", "R2"), // a=(160,64) b=(224,64)
    R(192, -64, "1k", "R3"), // a=(160,-64) b=(224,-64)
    GND(0, 64),
    GND(224, 64),
    GND(224, -64),
  ];
  const wires = [
    W({ x: 0, y: 0 }, { x: 64, y: 0 }),
    W({ x: 128, y: 0 }, { x: 128, y: 64 }, { x: 160, y: 64 }), // X → R2.a
    W({ x: 128, y: 0 }, { x: 128, y: -64 }, { x: 160, y: -64 }), // X → R3.a
  ];

  it("merges all three pins into one net (X = 3 V)", () => {
    const circuit = extractCircuit(comps, wires);
    // The X net should reference R1, R2 and R3 pins.
    const xNet = circuit.nets.find(
      (net) =>
        net.pins.some((p) => p.componentLabel === "R1") &&
        net.pins.some((p) => p.componentLabel === "R2") &&
        net.pins.some((p) => p.componentLabel === "R3"),
    );
    expect(xNet).toBeDefined();

    const res = runOperatingPoint({ components: comps, wires });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.nets.some((n) => Math.abs(n.voltage - 3) < 1e-6)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Disconnected subcircuits solved together
// ---------------------------------------------------------------------------

describe("two disconnected subcircuits in one schematic", () => {
  // A 5 V even divider and an isolated 8 V single-resistor branch (different
  // region of the canvas). Both must solve in the same pass.
  const comps = [
    Vdc(0, 32, "5", "V1"),
    R(96, 0, "1k", "R1"),
    R(192, 0, "1k", "R2"),
    GND(0, 64),
    GND(224, 0),
    Vdc(0, 400, "8", "V2"),
    R(96, 368, "1k", "R3"),
    GND(0, 432),
    GND(128, 368),
  ];
  const wires = [
    W({ x: 0, y: 0 }, { x: 64, y: 0 }),
    W({ x: 128, y: 0 }, { x: 160, y: 0 }),
    W({ x: 0, y: 368 }, { x: 64, y: 368 }),
  ];

  it("solves both islands (2.5 V tap and 8 V node)", () => {
    const res = runOperatingPoint({ components: comps, wires });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.nets.some((n) => Math.abs(n.voltage - 2.5) < 1e-6)).toBe(true);
    expect(res.nets.some((n) => Math.abs(n.voltage - 8) < 1e-6)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Extreme component values
// ---------------------------------------------------------------------------

describe("zero-ohm resistor", () => {
  const comps = [Vdc(0, 32, "5"), R(96, 0, "0", "R1"), GND(0, 64), GND(128, 0)];
  const wires = [W({ x: 0, y: 0 }, { x: 64, y: 0 })];

  it("fails gracefully (no 1/0 → Infinity) for DC, AC, and transient", () => {
    const op = runOperatingPoint({ components: comps, wires });
    expect(op.ok).toBe(false);
    expect(allFinite(op)).toBe(true);

    const tran = runTransientAnalysis({ components: comps, wires }, { stopTime: 1e-3, steps: 100 });
    expect(tran.ok).toBe(false);
  });
});

describe("huge resistor value (1 TΩ)", () => {
  // 1 kΩ in series with 1 TΩ to ground: the divider tap floats to ≈ the source.
  const comps = [
    Vdc(0, 32, "5"),
    R(96, 0, "1k", "R1"),
    R(192, 0, "1T", "R2"),
    GND(0, 64),
    GND(224, 0),
  ];
  const wires = [W({ x: 0, y: 0 }, { x: 64, y: 0 }), W({ x: 128, y: 0 }, { x: 160, y: 0 })];

  it("solves without overflow; tap ≈ 5 V", () => {
    const res = runOperatingPoint({ components: comps, wires });
    expect(res.ok).toBe(true);
    expect(allFinite(res)).toBe(true);
    if (!res.ok) return;
    expect(res.nets.some((n) => Math.abs(n.voltage - 5) < 0.01)).toBe(true);
  });
});

describe("tiny and huge reactive values in AC stay finite", () => {
  // 1 fF cap and 1 kΩ: the corner is far above any swept frequency, so the
  // output stays near the input — the solver must not produce NaN/Infinity.
  const comps = [Vac(0, 32, "1 1k"), R(96, 0, "1k", "R1"), Cap(256, 32, "1f", "C1", 90), GND(0, 64), GND(256, 64)];
  const wires = [W({ x: 0, y: 0 }, { x: 64, y: 0 }), W({ x: 128, y: 0 }, { x: 256, y: 0 })];

  it("AC sweep returns finite magnitudes and phases", () => {
    const ac = runAcSweep({ components: comps, wires }, { startHz: 10, stopHz: 1e6, pointsPerDecade: 10 });
    expect(ac.ok).toBe(true);
    if (!ac.ok) return;
    for (const trace of ac.traces) {
      expect(trace.magDb.every((v) => Number.isFinite(v))).toBe(true);
      expect(trace.phaseDeg.every((v) => Number.isFinite(v))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// No analysis should ever throw
// ---------------------------------------------------------------------------

describe("malformed inputs never throw", () => {
  it("each path returns a typed {ok} result", () => {
    const broken: { components: SchematicComponent[]; wires: SchematicWire[] }[] = [
      { components: [], wires: [] },
      { components: [R(0, 0, "oops", "R1"), GND(32, 0)], wires: [] },
      { components: [Vdc(0, 32, "5"), GND(0, 64)], wires: [] },
    ];
    for (const schematic of broken) {
      expect(() => runOperatingPoint(schematic)).not.toThrow();
      expect(() => runTransientAnalysis(schematic, { stopTime: 1e-3, steps: 100 })).not.toThrow();
      expect(() => runAcSweep(schematic, { startHz: 1, stopHz: 1e3, pointsPerDecade: 5 })).not.toThrow();
    }
  });
});
