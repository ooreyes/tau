import { describe, expect, it } from "vitest";
import type { SchematicComponent, SchematicForeignSymbol } from "../schematic/types";
import { assertSimulationIntegrity, simulationBlockReason } from "./simulationIntegrity";

const component = (ltSymbolType?: string): SchematicComponent => ({
  id: "component-1",
  kind: "resistor",
  label: "Q1",
  value: "1Meg",
  x: 0,
  y: 0,
  rotation: 0,
  ...(ltSymbolType ? { ltSymbolType } : {}),
});

describe("simulation integrity", () => {
  it.each(["misc\\DIAC", "misc/TRIAC", "SPECIALFUNCTIONS\\VARISTOR"])(
    "refuses the imported %s geometry carrier before simulation",
    (ltSymbolType) => {
      const reason = simulationBlockReason([component(ltSymbolType)]);
      expect(reason).toContain("Simulation refused: Q1");
      expect(reason).toContain(ltSymbolType);
      expect(reason).toContain("No approximate or partial circuit was run.");
      expect(() => assertSimulationIntegrity([component(ltSymbolType)])).toThrow(reason!);
    },
  );

  it("does not confuse a native Tau resistor with an imported carrier", () => {
    expect(simulationBlockReason([component()])).toBeNull();
    expect(() => assertSimulationIntegrity([component()])).not.toThrow();
  });

  it("refuses preserved foreign symbols and names their LTspice identity", () => {
    const foreign: SchematicForeignSymbol = {
      type: "PowerProducts\\LTC4449",
      x: 0,
      y: 0,
      orientation: "R0",
      attrs: { InstName: "U1", Value: "LTC4449" },
    };

    expect(simulationBlockReason([], [foreign])).toBe(
      "Simulation refused: U1 (PowerProducts\\LTC4449) has no electrically equivalent Tau model. Replace or map each unsupported part to a user-supplied subcircuit. No approximate or partial circuit was run.",
    );
  });

  it("reports every unsupported part in one atomic refusal", () => {
    const foreign: SchematicForeignSymbol = {
      type: "Optos\\PC817D",
      x: 0,
      y: 0,
      orientation: "R0",
      attrs: { InstName: "U2" },
    };
    const reason = simulationBlockReason([component("misc\\DIAC")], [foreign]);
    expect(reason).toContain("Q1 (misc\\DIAC), U2 (Optos\\PC817D) have");
  });
});
