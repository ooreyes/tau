/**
 * Class-D DoD hinge: unmodified `class-d-starter.asc` only simulates when its
 * sibling `deadtime` hierarchical block is resolvable. Without siblings, X1
 * must stay foreign and Run must refuse — never a half-bridge without gate
 * drive. With siblings, UniversalOpAmp2 must emit the rail-clamped PWM model.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildSpiceDeck } from "../engine/spiceNetlist";
import { buildParamScope } from "../simulation/paramScope";
import { simulationBlockReason } from "../simulation/simulationIntegrity";
import { decodeSchematicText, importAsc, makeSubcircuitResolver } from "./ascImport";

const EXAMPLE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "examples", "class-d-amplifier");
const ASC_PATH = join(EXAMPLE_DIR, "class-d-starter.asc");

describe("class-d_starter hierarchical deadtime + PWM comparator", () => {
  it("refuses Run when deadtime siblings are absent", () => {
    expect(existsSync(ASC_PATH)).toBe(true);
    const imported = importAsc(decodeSchematicText(readFileSync(ASC_PATH)));
    expect(imported.warnings.some((warning) => /deadtime/i.test(warning))).toBe(true);
    expect(imported.foreignSymbols.some((symbol) => /deadtime/i.test(symbol.type))).toBe(true);
    expect(simulationBlockReason(imported.components, imported.foreignSymbols)).toMatch(
      /Simulation refused:.*deadtime/i,
    );
  });

  it("inlines deadtime and emits a rail-clamped UniversalOpAmp2 PWM source when siblings resolve", () => {
    const resolve = makeSubcircuitResolver((symbolType) => {
      const read = (extension: ".asy" | ".asc") => {
        const path = join(EXAMPLE_DIR, `${symbolType}${extension}`);
        return existsSync(path) ? decodeSchematicText(readFileSync(path)) : undefined;
      };
      const asy = read(".asy");
      const asc = read(".asc");
      return asy || asc ? { asy, asc } : null;
    });
    const imported = importAsc(decodeSchematicText(readFileSync(ASC_PATH)), { resolveSubcircuit: resolve });
    expect(imported.warnings).toEqual([]);
    expect(imported.foreignSymbols).toEqual([]);
    expect(simulationBlockReason(imported.components, imported.foreignSymbols)).toBeNull();
    expect(imported.components.some((component) => component.label === "X1.U1")).toBe(true);
    const u1 = imported.components.find((component) => component.label === "U1");
    expect(u1?.kind).toBe("opamp");
    expect(u1?.value).toMatch(/Avol=1Meg/i);

    const deck = buildSpiceDeck({
      components: imported.components,
      wires: imported.wires,
      netLabels: imported.netLabels,
      directives: imported.directives,
      params: buildParamScope(imported.directives),
    }, { kind: "tran", stopTime: 3e-3, steps: 3000 });
    expect(deck.unresolvedSubckts).toEqual([]);
    expect(deck.netlist).toMatch(
      /^B_U1\s+\S+\s+0\s+V=\(V\(vcc\)\+V\(vee\)\)\/2\+\(V\(vcc\)-V\(vee\)\)\/2\*tanh\(/m,
    );
    expect(deck.netlist).toMatch(/\.model RSR015P06 VDMOS/i);
    expect(deck.netlist).toMatch(/\.model QS6K1 VDMOS/i);
  });
});
