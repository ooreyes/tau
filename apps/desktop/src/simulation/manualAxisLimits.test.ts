import { describe, expect, it } from "vitest";
import { applyManualYToDomain, parseManualYLimits } from "./manualAxisLimits";

describe("parseManualYLimits", () => {
  it("parses a dB pair and swaps inverted order", () => {
    const ok = parseManualYLimits("20", "-40");
    expect(ok).toEqual({ ok: true, limits: { yMin: -40, yMax: 20 } });
  });

  it("refuses non-finite and equal limits", () => {
    expect(parseManualYLimits("1", "x").ok).toBe(false);
    expect(parseManualYLimits("5", "5").ok).toBe(false);
  });

  it("treats an empty edge as autorange rather than as an error", () => {
    // "Pin the top, let the bottom follow the data" is an ordinary thing to
    // want on a scope. The old all-or-nothing pair answered it with
    // "Enter both Y min and Y max", an error the form invented for itself.
    expect(parseManualYLimits("", "10")).toEqual({ ok: true, limits: { yMin: undefined, yMax: 10 } });
    expect(parseManualYLimits("-5", "")).toEqual({ ok: true, limits: { yMin: -5, yMax: undefined } });
    expect(parseManualYLimits("", "")).toEqual({ ok: true, limits: null });
  });

  it("autoranges the edge that was left empty", () => {
    const auto = { yMin: -80, yMax: 0 };
    expect(applyManualYToDomain(auto, { yMax: 10 })).toEqual({ yMin: -80, yMax: 10 });
    expect(applyManualYToDomain(auto, { yMin: -40 })).toEqual({ yMin: -40, yMax: 0 });
  });

  it("keeps the axis ascending when a pinned edge crosses the data", () => {
    // Pinning a max below the autoranged min would invert the axis; falling
    // back to auto keeps the plot drawable instead of drawing it upside down.
    const auto = { yMin: 0, yMax: 100 };
    expect(applyManualYToDomain(auto, { yMax: -20 })).toEqual(auto);
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
