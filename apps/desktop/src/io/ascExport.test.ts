import { describe, it, expect } from "vitest";
import { extractCircuit } from "../schematic/netlist";
import { parseAsc, ascToSchematic, importAsc } from "./ascImport";
import {
  serializeAscDocument,
  schematicToAsc,
  kindToLtspiceType,
  rotationToOrientation,
  canEmitLtSymbolVerbatim,
  isLossyCarrierWarning,
  TAU_CARRIER_KINDS,
} from "./ascExport";
import type { AscDocument } from "./ascImport";
import type { NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";
import { ascRewriteRisks, ascSaveBlockReason, schematicTopologySignature } from "../project/types";
import { CATALOG } from "../schematic/catalog";
import { withOpampModel } from "../engine/opampModel";

// The same representative LTspice grammar the importer tests use, minus the
// drawing primitive (which the serializer canonicalizes away).
const SAMPLE = `Version 4
SHEET 1 880 680
WIRE 144 96 80 96
WIRE 304 96 224 96
WIRE 304 144 304 96
WIRE 80 192 80 96
WIRE 304 240 304 224
FLAG 80 192 0
FLAG 304 240 0
FLAG 304 96 vout
SYMBOL res 240 80 R90
SYMATTR InstName R1
SYMATTR Value 1k
SYMBOL cap 288 144 R0
SYMATTR InstName C1
SYMATTR Value 1u
SYMBOL voltage 80 80 R0
SYMATTR InstName V1
SYMATTR Value PULSE(0 5 0 1n 1n 1m 2m)
TEXT 72 280 Left 2 !.tran 5m
TEXT 72 320 Left 2 ;RC low-pass demo`;


/** Every export warning must be a lossy-carrier notice (a part with no faithful
 *  LTspice symbol, saved as a placeholder resistor). Anything else is a real
 *  export defect, so this asserts the *kind* of warning rather than silence. */
function expectOnlyCarrierWarnings(warnings: string[]) {
  for (const warning of warnings) {
    expect(warning, warning).toMatch(/saved as a placeholder resistor/);
  }
}

describe("serializeAscDocument", () => {
  it("round-trips an AscDocument through parseAsc", () => {
    const doc = parseAsc(SAMPLE);
    const text = serializeAscDocument(doc);
    const reparsed = parseAsc(text);
    // `unknown` and `shapes` aside, every structured field must survive intact.
    expect(reparsed.version).toEqual(doc.version);
    expect(reparsed.sheet).toEqual(doc.sheet);
    expect(reparsed.wires).toEqual(doc.wires);
    expect(reparsed.flags).toEqual(doc.flags);
    expect(reparsed.symbols).toEqual(doc.symbols);
    expect(reparsed.texts).toEqual(doc.texts);
  });

  it("emits a trailing newline and a Version header", () => {
    const doc = parseAsc(SAMPLE);
    const text = serializeAscDocument(doc);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.startsWith("Version 4\n")).toBe(true);
  });

  it("drops unknown lines (they have no structured form)", () => {
    const doc: AscDocument = {
      version: 4,
      sheet: { index: 1, width: 0, height: 0 },
      wires: [],
      flags: [],
      symbols: [],
      texts: [],
      dataFlags: [],
      shapes: [],
      unknown: ["GIBBERISH 1 2 3"],
    };
    expect(serializeAscDocument(doc)).not.toContain("GIBBERISH");
  });
});

// One of each drawing primitive, a dash-style index on the LINE, and an ARC
// with exactly 8 coordinates (no dash index) - the full grammar from the brief.
const SHAPES_SOURCE = `Version 4
SHEET 1 880 680
LINE Normal 100 300 200 300 2
RECTANGLE Normal 80 96 -112 -96
CIRCLE Wide 0 0 50 50
ARC Normal 0 0 100 100 0 100 100 0`;

describe("drawing primitives (LINE/RECTANGLE/CIRCLE/ARC) round-trip", () => {
  it("re-emits every shape line byte-identically through parseAsc -> serializeAscDocument", () => {
    const doc = parseAsc(SHAPES_SOURCE);
    expect(doc.shapes).toEqual([
      { kind: "LINE", width: "Normal", coords: [100, 300, 200, 300, 2] },
      { kind: "RECTANGLE", width: "Normal", coords: [80, 96, -112, -96] },
      { kind: "CIRCLE", width: "Wide", coords: [0, 0, 50, 50] },
      { kind: "ARC", width: "Normal", coords: [0, 0, 100, 100, 0, 100, 100, 0] },
    ]);
    const serialized = serializeAscDocument(doc);
    const sourceShapeLines = SHAPES_SOURCE.split("\n").filter((line) => /^(LINE|RECTANGLE|CIRCLE|ARC)\b/.test(line));
    expect(sourceShapeLines).toHaveLength(4);
    for (const line of sourceShapeLines) {
      expect(serialized, line).toContain(line);
    }
  });

  it("schematicToAsc emits shapes carried on the export input", () => {
    const { shapes } = parseAsc(SHAPES_SOURCE);
    const result = schematicToAsc({ components: [], wires: [], netLabels: [], shapes });
    const sourceShapeLines = SHAPES_SOURCE.split("\n").filter((line) => /^(LINE|RECTANGLE|CIRCLE|ARC)\b/.test(line));
    for (const line of sourceShapeLines) {
      expect(result.text, line).toContain(line);
    }
  });
});

// A vendor symbol with no Tau equivalent - two WINDOW label placements plus
// several SYMATTR lines, the full grammar a real library part carries.
const FOREIGN_SYMBOL_SOURCE = `Version 4
SHEET 1 880 680
SYMBOL PowerProducts\\LTC4449 100 200 R0
WINDOW 0 24 16 Left 2
WINDOW 3 24 44 Left 2
SYMATTR InstName U1
SYMATTR Value LTC4449
SYMATTR SpiceModel LTC4449BOOST`;

describe("foreign symbols (no Tau equivalent) round-trip", () => {
  it("schematicToAsc re-emits the SYMBOL, WINDOW, and every SYMATTR line", () => {
    const { foreignSymbols } = importAsc(FOREIGN_SYMBOL_SOURCE);
    expect(foreignSymbols).toHaveLength(1);
    const { text } = schematicToAsc({ components: [], wires: [], netLabels: [], foreignSymbols });
    const sourceLines = FOREIGN_SYMBOL_SOURCE.split("\n").filter((line) => /^(SYMBOL|WINDOW|SYMATTR)\b/.test(line));
    for (const line of sourceLines) {
      expect(text, line).toContain(line);
    }
  });

  it("survives a full import -> export -> re-import round trip", () => {
    const before = importAsc(FOREIGN_SYMBOL_SOURCE);
    expect(before.foreignSymbols).toHaveLength(1);
    const { text } = schematicToAsc({
      components: before.components,
      wires: before.wires,
      netLabels: before.netLabels,
      foreignSymbols: before.foreignSymbols,
    });
    const after = importAsc(text);
    expect(after.foreignSymbols).toEqual(before.foreignSymbols);
  });
});

