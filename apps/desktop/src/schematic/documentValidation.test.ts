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

  it("preserves bounded LTspice value-slot provenance and rejects forged slots", () => {
    const base = validDocument();
    const ltExtraAttrs = {
      baseValue: "",
      derivedValue: "Avol=1Meg GBW=10Gig",
      extras: { Value2: "Avol=1Meg", SpiceLine: "GBW=10Gig" },
    };
    const document = {
      ...base,
      components: [{ ...base.components[0], value: ltExtraAttrs.derivedValue, ltExtraAttrs }],
    };
    expect(validateSchematicDocument(document)).toEqual(document);

    const bad = (attrs: unknown) => () => validateSchematicDocument({
      ...base,
      components: [{ ...base.components[0], ltExtraAttrs: attrs }],
    });
    expect(bad({ ...ltExtraAttrs, extras: { "SpiceLine\nSYMBOL": "x" } })).toThrow(/field name/i);
    expect(bad({ ...ltExtraAttrs, extras: { SpiceLine: "x\nFLAG 0 0 0" } })).toThrow(/control character/i);
    expect(bad({ ...ltExtraAttrs, extras: Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [`Slot${index}`, "x"]),
    ) })).toThrow(/at most 16/i);
  });

  it("preserves bounded hierarchy provenance and rejects orphaned or duplicate owners", () => {
    const base = validDocument();
    const hierarchy = {
      ...base,
      components: [{
        ...base.components[0],
        ltHierarchy: { owner: "h-1", original: "exact component snapshot" },
      }],
      ascHierarchicalBlocks: [{
        type: "mydiv",
        x: 200,
        y: 200,
        orientation: "R0",
        attrs: { InstName: "X1" },
        provenance: { owner: "h-1", componentCount: 1, wireCount: 0, netLabelCount: 0 },
      }],
    };
    expect(validateSchematicDocument(hierarchy)).toEqual(hierarchy);

    expect(() => validateSchematicDocument({
      ...hierarchy,
      ascHierarchicalBlocks: [],
    })).toThrow(/missing owner/i);
    expect(() => validateSchematicDocument({
      ...hierarchy,
      ascHierarchicalBlocks: [
        hierarchy.ascHierarchicalBlocks[0],
        { ...hierarchy.ascHierarchicalBlocks[0], attrs: { InstName: "X2" } },
      ],
    })).toThrow(/owners must be unique/i);
    expect(() => validateSchematicDocument({
      ...hierarchy,
      ascHierarchicalBlocks: [{
        ...hierarchy.ascHierarchicalBlocks[0],
        provenance: { ...hierarchy.ascHierarchicalBlocks[0].provenance, componentCount: -1 },
      }],
    })).toThrow(/componentCount/i);
  });

  it("preserves LTspice label placement and rejects a record it could not write back", () => {
    const base = validDocument();
    const document = {
      ...base,
      components: [{
        ...base.components[0],
        ltWindows: [{ attr: 3, x: 32, y: 56, justification: "VTop", size: 2 }],
      }],
    };
    expect(validateSchematicDocument(document)).toEqual(document);

    // These are re-emitted verbatim into `.asc` text, so a document that
    // reaches Tau with a record LTspice cannot read must be refused rather
    // than round-tripped into a corrupt save.
    const bad = (window: Record<string, unknown>) => () => validateSchematicDocument({
      ...base,
      components: [{ ...base.components[0], ltWindows: [window] }],
    });
    expect(bad({ attr: 3, x: 0, y: 0, justification: "Sideways", size: 2 })).toThrow(/justification/i);
    expect(bad({ attr: -1, x: 0, y: 0, justification: "Left", size: 2 })).toThrow(/attr/i);
    expect(bad({ attr: 3, x: 0, y: 0, justification: "Left", size: 1.5 })).toThrow(/size/i);
    expect(bad({ attr: 3, x: Infinity, y: 0, justification: "Left", size: 2 })).toThrow(/coordinate/i);
  });

  it("rejects duplicate ids, duplicate references, and dangling current-probe references", () => {
    const duplicateId = validDocument();
    duplicateId.wires[0].id = "r1";
    expect(() => validateSchematicDocument(duplicateId)).toThrow(/ids must be unique/i);

    const duplicateRef = validDocument();
    duplicateRef.components.push({ ...duplicateRef.components[0], id: "r2", label: "r1" });
    expect(() => validateSchematicDocument(duplicateRef)).toThrow(/component reference "R1" is used 2 times/i);

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

  it("accepts diagonal wires and rejects unsafe probe colors", () => {
    // LTspice permits diagonal wire segments and imported .asc documents keep
    // them, so a document carrying one must round-trip through save/load.
    const diagonal = validDocument();
    diagonal.wires[0].points[1] = { x: 128, y: 32 };
    expect(() => validateSchematicDocument(diagonal)).not.toThrow();

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

  it("round-trips attached vendor model libraries", () => {
    const withLibraries = {
      ...validDocument(),
      userModelLibraries: [
        { name: "opamps.lib", text: ".subckt OA out in\nR1 in out 1k\n.ends" },
        { name: "diodes.mod", text: ".model MyD D(Is=1e-14)" },
      ],
    };
    expect(validateSchematicDocument(withLibraries)).toEqual(withLibraries);
  });

  it("omits userModelLibraries entirely when a document has none, so legacy files keep their shape", () => {
    const result = validateSchematicDocument(validDocument());
    expect(Object.prototype.hasOwnProperty.call(result, "userModelLibraries")).toBe(false);
  });

  it("rejects a library entry that is not a { name, text } object", () => {
    const bad = { ...validDocument(), userModelLibraries: ["just a string"] };
    expect(() => validateSchematicDocument(bad)).toThrow(/userModelLibraries\[0\] must be an object/i);
  });

  it("rejects more than the attachment-count limit", () => {
    const many = Array.from({ length: 65 }, (_, i) => ({ name: `lib${i}.lib`, text: "* x" }));
    const bad = { ...validDocument(), userModelLibraries: many };
    expect(() => validateSchematicDocument(bad)).toThrow(/at most 64 items/i);
  });

  it("rejects duplicate library names (they would inline twice)", () => {
    const bad = {
      ...validDocument(),
      userModelLibraries: [
        { name: "dup.lib", text: "* a" },
        { name: "dup.lib", text: "* b" },
      ],
    };
    expect(() => validateSchematicDocument(bad)).toThrow(/names must be unique/i);
  });

  it("rejects an attachment set whose total text exceeds the aggregate cap", () => {
    // Each file is within the per-file cap, but together they blow the aggregate
    // bound (4x the per-file limit) - a hand-crafted resource-exhaustion attempt.
    const chunk = "x".repeat(5 * 1024 * 1024);
    const bad = {
      ...validDocument(),
      userModelLibraries: Array.from({ length: 5 }, (_, i) => ({ name: `big${i}.lib`, text: chunk })),
    };
    expect(() => validateSchematicDocument(bad)).toThrow(/aggregate limit/i);
  });

  it("preserves drawing primitives and rejects an entry it could not write back", () => {
    const base = validDocument();
    const document = {
      ...base,
      ascShapes: [
        { kind: "LINE", width: "Normal", coords: [0, 0, 16, 16] },
        { kind: "ARC", width: "Wide", coords: [0, 0, 100, 100, 0, 100, 100, 0, 2] },
      ],
    };
    expect(validateSchematicDocument(document)).toEqual(document);

    // Re-emitted verbatim into `.asc` text, so a document that reaches Tau with
    // a record LTspice cannot read must be refused rather than round-tripped
    // into a corrupt save.
    const bad = (shape: Record<string, unknown>) => () => validateSchematicDocument({
      ...base,
      ascShapes: [shape],
    });
    expect(bad({ kind: "TRIANGLE", width: "Normal", coords: [0, 0, 16, 16] })).toThrow(/kind/i);
    expect(bad({ kind: "LINE", width: "Dotted", coords: [0, 0, 16, 16] })).toThrow(/width/i);
    expect(bad({ kind: "LINE", width: "Normal", coords: [0, "x", 16, 16] })).toThrow(/coordinate/i);
    // Re-emitted through Math.round, so a fraction would shift the drawing.
    expect(bad({ kind: "LINE", width: "Normal", coords: [0.5, 0, 16, 16] })).toThrow(/whole number/i);
    expect(bad({ kind: "LINE", width: "Normal", coords: Array.from({ length: 10 }, () => 0) })).toThrow(/coords/i);
    // The coordinate count is part of the grammar: a LINE carrying an ARC's
    // eight coordinates would serialize to a record LTspice cannot read back.
    expect(bad({ kind: "LINE", width: "Normal", coords: [0, 0, 1, 1, 2, 2, 3, 3] })).toThrow(/4 or 5 numbers for a LINE/);
    expect(bad({ kind: "ARC", width: "Normal", coords: [0, 0, 16, 16] })).toThrow(/8 or 9 numbers for an? ARC/);
  });

  it("omits ascShapes entirely when a document has none, so legacy files keep their shape", () => {
    const result = validateSchematicDocument(validDocument());
    expect(Object.prototype.hasOwnProperty.call(result, "ascShapes")).toBe(false);
  });

  it("preserves foreign symbols and rejects an entry with an unsupported orientation", () => {
    const base = validDocument();
    const document = {
      ...base,
      ascForeignSymbols: [
        {
          type: "PowerProducts\\LTC4449",
          x: 100,
          y: 200,
          orientation: "R0",
          attrs: { InstName: "U1", Value: "LTC4449" },
          windows: [{ attr: 0, x: 24, y: 16, justification: "Left", size: 2 }],
        },
      ],
    };
    expect(validateSchematicDocument(document)).toEqual(document);

    // Re-emitted verbatim into `.asc` text, so a document that reaches Tau
    // with a record LTspice cannot read must be refused rather than
    // round-tripped into a corrupt save.
    const bad = (symbol: Record<string, unknown>) => () => validateSchematicDocument({
      ...base,
      ascForeignSymbols: [symbol],
    });
    expect(bad({ type: "X", x: 0, y: 0, orientation: "Sideways", attrs: {} })).toThrow(/orientation/i);
  });

  it("omits ascForeignSymbols entirely when a document has none, so legacy files keep their shape", () => {
    const result = validateSchematicDocument(validDocument());
    expect(Object.prototype.hasOwnProperty.call(result, "ascForeignSymbols")).toBe(false);
  });

  it("refuses a foreign symbol whose fields would forge extra `.asc` records", () => {
    const base = validDocument();
    const bad = (symbol: Record<string, unknown>) => () => validateSchematicDocument({
      ...base,
      ascForeignSymbols: [symbol],
    });
    const at = (extra: Record<string, unknown>) => ({
      type: "PowerProducts\\LTC4449", x: 0, y: 0, orientation: "R0", attrs: {}, ...extra,
    });

    // `SYMBOL <type> <x> <y> <orientation>` is space-delimited: a newline in
    // the type appends whole records, a space shifts the coordinates.
    expect(bad(at({ type: "res 0 0 R0\nWIRE 0 0 64 0" }))).toThrow(/type/i);
    expect(bad(at({ type: "two words" }))).toThrow(/type/i);
    expect(bad(at({ type: "" }))).toThrow(/type/i);

    // `SYMATTR <name> <value>`: same exposure on both fields.
    expect(bad(at({ attrs: { "InstName U1\nFLAG 0 0 0": "x" } }))).toThrow(/field name/i);
    expect(bad(at({ attrs: { "": "x" } }))).toThrow(/field name/i);
    expect(bad(at({ attrs: { InstName: "U1\nSYMBOL res 0 0 R0" } }))).toThrow(/control character/i);

    // A value's interior spaces are ordinary - it is the last field on its
    // line - and must keep validating, or real vendor parts would be refused.
    const spaced = at({ attrs: { SpiceLine: "Rser=1 Cpar=2" } });
    expect(validateSchematicDocument({ ...base, ascForeignSymbols: [spaced] }).ascForeignSymbols)
      .toEqual([spaced]);
  });
});
