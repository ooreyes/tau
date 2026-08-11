import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildSpiceDeck } from "../engine/spiceNetlist";
import { importAsc } from "../io/ascImport";
import { runOperatingPoint } from "./operatingPoint";

const FIXTURE_ROOT = path.resolve(process.cwd(), "..", "..", "fixtures", "ui-ux", "seven-segment");
const FIXTURES = [
  ...Array.from({ length: 10 }, (_, digit) => `digit-${digit}.asc`),
  "live.asc",
  "stopped.asc",
];

describe("committed seven-segment packaged acceptance fixtures", () => {
  it.each(FIXTURES)("imports, builds, and previews %s", (filename) => {
    const text = fs.readFileSync(path.join(FIXTURE_ROOT, filename), "utf8");
    const imported = importAsc(text);
    const schematic = {
      components: imported.components,
      wires: imported.wires,
      netLabels: imported.netLabels,
      directives: imported.directives,
    };
    const deck = buildSpiceDeck(schematic, { kind: "tran", stopTime: 0.01, steps: 10 });
    const preview = runOperatingPoint(schematic);

    expect(imported.components.some((component) => component.kind === "sevenSeg")).toBe(true);
    expect(deck.netlist.match(/D_u1_/g)).toHaveLength(8);
    expect(deck.netlist.match(/R_u1_/g)).toHaveLength(8);
    expect(deck.netlist).toContain(" 220");
    expect(deck.netlist).not.toContain("1G");
    expect(preview.ok).toBe(true);
  });
});
