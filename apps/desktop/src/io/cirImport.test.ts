import { describe, it, expect } from "vitest";
import { parseCir } from "./cirImport";
import { extractCircuit } from "../schematic/netlist";

const RC = `* RC low-pass test
V1 in 0 PULSE(0 5 0 1n 1n 1m 2m)
R1 in out 1k
C1 out 0 1u
.tran 5m
.end`;

describe("parseCir", () => {
  it("parses devices into components with labels and values", () => {
    const r = parseCir(RC);
    const byLabel = Object.fromEntries(r.components.map((c) => [c.label, c]));
    expect(r.components).toHaveLength(3);
    expect(byLabel.V1.kind).toBe("vsource");
    expect(byLabel.V1.value).toBe("PULSE(0 5 0 1n 1n 1m 2m)");
    expect(byLabel.R1.kind).toBe("resistor");
    expect(byLabel.R1.value).toBe("1k");
    expect(byLabel.C1.kind).toBe("capacitor");
  });

  it("collects the title and directives", () => {
    const r = parseCir(RC);
    expect(r.comments).toContain("RC low-pass test");
    expect(r.directives).toContain(".tran 5m");
    expect(r.directives).not.toContain(".end");
  });

  it("produces a netlist with the right connectivity via net labels", () => {
    const r = parseCir(RC);
    const circuit = extractCircuit(r.components, r.wires, r.netLabels);
    // Nets: ground(0), in, out.
    const names = circuit.nets.map((n) => n.id).sort();
    expect(names).toEqual(["0", "in", "out"]);
    const out = circuit.nets.find((n) => n.id === "out")!;
    const outLabels = out.pins.map((p) => p.componentLabel).sort();
    expect(outLabels).toEqual(["C1", "R1"]); // both meet at "out"
    const inNet = circuit.nets.find((n) => n.id === "in")!;
    expect(inNet.pins.map((p) => p.componentLabel).sort()).toEqual(["R1", "V1"]);
  });

  it("maps node 0 to ground", () => {
    const r = parseCir(RC);
    const circuit = extractCircuit(r.components, r.wires, r.netLabels);
    const gnd = circuit.nets.find((n) => n.isGround)!;
    expect(gnd).toBeDefined();
    // V1.n and C1.b are both on ground.
    expect(gnd.pins.map((p) => p.componentLabel).sort()).toEqual(["C1", "V1"]);
  });

  it("folds continuation lines", () => {
    const r = parseCir(`* t\nV1 in 0\n+ DC 5\nR1 in 0 1k`);
    const v1 = r.components.find((c) => c.label === "V1")!;
    expect(v1.value).toBe("DC 5");
  });

  it("strips inline comments", () => {
    const r = parseCir(`* t\nR1 a 0 1k ; a comment\nR2 a 0 2k $ another`);
    expect(r.components.find((c) => c.label === "R1")!.value).toBe("1k");
    expect(r.components.find((c) => c.label === "R2")!.value).toBe("2k");
  });

  it("refines Q/M kind from the model polarity", () => {
    const r = parseCir(
      `* t\nQ1 c b e PNPMOD\nM1 d g s s NMOSMOD\n.model PNPMOD PNP\n.model NMOSMOD NMOS`,
    );
    expect(r.components.find((c) => c.label === "Q1")!.kind).toBe("pnp");
    expect(r.components.find((c) => c.label === "M1")!.kind).toBe("nmos");
  });

  it("ties a 3-terminal MOS bulk to its source net", () => {
    const r = parseCir(`* t\nM1 d g s NMOSMOD\n.model NMOSMOD NMOS`);
    const circuit = extractCircuit(r.components, r.wires, r.netLabels);
    const sNet = circuit.nets.find((n) => n.id === "s")!;
    // Source pin "s" and bulk pin "b" both resolve onto net "s".
    const ids = sNet.pins.map((p) => p.id).sort();
    expect(ids).toEqual(["b", "s"]);
  });

  it("maps a VCVS in SPICE node order (out pair, then control pair)", () => {
    const r = parseCir(`* t\nE1 outp outn cp cn 2`);
    const e1 = r.components.find((c) => c.label === "E1")!;
    expect(e1.kind).toBe("vcvs");
    expect(e1.value).toBe("2");
    const circuit = extractCircuit(r.components, r.wires, r.netLabels);
    const op = circuit.nets.find((n) => n.id === "outp")!;
    expect(op.pins[0].id).toBe("op");
    const cpNet = circuit.nets.find((n) => n.id === "cp")!;
    expect(cpNet.pins[0].id).toBe("cp");
  });

  it("warns and skips unsupported devices", () => {
    const r = parseCir(`* t\nX1 a b mysub\nK1 L1 L2 0.9\nF1 a b Vsense 2`);
    expect(r.components).toHaveLength(0);
    expect(r.warnings).toHaveLength(3);
    expect(r.warnings.join(" ")).toMatch(/subcircuit/);
  });
});
