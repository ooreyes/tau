import { describe, expect, it } from "vitest";

import { importAsc } from "../io/ascImport";
import { ascRewriteRisks, ascSaveBlockReason, blankAscText, serializeSchematicFile } from "./types";

const ASC_SOURCE = `Version 4
SHEET 1 880 680
WIRE 80 96 224 96
FLAG 80 96 input
SYMBOL res 160 80 R90
SYMATTR InstName R1
SYMATTR Value 1k
TEXT 0 0 Left 2 !.tran 1m
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

  it("blocks rewrites when the source contains records Tau cannot preserve", () => {
    expect(ascRewriteRisks(ASC_SOURCE)).toEqual([]);

    const vendorSource = `${ASC_SOURCE}WINDOW 0 24 56 Left 2\nLINE Normal 0 0 16 16\n`;
    expect(ascRewriteRisks(vendorSource)).toEqual(expect.arrayContaining([
      "drawing primitives",
      "symbol label placement",
    ]));

    expect(ascRewriteRisks(ASC_SOURCE.replace("TEXT 0 0", "TEXT 64 160"))).toContain(
      "directive annotation placement",
    );

    const vendorOpAmp = `Version 4\nSHEET 1 880 680\nSYMBOL Opamps\\LT1001 80 80 R0\nSYMATTR InstName U1\nSYMATTR SpiceLine Avol=1Meg\n`;
    expect(ascRewriteRisks(vendorOpAmp)).toEqual(expect.arrayContaining([
      "symbol-library identity",
      "extended symbol attributes",
    ]));
  });

  it("blocks an ASC save before probes or skipped components can be discarded", () => {
    expect(ascSaveBlockReason([], 1, [])).toBe(".asc cannot preserve Tau probe dots yet.");
    expect(ascSaveBlockReason([], 0, ["X1: unsupported"])).toBe("X1: unsupported");
    expect(ascSaveBlockReason([], 0, [])).toBeNull();
  });
});
