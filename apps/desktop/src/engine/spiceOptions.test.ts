import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPTIONS,
  parseOptionsDirectives,
  mergeOptionsLine,
  optionsLineFromDirectives,
  shuntForMaxResistance,
} from "./spiceOptions";

describe("parseOptionsDirectives", () => {
  it("parses key=value settings, lower-casing keys", () => {
    expect(parseOptionsDirectives([".options Reltol=1e-3 ABSTOL=1e-9"])).toEqual({
      reltol: "1e-3",
      abstol: "1e-9",
    });
  });

  it("accepts the singular .option spelling and bare flags", () => {
    expect(parseOptionsDirectives([".option noopiter gmin=1e-9"])).toEqual({
      noopiter: "",
      gmin: "1e-9",
    });
  });

  it("merges multiple lines with later values winning", () => {
    expect(parseOptionsDirectives([".options reltol=1e-3", ".options reltol=5e-4 maxstep=1n"])).toEqual({
      reltol: "5e-4",
      maxstep: "1n",
    });
  });

  it("ignores non-.options directives", () => {
    expect(parseOptionsDirectives([".tran 1m", ".param x=1", ";comment"])).toEqual({});
  });

  it("tolerates leading ! and . and comma separators", () => {
    expect(parseOptionsDirectives(["!.options reltol=1e-3,abstol=1e-9"])).toEqual({
      reltol: "1e-3",
      abstol: "1e-9",
    });
  });
});

describe("mergeOptionsLine", () => {
  it("emits the defaults when no overrides are given", () => {
    expect(mergeOptionsLine({})).toBe(`.options gmin=${DEFAULT_OPTIONS.gmin} reltol=${DEFAULT_OPTIONS.reltol} abstol=${DEFAULT_OPTIONS.abstol} vntol=${DEFAULT_OPTIONS.vntol} rshunt=${DEFAULT_OPTIONS.rshunt} rseries=${DEFAULT_OPTIONS.rseries}`);
  });

  it("includes LTspice's default 1 mΩ inductor series resistance, overridable", () => {
    // LTspice defaults every inductor without an explicit Rser to 1 mΩ; the
    // matching ngspice rseries also un-degenerates pure-L loops at DC
    // (Cohn/passive/varactor2 "singular matrix" op failures).
    expect(mergeOptionsLine({})).toContain("rseries=1e-3");
    expect(mergeOptionsLine({ rseries: "0" })).toContain("rseries=0");
    expect(optionsLineFromDirectives([".options rseries=1u"])).toContain("rseries=1u");
  });

  it("lets the document override a default in place", () => {
    const line = mergeOptionsLine({ reltol: "1e-3" });
    expect(line).toContain("reltol=1e-3");
    expect(line).not.toContain("reltol=1e-4");
    // Other defaults are still present.
    expect(line).toContain("gmin=1e-12");
  });

  it("scales the node shunt to the circuit's own impedance", () => {
    // The shunt's error on a node voltage is 0.5·R/rshunt, so what has to stay
    // large is the RATIO. Pinned at 1e12 a 1:1 divider built from 1 TΩ legs
    // read 0.333 V instead of 0.5 - a 33% error, measured against the real
    // engine in spice.rs's `accuracy_high_impedance_divider_*` test.
    //
    // Below a megohm nothing moves: those decks already solve and must keep
    // the exact deck they had.
    expect(shuntForMaxResistance(1e3)).toBe("1e12");
    expect(shuntForMaxResistance(1e6)).toBe("1e12");
    // Above it, the shunt follows the circuit up, a decade at a time.
    expect(shuntForMaxResistance(1e7)).toBe("1e13");
    expect(shuntForMaxResistance(1e9)).toBe("1e15");
    expect(shuntForMaxResistance(1e12)).toBe("1e18");
    // ...but stops at 1e18. Beyond that the shunt is too weak to be a DC
    // return and a floating node solves to a confident wrong answer (0.99 V
    // where 0 V was correct, at 1e21).
    expect(shuntForMaxResistance(1e15)).toBe("1e18");
    expect(shuntForMaxResistance(Number.POSITIVE_INFINITY)).toBe("1e12");
    expect(shuntForMaxResistance(0)).toBe("1e12");
    expect(shuntForMaxResistance(Number.NaN)).toBe("1e12");
  });

  it("keeps the scaled shunt underneath Settings and the document", () => {
    // Precedence is the whole point of the three-way merge: a schematic that
    // pins rshunt was authored to simulate that way.
    expect(optionsLineFromDirectives([], {}, 1e12)).toContain("rshunt=1e18");
    expect(optionsLineFromDirectives([], { rshunt: "1e14" }, 1e12)).toContain("rshunt=1e14");
    expect(optionsLineFromDirectives([".options rshunt=1e9"], { rshunt: "1e14" }, 1e12))
      .toContain("rshunt=1e9");
  });

  it("includes a default rshunt the document can override (floating-node DC path)", () => {
    expect(mergeOptionsLine({})).toContain("rshunt=1e12");
    // A circuit that wants tighter/looser leakage wins.
    expect(mergeOptionsLine({ rshunt: "1e9" })).toContain("rshunt=1e9");
    expect(optionsLineFromDirectives([".options rshunt=0"])).toContain("rshunt=0");
  });

  it("appends document-only options after the defaults, flags bare", () => {
    const line = mergeOptionsLine({ maxstep: "1n", noopiter: "" });
    expect(line.startsWith(".options gmin=1e-12 reltol=1e-4 abstol=1e-12 vntol=1e-7")).toBe(true);
    expect(line.endsWith("maxstep=1n noopiter")).toBe(true);
  });
});

describe("optionsLineFromDirectives", () => {
  it("parses then merges in one step", () => {
    expect(optionsLineFromDirectives([".options reltol=2e-3"])).toContain("reltol=2e-3");
  });
});
