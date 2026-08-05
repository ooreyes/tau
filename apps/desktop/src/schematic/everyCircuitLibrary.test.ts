import { describe, expect, it } from "vitest";
import { buildSpiceDeck } from "../engine/spiceNetlist";
import { runOperatingPoint } from "../simulation/operatingPoint";
import { isCapacitorKind, logicConstantVolts } from "./kindGroups";
import type { SchematicComponent } from "./types";

function c(
  kind: SchematicComponent["kind"],
  label: string,
  value: string,
  x: number,
  y: number,
): SchematicComponent {
  return { id: label.toLowerCase(), kind, label, value, x, y, rotation: 0 };
}

describe("EveryCircuit library — polarized capacitor + logic constant", () => {
  it("treats polarizedCapacitor as a capacitor kind", () => {
    expect(isCapacitorKind("polarizedCapacitor")).toBe(true);
    expect(isCapacitorKind("capacitor")).toBe(true);
    expect(isCapacitorKind("inductor")).toBe(false);
  });

  it("parses logic-constant levels honestly", () => {
    expect(logicConstantVolts("0")).toBe(0);
    expect(logicConstantVolts("1")).toBe(1);
    expect(logicConstantVolts("high")).toBe(1);
    expect(logicConstantVolts("low")).toBe(0);
    expect(logicConstantVolts("3.3")).toBe(3.3);
  });

  it("emits polarizedCapacitor as a real C device (same as capacitor)", () => {
    const components: SchematicComponent[] = [
      {
        ...c("vsource", "V1", "5", 0, 0),
        pinOverride: [
          { id: "p", label: "+", x: 0, y: 0 },
          { id: "n", label: "-", x: 0, y: 64 },
        ],
      },
      {
        ...c("polarizedCapacitor", "C1", "10u", 64, 0),
        pinOverride: [
          { id: "a", label: "+", x: 0, y: 0 },
          { id: "b", label: "−", x: 0, y: 64 },
        ],
      },
      {
        ...c("ground", "GND", "", 0, 64),
        pinOverride: [{ id: "g", label: "0", x: 0, y: 64 }],
      },
    ];
    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });
    expect(deck.netlist).toMatch(/^C1 n001 0 /m);
    expect(deck.netlist).not.toMatch(/unsupported|refused/i);
  });

  it("emits logicConstant as a DC voltage source and solves OP", () => {
    const components: SchematicComponent[] = [
      {
        id: "v1",
        kind: "logicConstant",
        label: "V1",
        value: "1",
        x: 0,
        y: 32,
        rotation: 0,
        pinOverride: [
          { id: "p", label: "+", x: 0, y: 0 },
          { id: "n", label: "-", x: 0, y: 64 },
        ],
      },
      {
        id: "r1",
        kind: "resistor",
        label: "R1",
        value: "1k",
        x: 32,
        y: 0,
        rotation: 0,
        pinOverride: [
          { id: "a", label: "A", x: 0, y: 0 },
          { id: "b", label: "B", x: 0, y: 64 },
        ],
      },
      {
        id: "gnd",
        kind: "ground",
        label: "",
        value: "",
        x: 0,
        y: 64,
        rotation: 0,
        pinOverride: [{ id: "g", label: "0", x: 0, y: 64 }],
      },
    ];
    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });
    expect(deck.netlist).toMatch(/^V1\b.+\bDC 1\b/m);

    const op = runOperatingPoint({ components, wires: [] });
    expect(op.ok).toBe(true);
    if (!op.ok) return;
    const hot = op.nets.find((n) => Math.abs(n.voltage - 1) < 1e-6);
    expect(hot?.voltage).toBeCloseTo(1, 6);
  });
});
