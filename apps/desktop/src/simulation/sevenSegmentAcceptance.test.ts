import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildSpiceDeck } from "../engine/spiceNetlist";
import { importAsc } from "../io/ascImport";
import { extractCircuit } from "../schematic/netlist";
import {
  deriveSevenSegmentDisplayState,
  SEVEN_SEGMENT_DIGIT_PATTERNS,
  type SevenSegmentSegment,
} from "../components/simulator/SevenSegmentDisplay";
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

  it.each(Array.from({ length: 10 }, (_, digit) => digit))(
    "decodes digit-%s.asc as the authored decimal digit",
    (digit) => {
      const text = fs.readFileSync(path.join(FIXTURE_ROOT, `digit-${digit}.asc`), "utf8");
      const imported = importAsc(text);
      const schematic = {
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        directives: imported.directives,
      };
      const preview = runOperatingPoint(schematic);
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      const circuit = extractCircuit(imported.components, imported.wires, imported.netLabels);
      const entry = circuit.components.find(({ component }) => component.kind === "sevenSeg");
      expect(entry).toBeDefined();
      if (!entry) return;
      const voltageByPin = Object.fromEntries(
        (Object.entries(entry.pins) as Array<[SevenSegmentSegment | "com", string]>).map(([pin, netId]) => [
          pin,
          preview.nets.find((net) => net.id === netId)?.voltage ?? Number.NaN,
        ]),
      );
      const state = deriveSevenSegmentDisplayState(
        voltageByPin,
        voltageByPin.com,
      );
      expect(state.digit).toBe(digit);
      expect(new Set(state.activeSegments)).toEqual(new Set(SEVEN_SEGMENT_DIGIT_PATTERNS[digit]));
    },
  );
});
