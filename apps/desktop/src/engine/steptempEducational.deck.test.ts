import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { decodeSchematicText, importAsc } from "../io/ascImport";
import { buildSpiceDeck } from "./spiceNetlist";
import { buildParamScope } from "../simulation/paramScope";

const STEPTTEMP = join(homedir(), "Documents/LTspice/examples/Educational/steptemp.asc");

describe.skipIf(!existsSync(STEPTTEMP))("Educational steptemp deck", () => {
  it("builds .op with bundled 2N2219A / 2N3904 (no unresolved models)", () => {
    const doc = importAsc(decodeSchematicText(readFileSync(STEPTTEMP)));
    expect(doc.foreignSymbols).toEqual([]);
    const deck = buildSpiceDeck({
      components: doc.components,
      wires: doc.wires,
      netLabels: doc.netLabels,
      params: buildParamScope(doc.directives),
      directives: doc.directives,
    }, { kind: "op" });
    expect(deck.unresolvedSubckts).toEqual([]);
    expect(deck.netlist).toMatch(/2N2219A/i);
    expect(deck.netlist).toMatch(/\.model\s+2N2219A/i);
    expect(deck.netlist).toMatch(/\.model\s+2N3904/i);
  });
});
