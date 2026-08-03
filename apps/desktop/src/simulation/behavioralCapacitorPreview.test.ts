import { describe, expect, it } from "vitest";
import type { SchematicComponent } from "../schematic/types";
import { runOperatingPoint } from "./operatingPoint";
import { runTransientAnalysis } from "./linearTransient";
import { runAcSweep } from "./acSweep";
import { runNoiseAnalysis } from "./noise";

const components: SchematicComponent[] = [
  { id: "c1", kind: "capacitor", label: "C1", value: "Q={Cbase*x}", x: 0, y: 0, rotation: 0 },
  { id: "g", kind: "ground", label: "", value: "", x: 32, y: 0, rotation: 0 },
];

const expected = /C1.*Q=<charge expression>.*native ngspice engine.*will not replace.*constant capacitance/i;

describe("charge-defined capacitor preview integrity", () => {
  it("refuses OP before strict brace resolution can misclassify Q=", () => {
    const result = runOperatingPoint({ components, wires: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(expected);
  });

  it("refuses transient before trying to parse Q= as a constant C", async () => {
    const result = await runTransientAnalysis({ components, wires: [] }, { stopTime: 1e-3, steps: 16 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(expected);
  });

  it("refuses AC before trying to parse Q= as a constant C", () => {
    const result = runAcSweep({ components, wires: [] }, { startHz: 1, stopHz: 1e3, pointsPerDecade: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(expected);
  });

  it("refuses noise before trying to parse Q= as a constant C", () => {
    const result = runNoiseAnalysis(
      { components, wires: [] },
      { output: { pos: "out" }, source: "V1", sweep: { startHz: 1, stopHz: 1e3, pointsPerDecade: 10 } },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(expected);
  });
});
