import { describe, it, expect } from "vitest";
import { stabilityMargins, firstCrossing } from "./stability";

describe("firstCrossing", () => {
  it("interpolates a linear crossing", () => {
    // y goes 2 → -2 over x 0 → 1; crosses 0 at x = 0.5
    expect(firstCrossing([0, 1], [2, -2], 0)).toBeCloseTo(0.5, 12);
  });

  it("returns an exact-hit sample", () => {
    expect(firstCrossing([0, 1, 2], [1, 0, -1], 0)).toBe(1);
  });

  it("returns null when never crossing", () => {
    expect(firstCrossing([0, 1, 2], [3, 4, 5], 0)).toBeNull();
  });

  it("finds a non-zero target", () => {
    expect(firstCrossing([10, 20], [0, 10], 6)).toBeCloseTo(16, 12);
  });
});

describe("stabilityMargins", () => {
  it("phase margin = 180 + phase at the 0 dB crossover", () => {
    // magDb: 6 → -6 across f 100→1000 (0 dB at the geometric-ish midpoint);
    // phase: -120 → -160. At the interpolated 0 dB point (t=0.5 in dB space)
    // phase = -140, so PM = 180 - 140 = 40°.
    const m = stabilityMargins([100, 1000], [6, -6], [-120, -160]);
    expect(m.phaseMarginDeg).toBeCloseTo(40, 6);
    expect(m.gainCrossoverHz).toBeGreaterThan(100);
    expect(m.gainCrossoverHz).toBeLessThan(1000);
  });

  it("gain margin = -gain at the -180 phase crossover", () => {
    // phase: -170 → -190 across f 1000→2000, crosses -180 at t=0.5;
    // magDb there interpolates -10 → -30 → -20, so GM = +20 dB.
    const m = stabilityMargins([1000, 2000], [-10, -30], [-170, -190]);
    expect(m.gainMarginDb).toBeCloseTo(20, 6);
    expect(m.phaseCrossoverHz).toBeGreaterThan(1000);
  });

  it("returns null margins when there is no crossover", () => {
    // Gain stays above 0 dB (no unity crossover) and phase never reaches -180.
    const m = stabilityMargins([1, 10, 100], [40, 30, 20], [-10, -20, -30]);
    expect(m.phaseMarginDeg).toBeNull();
    expect(m.gainCrossoverHz).toBeNull();
    expect(m.gainMarginDb).toBeNull();
    expect(m.phaseCrossoverHz).toBeNull();
  });

  it("negative phase margin flags an unstable loop", () => {
    // At 0 dB the phase is -200°, so PM = 180 - 200 = -20° (unstable).
    const m = stabilityMargins([100, 1000], [6, -6], [-190, -210]);
    expect(m.phaseMarginDeg).toBeCloseTo(-20, 6);
  });

  it("handles too-short input", () => {
    const m = stabilityMargins([1], [0], [0]);
    expect(m.phaseMarginDeg).toBeNull();
    expect(m.gainMarginDb).toBeNull();
  });

  it("interpolates the crossover frequency in log space", () => {
    // 0 dB crossing exactly halfway (in dB) between decade endpoints 100 and
    // 1000 → geometric mean ≈ 316.2 Hz, not the arithmetic 550.
    const m = stabilityMargins([100, 1000], [6, -6], [-90, -90]);
    expect(m.gainCrossoverHz).toBeCloseTo(Math.sqrt(100 * 1000), 1);
  });
});
