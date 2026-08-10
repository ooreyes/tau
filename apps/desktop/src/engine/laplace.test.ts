import { describe, it, expect } from "vitest";
import {
  assertLaplaceAnalysisSupported,
  classifyLaplaceTransfer,
  LaplaceAnalysisRefusal,
  LAPLACE_DYNAMIC_TRANSFER_REFUSAL_CODE,
  laplaceTransfer,
  laplaceSourceLines,
} from "./laplace";

const E = { base: "E1", op: "out", on: "0", cp: "in", cn: "0", isCurrent: false, funcs: {} };

function model(transfer: string, scope: Record<string, number> = {}) {
  const r = laplaceSourceLines({ ...E, transfer, scope });
  const m = r.lines.find((l) => l.includes("s_xfer"));
  return { r, m };
}

describe("laplaceTransfer", () => {
  it("extracts the expression after Laplace=", () => {
    expect(laplaceTransfer("Laplace=1/(1+.001*s)")).toBe("1/(1+.001*s)");
    expect(laplaceTransfer("LAPLACE = A0/(1+s/wp1)")).toBe("A0/(1+s/wp1)");
    // tolerate a trailing inline spec keyword position; takes everything after =
    expect(laplaceTransfer("  laplace=1/s  ")).toBe("1/s");
  });
  it("returns null for non-Laplace values", () => {
    expect(laplaceTransfer("10")).toBeNull();
    expect(laplaceTransfer("SINE(0 1 1k)")).toBeNull();
    expect(laplaceTransfer("")).toBeNull();
  });
});

describe("laplaceSourceLines - rational s_xfer", () => {
  it("first-order lag 1/(1+0.001s): den = [0.001 1] highest-power first", () => {
    const { m } = model("1/(1+0.001*s)");
    // ascending [1, 0.001] -> descending [0.001, 1]
    expect(m).toContain("num_coeff=[1]");
    expect(m).toContain("den_coeff=[0.001 1]");
  });

  it("two-pole A0/(1+s/wp1)/(1+s/wp2) expands exactly (hand-computed)", () => {
    const { m } = model("A0/(1+s/wp1)/(1+s/wp2)", { A0: 1000, wp1: 6283, wp2: 628318 });
    // num = A0*wp1*wp2 ; den = s^2 + (wp1+wp2) s + wp1*wp2
    expect(m).toContain("num_coeff=[3947721994000]");
    expect(m).toContain("den_coeff=[1 634601 3947721994]");
  });

  it("triple pole (1+0.0005s)^3 binomial expansion", () => {
    const { m } = model("1./(1+.0005*s)**3");
    // (a s + 1)^3 with a=5e-4: [a^3, 3a^2, 3a, 1] = [1.25e-10, 7.5e-7, 0.0015, 1]
    expect(m).toContain("num_coeff=[1]");
    expect(m).toContain("den_coeff=[1.2500000000e-10 7.5000000000e-7 0.0015 1]");
  });

  it("band-pass {k}s/(s^2+{k}s+{w2}) keeps the numerator's s term", () => {
    const { m } = model("62.8*s/(s*s+62.8*s+394384)");
    expect(m).toContain("num_coeff=[62.8 0]");
    expect(m).toContain("den_coeff=[1 62.8 394384]");
  });

  it("pure gain collapses to a plain VCVS (no code model)", () => {
    const r = laplaceSourceLines({ ...E, transfer: "5", scope: {} });
    expect(r.exact).toBe(true);
    expect(r.lines).toEqual(["E_E1 out 0 in 0 5"]);
    expect(r.lines.join("")).not.toContain("s_xfer");
  });
});

describe("laplaceSourceLines - non-rational DC fallback", () => {
  it("transport delay exp(-Ts) falls back to H(0) gain", () => {
    const r = laplaceSourceLines({ ...E, transfer: "exp(-.001*s)/(1+.001*s)**2", scope: {} });
    expect(r.exact).toBe(false);
    expect(r.lines).toEqual(["E_E1 out 0 in 0 1"]); // H(0) = 1
  });

  it("fractional response sqrt(...) falls back to H(0)", () => {
    const r = laplaceSourceLines({ ...E, transfer: "2/sqrt(1+1u*s)", scope: {} });
    expect(r.exact).toBe(false);
    expect(r.lines).toEqual(["E_E1 out 0 in 0 2"]); // H(0) = 2/sqrt(1) = 2
  });

  it("dynamic current source (G) has an H(0)-only rendering with G prefix", () => {
    const r = laplaceSourceLines({ ...E, isCurrent: true, transfer: "10/(1+.001*s)", scope: {} });
    expect(r.exact).toBe(false);
    expect(r.lines).toEqual(["G_E1 out 0 in 0 10"]);
  });

  it("constant current source (G) is exact for every analysis", () => {
    const r = laplaceSourceLines({ ...E, isCurrent: true, transfer: "2m", scope: {} });
    expect(r.exact).toBe(true);
    expect(r.lines).toEqual(["G_E1 out 0 in 0 0.002"]);
  });
});

describe("Laplace analysis support", () => {
  const dynamicVoltage = classifyLaplaceTransfer({
    transfer: "exp(-.001*s)", isCurrent: false, scope: {}, funcs: {},
  });
  const dynamicCurrent = classifyLaplaceTransfer({
    transfer: "1/(1+.001*s)", isCurrent: true, scope: {}, funcs: {},
  });

  it.each(["op", "dc", "tf"] as const)("allows exact H(0) %s analysis", (analysis) => {
    expect(() => assertLaplaceAnalysisSupported({
      analysis, ref: "E1", sourceKind: "vcvs", transfer: "exp(-.001*s)", classification: dynamicVoltage,
    })).not.toThrow();
  });

  it.each(["tran", "ac", "noise"] as const)("refuses a non-rational %s analysis before approximation", (analysis) => {
    try {
      assertLaplaceAnalysisSupported({
        analysis, ref: "E1", sourceKind: "vcvs", transfer: "exp(-.001*s)", classification: dynamicVoltage,
      });
      expect.unreachable("dynamic Laplace should be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(LaplaceAnalysisRefusal);
      expect((error as LaplaceAnalysisRefusal).code).toBe(LAPLACE_DYNAMIC_TRANSFER_REFUSAL_CODE);
      const refusal = error as LaplaceAnalysisRefusal;
      expect(refusal.diagnostic).toEqual({
        code: LAPLACE_DYNAMIC_TRANSFER_REFUSAL_CODE,
        message: refusal.message,
        ref: "E1",
        sourceKind: "vcvs",
        transfer: "exp(-.001*s)",
        analysis,
        dcGain: 1,
        reason: "non-rational",
      });
      expect(refusal.message).toContain("No approximate or partial circuit was run.");
    }
  });

  it("refuses a dynamic G source, while retaining its exact H(0) static path", () => {
    expect(dynamicCurrent).toMatchObject({ kind: "dc-only", reason: "current-dynamic", dcGain: 1 });
    expect(() => assertLaplaceAnalysisSupported({
      analysis: "tf", ref: "G1", sourceKind: "vccs", transfer: "1/(1+.001*s)", classification: dynamicCurrent,
    })).not.toThrow();
    try {
      assertLaplaceAnalysisSupported({
        analysis: "ac", ref: "G1", sourceKind: "vccs", transfer: "1/(1+.001*s)", classification: dynamicCurrent,
      });
      expect.unreachable("dynamic G source should be refused");
    } catch (error) {
      expect(error).toMatchObject({
        diagnostic: {
          sourceKind: "vccs",
          reason: "current-dynamic",
          dcGain: 1,
          analysis: "ac",
        },
      });
    }
  });
});
