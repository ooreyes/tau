import { describe, it, expect } from "vitest";
import {
  buildParamScope,
  evaluateValueExpr,
  expandDirectiveLines,
  parseParamAssignments,
  parseFuncDirective,
  isExpression,
  substituteKnownBraces,
  omitParamsFromScope,
  paramCardsForNativeStep,
  steppedParamNamesFromDirectives,
  EMPTY_SCOPE,
} from "./paramScope";

describe("expandDirectiveLines", () => {
  it("splits a multi-line TEXT block on the literal \\n escape", () => {
    expect(expandDirectiveLines([".param x=1\\n.param y=2"])).toEqual([".param x=1", ".param y=2"]);
  });

  it("strips trailing ; comments and drops blank lines", () => {
    expect(expandDirectiveLines([".tran 1m ; run it\\n \\n.ic v(out)=0"])).toEqual([
      ".tran 1m",
      ".ic v(out)=0",
    ]);
  });

  it("folds a + continuation into the previous line (P2's K coupling)", () => {
    expect(expandDirectiveLines(["K1 L4 L5\\n+ L6 L7 1"])).toEqual(["K1 L4 L5 L6 L7 1"]);
  });

  it("folds multiple consecutive continuations", () => {
    expect(expandDirectiveLines([".model M NPN(Bf=10\\n+ Vaf=100\\n+ Cje=1p)"])).toEqual([
      ".model M NPN(Bf=10 Vaf=100 Cje=1p)",
    ]);
  });

  it("keeps an orphan leading + verbatim when there is nothing to continue", () => {
    expect(expandDirectiveLines(["+ L6 L7 1"])).toEqual(["+ L6 L7 1"]);
  });
});

describe("parseParamAssignments", () => {
  it("parses a single assignment", () => {
    expect(parseParamAssignments("Vdd=5")).toEqual([{ name: "Vdd", expr: "5" }]);
  });

  it("parses multiple assignments on one line", () => {
    expect(parseParamAssignments("R1=10k R2=20k")).toEqual([
      { name: "R1", expr: "10k" },
      { name: "R2", expr: "20k" },
    ]);
  });

  it("keeps spaces and braces inside a value", () => {
    expect(parseParamAssignments("f = {1/period}")).toEqual([{ name: "f", expr: "{1/period}" }]);
    expect(parseParamAssignments("x = 2 * y")).toEqual([{ name: "x", expr: "2 * y" }]);
  });

  it("does not treat == / <= as assignment", () => {
    expect(parseParamAssignments("k = if(a>=b, 1, 0)")).toEqual([{ name: "k", expr: "if(a>=b, 1, 0)" }]);
  });

  it("tolerates the name-value form without '='", () => {
    expect(parseParamAssignments("tau 1m")).toEqual([{ name: "tau", expr: "1m" }]);
  });
});

describe("parseFuncDirective", () => {
  it("parses brace-body func", () => {
    expect(parseFuncDirective("sq(x) {x*x}")).toEqual({ name: "sq", def: { params: ["x"], body: "x*x" } });
  });
  it("parses equals-body func with multiple params", () => {
    expect(parseFuncDirective("add(a,b)=a+b")).toEqual({ name: "add", def: { params: ["a", "b"], body: "a+b" } });
  });
});

