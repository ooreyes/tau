import { describe, it, expect } from "vitest";
import { sampleHoldDeckLines } from "./sampleHoldSpec";
import { parseDigitalGate } from "./digitalGateSpec";

const DEFAULT = parseDigitalGate(""); // vhigh=1 vlow=0 vt=0.5

describe("sampleHoldDeckLines", () => {
  it("emits nothing when the output is unconnected", () => {
    expect(
      sampleHoldDeckLines("A1", { inp: "in", sh: "ctl" }, DEFAULT),
    ).toEqual([]);
  });

  it("builds a single track-and-hold stage in S/H mode", () => {
    const lines = sampleHoldDeckLines(
      "A1",
      { inp: "in", sh: "ctl", out: "a" },
      DEFAULT,
    );
    expect(lines).toEqual([
      "B_a1_in a1_s 0 V=V(in)",
      "B_a1_ctl a1_ctl 0 V=(V(ctl)>0.5) ? 1 : 0",
      "S_a1 a1_s a1_h a1_ctl 0 a1_sw",
      ".model a1_sw sw(vt=0.5 vh=0.2 ron=1 roff=1e12)",
      "C_a1_h a1_h 0 1n",
      "B_a1_out a 0 V=V(a1_h)",
    ]);
  });

  it("builds master-slave stages in CLK mode", () => {
    const lines = sampleHoldDeckLines(
      "A2",
      { inp: "in", clk: "ck", out: "b" },
      DEFAULT,
    );
    expect(lines).toEqual([
      "B_a2_in a2_s 0 V=V(in)",
      "B_a2_c1 a2_c1 0 V=(V(ck)<0.5) ? 1 : 0",
      "S_a2_1 a2_s a2_h1 a2_c1 0 a2_sw",
      ".model a2_sw sw(vt=0.5 vh=0.2 ron=1 roff=1e12)",
      "C_a2_1 a2_h1 0 1n",
      "B_a2_m a2_m 0 V=V(a2_h1)",
      "B_a2_c2 a2_c2 0 V=(V(ck)>0.5) ? 1 : 0",
      "S_a2_2 a2_m a2_h2 a2_c2 0 a2_sw",
      "C_a2_2 a2_h2 0 1n",
      "B_a2_out b 0 V=V(a2_h2)",
    ]);
  });

  it("prefers S/H mode when both control pins are wired", () => {
    const lines = sampleHoldDeckLines(
      "A1",
      { inp: "in", sh: "ctl", clk: "ck", out: "a" },
      DEFAULT,
    );
    expect(lines.some((l) => l.includes("V(ctl)>0.5"))).toBe(true);
    expect(lines.some((l) => l.includes("V(ck)"))).toBe(false);
  });

  it("degrades to a unity-gain follower with no control pins", () => {
    expect(
      sampleHoldDeckLines("A1", { inp: "in", out: "a" }, DEFAULT),
    ).toEqual(["B_a1_out a 0 V=V(in)"]);
  });

  it("samples the differential input and drops unwired input terms", () => {
    const diff = sampleHoldDeckLines(
      "A1",
      { inp: "p", inn: "n", sh: "ctl", out: "a" },
      DEFAULT,
    );
    expect(diff[0]).toBe("B_a1_in a1_s 0 V=V(p,n)");
    const invOnly = sampleHoldDeckLines(
      "A1",
      { inn: "n", sh: "ctl", out: "a" },
      DEFAULT,
    );
    expect(invOnly[0]).toBe("B_a1_in a1_s 0 V=-V(n)");
    const floating = sampleHoldDeckLines("A1", { out: "a" }, DEFAULT);
    expect(floating).toEqual(["B_a1_out a 0 V=0"]);
  });

  it("references controls and output to com when wired", () => {
    const lines = sampleHoldDeckLines(
      "A1",
      { inp: "in", sh: "ctl", out: "a", com: "ref" },
      DEFAULT,
    );
    expect(lines[1]).toBe("B_a1_ctl a1_ctl 0 V=(V(ctl,ref)>0.5) ? 1 : 0");
    expect(lines[5]).toBe("B_a1_out a 0 V=V(a1_h)+V(ref)");
  });

  it("treats a grounded com as no reference", () => {
    const lines = sampleHoldDeckLines(
      "A1",
      { inp: "in", sh: "ctl", out: "a", com: "0" },
      DEFAULT,
    );
    expect(lines[5]).toBe("B_a1_out a 0 V=V(a1_h)");
  });

  it("applies a custom Vt threshold to both CLK switch phases", () => {
    const spec = parseDigitalGate("Vt=2.5");
    const lines = sampleHoldDeckLines(
      "A1",
      { inp: "in", clk: "ck", out: "a" },
      spec,
    );
    expect(lines[1]).toContain("V(ck)<2.5");
    expect(lines[6]).toContain("V(ck)>2.5");
  });
});
