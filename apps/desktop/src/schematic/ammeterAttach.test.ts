import { describe, expect, it } from "vitest";
import { branchForWire, resolveAmmeterTarget, wireAtPoint } from "./ammeterAttach";
import type { SchematicComponent, SchematicWire } from "./types";

/**
 * An ammeter reports the current through a branch. Dropping it on a wire is the
 * natural gesture, but a wire is not a branch — so the drop has to resolve to
 * the one part whose current that wire carries, and refuse when there isn't
 * exactly one. Guessing at a junction would put a confident number on screen
 * that belongs to a different part.
 */
const V: SchematicComponent = { id: "v", kind: "vsource", x: 0, y: 96, rotation: 0, value: "10V", label: "V1" };
const R1: SchematicComponent = { id: "r1", kind: "resistor", x: 192, y: 96, rotation: 90, value: "1k", label: "R1" };
const R2: SchematicComponent = { id: "r2", kind: "resistor", x: 384, y: 96, rotation: 90, value: "2k", label: "R2" };
const OPAMP: SchematicComponent = { id: "u1", kind: "opamp", x: 600, y: 96, rotation: 0, value: "", label: "U1" };
const UNNAMED: SchematicComponent = { id: "rx", kind: "resistor", x: 800, y: 96, rotation: 90, value: "1k", label: "" };

describe("ammeter attachment", () => {
  it("attaches to a part under the pointer", () => {
    const got = resolveAmmeterTarget({ x: 192, y: 96 }, R1, [], [V, R1]);
    expect(got).toEqual({ ok: true, componentId: "r1" });
  });

  it("resolves a wire in series with exactly one part", () => {
    // R1's `a` pin sits at (192,64); the wire runs to it.
    const wire: SchematicWire = { id: "w", points: [{ x: 64, y: 64 }, { x: 192, y: 64 }] };
    expect(branchForWire(wire, [R1])).toEqual({ ok: true, componentId: "r1" });
  });

  it("refuses a wire where the current splits", () => {
    // Both resistors' top pins land on this wire: the current divides here, so
    // there is no single branch to report.
    const wire: SchematicWire = { id: "bus", points: [{ x: 192, y: 64 }, { x: 384, y: 64 }] };
    const got = branchForWire(wire, [R1, R2]);
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.reason).toMatch(/junction|splits/i);
  });

  it("refuses a wire with no part in series", () => {
    const wire: SchematicWire = { id: "float", points: [{ x: 900, y: 900 }, { x: 964, y: 900 }] };
    const got = branchForWire(wire, [R1, R2]);
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.reason).toMatch(/no part/i);
  });

  it("refuses a part with no single branch current", () => {
    // An op-amp's pins are inputs, an output and rails — clamping round it
    // measures nothing well defined.
    const got = resolveAmmeterTarget({ x: 600, y: 96 }, OPAMP, [], [OPAMP]);
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.reason).toMatch(/no single branch/i);
  });

  it("refuses an unnamed part, because its current has no name to plot", () => {
    const got = resolveAmmeterTarget({ x: 800, y: 96 }, UNNAMED, [], [UNNAMED]);
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.reason).toMatch(/reference designator/i);
  });

  it("refuses a drop on empty canvas", () => {
    const got = resolveAmmeterTarget({ x: 5000, y: 5000 }, null, [], [R1]);
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.reason).toMatch(/component or a wire/i);
  });

  it("prefers the part under the pointer over the wire beneath it", () => {
    const wire: SchematicWire = { id: "w", points: [{ x: 64, y: 64 }, { x: 192, y: 64 }] };
    expect(resolveAmmeterTarget({ x: 192, y: 96 }, R2, [wire], [R1, R2]))
      .toEqual({ ok: true, componentId: "r2" });
  });

  it("finds the wire under a nearby click", () => {
    const wire: SchematicWire = { id: "w", points: [{ x: 0, y: 0 }, { x: 128, y: 0 }] };
    expect(wireAtPoint([wire], { x: 64, y: 3 })?.id).toBe("w");
    expect(wireAtPoint([wire], { x: 64, y: 40 })).toBeNull();
  });
});
