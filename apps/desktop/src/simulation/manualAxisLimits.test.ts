import { describe, expect, it } from "vitest";
import { applyManualYToDomain, parseManualYLimits } from "./manualAxisLimits";

describe("parseManualYLimits", () => {
  it("parses a dB pair and swaps inverted order", () => {
    const ok = parseManualYLimits("20", "-40");
    expect(ok).toEqual({ ok: true, limits: { yMin: -40, yMax: 20 } });
  });

  it("refuses blank, non-finite, and equal limits", () => {
    expect(parseManualYLimits("", "10").ok).toBe(false);
    expect(parseManualYLimits("1", "x").ok).toBe(false);
    expect(parseManualYLimits("5", "5").ok).toBe(false);
  });
});

describe("applyManualYToDomain", () => {
  it("keeps auto when manual is null and overlays when set", () => {
    const auto = { xMin: 1, xMax: 1e6, yMin: -80, yMax: 0 };
    expect(applyManualYToDomain(auto, null)).toEqual(auto);
    expect(applyManualYToDomain(auto, { yMin: -40, yMax: 10 })).toEqual({
      xMin: 1,
      xMax: 1e6,
      yMin: -40,
      yMax: 10,
    });
  });
});
