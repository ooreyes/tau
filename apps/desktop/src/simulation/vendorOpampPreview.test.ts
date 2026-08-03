import { describe, expect, it } from "vitest";
import type { SchematicComponent } from "../schematic/types";
import { runOperatingPoint } from "./operatingPoint";
import { runAcSweep } from "./acSweep";
import { runNoiseAnalysis } from "./noise";

const vendor: SchematicComponent = {
  id: "u1",
  kind: "opamp",
  label: "U1",
  value: "LT1001",
  ltSymbolType: "Opamps\\LT1001",
  x: 0,
  y: 0,
  rotation: 0,
};
const schematic = { components: [vendor], wires: [] };

describe("named vendor op-amp preview integrity", () => {
  it("refuses OP, AC, and noise instead of applying the ideal op-amp stamp", () => {
    const results = [
      runOperatingPoint(schematic),
      runAcSweep(schematic, { startHz: 1, stopHz: 1_000, pointsPerDecade: 10 }),
      runNoiseAnalysis(schematic, {
        output: { pos: "out" },
        source: "V1",
        sweep: { startHz: 1, stopHz: 1_000, pointsPerDecade: 10 },
      }),
    ];
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toMatch(/named vendor op-amp model/i);
        expect(result.message).toMatch(/will not substitute/i);
      }
    }
  });
});
