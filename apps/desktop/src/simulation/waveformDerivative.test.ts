import { describe, expect, it } from "vitest";
import { ddtSeries, peelOuterDdt } from "./waveformDerivative";

describe("peelOuterDdt", () => {
  it("peels nested whole-expr ddt wrappers; leaves compounds alone", () => {
    expect(peelOuterDdt("ddt(V(out))")).toEqual({ inner: "V(out)", layers: 1 });
    expect(peelOuterDdt("ddt(ddt(V(a)-V(b)))")).toEqual({
      inner: "V(a)-V(b)",
      layers: 2,
    });
    expect(peelOuterDdt("  DDT( abs(V(out)) )  ")).toEqual({
      inner: "abs(V(out))",
      layers: 1,
    });
    expect(peelOuterDdt("ddt(V(out))+1")).toEqual({
      inner: "ddt(V(out))+1",
      layers: 0,
    });
    expect(peelOuterDdt("V(out)")).toEqual({ inner: "V(out)", layers: 0 });
  });
});

describe("ddtSeries", () => {
  it("central-differences a unit ramp to slope 1", () => {
    const times = [0, 1, 2, 3];
    const values = [0, 1, 2, 3];
    expect(ddtSeries(times, values)).toEqual([1, 1, 1, 1]);
  });

  it("one-sided ends on a quadratic sample", () => {
    // v = t² at t=0,1,2 → ends: (1-0)/1=1 and (4-1)/1=3; center: (4-0)/2=2
    expect(ddtSeries([0, 1, 2], [0, 1, 4])).toEqual([1, 2, 3]);
  });
});
