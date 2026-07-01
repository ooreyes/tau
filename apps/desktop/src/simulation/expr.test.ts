import { describe, it, expect } from "vitest";
import { evaluateExpression, parse } from "./expr";

const ev = (s: string, scope = {}, funcs = {}) => evaluateExpression(s, scope, funcs);

describe("evaluateExpression — arithmetic", () => {
  it("adds, subtracts, multiplies, divides", () => {
    expect(ev("2+3")).toBe(5);
    expect(ev("10-4")).toBe(6);
    expect(ev("6*7")).toBe(42);
    expect(ev("20/5")).toBe(4);
  });

  it("respects operator precedence", () => {
    expect(ev("2+3*4")).toBe(14);
    expect(ev("(2+3)*4")).toBe(20);
    expect(ev("2+3*4-10/2")).toBe(9);
  });

  it("handles modulo", () => {
    expect(ev("17%5")).toBe(2);
  });

  it("power is right-associative and binds tighter than unary minus", () => {
    expect(ev("2^3")).toBe(8);
    expect(ev("2**3")).toBe(8);
    expect(ev("-2^2")).toBe(-4); // -(2^2)
    expect(ev("2^-2")).toBe(0.25);
    expect(ev("2^3^2")).toBe(512); // 2^(3^2) = 2^9
  });

  it("handles unary plus/minus and double negation", () => {
    expect(ev("-5")).toBe(-5);
    expect(ev("--5")).toBe(5);
    expect(ev("+7")).toBe(7);
    expect(ev("3 - -2")).toBe(5);
  });
});

describe("evaluateExpression — SI-suffixed literals", () => {
  it("parses k, meg, m, u, n, p", () => {
    expect(ev("1k")).toBe(1000);
    expect(ev("2.2meg")).toBe(2.2e6);
    expect(ev("1m")).toBeCloseTo(1e-3, 18);
    expect(ev("10u")).toBeCloseTo(1e-5, 18);
    expect(ev("4.7n")).toBeCloseTo(4.7e-9, 18);
    expect(ev("100p")).toBeCloseTo(1e-10, 18);
  });

  it("distinguishes m (milli) from meg (mega)", () => {
    expect(ev("5m")).toBeCloseTo(5e-3, 18);
    expect(ev("5meg")).toBe(5e6);
  });

  it("handles mil (25.4 micron)", () => {
    expect(ev("1mil")).toBeCloseTo(25.4e-6, 18);
  });

  it("ignores a trailing unit after the SI prefix", () => {
    expect(ev("1kOhm")).toBe(1000);
    expect(ev("5V")).toBe(5);
  });

  it("parses scientific notation", () => {
    expect(ev("1e3")).toBe(1000);
    expect(ev("4.7e-9")).toBeCloseTo(4.7e-9, 20);
    expect(ev("1.5e6")).toBe(1.5e6);
  });

  it("combines suffixed literals in arithmetic", () => {
    expect(ev("2k*3")).toBe(6000);
    expect(ev("1/(2*pi*1k*1u)")).toBeCloseTo(1 / (2 * Math.PI * 1000 * 1e-6), 12);
  });
});

describe("evaluateExpression — variables & constants", () => {
  it("resolves scope variables", () => {
    expect(ev("R*2", { R: 1000 })).toBe(2000);
    expect(ev("vdd - vee", { vdd: 5, vee: -5 })).toBe(10);
  });

  it("is case-insensitive for variable lookup", () => {
    expect(ev("FREQ", { freq: 60 })).toBe(60);
    expect(ev("Vcc", { vcc: 3.3 })).toBeCloseTo(3.3, 12);
  });

  it("knows pi and e", () => {
    expect(ev("pi")).toBeCloseTo(Math.PI, 12);
    expect(ev("e")).toBeCloseTo(Math.E, 12);
    expect(ev("2*pi*60")).toBeCloseTo(2 * Math.PI * 60, 9);
  });

  it("throws on unknown variable", () => {
    expect(() => ev("nope")).toThrow();
  });
});

