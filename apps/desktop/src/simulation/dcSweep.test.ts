import { describe, it, expect } from "vitest";
import { parseDcDirective, runDcSweep } from "./dcSweep";
import { analysesFromDirectives } from "../io/directiveAnalysis";
import type { SchematicComponent, SchematicWire } from "../schematic/types";

// ---------------------------------------------------------------------------
// parseDcDirective
// ---------------------------------------------------------------------------

describe("parseDcDirective", () => {
  it("parses a plain linear source sweep", () => {
    expect(parseDcDirective(".dc V1 0 10 1")).toEqual({ source: "V1", start: 0, stop: 10, step: 1 });
  });

  it("strips a leading ! and reads SI-suffixed bounds", () => {
    expect(parseDcDirective("!dc Vin -5 5 0.5")).toEqual({ source: "Vin", start: -5, stop: 5, step: 0.5 });
    const i = parseDcDirective(".dc Iin 0 1m 100u");
    expect(i?.source).toBe("Iin");
    expect(i?.start).toBe(0);
    expect(i?.stop).toBeCloseTo(1e-3, 12);
    expect(i?.step).toBeCloseTo(1e-4, 12);
  });

  it("returns null for non-dc or malformed lines", () => {
    expect(parseDcDirective(".tran 1m")).toBeNull();
    expect(parseDcDirective(".dc V1 0 10")).toBeNull(); // missing increment
    expect(parseDcDirective(".dc V1 zero ten one")).toBeNull(); // unparseable numbers
    expect(parseDcDirective("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runDcSweep — hand-computed resistive divider
// ---------------------------------------------------------------------------

// V1 (p=n1, n=gnd) — R1 (n1..mid) — R2 (mid..gnd). Node voltages along a wire
// collapse, so we connect pins by sharing coordinates via wires.
//
//   n1 ---R1--- mid ---R2--- gnd
//   |                          |
//   V1+                       V1-/gnd
//
// V(mid) = Vsweep * R2 / (R1 + R2).  With R1=R2=1k → V(mid) = Vsweep/2.

function dividerSchematic(): { components: SchematicComponent[]; wires: SchematicWire[] } {
  const components: SchematicComponent[] = [
    { id: "v1", label: "V1", kind: "vsource", x: 0, y: 0, rotation: 0, value: "5",
      pinOverride: [
        { id: "p", label: "+", x: 0, y: 0 },
        { id: "n", label: "-", x: 0, y: 100 },
      ] },
    { id: "r1", label: "R1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k",
      pinOverride: [
        { id: "a", label: "a", x: 0, y: 0 },
        { id: "b", label: "b", x: 0, y: 50 },
      ] },
    { id: "r2", label: "R2", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k",
      pinOverride: [
        { id: "a", label: "a", x: 0, y: 50 },
        { id: "b", label: "b", x: 0, y: 100 },
      ] },
    { id: "g", label: "", kind: "ground", x: 0, y: 100, rotation: 0, value: "",
      pinOverride: [{ id: "g", label: "gnd", x: 0, y: 100 }] },
  ];
  // No wires needed: shared coordinates make pins coincident → same net.
  return { components, wires: [] };
}

describe("runDcSweep", () => {
  it("sweeps V1 0→10 and the divider midpoint tracks Vsweep/2", () => {
    const { components, wires } = dividerSchematic();
    const res = runDcSweep({ components, wires }, { source: "V1", start: 0, stop: 10, step: 2 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.sweep).toEqual([0, 2, 4, 6, 8, 10]);

    // Find the net at the divider midpoint (y=50): the node shared by R1.b/R2.a.
    // Identify it as the net whose voltage is half the source at every step.
    const mid = res.nets.find((n) =>
      n.voltages.every((v, k) => Math.abs(v - res.sweep[k] / 2) < 1e-9),
    );
    expect(mid).toBeDefined();
    expect(mid?.voltages).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("handles a descending sweep (stop < start)", () => {
    const { components, wires } = dividerSchematic();
    const res = runDcSweep({ components, wires }, { source: "V1", start: 4, stop: 0, step: 1 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.sweep).toEqual([4, 3, 2, 1, 0]);
  });

  it("errors on an unknown source", () => {
    const { components, wires } = dividerSchematic();
    const res = runDcSweep({ components, wires }, { source: "V9", start: 0, stop: 1, step: 1 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toMatch(/not found/);
  });

  it("errors when sweeping a non-source component", () => {
    const { components, wires } = dividerSchematic();
    const res = runDcSweep({ components, wires }, { source: "R1", start: 0, stop: 1, step: 1 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toMatch(/not an independent source/);
  });

  it("errors on a zero increment rather than looping forever", () => {
    const { components, wires } = dividerSchematic();
    const res = runDcSweep({ components, wires }, { source: "V1", start: 0, stop: 10, step: 0 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toMatch(/non-zero/);
  });

  it("rejects a sweep that would exceed the point cap", () => {
    const { components, wires } = dividerSchematic();
    const res = runDcSweep({ components, wires }, { source: "V1", start: 0, stop: 1e6, step: 1e-3 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toMatch(/max/);
  });

  // Mirrors App.runDcAnalysis: an imported circuit's own `.dc` directive is
  // mapped to a sweep spec, then run against the schematic — the path that
  // lets a real `.asc` sweep as authored.
  it("runs the sweep spec recovered from a document's `.dc` directive", () => {
    const { components, wires } = dividerSchematic();
    const { dc } = analysesFromDirectives([".param x=1", ".dc V1 0 10 5"]);
    expect(dc).toEqual({ source: "V1", start: 0, stop: 10, step: 5 });
    const res = runDcSweep({ components, wires }, dc!);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.sweep).toEqual([0, 5, 10]);
    const mid = res.nets.find((n) => n.label !== "GND" && n.voltages.every((v, k) => Math.abs(v - res.sweep[k] / 2) < 1e-9));
    expect(mid?.voltages).toEqual([0, 2.5, 5]);
  });
});
