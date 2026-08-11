import { describe, expect, it } from "vitest";

import {
  normalizeSevenSegmentPolarity,
  sevenSegmentBranchCompanion,
  sevenSegmentJunctionVoltage,
} from "./sevenSegmentSpec";

describe("shared seven-segment polarity/electrical spec", () => {
  it.each([
    ["anode", "anode"],
    ["common anode", "anode"],
    ["polarity=anode", "anode"],
    ["cathode", "cathode"],
    ["common cathode", "cathode"],
    ["auto", "cathode"],
    ["", "cathode"],
  ] as const)("normalizes %s to %s", (raw, expected) => {
    expect(normalizeSevenSegmentPolarity(raw)).toBe(expected);
  });

  it("uses the same signed junction direction for both layers", () => {
    expect(sevenSegmentJunctionVoltage(5, 0, "anode")).toBe(-5);
    expect(sevenSegmentJunctionVoltage(0, 5, "anode")).toBe(5);
    expect(sevenSegmentJunctionVoltage(5, 0, "cathode")).toBe(5);
    expect(sevenSegmentJunctionVoltage(5, 0, "auto")).toBe(5);
  });

  it("has finite forward loading and negligible reverse loading", () => {
    const forward = sevenSegmentBranchCompanion(5);
    expect(forward.conductance).toBeCloseTo(1 / 220, 12);
    expect(forward.current).toBeCloseTo(3 / 220, 12);

    const reverse = sevenSegmentBranchCompanion(-5);
    expect(reverse.current).toBe(0);
    expect(reverse.conductance).toBeLessThan(1e-9);
  });
});
