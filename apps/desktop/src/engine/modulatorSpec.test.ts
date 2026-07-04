import { describe, it, expect } from "vitest";
import { parseModulator, modulatorDeckLines } from "./modulatorSpec";

describe("parseModulator", () => {
  it("parses mark/space with SI suffixes in either order", () => {
    expect(parseModulator("mark=1.1K space=.9K")).toEqual({ mark: 1100, space: 900 });
    expect(parseModulator("SPACE=2Meg MARK=1k")).toEqual({ mark: 1000, space: 2e6 });
  });

  it("defaults missing fields and ignores junk", () => {
    expect(parseModulator("")).toEqual({ mark: 1000, space: 0 });
    expect(parseModulator("mark=2K space=0")).toEqual({ mark: 2000, space: 0 });
    expect(parseModulator("mark=5k foo bar=1 space=oops")).toEqual({ mark: 5000, space: 0 });
  });

  it("clamps negative frequencies to 0 (XSPICE sine rejects them)", () => {
    expect(parseModulator("mark=-3k space=-1")).toEqual({ mark: 0, space: 0 });
  });
});

describe("modulatorDeckLines", () => {
  const SPEC = { mark: 1100, space: 900 };

  it("emits nothing when the output is unconnected", () => {
    expect(modulatorDeckLines("A1", { fm: "in" }, SPEC)).toEqual([]);
  });

  it("builds the buffered-FM XSPICE sine oscillator", () => {
    expect(modulatorDeckLines("A1", { fm: "in", out: "q" }, SPEC)).toEqual([
      "B_a1_fm a1_fm 0 V=V(in)",
      "A_a1 %v(a1_fm) %v(a1_osc) a1_vco",
      ".model a1_vco sine(cntl_array=[0 1] freq_array=[900 1100] out_low=-1 out_high=1)",
      "B_a1_out q 0 V=V(a1_osc)",
    ]);
  });

  it("scales amplitude by the AM input when wired", () => {
    const lines = modulatorDeckLines("A1", { fm: "in", am: "lvl", out: "q" }, SPEC);
    expect(lines[3]).toBe("B_a1_out q 0 V=V(lvl)*V(a1_osc)");
  });

  it("holds the control at 0 (space frequency) when FM is unwired", () => {
    const lines = modulatorDeckLines("A1", { out: "q" }, SPEC);
    expect(lines[0]).toBe("B_a1_fm a1_fm 0 V=0");
  });

  it("references FM/AM sensing and the output to com when wired", () => {
    const lines = modulatorDeckLines(
      "A1",
      { fm: "in", am: "lvl", out: "q", com: "ref" },
      SPEC,
    );
    expect(lines[0]).toBe("B_a1_fm a1_fm 0 V=V(in,ref)");
    expect(lines[3]).toBe("B_a1_out q 0 V=V(lvl,ref)*V(a1_osc)+V(ref)");
  });

  it("treats a grounded com as no reference", () => {
    const lines = modulatorDeckLines("A1", { fm: "in", out: "q", com: "0" }, SPEC);
    expect(lines[0]).toBe("B_a1_fm a1_fm 0 V=V(in)");
    expect(lines[3]).toBe("B_a1_out q 0 V=V(a1_osc)");
  });
});