describe("buildParamScope", () => {
  it("resolves simple params", () => {
    const { scope } = buildParamScope([".param Vdd=5", ".param Rload=1k"]);
    expect(scope.vdd).toBe(5);
    expect(scope.rload).toBe(1000);
  });

  it("accepts the plural `.params` keyword (notch/passive/varactor)", () => {
    const { scope } = buildParamScope([".params R=10K C=.1u", ".params w=.0005 x=.005"]);
    expect(scope.r).toBe(10000);
    expect(scope.c).toBeCloseTo(0.1e-6, 12);
    expect(scope.w).toBe(0.0005);
    expect(scope.x).toBe(0.005);
  });

  it("expands a multi-line `\\n` directive block and strips `;` comments (Cohn.asc)", () => {
    // LTspice packs the whole block into one TEXT entry with literal `\n` joins
    // and an inline `;` comment after the first assignment.
    const { scope } = buildParamScope([
      ".param x=.54 ; trimer postion\\n.param R=50\\n.param L=2.95u Lm=.27u C1=22p+x*25p C2=240p C3=34p",
    ]);
    expect(scope.x).toBeCloseTo(0.54, 10);
    expect(scope.r).toBe(50);
    expect(scope.l).toBeCloseTo(2.95e-6, 18);
    // C1 = 22p + x*25p = 22p + .54*25p = 35.5p
    expect(scope.c1).toBeCloseTo(35.5e-12, 18);
    expect(scope.c3).toBeCloseTo(34e-12, 18);
  });

  it("seeds a `.step param` swept variable with its first value (default run)", () => {
    // list form → first value; linear form → start; both let `{X}` resolve for a
    // non-stepped preview run (a stepped run overrides per value elsewhere).
    expect(buildParamScope([".step param X list 2 5 10"]).scope.x).toBe(2);
    expect(buildParamScope([".step param Rdim 1k 10k 1k"]).scope.rdim).toBe(1000);
  });

  it("lets a `.step` value override a same-named `.param` default", () => {
    const { scope } = buildParamScope([".param N=3", ".step param N list 7 8 9"]);
    expect(scope.n).toBe(7);
  });

  it("resolves params that depend on earlier params", () => {
    const { scope } = buildParamScope([".param a=2", ".param b={a*3}"]);
    expect(scope.b).toBe(6);
  });

  it("resolves forward references (definition order independent)", () => {
    const { scope } = buildParamScope([".param b={a*3}", ".param a=2"]);
    expect(scope.b).toBe(6);
    expect(scope.a).toBe(2);
  });

  it("resolves a chain of dependencies", () => {
    const { scope } = buildParamScope([
      ".param period={1/freq}",
      ".param freq=1k",
      ".param halfp={period/2}",
    ]);
    expect(scope.freq).toBe(1000);
    expect(scope.period).toBeCloseTo(1e-3, 18);
    expect(scope.halfp).toBeCloseTo(5e-4, 18);
  });

  it("makes .func available to params", () => {
    const { scope } = buildParamScope([".func dbl(x) {2*x}", ".param y={dbl(21)}"]);
    expect(scope.y).toBe(42);
  });

  it("throws on a dependency cycle", () => {
    expect(() => buildParamScope([".param a={b}", ".param b={a}"])).toThrow();
  });

  it("throws on an undefined reference", () => {
    expect(() => buildParamScope([".param a={missing+1}"])).toThrow();
  });

  it("ignores non-param/func directives", () => {
    const { scope } = buildParamScope([".tran 1m", ".param a=3", ".ac dec 10 1 1meg"]);
    expect(scope.a).toBe(3);
  });

  it("later definition wins", () => {
    const { scope } = buildParamScope([".param a=1", ".param a=2"]);
    expect(scope.a).toBe(2);
  });
});

describe("evaluateValueExpr", () => {
  it("resolves a brace expression against scope", () => {
    const ctx = buildParamScope([".param R=2k"]);
    expect(evaluateValueExpr("{R*2}", ctx)).toBe(4000);
  });

  it("passes a plain quantity through", () => {
    expect(evaluateValueExpr("10k")).toBe(10000);
    expect(evaluateValueExpr("4.7u")).toBeCloseTo(4.7e-6, 18);
  });

  it("resolves a bare param name", () => {
    const ctx = buildParamScope([".param Cval=100n"]);
    expect(evaluateValueExpr("Cval", ctx)).toBeCloseTo(100e-9, 18);
  });

  it("throws on an empty value", () => {
    expect(() => evaluateValueExpr("")).toThrow();
  });
});

describe("isExpression", () => {
  it("flags brace and operator values", () => {
    expect(isExpression("{R*2}")).toBe(true);
    expect(isExpression("2*pi")).toBe(true);
    expect(isExpression("1/freq")).toBe(true);
  });
  it("treats plain quantities as non-expressions", () => {
    expect(isExpression("10k")).toBe(false);
    expect(isExpression("4.7u")).toBe(false);
    expect(isExpression("-5")).toBe(false);
  });
});

describe("substituteKnownBraces", () => {
  const ctx = buildParamScope([".param Cjo=930p m=.75"]);

  it("substitutes resolvable braces and keeps unresolvable ones verbatim", () => {
    expect(substituteKnownBraces(".model DX D(Cjo={Cjo} m={m} tt={mystery})", ctx)).toBe(
      ".model DX D(Cjo=9.3e-10 m=0.75 tt={mystery})",
    );
  });

  it("returns brace-free text untouched and evaluates expressions", () => {
    expect(substituteKnownBraces(".model DX D(Is=0)", ctx)).toBe(".model DX D(Is=0)");
    expect(substituteKnownBraces("{Cjo*2}", ctx)).toBe("1.86e-9");
  });

  it("keeps everything verbatim under an empty scope", () => {
    expect(substituteKnownBraces("R1 1 2 {R}")).toBe("R1 1 2 {R}");
  });
});

describe("native .step param helpers", () => {
  it("omits stepped names so substituteKnownBraces leaves {X}", () => {
    const full = buildParamScope([".param X=1 Y=2", ".step param X list 1 2"]);
    const bake = omitParamsFromScope(full, new Set(["x"]));
    expect(substituteKnownBraces("{X}", bake)).toBe("{X}");
    expect(substituteKnownBraces("{Y}", bake)).toBe("2");
  });

  it("emits .param cards including .step param first-value seeds", () => {
    const cards = paramCardsForNativeStep(
      EMPTY_SCOPE,
      [".step param Rload list 1k 2k"],
    );
    expect(cards.join("\n")).toMatch(/\.param\b[\s\S]*\bRload=1000\b/);
  });

  it("lists unique stepped param names from directives", () => {
    expect(steppedParamNamesFromDirectives([
      ".tran 1m",
      ".step param X list 1 2",
      ".step V1 list 3 4",
      ".step param x list 5 6",
    ])).toEqual(["X"]);
  });
});
