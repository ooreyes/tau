import { describe, it, expect } from "vitest";
import { modelLibLinesFromDirectives } from "./modelDirectives";

describe("modelLibLinesFromDirectives", () => {
  it("passes a single .model line through verbatim", () => {
    expect(modelLibLinesFromDirectives([".model MyDiode D(Is=1e-15 N=1.2)"])).toEqual([
      ".model MyDiode D(Is=1e-15 N=1.2)",
    ]);
  });

  it("ignores analysis, param, and option directives", () => {
    expect(
      modelLibLinesFromDirectives([
        ".tran 1u 1m",
        ".param Rload=4.7k",
        ".options reltol=1e-4",
        ".ac dec 10 1 1Meg",
        ".meas tran vpp PP V(out)",
      ]),
    ).toEqual([]);
  });

  it("normalizes the .inc alias to .include", () => {
    expect(modelLibLinesFromDirectives([".inc mymodels.lib"])).toEqual([".include mymodels.lib"]);
  });

  it("keeps .lib (with optional section) verbatim", () => {
    expect(modelLibLinesFromDirectives([".lib /path/to/std.lib NMOS"])).toEqual([
      ".lib /path/to/std.lib NMOS",
    ]);
  });

  it("re-prefixes a missing leading dot on the opening keyword", () => {
    expect(modelLibLinesFromDirectives(["model FastNPN NPN(Bf=250)"])).toEqual([
      ".model FastNPN NPN(Bf=250)",
    ]);
  });

  it("expands a multi-line .subckt block on the LTspice \\n escape", () => {
    const block = ".subckt myamp in out vcc\\nR1 in n1 1k\\nC1 n1 0 1n\\n.ends myamp";
    expect(modelLibLinesFromDirectives([block])).toEqual([
      ".subckt myamp in out vcc",
      "R1 in n1 1k",
      "C1 n1 0 1n",
      ".ends myamp",
    ]);
  });

  it("drops blank physical lines inside a block", () => {
    const block = ".subckt s a b\\n\\nR1 a b 10\\n\\n.ends";
    expect(modelLibLinesFromDirectives([block])).toEqual([".subckt s a b", "R1 a b 10", ".ends"]);
  });

  it("preserves document order across multiple directives", () => {
    expect(
      modelLibLinesFromDirectives([
        ".model A NPN(Bf=100)",
        ".tran 1m",
        ".model B PNP(Bf=50)",
        ".lib parts.lib",
      ]),
    ).toEqual([".model A NPN(Bf=100)", ".model B PNP(Bf=50)", ".lib parts.lib"]);
  });

  it("tolerates an empty directive list", () => {
    expect(modelLibLinesFromDirectives([])).toEqual([]);
  });

  it("does not treat a node named 'model...' in another directive as a block", () => {
    // .meas keyword is not a block kind even though a token contains 'model'.
    expect(modelLibLinesFromDirectives([".meas tran x FIND V(modelnode) AT=1m"])).toEqual([]);
  });
});
