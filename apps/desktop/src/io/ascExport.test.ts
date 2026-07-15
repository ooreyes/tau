import { describe, it, expect } from "vitest";
import { parseAsc, ascToSchematic, importAsc } from "./ascImport";
import {
  serializeAscDocument,
  schematicToAsc,
  kindToLtspiceType,
  rotationToOrientation,
} from "./ascExport";
import type { AscDocument } from "./ascImport";

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
    expect(kindToLtspiceType("npn")).toBe("npn");
    expect(kindToLtspiceType("nmos")).toBe("nmos");
    expect(kindToLtspiceType("bsource")).toBe("bv");
    expect(kindToLtspiceType("vcvs")).toBe("e");
    expect(kindToLtspiceType("opamp")).toBe("opamp2");
  });

  it("returns null for kinds with no LTspice symbol of their own", () => {
    expect(kindToLtspiceType("ground")).toBeNull();
    expect(kindToLtspiceType("testpoint")).toBeNull();
  });
});

describe("rotationToOrientation", () => {
  it("maps rotation + mirror to an orientation token", () => {
    expect(rotationToOrientation(0, false)).toBe("R0");
    expect(rotationToOrientation(90, false)).toBe("R90");
    expect(rotationToOrientation(270, undefined)).toBe("R270");
    expect(rotationToOrientation(0, true)).toBe("M0");
    expect(rotationToOrientation(180, true)).toBe("M180");
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

  it("splits a multi-segment Tau wire into LTspice WIRE segments and warns", () => {
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
    expect(warnings).toHaveLength(1);
  });

  it("warns and skips a component with no LTspice symbol", () => {
    const { warnings } = schematicToAsc({
      components: [
        { id: "tp1", kind: "testpoint", x: 0, y: 0, rotation: 0, value: "", label: "TP1" },
      ],
      wires: [],
      netLabels: [],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("testpoint");
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
