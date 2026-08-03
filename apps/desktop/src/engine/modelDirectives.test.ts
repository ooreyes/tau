import { describe, it, expect } from "vitest";
import { modelLibLinesFromDirectives, definedModelNames, definedModelTypes } from "./modelDirectives";

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

  it("rewrites LTspice lateral LPNP/LNPN to ngspice PNP/NPN (LM741/LM308)", () => {
    expect(modelLibLinesFromDirectives([".model PN LPNP(BF=25 Cje=.3p Rb=250)"])).toEqual([
      ".model PN PNP(BF=25 Cje=.3p Rb=250)",
    ]);
    expect(modelLibLinesFromDirectives([".model LX lnpn(Bf=100)"])).toEqual([".model LX NPN(Bf=100)"]);
    // Each line of a multi-model block is translated independently.
    expect(modelLibLinesFromDirectives([".model A LPNP(Bf=1)\\n.model B NPN(Bf=2)"])).toEqual([
      ".model A PNP(Bf=1)",
      ".model B NPN(Bf=2)",
    ]);
    // A plain PNP/NPN and a model whose *name* starts with L are untouched.
    expect(modelLibLinesFromDirectives([".model LPN PNP(Bf=3)"])).toEqual([".model LPN PNP(Bf=3)"]);
  });

  it("translates LTspice VSWITCH/ISWITCH cards, including their thresholds", () => {
    expect(modelLibLinesFromDirectives([
      ".model VS VSWITCH(Ron=.1 Roff=1Meg Von=.8 Voff=.2)",
      ".model CS ISWITCH(Ron=.2 Roff=2Meg Ion=3m Ioff=1m)",
    ])).toEqual([
      ".model VS SW(RON=.1 ROFF=1Meg VT=0.5 VH=0.3)",
      ".model CS CSW(RON=.2 ROFF=2Meg IT=0.002 IH=0.001)",
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

  it("keeps a .subckt block split across separate LTspice TEXT records", () => {
    expect(modelLibLinesFromDirectives([
      ".subckt cell in out params: r=1k",
      "R1 in out {r}",
      ".model clamp D(Is=1n)",
      ".ends cell",
      ".tran 1m",
    ])).toEqual([
      ".subckt cell in out params: r=1k",
      "R1 in out {r}",
      ".model clamp D(Is=1n)",
      ".ends cell",
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

  it("keeps a .model that shares a TEXT block with analysis lines (SoftDiodeRecovery)", () => {
    const block = ".tran 0 60u\\n.model X D(Rs=0 Is=1e-10 tt=3u Vp={Vp} Cjo=10n)\\n.step param Vp list 0 .2 .4";
    expect(modelLibLinesFromDirectives([block])).toEqual([
      ".model X D(Rs=0 Is=1e-10 tt=3u Vp={Vp} Cjo=10n)",
    ]);
  });

  it("does not leak analysis lines out of a model-led block", () => {
    expect(modelLibLinesFromDirectives([".model A NPN(Bf=1)\\n.tran 1m"])).toEqual([
      ".model A NPN(Bf=1)",
    ]);
  });

  it("finds a .subckt block opened by * comment lines (UHFpreamp's MRF901)", () => {
    const block =
      "* Model Copyright 1991\\n* Courtesy of someone\\n.subckt MRF901 1 2 3\\nLc 1 4 0.451n\\nQ1 4 6 5 QR99\\n.model QR99 NPN(BF=88 VAF=120\\n+ ITF=.02 VTF=4.95)\\n.ends MRF901";
    expect(modelLibLinesFromDirectives([block])).toEqual([
      ".subckt MRF901 1 2 3",
      "Lc 1 4 0.451n",
      "Q1 4 6 5 QR99",
      ".model QR99 NPN(BF=88 VAF=120",
      "+ ITF=.02 VTF=4.95)",
      ".ends MRF901",
    ]);
  });

  it("keeps + continuations of an emitted .model, drops those of a skipped line", () => {
    expect(
      modelLibLinesFromDirectives([
        ".model 2N344 PNP(Is=1e-10 bf=11\\n+ Eg=.67 Rb=100 Re=10)",
        ".tran 1m\\n+ 2m",
      ]),
    ).toEqual([".model 2N344 PNP(Is=1e-10 bf=11", "+ Eg=.67 Rb=100 Re=10)"]);
  });

  it("tracks nested .subckt blocks to the outer .ends", () => {
    const block = ".subckt outer a b\\n.subckt inner c d\\nR1 c d 1k\\n.ends inner\\nX1 a b inner\\n.ends outer\\n.tran 1m";
    expect(modelLibLinesFromDirectives([block])).toEqual([
      ".subckt outer a b",
      ".subckt inner c d",
      "R1 c d 1k",
      ".ends inner",
      "X1 a b inner",
      ".ends outer",
    ]);
  });

  it("does not treat a node named 'model...' in another directive as a block", () => {
    // .meas keyword is not a block kind even though a token contains 'model'.
    expect(modelLibLinesFromDirectives([".meas tran x FIND V(modelnode) AT=1m"])).toEqual([]);
  });

  it("strips word-valued informational diode params ngspice rejects (P2's type=silicon)", () => {
    expect(modelLibLinesFromDirectives([".model 1N484 D(Rs=3 Cjo=4p type=silicon)"])).toEqual([
      ".model 1N484 D(Rs=3 Cjo=4p)",
    ]);
    expect(modelLibLinesFromDirectives([".model DX D(type=germanium mfg=OnSemi Is=1n)"])).toEqual([
      ".model DX D(Is=1n)",
    ]);
  });

  it("leaves non-diode models and numeric diode params alone", () => {
    expect(modelLibLinesFromDirectives([".model M NPN(Bf=10 mfg=X)"])).toEqual([
      ".model M NPN(Bf=10 mfg=X)",
    ]);
    expect(modelLibLinesFromDirectives([".model D1 D(Is=1n Vpk=30)"])).toEqual([
      ".model D1 D(Is=1n Vpk=30)",
    ]);
  });
});

describe("definedModelNames", () => {
  it("collects .model and .subckt names, lower-cased", () => {
    const names = definedModelNames([
      ".model 1N4148 D(Is=2.5n)",
      ".subckt LM358 1 2 3",
      ".tran 1m",
    ]);
    expect(names).toEqual(new Set(["1n4148", "lm358"]));
  });

  it("reads names from a multi-line block", () => {
    const names = definedModelNames([".subckt amp in out\\nR1 in out 1k\\n.ends"]);
    expect(names.has("amp")).toBe(true);
  });

  it("handles a model name immediately followed by its type paren", () => {
    expect(definedModelNames([".model Q2N(NPN(Bf=100))"]).has("q2n")).toBe(true);
  });

  it("returns an empty set when no models are defined", () => {
    expect(definedModelNames([".tran 1m", ".param x=1"]).size).toBe(0);
  });
});

describe("definedModelTypes", () => {
  it("maps each model name to its (lower-cased) type token", () => {
    const types = definedModelTypes([
      ".model 1N4148 D(Is=2.5n)",
      ".model RSR015P06 VDMOS(pchan Vto=-2)",
      ".model Q2N2222 NPN(Bf=200)",
    ]);
    expect(types.get("1n4148")).toBe("d");
    expect(types.get("rsr015p06")).toBe("vdmos");
    expect(types.get("q2n2222")).toBe("npn");
  });

  it("reads a model type with no space before the opening paren", () => {
    expect(definedModelTypes([".model M1 VDMOS(Vto=2)"]).get("m1")).toBe("vdmos");
    // a paren immediately after the type still parses the bare type token
    expect(definedModelTypes([".model M2 NMOS(level=1)"]).get("m2")).toBe("nmos");
  });

  it("ignores .subckt (which has no model type) and non-model directives", () => {
    const types = definedModelTypes([".subckt amp in out", ".tran 1m", ".param x=1"]);
    expect(types.size).toBe(0);
  });

  it("reads model types from a multi-line block, leading '.'/'!' tolerated", () => {
    const types = definedModelTypes(["!model PWR VDMOS(Rd=20m)\\n.model SW NMOS(Vto=1)"]);
    expect(types.get("pwr")).toBe("vdmos");
    expect(types.get("sw")).toBe("nmos");
  });
});