describe("kindToLtspiceType", () => {
  it("inverts the common built-ins back to banked-pin symbol types", () => {
    expect(kindToLtspiceType("resistor")).toBe("res");
    expect(kindToLtspiceType("capacitor")).toBe("cap");
    expect(kindToLtspiceType("inductor")).toBe("ind");
    expect(kindToLtspiceType("vsource")).toBe("voltage");
    expect(kindToLtspiceType("isource")).toBe("current");
    expect(kindToLtspiceType("vac")).toBe("voltage");
    expect(kindToLtspiceType("iac")).toBe("current");
    expect(kindToLtspiceType("vpulse")).toBe("voltage");
    expect(kindToLtspiceType("npn")).toBe("npn");
    expect(kindToLtspiceType("nmos")).toBe("nmos4");
    expect(kindToLtspiceType("pmos")).toBe("pmos4");
    expect(kindToLtspiceType("bsource")).toBe("bv");
    expect(kindToLtspiceType("vcvs")).toBe("e");
    expect(kindToLtspiceType("opamp")).toBe("opamp2");
    expect(kindToLtspiceType("dflop")).toBe("Digital\\\\dflop");
  });

  it("returns null for kinds with no LTspice symbol of their own", () => {
    expect(kindToLtspiceType("ground")).toBeNull();
    expect(kindToLtspiceType("testpoint")).toBeNull();
    // The exact Digital symbol is selected from the function in Value, so a
    // kind-only query cannot choose one without the complete component.
    expect(kindToLtspiceType("digitalGate")).toBeNull();
  });

  it("rejects electrically incompatible single-symbol mappings", () => {
    // LTspice f/h have only two output pins and name an external voltage source
    // as their controller, whereas Tau's CCCS/CCVS own a four-pin sense branch.
    for (const kind of ["cccs", "ccvs", "switch"] as const) {
      expect(kindToLtspiceType(kind), kind).toBeNull();
    }
    expect(kindToLtspiceType("potentiometer")).toBe("pot");
    expect(kindToLtspiceType("transformer")).toBe("ind2t");
  });
});

describe("rotationToOrientation", () => {
  it("maps rotation + mirror to an orientation token", () => {
    expect(rotationToOrientation(0, false)).toBe("R0");
    expect(rotationToOrientation(90, false)).toBe("R90");
    expect(rotationToOrientation(270, undefined)).toBe("R270");
    expect(rotationToOrientation(0, true)).toBe("M0");
    expect(rotationToOrientation(180, true)).toBe("M180");
    expect(rotationToOrientation(90, true)).toBe("M270");
    expect(rotationToOrientation(270, true)).toBe("M90");
  });
});

