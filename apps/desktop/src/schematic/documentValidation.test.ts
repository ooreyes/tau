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
  directives: [".param Rload=10k", ".tran 1m"],
});

describe("schematic document validation", () => {
  it("accepts a bounded Tau document and preserves annotations", () => {
    expect(validateSchematicDocument(validDocument())).toEqual(validDocument());
  });

  it("preserves imported pin geometry and voltage/current probe identity", () => {
    const base = validDocument();
    const document = {
      ...base,
      components: [{
        ...base.components[0],
        pinOverride: [
          { id: "a", label: "A", x: 64, y: 0 },
          { id: "b", label: "B", x: 128, y: 0 },
        ],
        ltSymbolType: "res2",
      }],
      probes: [
        { id: "pv", x: 64, y: 0, color: "var(--trace-red)", netId: "OUT" },
        { id: "pi", x: 96, y: 0, color: "var(--trace-cyan)", componentId: "r1" },
      ],
    };

    expect(validateSchematicDocument(document)).toEqual(document);
  });

  it("rejects duplicate ids, duplicate references, and dangling current-probe references", () => {
    const duplicateId = validDocument();
    duplicateId.wires[0].id = "r1";
    expect(() => validateSchematicDocument(duplicateId)).toThrow(/ids must be unique/i);

    const duplicateRef = validDocument();
    duplicateRef.components.push({ ...duplicateRef.components[0], id: "r2", label: "r1" });
    expect(() => validateSchematicDocument(duplicateRef)).toThrow(/reference designators must be unique/i);

    const danglingProbe = validDocument();
    danglingProbe.probes[0] = { ...danglingProbe.probes[0], componentId: "missing" } as typeof danglingProbe.probes[number];
    expect(() => validateSchematicDocument(danglingProbe)).toThrow(/missing component/i);
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

  it("accepts documents with missing optional probes, netLabels, and directives arrays", () => {
    const minimal = { components: [], wires: [] };
    const result = validateSchematicDocument(minimal);
    expect(result.probes).toEqual([]);
    expect(result.netLabels).toEqual([]);
    expect(result.directives).toEqual([]);
  });

  it("preserves SPICE directives and rejects a non-string directive", () => {
    expect(validateSchematicDocument(validDocument()).directives).toEqual([".param Rload=10k", ".tran 1m"]);

    const bad = validDocument();
    (bad.directives as unknown[])[0] = 42;
    expect(() => validateSchematicDocument(bad)).toThrow(/directives\[0\] must be a string/i);
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

  it("round-trips a net label's dx/dy offset (Fix 2 - manual placement)", () => {
    const withOffset: ReturnType<typeof validDocument> & { netLabels: Array<Record<string, unknown>> } = validDocument();
    withOffset.netLabels[0] = { ...withOffset.netLabels[0], dx: 12, dy: -30 };
    const result = validateSchematicDocument(withOffset);
    expect(result.netLabels?.[0]).toEqual({ id: "n1", x: 64, y: 0, text: "OUT", dx: 12, dy: -30 });
  });

  it("leaves dx/dy undefined for a net label that never set them, so old .sim files keep loading as auto-placed", () => {
    // `validDocument()`'s net label has no dx/dy - the shape saved before
    // Fix 2 existed.
    const result = validateSchematicDocument(validDocument());
    const label = result.netLabels?.[0];
    expect(label).toBeDefined();
    expect(label!.dx).toBeUndefined();
    expect(label!.dy).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(label, "dx")).toBe(false);
  });
});
