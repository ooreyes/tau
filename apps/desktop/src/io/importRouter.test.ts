import { describe, expect, it } from "vitest";
import { planFileImport } from "./importRouter";
import { importAsc } from "./ascImport";

const utf8 = (text: string) => new TextEncoder().encode(text);

describe("planFileImport - format detection", () => {
  it("recognizes an LTspice .asc by content even with the wrong extension", () => {
    const text = "Version 4\nSHEET 1 880 680\nWIRE 0 0 100 0\n";
    const plan = planFileImport("mystery.txt", utf8(text));
    expect(plan.kind).toBe("schematic");
    if (plan.kind !== "schematic") throw new Error("unreachable");
    expect(plan.ascText).toBe(text);
    expect(plan.synthesized).toBe(false);
    expect(plan.warnings).toEqual([]);
  });

  it("recognizes a .asc by extension even without a perfect header", () => {
    const plan = planFileImport("weird.asc", utf8("Version 4\nSHEET 1 880 680\n"));
    expect(plan.kind).toBe("schematic");
  });

  it("routes a flat SPICE netlist through the .cir importer and converts it to asc", () => {
    const source = "* RC\nV1 in 0 PULSE(0 5 0 1n 1n 1m 2m)\nR1 in out 1k\nC1 out 0 1u\n.tran 5m\n.end\n";
    const plan = planFileImport("filter.cir", utf8(source));
    expect(plan.kind).toBe("schematic");
    if (plan.kind !== "schematic") throw new Error("unreachable");
    expect(plan.synthesized).toBe(true);
    expect(plan.suggestedFileName).toBe("filter.asc");
    // The converted text must itself re-import cleanly with the same parts.
    // (Each "0" net label round-trips as its own LTspice ground FLAG, which
    // reopens as an unlabeled ground symbol - filter those out to check the
    // named parts specifically.)
    const reopened = importAsc(plan.ascText);
    expect(reopened.components.filter((c) => c.label).map((c) => c.label).sort()).toEqual(["C1", "R1", "V1"]);
  });

  it("treats a plain-SPICE .net (not KiCad's S-expression export) as a netlist", () => {
    const source = "* t\nR1 a 0 1k\nR2 a b 2k\n.end\n";
    const plan = planFileImport("flat.net", utf8(source));
    expect(plan.kind).toBe("schematic");
    if (plan.kind !== "schematic") throw new Error("unreachable");
    const reopened = importAsc(plan.ascText);
    expect(reopened.components.filter((c) => c.label).map((c) => c.label).sort()).toEqual(["R1", "R2"]);
  });

  it("surfaces per-device SPICE warnings (e.g. an unimported subcircuit call) as conversion warnings", () => {
    const source = "* t\nR1 a 0 1k\nX1 a b mysub\n.end\n";
    const plan = planFileImport("board.cir", utf8(source));
    expect(plan.kind).toBe("schematic");
    if (plan.kind !== "schematic") throw new Error("unreachable");
    expect(plan.warnings.some((w) => /X1/.test(w) && /subcircuit/.test(w))).toBe(true);
  });

  it("refuses a .cir with no recognizable devices instead of silently opening an empty schematic", () => {
    const plan = planFileImport("notes.cir", utf8("just some notes about a project"));
    expect(plan.kind).toBe("unsupported");
    if (plan.kind !== "unsupported") throw new Error("unreachable");
    expect(plan.message).toMatch(/could not find any recognizable SPICE devices/);
  });

  it("routes a KiCad S-expression netlist export through the KiCad importer", () => {
    const source = `(export (version D)
      (components
        (comp (ref "R1") (value "10k") (libsource (lib "Device") (part "R"))))
      (nets
        (net (code "1") (name "/VIN") (node (ref "R1") (pin "1")))
        (net (code "2") (name "GND") (node (ref "R1") (pin "2")))))`;
    const plan = planFileImport("board.net", utf8(source));
    expect(plan.kind).toBe("schematic");
    if (plan.kind !== "schematic") throw new Error("unreachable");
    expect(plan.synthesized).toBe(true);
    const reopened = importAsc(plan.ascText);
    const named = reopened.components.filter((c) => c.label);
    expect(named).toHaveLength(1);
    expect(named[0].label).toBe("R1");
  });

  it("warns and refuses to guess at a component the KiCad importer cannot map", () => {
    const source = `(export (version D)
      (components
        (comp (ref "U1") (value "LM358") (libsource (lib "Amplifier_Operational") (part "LM358"))))
      (nets
        (net (code "1") (name "") (node (ref "U1") (pin "1")))))`;
    const plan = planFileImport("board.net", utf8(source));
    expect(plan.kind).toBe("schematic");
    if (plan.kind !== "schematic") throw new Error("unreachable");
    expect(plan.warnings.some((w) => w.includes("U1") && w.includes("LM358"))).toBe(true);
  });

  it("refuses a genuine KiCad schematic file with a specific, actionable message", () => {
    const source = '(kicad_sch (version 20230121) (generator eeschem))';
    const plan = planFileImport("board.kicad_sch", utf8(source));
    expect(plan.kind).toBe("unsupported");
    if (plan.kind !== "unsupported") throw new Error("unreachable");
    expect(plan.message).toMatch(/KiCad schematic/);
    expect(plan.message).toMatch(/Generate Netlist/);
  });

  it("routes a .lib file to the model-library attach path instead of trying to open it as a schematic", () => {
    const source = ".subckt OPAMP1 a b c\nR1 a b 1k\n.ends\n";
    const plan = planFileImport("opamps.lib", utf8(source));
    expect(plan).toEqual({ kind: "model-library", name: "opamps.lib", text: source });
  });

  it("routes a .mod file with only definitions to the model-library path by content, even with a generic extension", () => {
    const source = ".model MYDIODE D(IS=1e-14)\n";
    const plan = planFileImport("mystery-models.txt", utf8(source));
    expect(plan.kind).toBe("model-library");
  });

  it("does not misclassify a .subckt-defining file as a netlist when it also has directives", () => {
    const source = ".subckt REG in out gnd\nR1 in out 1k\n.ends\n.param foo=1\n";
    const plan = planFileImport("reg.txt", utf8(source));
    expect(plan.kind).toBe("model-library");
  });

  it("refuses a .raw waveform and points at the reference-overlay control", () => {
    // Minimal ASCII .raw: header + Values: marker is enough for detection.
    const raw = "Title: t\nDate: t\nPlotname: Transient\nFlags: real\n"
      + "No. Variables: 1\nNo. Points: 1\nVariables:\n0\ttime\ttime\nValues:\n0\t0\n";
    const plan = planFileImport("result.raw", utf8(raw));
    expect(plan.kind).toBe("unsupported");
    if (plan.kind !== "unsupported") throw new Error("unreachable");
    expect(plan.message).toMatch(/simulation results/);
    expect(plan.message).toMatch(/reference-overlay/);
  });

  it("gives a precise refusal for a file Tau does not recognize at all", () => {
    const plan = planFileImport("photo.png", utf8("hello"));
    expect(plan.kind).toBe("unsupported");
    if (plan.kind !== "unsupported") throw new Error("unreachable");
    expect(plan.message).toMatch(/does not recognize/);
    expect(plan.message).toMatch(/\.asc/);
  });
});