describe("schematicToAsc", () => {
  it("round-trips an edited source's separate DC bias and PWL waveform", () => {
    const original = importAsc(SAMPLE);
    const source = original.components.find((component) => component.label === "V1");
    expect(source).toBeTruthy();
    source!.value = "DC 3.3 PWL(0 0 2u 5) AC 2";

    const result = schematicToAsc({
      components: original.components,
      wires: original.wires,
      netLabels: original.netLabels,
      directives: original.directives,
      comments: original.comments,
      textAnnotations: original.textAnnotations,
      shapes: original.shapes,
      dataFlags: original.dataFlags,
      foreignSymbols: original.foreignSymbols,
      hierarchicalBlocks: original.hierarchicalBlocks,
      sheet: original.sheet,
    });

    expect(result.warnings).toEqual([]);
    expect(result.text).toContain("SYMATTR Value DC 3.3 PWL(0 0 2u 5) AC 2");
    expect(importAsc(result.text).components.find((component) => component.label === "V1")?.value)
      .toBe("DC 3.3 PWL(0 0 2u 5) AC 2");
  });

  it("round-trips Tau schematic content through the importer", () => {
    const original = importAsc(SAMPLE);
    const { text, warnings } = schematicToAsc({
      components: original.components,
      wires: original.wires,
      netLabels: original.netLabels,
      directives: original.directives,
      comments: original.comments,
    });
    expect(warnings).toEqual([]);

    const round = importAsc(text);

    // Same number of parts, wires, and nets.
    expect(round.components).toHaveLength(original.components.length);
    expect(round.wires).toHaveLength(original.wires.length);
    expect(round.netLabels).toHaveLength(original.netLabels.length);
    expect(round.directives).toEqual(original.directives);
    expect(round.comments).toEqual(original.comments);

    // Each component's electrical identity (kind, anchor, orientation, value,
    // label) and its recomputed pin geometry must match the original.
    const key = (c: (typeof original.components)[number]) =>
      `${c.kind}@${c.x},${c.y} ${c.rotation}${c.mirrored ? "M" : ""} ${c.label}=${c.value}`;
    expect(round.components.map(key).sort()).toEqual(original.components.map(key).sort());

    const r1 = round.components.find((c) => c.label === "R1");
    const o1 = original.components.find((c) => c.label === "R1");
    expect(r1?.pinOverride).toEqual(o1?.pinOverride);
  });

  it("writes nudged label placement back out and stops blocking the save", () => {
    // LTspice emits a WINDOW whenever the user drags a label off its default
    // spot, so this is what an ordinary edited schematic looks like.
    const source = SAMPLE
      .replace("SYMATTR InstName R1", "WINDOW 0 0 56 VBottom 2\nWINDOW 3 32 56 VTop 2\nSYMATTR InstName R1")
      .replace("SYMATTR InstName C1", "WINDOW 3 32 32 VTop 2\nSYMATTR InstName C1");
    const original = importAsc(source);
    const placement = [
      { attr: 0, x: 0, y: 56, justification: "VBottom", size: 2 },
      { attr: 3, x: 32, y: 56, justification: "VTop", size: 2 },
    ];
    expect(original.components.find((c) => c.label === "R1")?.ltWindows).toEqual(placement);

    const { text, warnings } = schematicToAsc(original);
    expect(warnings).toEqual([]);
    expect(ascSaveBlockReason(ascRewriteRisks(source), 0, warnings)).toBeNull();

    // The records must come back on the right symbol, in LTspice's own order:
    // SYMBOL, then its WINDOW placements, then its SYMATTR values.
    const lines = text.split("\n");
    const at = lines.findIndex((line) => line.startsWith("SYMBOL res "));
    expect(lines.slice(at + 1, at + 4)).toEqual([
      "WINDOW 0 0 56 VBottom 2",
      "WINDOW 3 32 56 VTop 2",
      "SYMATTR InstName R1",
    ]);
    // The capacitor keeps its own single record rather than the resistor's pair.
    expect(parseAsc(text).symbols.find((s) => s.attrs.InstName === "C1")?.windows)
      .toEqual([{ attr: 3, x: 32, y: 32, justification: "VTop", size: 2 }]);
    // A symbol that declared none must not acquire any.
    expect(parseAsc(text).symbols.find((s) => s.attrs.InstName === "V1")?.windows).toBeUndefined();

    const round = importAsc(text);
    expect(round.components.find((c) => c.label === "R1")?.ltWindows).toEqual(placement);
  });

  it("says so instead of scattering placement when the part changes symbol", () => {
    // A switch has no faithful LTspice symbol and is saved as a carrier
    // resistor, whose attribute slots sit somewhere else entirely. Dropping the
    // records silently would move the user's labels; the warning keeps the save
    // blocked until the symbol itself round-trips.
    const { text, warnings } = schematicToAsc({
      components: [{
        id: "s1", kind: "switch", x: 0, y: 0, rotation: 0, value: "closed", label: "S1",
        ltSymbolType: "sw",
        ltWindows: [{ attr: 0, x: 0, y: 56, justification: "VBottom", size: 2 }],
      }],
      wires: [],
      netLabels: [],
    });
    expect(text).not.toContain("WINDOW");
    const placementWarnings = warnings.filter((warning) => warning.includes("label placement"));
    expect(placementWarnings).toHaveLength(1);
    expect(ascSaveBlockReason([], 0, warnings)).toBe(placementWarnings[0]);
  });

  it("emits ground parts and net labels as FLAGs", () => {
    const original = importAsc(SAMPLE);
    const { text } = schematicToAsc(original);
    const doc = parseAsc(text);
    const grounds = doc.flags.filter((f) => f.net === "0");
    const named = doc.flags.filter((f) => f.net === "vout");
    expect(grounds).toHaveLength(2);
    expect(named).toHaveLength(1);
  });

  it("splits a multi-segment Tau wire into LTspice WIRE segments without blocking save", () => {
    const { text, warnings } = schematicToAsc({
      components: [],
      wires: [{ id: "w1", points: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 16 }] }],
      netLabels: [],
    });
    const doc = parseAsc(text);
    expect(doc.wires).toEqual([
      { x1: 0, y1: 0, x2: 16, y2: 0 },
      { x1: 16, y1: 0, x2: 16, y2: 16 },
    ]);
    expect(warnings).toEqual([]);
  });

  it("persists Tau-only test points through a harmless carrier symbol", () => {
    const { text, warnings } = schematicToAsc({
      components: [
        { id: "tp1", kind: "testpoint", x: 0, y: 0, rotation: 0, value: "", label: "TP1" },
      ],
      wires: [],
      netLabels: [],
    });
    expectOnlyCarrierWarnings(warnings);
    expect(warnings).toHaveLength(1);
    const round = importAsc(text);
    expect(round.warnings).toEqual([]);
    expect(round.components[0]).toMatchObject({ kind: "testpoint", value: "", label: "TP1" });
  });

  it("persists composite Tau components without blocking save", () => {
    const components = ([
      ["cccs", "F1"],
      ["ccvs", "H1"],
      ["potentiometer", "RV1"],
      ["transformer", "T1"],
      ["switch", "S1"],
    ] as const).map(([kind, label], index) => ({
      id: `c${index}`,
      kind,
      x: index * 64,
      y: 0,
      rotation: 0 as const,
      value: "1",
      label,
    }));
    const { text, warnings } = schematicToAsc({ components, wires: [], netLabels: [] });

    expect(parseAsc(text).symbols).toHaveLength(5);
    // cccs, ccvs and switch have no faithful LTspice symbol; potentiometer and
    // transformer do, so only three of the five report.
    expectOnlyCarrierWarnings(warnings);
    expect(warnings).toHaveLength(3);
    const round = importAsc(text);
    expect(round.warnings).toEqual([]);
    expect(round.components.map((component) => component.kind)).toEqual(components.map((component) => component.kind));
  });

  it("guarantees every Library component can save and reopen with its drawing identity", () => {
    for (const [index, entry] of CATALOG.entries()) {
      const label = entry.kind === "ground" ? "" : `${entry.prefix}${index + 1}`;
      const component = {
        id: `catalog-${entry.kind}`,
        kind: entry.kind,
        x: 128,
        y: 128,
        rotation: 0 as const,
        value: entry.defaultValue,
        label,
      };
      const exported = schematicToAsc({ components: [component], wires: [], netLabels: [] });
      // A Library part with no faithful LTspice symbol reports a carrier
      // notice; the Tau round-trip below is what this test actually guards.
      expectOnlyCarrierWarnings(exported.warnings);
      const round = importAsc(exported.text);
      expect(round.warnings, entry.kind).toEqual([]);
      expect(round.components, entry.kind).toHaveLength(1);
      expect(round.components[0], entry.kind).toMatchObject({
        kind: entry.kind,
        value: entry.defaultValue,
        label,
      });
    }
  });

  it("warns instead of silently converting an unsupported digital function to AND", () => {
    const { text, warnings } = schematicToAsc({
      components: [{
        id: "gate-1",
        kind: "digitalGate",
        x: 0,
        y: 0,
        rotation: 0,
        value: "nand Vhigh=5",
        label: "A1",
      }],
      wires: [],
      netLabels: [],
    });

    expect(parseAsc(text).symbols).toEqual([]);
    expect(warnings).toEqual([expect.stringContaining("A1")]);
  });

  it("round-trips every digital gate leaf with exact pin roles and no duplicated function attribute", () => {
    const cases = [
      { leaf: "and", pins: ["in1", "in2", "in3", "in4", "in5", "qbar", "q", "com"] },
      { leaf: "or", pins: ["in1", "in2", "in3", "in4", "in5", "qbar", "q", "com"] },
      { leaf: "xor", pins: ["in1", "in2", "in3", "in4", "in5", "qbar", "q", "com"] },
      { leaf: "buf", pins: ["in1", "qbar", "q", "com"] },
      { leaf: "buf1", pins: ["in1", "q", "com"] },
      { leaf: "inv", pins: ["in1", "qbar", "com"] },
      { leaf: "schmitt", pins: ["in1", "qbar", "q", "com"] },
      { leaf: "schmtbuf", pins: ["in1", "q", "com"] },
      { leaf: "schmtinv", pins: ["in1", "qbar", "com"] },
    ] as const;
    const params = "Vhigh=5 Vlow=0 Vt=2.5 Vhys=0.2 Td=10n";

    for (const gate of cases) {
      const seed = importAsc(`Version 4\nSHEET 1 880 680\nSYMBOL Digital\\${gate.leaf} 320 256 R0\nSYMATTR InstName A1\nSYMATTR Value ${params}\n`);
      expect(seed.warnings, gate.leaf).toEqual([]);
      const component = seed.components[0];
      expect(component.kind).toBe("digitalGate");
      expect(component.pinOverride?.map((pin) => pin.id), gate.leaf).toEqual(gate.pins);

      const names = new Map<string, string>();
      const netLabels = (component.pinOverride ?? []).map((pin, index) => {
        const name = `gate_${index + 1}`;
        names.set(pin.id, name);
        return { id: `label-${index}`, x: pin.x, y: pin.y, text: name };
      });
      const exported = schematicToAsc({ components: [component], wires: [], netLabels });
      expect(exported.warnings, gate.leaf).toEqual([]);
      const symbol = parseAsc(exported.text).symbols[0];
      expect(symbol.type, gate.leaf).toBe(`Digital\\\\${gate.leaf}`);
      expect(symbol.attrs.Value, gate.leaf).toBe(params);

      const round = importAsc(exported.text);
      expect(round.warnings, gate.leaf).toEqual([]);
      const roundComponent = round.components[0];
      expect(roundComponent.value, gate.leaf).toBe(`${gate.leaf} ${params}`);
      expect(roundComponent.pinOverride?.map((pin) => pin.id), gate.leaf).toEqual(gate.pins);
      const extracted = extractCircuit(round.components, round.wires, round.netLabels);
      const pins = extracted.components.find((entry) => entry.component.label === "A1")?.pins;
      for (const pin of gate.pins) expect(pins?.[pin], `${gate.leaf}.${pin}`).toBe(names.get(pin));
    }
  });

  it("round-trips a dflop with exact role connectivity through Digital\\dflop", () => {
    const params = "Vhigh=5 Vlow=0 Vt=2.5 Td=10n";
    const seed = importAsc(`Version 4\nSHEET 1 880 680\nSYMBOL Digital\\dflop 320 256 R0\nSYMATTR InstName A1\nSYMATTR Value ${params}\n`);
    expect(seed.warnings).toEqual([]);
    const component = seed.components[0];
    const expectedPins = ["d", "clk", "pre", "clr", "qbar", "q", "com"];
    expect(component.kind).toBe("dflop");
    expect(component.pinOverride?.map((pin) => pin.id)).toEqual(expectedPins);

    const names = new Map<string, string>();
    const netLabels = (component.pinOverride ?? []).map((pin, index) => {
      const name = `dff_${index + 1}`;
      names.set(pin.id, name);
      return { id: `label-${index}`, x: pin.x, y: pin.y, text: name };
    });
    const exported = schematicToAsc({ components: [component], wires: [], netLabels });
    expect(exported.warnings).toEqual([]);
    const symbol = parseAsc(exported.text).symbols[0];
    expect(symbol.type).toBe("Digital\\\\dflop");
    expect(symbol.attrs.Value).toBe(params);

    const round = importAsc(exported.text);
    expect(round.warnings).toEqual([]);
    expect(round.components[0].kind).toBe("dflop");
    expect(round.components[0].value).toBe(params);
    expect(round.components[0].pinOverride?.map((pin) => pin.id)).toEqual(expectedPins);
    const extracted = extractCircuit(round.components, round.wires, round.netLabels);
    const pins = extracted.components.find((entry) => entry.component.label === "A1")?.pins;
    for (const pin of expectedPins) expect(pins?.[pin], `dflop.${pin}`).toBe(names.get(pin));
  });

  it("preserves distinct drain, gate, source, and bulk nets for four-pin MOSFETs", () => {
    for (const [kind, type, label] of [
      ["nmos", "nmos4", "M1"],
      ["pmos", "pmos4", "M2"],
    ] as const) {
      const seed = importAsc(`Version 4\nSHEET 1 880 680\nSYMBOL ${type} 320 256 R0\nSYMATTR InstName ${label}\nSYMATTR Value ${kind.toUpperCase()}\n`);
      expect(seed.warnings, kind).toEqual([]);
      const component = seed.components[0];
      const expectedPins = ["d", "g", "s", "b"];
      expect(component.pinOverride?.map((pin) => pin.id), kind).toEqual(expectedPins);
      const netLabels = (component.pinOverride ?? []).map((pin, index) => ({
        id: `${kind}-label-${index}`,
        x: pin.x,
        y: pin.y,
        text: `${kind}_${pin.id}`,
      }));

      const exported = schematicToAsc({ components: [component], wires: [], netLabels });
      expect(exported.warnings, kind).toEqual([]);
      expect(parseAsc(exported.text).symbols[0].type, kind).toBe(type);
      const round = importAsc(exported.text);
      expect(round.warnings, kind).toEqual([]);
      const extracted = extractCircuit(round.components, round.wires, round.netLabels);
      const pins = extracted.components.find((entry) => entry.component.label === label)?.pins;
      for (const pin of expectedPins) expect(pins?.[pin], `${kind}.${pin}`).toBe(`${kind}_${pin}`);
    }
  });

  it("preserves the netlist a round-tripped schematic extracts", () => {
    const original = importAsc(SAMPLE);
    const { text } = schematicToAsc(original);
    const round = ascToSchematic(parseAsc(text));
    // Net count is the structural fingerprint that matters for simulation.
    expect(round.components.map((c) => c.kind).sort()).toEqual(
      original.components.map((c) => c.kind).sort(),
    );
  });
});

