import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPAMP_AVOL,
  DEFAULT_OPAMP_VMAX,
  DEFAULT_OPAMP_VMIN,
  boundedOpampLine,
  parseOpampAvol,
  parseOpampOutputLimits,
  railClampedOpampLine,
} from "./opampSpec";

describe("parseOpampAvol", () => {
  it("reads Avol with an SI suffix from the UniversalOpamp2 spec", () => {
    // class-d_starter.asc: SYMATTR Value2 Avol=1Meg GBW=10Gig Slew=10Gig
    expect(parseOpampAvol("Avol=1Meg GBW=10Gig Slew=10Gig")).toBe(1e6);
  });

  it("is case-insensitive and accepts comma separators and spaces around =", () => {
    expect(parseOpampAvol("gbw=10Meg,AVOL = 2k")).toBe(2000);
  });

  it("does not read the Avol= substring of another key", () => {
    // A hypothetical `xavol=` token must not match.
    expect(parseOpampAvol("xavol=5")).toBe(DEFAULT_OPAMP_AVOL);
  });

  it("falls back to 1e6 when missing, unparseable, non-positive, or empty", () => {
    expect(parseOpampAvol("")).toBe(DEFAULT_OPAMP_AVOL);
    expect(parseOpampAvol("Ideal")).toBe(DEFAULT_OPAMP_AVOL);
    expect(parseOpampAvol("Avol=banana")).toBe(DEFAULT_OPAMP_AVOL);
    expect(parseOpampAvol("Avol=0")).toBe(DEFAULT_OPAMP_AVOL);
    expect(parseOpampAvol("Avol=-3k")).toBe(DEFAULT_OPAMP_AVOL);
  });
});

describe("generic op-amp defaults", () => {
  it("keeps the bounded generic model defaults explicit and finite", () => {
    expect(parseOpampAvol("ideal")).toBe(DEFAULT_OPAMP_AVOL);
    expect(parseOpampOutputLimits("ideal")).toEqual({ min: DEFAULT_OPAMP_VMIN, max: DEFAULT_OPAMP_VMAX });
    expect(boundedOpampLine("B_U1", "out", "vp", "vn", DEFAULT_OPAMP_AVOL, DEFAULT_OPAMP_VMIN, DEFAULT_OPAMP_VMAX))
      .toContain("0+15*tanh(1000000");
  });

  it("keeps legacy output-limit aliases readable", () => {
    expect(parseOpampOutputLimits("Min=-5 Max=5")).toEqual({ min: -5, max: 5 });
    expect(parseOpampOutputLimits("Vlo=-3 Vhi=4")).toEqual({ min: -3, max: 4 });
  });
});

describe("railClampedOpampLine", () => {
  it("builds the smooth tanh clamp centered between the supply nets", () => {
    expect(railClampedOpampLine("B_U1", "vo", "vp", "vn", "vcc", "vee", 1e6)).toBe(
      "B_U1 vo 0 V=(V(vcc)+V(vee))/2+(V(vcc)-V(vee))/2*tanh(1000000*(V(vp)-V(vn))/max(abs((V(vcc)-V(vee))/2),0.5))",
    );
  });

  it("works with the ground net as the negative rail (single supply)", () => {
    expect(railClampedOpampLine("B_U2", "out", "a", "b", "vdd", "0", 2000)).toBe(
      "B_U2 out 0 V=(V(vdd)+V(0))/2+(V(vdd)-V(0))/2*tanh(2000*(V(a)-V(b))/max(abs((V(vdd)-V(0))/2),0.5))",
    );
  });
});
