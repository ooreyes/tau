import { describe, expect, it } from "vitest";
import { getComponentPins } from "./pins";
import type { SchematicComponent } from "./types";

describe("getComponentPins", () => {
  it("derives pins from kind geometry + rotation when no override is present", () => {
    const r: SchematicComponent = {
      id: "r1", kind: "resistor", label: "R1", value: "1k", x: 100, y: 50, rotation: 0,
    };
    const pins = getComponentPins(r);
    expect(pins.map((p) => ({ id: p.id, x: p.x, y: p.y }))).toEqual([
      { id: "a", x: 68, y: 50 },
      { id: "b", x: 132, y: 50 },
    ]);
  });

  it("rotates derived pins about the component origin", () => {
    const r: SchematicComponent = {
      id: "r1", kind: "resistor", label: "R1", value: "1k", x: 0, y: 0, rotation: 90,
    };
    // (-32,0) and (32,0) rotate 90° → (0,-32) and (0,32).
    expect(getComponentPins(r).map((p) => ({ x: p.x, y: p.y }))).toEqual([
      { x: 0, y: -32 },
      { x: 0, y: 32 },
    ]);
  });

  it("uses pinOverride world positions verbatim, ignoring kind geometry", () => {
    const r: SchematicComponent = {
      id: "r1", kind: "resistor", label: "R1", value: "1k", x: 999, y: 999, rotation: 90,
      pinOverride: [
        { id: "a", label: "A", x: 320, y: 208 },
        { id: "b", label: "B", x: 240, y: 208 },
      ],
    };
    const pins = getComponentPins(r);
    expect(pins).toHaveLength(2);
    expect(pins.map((p) => ({ id: p.id, x: p.x, y: p.y }))).toEqual([
      { id: "a", x: 320, y: 208 },
      { id: "b", x: 240, y: 208 },
    ]);
    // Identity metadata still flows from the component.
    expect(pins[0].componentId).toBe("r1");
    expect(pins[0].kind).toBe("resistor");
  });

  it("falls back to kind geometry when pinOverride is empty", () => {
    const r: SchematicComponent = {
      id: "r1", kind: "resistor", label: "R1", value: "1k", x: 0, y: 0, rotation: 0,
      pinOverride: [],
    };
    expect(getComponentPins(r)).toHaveLength(2);
    expect(getComponentPins(r)[0].x).toBe(-32);
  });
});
