import { describe, it, expect } from "vitest";
import {
  parseBehavioral,
  behavioralSpecText,
  linearizeBehavioral,
  ifToTernary,
  statFuncsToNgspice,
  ltFuncsToNgspice,
} from "./behavioral";

describe("LTspice soft-limit translation", () => {
  it("rewrites nested uplim/dnlim calls to ngspice ternaries without a hard clamp", () => {
    const translated = ltFuncsToNgspice("dnlim(uplim(V(in),5,.3),-5,.2)");
    expect(translated).not.toMatch(/\b(?:up|dn)lim\s*\(/i);
    expect(translated).toContain("exp(");
    expect(translated).toContain("min(");
    expect(translated).toContain("max(");
  });

  it("leaves a wrong-arity call explicit instead of guessing", () => {
    expect(ltFuncsToNgspice("uplim(x,y)")).toBe("uplim(x,y)");
  });

  it("rewrites LTspice soft _exp to plain exp for same-deck ngspice", () => {
    expect(ltFuncsToNgspice("_exp(V(x))")).toBe("exp(V(x))");
    expect(ltFuncsToNgspice("I=_exp(V(x))")).toBe("I=exp(V(x))");
  });
});

describe("ifToTernary", () => {
  it("leaves an expression without if() untouched", () => {
    expect(ifToTernary("2*V(a)+1")).toBe("2*V(a)+1");
  });

  it("rewrites a simple if() to a ternary", () => {
    expect(ifToTernary("if(V(a)>0, 5, 0)")).toBe("((V(a)>0) ? (5) : (0))");
  });

  it("defaults the else branch to 0 for a 2-arg if()", () => {
    expect(ifToTernary("if(V(a)>0, 5)")).toBe("((V(a)>0) ? (5) : (0))");
  });

  it("recurses into nested if()", () => {
    expect(ifToTernary("if(a>0, if(b>0, 1, 2), 3)")).toBe(
      "((a>0) ? (((b>0) ? (1) : (2))) : (3))",
    );
  });

  it("handles commas inside nested function calls in arguments", () => {
    expect(ifToTernary("if(V(a)>0, max(1,2), min(3,4))")).toBe(
      "((V(a)>0) ? (max(1,2)) : (min(3,4)))",
    );
  });

  it("is case-insensitive on the IF keyword", () => {
    expect(ifToTernary("IF(x>0,1,0)")).toBe("((x>0) ? (1) : (0))");
  });

  it("does not touch 'if' embedded in a longer identifier", () => {
    expect(ifToTernary("motif(1,2,3)")).toBe("motif(1,2,3)");
    expect(ifToTernary("Vdiff(1,2)")).toBe("Vdiff(1,2)");
  });

  it("rewrites multiple if()s in one expression", () => {
    expect(ifToTernary("if(a>0,1,0) + if(b>0,2,0)")).toBe(
      "((a>0) ? (1) : (0)) + ((b>0) ? (2) : (0))",
    );
  });

  it("threads through behavioralSpecText", () => {
    expect(behavioralSpecText("V=if(V(in)>2.5, 5, 0)")).toBe("V=((V(in)>2.5) ? (5) : (0))");
  });
});

describe("statFuncsToNgspice", () => {
  it("leaves an expression without statistical functions untouched", () => {
    expect(statFuncsToNgspice("2*V(a)+sin(time)")).toBe("2*V(a)+sin(time)");
  });

  it("rewrites rand(x) to the stepped uniform hash", () => {
    expect(statFuncsToNgspice("rand(time*500)")).toBe(
      "((sin(floor(time*500))*43758.5453)-floor(sin(floor(time*500))*43758.5453))",
    );
  });

  it("rewrites random(x) like rand and white(x) zero-mean", () => {
    expect(statFuncsToNgspice("random(x)")).toBe(
      "((sin(floor(x))*43758.5453)-floor(sin(floor(x))*43758.5453))",
    );
    expect(statFuncsToNgspice("white(x)")).toBe(
      "((sin(floor(x))*43758.5453)-floor(sin(floor(x))*43758.5453)-0.5)",
    );
  });

  it("is case-insensitive and preserves surrounding operators", () => {
    expect(statFuncsToNgspice("RAND(time*250) >= .5")).toBe(
      "((sin(floor(time*250))*43758.5453)-floor(sin(floor(time*250))*43758.5453)) >= .5",
    );
  });

  it("recurses into nested arguments", () => {
    expect(statFuncsToNgspice("rand(rand(x))")).toBe(
      "((sin(floor(((sin(floor(x))*43758.5453)-floor(sin(floor(x))*43758.5453))))*43758.5453)-floor(sin(floor(((sin(floor(x))*43758.5453)-floor(sin(floor(x))*43758.5453))))*43758.5453))",
    );
  });

  it("does not touch longer identifiers or multi-arg calls", () => {
    expect(statFuncsToNgspice("mybrand(1)")).toBe("mybrand(1)");
    expect(statFuncsToNgspice("rand(1,2)")).toBe("rand(1,2)");
  });

  it("threads through behavioralSpecText (PLL.asc's bit-stream source)", () => {
    expect(behavioralSpecText("V=rand(time*500) >= .5")).toBe(
      "V=((sin(floor(time*500))*43758.5453)-floor(sin(floor(time*500))*43758.5453)) >= .5",
    );
  });
});

describe("parseBehavioral", () => {
  it("parses V= and I= prefixes case-insensitively", () => {
    expect(parseBehavioral("V=V(a)*2")).toEqual({ type: "V", expr: "V(a)*2" });
    expect(parseBehavioral("i = I(V1)")).toEqual({ type: "I", expr: "I(V1)" });
    expect(parseBehavioral("  v=V(a)-V(b) ")).toEqual({ type: "V", expr: "V(a)-V(b)" });
  });

  it("defaults a bare expression to V=", () => {
    expect(parseBehavioral("V(in)*3")).toEqual({ type: "V", expr: "V(in)*3" });
  });
});

describe("behavioralSpecText", () => {
  it("normalizes to a canonical ngspice B-source spec", () => {
    expect(behavioralSpecText("v=V(a)+1")).toBe("V=V(a)+1");
    expect(behavioralSpecText("I=I(V1)")).toBe("I=I(V1)");
    expect(behavioralSpecText("2*V(x)")).toBe("V=2*V(x)");
  });

  it("rejects an empty expression body", () => {
    expect(() => behavioralSpecText("V=")).toThrow(/expression/i);
    expect(() => behavioralSpecText("   ")).toThrow(/expression/i);
  });
});

describe("linearizeBehavioral", () => {
  const lin = (value: string, params = {}) =>
    linearizeBehavioral(parseBehavioral(value), params);

  it("extracts a unity summer V=V(a)+V(b)", () => {
    const m = lin("V=V(a)+V(b)");
    expect(m).not.toBeNull();
    expect(m!.type).toBe("V");
    expect(m!.constant).toBeCloseTo(0, 12);
    expect(m!.coeffs.get("a")).toBeCloseTo(1, 12);
    expect(m!.coeffs.get("b")).toBeCloseTo(1, 12);
  });

  it("extracts a difference V=V(a,b)", () => {
    const m = lin("V=V(a,b)");
    expect(m!.coeffs.get("a")).toBeCloseTo(1, 12);
    expect(m!.coeffs.get("b")).toBeCloseTo(-1, 12);
    expect(m!.constant).toBeCloseTo(0, 12);
  });

  it("extracts gain + offset V=2.5*V(in)+1", () => {
    const m = lin("V=2.5*V(in)+1");
    expect(m!.coeffs.get("in")).toBeCloseTo(2.5, 12);
    expect(m!.constant).toBeCloseTo(1, 12);
  });

  it("resolves parameters in the coefficient and constant", () => {
    const m = lin("V=k*V(in)+vos", { k: 4, vos: 0.2 });
    expect(m!.coeffs.get("in")).toBeCloseTo(4, 12);
    expect(m!.constant).toBeCloseTo(0.2, 12);
  });

  it("handles a constant-only expression", () => {
    const m = lin("V=3.3");
    expect(m!.constant).toBeCloseTo(3.3, 12);
    expect(m!.coeffs.size).toBe(0);
  });

  it("returns an I-type model", () => {
    const m = lin("I=1m*V(in)");
    expect(m!.type).toBe("I");
    expect(m!.coeffs.get("in")).toBeCloseTo(1e-3, 12);
  });

  it("rejects products of node voltages (nonlinear)", () => {
    expect(lin("V=V(a)*V(b)")).toBeNull();
    expect(lin("V=2*V(a)*V(b)*V(c)")).toBeNull();
  });

  it("rejects powers of node voltages", () => {
    expect(lin("V=V(a)^2")).toBeNull();
  });

  it("rejects time-dependent expressions", () => {
    expect(lin("V=.5+2.5*V(in)*sin(time)")).toBeNull();
    expect(lin("V=V(rf)*(1+sin(2*pi*50K*time))")).toBeNull();
  });

  it("rejects current-controlled expressions", () => {
    expect(lin("I=I(V1)")).toBeNull();
  });

  it("rejects expressions with unresolved parameters", () => {
    expect(lin("V=unknown_param*V(in)")).toBeNull();
  });
});
