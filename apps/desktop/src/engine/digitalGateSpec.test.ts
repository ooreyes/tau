import { describe, it, expect } from "vitest";
import {
  parseDigitalGate,
  digitalGateDeckLines,
  dflopDeckLines,
} from "./digitalGateSpec";

describe("parseDigitalGate", () => {
  it("defaults to a 0/1 V buffer with midpoint threshold", () => {
    expect(parseDigitalGate("")).toEqual({
      fn: "buf", vhigh: 1, vlow: 0, vt: 0.5, vhys: 0, td: 0,
    });
  });

  it("reads the function token (case-insensitive, aliases)", () => {
    expect(parseDigitalGate("AND").fn).toBe("and");
    expect(parseDigitalGate("or").fn).toBe("or");
    expect(parseDigitalGate("xor").fn).toBe("xor");
    expect(parseDigitalGate("inv").fn).toBe("buf"); // inversion is pin choice
    expect(parseDigitalGate("buf1").fn).toBe("buf");
    expect(parseDigitalGate("schmtbuf").fn).toBe("schmitt");
    expect(parseDigitalGate("schmtinv").fn).toBe("schmitt");
    expect(parseDigitalGate("schmitt").fn).toBe("schmitt");
  });

  it("honors key=value params with SI suffixes", () => {
    expect(parseDigitalGate("and Vhigh=5 Vlow=-5 Vt=1.2 Vhys=0.5 Td=10n")).toEqual({
      fn: "and", vhigh: 5, vlow: -5, vt: 1.2, vhys: 0.5, td: 10e-9,
    });
  });

  it("defaults vt to the vhigh/vlow midpoint (Electrometer's Vhigh=0 Vlow=-5)", () => {
    const spec = parseDigitalGate("Vhigh=0 Vlow=-5 Trise=10n");
    expect(spec.vhigh).toBe(0);
    expect(spec.vlow).toBe(-5);
    expect(spec.vt).toBe(-2.5);
  });

  it("ignores unknown tokens and unparsable values", () => {
    expect(parseDigitalGate("and Trise=10n bogus Vhigh=oops").fn).toBe("and");
    expect(parseDigitalGate("and Trise=10n bogus Vhigh=oops").vhigh).toBe(1);
  });
});

