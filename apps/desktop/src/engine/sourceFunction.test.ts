import { describe, expect, it } from "vitest";
import { parseSourceFunction } from "./sourceFunction";

describe("parseSourceFunction", () => {
  it("returns null for a plain DC number", () => {
    expect(parseSourceFunction("10", "V")).toBeNull();
    expect(parseSourceFunction("1.5k", "V")).toBeNull();
    expect(parseSourceFunction("", "V")).toBeNull();
  });

  it("parses LTspice SINE(offset amp freq) and drops trailing zero args", () => {
    const spec = parseSourceFunction("SINE(0 7.5 1k)", "V");
    expect(spec).not.toBeNull();
    expect(spec!.text).toBe("DC 0 SIN(0 7.5 1000)");
    expect(spec!.dc).toBe(0);
  });

  it("keeps SINE damping and phase when present", () => {
    const spec = parseSourceFunction("SINE(1 2 1k 0 0 90)", "V");
    // trailing td/theta are 0 but phase is non-zero, so all six are retained.
    expect(spec!.text).toBe("DC 1 SIN(1 2 1000 0 0 90)");
  });

  it("accepts the SIN alias as well as SINE", () => {
    expect(parseSourceFunction("SIN(0 1 60)", "V")!.text).toBe("DC 0 SIN(0 1 60)");
  });

  it("parses a full 7-arg LTspice PULSE and trims the Ncycles slot", () => {
    const spec = parseSourceFunction("PULSE(-10 10 5u 25u 25u 0u 50u)", "V");
    expect(spec!.text).toBe("DC -10 PULSE(-10 10 0.000005 0.000025 0.000025 0 0.00005)");
    expect(spec!.dc).toBe(-10);
  });

  it("normalizes the unicode micro prefix that LTspice emits", () => {
    const spec = parseSourceFunction("PULSE(0 5 0 1µ 1µ 10µ 20µ)", "V");
    expect(spec!.text).toContain("PULSE(0 5 0 0.000001 0.000001 0.00001 0.00002)");
  });

  it("parses PWL alternating time/level pairs", () => {
    const spec = parseSourceFunction("PWL(0 0 1m 5 2m 0)", "V");
    expect(spec!.text).toBe("DC 0 PWL(0 0 0.001 5 0.002 0)");
    expect(spec!.dc).toBe(0);
  });

  it("parses paren-less PWL (LT8708-1)", () => {
    const spec = parseSourceFunction("PWL 0 0 +10u 3.3 3m 3.3 +10u 0", "V");
    expect(spec!.text).toBe("DC 0 PWL(0 0 0.00001 3.3 0.003 3.3 0.00301 0)");
  });

  it("keeps an explicit operating-point bias separate from the transient waveform", () => {
    const spec = parseSourceFunction("DC 3.3 PWL(0 0 1m 5)", "V");
    expect(spec).toEqual({ text: "DC 3.3 PWL(0 0 0.001 5)", dc: 3.3 });
  });

  it("accumulates LTspice relative PWL times and rejects backwards axes", () => {
    const spec = parseSourceFunction("PWL(0 0 10m 0 +1u 100 100m 100 +1u 400)", "V");
    expect(spec!.text).toBe("DC 0 PWL(0 0 0.01 0 0.010001 100 0.1 100 0.100001 400)");
    expect(() => parseSourceFunction("PWL(0 0 2m 1 1m 0)", "V")).toThrow(/goes backwards/i);
    expect(() => parseSourceFunction("PWL(0 0 nope 1)", "V")).toThrow(/time.*invalid/i);
  });

  it("rejects truncated PWL without a closing parenthesis", () => {
    expect(() => parseSourceFunction("PWL(0 0 10m 0 +100n 3.3", "V")).toThrow(/malformed PWL/i);
  });

  it("rejects paren-less PWL with an odd argument count", () => {
    expect(() => parseSourceFunction("PWL 0 0 +10u", "V")).toThrow(/malformed PWL/i);
  });

  it("parses EXP and SFFM", () => {
    expect(parseSourceFunction("EXP(0 5 1m 2m 5m 3m)", "V")!.text).toBe(
      "DC 0 EXP(0 5 0.001 0.002 0.005 0.003)",
    );
    expect(parseSourceFunction("SFFM(0 1 1k 5 100)", "V")!.text).toBe(
      "DC 0 SFFM(0 1 1000 5 100)",
    );
  });

  it("treats current-source levels in amps", () => {
    const spec = parseSourceFunction("SINE(0 2m 1k)", "A");
    expect(spec!.text).toBe("DC 0 SIN(0 0.002 1000)");
  });

  it("is case-insensitive and tolerant of whitespace", () => {
    const spec = parseSourceFunction("  sine( 0 1 1k )", "V");
    expect(spec!.text).toBe("DC 0 SIN(0 1 1000)");
  });
});
