import { describe, expect, it } from "vitest";
import type { SchematicComponent } from "../schematic/types";
import {
  inspectOpampModel,
  opampIdentity,
  opampSubcktHeader,
  withOpampModel,
} from "./opampModel";

const opamp = (overrides: Partial<SchematicComponent> = {}): SchematicComponent => ({
  id: "u1",
  kind: "opamp",
  label: "U1",
  value: "",
  x: 0,
  y: 0,
  rotation: 0,
  ...overrides,
});

describe("vendor op-amp model identity", () => {
  it("keeps the visible part separate from an LTspice Value2 model alias", () => {
    const component = opamp({
      value: "OP07 LT1001",
      ltSymbolType: "Opamps\\OP07",
      ltExtraAttrs: {
        baseValue: "OP07",
        derivedValue: "OP07 LT1001",
        extras: { Value2: "LT1001" },
      },
    });
    expect(opampIdentity(component)).toEqual({
      mode: "vendor",
      partName: "OP07",
      modelName: "LT1001",
      imported: true,
    });
  });

  it("does not mistake UniversalOpamp2 behavioral parameters for a vendor model", () => {
    expect(opampIdentity(opamp({
      value: "level.2 Avol=1Meg GBW=10Meg",
      ltSymbolType: "Opamps\\UniversalOpamp2",
    })).mode).toBe("behavioral");
  });

  it("parses a continued subckt interface without counting params as ports", () => {
    expect(opampSubcktHeader(
      ".subckt AMP in+ in- v+\n+ v- out params: A=1Meg\nR1 out 0 1k\n.ends AMP",
      "amp",
    )).toEqual({ name: "AMP", ports: ["in+", "in-", "v+", "v-", "out"] });
  });

  it("reports ready, missing, and incompatible attached definitions", () => {
    const component = opamp({ value: "LT1001", ltSymbolType: "Opamps\\LT1001" });
    expect(inspectOpampModel(component, [], []).kind).toBe("missing");
    expect(inspectOpampModel(component, [], [
      ".subckt LT1001 1 2 3 4 5\nE1 5 0 1 2 1e6\n.ends LT1001",
    ])).toMatchObject({ kind: "ready", source: "library" });
    expect(inspectOpampModel(component, [], [
      ".subckt LT1001 1 2 3 4 5 6 7\nR1 1 2 1k\n.ends LT1001",
    ])).toMatchObject({ kind: "incompatible", portCount: 7 });
  });

  it("writes an imported model edit to Value2 and preserves the visible part", () => {
    const changed = withOpampModel(opamp({
      value: "OP07 LT1001 ilimit=2",
      ltSymbolType: "Opamps\\OP07",
      ltExtraAttrs: {
        baseValue: "OP07",
        derivedValue: "OP07 LT1001 ilimit=2",
        extras: { Value2: "LT1001", SpiceLine: "ilimit=2" },
      },
    }), "MY_OP07");
    expect(changed.value).toBe("OP07 MY_OP07 ilimit=2");
    expect(changed.ltExtraAttrs).toEqual({
      baseValue: "OP07",
      derivedValue: "OP07 MY_OP07 ilimit=2",
      extras: { Value2: "MY_OP07", SpiceLine: "ilimit=2" },
    });
  });

  it("refuses model-name text that could inject ASC or deck syntax", () => {
    const component = opamp({ value: "LT1001", ltSymbolType: "Opamps\\LT1001" });
    expect(withOpampModel(component, "EVIL\nSYMATTR Value2 OTHER")).toBe(component);
    expect(withOpampModel(component, "MODEL gain=2")).toBe(component);
    expect(withOpampModel(component, "x".repeat(161))).toBe(component);
  });
});
