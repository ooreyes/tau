import { describe, it, expect } from "vitest";
import { unwrapPhaseDeg, groupDelay } from "./groupDelay";

describe("unwrapPhaseDeg", () => {
  it("leaves a smooth curve unchanged", () => {
    expect(unwrapPhaseDeg([0, -10, -20, -30])).toEqual([0, -10, -20, -30]);
  });

  it("removes a +360 cliff (wrap from +170 to -170 is really +20)", () => {
    expect(unwrapPhaseDeg([170, -170])).toEqual([170, 190]);
  });

  it("removes a -360 cliff (wrap from -170 to +170 is really -20)", () => {
    expect(unwrapPhaseDeg([-170, 170])).toEqual([-170, -190]);
  });

  it("accumulates multiple turns monotonically", () => {
    // 170 → -170 (+20) → -10 (+160) ⇒ 170, 190, 350
    expect(unwrapPhaseDeg([170, -170, -10])).toEqual([170, 190, 350]);
  });

  it("handles empty and single-element inputs", () => {
    expect(unwrapPhaseDeg([])).toEqual([]);
    expect(unwrapPhaseDeg([42])).toEqual([42]);
  });

  it("does not mutate its input", () => {
    const src = [170, -170];
    unwrapPhaseDeg(src);
    expect(src).toEqual([170, -170]);
  });
});

describe("groupDelay", () => {
  it("gives constant τ for a pure delay (linear phase φ = -360·f·τ0)", () => {
    const tau0 = 1e-3;
    const freqs = [0, 1, 2, 3, 4];
    const phaseDeg = freqs.map((f) => -360 * f * tau0);
    const tau = groupDelay(freqs, phaseDeg);
    for (const t of tau) expect(t).toBeCloseTo(tau0, 12);
  });

  it("is zero for a flat (constant) phase", () => {
    const freqs = [10, 20, 30, 40];
    const tau = groupDelay(freqs, [-45, -45, -45, -45]);
    for (const t of tau) expect(t).toBe(0);
  });

  it("central difference in the interior, one-sided at the ends", () => {
    // φ = [0, -36, -108] deg at f = [0,1,2]. τ = -dφ/(360 df).
    // i=0 (fwd): -(-36-0)/(360·1) = 0.1
    // i=1 (ctr): -(-108-0)/(360·2) = 0.15
    // i=2 (bwd): -(-108-(-36))/(360·1) = 0.2
    const tau = groupDelay([0, 1, 2], [0, -36, -108]);
    expect(tau[0]).toBeCloseTo(0.1, 12);
    expect(tau[1]).toBeCloseTo(0.15, 12);
    expect(tau[2]).toBeCloseTo(0.2, 12);
  });

  it("unwraps before differentiating (no spurious spike at a ±180 cliff)", () => {
    // Continuously decreasing phase that wraps: -170 → +170 is really -20°.
    // Over df=1 that is τ = -(-20)/(360·1) = 0.0555… everywhere.
    const tau = groupDelay([0, 1, 2], [-150, -170, 170]);
    expect(tau[0]).toBeCloseTo(20 / 360, 10);
    expect(tau[1]).toBeCloseTo(20 / 360, 10);
    expect(tau[2]).toBeCloseTo(20 / 360, 10);
  });

  it("returns all zeros for degenerate input", () => {
    expect(groupDelay([], [])).toEqual([]);
    expect(groupDelay([1], [0])).toEqual([0]);
    expect(groupDelay([1, 2], [0])).toEqual([0, 0]); // length mismatch
  });

  it("does not blow up on duplicate frequencies", () => {
    const tau = groupDelay([1, 1, 2], [0, -10, -20]);
    expect(tau.every((t) => Number.isFinite(t))).toBe(true);
  });
});
