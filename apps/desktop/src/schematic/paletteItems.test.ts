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

  it("gives the Sheet block row a subtitle through the preset-less path", () => {
    const [sheetBlock, ...extra] = expandCatalogEntry(CATALOG_BY_KIND.subckt);
    expect(extra).toEqual([]);
    expect(sheetBlock.name).toBe("Sheet block");
    // The subtitle is the point of the row: the part points at another sheet.
    // It only reaches the rail because the preset-less branch carries `desc`.
    expect(sheetBlock.desc).toBe("another sheet");
    // Placed unbound — never pre-bound to a bundled library subcircuit.
    expect(sheetBlock.value).toBe("");
  });

  it("still finds the Sheet block row by the SPICE words its name dropped", () => {
    const isSheetBlock = (item: { kind: string }) => item.kind === "subckt";
    expect(matchPaletteItems("sheet block").some(isSheetBlock)).toBe(true);
    expect(matchPaletteItems("another sheet").some(isSheetBlock)).toBe(true);
    // An engineer who wants a plain X instance against a bundled or
    // document-defined .subckt types the jargon; `kind` only spells "subckt".
    expect(matchPaletteItems("subcircuit").some(isSheetBlock)).toBe(true);
    expect(matchPaletteItems("subckt").some(isSheetBlock)).toBe(true);
    expect(matchPaletteItems("hierarch").some(isSheetBlock)).toBe(true);
  });

  it("spells the sheet feature with the two agreed nouns and nothing else", () => {
    // Six names for one feature is how it became unfindable. Anything a user can
    // read says "Sheet block" (the instance) or "Sheet interface" (the ports).
    const retired = [/subcircuit\s*\(x\)/i, /project sheet link/i, /project model/i, /child sheet interface/i];
    for (const item of allPaletteItems()) {
      for (const pattern of retired) {
        expect(pattern.test(item.name), `${item.id} name`).toBe(false);
        expect(pattern.test(item.desc ?? ""), `${item.id} desc`).toBe(false);
      }
    }
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
