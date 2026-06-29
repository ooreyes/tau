import { describe, it, expect } from "vitest";
import { buildReferenceOverlay } from "./rawOverlay";
import type { RawData } from "../io/rawImport";

const COLORS = ["red", "green"];

function makeRaw(vars: { name: string }[], values: number[][]): RawData {
  return {
    title: "t",
    date: "",
    plotname: "Transient Analysis",
    flags: ["real"],
    complex: false,
    variables: vars.map((v, i) => ({ index: i, name: v.name, type: i === 0 ? "time" : "voltage" })),
    pointCount: values[0].length,
    values,
  };
}

describe("buildReferenceOverlay", () => {
  it("resamples a matching reference onto the Tau grid and compares it", () => {
    // Reference V(out) = 2t on its own coarse grid.
    const raw = makeRaw(
      [{ name: "time" }, { name: "V(out)" }],
      [[0, 1], [0, 2]],
    );
    const times = [0, 0.5, 1];
    const tau = [{ label: "V(out)", values: [0, 1, 2] }]; // identical signal
    const overlay = buildReferenceOverlay(raw, times, tau, COLORS);

    expect(overlay.traces).toHaveLength(1);
    expect(overlay.traces[0].label).toBe("V(out) (ref)");
    expect(overlay.traces[0].values).toEqual([0, 1, 2]); // resampled to the grid
    expect(overlay.comparisons).toHaveLength(1);
    expect(overlay.comparisons[0].normalizedRms).toBeCloseTo(0, 9);
    expect(overlay.comparisons[0].pass).toBe(true);
    expect(overlay.unmatched).toEqual([]);
  });

  it("flags a reference that disagrees with Tau", () => {
    const raw = makeRaw([{ name: "time" }, { name: "V(o)" }], [[0, 1], [0, 10]]);
    const tau = [{ label: "V(o)", values: [0, 0, 0] }]; // Tau says flat 0
    const overlay = buildReferenceOverlay(raw, [0, 0.5, 1], tau, COLORS);
    expect(overlay.comparisons[0].pass).toBe(false);
    expect(overlay.comparisons[0].maxAbsError).toBeCloseTo(10);
  });

  it("matches names case/space-insensitively and lists unmatched vars", () => {
    const raw = makeRaw(
      [{ name: "time" }, { name: "V(OUT)" }, { name: "V(n005)" }],
      [[0, 1], [0, 2], [3, 3]],
    );
    const tau = [{ label: "v(out)", values: [0, 1, 2] }];
    const overlay = buildReferenceOverlay(raw, [0, 0.5, 1], tau, COLORS);
    expect(overlay.traces.map((t) => t.label)).toEqual(["V(OUT) (ref)"]);
    expect(overlay.unmatched).toEqual(["V(n005)"]);
  });

  it("skips the axis variable and assigns colors in order", () => {
    const raw = makeRaw(
      [{ name: "time" }, { name: "V(a)" }, { name: "V(b)" }],
      [[0, 1], [0, 1], [0, 2]],
    );
    const tau = [
      { label: "V(a)", values: [0, 1] },
      { label: "V(b)", values: [0, 2] },
    ];
    const overlay = buildReferenceOverlay(raw, [0, 1], tau, COLORS);
    expect(overlay.traces.map((t) => t.color)).toEqual(["red", "green"]);
  });
});
