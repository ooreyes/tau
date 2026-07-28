import { describe, it, expect } from "vitest";
import { extractCircuit } from "../schematic/netlist";
import { parseAsc, ascToSchematic, importAsc } from "./ascImport";
import {
  serializeAscDocument,
  schematicToAsc,
  kindToLtspiceType,
  rotationToOrientation,
  canEmitLtSymbolVerbatim,
} from "./ascExport";
import type { AscDocument } from "./ascImport";
import type { NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";
import { ascRewriteRisks, schematicTopologySignature } from "../project/types";
import { CATALOG } from "../schematic/catalog";

// The same representative LTspice grammar the importer tests use, minus the
// drawing primitive and WINDOW lines (which the serializer canonicalizes away).
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
      shapes: [],
      unknown: ["GIBBERISH 1 2 3"],
    };
    expect(serializeAscDocument(doc)).not.toContain("GIBBERISH");
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
    // npn4 has a substrate pin the 3-pin npn bank cannot represent; sw has a
    // control pin pair; diac's imported value is a placeholder resistance.
    for (const type of ["npn4", "sw", "diac"]) {
      const src = NMOS3.replace("SYMBOL nmos", `SYMBOL ${type}`);
      expect(ascRewriteRisks(src), type).toContain("symbol-library identity");
    }
    expect(canEmitLtSymbolVerbatim("npn4", "npn")).toBe(false);
    expect(canEmitLtSymbolVerbatim("sw", "switch")).toBe(false);
    expect(canEmitLtSymbolVerbatim("diac", "resistor")).toBe(false);
    // Digital gates encode their function in the symbol leaf, which the
    // importer prepends to the value; verbatim re-emission would double it.
    expect(canEmitLtSymbolVerbatim("Digital\\\\and", "digitalGate")).toBe(false);
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
