import { describe, it, expect } from "vitest";
import { parseTransientSource, isFunctionSource } from "./sourceWaveform";

describe("parseTransientSource", () => {
  it("treats a plain number as constant DC", () => {
    const s = parseTransientSource("5", "V");
    expect(s.dc).toBe(5);
    expect(s.at(0)).toBe(5);
    expect(s.at(1)).toBe(5);
    expect(s.maxFrequencyHz).toBe(0);
  });

  it("parses an SI-suffixed DC level with a leading DC keyword", () => {
    const s = parseTransientSource("DC 1.5m", "A");
    expect(s.dc).toBeCloseTo(1.5e-3, 12);
    expect(s.at(42)).toBeCloseTo(1.5e-3, 12);
  });

  it("returns 0 for an unparseable value rather than NaN", () => {
    const s = parseTransientSource("garbage", "V");
    expect(s.dc).toBe(0);
    expect(s.at(0)).toBe(0);
  });

  describe("SINE", () => {
    it("evaluates offset + amp·sin(2πft) with no delay/damping", () => {
      const s = parseTransientSource("SINE(0 2 1k)", "V");
      expect(s.maxFrequencyHz).toBe(1000);
      expect(s.at(0)).toBeCloseTo(0, 9);
      // quarter period of 1 ms = 250 µs → peak
      expect(s.at(250e-6)).toBeCloseTo(2, 6);
      // half period → back to 0 (negative-going)
      expect(s.at(500e-6)).toBeCloseTo(0, 6);
      // three-quarter period → trough
      expect(s.at(750e-6)).toBeCloseTo(-2, 6);
    });

    it("holds the offset before the delay (Td)", () => {
      const s = parseTransientSource("SINE(1 2 1k 1m)", "V");
      expect(s.at(0)).toBeCloseTo(1, 9);
      expect(s.at(0.9e-3)).toBeCloseTo(1, 9);
      // 1 ms after the 1 ms delay = full extra period → back at offset
      expect(s.at(2e-3)).toBeCloseTo(1, 6);
      expect(s.at(1.25e-3)).toBeCloseTo(3, 6); // offset + amp at quarter period
    });

    it("applies a phase shift in degrees", () => {
      // 90° phase → sin starts at 1 → value = amp at t=0
      const s = parseTransientSource("SINE(0 2 1k 0 0 90)", "V");
      expect(s.at(0)).toBeCloseTo(2, 6);
    });

    it("holds offset+amp·sin(phase) during the delay (ngspice-verified)", () => {
      // ngspice SIN(0 2 1k 0.5m 0 90): v=2.0 for t<Td, then 1.666 V at dt=93.28µs.
      const s = parseTransientSource("SINE(0 2 1k 0.5m 0 90)", "V");
      expect(s.at(0)).toBeCloseTo(2, 6);
      expect(s.at(0.4e-3)).toBeCloseTo(2, 6); // still before the 0.5ms delay
      expect(s.at(0.5e-3 + 9.328e-5)).toBeCloseTo(1.666, 2); // matches ngspice
    });

    it("applies exponential damping (theta)", () => {
      // theta = 1000 /s; at one period (1 ms) damping = e^-1
      const s = parseTransientSource("SINE(0 2 1k 0 1000 90)", "V");
      expect(s.at(1e-3)).toBeCloseTo(2 * Math.exp(-1), 5);
    });
  });

  describe("PULSE", () => {
    it("evaluates a basic pulse with finite rise/fall (class-d style)", () => {
      // PULSE(0 5 0 1n 1n 1m 2m): V1=0 V2=5, no delay, 1ns edges, 1ms width, 2ms period
      const s = parseTransientSource("PULSE(0 5 0 1n 1n 1m 2m)", "V");
      expect(s.dc).toBe(0);
      expect(s.maxFrequencyHz).toBeCloseTo(500, 6); // 1/2ms
      expect(s.at(0)).toBe(0); // start of rise
      expect(s.at(0.5e-9)).toBeCloseTo(2.5, 6); // mid-rise
      expect(s.at(1e-9)).toBeCloseTo(5, 6); // top reached
      expect(s.at(0.5e-3)).toBe(5); // on time
      expect(s.at(1.0000015e-3)).toBeCloseTo(2.5, 4); // mid-fall (tr+pw+tf/2)
      expect(s.at(1.5e-3)).toBe(0); // off time
      // periodicity: 2ms later mirrors t=0..
      expect(s.at(2.5e-3)).toBe(5);
    });

    it("holds V1 during the delay", () => {
      const s = parseTransientSource("PULSE(-1 1 5u 0 0 5u 10u)", "V");
      expect(s.at(0)).toBe(-1);
      expect(s.at(4.9e-6)).toBe(-1);
      // zero-rise edge: immediately V2 at t=Td
      expect(s.at(5e-6)).toBe(1);
      expect(s.at(9.9e-6)).toBe(1); // local 4.9µs < 5µs width → still high
    });

    it("returns to V1 after the on-time within a period", () => {
      const s = parseTransientSource("PULSE(-1 1 5u 0 0 5u 10u)", "V");
      expect(s.at(12e-6)).toBe(-1); // local 7µs > 5µs width → off
    });

    it("stops pulsing after Ncycles", () => {
      const s = parseTransientSource("PULSE(0 5 0 0 0 1m 2m 2)", "V");
      expect(s.at(0)).toBe(5); // cycle 1 high
      expect(s.at(2.5e-3)).toBe(5); // cycle 2 high
      expect(s.at(4.5e-3)).toBe(0); // past 2 cycles → V1
    });
  });

  describe("PWL", () => {
    it("interpolates linearly between points and holds the ends", () => {
      const s = parseTransientSource("PWL(0 0 1m 10 2m 0)", "V");
      expect(s.dc).toBe(0);
      expect(s.at(-1)).toBe(0); // before first point
      expect(s.at(0)).toBe(0);
      expect(s.at(0.5e-3)).toBeCloseTo(5, 9); // halfway up
      expect(s.at(1e-3)).toBeCloseTo(10, 9);
      expect(s.at(1.5e-3)).toBeCloseTo(5, 9); // halfway down
      expect(s.at(2e-3)).toBeCloseTo(0, 9);
      expect(s.at(99)).toBe(0); // held at last level
    });
  });

  describe("EXP", () => {
    it("evaluates a single rising exponential", () => {
      // EXP(0 1 0 1m 1 1m): rises toward 1 with tau 1ms from t=0; fall starts at t=1s
      const s = parseTransientSource("EXP(0 1 0 1m 1 1m)", "V");
      expect(s.dc).toBe(0);
      expect(s.at(0)).toBeCloseTo(0, 9);
      expect(s.at(1e-3)).toBeCloseTo(1 - Math.exp(-1), 6); // one tau → 63.2%
      expect(s.at(10e-3)).toBeCloseTo(1, 4); // saturated
    });
  });

  describe("SFFM", () => {
    it("evaluates a single-frequency FM tone", () => {
      // SFFM(0 1 1k 0 100): zero modulation → plain 1 kHz sine of amp 1
      const s = parseTransientSource("SFFM(0 1 1k 0 100)", "V");
      expect(s.at(0)).toBeCloseTo(0, 9);
      expect(s.at(250e-6)).toBeCloseTo(1, 6); // quarter of 1 kHz
      expect(s.maxFrequencyHz).toBe(1000);
    });
  });

  it("ignores a trailing AC spec on a SINE source", () => {
    const s = parseTransientSource("SINE(0 1 1k) AC 1", "V");
    expect(s.maxFrequencyHz).toBe(1000);
    expect(s.at(250e-6)).toBeCloseTo(1, 6);
  });
});

describe("isFunctionSource", () => {
  it("recognizes function forms and rejects plain DC", () => {
    expect(isFunctionSource("PULSE(0 5 0 1n 1n 1m 2m)")).toBe(true);
    expect(isFunctionSource("SINE(0 1 1k) AC 1")).toBe(true);
    expect(isFunctionSource("pwl(0 0 1 1)")).toBe(true);
    expect(isFunctionSource("5")).toBe(false);
    expect(isFunctionSource("DC 5 AC 1")).toBe(false);
    expect(isFunctionSource("")).toBe(false);
  });
});
