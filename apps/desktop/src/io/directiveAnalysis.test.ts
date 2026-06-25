import { describe, it, expect } from "vitest";
import {
  parseTranDirective,
  parseAcDirective,
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

  it("ignores Tstart, Tmax, and trailing modifiers", () => {
    // Tstep=1u, Tstop=2m, Tstart=0, Tmax=1u, modifier uic → 2m/1u = 2000.
    expect(parseTranDirective(".tran 1u 2m 0 1u uic")).toEqual({ stopTime: 0.002, steps: 2000 });
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
});
