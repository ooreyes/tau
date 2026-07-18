import { describe, it, expect } from "vitest";
import { standardModelLine, standardModelNames, standardModelType } from "./standardModels";

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

  it("bundles the class-d power VDMOS pair with the vdmos type", () => {
    // Verbatim from LTspice standard.mos except Cgso→Cgs (ngspice's name) and
    // the mfg/Vds/Ron/Qg annotation keys stripped.
    expect(standardModelLine("QS6K1")).toMatch(/VDMOS\(Rg=45/);
    expect(standardModelLine("RSR015P06")).toMatch(/VDMOS\(pchan/);
    expect(standardModelLine("QS6K1")).not.toContain("Cgso");
    expect(standardModelType("QS6K1")).toBe("vdmos");
    expect(standardModelType("RSR015P06")).toBe("vdmos");
  });

  it("bundles zeners with a breakdown voltage", () => {
    expect(standardModelLine("1N750")).toContain("Bv=4.7");
  });

  it("bundles N- and P-channel JFETs with the right model type", () => {
    expect(standardModelLine("2N3819")).toMatch(/NJF\(/);
    expect(standardModelLine("J309")).toMatch(/NJF\(/);
    expect(standardModelLine("2N5460")).toMatch(/PJF\(/);
    expect(standardModelLine("J175")).toMatch(/PJF\(/);
    // LTspice-only Alpha/Vk are deliberately stripped: ngspice ignores them
    // but emits a user-visible model warning if either remains.
    for (const name of ["2N3819", "J309", "J310", "2N5484", "2N5486", "2N5460", "J175"]) {
      expect(standardModelLine(name)).not.toMatch(/\b(?:Alpha|Vk)=/i);
    }
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
