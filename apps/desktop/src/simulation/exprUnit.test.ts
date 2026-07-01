import { describe, it, expect } from "vitest";
import { inferExpressionUnit, commonTraceUnit } from "./exprUnit";

describe("inferExpressionUnit", () => {
  it("labels a plain node voltage as volts", () => {
    expect(inferExpressionUnit("V(out)")).toBe("V");
    expect(inferExpressionUnit("V(a,b)")).toBe("V");
  });

  it("labels a probed branch current as amps", () => {
    expect(inferExpressionUnit("I(R1)")).toBe("A");
    expect(inferExpressionUnit("I(L1)")).toBe("A");
  });

  it("keeps volts through a difference of two node voltages", () => {
    expect(inferExpressionUnit("V(a)-V(b)")).toBe("V");
    expect(inferExpressionUnit("V(a)+V(b)")).toBe("V");
  });

  it("scales stay volts (constant times a voltage)", () => {
    expect(inferExpressionUnit("2*V(in)")).toBe("V");
    expect(inferExpressionUnit("V(in)/2")).toBe("V");
    expect(inferExpressionUnit("V(in)*3+1*V(out)")).toBe("V");
  });

  it("infers watts for instantaneous power V·I", () => {
    expect(inferExpressionUnit("V(out)*I(R1)")).toBe("W");
    expect(inferExpressionUnit("I(R1)*V(out)")).toBe("W");
  });

  it("infers ohms for V/I and siemens for I/V", () => {
    expect(inferExpressionUnit("V(out)/I(out)")).toBe("Ω");
    expect(inferExpressionUnit("I(out)/V(out)")).toBe("S");
  });

  it("preserves dimension through abs/min/max", () => {
    expect(inferExpressionUnit("abs(I(L1))")).toBe("A");
    expect(inferExpressionUnit("abs(V(out))")).toBe("V");
    expect(inferExpressionUnit("max(V(a),V(b))")).toBe("V");
  });

  it("strips units through transcendental functions", () => {
    expect(inferExpressionUnit("sin(V(in))")).toBe("");
    expect(inferExpressionUnit("sqrt(V(in))")).toBe("");
  });

  it("returns empty for a mismatched sum (V + I is not physical)", () => {
    expect(inferExpressionUnit("V(a)+I(b)")).toBe("");
  });

  it("returns empty for higher powers with no common symbol", () => {
    expect(inferExpressionUnit("V(a)*V(b)")).toBe(""); // volts²
    expect(inferExpressionUnit("V(a)^2")).toBe("");
  });

  it("treats a bare number and boolean comparison as dimensionless", () => {
    expect(inferExpressionUnit("5")).toBe("");
    expect(inferExpressionUnit("V(a)>V(b)")).toBe("");
  });

  it("never throws on malformed input", () => {
    expect(inferExpressionUnit("")).toBe("");
    expect(inferExpressionUnit("V(")).toBe("");
    expect(inferExpressionUnit(")(*&")).toBe("");
  });
});

describe("commonTraceUnit", () => {
  it("returns the shared unit when all traces agree", () => {
    expect(commonTraceUnit(["V", "V", "V"])).toBe("V");
    expect(commonTraceUnit(["A", "A"])).toBe("A");
  });

  it("ignores empty (unknown) units when deciding", () => {
    expect(commonTraceUnit(["V", "", "V"])).toBe("V");
  });

  it("returns empty when traces disagree", () => {
    expect(commonTraceUnit(["V", "A"])).toBe("");
    expect(commonTraceUnit(["W", "V", "A"])).toBe("");
  });

  it("returns empty for an all-empty or empty list", () => {
    expect(commonTraceUnit([])).toBe("");
    expect(commonTraceUnit(["", ""])).toBe("");
  });
});
