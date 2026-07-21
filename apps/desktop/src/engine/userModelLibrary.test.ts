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