// Imported-symbol identity: parts imported from a banked LTspice symbol carry
// `ltSymbolType` and re-export the ORIGINAL symbol name, so files with 3-pin
// MOSFETs and vendor/Universal op-amps round-trip with their connectivity and
// library identity intact (previously the canonical rewrite to nmos4/opamp2
// moved pins and forced the lossy-save block).
describe("imported LTspice symbol identity", () => {
  const topology = (content: { components: SchematicComponent[]; wires: SchematicWire[]; netLabels: NetLabel[] }) =>
    schematicTopologySignature({
      components: content.components,
      wires: content.wires,
      netLabels: content.netLabels,
      probes: [],
      directives: [],
    });

  const NMOS3 = `Version 4
SHEET 1 880 680
WIRE 176 96 112 96
WIRE 208 32 208 -16
WIRE 208 176 208 128
FLAG 112 96 g
FLAG 208 -16 d
FLAG 208 176 0
SYMBOL nmos 160 16 R0
SYMATTR InstName M1
SYMATTR Value 2N7002`;

  const VENDOR_OPAMP = `Version 4
SHEET 1 880 680
WIRE 112 128 48 128
WIRE 112 160 48 160
WIRE 240 144 176 144
FLAG 48 128 inn
FLAG 48 160 inp
FLAG 240 144 out
SYMBOL Opamps\\\\AD823 144 80 R0
SYMATTR InstName U1
SYMATTR Value AD823`;

  it("round-trips a 3-pin nmos with the bulk still tied to the source", () => {
    const imported = importAsc(NMOS3);
    expect(imported.warnings).toEqual([]);
    expect(imported.components.find((c) => c.kind === "nmos")?.ltSymbolType).toBe("nmos");
    expect(ascRewriteRisks(NMOS3)).toEqual([]);

    const exported = schematicToAsc(imported);
    expect(exported.warnings).toEqual([]);
    expect(parseAsc(exported.text).symbols[0].type).toBe("nmos");
    expect(topology(importAsc(exported.text))).toEqual(topology(imported));
  });

  it("round-trips a vendor op-amp without collapsing it to opamp2", () => {
    const imported = importAsc(VENDOR_OPAMP);
    expect(imported.warnings).toEqual([]);
    expect(ascRewriteRisks(VENDOR_OPAMP)).toEqual([]);

    const exported = schematicToAsc(imported);
    expect(parseAsc(exported.text).symbols[0].type).toBe("Opamps\\\\AD823");
    expect(topology(importAsc(exported.text))).toEqual(topology(imported));
  });

  it("round-trips a UniversalOpAmp2 through its centered pin geometry", () => {
    const src = VENDOR_OPAMP.replace(/Opamps\\\\AD823/, "OpAmps\\\\UniversalOpAmp2").replace("SYMATTR Value AD823", "SYMATTR Value level.2");
    const imported = importAsc(src);
    expect(imported.warnings).toEqual([]);
    expect(ascRewriteRisks(src)).toEqual([]);
    const exported = schematicToAsc(imported);
    expect(parseAsc(exported.text).symbols[0].type).toBe("OpAmps\\\\UniversalOpAmp2");
    expect(topology(importAsc(exported.text))).toEqual(topology(imported));
  });

  it("keeps the save block for symbols whose bank drops real pins or rewrites the value", () => {
    // npn4 has a substrate pin the 3-pin npn bank cannot represent; diac's
    // imported value is transformed into a subcircuit invocation.
    for (const type of ["npn4", "diac"]) {
      const src = NMOS3.replace("SYMBOL nmos", `SYMBOL ${type}`);
      expect(ascRewriteRisks(src), type).toContain("symbol-library identity");
    }
    expect(canEmitLtSymbolVerbatim("npn4", "npn")).toBe(false);
    expect(canEmitLtSymbolVerbatim("csw", "switch")).toBe(true);
    expect(canEmitLtSymbolVerbatim("diac", "resistor")).toBe(false);
    // Digital gates encode their function in the symbol leaf, which the
    // importer prepends to the value; verbatim re-emission would double it.
    expect(canEmitLtSymbolVerbatim("Digital\\\\and", "digitalGate")).toBe(false);
  });

  // sw.asy's four pins (A, B, NC+, NC-) are banked whole and line up with the
  // switch kind's a/b/cp/cn, so a switch goes back out as a switch. Before this
  // it was written as a placeholder resistor, which cost the user their part -
  // correctly making `ascRewriteRisks` refuse the save on any file holding one.
  const SWITCH = `Version 4
SHEET 1 880 680
WIRE 100 64 100 116
WIRE 100 196 100 240
WIRE 52 180 0 180
WIRE 52 132 0 132
FLAG 100 240 0
FLAG 0 180 0
FLAG 100 64 out
FLAG 0 132 ctl
SYMBOL sw 100 100 R0
WINDOW 0 12 104 Left 2
WINDOW 3 17 11 Left 2
SYMATTR InstName S1
SYMATTR Value MYSW`;

  it("round-trips a voltage-controlled switch as a sw, control pins and all", () => {
    const imported = importAsc(SWITCH);
    expect(imported.warnings).toEqual([]);
    expect(ascRewriteRisks(SWITCH)).toEqual([]);
    const [source] = imported.components.filter((c) => c.kind === "switch");
    // The fixture has to actually wire all four pins, or the topology check
    // below would compare two empty partitions and prove nothing.
    expect(source.pinOverride?.map((p) => p.id)).toEqual(["a", "b", "cp", "cn"]);

    const exported = schematicToAsc(imported);
    expect(exported.warnings).toEqual([]);
    const symbol = parseAsc(exported.text).symbols[0];
    expect(symbol.type).toBe("sw");
    expect(symbol.orientation).toBe("R0");
    expect(symbol.attrs.InstName).toBe("S1");
    expect(symbol.attrs.Value).toBe("MYSW");
    // No carrier metadata: the part is written as itself, not as a stand-in.
    expect(symbol.attrs.TauKind).toBeUndefined();
    // WINDOW placement rides along, since the part keeps its source symbol.
    expect(exported.text).toContain("WINDOW 0 12 104 Left 2");

    const reopened = importAsc(exported.text);
    expect(topology(reopened)).toEqual(topology(imported));
    const [again] = reopened.components.filter((c) => c.kind === "switch");
    expect(again.value).toBe("MYSW");
    expect(again.ltSymbolType).toBe("sw");
    expect(again.pinOverride).toEqual(source.pinOverride);
  });

  it("round-trips a current-controlled switch as csw with its named source and model", () => {
    const source = `Version 4
SHEET 1 880 680
SYMBOL csw 100 100 R0
SYMATTR InstName W1
SYMATTR SpiceModel Vsense
SYMATTR Value MYSW
SYMATTR SpiceLine on`;
    const imported = importAsc(source);
    expect(imported.warnings).toEqual([]);
    expect(ascRewriteRisks(source)).toEqual([]);
    const exported = schematicToAsc(imported);
    expect(exported.warnings).toEqual([]);
    expect(exported.text).toContain("SYMBOL csw 100 100 R0");
    expect(exported.text).toContain("SYMATTR InstName W1");
    expect(exported.text).toContain("SYMATTR SpiceModel Vsense");
    expect(exported.text).toContain("SYMATTR Value MYSW");
    expect(exported.text).toContain("SYMATTR SpiceLine on");
    expect(importAsc(exported.text).components[0]).toMatchObject({
      kind: "switch", label: "W1", value: "Vsense MYSW on", ltSymbolType: "csw",
    });
  });

  it("re-emits a switch that carried no Value without inventing one", () => {
    // LTspice writes several of these (LTC4226-1.asc); a `Value` added on the
    // way out would be an attribute the source never had.
    const src = SWITCH.replace("\nSYMATTR Value MYSW", "");
    expect(ascRewriteRisks(src)).toEqual([]);
    const symbol = parseAsc(schematicToAsc(importAsc(src)).text).symbols[0];
    expect(symbol.type).toBe("sw");
    expect(symbol.attrs.Value).toBeUndefined();
  });

  it("writes a switch left on a static open/closed state under the carrier", () => {
    // `sw` is only a switch because its Value names a .model, so a part moved
    // to Tau's static state is no longer that symbol and must not be written as
    // one - LTspice would read `SYMATTR Value closed` as a missing model.
    const imported = importAsc(SWITCH);
    const components = imported.components.map((c) =>
      c.kind === "switch" ? { ...c, value: "closed" } : c);
    const exported = schematicToAsc({ ...imported, components });
    const symbol = parseAsc(exported.text).symbols[0];
    expect(symbol.type).toBe("res");
    expect(symbol.attrs.TauKind).toBe("switch");
    expect(symbol.attrs.TauValue).toBe("closed");
    expect(exported.warnings.filter(isLossyCarrierWarning)).toHaveLength(1);
    // And Tau reads its own carrier back as the switch it stands in for.
    const [again] = importAsc(exported.text).components.filter((c) => c.kind === "switch");
    expect(again.value).toBe("closed");
  });

  it("reports the carrier without blocking the save", () => {
    // Moving to a static state changes the symbol, which is what the label
    // placement of the source symbol cannot survive - so a part carrying WINDOW
    // records is refused on that, as any part re-emitted under another symbol
    // is. Without them the only thing left to say is that LTspice sees a
    // resistor, and that notice must never stop a switch being saved.
    const src = SWITCH.split("\n").filter((l) => !l.startsWith("WINDOW ")).join("\n");
    const imported = importAsc(src);
    const components = imported.components.map((c) =>
      c.kind === "switch" ? { ...c, value: "closed" } : c);
    const { warnings } = schematicToAsc({ ...imported, components });
    expect(warnings.every(isLossyCarrierWarning)).toBe(true);
    expect(ascSaveBlockReason(ascRewriteRisks(src), 0, warnings)).toBeNull();
  });

  it("still exports a Tau-native nmos as the explicit-bulk nmos4", () => {
    const native: SchematicComponent = {
      id: "m1", kind: "nmos", x: 0, y: 0, rotation: 0, value: "2N7002", label: "M1",
    };
    const { text } = schematicToAsc({ components: [native], wires: [], netLabels: [] });
    expect(parseAsc(text).symbols[0].type).toBe("nmos4");
  });
});

