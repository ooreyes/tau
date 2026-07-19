import { describe, it, expect } from "vitest";
import { coreInductance, isCoreInductor } from "./coreInductor";

describe("isCoreInductor", () => {
  it("detects Chan-core parameter specs, not plain inductances", () => {
    expect(isCoreInductor("Hc=16. Bs=.44 Br=.10 A=2.51e-5 Lm=0.0198 Lg=6.858e-4 N=1000")).toBe(true);
    expect(isCoreInductor("Lg=1m N=10")).toBe(true);
    expect(isCoreInductor("1m")).toBe(false);
    expect(isCoreInductor("100u IC=0.5")).toBe(false);
  });
});

describe("coreInductance", () => {
  it("sizes the NonLinearTransformer L1 from gap + core reluctance", () => {
    // N=1000, A=2.51e-5, Lg=6.858e-4, Lm=0.0198, Hc=16, Br=0.10:
    // µi = Br/(µ0·Hc) ≈ 4974 ; L = N²·µ0·A/(Lg + Lm/µi) ≈ 45.7 mH (hand-computed).
    const L = coreInductance("Hc=16. Bs=.44 Br=.10 A=0.0000251 Lm=0.0198 Lg=0.0006858 N=1000");
    expect(L).not.toBeNull();
    expect(L!).toBeCloseTo(0.045727, 5);
  });

  it("a gapped core with no B-H curve is gap-dominated: L = µ0·N²·A/Lg", () => {
    const L = coreInductance("A=0.0000251 Lg=0.0006858 N=1000");
    expect(L!).toBeCloseTo(0.045992, 5); // 4π e-7 · 1e6 · 2.51e-5 / 6.858e-4
  });

  it("an ungapped core (Lg=0) uses only the core path: L = µ0·µi·N²·A/Lm", () => {
    const L = coreInductance("Hc=16 Br=0.10 A=0.0000251 Lm=0.0198 N=1000");
    expect(L!).toBeCloseTo(7.922, 2); // N² / (Lm/(µ0·µi·A))
  });

  it("returns null without the geometry needed to size it (falls back to plain parse)", () => {
    expect(coreInductance("Hc=16 Bs=.44 Br=.10")).toBeNull(); // no N, no A
    expect(coreInductance("1m")).toBeNull(); // not a core spec at all
    expect(coreInductance("N=1000 A=0")).toBeNull(); // zero area
  });
});
