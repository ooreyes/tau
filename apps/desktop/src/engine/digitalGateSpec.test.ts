import { describe, it, expect } from "vitest";
import {
  GATE_INPUTS_DEFAULT,
  GATE_INPUTS_MAX,
  GATE_INPUTS_MIN,
  gateInputCount,
  isSingleInputGateFn,
  nativelyPlacedGateSpec,
  parseDigitalGate,
  digitalGateDeckLines,
  dflopDeckLines,
  srflopDeckLines,
  tflopDeckLines,
  jkflopDeckLines,
} from "./digitalGateSpec";

describe("parseDigitalGate", () => {
  it("defaults to a 0/1 V buffer with midpoint threshold", () => {
    expect(parseDigitalGate("")).toEqual({
      fn: "buf", invertOut: false, qbarOnly: false, inputs: 1,
      vhigh: 1, vlow: 0, vt: 0.5, vhys: 0, td: 0,
    });
  });

  it("reads the function token (case-insensitive, aliases)", () => {
    expect(parseDigitalGate("AND").fn).toBe("and");
    expect(parseDigitalGate("or").fn).toBe("or");
    expect(parseDigitalGate("xor").fn).toBe("xor");
    expect(parseDigitalGate("inv").fn).toBe("buf"); // inversion is pin choice
    expect(parseDigitalGate("inv").invertOut).toBe(false);
    expect(parseDigitalGate("not").invertOut).toBe(true);
    expect(parseDigitalGate("nand")).toMatchObject({ fn: "and", invertOut: true });
    expect(parseDigitalGate("nor")).toMatchObject({ fn: "or", invertOut: true });
    expect(parseDigitalGate("xnor")).toMatchObject({ fn: "xor", invertOut: true });
    expect(parseDigitalGate("buf1").fn).toBe("buf");
    expect(parseDigitalGate("schmtbuf").fn).toBe("schmitt");
    expect(parseDigitalGate("schmtinv").fn).toBe("schmitt");
    expect(parseDigitalGate("schmitt").fn).toBe("schmitt");
  });

  it("honors key=value params with SI suffixes", () => {
    expect(parseDigitalGate("and Vhigh=5 Vlow=-5 Vt=1.2 Vhys=0.5 Td=10n")).toEqual({
      fn: "and", invertOut: false, qbarOnly: false, inputs: 2,
      vhigh: 5, vlow: -5, vt: 1.2, vhys: 0.5, td: 10e-9,
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

describe("nativelyPlacedGateSpec", () => {
  it("moves the qbar-only aliases' inversion onto the one output a placed gate has", () => {
    // `inv.asy` / `schmtinv.asy` are BUF/SCHMITT symbols that expose only the
    // complementary pin, so on an IMPORT the inversion is the pin choice and
    // `invertOut` must stay false. A gate Tau places has no such pin, so the
    // same value has to invert `q` or it would draw and solve as a plain
    // buffer - a silently non-inverting inverter.
    for (const fn of ["inv", "schmtinv"]) {
      const parsed = parseDigitalGate(fn);
      expect(parsed.invertOut, `${fn} imported`).toBe(false);
      expect(parsed.qbarOnly, `${fn} qbarOnly`).toBe(true);
      expect(nativelyPlacedGateSpec(parsed).invertOut, `${fn} placed`).toBe(true);
      expect(nativelyPlacedGateSpec(parsed).qbarOnly, `${fn} placed pin fact`).toBe(false);
    }
  });

  it("leaves every other function exactly as parsed, object identity included", () => {
    for (const fn of ["and", "or", "xor", "nand", "nor", "xnor", "buf", "buf1", "not", "schmitt", "schmtbuf"]) {
      const parsed = parseDigitalGate(fn);
      expect(nativelyPlacedGateSpec(parsed), fn).toBe(parsed);
    }
  });

  it("drives the placed output with the level the drawing's bubble promises", () => {
    // The bubble and the B-source have to agree: a `not` and a placed `inv`
    // are the same part, so they must emit the same line.
    const lineFor = (value: string): string =>
      digitalGateDeckLines("A1", { ins: ["a"] , q: "y" }, nativelyPlacedGateSpec(parseDigitalGate(value)))[0];
    expect(lineFor("inv")).toBe(lineFor("not"));
    expect(lineFor("buf")).not.toBe(lineFor("not"));
    // vhigh=1/vlow=0: an inverter drives 0 when its input is above threshold.
    expect(lineFor("inv")).toContain("? 0 : 1");
    expect(lineFor("buf")).toContain("? 1 : 0");
  });
});

describe("gate input count (mission item 9)", () => {
  it("defaults a multi-input gate to two, the fewest that make it that function", () => {
    for (const fn of ["and", "or", "xor", "nand", "nor", "xnor"]) {
      expect(parseDigitalGate(fn).inputs, fn).toBe(GATE_INPUTS_DEFAULT);
    }
    expect(GATE_INPUTS_DEFAULT).toBe(2);
  });

  it("reads Inputs= from the value, case-insensitively, across the whole range", () => {
    expect(parseDigitalGate("and Inputs=3").inputs).toBe(3);
    expect(parseDigitalGate("or inputs=5").inputs).toBe(5);
    expect(parseDigitalGate("xor Vhigh=5 INPUTS=4 Td=10n").inputs).toBe(4);
    // The count is a pin bank, so it may not be a fraction of a terminal.
    expect(parseDigitalGate("and Inputs=3.4").inputs).toBe(3);
  });

  it("clamps to what the netlist can emit instead of trusting the value", () => {
    // spiceNetlist reads in1..in5; a value asking for 9 would draw leads that
    // no deck line could ever reference.
    expect(parseDigitalGate("and Inputs=9").inputs).toBe(GATE_INPUTS_MAX);
    expect(parseDigitalGate("and Inputs=1").inputs).toBe(GATE_INPUTS_MIN);
    expect(parseDigitalGate("and Inputs=0").inputs).toBe(GATE_INPUTS_MIN);
    expect(parseDigitalGate("and Inputs=-4").inputs).toBe(GATE_INPUTS_MIN);
    expect(parseDigitalGate("and Inputs=oops").inputs).toBe(GATE_INPUTS_DEFAULT);
  });

  it("holds the single-input functions at one input whatever the value asks", () => {
    // A buffer, an inverter and a Schmitt trigger have one input by
    // construction; obeying Inputs= would draw leads the deck cannot read.
    for (const fn of ["buf", "buf1", "inv", "not", "schmitt", "schmtbuf", "schmtinv"]) {
      expect(parseDigitalGate(`${fn} Inputs=5`).inputs, fn).toBe(1);
      expect(isSingleInputGateFn(parseDigitalGate(fn).fn), fn).toBe(true);
    }
  });

  it("exposes the clamp on its own so pins and artwork can share it", () => {
    expect(gateInputCount("and", null)).toBe(GATE_INPUTS_DEFAULT);
    expect(gateInputCount("and", 4)).toBe(4);
    expect(gateInputCount("buf", 4)).toBe(1);
    expect(gateInputCount("and", Number.NaN)).toBe(GATE_INPUTS_DEFAULT);
  });
});

describe("digitalGateDeckLines", () => {
  const spec = parseDigitalGate("and");

  it("emits an AND ternary per connected output (qbar swaps levels)", () => {
    const lines = digitalGateDeckLines("A1", { ins: ["a", "b"], q: "y", qbar: "yb" }, spec);
    expect(lines).toEqual([
      "B_A1_Q A1_qd 0 V=((V(a)>0.5)*(V(b)>0.5)) ? 1 : 0",
      "R_A1_Q A1_qd y 1",
      "B_A1_QB A1_qbd 0 V=((V(a)>0.5)*(V(b)>0.5)) ? 0 : 1",
      "R_A1_QB A1_qbd yb 1",
    ]);
  });

  it("emits nothing when no output is connected", () => {
    expect(digitalGateDeckLines("A1", { ins: ["a"] }, spec)).toEqual([]);
  });

  it("OR joins terms as sum>0; XOR is exactly-one-true", () => {
    const or = digitalGateDeckLines("A1", { ins: ["a", "b"], q: "y" }, parseDigitalGate("or"));
    expect(or[0]).toBe("B_A1_Q A1_qd 0 V=(((V(a)>0.5)+(V(b)>0.5))>0) ? 1 : 0");
    const xor = digitalGateDeckLines("A1", { ins: ["a", "b"], q: "y" }, parseDigitalGate("xor"));
    expect(xor[0]).toBe("B_A1_Q A1_qd 0 V=(((V(a)>0.5)+(V(b)>0.5))==1) ? 1 : 0");
  });

  it("an inverter is a buf whose only output is qbar", () => {
    const lines = digitalGateDeckLines("A2", { ins: ["in"], qbar: "out" }, parseDigitalGate("inv"));
    expect(lines).toEqual(["B_A2_QB A2_qbd 0 V=((V(in)>0.5)) ? 0 : 1", "R_A2_QB A2_qbd out 1"]);
  });

  it("gates with all inputs floating drive vlow", () => {
    const lines = digitalGateDeckLines("A1", { ins: [], q: "y" }, parseDigitalGate("and Vlow=-5"));
    expect(lines).toEqual(["B_A1_Q A1_qd 0 V=(0) ? 1 : -5", "R_A1_Q A1_qd y 1"]);
  });

  it("Schmitt trip points straddle vt by vhys, keyed off the output state", () => {
    const sch = parseDigitalGate("schmitt Vhys=0.2");
    const lines = digitalGateDeckLines("A3", { ins: ["in"], q: "y" }, sch);
    // state high (V(y) above midpoint 0.5) → lower trip 0.3; state low → 0.7
    expect(lines).toEqual([
      "B_A3_Q A3_qd 0 V=((V(A3_qd)>0.5) ? (V(in)>0.3) : (V(in)>0.7)) ? 1 : 0",
      "R_A3_Q A3_qd y 1",
    ]);
  });

  it("Schmitt scales output levels even though cond is itself a ternary", () => {
    // Regression: without parens around cond, ternary right-associativity made
    // the true branch return the raw boolean instead of vhigh.
    const sch = parseDigitalGate("schmitt Vhigh=5 Vhys=0.2");
    const lines = digitalGateDeckLines("A3", { ins: ["in"], q: "y" }, sch);
    expect(lines[0]).toBe(
      "B_A3_Q A3_qd 0 V=((V(A3_qd)>2.5) ? (V(in)>2.3) : (V(in)>2.7)) ? 5 : 0",
    );
  });

  it("references inputs and outputs to com when connected", () => {
    const lines = digitalGateDeckLines(
      "A4",
      { ins: ["a"], q: "y", com: "vee" },
      parseDigitalGate("buf"),
    );
    expect(lines).toEqual(["B_A4_Q A4_qd 0 V=(((V(a,vee)>0.5)) ? 1 : 0)+V(vee)", "R_A4_Q A4_qd y 1"]);
  });

  it("treats a grounded com as absent", () => {
    const lines = digitalGateDeckLines("A4", { ins: ["a"], q: "y", com: "0" }, parseDigitalGate("buf"));
    expect(lines).toEqual(["B_A4_Q A4_qd 0 V=((V(a)>0.5)) ? 1 : 0", "R_A4_Q A4_qd y 1"]);
  });
});

describe("dflopDeckLines", () => {
  it("emits adc bridge → d_dff → dac bridge at the gate's levels", () => {
    const spec = parseDigitalGate("Vhigh=1 Vlow=0");
    const lines = dflopDeckLines("A1", { d: "d", clk: "clk", q: "q", qbar: "qb" }, spec);
    expect(lines).toEqual([
      ".model a1_adc adc_bridge(in_low=0.499 in_high=0.501)",
      "A_a1_adc [d clk 0 0] [a1_dd a1_dclk a1_dpre a1_dclr] a1_adc",
      ".model a1_dff d_dff(ic=0 clk_delay=1e-9 set_delay=1e-9 reset_delay=1e-9 rise_delay=1e-9 fall_delay=1e-9)",
      "A_a1 a1_dd a1_dclk a1_dpre a1_dclr a1_dq a1_dnq a1_dff",
      ".model a1_dac dac_bridge(out_low=0 out_high=1 t_rise=1e-8 t_fall=1e-8)",
      "A_a1_dac [a1_dq a1_dnq] [q qb] a1_dac",
    ]);
  });

  it("uses the parsed levels/threshold (Electrometer: Vhigh=0 Vlow=-5 → vt=-2.5)", () => {
    const spec = parseDigitalGate("Vhigh=0 Vlow=-5");
    const lines = dflopDeckLines("A1", { d: "d", clk: "clk", q: "q" }, spec);
    expect(lines[0]).toBe(".model a1_adc adc_bridge(in_low=-2.505 in_high=-2.495)");
    expect(lines[4]).toBe(".model a1_dac dac_bridge(out_low=-5 out_high=0 t_rise=1e-8 t_fall=1e-8)");
    // unconnected qbar lands on a private node
    expect(lines[5]).toBe("A_a1_dac [a1_dq a1_dnq] [q a1_qbnc] a1_dac");
  });

  it("maps Td onto the event delays with a 1 ns floor", () => {
    const lines = dflopDeckLines("A1", { d: "d", clk: "c", q: "q" }, parseDigitalGate("Td=100n"));
    expect(lines[2]).toContain("clk_delay=1e-7 set_delay=1e-7 reset_delay=1e-7");
  });
});

describe("srflopDeckLines", () => {
  it("emits async SR via d_dff set/reset (D/CLK held at digital 0)", () => {
    const lines = srflopDeckLines("A1", { s: "s", r: "r", q: "q", qbar: "qb" }, parseDigitalGate("Vhigh=5"));
    expect(lines[0]).toBe(".model a1_adc adc_bridge(in_low=2.495 in_high=2.505)");
    expect(lines[1]).toBe("A_a1_adc [0 0 s r] [a1_dd a1_dclk a1_ds a1_dr] a1_adc");
    expect(lines[2]).toContain(".model a1_dff d_dff(ic=0");
    expect(lines[3]).toBe("A_a1 a1_dd a1_dclk a1_ds a1_dr a1_dq a1_dnq a1_dff");
    expect(lines[5]).toBe("A_a1_dac [a1_dq a1_dnq] [q qb] a1_dac");
  });
});

describe("tflopDeckLines / jkflopDeckLines", () => {
  it("emits XSPICE d_tff between adc/dac bridges", () => {
    const lines = tflopDeckLines("A2", { t: "t", clk: "c", q: "q" }, parseDigitalGate("Vhigh=5"));
    expect(lines[1]).toBe("A_a2_adc [t c 0 0] [a2_dt a2_dclk a2_dpre a2_dclr] a2_adc");
    expect(lines[2]).toContain(".model a2_tff d_tff(ic=0");
    expect(lines[3]).toBe("A_a2 a2_dt a2_dclk a2_dpre a2_dclr a2_dq a2_dnq a2_tff");
  });

  it("emits XSPICE d_jkff between adc/dac bridges", () => {
    const lines = jkflopDeckLines("A3", { j: "j", k: "k", clk: "c", q: "q", qbar: "qb" }, parseDigitalGate(""));
    expect(lines[1]).toBe("A_a3_adc [j k c 0 0] [a3_dj a3_dk a3_dclk a3_dpre a3_dclr] a3_adc");
    expect(lines[2]).toContain(".model a3_jkff d_jkff(ic=0");
    expect(lines[3]).toBe("A_a3 a3_dj a3_dk a3_dclk a3_dpre a3_dclr a3_dq a3_dnq a3_jkff");
    expect(lines[5]).toBe("A_a3_dac [a3_dq a3_dnq] [q qb] a3_dac");
  });
});
