import { describe, it, expect } from "vitest";
import { standardModelLine, standardModelNames } from "./standardModels";

describe("standardModelLine", () => {
  it("returns the LTspice 1N4148 diode model line", () => {
    const line = standardModelLine("1N4148");
    expect(line).toMatch(/^\.model 1N4148 D\(/);
    expect(line).toContain("Is=2.52n");
  });

  it("is case-insensitive", () => {
    expect(standardModelLine("1n4148")).toBe(standardModelLine("1N4148"));
    expect(standardModelLine("2n2222")).toMatch(/NPN\(/);
  });

  it("ignores trailing tokens (only the first token is the model name)", () => {
    expect(standardModelLine("1N4148 AC 1")).toMatch(/^\.model 1N4148/);
  });

  it("returns null for an unknown model name", () => {
    expect(standardModelLine("NOT_A_REAL_PART")).toBeNull();
    expect(standardModelLine("")).toBeNull();
  });

  it("bundles npn and pnp BJTs with the right model type", () => {
    expect(standardModelLine("2N3904")).toMatch(/NPN\(/);
    expect(standardModelLine("2N3906")).toMatch(/PNP\(/);
  });

  it("bundles zeners with a breakdown voltage", () => {
    expect(standardModelLine("1N750")).toContain("Bv=4.7");
  });

  it("every bundled line is a well-formed .model and the name matches the key", () => {
    for (const name of standardModelNames()) {
      const line = standardModelLine(name);
      expect(line).not.toBeNull();
      const declared = /^\.model\s+(\S+)/i.exec(line!)?.[1]?.toLowerCase();
      expect(declared).toBe(name);
    }
  });
});
