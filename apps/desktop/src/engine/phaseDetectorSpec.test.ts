import { describe, expect, it } from "vitest";
import { parsePhaseDetector, phaseDetectorDeckLines } from "./phaseDetectorSpec";

describe("LTspice PHASEDET", () => {
  it("parses charge-pump and logic-level parameters", () => {
    expect(parsePhaseDetector("phidet Iout=15u Vhigh=2.5 Vlow=-.5 Ref=0")).toEqual({
      iout: 15e-6,
      vhigh: 2.5,
      vlow: -0.5,
      ref: 0,
    });
  });

  it("emits an edge-triggered two-DFF PFD and current pump", () => {
    const lines = phaseDetectorDeckLines("A5", { a: "a", b: "b", q: "q", com: "0" }, parsePhaseDetector("Iout=15u Ref=0"));
    expect(lines.some((line) => line.includes("d_dff"))).toBe(true);
    expect(lines.some((line) => line.includes("d_and"))).toBe(true);
    expect(lines[lines.length - 1]).toBe("B_A5_PUMP q 0 I=0.000015*(V(a5_adown)-V(a5_aup))");
  });
});
