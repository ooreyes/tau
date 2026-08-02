import { describe, expect, it } from "vitest";

import { importAsc, makeSubcircuitResolver, type SubcircuitResolver } from "../io/ascImport";
import { isLossyCarrierWarning, schematicToAsc } from "../io/ascExport";
import { validateSchematicDocument } from "../schematic/documentValidation";
import { CATALOG } from "../schematic/catalog";
import { extractCircuit } from "../schematic/netlist";
import { getComponentPins } from "../schematic/pins";
import {
  ascRewriteRisks,
  ascSaveBlockReason,
  blankAscText,
  remapMovedProjectPath,
  serializeSchematicFile,
} from "./types";

const ASC_SOURCE = `Version 4
SHEET 1 880 680
WIRE 80 96 224 96
FLAG 80 96 input
SYMBOL res 160 80 R90
SYMATTR InstName R1
SYMATTR Value 1k
TEXT 0 0 Left 2 !.tran 1m
`;

const LEGACY_TAU_LED = `Version 4
SHEET 1 880 680
WIRE -32 96 32 96
WIRE 96 96 176 96
WIRE 176 160 -32 160
FLAG -32 160 0
SYMBOL voltage -32 128 R0
SYMATTR InstName V1
SYMATTR Value 5
SYMBOL res 64 96 R0
SYMATTR InstName R1
SYMATTR Value 1k
SYMBOL led 176 128 R90
SYMATTR InstName D1
SYMATTR Value LED
`;

