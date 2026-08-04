// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { resolveCssColorHex, sameCssColor } from "./cssColor";

function setVar(name: string, value: string): void {
  document.documentElement.style.setProperty(name, value);
}

afterEach(() => {
  document.documentElement.removeAttribute("style");
});

describe("resolveCssColorHex", () => {
  it("passes a six-digit hex through, lowercased", () => {
    expect(resolveCssColorHex("#AABBCC")).toBe("#aabbcc");
  });

  it("expands a three-digit hex", () => {
    expect(resolveCssColorHex("#7ac")).toBe("#77aacc");
  });

  it("converts rgb() in both comma and space spellings", () => {
    expect(resolveCssColorHex("rgb(125, 211, 252)")).toBe("#7dd3fc");
    expect(resolveCssColorHex("rgb(125 211 252)")).toBe("#7dd3fc");
    expect(resolveCssColorHex("rgba(125, 211, 252, 0.5)")).toBe("#7dd3fc");
  });

  it("clamps and rounds out-of-range channels", () => {
    expect(resolveCssColorHex("rgb(-20, 255.6, 300)")).toBe("#00ffff");
  });

  it("resolves a CSS variable through the document", () => {
    setVar("--trace-cyan", "#7dd3fc");
    expect(resolveCssColorHex("var(--trace-cyan)")).toBe("#7dd3fc");
  });

  it("resolves a variable that computes to rgb()", () => {
    setVar("--trace-green", "rgb(34, 197, 94)");
    expect(resolveCssColorHex("var(--trace-green)")).toBe("#22c55e");
  });

  it("uses the declared var() fallback when the property is unset", () => {
    expect(resolveCssColorHex("var(--not-defined, #123456)")).toBe("#123456");
  });

  it("returns the caller's fallback for an undefined variable and a named color", () => {
    expect(resolveCssColorHex("var(--nope)", "#010203")).toBe("#010203");
    expect(resolveCssColorHex("rebeccapurple", "#010203")).toBe("#010203");
    expect(resolveCssColorHex("", "#010203")).toBe("#010203");
  });

  it("does not loop forever on a self-referential variable", () => {
    setVar("--loop", "var(--loop)");
    expect(resolveCssColorHex("var(--loop)", "#010203")).toBe("#010203");
  });
});

describe("sameCssColor", () => {
  it("matches a variable against the hex it resolves to", () => {
    setVar("--trace-cyan", "#7dd3fc");
    expect(sameCssColor("var(--trace-cyan)", "#7dd3fc")).toBe(true);
  });

  it("separates two different colors", () => {
    setVar("--trace-cyan", "#7dd3fc");
    setVar("--trace-green", "#22c55e");
    expect(sameCssColor("var(--trace-cyan)", "var(--trace-green)")).toBe(false);
  });

  it("does not collapse two unresolvable colors onto one fallback", () => {
    // Both resolve to the fallback; treating them as equal would wrongly mark
    // an unrelated swatch as already taken.
    expect(sameCssColor("var(--missing-a)", "var(--missing-b)")).toBe(false);
  });

  it("is reflexive for identical strings even when unresolvable", () => {
    expect(sameCssColor("var(--missing-a)", "var(--missing-a)")).toBe(true);
  });
});