describe("digitalGateDeckLines", () => {
  const spec = parseDigitalGate("and");

  it("emits an AND ternary per connected output (qbar swaps levels)", () => {
    const lines = digitalGateDeckLines("A1", { ins: ["a", "b"], q: "y", qbar: "yb" }, spec);
    expect(lines).toEqual([
      "B_A1_Q y 0 V=((V(a)>0.5)&&(V(b)>0.5)) ? 1 : 0",
      "B_A1_QB yb 0 V=((V(a)>0.5)&&(V(b)>0.5)) ? 0 : 1",
    ]);
  });

  it("emits nothing when no output is connected", () => {
    expect(digitalGateDeckLines("A1", { ins: ["a"] }, spec)).toEqual([]);
  });

  it("OR joins terms with ||; XOR is exactly-one-true", () => {
    const or = digitalGateDeckLines("A1", { ins: ["a", "b"], q: "y" }, parseDigitalGate("or"));
    expect(or[0]).toBe("B_A1_Q y 0 V=((V(a)>0.5)||(V(b)>0.5)) ? 1 : 0");
    const xor = digitalGateDeckLines("A1", { ins: ["a", "b"], q: "y" }, parseDigitalGate("xor"));
    expect(xor[0]).toBe("B_A1_Q y 0 V=(((V(a)>0.5)+(V(b)>0.5))==1) ? 1 : 0");
  });

  it("an inverter is a buf whose only output is qbar", () => {
    const lines = digitalGateDeckLines("A2", { ins: ["in"], qbar: "out" }, parseDigitalGate("inv"));
    expect(lines).toEqual(["B_A2_QB out 0 V=((V(in)>0.5)) ? 0 : 1"]);
  });

  it("gates with all inputs floating drive vlow", () => {
    const lines = digitalGateDeckLines("A1", { ins: [], q: "y" }, parseDigitalGate("and Vlow=-5"));
    expect(lines).toEqual(["B_A1_Q y 0 V=(0) ? 1 : -5"]);
  });

  it("Schmitt trip points straddle vt by vhys, keyed off the output state", () => {
    const sch = parseDigitalGate("schmitt Vhys=0.2");
    const lines = digitalGateDeckLines("A3", { ins: ["in"], q: "y" }, sch);
    // state high (V(y) above midpoint 0.5) → lower trip 0.3; state low → 0.7
    expect(lines).toEqual([
      "B_A3_Q y 0 V=((V(y)>0.5) ? (V(in)>0.3) : (V(in)>0.7)) ? 1 : 0",
    ]);
  });

  it("Schmitt scales output levels even though cond is itself a ternary", () => {
    // Regression: without parens around cond, ternary right-associativity made
    // the true branch return the raw boolean instead of vhigh.
    const sch = parseDigitalGate("schmitt Vhigh=5 Vhys=0.2");
    const lines = digitalGateDeckLines("A3", { ins: ["in"], q: "y" }, sch);
    expect(lines[0]).toBe(
      "B_A3_Q y 0 V=((V(y)>2.5) ? (V(in)>2.3) : (V(in)>2.7)) ? 5 : 0",
    );
  });

  it("references inputs and outputs to com when connected", () => {
    const lines = digitalGateDeckLines(
      "A4",
      { ins: ["a"], q: "y", com: "vee" },
      parseDigitalGate("buf"),
    );
    expect(lines).toEqual(["B_A4_Q y 0 V=(((V(a,vee)>0.5)) ? 1 : 0)+V(vee)"]);
  });

  it("treats a grounded com as absent", () => {
    const lines = digitalGateDeckLines("A4", { ins: ["a"], q: "y", com: "0" }, parseDigitalGate("buf"));
    expect(lines).toEqual(["B_A4_Q y 0 V=((V(a)>0.5)) ? 1 : 0"]);
  });
});

describe("dflopDeckLines", () => {
  it("emits adc bridge → d_dff → dac bridge at the gate's levels", () => {
    const spec = parseDigitalGate("Vhigh=1 Vlow=0");
    const lines = dflopDeckLines("A1", { d: "d", clk: "clk", q: "q", qbar: "qb" }, spec);
    expect(lines).toEqual([
      ".model a1_adc adc_bridge(in_low=0.5 in_high=0.5)",
      "A_a1_adc [d clk 0 0] [a1_dd a1_dclk a1_dpre a1_dclr] a1_adc",
      ".model a1_dff d_dff(ic=0 clk_delay=1e-9 set_delay=1e-9 reset_delay=1e-9 rise_delay=1e-9 fall_delay=1e-9)",
      "A_a1 a1_dd a1_dclk a1_dpre a1_dclr a1_dq a1_dnq a1_dff",
      ".model a1_dac dac_bridge(out_low=0 out_high=1)",
      "A_a1_dac [a1_dq a1_dnq] [q qb] a1_dac",
    ]);
  });

  it("uses the parsed levels/threshold (Electrometer: Vhigh=0 Vlow=-5 → vt=-2.5)", () => {
    const spec = parseDigitalGate("Vhigh=0 Vlow=-5");
    const lines = dflopDeckLines("A1", { d: "d", clk: "clk", q: "q" }, spec);
    expect(lines[0]).toBe(".model a1_adc adc_bridge(in_low=-2.5 in_high=-2.5)");
    expect(lines[4]).toBe(".model a1_dac dac_bridge(out_low=-5 out_high=0)");
    // unconnected qbar lands on a private node
    expect(lines[5]).toBe("A_a1_dac [a1_dq a1_dnq] [q a1_qbnc] a1_dac");
  });

  it("maps Td onto the event delays with a 1 ns floor", () => {
    const lines = dflopDeckLines("A1", { d: "d", clk: "c", q: "q" }, parseDigitalGate("Td=100n"));
    expect(lines[2]).toContain("clk_delay=1e-7 set_delay=1e-7 reset_delay=1e-7");
  });
});
