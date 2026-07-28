import { describe, expect, it } from "vitest";
import { parseKicadNet } from "./kicadNetImport";
import { extractCircuit } from "../schematic/netlist";
import { schematicToAsc } from "./ascExport";
import { importAsc } from "./ascImport";

/** A small but structurally realistic KiCad netlist export (the S-expression
 *  format from Eeschem's "Generate Netlist File", not the SPICE export). */
const RC_NET = `(export (version D)
  (design (source "/tmp/rc.sch") (date "2026-07-27") (tool "Eeschem 7.0.0"))
  (components
    (comp (ref "R1") (value "10k") (footprint "R_0603")
      (libsource (lib "Device") (part "R") (description "Resistor")))
    (comp (ref "C1") (value "100nF")
      (libsource (lib "Device") (part "C") (description "Unpolarized capacitor")))
    (comp (ref "#PWR01") (value "GND")
      (libsource (lib "power") (part "GND") (description "power symbol"))))
  (libparts)
  (libraries)
  (nets
    (net (code "1") (name "/VIN")
      (node (ref "R1") (pin "1")))
    (net (code "2") (name "")
      (node (ref "R1") (pin "2"))
      (node (ref "C1") (pin "1")))
    (net (code "3") (name "GND")
      (node (ref "C1") (pin "2"))
      (node (ref "#PWR01") (pin "1")))))`;