// Orientation is the other half of imported-geometry fidelity: a mirrored,
// rotated 3-pin nmos must reproduce the same SYMBOL line and pin topology.
describe("imported symbol identity under mirror/rotation", () => {
  it("round-trips a mirrored 3-pin nmos", () => {
    const src = `Version 4
SHEET 1 880 680
SYMBOL nmos 160 16 M90
SYMATTR InstName M1
SYMATTR Value 2N7002`;
    const imported = importAsc(src);
    expect(imported.warnings).toEqual([]);
    const exported = schematicToAsc(imported);
    const symbol = parseAsc(exported.text).symbols[0];
    expect(symbol.type).toBe("nmos");
    expect(symbol.orientation).toBe("M90");
    const reopened = importAsc(exported.text);
    const pins = (c: typeof imported) =>
      (c.components[0].pinOverride ?? []).map((p) => `${p.id}@${p.x},${p.y}`).sort();
    expect(pins(reopened)).toEqual(pins(imported));
  });
});

describe("lossy carrier export warnings", () => {
  const part = (kind: SchematicComponent["kind"], label: string, value: string): SchematicComponent =>
    ({ id: label, kind, label, value, x: 128, y: 128, rotation: 0 });

  it("warns for every part saved as a placeholder resistor", () => {
    // Tau round-trips these through their Tau* attributes, so the loss is
    // invisible until a colleague opens the file in LTspice and finds a bare
    // resistor. Before this the export reported warnings: [].
    const { warnings } = schematicToAsc({
      components: [
        part("switch", "S1", "SW"),
        part("subckt", "X1", "LT1001"),
        part("ccvs", "H1", "1"),
      ],
      wires: [],
      netLabels: [],
      directives: [],
      comments: [],
    });

    expect(warnings).toHaveLength(3);
    for (const ref of ["S1", "X1", "H1"]) {
      expect(warnings.some((w) => w.startsWith(`${ref}:`)), `no warning for ${ref}`).toBe(true);
    }
    expect(warnings.find((w) => w.startsWith("S1:"))).toContain("open circuit");
  });

  it("stays silent for parts with a faithful LTspice symbol", () => {
    const { warnings } = schematicToAsc({
      components: [part("resistor", "R1", "1k"), part("capacitor", "C1", "1u")],
      wires: [],
      netLabels: [],
      directives: [],
      comments: [],
    });
    expect(warnings).toEqual([]);
  });
});

