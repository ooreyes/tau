import { describe, it, expect } from "vitest";
import { parseComparator, comparatorDeckLine, DEFAULT_COMPARATOR } from "./comparatorSpec";

describe("parseComparator", () => {
  it("returns defaults for empty / placeholder values", () => {
    expect(parseComparator("")).toEqual(DEFAULT_COMPARATOR);
    expect(parseComparator("   ")).toEqual(DEFAULT_COMPARATOR);
    expect(parseComparator("ideal")).toEqual(DEFAULT_COMPARATOR);
    expect(parseComparator("comparator")).toEqual(DEFAULT_COMPARATOR);
  });

  it("reads positional 'vhigh vlow'", () => {
    expect(parseComparator("5 0")).toEqual({ vhigh: 5, vlow: 0, vhyst: 0 });
    expect(parseComparator("3.3 -3.3")).toEqual({ vhigh: 3.3, vlow: -3.3, vhyst: 0 });
  });

  it("reads a single positional level as vhigh (vlow stays 0)", () => {
    expect(parseComparator("5")).toEqual({ vhigh: 5, vlow: 0, vhyst: 0 });
  });

  it("reads positional hysteresis as the third number", () => {
    expect(parseComparator("5 0 0.1")).toEqual({ vhigh: 5, vlow: 0, vhyst: 0.1 });
  });

  it("honors key=value tokens (case-insensitive, aliases)", () => {
    expect(parseComparator("Vhigh=5 Vlow=0")).toEqual({ vhigh: 5, vlow: 0, vhyst: 0 });
    expect(parseComparator("vh=12 vl=-12 hyst=0.5")).toEqual({ vhigh: 12, vlow: -12, vhyst: 0.5 });
  });

  it("honors SI suffixes", () => {
    expect(parseComparator("1.8 0 1m")).toEqual({ vhigh: 1.8, vlow: 0, vhyst: 0.001 });
  });

  it("accepts comma / slash separators", () => {
    expect(parseComparator("5,0")).toEqual({ vhigh: 5, vlow: 0, vhyst: 0 });
    expect(parseComparator("5/0/0.2")).toEqual({ vhigh: 5, vlow: 0, vhyst: 0.2 });
  });

  it("fills only the levels not set by explicit keys with positionals", () => {
    // vlow set by key; the bare 5 fills the next unset level (vhigh).
    expect(parseComparator("vlow=-2 5")).toEqual({ vhigh: 5, vlow: -2, vhyst: 0 });
  });

  it("ignores unparseable stray tokens rather than throwing", () => {
    expect(parseComparator("5 0 banana")).toEqual({ vhigh: 5, vlow: 0, vhyst: 0 });
    expect(parseComparator("foo=1 5 0")).toEqual({ vhigh: 5, vlow: 0, vhyst: 0 });
  });

  it("takes the absolute value of hysteresis", () => {
    expect(parseComparator("5 0 -0.3").vhyst).toBe(0.3);
  });
});

describe("comparatorDeckLine", () => {
  it("emits an ideal ternary B-source when there is no hysteresis", () => {
    const line = comparatorDeckLine("B_U1", "vout", "inp", "inm", { vhigh: 5, vlow: 0, vhyst: 0 });
    expect(line).toBe("B_U1 vout 0 V=(V(inp)-V(inm))>0 ? 5 : 0");
  });

  it("emits a self-referential hysteretic form when vhyst > 0", () => {
    const line = comparatorDeckLine("B_U2", "o", "p", "n", { vhigh: 4, vlow: 0, vhyst: 0.5 });
    // threshold shifts by ±0.5 depending on the present output state (read via V(o))
    expect(line).toContain("V(o)>2"); // mid = (4+0)/2
    expect(line).toContain("((V(p)-V(n))>-0.5 ? 4 : 0)"); // already-high branch
    expect(line).toContain("((V(p)-V(n))>0.5 ? 4 : 0)"); // already-low branch
  });

  it("clamps to negative rails too", () => {
    const line = comparatorDeckLine("B_U3", "out", "a", "b", { vhigh: 12, vlow: -12, vhyst: 0 });
    expect(line).toBe("B_U3 out 0 V=(V(a)-V(b))>0 ? 12 : -12");
  });
});