describe("parseKicadNet", () => {
  it("reconstructs resistors and capacitors with real connectivity", () => {
    const result = parseKicadNet(RC_NET);
    const byLabel = Object.fromEntries(result.components.map((c) => [c.label, c]));
    expect(Object.keys(byLabel).sort()).toEqual(["C1", "R1"]);
    expect(byLabel.R1.kind).toBe("resistor");
    expect(byLabel.R1.value).toBe("10k");
    expect(byLabel.C1.kind).toBe("capacitor");
    expect(byLabel.C1.value).toBe("100nF");
  });

  it("skips KiCad power-flag pseudo-components without a warning", () => {
    const result = parseKicadNet(RC_NET);
    expect(result.warnings).toEqual([]);
    expect(result.components.some((c) => c.label === "#PWR01")).toBe(false);
  });

  it("maps a net named GND to Tau's ground net and an unnamed net to a generated name", () => {
    const result = parseKicadNet(RC_NET);
    const circuit = extractCircuit(result.components, result.wires, result.netLabels);
    const gnd = circuit.nets.find((n) => n.isGround);
    expect(gnd).toBeDefined();
    expect(gnd!.pins.map((p) => p.componentLabel).sort()).toEqual(["C1"]);
    // The middle, unnamed net still connects R1 and C1 to each other.
    const middle = circuit.nets.find((n) => !n.isGround && n.pins.length === 2);
    expect(middle!.pins.map((p) => p.componentLabel).sort()).toEqual(["C1", "R1"]);
  });

  it("names a named non-ground net after its KiCad label", () => {
    const result = parseKicadNet(RC_NET);
    const circuit = extractCircuit(result.components, result.wires, result.netLabels);
    expect(circuit.nets.some((n) => n.id === "VIN")).toBe(true);
  });

  it("warns by ref and part name for a component it will not guess at, and leaves it out", () => {
    const withIc = `(export (version D)
      (components
        (comp (ref "R1") (value "1k") (libsource (lib "Device") (part "R")))
        (comp (ref "U1") (value "LM358") (libsource (lib "Amplifier_Operational") (part "LM358"))))
      (nets
        (net (code "1") (name "OUT") (node (ref "R1") (pin "1")) (node (ref "U1") (pin "1")))
        (net (code "2") (name "GND") (node (ref "R1") (pin "2")))))`;
    const result = parseKicadNet(withIc);
    expect(result.components.map((c) => c.label)).toEqual(["R1"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("U1");
    expect(result.warnings[0]).toContain("LM358");
    expect(result.warnings[0]).toMatch(/not imported/);
  });

  it("does not guess a transistor or diode kind from the reference prefix alone", () => {
    const withActives = `(export (version D)
      (components
        (comp (ref "Q1") (value "2N3904") (libsource (lib "Device") (part "Q_NPN_BCE")))
        (comp (ref "D1") (value "1N4148") (libsource (lib "Device") (part "D"))))
      (nets
        (net (code "1") (name "A") (node (ref "Q1") (pin "1")) (node (ref "D1") (pin "1")))))`;
    const result = parseKicadNet(withActives);
    expect(result.components).toEqual([]);
    // One warning per skipped part, plus the "nothing could be reconstructed"
    // summary since this netlist has no safely-mappable part at all.
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings.join(" ")).toContain("Q1");
    expect(result.warnings.join(" ")).toContain("D1");
  });

  it("falls back to the ref-designator prefix only for an exact R/C/L match when libsource is missing", () => {
    const noLibsource = `(export (version D)
      (nets
        (net (code "1") (name "A") (node (ref "R5") (pin "1")))
        (net (code "2") (name "B") (node (ref "RV1") (pin "1")))))`;
    const result = parseKicadNet(noLibsource);
    // R5 (bare "R" prefix) is accepted; RV1 (potentiometer-style prefix) is not.
    expect(result.components.map((c) => c.label)).toEqual(["R5"]);
    expect(result.warnings.some((w) => w.includes("RV1"))).toBe(true);
  });

  it("reports when nothing in the netlist could be reconstructed", () => {
    const icOnly = `(export (version D)
      (components
        (comp (ref "U1") (value "ATMEGA328") (libsource (lib "MCU") (part "ATMEGA328"))))
      (nets
        (net (code "1") (name "A") (node (ref "U1") (pin "1")))))`;
    const result = parseKicadNet(icOnly);
    expect(result.components).toEqual([]);
    expect(result.warnings[0]).toMatch(/No parts from this KiCad netlist could be reconstructed/);
  });

  it("throws a clear error for a file with no export/nets structure", () => {
    expect(() => parseKicadNet("(something (else))")).toThrow(/top-level "export"/);
    expect(() => parseKicadNet("(export (version D))")).toThrow(/no "nets" section/);
  });

  it("throws a clear error for a malformed (unbalanced) S-expression", () => {
    expect(() => parseKicadNet("(export (version D) (nets")).toThrow(/unmatched/);
    expect(() => parseKicadNet("(export))")).toThrow(/unmatched/);
  });
});

describe("hostile KiCad input", () => {
  it("cannot forge extra .asc records through a newline in a quoted field", () => {
    // .asc records are single-line, so a literal newline inside a KiCad string
    // becomes an extra line that the importer reads back as a real record. This
    // payload tries to smuggle a .tran directive into a schematic the user
    // believes contains only passives.
    const hostile = `(export (version "E")
  (components
    (comp (ref "R1") (value "10k\nTEXT 400 400 Left 2 !.tran 1 100")))
  (nets
    (net (code "1") (name "N1")
      (node (ref "R1") (pin "1")))))`;
    const parsed = parseKicadNet(hostile);
    for (const component of parsed.components) {
      expect(component.value).not.toContain("\n");
      expect(component.label).not.toContain("\n");
    }

    // The property that matters is not that the text vanishes - a nonsense
    // component value is harmless - but that it cannot become its OWN record.
    // Serialize and confirm no line parses as a directive.
    const { text } = schematicToAsc({
      components: parsed.components,
      wires: parsed.wires,
      netLabels: parsed.netLabels,
      directives: [],
      comments: [],
    });
    const forged = text.split("\n").filter((line) => /^\s*TEXT\b/.test(line));
    expect(forged, `forged records: ${JSON.stringify(forged)}`).toHaveLength(0);
    expect(importAsc(text).directives).toEqual([]);
  });

  it("strips control characters from net names too", () => {
    const hostile = `(export (version "E")
  (components (comp (ref "R1") (value "1k")))
  (nets (net (code "1") (name "out\rFLAG 0 0 0")
    (node (ref "R1") (pin "1")))))`;
    const parsed = parseKicadNet(hostile);
    for (const label of parsed.netLabels) {
      expect(label.text).not.toMatch(/[\r\n]/);
    }
  });

  it("stops a paren flood instead of tokenizing it unbounded", () => {
    // The cap used to sit only on the bare-atom branch, so a file of nothing
    // but "(" never tripped it: 5 MB tokenized in 91ms with no error.
    expect(() => parseKicadNet("(".repeat(3_000_000))).toThrow(/size budget/i);
  });
});
