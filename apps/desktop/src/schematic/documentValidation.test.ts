import { describe, expect, it } from "vitest";
import { validateSchematicDocument } from "./documentValidation";

const validDocument = () => ({
  components: [
    { id: "r1", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" },
  ],
  wires: [
    { id: "w1", points: [{ x: 64, y: 0 }, { x: 128, y: 0 }] },
  ],
  probes: [{ id: "p1", x: 64, y: 0, color: "var(--trace-red)" }],
  netLabels: [{ id: "n1", x: 64, y: 0, text: "OUT" }],
});

describe("schematic document validation", () => {
  it("accepts a bounded Tau document and preserves annotations", () => {
    expect(validateSchematicDocument(validDocument())).toEqual(validDocument());
  });

  it("rejects unknown parts and invalid coordinates before SVG rendering", () => {
    const unknown = validDocument();
    unknown.components[0].kind = "arbitrary-code";
    expect(() => validateSchematicDocument(unknown)).toThrow(/not supported/i);

    const nonFinite = validDocument();
    nonFinite.components[0].x = Number.POSITIVE_INFINITY;
    expect(() => validateSchematicDocument(nonFinite)).toThrow(/finite coordinate/i);
  });

  it("rejects diagonal wires and unsafe probe colors", () => {
    const diagonal = validDocument();
    diagonal.wires[0].points[1] = { x: 128, y: 32 };
    expect(() => validateSchematicDocument(diagonal)).toThrow(/orthogonal/i);

    const unsafeColor = validDocument();
    unsafeColor.probes[0].color = "url(javascript:alert(1))";
    expect(() => validateSchematicDocument(unsafeColor)).toThrow(/color is not supported/i);
  });

  it("rejects null / undefined / non-object inputs", () => {
    expect(() => validateSchematicDocument(null)).toThrow();
    expect(() => validateSchematicDocument(undefined)).toThrow();
    expect(() => validateSchematicDocument("corrupted string")).toThrow();
    expect(() => validateSchematicDocument(42)).toThrow();
  });

  it("accepts documents with missing optional probes and netLabels arrays", () => {
    const minimal = { components: [], wires: [] };
    const result = validateSchematicDocument(minimal);
    expect(result.probes).toEqual([]);
    expect(result.netLabels).toEqual([]);
  });

  it("rejects wires with fewer than two points", () => {
    const bad = validDocument();
    bad.wires[0].points = [{ x: 0, y: 0 }];
    expect(() => validateSchematicDocument(bad)).toThrow(/at least two points/i);
  });

  it("rejects components with invalid rotation", () => {
    const bad = validDocument();
    bad.components[0].rotation = 45;
    expect(() => validateSchematicDocument(bad)).toThrow(/0, 90, 180, or 270/i);
  });
});
