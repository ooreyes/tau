import { describe, expect, it } from "vitest";
import type { NetLabel, SchematicComponent } from "../schematic/types";
import {
  blankEditableMeasurement,
  editableMeasurementFromDirective,
  measurementAuthoringContext,
  serializeEditableMeasurement,
  validateEditableMeasurements,
} from "./measurementAuthoring";

const components: SchematicComponent[] = [
  { id: "v1", kind: "vsource", x: 0, y: 32, rotation: 0, label: "V1", value: "10" },
  { id: "r1", kind: "resistor", x: 128, y: 0, rotation: 90, label: "R1", value: "8" },
];
const netLabels: NetLabel[] = [
  { id: "rail", x: 0, y: 0, text: "vcc" },
  { id: "out", x: 128, y: -32, text: "vo" },
  { id: "g1", x: 0, y: 64, text: "0" },
  { id: "g2", x: 128, y: 32, text: "0" },
];

describe("measurement authoring", () => {
  it("decodes supported measurements while retaining their exact imported line", () => {
    const raw = ".meas tran PL avg V(vo)*I(R1)";
    const row = editableMeasurementFromDirective(raw, "m1")!;
    expect(row).toMatchObject({ name: "PL", calculation: "AVG", quantity: "formula", formula: "V(vo)*I(R1)" });
    expect(serializeEditableMeasurement(row, measurementAuthoringContext(components, [], netLabels))).toBe(raw);
    expect(editableMeasurementFromDirective(".meas tran t1 WHEN V(vo)=2 RISE=1", "m2")).toBeNull();
  });

  it("authors load power, delivered source power, and derived efficiency without raw directive entry", () => {
    const context = measurementAuthoringContext(components, [], netLabels);
    const load = { ...blankEditableMeasurement("m1"), name: "PL", quantity: "component-power" as const, target: "R1" };
    const supply = { ...blankEditableMeasurement("m2"), name: "PS", quantity: "component-power-delivered" as const, target: "V1" };
    const efficiency = { ...blankEditableMeasurement("m3"), name: "Efficiency", calculation: "PARAM" as const, quantity: "formula" as const, formula: "PL/PS" };
    expect(validateEditableMeasurements([load, supply, efficiency], context)).toBeNull();
    expect(serializeEditableMeasurement(load, context)).toBe(".meas tran PL AVG V(vo)*I(R1)");
    expect(serializeEditableMeasurement(supply, context)).toBe(".meas tran PS AVG -(V(vcc)*I(V1))");
    expect(serializeEditableMeasurement(efficiency, context)).toBe(".meas tran Efficiency PARAM PL/PS");
  });

  it("rejects duplicate names and incomplete structured targets", () => {
    const context = measurementAuthoringContext(components, [], netLabels);
    const first = { ...blankEditableMeasurement("m1"), name: "gain", target: "vo" };
    const duplicate = { ...blankEditableMeasurement("m2"), name: "GAIN", target: "vo" };
    expect(validateEditableMeasurements([first, duplicate], context)).toMatch(/more than once/);
    expect(validateEditableMeasurements([{ ...first, target: "" }], context)).toBe("Choose a node for gain.");
  });
});