describe("evaluateExpression — functions", () => {
  it("evaluates trig and exp/log", () => {
    expect(ev("sin(0)")).toBe(0);
    expect(ev("cos(0)")).toBe(1);
    expect(ev("sqrt(16)")).toBe(4);
    expect(ev("exp(0)")).toBe(1);
    expect(ev("ln(e)")).toBeCloseTo(1, 12);
    expect(ev("log10(1000)")).toBeCloseTo(3, 12);
  });

  it("evaluates abs, sgn, min, max, floor, ceil, round", () => {
    expect(ev("abs(-3)")).toBe(3);
    expect(ev("sgn(-2)")).toBe(-1);
    expect(ev("sgn(0)")).toBe(0);
    expect(ev("min(3,7)")).toBe(3);
    expect(ev("max(3,7,5)")).toBe(7);
    expect(ev("floor(2.9)")).toBe(2);
    expect(ev("ceil(2.1)")).toBe(3);
    expect(ev("round(2.5)")).toBe(3);
  });

  it("evaluates pow / pwr / pwrs", () => {
    expect(ev("pow(2,10)")).toBe(1024);
    expect(ev("pwr(-2,2)")).toBe(4); // |x|^a
    expect(ev("pwrs(-2,3)")).toBe(-8); // sgn(x)*|x|^a
  });

  it("evaluates if() and limit()", () => {
    expect(ev("if(1,10,20)")).toBe(10);
    expect(ev("if(0,10,20)")).toBe(20);
    expect(ev("limit(15,0,10)")).toBe(10);
    expect(ev("limit(-3,0,10)")).toBe(0);
    expect(ev("limit(5,0,10)")).toBe(5);
  });

  it("evaluates table() with linear interpolation and clamping", () => {
    expect(ev("table(0, 0,0, 10,100)")).toBe(0);
    expect(ev("table(5, 0,0, 10,100)")).toBe(50);
    expect(ev("table(10, 0,0, 10,100)")).toBe(100);
    expect(ev("table(-1, 0,0, 10,100)")).toBe(0); // clamp low
    expect(ev("table(99, 0,0, 10,100)")).toBe(100); // clamp high
  });

  it("evaluates inverse hyperbolics and arc* aliases", () => {
    expect(ev("asinh(0)")).toBe(0);
    expect(ev("acosh(1)")).toBe(0);
    expect(ev("atanh(0)")).toBe(0);
    expect(ev("asinh(sinh(1.5))")).toBeCloseTo(1.5, 12);
    expect(ev("arcsin(1)")).toBeCloseTo(Math.PI / 2, 12);
    expect(ev("arccos(1)")).toBe(0);
    expect(ev("arctan(1)")).toBeCloseTo(Math.PI / 4, 12);
  });

  it("evaluates nint and db", () => {
    expect(ev("nint(2.4)")).toBe(2);
    expect(ev("nint(2.6)")).toBe(3);
    expect(ev("db(10)")).toBeCloseTo(20, 12); // 20·log10(10)
    expect(ev("db(0.1)")).toBeCloseTo(-20, 12);
    expect(ev("db(-100)")).toBeCloseTo(40, 12); // |x|
  });

  it("evaluates boolean functions and/or/not/xor", () => {
    expect(ev("and(1,1)")).toBe(1);
    expect(ev("and(1,0)")).toBe(0);
    expect(ev("or(0,1)")).toBe(1);
    expect(ev("or(0,0)")).toBe(0);
    expect(ev("not(0)")).toBe(1);
    expect(ev("not(1)")).toBe(0);
    expect(ev("xor(1,0)")).toBe(1);
    expect(ev("xor(1,1)")).toBe(0);
    // Operands are thresholded at 0.5 like buf/inv (logic-level inputs).
    expect(ev("and(0.9,0.8)")).toBe(1);
    expect(ev("and(0.3,0.9)")).toBe(0);
  });

  it("throws on unknown function", () => {
    expect(() => ev("bogus(1)")).toThrow();
  });

  it("evaluates LTspice statistical functions at their nominal (mean) value", () => {
    // Tau runs a single deterministic analysis: mc(x,tol) → x, gauss/flat → 0,
    // rand/random → 0.5. This unblocks MonteCarlo.asc and any value built with
    // these instead of throwing on an unknown function.
    expect(ev("mc(100, .1)")).toBe(100);
    expect(ev("mc(4.7k, 0.05)")).toBe(4700);
    expect(ev("gauss(0.3)")).toBe(0);
    expect(ev("flat(2)")).toBe(0);
    expect(ev("rand(7)")).toBe(0.5);
    expect(ev("random(1)")).toBe(0.5);
    expect(ev("white(1)")).toBe(0);
    // Usable inside a larger expression, as real circuits write it.
    expect(ev("10k*(1+mc(0,.01))")).toBe(10000);
  });
});

describe("evaluateExpression — comparisons, logic, ternary", () => {
  it("evaluates comparisons to 1/0", () => {
    expect(ev("3 > 2")).toBe(1);
    expect(ev("3 < 2")).toBe(0);
    expect(ev("5 >= 5")).toBe(1);
    expect(ev("5 == 5")).toBe(1);
    expect(ev("5 != 5")).toBe(0);
  });

  it("evaluates logical and/or with short-circuit", () => {
    expect(ev("1 && 0")).toBe(0);
    expect(ev("1 || 0")).toBe(1);
    expect(ev("(2>1) && (3>2)")).toBe(1);
  });

  it("evaluates ternary", () => {
    expect(ev("3>2 ? 100 : 200")).toBe(100);
    expect(ev("3<2 ? 100 : 200")).toBe(200);
  });
});

describe("evaluateExpression — user .func", () => {
  it("calls a user function with bound args", () => {
    const funcs = { sq: { params: ["x"], body: "x*x" } };
    expect(ev("sq(5)", {}, funcs)).toBe(25);
  });

  it("user function sees outer scope params", () => {
    const funcs = { scaled: { params: ["x"], body: "x*gain" } };
    expect(ev("scaled(4)", { gain: 3 }, funcs)).toBe(12);
  });

  it("nested user functions resolve", () => {
    const funcs = {
      sq: { params: ["x"], body: "x*x" },
      quad: { params: ["x"], body: "sq(x)+1" },
    };
    expect(ev("quad(3)", {}, funcs)).toBe(10);
  });

  it("throws on wrong arg count", () => {
    const funcs = { sq: { params: ["x"], body: "x*x" } };
    expect(() => ev("sq(1,2)", {}, funcs)).toThrow();
  });
});

describe("parse — error handling", () => {
  it("throws on empty expression", () => {
    expect(() => parse("")).toThrow();
  });
  it("throws on unbalanced parens", () => {
    expect(() => parse("(1+2")).toThrow();
  });
  it("throws on trailing tokens", () => {
    expect(() => parse("1 2")).toThrow();
  });
  it("throws on stray operator", () => {
    expect(() => parse("1 +")).toThrow();
  });
});
