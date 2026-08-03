import { describe, expect, it } from "vitest";
import type { SchematicComponent } from "./types";
import { buildSubcircuitPinOverride, localSubcircuitPins, nativeSubcircuitBody } from "./subcircuitGeometry";

const component = (rotation: 0 | 90 | 180 | 270 = 0, mirrored = false): SchematicComponent => ({
  id: "x1", kind: "subckt", x: 96, y: 192, rotation, mirrored,
  value: "driver", label: "X1",
});

describe("native subcircuit geometry", () => {
  it("creates a grid-aligned five-terminal left/right block in SpiceOrder", () => {
    const pins = buildSubcircuitPinOverride(component(), ["vcc", "vee", "pwm", "gp", "gn"]);
    expect(pins).toEqual([
      { id: "p1", label: "vcc", x: 48, y: 160 },
      { id: "p2", label: "vee", x: 48, y: 192 },
      { id: "p3", label: "pwm", x: 48, y: 224 },
      { id: "p4", label: "gp", x: 144, y: 176 },
      { id: "p5", label: "gn", x: 144, y: 208 },
    ]);
    expect(pins.every((pin) => pin.x % 16 === 0 && pin.y % 16 === 0)).toBe(true);
  });

  it("preserves authored local terminal roles through orientation", () => {
    const base = component(90, true);
    const withPins = { ...base, pinOverride: buildSubcircuitPinOverride(base, ["in", "out"]) };
    expect(localSubcircuitPins(withPins).map(({ id, label, x, y }) => ({ id, label, x, y }))).toEqual([
      { id: "p1", label: "in", x: -48, y: 0 },
      { id: "p2", label: "out", x: 48, y: 0 },
    ]);
  });

  it("grows the body to cover long terminal banks", () => {
    const base = component();
    const withPins = { ...base, pinOverride: buildSubcircuitPinOverride(base, Array.from({ length: 9 }, (_, i) => `p${i}`)) };
    expect(nativeSubcircuitBody(withPins)).toEqual({ minX: -28, minY: -76, maxX: 28, maxY: 76 });
  });
});
