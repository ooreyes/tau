import { describe, expect, it } from "vitest";
import type { SchematicComponent } from "../schematic/types";
import { runOperatingPoint } from "./operatingPoint";
import { runTransientAnalysis } from "./linearTransient";
import { runAcSweep } from "./acSweep";
import { runNoiseAnalysis } from "./noise";

const components: SchematicComponent[] = [
  {
    id: "w1", kind: "switch", label: "W1", value: "Vsense MYSW", x: 0, y: 0, rotation: 0,
    ltSymbolType: "csw",
    pinOverride: [
      { id: "a", label: "+", x: 0, y: 0 },
      { id: "b", label: "-", x: 0, y: 80 },
    ],
  },
  { id: "g", kind: "ground", label: "", value: "", x: 0, y: 80, rotation: 0 },
];

const expected = /W1.*current-controlled switch.*native ngspice engine.*will not approximate/i;

describe("current-controlled switch preview integrity", () => {
  it("refuses OP instead of stamping csw as a static switch", () => {
    const result = runOperatingPoint({ components, wires: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(expected);
  });

  it("refuses transient instead of stamping csw as a static switch", async () => {
    const result = await runTransientAnalysis({ components, wires: [] }, { stopTime: 1e-3, steps: 16 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(expected);
  });

  it("refuses AC instead of stamping csw as a static switch", () => {
    const result = runAcSweep({ components, wires: [] }, { startHz: 1, stopHz: 1e3, pointsPerDecade: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(expected);
  });

  it("refuses noise instead of stamping csw as a static switch", () => {
    const result = runNoiseAnalysis(
      { components, wires: [] },
      { output: { pos: "out" }, source: "Vsense", sweep: { startHz: 1, stopHz: 1e3, pointsPerDecade: 10 } },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(expected);
  });
});
