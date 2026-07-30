import { describe, expect, it } from "vitest";
import { deriveDcRcBranches, deriveRcCurrents } from "./currents";
import type { ExtractedComponent } from "../schematic/netlist";
import type { SchematicComponent } from "../schematic/types";

function comp(kind: SchematicComponent["kind"], label: string, value: string, pins: Record<string, string>): ExtractedComponent {
  return { component: { id: label, kind, x: 0, y: 0, rotation: 0, value, label }, pins };
}

describe("deriveRcCurrents (native-path R/C currents from node voltages)", () => {
  it("derives resistor current as (Va - Vb)/R in a→b sign", () => {
    // R1 = 1k between node `out` (held at 2 V) and ground.
    const comps = [comp("resistor", "R1", "1k", { a: "out", b: "0" })];
    const voltages = new Map<string, number[]>([["out", [2, 2, 2]]]);
    const out = deriveRcCurrents(comps, voltages, [0, 1, 2]);
    expect(out).toHaveLength(1);
    expect(out[0].ref).toBe("R1");
    expect(out[0].label).toBe("I(R1)");
    expect(out[0].values).toEqual([0.002, 0.002, 0.002]);
  });

  it("derives capacitor current as C·dV/dt, zero at the first sample", () => {
    // C1 = 1µF; node `n` ramps 0→1→2 V over dt=1s ⇒ I = 1e-6 * 1 / 1 = 1µA.
    const comps = [comp("capacitor", "C1", "1u", { a: "n", b: "0" })];
    const voltages = new Map<string, number[]>([["n", [0, 1, 2]]]);
    const out = deriveRcCurrents(comps, voltages, [0, 1, 2]);
    expect(out[0].values[0]).toBe(0);
    expect(out[0].values[1]).toBeCloseTo(1e-6, 12);
    expect(out[0].values[2]).toBeCloseTo(1e-6, 12);
  });

  it("skips unlabeled parts and unparseable values", () => {
    const comps = [
      comp("resistor", "", "1k", { a: "out", b: "0" }), // no ref-des
      comp("resistor", "R2", "abc", { a: "out", b: "0" }), // bad value
    ];
    const voltages = new Map<string, number[]>([["out", [1]]]);
    expect(deriveRcCurrents(comps, voltages, [0])).toHaveLength(0);
  });

  it("treats ground ('0') and untraced nets as 0 V", () => {
    const comps = [comp("resistor", "R1", "2k", { a: "hot", b: "0" })];
    const voltages = new Map<string, number[]>([["hot", [4]]]);
    expect(deriveRcCurrents(comps, voltages, [0])[0].values[0]).toBeCloseTo(0.002, 9);
  });
});

describe("deriveDcRcBranches (operating-point R/C currents from node voltages)", () => {
  it("derives resistor current as (Va - Vb)/R, in the element's own pin order", () => {
    // The same 1k held at 2 V, wired the two ways round. The pin order is the
    // entire sign contract: it has to follow the element, not the magnitude.
    const forward = [comp("resistor", "R1", "1k", { a: "out", b: "0" })];
    const reversed = [comp("resistor", "R1", "1k", { a: "0", b: "out" })];
    const voltages = new Map<string, number>([["out", 2], ["0", 0]]);

    expect(deriveDcRcBranches(forward, voltages)).toEqual([
      { id: "R1", ref: "R1", label: "I(R1)", current: 0.002 },
    ]);
    expect(deriveDcRcBranches(reversed, voltages)[0].current).toBe(-0.002);
  });

  it("reports a capacitor as exactly zero rather than omitting it", () => {
    // A converged DC solution holds a capacitor's voltage constant, so its
    // current is zero however much voltage stands across it. Listing it is the
    // honest answer; leaving it out would read as "unknown".
    const comps = [comp("capacitor", "C1", "1u", { a: "n", b: "0" })];
    const voltages = new Map<string, number>([["n", 12], ["0", 0]]);
    expect(deriveDcRcBranches(comps, voltages)).toEqual([
      { id: "C1", ref: "C1", label: "I(C1)", current: 0 },
    ]);
  });

  it("skips a resistor with an unknown terminal instead of reading it as ground", () => {
    // `floating` is absent from the map, not zero in it. Defaulting it to 0
    // would report 4 mA through R1 with nothing saying the node was never
    // solved for.
    const comps = [comp("resistor", "R1", "1k", { a: "hot", b: "floating" })];
    const voltages = new Map<string, number>([["hot", 4]]);
    expect(deriveDcRcBranches(comps, voltages)).toHaveLength(0);
  });

  it("skips unlabeled parts and unparseable values, like the transient path", () => {
    const comps = [
      comp("resistor", "", "1k", { a: "out", b: "0" }),
      comp("resistor", "R2", "abc", { a: "out", b: "0" }),
      comp("resistor", "R3", "0", { a: "out", b: "0" }),
    ];
    const voltages = new Map<string, number>([["out", 1], ["0", 0]]);
    expect(deriveDcRcBranches(comps, voltages)).toHaveLength(0);
  });
});