describe("project schematic file formats", () => {
  it("creates a valid, empty LTspice schematic", () => {
    const imported = importAsc(blankAscText());
    expect(blankAscText()).toBe("Version 4\nSHEET 1 880 680\n");
    expect(imported.components).toEqual([]);
    expect(imported.wires).toEqual([]);
  });

  it("exports edited documents as ASC text and round-trips them", () => {
    const original = importAsc(ASC_SOURCE);
    const saved = serializeSchematicFile("/Schematics/filter.asc", {
      components: original.components,
      wires: original.wires,
      netLabels: original.netLabels,
      directives: original.directives,
      probes: [],
    });

    expect(saved.contents.startsWith("Version 4\nSHEET ")).toBe(true);
    expect(saved.contents).not.toContain('"app": "Tau"');

    const reopened = importAsc(saved.contents);
    expect(reopened.components.map((component) => component.label)).toEqual(["R1"]);
    expect(reopened.wires).toHaveLength(original.wires.length);
    expect(reopened.netLabels.map((label) => label.text)).toEqual(["input"]);
    expect(reopened.directives).toEqual([".tran 1m"]);
  });

  it("preserves native Tau pin geometry and connectivity across ASC save and reopen", () => {
    const document = {
      components: [
        { id: "v1", kind: "vsource" as const, x: -32, y: 128, rotation: 0 as const, value: "5", label: "V1" },
        { id: "r1", kind: "resistor" as const, x: 64, y: 96, rotation: 0 as const, value: "1k", label: "R1" },
        { id: "d1", kind: "led" as const, x: 176, y: 128, rotation: 90 as const, value: "LED", label: "D1" },
        { id: "g1", kind: "ground" as const, x: -32, y: 160, rotation: 0 as const, value: "", label: "" },
      ],
      wires: [
        { id: "w1", points: [{ x: -32, y: 96 }, { x: 32, y: 96 }] },
        { id: "w2", points: [{ x: 96, y: 96 }, { x: 176, y: 96 }] },
        { id: "w3", points: [{ x: 176, y: 160 }, { x: -32, y: 160 }] },
      ],
      probes: [],
      netLabels: [],
      directives: [".op"],
    };
    expect(extractCircuit(document.components, document.wires).warnings).toEqual([]);
    const originalPins = Object.fromEntries(document.components.map((component) => [
      component.label || "GND",
      getComponentPins(component).map(({ id, x, y }) => ({ id, x, y })),
    ]));

    const saved = serializeSchematicFile("/Schematics/led.asc", document);
    expect(saved.warnings).toEqual([]);
    const reopened = importAsc(saved.contents);
    const reopenedPins = Object.fromEntries(reopened.components.map((component) => [
      component.label || "GND",
      getComponentPins(component).map(({ id, x, y }) => ({ id, x, y })),
    ]));

    expect(reopenedPins).toEqual(originalPins);
    expect(extractCircuit(reopened.components, reopened.wires, reopened.netLabels).warnings).toEqual([]);
  });

  it("repairs the disconnected pin banks written by older Tau ASC exports", () => {
    const reopened = importAsc(LEGACY_TAU_LED);
    expect(reopened.notes).toContain("Recovered native Tau pin geometry for 3 component(s) saved by an older Tau version.");
    expect(reopened.components.filter((component) => component.kind !== "ground").every((component) => !component.pinOverride)).toBe(true);
    expect(extractCircuit(reopened.components, reopened.wires, reopened.netLabels).warnings).toEqual([]);
  });

  it("retains Tau JSON serialization for legacy .sim files", () => {
    const saved = serializeSchematicFile(
      "/Schematics/legacy.sim",
      { components: [], wires: [], probes: [], netLabels: [], directives: [] },
      "2026-07-14T00:00:00.000Z",
    );
    const parsed = JSON.parse(saved.contents) as { app: string; savedAt: string };
    expect(parsed).toEqual(expect.objectContaining({
      app: "Tau",
      savedAt: "2026-07-14T00:00:00.000Z",
    }));
  });

  it("round-trips attached vendor model libraries through a .sim save/open", () => {
    const document = {
      components: [], wires: [], probes: [], netLabels: [], directives: [],
      userModelLibraries: [{ name: "opamps.lib", text: ".subckt OA out in\nR1 in out 1k\n.ends" }],
    };
    const saved = serializeSchematicFile("/Schematics/withlib.sim", document);
    // A re-open runs the same validation the app uses, so the attachment survives.
    const reopened = validateSchematicDocument(JSON.parse(saved.contents));
    expect(reopened.userModelLibraries).toEqual(document.userModelLibraries);
  });

  it("omits the userModelLibraries key from .sim output when a document has none", () => {
    const saved = serializeSchematicFile(
      "/Schematics/nolib.sim",
      { components: [], wires: [], probes: [], netLabels: [], directives: [] },
    );
    expect(Object.prototype.hasOwnProperty.call(JSON.parse(saved.contents), "userModelLibraries")).toBe(false);
  });

  it("blocks rewrites when the source contains records Tau cannot preserve", () => {
    expect(ascRewriteRisks(ASC_SOURCE)).toEqual([]);

    // Drawing primitives are carried on the document (`doc.shapes`) and
    // re-emitted verbatim by the exporter (see the dedicated round-trip test
    // below), so they no longer block the save.
    const withDrawing = `${ASC_SOURCE}LINE Normal 0 0 16 16\n`;
    expect(ascRewriteRisks(withDrawing)).toEqual([]);

    // A WINDOW attached to its symbol is carried on the component and re-emitted,
    // so it no longer blocks the save. LTspice writes one whenever a label is
    // nudged, which made a quarter of real schematics read-only in Tau.
    const nudgedLabel = ASC_SOURCE.replace(
      "SYMATTR InstName R1",
      "WINDOW 0 0 56 VBottom 2\nWINDOW 3 32 56 VTop 2\nSYMATTR InstName R1",
    );
    expect(ascRewriteRisks(nudgedLabel)).toEqual([]);

    // One with no symbol to attach to, or with an operand Tau cannot reproduce
    // exactly, is not understood - it stays on the blocked-save path instead of
    // being dropped on the floor.
    // A DATAFLAG readout is carried on the document (`doc.ascDataFlags`) and
    // re-emitted verbatim, so it no longer blocks the save. It was the only
    // record left in the `unknown` category across the real corpus.
    expect(ascRewriteRisks(`${ASC_SOURCE}DATAFLAG 80 96 ""\n`)).toEqual([]);
    // One whose coordinates cannot be reproduced exactly stays blocked rather
    // than being re-emitted at the origin.
    expect(ascRewriteRisks(`${ASC_SOURCE}DATAFLAG 0.5 96 ""\n`)).toEqual(["unknown LTspice records"]);

    expect(ascRewriteRisks(`${ASC_SOURCE}WINDOW 0 24 56 Left 2\n`)).toEqual(["unknown LTspice records"]);
    expect(ascRewriteRisks(nudgedLabel.replace("VBottom", "Sideways"))).toEqual(["unknown LTspice records"]);

    expect(ascRewriteRisks(ASC_SOURCE.replace("TEXT 0 0", "TEXT 64 160"))).not.toContain(
      "directive annotation placement",
    );

    // A vendor op-amp keeps its symbol identity verbatim, so its extra SYMATTR
    // fields go back into their own slots and no longer block the rewrite.
    const vendorOpAmp = `Version 4\nSHEET 1 880 680\nSYMBOL Opamps\\LT1001 80 80 R0\nSYMATTR InstName U1\nSYMATTR SpiceLine Avol=1Meg\n`;
    expect(ascRewriteRisks(vendorOpAmp)).toEqual([]);
    const resaved = importAsc(vendorOpAmp);
    expect(schematicToAsc({ components: resaved.components, wires: [], netLabels: [] }).text)
      .toContain("SYMATTR InstName U1\nSYMATTR SpiceLine Avol=1Meg");

    // A part written under a carrier symbol keeps its slots in the Tau-only
    // field, so they are no longer a reason to block. The save stays blocked
    // all the same: csw is a 2-pin symbol, so the carrier drops the cp/cn pair
    // Tau draws on every switch.
    const carrier = `Version 4\nSHEET 1 880 680\nSYMBOL csw 80 80 R0\nSYMATTR InstName S1\nSYMATTR SpiceLine Ron=1\n`;
    expect(ascRewriteRisks(carrier)).toEqual(["symbol-library identity"]);

    // A voltage-controlled switch is not one of them: sw.asy's four pins are
    // banked whole, so the part goes back out as itself.
    const vswitch = `Version 4\nSHEET 1 880 680\nSYMBOL sw 80 80 R0\nSYMATTR InstName S1\nSYMATTR Value MYSW\n`;
    expect(ascRewriteRisks(vswitch)).toEqual([]);

    // npn4's substrate pin has no banked geometry, so its identity cannot be
    // re-emitted faithfully and the save block stays.
    const substrateBjt = `Version 4\nSHEET 1 880 680\nSYMBOL npn4 80 80 R0\nSYMATTR InstName Q1\n`;
    expect(ascRewriteRisks(substrateBjt)).toContain("symbol-library identity");
  });

  it("does not block a save for a resistor divider annotated with drawing primitives", () => {
    // A plain resistor divider (Vin -> R1 -> Vout(unlabeled) -> R2 -> GND) plus
    // one of each drawing primitive. No OTHER risk (unknown records, hierarchy
    // ports, symbol identity, extended attributes, unsupported devices) fires,
    // so this isolates the "drawing primitives" risk having been retired.
    const source = `Version 4
SHEET 1 880 680
WIRE 96 128 96 176
FLAG 96 48 vin
FLAG 96 256 0
SYMBOL res 80 32 R0
SYMATTR InstName R1
SYMATTR Value 1k
SYMBOL res 80 160 R0
SYMATTR InstName R2
SYMATTR Value 1k
LINE Normal 500 32 600 32
RECTANGLE Normal 500 64 600 128
CIRCLE Wide 500 160 540 200
ARC Normal 500 240 600 320 500 320 600 240
`;
    const risks = ascRewriteRisks(source);
    expect(risks).not.toContain("drawing primitives");
    expect(risks).toEqual([]);
    expect(ascSaveBlockReason(risks, 0, [])).toBeNull();

    // End to end: the shapes actually survive a real save with no warnings.
    const imported = importAsc(source);
    expect(imported.warnings).toEqual([]);
    const saved = serializeSchematicFile("/Schematics/divider.asc", {
      components: imported.components,
      wires: imported.wires,
      probes: [],
      netLabels: imported.netLabels,
      directives: imported.directives,
      ascShapes: imported.shapes,
    });
    expect(saved.warnings).toEqual([]);
    expect(saved.contents).toContain("LINE Normal 500 32 600 32");
    expect(saved.contents).toContain("RECTANGLE Normal 500 64 600 128");
    expect(saved.contents).toContain("CIRCLE Wide 500 160 540 200");
    expect(saved.contents).toContain("ARC Normal 500 240 600 320 500 320 600 240");
    expect(ascSaveBlockReason(ascRewriteRisks(saved.contents), 0, saved.warnings)).toBeNull();
  });

  it("carries DATAFLAG readouts through a real save instead of dropping them", () => {
    // The record forms LTspice writes in its own shipped examples, plus a
    // non-empty expression with inner spaces to prove the tail is not re-joined
    // from split tokens.
    const source = `${ASC_SOURCE}DATAFLAG -784 1648 ""
DATAFLAG 320 1584 ""
DATAFLAG 64 128 "V(out) - V(input)"
`;
    const risks = ascRewriteRisks(source);
    expect(risks).toEqual([]);
    expect(ascSaveBlockReason(risks, 0, [])).toBeNull();

    // End to end: the readouts survive a real save with no warnings. Parsing
    // them is not enough - they have to reach the written file.
    const imported = importAsc(source);
    expect(imported.warnings).toEqual([]);
    expect(imported.dataFlags).toHaveLength(3);
    const saved = serializeSchematicFile("/Schematics/readouts.asc", {
      components: imported.components,
      wires: imported.wires,
      probes: [],
      netLabels: imported.netLabels,
      directives: imported.directives,
      ascDataFlags: imported.dataFlags,
    });
    expect(saved.warnings).toEqual([]);
    expect(saved.contents).toContain('DATAFLAG -784 1648 ""');
    expect(saved.contents).toContain('DATAFLAG 320 1584 ""');
    expect(saved.contents).toContain('DATAFLAG 64 128 "V(out) - V(input)"');
    // The written file is itself clean, so a second save is not blocked either.
    expect(ascSaveBlockReason(ascRewriteRisks(saved.contents), 0, saved.warnings)).toBeNull();
    expect(importAsc(saved.contents).dataFlags).toEqual(imported.dataFlags);
  });

  it("carries a foreign symbol with no Tau equivalent through a real save instead of dropping it", () => {
    // A vendor part Tau cannot map to a kind - the schematic still opens (and
    // the record is retained on import), but serializeSchematicFile must
    // re-emit it verbatim rather than silently deleting it from the file.
    // (This proves only the writer side. Whether the save is allowed to run
    // at all is the next test's subject.)
    const source = `Version 4
SHEET 1 880 680
SYMBOL PowerProducts\\LTC4449 100 200 R0
SYMATTR InstName U1
SYMATTR Value LTC4449`;
    const imported = importAsc(source);
    expect(imported.foreignSymbols).toHaveLength(1);
    expect(imported.warnings.some((w) => w.includes("no Tau equivalent"))).toBe(true);

    const saved = serializeSchematicFile("/Schematics/vendor.asc", {
      components: imported.components,
      wires: imported.wires,
      probes: [],
      netLabels: imported.netLabels,
      directives: imported.directives,
      ascForeignSymbols: imported.foreignSymbols,
    });
    expect(saved.contents).toContain("SYMBOL PowerProducts\\LTC4449 100 200 R0");
    expect(saved.contents).toContain("SYMATTR InstName U1");
    expect(saved.contents).toContain("SYMATTR Value LTC4449");
  });

  it("stops blocking the save once the document is known to carry the vendor symbol", () => {
    const source = `Version 4
SHEET 1 880 680
FLAG 96 256 0
SYMBOL res 80 32 R0
SYMATTR InstName R1
SYMATTR Value 1k
SYMBOL PowerProducts\\LTC4449 100 200 R0
SYMATTR InstName U1
SYMATTR Value LTC4449
`;
    const imported = importAsc(source);
    expect(imported.foreignSymbols).toHaveLength(1);
    // The part still is not simulated, so the notice still has to reach
    // Diagnostics. Unblocking the save must not silence it.
    expect(imported.warnings).toEqual([
      'Skipped U1: no Tau equivalent for LTspice symbol "PowerProducts\\LTC4449".',
    ]);

    // With no carried set the verdict stays the conservative one: an unmapped
    // symbol raises both risks and the save is refused.
    expect([...ascRewriteRisks(source)].sort()).toEqual([
      "partially supported devices",
      "symbol-library identity",
    ]);
    expect(ascSaveBlockReason(ascRewriteRisks(source), 0, [])).not.toBeNull();

    // Told what the document carries, both risks are subtracted and the save
    // runs. The resistor beside it still has to answer for itself.
    const risks = ascRewriteRisks(source, imported.foreignSymbols);
    expect(risks).toEqual([]);
    const saved = serializeSchematicFile("/Schematics/vendor.asc", {
      components: imported.components,
      wires: imported.wires,
      probes: [],
      netLabels: imported.netLabels,
      directives: imported.directives,
      ascForeignSymbols: imported.foreignSymbols,
    });
    expect(ascSaveBlockReason(risks, 0, saved.warnings)).toBeNull();
    expect(saved.contents).toContain("SYMBOL PowerProducts\\LTC4449 100 200 R0");
    expect(saved.contents).toContain("SYMATTR Value LTC4449");

    // Re-importing what Tau just wrote yields the same record and the same
    // verdict, so repeated saves are a fixed point rather than slow erosion.
    const reimported = importAsc(saved.contents);
    expect(reimported.foreignSymbols).toEqual(imported.foreignSymbols);
    expect(ascRewriteRisks(saved.contents, reimported.foreignSymbols)).toEqual([]);
  });

  it("keeps blocking a hierarchical block, whose in-place save would flatten it", () => {
    // The trap the second argument exists for. `ascRewriteRisks` re-imports the
    // source with NO subcircuit resolver, so `mydiv2` falls through to the
    // foreign-symbol branch and looks carried verbatim. The document the app
    // would actually write was imported WITH a resolver, which FLATTENS the
    // block into ordinary parts - saving that in place would rewrite the
    // user's hierarchy as flat components.
    const bodyAsy = `Version 4
SymbolType BLOCK
PIN -32 0 LEFT 8
PINATTR PinName a
PINATTR SpiceOrder 1
PIN 32 0 RIGHT 8
PINATTR PinName b
PINATTR SpiceOrder 2`;
    const bodyAsc = `Version 4
SHEET 1 100 200
FLAG 16 0 a
FLAG 16 160 b
SYMBOL res 0 -16 R0
SYMATTR InstName R1
SYMATTR Value 1k`;
    const resolver: SubcircuitResolver = makeSubcircuitResolver((type) =>
      type.toLowerCase() === "mydiv2" ? { asy: bodyAsy, asc: bodyAsc } : null,
    );
    const source = `Version 4
SHEET 1 880 680
SYMBOL mydiv2 200 200 R0
SYMATTR InstName X1
`;
    const resolved = importAsc(source, { resolveSubcircuit: resolver });
    expect(resolved.foreignSymbols).toEqual([]);
    expect(resolved.components.length).toBeGreaterThan(0);

    // The two imports genuinely disagree, which is why the set has to be
    // passed in: deriving it here would call the flattened block "carried"
    // and let the save overwrite the hierarchy.
    expect(importAsc(source).foreignSymbols).toHaveLength(1);
    expect(ascRewriteRisks(source, importAsc(source).foreignSymbols)).toEqual([]);

    // The authoritative set keeps the block.
    const risks = ascRewriteRisks(source, resolved.foreignSymbols);
    expect(risks).toContain("symbol-library identity");
    expect(ascSaveBlockReason(risks, 0, [])).not.toBeNull();

    // The un-flattened record is retained, and NOT as a foreign symbol: it
    // simulates, and `ascForeignSymbols` feeds the simulation-integrity
    // refusal, so putting it there would stop the block running at all.
    expect(resolved.hierarchicalBlocks).toHaveLength(1);
    expect(resolved.hierarchicalBlocks[0]).toMatchObject({
      type: "mydiv2",
      x: 200,
      y: 200,
      orientation: "R0",
      attrs: { InstName: "X1" },
    });

    // Told which records resolved, the verdict is unchanged - the save is
    // still refused - but the reason stops claiming Tau has no symbol for a
    // part it read, resolved and inlined.
    const named = ascRewriteRisks(source, resolved.foreignSymbols, resolved.hierarchicalBlocks);
    expect(named).toEqual(["hierarchical blocks"]);
    expect(ascSaveBlockReason(named, 0, [])).toBe("Tau cannot yet preserve hierarchical blocks.");
  });

  it("still names the hierarchy after a .sim save and reopen", () => {
    // A `.sim` written from an imported `.asc` and reopened must not be the
    // step that forgets which symbols were blocks: the document is the only
    // record of it, so dropping the field would silently put the misleading
    // "symbol-library identity" reason back on the next save.
    const bodyAsy = `Version 4
SymbolType BLOCK
PIN -32 0 LEFT 8
PINATTR PinName a
PINATTR SpiceOrder 1
PIN 32 0 RIGHT 8
PINATTR PinName b
PINATTR SpiceOrder 2`;
    const bodyAsc = `Version 4
SHEET 1 100 200
FLAG 16 0 a
FLAG 16 160 b
SYMBOL res 0 -16 R0
SYMATTR InstName R1
SYMATTR Value 1k`;
    const source = `Version 4
SHEET 1 880 680
SYMBOL mydiv2 200 200 R0
SYMATTR InstName X1
`;
    const resolved = importAsc(source, {
      resolveSubcircuit: makeSubcircuitResolver((type) =>
        type.toLowerCase() === "mydiv2" ? { asy: bodyAsy, asc: bodyAsc } : null,
      ),
    });

    const saved = serializeSchematicFile("/Schematics/hier.sim", {
      components: resolved.components,
      wires: resolved.wires,
      probes: [],
      netLabels: resolved.netLabels,
      directives: resolved.directives,
      ascForeignSymbols: resolved.foreignSymbols,
      ascHierarchicalBlocks: resolved.hierarchicalBlocks,
    });
    const reopened = validateSchematicDocument(JSON.parse(saved.contents));
    expect(reopened.ascHierarchicalBlocks).toEqual(resolved.hierarchicalBlocks);

    const risks = ascRewriteRisks(source, reopened.ascForeignSymbols, reopened.ascHierarchicalBlocks);
    expect(risks).toEqual(["hierarchical blocks"]);
    expect(ascSaveBlockReason(risks, 0, [])).toBe("Tau cannot yet preserve hierarchical blocks.");
  });

  it("round-trips a foreign symbol through a .sim save/open", () => {
    // Saving an imported `.asc` as a Tau project and reopening it must not be
    // the step that loses the part: the record has to survive the JSON body,
    // not just the `.asc` writer above. WINDOW placements ride along with it.
    const imported = importAsc(`Version 4
SHEET 1 880 680
SYMBOL Optos\\PC817D 208 96 R90
WINDOW 0 24 16 Left 2
SYMATTR InstName U2
SYMATTR SpiceLine Rser=1 Cpar=2`);
    expect(imported.foreignSymbols).toHaveLength(1);

    const saved = serializeSchematicFile("/Schematics/vendor.sim", {
      components: imported.components,
      wires: imported.wires,
      probes: [],
      netLabels: imported.netLabels,
      directives: imported.directives,
      ascForeignSymbols: imported.foreignSymbols,
    });
    // A re-open runs the same validation the app uses, so the record survives.
    const reopened = validateSchematicDocument(JSON.parse(saved.contents));
    expect(reopened.ascForeignSymbols).toEqual(imported.foreignSymbols);
  });

  it("omits the ascForeignSymbols key from .sim output when a document has none", () => {
    const saved = serializeSchematicFile(
      "/Schematics/plain.sim",
      { components: [], wires: [], probes: [], netLabels: [], directives: [] },
    );
    expect(Object.prototype.hasOwnProperty.call(JSON.parse(saved.contents), "ascForeignSymbols")).toBe(false);
  });

  it("preserves positioned comments, directives, and custom sheet geometry", () => {
    const source = [
      "Version 4",
      "SHEET 1 1120 760",
      "TEXT 48 624 Left 2 !.tran 10n 4m",
      "TEXT 48 656 Left 2 ;100 kHz buck qualification",
      "",
    ].join("\n");
    const imported = importAsc(source);
    expect(ascRewriteRisks(source)).toEqual([]);

    const saved = serializeSchematicFile("/Schematics/buck.asc", {
      components: imported.components,
      wires: imported.wires,
      probes: [],
      netLabels: imported.netLabels,
      directives: imported.directives,
      textAnnotations: imported.textAnnotations,
      ascSheet: imported.sheet,
    });
    expect(saved.warnings).toEqual([]);
    expect(saved.contents).toContain("SHEET 1 1120 760");
    expect(saved.contents).toContain("TEXT 48 624 Left 2 !.tran 10n 4m");
    expect(saved.contents).toContain("TEXT 48 656 Left 2 ;100 kHz buck qualification");

    const changedSetup = serializeSchematicFile("/Schematics/buck.asc", {
      components: imported.components,
      wires: imported.wires,
      probes: [],
      netLabels: imported.netLabels,
      directives: [".tran 20n 8m"],
      textAnnotations: imported.textAnnotations,
      ascSheet: imported.sheet,
    });
    expect(changedSetup.contents).toContain("TEXT 48 624 Left 2 !.tran 20n 8m");
    expect(changedSetup.contents).not.toContain("TEXT 0 0 Left 2 !.tran");
  });

  it("keeps viewer-only probes from blocking ASC saves but still rejects skipped components", () => {
    expect(ascSaveBlockReason([], 1, [])).toBeNull();
    expect(ascSaveBlockReason([], 0, ["X1: unsupported"])).toBe("X1: unsupported");
    expect(ascSaveBlockReason([], 0, [])).toBeNull();
  });

  it("blocks a semantic save when ASC lowering would change terminal connectivity", () => {
    const saved = serializeSchematicFile("/Schematics/nonideal.asc", {
      components: [
        { id: "v1", kind: "vsource", x: 0, y: 32, rotation: 0, value: "5", label: "V1" },
        { id: "r1", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" },
        { id: "g1", kind: "ground", x: 0, y: 64, rotation: 0, value: "", label: "" },
      ],
      wires: [{ id: "lossy", points: [{ x: 0, y: 0 }, { x: 64, y: 0 }], resistance: "10m" }],
      probes: [],
      netLabels: [],
      directives: [],
    });
    expect(saved.warnings).toContain("ASC round-trip changed terminal connectivity; save was not written.");
  });

  it("round-trips every Library component through all rotations and mirrors without moving a pin", () => {
    for (const [index, entry] of CATALOG.entries()) {
      for (const rotation of [0, 90, 180, 270] as const) {
        for (const mirrored of [false, true]) {
          const component = {
            id: `catalog-${entry.kind}`,
            kind: entry.kind,
            x: 128,
            y: 128,
            rotation,
            ...(mirrored ? { mirrored: true } : {}),
            value: entry.defaultValue,
            label: entry.kind === "ground" ? "" : `${entry.prefix}${index + 1}`,
          };
          const saved = serializeSchematicFile("/Schematics/catalog.asc", {
            components: [component],
            wires: [],
            probes: [],
            netLabels: [],
            directives: [],
          });
          const context = `${entry.kind} ${mirrored ? "M" : "R"}${rotation}`;
          // A carrier notice is informational (the part reopens in Tau as
          // itself); this test guards pin geometry, so only blocking warnings
          // matter here.
          expect(saved.warnings.filter((w) => !isLossyCarrierWarning(w)), context).toEqual([]);
          const rewriteRisks = ascRewriteRisks(saved.contents);
          expect(rewriteRisks, context).toEqual([]);
          expect(ascSaveBlockReason(rewriteRisks, 0, saved.warnings), context).toBeNull();

          const reopened = importAsc(saved.contents);
          expect(reopened.components[0]?.kind, context).toBe(entry.kind);
          expect(getComponentPins(reopened.components[0]).map(({ id, x, y }) => ({ id, x, y })), context)
            .toEqual(getComponentPins(component).map(({ id, x, y }) => ({ id, x, y })));
        }
      }
    }
  });

  it("remaps open file paths when a file or containing folder moves", () => {
    expect(remapMovedProjectPath(
      "/Schematics/Analog/filter.asc",
      "/Schematics/Analog",
      "/Schematics/Archive/Analog",
    )).toBe("/Schematics/Archive/Analog/filter.asc");
    expect(remapMovedProjectPath(
      "/Schematics/filter.asc",
      "/Schematics/filter.asc",
      "/Schematics/Archive/filter.asc",
    )).toBe("/Schematics/Archive/filter.asc");
    expect(remapMovedProjectPath(
      "/Schematics/unrelated.asc",
      "/Schematics/filter.asc",
      "/Schematics/Archive/filter.asc",
    )).toBe("/Schematics/unrelated.asc");
    expect(remapMovedProjectPath(
      "/Schematics/Analog/filter.asc",
      "/Schematics/Analog/filter.asc",
      "/Schematics/filter.asc",
    )).toBe("/Schematics/filter.asc");
  });
});

describe("ascSaveBlockReason and lossy-carrier notices", () => {
  it("does not block a save on an informational carrier notice", () => {
    // Regression: the carrier notice was introduced so a colleague opening the
    // file in LTspice learns a switch became a resistor. Treating it as a block
    // would refuse to save any schematic containing a switch, subcircuit,
    // comparator, CCCS, CCVS or test point - far worse than the silent loss.
    const notice = "S1: saved as a placeholder resistor. Tau reopens it as a switch, "
      + "but in LTspice it reads as an open circuit.";
    expect(isLossyCarrierWarning(notice)).toBe(true);
    expect(ascSaveBlockReason([], 0, [notice])).toBeNull();
  });

  it("still blocks on a genuine export problem", () => {
    const real = "ASC round-trip changed terminal connectivity; save was not written.";
    expect(isLossyCarrierWarning(real)).toBe(false);
    expect(ascSaveBlockReason([], 0, [real])).toBe(real);
  });

  it("still blocks on a source rewrite risk regardless of notices", () => {
    expect(ascSaveBlockReason(["symbol label placement"], 0, [])).toContain("symbol label placement");
  });
});
