import { describe, it, expect } from "vitest";
import {
  parseTranDirective,
  parseAcDirective,
  parseTempDirective,
  analysesFromDirectives,
  DEFAULT_TRAN_STEPS,
} from "./directiveAnalysis";
import { MAX_TRANSIENT_STEPS } from "../simulation/linearTransient";

describe("parseTranDirective", () => {
  it("short form `.tran <Tstop>` uses the default sample count", () => {
    expect(parseTranDirective(".tran 5m")).toEqual({ stopTime: 0.005, steps: DEFAULT_TRAN_STEPS });
  });

  it("full form derives steps from Tstop/Tstep", () => {
    // Tstep=10us, Tstop=1ms → 1ms / 10us = 100 samples.
    expect(parseTranDirective(".tran 10u 1m")).toEqual({ stopTime: 0.001, steps: 100 });
  });

  it("preserves Tstart, Tmax, and an explicit uic modifier", () => {
    // Tstep=1u, Tstop=2m, Tstart=0, Tmax=1u, modifier uic → 2m/1u = 2000.
    expect(parseTranDirective(".tran 1u 2m 0 1u uic")).toEqual({
      stopTime: 0.002,
      steps: 2000,
      startTime: 0,
      maxStep: 0.000001,
      uic: true,
    });
    expect(parseTranDirective(".tran 0 1m .99m 10n")).toEqual({
      stopTime: 0.001,
      steps: DEFAULT_TRAN_STEPS,
      startTime: 0.00099,
      maxStep: 1e-8,
    });
  });

  it("accepts the bare `tran` keyword (no leading dot) and is case-insensitive", () => {
    expect(parseTranDirective("TRAN 5m")).toEqual({ stopTime: 0.005, steps: DEFAULT_TRAN_STEPS });
  });

  it("falls back to default steps when Tstep is zero", () => {
    expect(parseTranDirective(".tran 0 3m")).toEqual({ stopTime: 0.003, steps: DEFAULT_TRAN_STEPS });
  });

  it("clamps an absurd sample count to MAX_TRANSIENT_STEPS", () => {
    // Tstop/Tstep = 1 / 1n = 1e9 → clamped.
    expect(parseTranDirective(".tran 1n 1")?.steps).toBe(MAX_TRANSIENT_STEPS);
  });

  it("rejects non-`.tran` directives and missing/zero Tstop", () => {
    expect(parseTranDirective(".ac dec 20 10 1Meg")).toBeNull();
    expect(parseTranDirective(".tran")).toBeNull();
    expect(parseTranDirective(".tran 0")).toBeNull();
    expect(parseTranDirective(".transient 5m")).toBeNull();
  });
});

describe("parseAcDirective", () => {
  it("parses a `dec` sweep with points-per-decade mapped directly", () => {
    expect(parseAcDirective(".ac dec 20 10 1Meg")).toEqual({
      startHz: 10,
      stopHz: 1e6,
      pointsPerDecade: 20,
    });
  });

  it("converts a `lin` total point count to points-per-decade across the span", () => {
    // 10 → 100k spans 4 decades; 200 total points → 50 per decade.
    expect(parseAcDirective(".ac lin 200 10 100k")).toEqual({
      startHz: 10,
      stopHz: 1e5,
      pointsPerDecade: 50,
    });
  });

  it("converts a `oct` points-per-octave to points-per-decade", () => {
    // 10 points/octave × log2(10) ≈ 33.2 → 33 per decade.
    expect(parseAcDirective(".ac oct 10 100 10k")).toEqual({
      startHz: 100,
      stopHz: 1e4,
      pointsPerDecade: 33,
    });
  });

  it("rejects malformed, reversed, or unsupported sweeps", () => {
    expect(parseAcDirective(".ac dec 20 10")).toBeNull(); // too few tokens
    expect(parseAcDirective(".ac log 20 10 1Meg")).toBeNull(); // unknown sweep
    expect(parseAcDirective(".ac dec 20 1Meg 10")).toBeNull(); // stop < start
    expect(parseAcDirective(".tran 5m")).toBeNull();
  });
});

describe("analysesFromDirectives", () => {
  it("extracts the first .tran and .ac from a mixed directive list", () => {
    const out = analysesFromDirectives([
      ".param Rload=10k",
      ".tran 1m",
      ".ac dec 20 10 1Meg",
      ".meas TRAN x FIND V(out) AT 1m",
    ]);
    expect(out.tran).toEqual({ stopTime: 0.001, steps: DEFAULT_TRAN_STEPS });
    expect(out.ac).toEqual({ startHz: 10, stopHz: 1e6, pointsPerDecade: 20 });
  });

  it("returns an empty object when no analysis directives are present", () => {
    expect(analysesFromDirectives([".param a=1", ".func f(x)=x*2"])).toEqual({});
  });

  it("keeps only the first directive of each kind", () => {
    const out = analysesFromDirectives([".tran 1m", ".tran 9m"]);
    expect(out.tran?.stopTime).toBe(0.001);
  });

  it("extracts a .dc source sweep with SI-suffixed bounds", () => {
    const out = analysesFromDirectives([".param x=1", ".dc V1 0 10 0.5", ".dc V2 0 5 1"]);
    // First .dc wins; later ones are ignored.
    expect(out.dc).toEqual({ source: "V1", start: 0, stop: 10, step: 0.5 });
  });

  it("does not confuse .dc with .tran/.ac", () => {
    const out = analysesFromDirectives([".tran 1m", ".ac dec 20 10 1Meg"]);
    expect(out.dc).toBeUndefined();
  });

  it("extracts a .tf transfer-function request", () => {
    const out = analysesFromDirectives([".param x=1", ".tf V(out) V1"]);
    expect(out.tf).toEqual({ output: { kind: "voltage", pos: "out", neg: undefined }, source: "V1" });
  });

  it("extracts a .noise request", () => {
    const out = analysesFromDirectives([".param x=1", ".noise V(out) V1 dec 10 1 100k"]);
    expect(out.noise).toEqual({
      output: { pos: "out", neg: undefined },
      source: "V1",
      sweep: { startHz: 1, stopHz: 100_000, pointsPerDecade: 10 },
    });
  });

  it("extracts a .four request", () => {
    const out = analysesFromDirectives([".tran 1m", ".four 1k V(out)"]);
    expect(out.four).toEqual({ freq: 1000, harmonics: 10, outputs: ["V(out)"] });
  });

  it("extracts a .temp setting", () => {
    expect(analysesFromDirectives([".tran 1m", ".temp 85"]).temp).toBe(85);
    expect(analysesFromDirectives([".param x=1"]).temp).toBeUndefined();
  });
});

describe("parseTempDirective", () => {
  it("reads the temperature in °C, tolerating leading . / ! and negatives", () => {
    expect(parseTempDirective(".temp 27")).toBe(27);
    expect(parseTempDirective("!temp -40")).toBe(-40);
    expect(parseTempDirective(".temp 125 0 75")).toBe(125); // first value only
  });

  it("returns null for non-.temp or malformed lines", () => {
    expect(parseTempDirective(".tran 1m")).toBeNull();
    expect(parseTempDirective(".temp")).toBeNull();
    expect(parseTempDirective(".temperature 50")).toBeNull();
  });
});
