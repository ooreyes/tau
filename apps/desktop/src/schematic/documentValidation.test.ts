import { describe, expect, it } from "vitest";
import {
  duplicateReferenceDesignators,
  liveSchematicDiagnostics,
  retiredKindNotices,
  validateSchematicDocument,
  type LiveDiagnostic,
} from "./documentValidation";
import { buildSpiceDeck } from "../engine/spiceNetlist";
import type { SchematicComponent, SchematicWire } from "./types";

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

  it("opens a saved document holding a retired kind, dropping it by name", () => {
    const base = validDocument();
    const saved = {
      ...base,
      components: [
        ...base.components,
        { id: "tp1", kind: "testpoint", x: 0, y: 0, rotation: 0, value: "", label: "TP1" },
      ],
    };
    // The document must still open, and must not keep the retired part.
    const document = validateSchematicDocument(saved);
    expect(document.components).toEqual(base.components);
    // Dropping it silently would change the drawing with no explanation.
    const notices = retiredKindNotices(saved);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("TP1");
    expect(notices[0]).toContain("Test Point");
  });

  it("still refuses a kind that was never a Tau part", () => {
    const base = validDocument();
    expect(() => validateSchematicDocument({
      ...base,
      components: [{ ...base.components[0], kind: "flux_capacitor" }],
    })).toThrow(/not supported/);
    expect(retiredKindNotices({ components: [{ kind: "flux_capacitor" }] })).toEqual([]);
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

  it("accepts only explicit ordered Tau project-sheet port contracts", () => {
    const document = {
      components: [{
        id: "x1", kind: "subckt", x: 0, y: 0, rotation: 0, value: "TauFilter", label: "X1",
        pinOverride: [
          { id: "p1", label: "IN", x: -48, y: -16 },
          { id: "p2", label: "OUT", x: 48, y: 16 },
        ],
        projectSubcircuit: { sheetPath: "filters/rc.sim", model: "TauFilter", ports: ["IN", "OUT"] },
      }],
      wires: [], probes: [], directives: [],
      netLabels: [
        { id: "in", x: -48, y: -16, text: "IN", port: "In" },
        { id: "out", x: 48, y: 16, text: "OUT", port: "Out" },
      ],
      projectPorts: [
        { name: "IN", labelId: "in", direction: "In" },
        { name: "OUT", labelId: "out", direction: "Out" },
      ],
    };

    expect(validateSchematicDocument(document)).toEqual(document);
    expect(() => validateSchematicDocument({
      ...document,
      projectPorts: [
        document.projectPorts[0],
        { name: "in", labelId: "out", direction: "Out" },
      ],
    })).toThrow(/duplicated/i);
    expect(() => validateSchematicDocument({
      ...document,
      components: [{
        ...document.components[0],
        projectSubcircuit: { ...document.components[0].projectSubcircuit, model: "Different" },
      }],
    })).toThrow(/exactly match the subcircuit value/i);
    expect(() => validateSchematicDocument({
      ...document,
      components: [{ ...document.components[0], ltSymbolType: "Misc\\varistor" }],
    })).toThrow(/file-backed symbol metadata/i);
    expect(() => validateSchematicDocument({
      ...document,
      projectPorts: [{ name: "IN", labelId: "missing", direction: "In" }],
    })).toThrow(/does not exist/i);
  });

  it("preserves vendor-model metadata but rejects injected names and paths", () => {
    const base = validDocument();
    const component = {
      ...base.components[0],
      ltSymbolType: "Opamps\\OP07",
      ltModelName: "LT1001",
      ltModelFile: "vendor models/LTC.lib",
    };
    expect(validateSchematicDocument({ ...base, components: [component] }).components[0])
      .toMatchObject(component);

    const invalid = (field: string, value: string) => () => validateSchematicDocument({
      ...base,
      components: [{ ...component, [field]: value }],
    });
    expect(invalid("ltModelName", "LT1001\n.end")).toThrow(/control characters/i);
    expect(invalid("ltModelName", "LT1001 params=evil")).toThrow(/one SPICE name token/i);
    expect(invalid("ltModelFile", "LTC.lib\nSYMBOL forged")).toThrow(/control characters/i);
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

    const custom = validDocument();
    custom.probes[0].color = "#ff00aa";
    expect(validateSchematicDocument(custom).probes?.[0]?.color).toBe("#ff00aa");
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

/**
 * P3-14 — the schematic dock has to catch problems BEFORE Run.
 *
 * `validateSchematicDocument` above cannot do this job and never could: every
 * check in it ends in `fail()`, so it can report exactly one problem and only
 * by refusing to open the file. These cover the linter that can produce a list,
 * one case per class the report enumerates, plus the two ordering/robustness
 * invariants the dock depends on.
 */
describe("live schematic diagnostics (P3-14)", () => {
  const codesOf = (rows: LiveDiagnostic[]) => rows.map((row) => row.code);
  const find = (rows: LiveDiagnostic[], code: LiveDiagnostic["code"]) =>
    rows.find((row) => row.code === code);

  const resistor = (extra: Partial<SchematicComponent> = {}): SchematicComponent => ({
    id: "r1", kind: "resistor", x: 128, y: 0, rotation: 0, value: "1k", label: "R1", ...extra,
  });

  /**
   * V1 → R1 → ground, fully wired: source present, ground present, no single-pin
   * net. The baseline every "one thing is wrong" case below perturbs, so that a
   * row appearing is attributable to the perturbation and not to the fixture.
   * Source pins sit at ±`SOURCE_PIN_Y` (32) and a two-terminal part's at ±32.
   */
  const soundCircuit = (): { components: SchematicComponent[]; wires: SchematicWire[] } => ({
    components: [
      { id: "v1", kind: "vsource", x: 0, y: 96, rotation: 0, value: "5", label: "V1" },
      resistor(),
      { id: "gnd", kind: "ground", x: 0, y: 160, rotation: 0, value: "", label: "" },
    ],
    wires: [
      { id: "w1", points: [{ x: 0, y: 64 }, { x: 0, y: 0 }, { x: 96, y: 0 }] },
      { id: "w2", points: [{ x: 160, y: 0 }, { x: 160, y: 160 }, { x: 0, y: 160 }] },
      { id: "w3", points: [{ x: 0, y: 128 }, { x: 0, y: 160 }] },
    ],
  });

  /** The fail-closed deck probe, exactly as App wires it: a thunk that throws
   *  the engine's own refusal. Injected rather than imported by the linter -
   *  see `LiveDiagnosticsInput.probeDeck`. */
  const deckProbe = (
    components: SchematicComponent[],
    wires: SchematicWire[],
    directives: string[] = [],
  ) => () => {
    buildSpiceDeck(
      { components, wires, netLabels: [], directives },
      { kind: "tran", stopTime: 1e-3, steps: 100 },
    );
  };

  it("says nothing at all about a sheet with no parts on it", () => {
    // A brand-new untitled schematic is empty, not broken. Without this an
    // untouched new file opens shouting "No ground symbol found."
    expect(liveSchematicDiagnostics({ components: [], wires: [] })).toEqual([]);
    expect(liveSchematicDiagnostics({ components: [], wires: [], netLabels: [{ id: "n", x: 0, y: 0, text: "out" }] })).toEqual([]);
  });

  it("still says it REFUSED an .asc whose parts are ALL foreign, where there is no Tau component to count", () => {
    // The import that carries nothing Tau can model: `ascForeignSymbols` is a
    // collection of its own, so `components` is empty and the empty-sheet gate
    // would have swallowed the refusal — silently presenting an unsimulatable
    // sheet as a clean one, which is precisely what fail-closed forbids.
    const rows = liveSchematicDiagnostics({
      components: [],
      wires: [],
      ascForeignSymbols: [
        { type: "PowerProducts\\LTC4449", x: 0, y: 0, orientation: "R0", attrs: { InstName: "U1" } },
      ],
    });
    expect(codesOf(rows)).toEqual(["unsupported-model"]);
    expect(rows[0].message).toContain("Simulation refused");
    expect(rows[0].message).toContain("No approximate or partial circuit was run.");
    // And nothing about ground or sources: a sheet Tau cannot model at all is
    // not a sheet to lecture about topology.
    expect(rows[0].severity).toBe("error");
  });

  it("reports nothing for a sound circuit, so the dock stays quiet when it should", () => {
    const { components, wires } = soundCircuit();
    expect(liveSchematicDiagnostics({ components, wires, probeDeck: deckProbe(components, wires) })).toEqual([]);
  });

  it("recovers a hierarchy compiler's structured instance focus", () => {
    const { components, wires } = soundCircuit();
    const error = Object.assign(
      new Error('Linked sheet "child.sim" used by instance "R1" is missing from the open project.'),
      { componentFocus: { componentId: "r1", reference: "R1" } },
    );
    const rows = liveSchematicDiagnostics({ components, wires, probeDeck: () => { throw error; } });
    const row = rows.find((candidate) => candidate.code === "directive-or-model");

    expect(row).toMatchObject({
      componentId: "r1",
      reference: "R1",
      focus: { kind: "component", componentId: "r1", reference: "R1" },
    });
  });

  it("flags no ground, no source and both floating pins on a lone resistor, with no run", () => {
    // The exact state the acceptance harness drops the app into: one part, no
    // wires, nothing run. Three of the nine classes have to fire from that.
    const rows = liveSchematicDiagnostics({ components: [resistor()], wires: [] });
    expect(codesOf(rows)).toEqual(["no-ground", "no-source", "floating-pin", "floating-pin"]);
    expect(find(rows, "no-ground")!.message).toBe("No ground symbol found.");
    expect(find(rows, "no-source")!.message).toMatch(/no source/i);
    // Each floating row names the offending part AND selects it on click.
    for (const row of rows.filter((r) => r.code === "floating-pin")) {
      expect(row.message).toMatch(/^R1\.[AB] is only connected to one pin\.$/);
      expect(row.componentId).toBe("r1");
      expect(row.reference).toBe("R1");
      expect(row.focus).toEqual({ kind: "component", componentId: "r1", reference: "R1" });
      expect(row.net).toMatchObject({ id: expect.any(String), x: expect.any(Number), y: expect.any(Number) });
    }
  });

  it("flags a source whose terminals land on one net, and names the source", () => {
    const { components, wires } = soundCircuit();
    // A wire straight from V1's + terminal to its - terminal.
    wires.push({ id: "short", points: [{ x: 0, y: 64 }, { x: -64, y: 64 }, { x: -64, y: 128 }, { x: 0, y: 128 }] });
    const rows = liveSchematicDiagnostics({ components, wires });
    const shorted = find(rows, "shorted-source")!;
    expect(shorted.message).toContain("V1");
    expect(shorted.message).toMatch(/shorted/i);
    expect(shorted.componentId).toBe("v1");
    expect(shorted.reference).toBe("V1");
    expect(shorted.focus).toEqual({ kind: "component", componentId: "v1", reference: "V1" });
    expect(shorted.severity).toBe("error");
  });

  it("flags a duplicate reference designator case-insensitively, pointing at the collider", () => {
    const { components, wires } = soundCircuit();
    // `r1` and `R1` are ONE instance name in the emitted deck.
    components.push(resistor({ id: "r2", label: "r1", x: 128, y: 320 }));
    const rows = liveSchematicDiagnostics({ components, wires });
    const duplicate = find(rows, "duplicate-reference")!;
    expect(duplicate.message).toContain('"R1" is used 2 times');
    // The second occurrence: the first is where the name legitimately came
    // from, and the collider is the part to go and rename.
    expect(duplicate.componentId).toBe("r2");
    expect(duplicate.reference).toBe("R1");
    expect(duplicate.focus).toEqual({ kind: "component", componentId: "r2", reference: "r1" });
  });

  it("flags an unparseable parameter value and an out-of-range one, naming the part", () => {
    const unparseable = soundCircuit();
    unparseable.components[1] = resistor({ value: "abc" });
    const badValue = find(liveSchematicDiagnostics(unparseable), "bad-parameter")!;
    expect(badValue.message).toBe("R1: Resistance: Enter a finite Ω.");
    expect(badValue.componentId).toBe("r1");

    // Out of range is the other half of the class, and it is a CROSS-FIELD
    // range on the op-amp - the case a single-field check would miss.
    const outOfRange = soundCircuit();
    outOfRange.components.push({
      id: "u1", kind: "opamp", x: 320, y: 0, rotation: 0, value: "Avol=1k Vmax=1 Vmin=5", label: "U1",
    });
    const range = find(liveSchematicDiagnostics(outOfRange), "bad-parameter")!;
    expect(range.message).toBe("U1: Minimum output must be below maximum output.");
    expect(range.componentId).toBe("u1");
  });

  it("flags a net label that names nothing, which extraction deliberately cannot", () => {
    const { components, wires } = soundCircuit();
    // `extractCircuit` treats a LABELLED single-pin net as connected on purpose
    // (probing an output through a bare flag), so a flag on empty canvas is
    // exactly the case it stays silent about.
    const rows = liveSchematicDiagnostics({
      components,
      wires,
      netLabels: [{ id: "n1", x: 512, y: 512, text: "endn" }],
    });
    const dangling = find(rows, "label-names-nothing")!;
    expect(dangling.message).toBe('Net label "endn" names nothing: it is not on a wire or a pin.');
    expect(dangling.net).toMatchObject({ label: "endn", x: 512, y: 512 });
    expect(dangling.focus).toMatchObject({ kind: "net", label: "endn", x: 512, y: 512 });
  });

  it("says it REFUSED an imported symbol with no Tau model rather than substituting one", () => {
    const { components, wires } = soundCircuit();
    // A preserved LTspice triac carried as a resistor: geometrically correct,
    // electrically a different device. Treating it as its Tau kind would
    // produce a believable and false waveform.
    components.push(resistor({ id: "u2", label: "U2", x: 320, y: 0, ltSymbolType: "triac" }));
    const rows = liveSchematicDiagnostics({ components, wires });
    const refused = find(rows, "unsupported-model")!;
    expect(refused.message).toContain("Simulation refused");
    expect(refused.message).toContain("no electrically equivalent Tau model");
    expect(refused.message).toContain("No approximate or partial circuit was run.");
    expect(refused.componentId).toBe("u2");
  });

  it("surfaces the deck's own refusal, verbatim, for a named model that resolved nowhere", () => {
    const { components, wires } = soundCircuit();
    // Same geometry as the resistor it replaces, so the loop stays intact and
    // the only thing wrong is the model name.
    components[1] = { id: "d1", kind: "diode", x: 128, y: 0, rotation: 0, value: "MYPART", label: "D1" };
    const rows = liveSchematicDiagnostics({
      components,
      wires,
      probeDeck: deckProbe(components, wires),
    });
    const refused = find(rows, "directive-or-model")!;
    expect(refused.message).toContain("Simulation refused");
    expect(refused.message).toContain('names model "MYPART"');
    expect(refused.componentId).toBe("d1");
  });

  it("surfaces a directive error as a row instead of waiting for Run to throw it", () => {
    const { components, wires } = soundCircuit();
    const directives = [".ic I(R1)=1m"];
    const rows = liveSchematicDiagnostics({
      components,
      wires,
      probeDeck: deckProbe(components, wires, directives),
    });
    const directive = find(rows, "directive-or-model")!;
    expect(directive.message).toContain(".ic I(R1)=1m requires an inductor");
    expect(directive.componentId).toBe("r1");
  });

  it("counts a logic constant as a source and a ground as not one, so the check survives new kinds", () => {
    // Derived from the catalog rather than a frozen kind list: `ground` lives
    // in the Sources SECTION and drives nothing, `logicConstant` lives under
    // Digital and is a DC source. A list that got either wrong would report
    // "no source" for a schematic that visibly has one - which is the worst
    // failure this check can produce, and the one P3-01's kind rewrite would
    // otherwise cause.
    const digital: SchematicComponent[] = [
      { id: "hi", kind: "logicConstant", x: 0, y: 96, rotation: 0, value: "5", label: "V1" },
      resistor(),
      { id: "gnd", kind: "ground", x: 0, y: 160, rotation: 0, value: "", label: "" },
    ];
    expect(codesOf(liveSchematicDiagnostics({ components: digital, wires: soundCircuit().wires })))
      .not.toContain("no-source");

    const groundOnly: SchematicComponent[] = [
      resistor(),
      { id: "gnd", kind: "ground", x: 0, y: 160, rotation: 0, value: "", label: "" },
    ];
    expect(codesOf(liveSchematicDiagnostics({ components: groundOnly, wires: [] })))
      .toContain("no-source");
  });

  it("puts every error above every warning, so the row that explains the rest is on top", () => {
    const rows = liveSchematicDiagnostics({
      components: [resistor(), resistor({ id: "r2", label: "R1", x: 128, y: 320 })],
      wires: [],
      netLabels: [{ id: "n1", x: 512, y: 512, text: "endn" }],
    });
    const severities = rows.map((row) => row.severity);
    expect(severities.indexOf("warning")).toBeGreaterThan(severities.lastIndexOf("error"));
    expect(codesOf(rows)).toEqual([
      "no-ground", "no-source", "duplicate-reference",
      "floating-pin", "floating-pin", "floating-pin", "floating-pin",
      "label-names-nothing",
    ]);
    // Every row carries a distinct React key.
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  it("shares one duplicate-designator scan with the deserializer, which still refuses", () => {
    // Two spellings of this rule would disagree the moment one grew a case, so
    // the fail-closed loader and the live list read the same helper.
    const components = [resistor(), resistor({ id: "r2", label: "r1" })];
    expect(duplicateReferenceDesignators(components)).toEqual([
      { display: "R1", count: 2, componentIds: ["r1", "r2"] },
    ]);
    expect(duplicateReferenceDesignators([resistor()])).toEqual([]);
    // Unnamed parts get their designator at emission; they are not duplicates.
    expect(duplicateReferenceDesignators([resistor({ label: "" }), resistor({ id: "r2", label: " " })])).toEqual([]);

    const duplicateRef = validDocument();
    duplicateRef.components.push({ ...duplicateRef.components[0], id: "r2", label: "r1" });
    expect(() => validateSchematicDocument(duplicateRef)).toThrow(/is used 2 times/);
  });
});
