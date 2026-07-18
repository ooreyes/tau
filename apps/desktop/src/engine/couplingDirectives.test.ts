import { describe, it, expect } from "vitest";
import { couplingLinesFromDirectives } from "./couplingDirectives";
import { buildParamScope } from "../simulation/paramScope";

describe("couplingLinesFromDirectives", () => {
  it("passes a basic two-winding K coupling through verbatim", () => {
    expect(couplingLinesFromDirectives(["K Lp Ls 1"])).toEqual(["K Lp Ls 1"]);
    expect(couplingLinesFromDirectives(["K1 L1 L2 1"])).toEqual(["K1 L1 L2 1"]);
    expect(couplingLinesFromDirectives(["K3 L1 L2 .95"])).toEqual(["K3 L1 L2 .95"]);
  });

  it("handles the all-windings multi-inductor form (Royer.asc)", () => {
    expect(couplingLinesFromDirectives(["K1 L1 L2 L3 L4 1"])).toEqual(["K1 L1 L2 L3 L4 1"]);
  });

  it("resolves a parameterized {coeff} against the param scope (varactor.asc)", () => {
    const params = buildParamScope([".param Kcup=.08"]);
    expect(couplingLinesFromDirectives(["Kcup1 L2 L3  {Kcup}"], params)).toEqual(["Kcup1 L2 L3 0.08"]);
  });

  it("collapses double spaces and trims", () => {
    expect(couplingLinesFromDirectives(["K1   L1  L2   0.9"])).toEqual(["K1 L1 L2 0.9"]);
  });

  it("splits a multi-line TEXT block on the \\n escape (two K lines)", () => {
    expect(couplingLinesFromDirectives(["K3 L1 L2 .95\\nK4 L3 L4 .95"])).toEqual([
      "K3 L1 L2 .95",
      "K4 L3 L4 .95",
    ]);
  });

  it("rewrites inductor references through the rename map (Electrometer)", () => {
    // Inductors labelled T2a/T2b/T2c are renamed (an ngspice inductor must start
    // with L); the K refs must follow. The coefficient and unknown names are kept.
    const names = new Map([["t2a", "L14"], ["t2b", "L15"], ["t2c", "L16"]]);
    expect(couplingLinesFromDirectives(["K2 T2a T2b T2c 1."], undefined, names)).toEqual(["K2 L14 L15 L16 1."]);
    // Case-insensitive; tokens not in the map (already valid) pass through.
    expect(couplingLinesFromDirectives(["K1 t2a L9 0.9"], undefined, names)).toEqual(["K1 L14 L9 0.9"]);
    // No map → verbatim (back-compat).
    expect(couplingLinesFromDirectives(["K2 T2a T2b 1"])).toEqual(["K2 T2a T2b 1"]);
  });

  it("ignores non-coupling directives (.param/.model/.tran)", () => {
    expect(
      couplingLinesFromDirectives([".param Kcup=.08", ".model D1 D", ".tran 1m", "Kfoo La Lb 1"]),
    ).toEqual(["Kfoo La Lb 1"]);
  });

  it("does not mistake a Kelvin-named net/param for a coupling line", () => {
    // A K device line always has at least two further tokens (inductor names);
    // a lone `.param K=...` is filtered by the leading-dot of the keyword check.
    expect(couplingLinesFromDirectives(["Kvalue"])).toEqual([]);
  });
});
