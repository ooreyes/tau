import { describe, expect, it } from "vitest";
import {
  expressionForTrace,
  traceMathMenuItems,
  wrapTraceMath,
} from "./traceMath";

describe("expressionForTrace", () => {
  it("uses expr: body and V/I labels; skips ref overlays", () => {
    expect(expressionForTrace("expr:V(a)-V(b)", "V(a)-V(b)")).toBe("V(a)-V(b)");
    expect(expressionForTrace("n1", "V(out)")).toBe("V(out)");
    expect(expressionForTrace("iR1", "I(R1)")).toBe("I(R1)");
    expect(expressionForTrace("ref:V(out)", "V(out)")).toBeNull();
    expect(expressionForTrace("expr:  ", "x")).toBeNull();
  });
});

describe("wrapTraceMath", () => {
  it("wraps abs / neg / db / uramp / sgn / ddt with parentheses for compound exprs", () => {
    expect(wrapTraceMath("V(out)", "abs")).toBe("abs(V(out))");
    expect(wrapTraceMath("V(a)-V(b)", "neg")).toBe("-(V(a)-V(b))");
    expect(wrapTraceMath("V(out)", "db")).toBe("db(V(out))");
    expect(wrapTraceMath("V(out)", "uramp")).toBe("uramp(V(out))");
    expect(wrapTraceMath("V(a)-V(b)", "sgn")).toBe("sgn(V(a)-V(b))");
    expect(wrapTraceMath("V(out)", "ddt")).toBe("ddt(V(out))");
    expect(wrapTraceMath("V(a)-V(b)", "ddt")).toBe("ddt(V(a)-V(b))");
    expect(wrapTraceMath("  I(R1)  ", "abs")).toBe("abs(I(R1))");
    expect(wrapTraceMath("   ", "abs")).toBe("");
  });
});

describe("traceMathMenuItems", () => {
  it("exposes abs / neg / db / uramp / sgn / ddt", () => {
    expect(traceMathMenuItems().map((m) => m.op)).toEqual([
      "abs",
      "neg",
      "db",
      "uramp",
      "sgn",
      "ddt",
    ]);
  });
});