// A hierarchy sheet's ports: one of each direction, plus an ordinary net label
// and a ground flag that must stay untouched.
const IOPIN_SOURCE = `Version 4
SHEET 1 880 680
FLAG -64 480 0
FLAG 624 80 gp
IOPIN 624 80 Out
FLAG -432 208 pwm
IOPIN -432 208 In
FLAG 80 64 vrcp
FLAG 96 -32 bus
IOPIN 96 -32 BiDir`;

describe("IOPIN (hierarchy port) round-trip", () => {
  it("pairs each port with its FLAG and re-emits it byte-identically", () => {
    const doc = parseAsc(IOPIN_SOURCE);
    expect(doc.unknown).toEqual([]);
    expect(doc.flags).toEqual([
      { x: -64, y: 480, net: "0" },
      { x: 624, y: 80, net: "gp", port: "Out" },
      { x: -432, y: 208, net: "pwm", port: "In" },
      { x: 80, y: 64, net: "vrcp" },
      { x: 96, y: -32, net: "bus", port: "BiDir" },
    ]);
    const serialized = serializeAscDocument(doc);
    for (const line of IOPIN_SOURCE.split("\n").filter((l) => /^(FLAG|IOPIN)\b/.test(l))) {
      expect(serialized, line).toContain(line);
    }
    // LTspice reads the pair by adjacency; the port must follow its own FLAG.
    expect(serialized).toContain("FLAG 624 80 gp\nIOPIN 624 80 Out");
    expect(serialized).toContain("FLAG -432 208 pwm\nIOPIN -432 208 In");
  });

  it("survives the full .asc -> schematic -> .asc trip", () => {
    const imported = importAsc(IOPIN_SOURCE);
    expect(
      imported.netLabels.map((l) => [l.text, l.port]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([["bus", "BiDir"], ["gp", "Out"], ["pwm", "In"], ["vrcp", undefined]]);
    const { text } = schematicToAsc({
      components: imported.components,
      wires: imported.wires,
      netLabels: imported.netLabels,
    });
    expect(text).toContain("FLAG 624 80 gp\nIOPIN 624 80 Out");
    expect(text).toContain("FLAG -432 208 pwm\nIOPIN -432 208 In");
    expect(text).toContain("FLAG 96 -32 bus\nIOPIN 96 -32 BiDir");
    // The plain label keeps no port, and ground never grows one.
    expect(text).toContain("FLAG 80 64 vrcp\n");
    expect(text).not.toMatch(/FLAG -64 480 0\nIOPIN/);
  });

  it("no longer blocks a save for hierarchy ports alone", () => {
    expect(ascRewriteRisks(IOPIN_SOURCE)).toEqual([]);
    expect(ascSaveBlockReason(ascRewriteRisks(IOPIN_SOURCE), 0, [])).toBeNull();
  });

  it("keeps the save blocked for a port it cannot reproduce exactly", () => {
    // An unknown direction word, and a port with no FLAG to decorate: both must
    // land in `unknown` rather than being dropped on the way back out.
    for (const bad of ["IOPIN 96 -32 Sideways", "IOPIN 4096 4096 In", "IOPIN 96 -32 In extra"]) {
      const source = `${IOPIN_SOURCE}\n${bad}`;
      expect(parseAsc(source).unknown, bad).toContain(bad);
      expect(ascRewriteRisks(source), bad).toContain("unknown LTspice records");
    }
    // A ground flag has no port to be.
    const grounded = "Version 4\nSHEET 1 880 680\nFLAG -64 480 0\nIOPIN -64 480 In";
    expect(parseAsc(grounded).unknown).toEqual(["IOPIN -64 480 In"]);
  });
});

// A part whose parameters live in the extended SYMATTR slots. The op-amp is
// copied from a real class-D dead-time sheet: LTspice wrote it no `Value` at
// all, so its entire behavior is in Value2 and SpiceLine. The capacitor and
// resistor add the other two shapes - a slot Tau folds only part of onto the
// value, and one it ignores completely.
const EXTENDED_ATTR_SOURCE = `Version 4
SHEET 1 880 680
FLAG -64 480 0
SYMBOL Opamps\\\\UniversalOpamp2 272 80 R0
SYMATTR InstName U2
SYMATTR Value2 Avol=1Meg GBW=10Gig Slew=10Gig
SYMATTR SpiceLine ilimit=2 rail=0 Vos=0 phimargin=45
SYMBOL cap -80 96 R0
SYMATTR InstName C1
SYMATTR Value 20p
SYMATTR SpiceLine Rser=.1 Irms=1.5
SYMBOL res 336 192 R90
SYMATTR InstName R1
SYMATTR Value 100k
SYMATTR SpiceLine tol=1 pwr=0.1`;

const resaveExtendedAttrs = (edit: (c: SchematicComponent) => SchematicComponent = (c) => c) => {
  const imported = importAsc(EXTENDED_ATTR_SOURCE);
  return schematicToAsc({
    components: imported.components.map(edit),
    wires: imported.wires,
    netLabels: imported.netLabels,
  });
};

describe("extended SYMATTR slots (Value2 / SpiceLine) round-trip", () => {
  it("saves a vendor model choice to Value2 without changing the visible part", () => {
    const source = "Version 4\nSHEET 1 880 680\nSYMBOL Opamps\\OP07 80 80 R0\n"
      + "SYMATTR InstName U1\nSYMATTR Value OP07\nSYMATTR Value2 LT1001";
    const imported = importAsc(source);
    const result = schematicToAsc({
      components: imported.components.map((component) => withOpampModel(component, "MY_OP07")),
      wires: imported.wires,
      netLabels: imported.netLabels,
    });
    expect(result.warnings).toEqual([]);
    expect(result.text).toContain("SYMATTR Value OP07\nSYMATTR Value2 MY_OP07");
    const reopened = importAsc(result.text).components[0];
    expect(reopened.value).toBe("OP07 MY_OP07");
    expect(reopened.ltSymbolType).toBe("Opamps\\OP07");
  });

  it("puts each parameter back in the slot it came from", () => {
    const { text } = resaveExtendedAttrs();
    // The op-amp had no Value; inventing one would hand LTspice a different
    // part, since UniversalOpamp2 reads its level from that slot.
    expect(text).toContain(
      "SYMATTR InstName U2\nSYMATTR Value2 Avol=1Meg GBW=10Gig Slew=10Gig\n"
        + "SYMATTR SpiceLine ilimit=2 rail=0 Vos=0 phimargin=45",
    );
    expect(text).not.toMatch(/SYMATTR Value Avol=/);
    expect(text).toContain("SYMATTR InstName R1\nSYMATTR Value 100k\nSYMATTR SpiceLine tol=1 pwr=0.1");
  });

  it("keeps a parameter Tau's own value never carried", () => {
    // Tau folds Rser onto the capacitance and drops Irms, which it has no use
    // for. Re-emitting the slot verbatim is what stops the save destroying it.
    const imported = importAsc(EXTENDED_ATTR_SOURCE);
    const cap = imported.components.find((c) => c.label === "C1");
    expect(cap?.value).toBe("20p Rser=.1");
    expect(resaveExtendedAttrs().text).toContain("SYMATTR Value 20p\nSYMATTR SpiceLine Rser=.1 Irms=1.5");
  });

  it("reopens with the same values it was saved from", () => {
    const before = importAsc(EXTENDED_ATTR_SOURCE);
    const after = importAsc(resaveExtendedAttrs().text);
    expect(after.components.map((c) => [c.label, c.value]))
      .toEqual(before.components.map((c) => [c.label, c.value]));
  });

  it("no longer blocks a save for extended attributes alone", () => {
    const risks = ascRewriteRisks(EXTENDED_ATTR_SOURCE);
    expect(risks).toEqual([]);
    expect(ascSaveBlockReason(risks, 0, resaveExtendedAttrs().warnings)).toBeNull();
  });

  it("takes an edited value into Value when no slot was folded onto it", () => {
    const { text, warnings } = resaveExtendedAttrs((c) => c.label === "R1" ? { ...c, value: "200k" } : c);
    expect(text).toContain("SYMATTR InstName R1\nSYMATTR Value 200k\nSYMATTR SpiceLine tol=1 pwr=0.1");
    expect(warnings).toEqual([]);
  });

  it("writes a single-slot folded edit back to the LTspice slot that owns it", () => {
    const editedValue = "Avol=2Meg GBW=10Gig Slew=10Gig ilimit=2 rail=0 Vos=0 phimargin=45";
    const { text, warnings } = resaveExtendedAttrs((c) => (
      c.label === "U2" ? { ...c, value: editedValue } : c
    ));

    expect(warnings).toEqual([]);
    expect(text).toContain("SYMATTR Value2 Avol=2Meg GBW=10Gig Slew=10Gig");
    expect(text).toContain("SYMATTR SpiceLine ilimit=2 rail=0 Vos=0 phimargin=45");
    expect(importAsc(text).components.find((c) => c.label === "U2")?.value).toBe(editedValue);
  });

  it("refuses the save when an edit spans multiple folded slots", () => {
    // Replacing the whole joined line deletes text from both Value2 and
    // SpiceLine. That cannot be assigned to one authoritative slot, so
    // dropping the originals silently is the failure this guards.
    const { text, warnings } = resaveExtendedAttrs((c) => c.label === "U2" ? { ...c, value: "Avol=2Meg" } : c);
    expect(warnings).toEqual([
      "U2: Value2, SpiceLine are not preserved; the part's parameters are saved on Value alone.",
    ]);
    expect(ascSaveBlockReason([], 0, warnings)).toBe(warnings[0]);
    expect(text).not.toContain("SYMATTR Value2");
  });

  it("keeps the save blocked for a part re-emitted under a different real symbol", () => {
    // A 4-pin BJT is rewritten to `npn`, which reads its own slots differently,
    // and unlike a carrier it records no Tau kind to tie them back to.
    const source = "Version 4\nSHEET 1 880 680\nSYMBOL npn4 400 400 R0\nSYMATTR InstName Q1\n"
      + "SYMATTR Value 2N2222\nSYMATTR SpiceLine tj=25";
    expect(ascRewriteRisks(source)).toContain("extended symbol attributes");
  });
});

// A Tau-native switch saved under a placeholder resistor cannot put its
// `SpiceLine` back under that name: on a resistor LTspice would read it as the
// resistor's parasitics. The slots ride in the Tau-only field instead. This
// fixture starts as an already-authored Tau carrier; imported csw now remains
// csw and is covered independently above.
const CARRIER_ATTR_SOURCE = `Version 4
SHEET 1 880 680
SYMBOL res 400 400 R0
SYMATTR InstName R_TAU_1
SYMATTR Value 1T
SYMATTR TauKind switch
SYMATTR TauValue MYSW
SYMATTR TauLabel S1
SYMATTR TauAttrs {"base":"MYSW","slots":{"SpiceLine":"Ron=1 Roff=1Meg"}}`;

const CARRIED_SLOTS = "{\"base\":\"MYSW\",\"slots\":{\"SpiceLine\":\"Ron=1 Roff=1Meg\"}}";

const resaveCarrierAttrs = (source = CARRIER_ATTR_SOURCE) => {
  const imported = importAsc(source);
  return schematicToAsc({
    components: imported.components,
    wires: imported.wires,
    netLabels: imported.netLabels,
  });
};

describe("extended SYMATTR slots on a part saved under a carrier symbol", () => {
  it("parks the slots beside the kind they belong to", () => {
    const { text } = resaveCarrierAttrs();
    expect(text).toContain("SYMATTR TauKind switch");
    expect(text).toContain(`SYMATTR TauAttrs ${CARRIED_SLOTS}`);
    // Writing the slot under its own name would hand LTspice a resistor with
    // an Ron/Roff spec, which is what makes the carrier the only safe place.
    expect(text).not.toContain("SYMATTR SpiceLine");
  });

  it("reopens as the same part, with the same slots and the value they sat beside", () => {
    const before = importAsc(CARRIER_ATTR_SOURCE).components[0];
    const after = importAsc(resaveCarrierAttrs().text).components[0];
    expect(after.kind).toBe("switch");
    expect(after.value).toBe(before.value);
    expect(after.label).toBe("S1");
    expect(after.ltExtraAttrs).toEqual(before.ltExtraAttrs);
    expect(after.ltExtraAttrs?.extras).toEqual({ SpiceLine: "Ron=1 Roff=1Meg" });
  });

  it("still holds them after a second save", () => {
    // The carried record has to survive its own round-trip, or the slots would
    // simply disappear one save later instead of at the first one.
    expect(resaveCarrierAttrs(resaveCarrierAttrs().text).text).toContain(`SYMATTR TauAttrs ${CARRIED_SLOTS}`);
  });

  it("saves a schematic holding the part instead of refusing it", () => {
    // The slots used to leave a warning the save guard treats as fatal, so a
    // document holding the part could not be written at all. What is left is
    // the notice that LTspice sees a resistor, which never blocks a save.
    const { warnings } = resaveCarrierAttrs();
    expect(warnings.filter((w) => !isLossyCarrierWarning(w))).toEqual([]);
    expect(ascSaveBlockReason([], 0, warnings)).toBeNull();
  });

  it("stops naming the slots as a reason the source file cannot be rewritten", () => {
    // The source is already Tau's explicit carrier representation, so another
    // save does not create a new rewrite risk.
    expect(ascRewriteRisks(CARRIER_ATTR_SOURCE)).toEqual([]);
  });

  it("refuses to park slots the value no longer matches", () => {
    // A folded value IS its slots joined, so an edit cannot be split back
    // across them. The carrier is a place to park the slots, not a way around
    // the value that no longer agrees with them.
    const part: SchematicComponent = {
      id: "c1",
      kind: "switch",
      x: 0,
      y: 0,
      rotation: 0,
      value: "MYSW Ron=1",
      label: "S1",
      ltExtraAttrs: { baseValue: "MYSW", derivedValue: "MYSW Ron=1", extras: { SpiceLine: "Ron=1" } },
    };
    const edited = schematicToAsc({ components: [{ ...part, value: "OTHER" }], wires: [], netLabels: [] });
    expect(edited.warnings.filter((w) => !isLossyCarrierWarning(w))).toEqual([
      "S1: SpiceLine is not preserved; the part's parameters are saved on Value alone.",
    ]);
    expect(edited.text).not.toContain("SYMATTR TauAttrs");

    // Unedited, the same part parks the slots beside the `Value` they sat
    // beside - the source symbol's own, not the value Tau folded them into.
    const kept = schematicToAsc({ components: [part], wires: [], netLabels: [] });
    expect(kept.text).toContain("SYMATTR TauAttrs {\"base\":\"MYSW\",\"slots\":{\"SpiceLine\":\"Ron=1\"}}");
  });

  it("writes every carrier kind under a Tau kind, so the save guard and the exporter agree", () => {
    for (const kind of TAU_CARRIER_KINDS) {
      const { text } = schematicToAsc({
        components: [{ id: "c1", kind, x: 0, y: 0, rotation: 0, value: "", label: "X1" }],
        wires: [],
        netLabels: [],
      });
      expect(text, kind).toContain(`SYMATTR TauKind ${kind}`);
    }
  });

  it("keeps a slot written on the carrier symbol itself", () => {
    // Tau writes one or the other, never both, but a hand-edited file can hold
    // both and neither may vanish on the way through.
    const source = "Version 4\nSHEET 1 880 680\nSYMBOL res 400 400 R0\nSYMATTR InstName R1\n"
      + "SYMATTR Value 1T\nSYMATTR TauKind switch\nSYMATTR TauValue MYSW\n"
      + `SYMATTR TauAttrs ${CARRIED_SLOTS}\nSYMATTR Value2 tol=1`;
    expect(importAsc(source).components[0].ltExtraAttrs?.extras)
      .toEqual({ Value2: "tol=1", SpiceLine: "Ron=1 Roff=1Meg" });
  });

  it("ignores a carried record Tau did not write", () => {
    // The field is file content. A newline in a value would forge whole
    // records on the next save; a reserved name would overwrite the part's own
    // identity. Every malformed form has to read as no record at all.
    const forged = [
      "not json",
      "[\"SpiceLine\",\"Ron=1\"]",
      "{\"base\":\"MYSW\"}",
      "{\"base\":\"MYSW\",\"slots\":{}}",
      "{\"base\":\"MYSW\",\"slots\":{\"SpiceLine\":5}}",
      "{\"base\":\"MYSW\",\"slots\":{\"TauKind\":\"resistor\"}}",
      "{\"base\":\"MYSW\",\"slots\":{\"InstName\":\"R9\"}}",
      "{\"base\":\"MYSW\",\"slots\":{\"Spice Line\":\"Ron=1\"}}",
      "{\"base\":\"MYSW\",\"slots\":{\"SpiceLine\":\"x\\nSYMBOL res 0 0 R0\"}}",
      `{"base":"MYSW","slots":{${
        Array.from({ length: 17 }, (_, i) => `"S${i}":"1"`).join(",")
      }}}`,
      `{"base":"MYSW","slots":{"SpiceLine":"${"x".repeat(4096)}"}}`,
    ];
    for (const record of forged) {
      const source = `Version 4\nSHEET 1 880 680\nSYMBOL res 400 400 R0\nSYMATTR InstName R1\n`
        + `SYMATTR Value 1T\nSYMATTR TauKind switch\nSYMATTR TauValue MYSW\n`
        + `SYMATTR TauAttrs ${record}`;
      const component = importAsc(source).components[0];
      expect(component.ltExtraAttrs, record).toBeUndefined();
      // Nothing forged can reach the next file: the record is not carried, so
      // there is nothing to write back out.
      const { text } = schematicToAsc({ components: [component], wires: [], netLabels: [] });
      expect(text, record).not.toContain("SYMATTR TauAttrs");
      expect(text.split("\n").filter((l) => l.startsWith("SYMBOL")), record).toHaveLength(1);
    }
  });
});
