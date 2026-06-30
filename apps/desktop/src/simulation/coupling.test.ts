import { describe, it, expect } from "vitest";
import { parseCouplingSpecs, mutualTerms } from "./coupling";
import { buildParamScope } from "./paramScope";

describe("parseCouplingSpecs", () => {
  it("parses a basic two-winding K line", () => {
    expect(parseCouplingSpecs(["K1 L1 L2 1"])).toEqual([{ labels: ["L1", "L2"], k: 1 }]);
  });

  it("parses a fractional coefficient with a leading dot", () => {
    expect(parseCouplingSpecs(["K3 L1 L2 .95"])).toEqual([{ labels: ["L1", "L2"], k: 0.95 }]);
  });

  it("parses an all-windings multi-inductor line", () => {
    expect(parseCouplingSpecs(["K1 L1 L2 L3 L4 1"])).toEqual([
      { labels: ["L1", "L2", "L3", "L4"], k: 1 },
    ]);
  });

  it("resolves a braced parameter coefficient against the scope", () => {
    const params = buildParamScope([".param Kcup=0.99"]);
    expect(parseCouplingSpecs(["Kcup1 L2 L3 {Kcup}"], params)).toEqual([
      { labels: ["L2", "L3"], k: 0.99 },
    ]);
  });

  it("collapses double spaces and ignores non-K and malformed lines", () => {
    expect(
      parseCouplingSpecs([
        "R1 n1 0 1k", // not a coupling line
        "K2 L1 L2  0.8", // double space before coeff
        "K5 L1 notanumber", // only one label, no numeric coeff
        ".tran 0 1m",
      ]),
    ).toEqual([{ labels: ["L1", "L2"], k: 0.8 }]);
  });

  it("splits a multi-line TEXT block on the escaped newline", () => {
    expect(parseCouplingSpecs(["K1 L1 L2 1\\nK2 L3 L4 0.5"])).toEqual([
      { labels: ["L1", "L2"], k: 1 },
      { labels: ["L3", "L4"], k: 0.5 },
    ]);
  });
});

describe("mutualTerms", () => {
  const L1L2 = [
    { label: "L1", inductance: 1e-3 },
    { label: "L2", inductance: 4e-3 },
  ];

  it("computes M = k·√(La·Lb) for an ideal pair", () => {
    // M = 1·√(1m·4m) = √(4e-6) = 2e-3
    const terms = mutualTerms(L1L2, [{ labels: ["L1", "L2"], k: 1 }]);
    expect(terms).toHaveLength(1);
    expect(terms[0].a).toBe(0);
    expect(terms[0].b).toBe(1);
    expect(terms[0].m).toBeCloseTo(2e-3, 12);
  });

  it("scales M by the coupling coefficient", () => {
    const terms = mutualTerms(L1L2, [{ labels: ["L1", "L2"], k: 0.5 }]);
    expect(terms[0].m).toBeCloseTo(1e-3, 12);
  });

  it("preserves a negative coupling sign", () => {
    const terms = mutualTerms(L1L2, [{ labels: ["L1", "L2"], k: -1 }]);
    expect(terms[0].m).toBeCloseTo(-2e-3, 12);
  });

  it("clamps |k| > 1 to unity", () => {
    const terms = mutualTerms(L1L2, [{ labels: ["L1", "L2"], k: 5 }]);
    expect(terms[0].m).toBeCloseTo(2e-3, 12);
  });

  it("normalizes index order so a < b regardless of label order", () => {
    const terms = mutualTerms(L1L2, [{ labels: ["L2", "L1"], k: 1 }]);
    expect(terms[0].a).toBe(0);
    expect(terms[0].b).toBe(1);
  });

  it("expands an N-inductor K line into all pairs", () => {
    const four = [
      { label: "L1", inductance: 1e-3 },
      { label: "L2", inductance: 1e-3 },
      { label: "L3", inductance: 1e-3 },
      { label: "L4", inductance: 1e-3 },
    ];
    const terms = mutualTerms(four, [{ labels: ["L1", "L2", "L3", "L4"], k: 1 }]);
    // C(4,2) = 6 pairs, each M = √(1m·1m) = 1m
    expect(terms).toHaveLength(6);
    for (const t of terms) expect(t.m).toBeCloseTo(1e-3, 12);
  });

  it("keeps the first spec for a pair when duplicated", () => {
    const terms = mutualTerms(L1L2, [
      { labels: ["L1", "L2"], k: 1 },
      { labels: ["L2", "L1"], k: 0.5 },
    ]);
    expect(terms).toHaveLength(1);
    expect(terms[0].m).toBeCloseTo(2e-3, 12);
  });

  it("ignores labels not present in the circuit", () => {
    expect(mutualTerms(L1L2, [{ labels: ["L1", "Lmissing"], k: 1 }])).toEqual([]);
  });

  it("returns nothing for k = 0 or a single inductor", () => {
    expect(mutualTerms(L1L2, [{ labels: ["L1", "L2"], k: 0 }])).toEqual([]);
    expect(mutualTerms([{ label: "L1", inductance: 1e-3 }], [{ labels: ["L1", "L2"], k: 1 }])).toEqual([]);
  });
});
