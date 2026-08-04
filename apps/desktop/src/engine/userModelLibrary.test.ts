import { describe, expect, it } from "vitest";
import { parseUserModelLibraries, resolveUserModel, resolveUserSubckt } from "./userModelLibrary";

describe("parseUserModelLibraries", () => {
  it("registers a .model and a .subckt block under lower-cased names", () => {
    const text = [
      "* Acme vendor diode library",
      ".model MyDiode D(Is=1e-14 N=1.05 Rs=0.5)",
      "",
      ".subckt MyBlock in out",
      "R1 in out 1k",
      ".ends MyBlock",
    ].join("\n");
    const registry = parseUserModelLibraries([text]);
    expect(registry.models.get("mydiode")).toBe(".model MyDiode D(Is=1e-14 N=1.05 Rs=0.5)");
    expect(registry.subckts.get("myblock")).toBe(".subckt MyBlock in out\nR1 in out 1k\n.ends MyBlock");
  });

  it("looks up model and subckt names case-insensitively", () => {
    const registry = parseUserModelLibraries([
      ".model MyDiode D(Is=1e-14)\n.subckt MyBlock in out\nR1 in out 1k\n.ends MyBlock",
    ]);
    expect(resolveUserModel(registry, "MYDIODE")).toBe(".model MyDiode D(Is=1e-14)");
    expect(resolveUserModel(registry, "mydiode")).toBe(".model MyDiode D(Is=1e-14)");
    expect(resolveUserSubckt(registry, "MYBLOCK")).toContain(".subckt MyBlock in out");
    expect(resolveUserSubckt(registry, "myblock")).toContain(".subckt MyBlock in out");
  });

  it("tolerates a lookup value that carries trailing tokens after the name", () => {
    const registry = parseUserModelLibraries([".model MyDiode D(Is=1e-14)"]);
    expect(resolveUserModel(registry, "MyDiode extra tokens")).toBe(".model MyDiode D(Is=1e-14)");
  });

  it("folds a `+` continuation into one ngspice-valid logical .model line", () => {
    const text = ".model MyDiode D(Is=1e-14\n+ N=1.05\n+ Rs=0.5)";
    const registry = parseUserModelLibraries([text]);
    expect(registry.models.get("mydiode")).toBe(".model MyDiode D(Is=1e-14 N=1.05 Rs=0.5)");
  });

  it("drops LTspice string-valued annotation params ngspice rejects, keeping numeric ones", () => {
    // A real LTspice `.model` card carries datasheet annotations; `mfg=STMicro`
    // is a bare word ngspice fatally rejects, while `Vceo=60`/`Icrating=10` are
    // numeric and only warned-and-ignored. Only the string one is removed.
    const registry = parseUserModelLibraries([
      ".model 2N3055 NPN(Bf=73 Is=2.37E-8 Vceo=60 Icrating=10 mfg=STMicro)",
    ]);
    const line = registry.models.get("2n3055");
    expect(line).toBe(".model 2N3055 NPN(Bf=73 Is=2.37E-8 Vceo=60 Icrating=10)");
    expect(line).not.toMatch(/mfg/i);
  });

  it("strips a string annotation even when it is the first parameter", () => {
    const registry = parseUserModelLibraries([".model P D(type=std Is=1e-14 N=1.05)"]);
    // The name, type keyword, closing paren, and numeric params stay intact.
    expect(registry.models.get("p")).toBe(".model P D(Is=1e-14 N=1.05)");
  });

  it("keeps negative and suffixed numeric parameters (never mistaken for annotations)", () => {
    const registry = parseUserModelLibraries([
      ".model M NMOS(Vto=-0.328 Kp=10E-6 Tr=.5703U Cjo=1000P)",
    ]);
    expect(registry.models.get("m")).toBe(".model M NMOS(Vto=-0.328 Kp=10E-6 Tr=.5703U Cjo=1000P)");
  });

  it("sanitizes a dashed subckt name the same way bundledSubcircuits does", () => {
    const registry = parseUserModelLibraries([
      ".subckt my-block in out\nR1 in out 1k\n.ends my-block",
    ]);
    expect(registry.subckts.has("my_block")).toBe(true);
    expect(resolveUserSubckt(registry, "my-block")).toContain(".subckt my-block in out");
  });

  it("ignores comments, blank lines, and .include/.lib lines", () => {
    const text = [
      "* header comment",
      ".include vendor_extra.lib",
      ".lib vendor_extra.lib",
      "",
      ".model MyDiode D(Is=1e-14) ; trailing comment",
    ].join("\n");
    const registry = parseUserModelLibraries([text]);
    expect(registry.models.get("mydiode")).toBe(".model MyDiode D(Is=1e-14)");
    expect(registry.models.size).toBe(1);
    expect(registry.subckts.size).toBe(0);
  });

  it("preserves a .subckt body's non-switch content byte-for-byte, including a nested .model and comments", () => {
    const text = [
      ".subckt MacroPart 1 2 3",
      "* internal comment",
      "Q1 1 2 3 QINNER",
      ".model QINNER NPN(Bf=100)",
      ".ends MacroPart",
    ].join("\n");
    const registry = parseUserModelLibraries([text]);
    expect(registry.subckts.get("macropart")).toBe(text);
    // The nested .model is NOT separately registered as a top-level model -
    // it belongs to the subckt body only, verbatim.
    expect(registry.models.has("qinner")).toBe(false);
  });

  it("translates an LTspice VSWITCH .model card into ngspice SW with Vt/Vh levels", () => {
    // ADA4898's switch model (comma-separated). LTspice states the on/off
    // control levels directly; ngspice wants a center threshold plus a
    // hysteresis half-width: Vt=(Von+Voff)/2, Vh=(Von-Voff)/2. Ron/Roff carry
    // over verbatim. A bare rename would leave Vt=Vh=0 and trip the switch at 0.
    const registry = parseUserModelLibraries([
      ".model Switch vswitch(Von=1.005,Voff=0.995,ron=0.001,roff=1e6)",
    ]);
    expect(registry.models.get("switch")).toBe(".model Switch SW(RON=0.001 ROFF=1e6 VT=1 VH=0.005)");
    expect(registry.models.get("switch")).not.toMatch(/vswitch/i);
  });

  it("converts signed Von/Voff and re-emits Ron/Roff strings unchanged", () => {
    // AD8541's switch model: negative control levels, scientific-notation Roff.
    // Vt=(-3.5 + -4.2)/2 = -3.85, Vh=(-3.5 - -4.2)/2 = 0.35; Roff stays "100E3".
    const registry = parseUserModelLibraries([
      ".model VSY_SWITCH vswitch(ROFF=100E3,RON=1,VOFF=-4.2,VON=-3.5)",
    ]);
    expect(registry.models.get("vsy_switch")).toBe(".model VSY_SWITCH SW(RON=1 ROFF=100E3 VT=-3.85 VH=0.35)");
  });

  it("drops an LTspice-only bare switch flag (noiseless) that ngspice has no SW parameter for", () => {
    // ADA4610's switch model carries a trailing `Noiseless` flag; only the four
    // recognized keys are re-emitted, so it is dropped along the way.
    const registry = parseUserModelLibraries([
      ".model Switch vswitch(Von=1.505 Voff=1.495 ron=0.001 roff=1e6 Noiseless)",
    ]);
    expect(registry.models.get("switch")).toBe(".model Switch SW(RON=0.001 ROFF=1e6 VT=1.5 VH=0.005)");
    expect(registry.models.get("switch")).not.toMatch(/noiseless/i);
  });

  it("translates a current-controlled ISWITCH into ngspice CSW with It/Ih levels", () => {
    const registry = parseUserModelLibraries([
      ".model CS iswitch(Ion=0.001 Ioff=0.0005 Ron=1 Roff=1e6)",
    ]);
    expect(registry.models.get("cs")).toBe(".model CS CSW(RON=1 ROFF=1e6 IT=0.00075 IH=0.00025)");
  });

  it("normalizes a captured subckt's switch model and parenthesized switch instance", () => {
    // AD8541's macromodel shape: a voltage-switch instance whose control nodes
    // LTspice wraps in parens `(50,99)` - ngspice wants them bare - and an
    // interior VSWITCH card. Everything else in the block stays byte-for-byte.
    const text = [
      ".subckt AMP 1 2 99 50 45",
      "R1 1 2 1e9",
      "S1 90 91 (50,99) VSY_SWITCH",
      ".model VSY_SWITCH vswitch(ROFF=100E3,RON=1,VOFF=-4.2,VON=-3.5)",
      ".ends AMP",
    ].join("\n");
    const block = parseUserModelLibraries([text]).subckts.get("amp");
    expect(block).toContain("S1 90 91 50 99 VSY_SWITCH");
    expect(block).toContain(".model VSY_SWITCH SW(RON=1 ROFF=100E3 VT=-3.85 VH=0.35)");
    expect(block).toContain("R1 1 2 1e9"); // untouched line stays verbatim
    expect(block).not.toMatch(/vswitch/i);
    expect(block).not.toContain("(50,99)");
  });

  it("leaves a bare (non-parenthesized) switch instance untouched", () => {
    // ADA4898 writes its switch instances with bare control nodes already; only
    // the model card needs translating, the instance line must not be mangled.
    const text = [
      ".subckt AMP 1 2 3 4",
      "S1 98 1030 106 113 Switch",
      ".model Switch vswitch(Von=1.005,Voff=0.995,ron=0.001,roff=1e6)",
      ".ends AMP",
    ].join("\n");
    const block = parseUserModelLibraries([text]).subckts.get("amp");
    expect(block).toContain("S1 98 1030 106 113 Switch");
    expect(block).toContain(".model Switch SW(RON=0.001 ROFF=1e6 VT=1 VH=0.005)");
  });

  it("translates LTspice soft-limit calls inside a vendor subcircuit", () => {
    const block = parseUserModelLibraries([
      ".subckt AMP 1 2 3 4 5\nB1 0 5 I=dnlim(uplim(V(1),V(3)-.9,.3),V(4)+.9,.3)\n.ends AMP",
    ]).subckts.get("amp") ?? "";
    expect(block).not.toMatch(/\b(?:up|dn)lim\s*\(/i);
    expect(block).toContain("exp(");
  });

  it("maps LTspice's idealized diode onto the equivalent bundled sidiode code model", () => {
    const block = parseUserModelLibraries([
      [
        ".subckt AMP 1 2 3 4 5",
        "D1 5 X LIMIT",
        ".model LIMIT D(Ron=10K Roff=1T Vfwd=.82 Vrev=.82 epsilon=.1 revepsilon=.1 noiseless)",
        ".ends AMP",
      ].join("\n"),
    ]).subckts.get("amp") ?? "";
    expect(block).toContain("A__tau_D1 5 X LIMIT");
    expect(block).toContain(".model LIMIT sidiode(Ron=10K Roff=1T Vfwd=.82 Vrev=.82 epsilon=.1 revepsilon=.1)");
    expect(block).not.toMatch(/^D1\b/m);
  });

  it("renames a numeric LTspice ideal-diode model to a valid XSPICE identifier", () => {
    const block = parseUserModelLibraries([
      [
        ".subckt AMP 1 2 3 4 5",
        "D4 3 2 2p",
        ".model 2p D(Ron=1T epsilon=1 Ilimit=2p noiseless)",
        ".ends AMP",
      ].join("\n"),
    ]).subckts.get("amp") ?? "";
    expect(block).toContain("A__tau_D4 3 2 __tau_sidiode_2p");
    expect(block).toContain(".model __tau_sidiode_2p sidiode(Ron=1T epsilon=1 Ilimit=2p)");
    expect(block).not.toMatch(/\.model\s+2p\s+sidiode/i);
  });

  it("maps a tied-multiplier LTspice OTA to the pinned native OTA and literal output loading", () => {
    const block = parseUserModelLibraries([
      [
        ".subckt AMP 1 2 3 4 5",
        "A1 0 N004 0 0 0 0 X 0 OTA g=150u Iout=7u Cout=28p en=9.8n enk=4 Vhigh=1e308 Vlow=-1e308",
        ".ends AMP",
      ].join("\n"),
    ]).subckts.get("amp") ?? "";
    expect(block).toContain(".model __tau_ota_AMP_A1 ota(gm=150u iout=7u rout=1e308 rin=1e308 en=9.8n enk=4)");
    expect(block).toContain("A__tau_ota_AMP_A1 0 N004 __tau_ota_sink_AMP_A1 __tau_ota_AMP_A1");
    expect(block).toContain("F__tau_ota_AMP_A1 X 0 V__tau_ota_AMP_A1 1");
    expect(block).toContain("C__tau_ota_AMP_A1 X 0 28p");
    expect(block).not.toMatch(/^A1\b/m);
  });

  it("replaces LTspice's built-in pi constant at full double precision", () => {
    const block = parseUserModelLibraries([
      ".subckt AMP 1 2 3 4 5\n.param Cf={1/(2*pi*1Meg)}\n.ends AMP",
    ]).subckts.get("amp") ?? "";
    expect(block).toContain("2*3.141592653589793*1Meg");
    expect(block).not.toMatch(/\bpi\b/i);
  });

  it("expands LTspice capacitor Rpar into an exact parallel resistor", () => {
    const block = parseUserModelLibraries([
      ".subckt AMP 1 2 3 4 5\nC11 2 5 .9p Rpar=2e13\n.ends AMP",
    ]).subckts.get("amp") ?? "";
    expect(block).toContain("C11 2 5 .9p");
    expect(block).toContain("R__tau_rpar_AMP_C11 2 5 2e13");
    expect(block).not.toMatch(/\brpar\s*=/i);
  });

  it("expands LTspice capacitor series/parallel parasitics without changing its identity", () => {
    const block = parseUserModelLibraries([
      ".subckt AMP 1 2 3 4 5 params: rs=100\nC11 2 5 .9p Rser={rs} Rpar=2e13 Cpar=.1p ic=.2\n.ends AMP",
    ]).subckts.get("amp") ?? "";
    expect(block).toContain("C11 __tau_cser_AMP_C11 5 .9p ic=.2");
    expect(block).toContain("R__tau_rser_AMP_C11 2 __tau_cser_AMP_C11 {rs}");
    expect(block).toContain("R__tau_rpar_AMP_C11 2 5 2e13");
    expect(block).toContain("C__tau_cpar_AMP_C11 2 5 .1p");
    expect(block).not.toMatch(/\b(?:rser|rpar|cpar)\s*=/i);
  });

  it("expands LTspice inductor series/parallel parasitics and keeps the L name for coupling", () => {
    const block = parseUserModelLibraries([
      ".subckt AMP 1 2 3 4 5\nL3 2 5 3.18m Rser=1k Rpar=30Meg Cpar=2p ic=1m\n.ends AMP",
    ]).subckts.get("amp") ?? "";
    expect(block).toContain("L3 __tau_lser_AMP_L3 5 3.18m ic=1m");
    expect(block).toContain("R__tau_rser_AMP_L3 2 __tau_lser_AMP_L3 1k");
    expect(block).toContain("R__tau_rpar_AMP_L3 2 5 30Meg");
    expect(block).toContain("C__tau_cpar_AMP_L3 2 5 2p");
    expect(block).not.toMatch(/\b(?:rser|rpar|cpar)\s*=/i);
  });

  it("strips a literal zero series parasitic without creating a zero-ohm branch", () => {
    const block = parseUserModelLibraries([
      ".subckt AMP 1 2\nC1 1 2 318f Rser=0\nL1 1 2 30u Rser=0\n.ends AMP",
    ]).subckts.get("amp") ?? "";
    expect(block).toContain("C1 1 2 318f");
    expect(block).toContain("L1 1 2 30u");
    expect(block).not.toMatch(/__tau_rser|\brser\s*=/i);
  });

  it("refuses multiplicity combined with expanded parasitics instead of guessing scaling", () => {
    const registry = parseUserModelLibraries([
      ".subckt AMP 1 2\nC1 1 2 1u Rser=1 m=4\n.ends AMP",
    ]);
    expect(() => resolveUserSubckt(registry, "AMP")).toThrow(
      /Simulation refused: AMP\/C1 combines m= with LTspice parasitics.*No approximate or partial circuit was run/,
    );
  });

  it("maps LTspice's dissipative current-load flag to its documented transfer", () => {
    const block = parseUserModelLibraries([
      ".subckt AMP 1 2 3 4 5\nI3 2 3 50u load\n.ends AMP",
    ]).subckts.get("amp") ?? "";
    expect(block).toContain("B__tau_load_I3 2 3 I={(50u)*(V(2,3)<=0 ? 4*V(2,3) : V(2,3)<0.5 ? 4*V(2,3)-4*V(2,3)*V(2,3) : 1)}");
    expect(block).not.toMatch(/^I3\b/m);
  });

  it("refuses active OTA multiplier ports instead of substituting a two-port gain block", () => {
    const registry = parseUserModelLibraries([
      ".subckt AMP 1 2 3 4 5\nA1 1 2 3 4 0 0 5 0 OTA g=1m Vhigh=1e308 Vlow=-1e308\n.ends AMP",
    ]);
    expect(() => resolveUserSubckt(registry, "AMP")).toThrow(
      /Simulation refused: AMP\/A1 uses active four-quadrant multiplier ports.*No approximate or partial circuit was run/,
    );
  });

  it("strips the fatal bare `noiseless` flag from a captured subckt's instance lines", () => {
    // Real ADI macromodels (ADA4351, MAX4230) tag every internal passive with
    // LTspice's `noiseless` flag. On an R/C/L INSTANCE line ngspice reads it as
    // an unknown model/parameter and aborts the whole deck ("unknown parameter
    // (noiseless)" -> incomplete netlist), so it must be removed while the
    // device's nodes, model name, and value stay intact.
    const text = [
      ".subckt AMP 1 2 3",
      "RinDiff INNx INPx RQT 3.75E12 Noiseless",
      "C1 INNx INPx 2p noiseless",
      "L1 3 INPx 1n Noiseless",
      ".ends AMP",
    ].join("\n");
    const block = parseUserModelLibraries([text]).subckts.get("amp");
    expect(block).not.toMatch(/noiseless/i);
    expect(block).toContain("RinDiff INNx INPx RQT 3.75E12");
    expect(block).toContain("C1 INNx INPx 2p");
    expect(block).toContain("L1 3 INPx 1n");
  });

  it("cleans a bare `noiseless` flag out of an interior .model card too", () => {
    // ADA4899 writes it inside its diode cards (`.model DzVoutP D(BV=4.3
    // Noiseless)`). ngspice only warns there, but the emitted card is cleaner
    // without it and the numeric parameters are untouched.
    const text = [
      ".subckt AMP 1 2",
      "D1 1 2 DZ",
      ".model DZ D(BV=4.3 Noiseless)",
      ".ends AMP",
    ].join("\n");
    const block = parseUserModelLibraries([text]).subckts.get("amp");
    expect(block).toContain(".model DZ D(BV=4.3)");
    expect(block).not.toMatch(/noiseless/i);
  });

  it("strips the `noiseless` flag from a directly-attached top-level .model card", () => {
    // MAX4230's output diode: `.model DO D(Vfwd=1k Vrev=0 Revepsilon=0.1 Ron=1m
    // Noiseless)`. The bare flag goes; the LTspice diode parameters (which
    // ngspice merely warns about) are left for the engine to handle.
    const registry = parseUserModelLibraries([
      ".model DO D(Vfwd=1k Vrev=0 Revepsilon=0.1 Ron=1m Noiseless)",
    ]);
    expect(registry.models.get("do")).toBe(".model DO D(Vfwd=1k Vrev=0 Revepsilon=0.1 Ron=1m)");
  });

  it("leaves the word noiseless in a full-line comment alone", () => {
    // Only executable lines are cleaned; a comment that merely mentions the word
    // must not be rewritten as if it were a device flag.
    const text = [
      ".subckt AMP 1 2",
      "* all resistors are noiseless",
      "R1 1 2 1k",
      ".ends AMP",
    ].join("\n");
    const block = parseUserModelLibraries([text]).subckts.get("amp");
    expect(block).toContain("* all resistors are noiseless");
    expect(block).toContain("R1 1 2 1k");
  });

  it("first definition wins when a name repeats across texts", () => {
    const registry = parseUserModelLibraries([
      ".model Dup D(Is=1e-14 N=1)",
      ".model Dup D(Is=9e-9 N=2)",
    ]);
    expect(registry.models.get("dup")).toBe(".model Dup D(Is=1e-14 N=1)");
  });

  it("combines definitions from multiple supplied texts", () => {
    const registry = parseUserModelLibraries([
      ".model DiodeA D(Is=1e-14)",
      ".subckt BlockB in out\nR1 in out 1k\n.ends BlockB",
    ]);
    expect(registry.models.get("diodea")).toBe(".model DiodeA D(Is=1e-14)");
    expect(registry.subckts.get("blockb")).toContain(".subckt BlockB in out");
  });

  it("returns null lookups against an empty registry", () => {
    const registry = parseUserModelLibraries([]);
    expect(resolveUserModel(registry, "anything")).toBeNull();
    expect(resolveUserSubckt(registry, "anything")).toBeNull();
    expect(resolveUserModel(registry, "")).toBeNull();
    expect(resolveUserSubckt(registry, "")).toBeNull();
  });
});
