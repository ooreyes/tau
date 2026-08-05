import { describe, expect, it } from "vitest";
import { digitalGateDeckLines, parseDigitalGate } from "../engine/digitalGateSpec";
import {
  allPaletteItems,
  expandCatalogEntry,
  matchPaletteItems,
  paletteItemsForSection,
} from "./paletteItems";
import { CATALOG_BY_KIND } from "./catalog";
describe("EveryCircuit palette presets", () => {
  it("expands Logic Gate into AND/OR/NOT/NAND/NOR/XOR/XNOR", () => {
    const gates = expandCatalogEntry(CATALOG_BY_KIND.digitalGate);
    expect(gates.map((g) => g.name)).toEqual([
      "AND", "OR", "NOT", "NAND", "NOR", "XOR", "XNOR",
    ]);
    expect(gates.map((g) => g.value)).toEqual([
      "and", "or", "not", "nand", "nor", "xor", "xnor",
    ]);
  });

  it("expands Push Button into NO and NC variants", () => {
    const buttons = expandCatalogEntry(CATALOG_BY_KIND.pushButton);
    expect(buttons.map((b) => b.name)).toEqual([
      "Push Button NO",
      "Push Button NC",
    ]);
    expect(buttons.map((b) => b.value)).toEqual(["open", "closed"]);
  });

  it("keeps Digital section searchable by gate name", () => {
    expect(matchPaletteItems("nand").some((i) => i.value === "nand")).toBe(true);
    expect(matchPaletteItems("xnor").some((i) => i.value === "xnor")).toBe(true);
    expect(matchPaletteItems("push button nc").some((i) => i.value === "closed")).toBe(true);
    expect(paletteItemsForSection("Digital").length).toBeGreaterThan(
      expandCatalogEntry(CATALOG_BY_KIND.digitalGate).length,
    );
    expect(allPaletteItems().length).toBeGreaterThan(CATALOG_BY_KIND.digitalGate ? 40 : 0);
  });

  it("emits NAND with inverted primary Q levels", () => {
    const spec = parseDigitalGate("nand");
    expect(spec.fn).toBe("and");
    expect(spec.invertOut).toBe(true);
    const lines = digitalGateDeckLines("A1", { ins: ["a", "b"], q: "y" }, spec);
    // NAND: q drives inverted (0 when AND would be 1).
    expect(lines.some((l) => /B_A1_Q .+V=\(.+\) \? 0 : 1/.test(l))).toBe(true);
  });
});
