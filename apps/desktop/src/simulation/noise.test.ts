import { describe, it, expect } from "vitest";
import {
  parseNoiseDirective,
  runNoiseAnalysis,
  BOLTZMANN,
  NOISE_TEMP_KELVIN,
} from "./noise";
import type { NetLabel, SchematicComponent } from "../schematic/types";

const FOUR_KT = 4 * BOLTZMANN * NOISE_TEMP_KELVIN;

// ---------------------------------------------------------------------------
// parseNoiseDirective
// ---------------------------------------------------------------------------

describe("parseNoiseDirective", () => {
  it("parses V(node) output, source and a dec sweep", () => {
    expect(parseNoiseDirective(".noise V(out) V1 dec 10 1 100k")).toEqual({
      output: { pos: "out", neg: undefined },
      source: "V1",
      sweep: { startHz: 1, stopHz: 100_000, pointsPerDecade: 10 },
    });
  });

  it("parses a differential V(a,b) output with spaces", () => {
    const spec = parseNoiseDirective("!noise V(out, ref) Iin oct 5 100 1meg");
    expect(spec?.output).toEqual({ pos: "out", neg: "ref" });
    expect(spec?.source).toBe("Iin");
    // oct→dec conversion: 5 * log2(10) ≈ 16.6 → 17
    expect(spec?.sweep.pointsPerDecade).toBe(Math.round(5 * Math.log2(10)));
  });

  it("converts a lin sweep to points-per-decade across the span", () => {
    // 1 to 1k = 3 decades, 300 points total → 100 pts/decade
    const spec = parseNoiseDirective(".noise V(out) V1 lin 300 1 1k");
    expect(spec?.sweep.pointsPerDecade).toBe(100);
  });

  it("returns null for malformed or non-noise lines", () => {
    expect(parseNoiseDirective(".ac dec 10 1 100k")).toBeNull();
    expect(parseNoiseDirective(".noise V(out) V1")).toBeNull(); // missing sweep
    expect(parseNoiseDirective(".noise V(out) V1 dec 10 1")).toBeNull(); // missing fstop
    expect(parseNoiseDirective(".noise out V1 dec 10 1 1k")).toBeNull(); // output not V(...)
    expect(parseNoiseDirective("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Single resistor + current input — flat thermal noise (textbook √(4kTR))
// ---------------------------------------------------------------------------
//
//   out ---R1--- gnd      with current source Iin from out to gnd
//
// Only noise source is R1. Transimpedance to "out" = R, so the output noise PSD
// = R²·(4kT/R) = 4kTR (flat). For R = 1k that is 4.07 nV/√Hz — the classic value.
// With a current input source, input-referred noise = √(4kTR)/R = √(4kT/R).

function singleResistor(): {
  components: SchematicComponent[];
  netLabels: NetLabel[];
} {
  const components: SchematicComponent[] = [
    { id: "iin", label: "Iin", kind: "iac", x: 0, y: 0, rotation: 0, value: "1",
      pinOverride: [
        { id: "p", label: "+", x: 0, y: 0 },
        { id: "n", label: "-", x: 0, y: 100 },
      ] },
    { id: "r1", label: "R1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k",
      pinOverride: [
        { id: "a", label: "a", x: 0, y: 0 },
        { id: "b", label: "b", x: 0, y: 100 },
      ] },
    { id: "g", label: "", kind: "ground", x: 0, y: 100, rotation: 0, value: "",
      pinOverride: [{ id: "g", label: "gnd", x: 0, y: 100 }] },
  ];
  const netLabels: NetLabel[] = [{ id: "lout", x: 0, y: 0, text: "out" }];
  return { components, netLabels };
}

describe("runNoiseAnalysis — single resistor (flat thermal noise)", () => {
  const { components, netLabels } = singleResistor();
  const result = runNoiseAnalysis(
    { components, wires: [], netLabels },
    parseNoiseDirective(".noise V(out) Iin dec 10 1 1k")!,
  );

  it("solves successfully", () => {
    expect(result.ok).toBe(true);
  });

  it("output noise is flat at √(4kT·R) = 4.07 nV/√Hz", () => {
    if (!result.ok) throw new Error(result.message);
    const expected = Math.sqrt(FOUR_KT * 1000);
    expect(expected).toBeCloseTo(4.07e-9, 11);
    for (const v of result.onoise) {
      expect(v).toBeCloseTo(expected, 15);
    }
  });

  it("input-referred noise is flat at √(4kT/R) = 4.07 pA/√Hz", () => {
    if (!result.ok) throw new Error(result.message);
    const expected = Math.sqrt(FOUR_KT / 1000);
    expect(expected).toBeCloseTo(4.07e-12, 14);
    for (const v of result.inoise) {
      expect(v).toBeCloseTo(expected, 18);
    }
    expect(result.inoiseUnit).toBe("A/√Hz");
  });

  it("integrated output noise equals √(4kTR·BW) for a flat spectrum", () => {
    if (!result.ok) throw new Error(result.message);
    const bw = result.freqs[result.freqs.length - 1] - result.freqs[0];
    const expected = Math.sqrt(FOUR_KT * 1000 * bw);
    expect(result.totalOutputNoise).toBeCloseTo(expected, 12);
  });
});

// ---------------------------------------------------------------------------
// RC low-pass — the famous kTC noise integral
// ---------------------------------------------------------------------------
//
//   in ---R1--- out ---C1--- gnd      V1 drives "in"
//
// The output noise PSD of an RC filter is 4kTR/(1+(ωRC)²). Integrated over all
// frequency this is kT/C — independent of R (the "kTC noise"). The input-
// referred noise is FLAT at √(4kTR) (the resistor's noise referred to input).

function rcLowpass(R: string, C: string): {
  components: SchematicComponent[];
  netLabels: NetLabel[];
} {
  const components: SchematicComponent[] = [
    { id: "v1", label: "V1", kind: "vsource", x: 0, y: 0, rotation: 0, value: "1",
      pinOverride: [
        { id: "p", label: "+", x: 0, y: 0 },
        { id: "n", label: "-", x: 0, y: 100 },
      ] },
    { id: "r1", label: "R1", kind: "resistor", x: 0, y: 0, rotation: 0, value: R,
      pinOverride: [
        { id: "a", label: "a", x: 0, y: 0 },
        { id: "b", label: "b", x: 0, y: 50 },
      ] },
    { id: "c1", label: "C1", kind: "capacitor", x: 0, y: 0, rotation: 0, value: C,
      pinOverride: [
        { id: "a", label: "a", x: 0, y: 50 },
        { id: "b", label: "b", x: 0, y: 100 },
      ] },
    { id: "g", label: "", kind: "ground", x: 0, y: 100, rotation: 0, value: "",
      pinOverride: [{ id: "g", label: "gnd", x: 0, y: 100 }] },
  ];
  const netLabels: NetLabel[] = [
    { id: "lin", x: 0, y: 0, text: "in" },
    { id: "lout", x: 0, y: 50, text: "out" },
  ];
  return { components, netLabels };
}

describe("runNoiseAnalysis — RC low-pass (kTC noise)", () => {
  const R = 1000;
  const C = 1e-9;
  const { components, netLabels } = rcLowpass("1k", "1n");
  const result = runNoiseAnalysis(
    { components, wires: [], netLabels },
    parseNoiseDirective(".noise V(out) V1 dec 30 0.1 100meg")!,
  );

  it("output noise PSD matches 4kTR/(1+(ωRC)²) at every frequency", () => {
    if (!result.ok) throw new Error(result.message);
    result.freqs.forEach((f, i) => {
      const x = 2 * Math.PI * f * R * C;
      const expected = Math.sqrt((FOUR_KT * R) / (1 + x * x));
      expect(result.onoise[i]).toBeCloseTo(expected, 15);
    });
  });

  it("input-referred noise is flat at √(4kTR)", () => {
    if (!result.ok) throw new Error(result.message);
    const expected = Math.sqrt(FOUR_KT * R);
    for (const v of result.inoise) {
      expect(v).toBeCloseTo(expected, 14);
    }
    expect(result.inoiseUnit).toBe("V/√Hz");
  });

  it("integrated output noise ≈ √(kT/C) (kTC noise)", () => {
    if (!result.ok) throw new Error(result.message);
    const kTC = Math.sqrt((BOLTZMANN * NOISE_TEMP_KELVIN) / C);
    // Band [0.1, 100MHz] captures essentially the whole spectrum; trapezoidal on
    // a 30 pts/decade log grid lands within a couple of percent of the analytic kTC.
    expect(result.totalOutputNoise).toBeGreaterThan(kTC * 0.95);
    expect(result.totalOutputNoise).toBeLessThan(kTC * 1.02);
  });

  it("integrated output noise is independent of R (kTC)", () => {
    const big = rcLowpass("10k", "1n");
    const r2 = runNoiseAnalysis(
      { components: big.components, wires: [], netLabels: big.netLabels },
      parseNoiseDirective(".noise V(out) V1 dec 30 0.01 100meg")!,
    );
    if (!result.ok) throw new Error(result.message);
    if (!r2.ok) throw new Error(r2.message);
    // 10× the resistance, same C → same integrated kTC noise (within grid error).
    expect(r2.totalOutputNoise).toBeCloseTo(result.totalOutputNoise, 7);
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe("runNoiseAnalysis — error handling", () => {
  it("reports a missing ground", () => {
    const comps: SchematicComponent[] = [
      { id: "iin", label: "Iin", kind: "iac", x: 0, y: 0, rotation: 0, value: "1",
        pinOverride: [
          { id: "p", label: "+", x: 0, y: 0 },
          { id: "n", label: "-", x: 0, y: 100 },
        ] },
      { id: "r1", label: "R1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k",
        pinOverride: [
          { id: "a", label: "a", x: 0, y: 0 },
          { id: "b", label: "b", x: 0, y: 100 },
        ] },
    ];
    const r = runNoiseAnalysis(
      { components: comps, wires: [], netLabels: [{ id: "lout", x: 0, y: 0, text: "out" }] },
      parseNoiseDirective(".noise V(out) Iin dec 10 1 1k")!,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/ground/i);
  });

  it("reports an unknown output node", () => {
    const { components, netLabels } = singleResistor();
    const r = runNoiseAnalysis(
      { components, wires: [], netLabels },
      parseNoiseDirective(".noise V(nope) Iin dec 10 1 1k")!,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/nope/);
  });

  it("reports an unknown input source", () => {
    const { components, netLabels } = singleResistor();
    const r = runNoiseAnalysis(
      { components, wires: [], netLabels },
      parseNoiseDirective(".noise V(out) V9 dec 10 1 1k")!,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/V9/);
  });
});
