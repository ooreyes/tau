import { describe, expect, it } from "vitest";
import { buildSpiceDeck } from "./spiceNetlist";
import { buildParamScope } from "../simulation/paramScope";
import type { SchematicComponent, SchematicWire } from "../schematic/types";
import { CATALOG } from "../schematic/catalog";

const component = (
  kind: SchematicComponent["kind"],
  label: string,
  value: string,
  x: number,
  y: number,
): SchematicComponent => ({ id: label, kind, label, value, x, y, rotation: 0 });

const wire = (id: string, points: { x: number; y: number }[]): SchematicWire => ({ id, points });

describe("buildSpiceDeck", () => {
  it("builds a finite simulation deck for every default Library component", () => {
    for (const [index, entry] of CATALOG.entries()) {
      const placed = component(
        entry.kind,
        entry.kind === "ground" ? "" : `${entry.prefix}${index + 1}`,
        entry.defaultValue,
        128,
        128,
      );
      const grounded = component("ground", "", "", 0, 0);
      const deck = buildSpiceDeck({ components: [grounded, placed], wires: [] }, { kind: "op" });
      expect(deck.netlist, entry.kind).toContain(".op");
      expect(deck.netlist, entry.kind).not.toMatch(/\b(?:NaN|undefined|Infinity)\b/);
    }
  });

  it("emits an ngspice transient deck for a grounded RC circuit", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("capacitor", "C1", "1u", 224, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 256, 0),
    ];
    const wires = [
      wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }]),
      wire("w2", [{ x: 128, y: 0 }, { x: 192, y: 0 }]),
    ];

    const deck = buildSpiceDeck({ components, wires }, { kind: "tran", stopTime: 0.005, steps: 500 });

    expect(deck.netlist).toContain("V1 n001 0 DC 5");
    expect(deck.netlist).toContain("R1 n001 n002 1000");
    expect(deck.netlist).toContain("C1 n002 0 0.000001");
    expect(deck.netlist).toContain(".tran 0.00001 0.005");
    expect(deck.netlist).toMatch(/\.end$/);
    // Default options line is present when the document carries none.
    expect(deck.netlist).toContain(".options gmin=1e-12 reltol=1e-4 abstol=1e-12 vntol=1e-7");
  });

  it("preserves authored transient output-start and maximum-step controls", () => {
    const components = [component("resistor", "R1", "1k", 0, 0), component("ground", "", "", 64, 0)];
    const deck = buildSpiceDeck({ components, wires: [] }, {
      kind: "tran",
      stopTime: 0.001,
      steps: 240,
      startTime: 0.00099,
      maxStep: 1e-8,
      uic: true,
    });
    expect(deck.netlist).toContain(".tran 0.000004166666666666667 0.001 0.00099 1e-8 uic");
  });

  it("emits the AC stimulus on an imported V source (SINE + AC spec)", () => {
    // LTspice Draft1: SYMATTR Value SINE(0 1 1) + SYMATTR Value2 AC 1 → one value.
    const components = [
      component("vsource", "V1", "SINE(0 1 1) AC 1", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck({ components, wires }, { kind: "ac", startHz: 1, stopHz: 1e6, pointsPerDecade: 10 });
    // The SIN(...) transient form survives and the AC magnitude is appended.
    expect(deck.netlist).toMatch(/V1 n001 0 DC 0 SIN\(0 1 1\) AC 1/);
  });

  it("emits the AC stimulus on a plain DC V source with an AC spec", () => {
    const components = [
      component("vsource", "V1", "5 AC 2", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    expect(deck.netlist).toContain("V1 n001 0 DC 5 AC 2");
  });

  it("emits a bundled LTspice standard model when a diode references it by name", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("diode", "D1", "1N4148", 224, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 256, 0),
    ];
    const wires = [
      wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }]),
      wire("w2", [{ x: 128, y: 0 }, { x: 192, y: 0 }]),
    ];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    // The real 1N4148 model is emitted and the device line references it by name.
    expect(deck.netlist).toMatch(/^\.model 1N4148 D\(/m);
    expect(deck.netlist).toMatch(/D1 \S+ \S+ 1N4148/);
    // The generic TAU_DIODE is NOT used for this part's device line.
    expect(deck.netlist).not.toMatch(/D1 \S+ \S+ TAU_DIODE/);
  });

  it("falls back to the generic model for an unknown diode part name", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("diode", "D1", "MYSTERY_PART", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    expect(deck.netlist).toMatch(/D1 \S+ \S+ TAU_DIODE/);
    expect(deck.netlist).not.toContain(".model MYSTERY_PART");
  });

  it("emits a capacitor IC and adds uic to the transient (Draft10 case)", () => {
    const components = [
      component("capacitor", "C1", "100p IC=1", 0, 0),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 32),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck({ components, wires }, { kind: "tran", stopTime: 0.001, steps: 100 });
    expect(deck.netlist).toMatch(/C1 \S+ \S+ 1e-10 IC=1/);
    expect(deck.netlist).toMatch(/\.tran .* uic/);
  });

  it("expands LTspice capacitor Rser into an explicit series resistor", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("capacitor", "C1", "22u Rser=1m", 224, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 256, 0),
    ];
    const wires = [
      wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }]),
      wire("w2", [{ x: 128, y: 0 }, { x: 192, y: 0 }]),
    ];
    const deck = buildSpiceDeck({ components, wires }, { kind: "tran", stopTime: 1e-3, steps: 100 });
    expect(deck.netlist).toMatch(/^C1\s+\S+\s+tau_c1_esr\s+0\.000022$/m);
    expect(deck.netlist).toMatch(/^RTAU_C1_ESR\s+tau_c1_esr\s+0\s+0\.001$/m);
  });

  it("expands LTspice inductor Rser without changing the coupled inductor name", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("inductor", "Lp", "200u Rser=10m", 96, 0),
      component("resistor", "R1", "1k", 224, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 256, 0),
    ];
    const wires = [
      wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }]),
      wire("w2", [{ x: 128, y: 0 }, { x: 192, y: 0 }]),
    ];
    const deck = buildSpiceDeck({ components, wires, directives: ["K Lp Ls 1"] }, { kind: "tran", stopTime: 1e-3, steps: 100 });
    const inductorLine = deck.netlist.split("\n").find((line) => line.startsWith("Lp "))!;
    expect(inductorLine.split(/\s+/).slice(0, 3)).toEqual(["Lp", "n001", "tau_lp_esr"]);
    expect(Number(inductorLine.split(/\s+/)[3])).toBeCloseTo(200e-6);
    expect(deck.netlist).toMatch(/^RTAU_Lp_ESR\s+tau_lp_esr\s+\S+\s+0\.01$/m);
    expect(deck.netlist).toContain("K Lp Ls 1");
  });

  it("does not add uic when no instance carries an IC", () => {
    const components = [
      component("capacitor", "C1", "100p", 0, 0),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 32),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck({ components, wires }, { kind: "tran", stopTime: 0.001, steps: 100 });
    expect(deck.netlist).not.toMatch(/uic/);
  });

  it("allows a negative resistance (SPICE active element, Draft7's -1k)", () => {
    const components = [
      component("vsource", "V1", "1", 0, 32),
      component("resistor", "R1", "-1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    expect(deck.netlist).toMatch(/R1 \S+ \S+ -1000/);
  });

  it("still rejects a zero resistance (a short)", () => {
    const components = [
      component("resistor", "R1", "0", 0, 0),
      component("ground", "", "", 16, 32),
    ];
    expect(() => buildSpiceDeck({ components, wires: [] }, { kind: "op" })).toThrow(/non-zero/);
  });

  it("lets a document's .options directive override the default deck options", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck(
      { components, wires, directives: [".options reltol=1e-3 maxstep=1n"] },
      { kind: "op" },
    );
    expect(deck.netlist).toContain("reltol=1e-3");
    expect(deck.netlist).not.toContain("reltol=1e-4");
    expect(deck.netlist).toContain("maxstep=1n");
    // Untouched defaults remain.
    expect(deck.netlist).toContain("gmin=1e-12");
  });

  it("emits a document .temp setting into the deck", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck(
      { components, wires, directives: [".temp 85"] },
      { kind: "op" },
    );
    expect(deck.netlist).toContain(".temp 85");
    // No .temp line when the document carries none.
    const plain = buildSpiceDeck({ components, wires }, { kind: "op" });
    expect(plain.netlist).not.toContain(".temp");
  });

  it("passes .ic/.nodeset through and adds uic to the transient line", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("capacitor", "C1", "1u", 224, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 256, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck(
      { components, wires, directives: [".ic V(out)=2", ".nodeset V(mid)=1"] },
      { kind: "tran", stopTime: 0.005, steps: 500 },
    );
    expect(deck.netlist).toContain(".ic V(out)=2");
    expect(deck.netlist).toContain(".nodeset V(mid)=1");
    expect(deck.netlist).toMatch(/\.tran [\d.e-]+ 0\.005 uic/);
  });

  it("translates LTspice .ic inductor current assignments to ngspice instance IC", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("inductor", "L1", "1m", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck(
      {
        components,
        wires,
        directives: [".ic V(out)=1 I(L1)=250m"],
      },
      { kind: "tran", stopTime: 0.001, steps: 200 },
    );

    expect(deck.netlist).toContain(".ic V(out)=1");
    expect(deck.netlist).toMatch(/^L1\s+\S+\s+\S+\s+0\.001 IC=250m$/m);
    expect(deck.netlist).not.toMatch(/^\.ic .*I\(L1\)/mi);
    expect(deck.netlist).toMatch(/\.tran [\d.e-]+ 0\.001 uic/);
  });

  it("warns and drops a stale .ic current target after its inductor is deleted", () => {
    const components = [
      component("vsource", "V2", "5", 0, 32),
      component("resistor", "R2", "1k", 96, 0),
      component("led", "D1", "LED", 224, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 256, 0),
    ];
    const wires = [
      wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }]),
      wire("w2", [{ x: 128, y: 0 }, { x: 192, y: 0 }]),
    ];
    const deck = buildSpiceDeck(
      { components, wires, directives: [".ic V(out)=1", ".ic I(L1)=0"] },
      { kind: "tran", stopTime: 0.001, steps: 200 },
    );

    expect(deck.netlist).toContain(".ic V(out)=1");
    expect(deck.netlist).not.toContain("I(L1)");
    expect(deck.circuit.warnings).toContain("Ignored .ic I(L1)=0 because inductor L1 is not present.");
    expect(deck.netlist).toContain(" uic");
  });

  it("rejects .ic current assignments that name an existing non-inductor", () => {
    const components = [
      component("resistor", "R1", "1k", 0, 0),
      component("ground", "", "", 64, 0),
    ];

    expect(() => buildSpiceDeck(
      { components, wires: [], directives: [".ic I(R1)=0"] },
      { kind: "tran", stopTime: 0.001, steps: 200 },
    )).toThrow(/\.ic I\(R1\).*inductor.*resistor/i);
  });

  it("omits uic when only a .nodeset (no .ic) is present", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck(
      { components, wires, directives: [".nodeset V(out)=1"] },
      { kind: "tran", stopTime: 0.001, steps: 200 },
    );
    expect(deck.netlist).toContain(".nodeset V(out)=1");
    expect(deck.netlist).not.toContain("uic");
  });

  it("emits an inline SINE function from an LTspice voltage source value", () => {
    const components = [
      component("vsource", "V1", "SINE(0 7.5 1k)", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];

    const deck = buildSpiceDeck({ components, wires }, { kind: "tran", stopTime: 0.003, steps: 300 });

    expect(deck.netlist).toContain("V1 n001 0 DC 0 SIN(0 7.5 1000)");
  });

  it("emits a full LTspice PULSE function and trims its Ncycles slot", () => {
    const components = [
      component("vsource", "V1", "PULSE(-10 10 5u 25u 25u 0u 50u)", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];

    const deck = buildSpiceDeck({ components, wires }, { kind: "tran", stopTime: 0.001, steps: 200 });

    expect(deck.netlist).toContain(
      "V1 n001 0 DC -10 PULSE(-10 10 0.000005 0.000025 0.000025 0 0.00005)",
    );
  });

  it("includes generic nonlinear models and the complete M1 pin order", () => {
    const components = [
      component("nmos", "M1", "NMOS", 0, 0),
      component("ground", "", "", 16, 32),
    ];

    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });

    expect(deck.netlist).toContain(".model TAU_NMOS NMOS");
    expect(deck.netlist).toMatch(/M1 n\d+ n\d+ 0 n\d+ TAU_NMOS/);
    expect(deck.netlist).toContain(".op");
  });

  it("emits a VDMOS power MOSFET as a 3-terminal device line (no bulk node)", () => {
    // A document `.model … VDMOS(…)` makes the referencing MOSFET a 3-pin VDMOS
    // (ngspice: M nd ng ns model). The bulk node must be dropped - emitting it
    // would reinterpret the bulk as the model's optional thermal node.
    const components = [
      component("nmos", "M1", "IRFZ44N", 0, 0),
      component("ground", "", "", 16, 32),
    ];

    const deck = buildSpiceDeck(
      { components, wires: [], directives: [".model IRFZ44N VDMOS(Vto=4 Kp=20 Rd=20m)"] },
      { kind: "op" },
    );

    // 3 nodes (d g s) then the model name - no 4th bulk node before IRFZ44N.
    expect(deck.netlist).toMatch(/M1 n\d+ n\d+ 0 IRFZ44N\b/);
    expect(deck.netlist).not.toMatch(/M1 n\d+ n\d+ 0 n\d+ IRFZ44N/);
    // The VDMOS model definition is carried into the deck verbatim.
    expect(deck.netlist).toContain(".model IRFZ44N VDMOS(Vto=4 Kp=20 Rd=20m)");
  });

  it("resolves {param} braces on a passthrough .model line against the document scope", () => {
    // Fc.asc: `.params Cjo=930p …` + `.model DX D(Cjo={Cjo} …)`. LTspice
    // substitutes the global params; ngspice dies with "Undefined parameter
    // [cjo]" if the braces reach the deck (the .param lines are consumed into
    // Tau's scope, never emitted). Unknown names must survive verbatim.
    const components = [
      component("diode", "D1", "DX", 0, 0),
      component("ground", "", "", 0, 32),
    ];
    const directives = [".param Cjo=930p m=.75", ".model DX D(Is=0 Cjo={Cjo} m={m} tt={notdefined})"];
    const deck = buildSpiceDeck(
      { components, wires: [], directives, params: buildParamScope(directives) },
      { kind: "op" },
    );
    expect(deck.netlist).toContain("Cjo=9.3e-10");
    expect(deck.netlist).toContain("m=0.75");
    expect(deck.netlist).toContain("tt={notdefined}");
  });

  it("leaves braces inside a document-defined .subckt body for ngspice's own param scope", () => {
    // A subckt-internal `.param R=10K` shadows nothing at document level; its
    // `{R}` must NOT be substituted (or worse, throw) at deck build.
    const components = [
      component("resistor", "R1", "1k", 0, 0),
      component("ground", "", "", 0, 32),
    ];
    const directives = [
      ".param m=.75",
      ".subckt myblk 1 2\\nR1 1 2 {R}\\n.param R=10K\\n.ends myblk",
    ];
    const deck = buildSpiceDeck(
      { components, wires: [], directives, params: buildParamScope(directives) },
      { kind: "op" },
    );
    expect(deck.netlist).toContain("R1 1 2 {R}");
  });

  it("keeps a non-VDMOS MOSFET on its 4-terminal level-1 line", () => {
    // A `.model … NMOS(…)` definition is a standard 4-terminal MOS, so the bulk
    // node stays on the device line.
    const components = [
      component("nmos", "M1", "MYNMOS", 0, 0),
      component("ground", "", "", 16, 32),
    ];

    const deck = buildSpiceDeck(
      { components, wires: [], directives: [".model MYNMOS NMOS(Vto=1 Kp=2u)"] },
      { kind: "op" },
    );

    expect(deck.netlist).toMatch(/M1 n\d+ n\d+ 0 n\d+ MYNMOS/);
  });

  it("appends MOSFET instance W/L from the structured value encoding", () => {
    const components = [
      component("nmos", "M1", "NMOS W=20u L=2u", 0, 0),
      component("ground", "", "", 16, 32),
    ];

    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });

    expect(deck.netlist).toMatch(/M1 n\d+ n\d+ 0 n\d+ TAU_NMOS W=20u L=2u/);
  });

  it("emits a series resistor for a non-ideal wire with resistance", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
    ];
    const wires = [
      wire("w1", [
        { x: 0, y: 0 },
        { x: 64, y: 0 },
      ]),
    ];
    wires[0].resistance = "10m";

    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    expect(deck.netlist).toMatch(/RWIRE1 \S+ \S+ 0\.01/);
  });

  it("rejects an invalid non-ideal wire value instead of silently opening the circuit", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    wires[0].resistance = "banana";
    expect(() => buildSpiceDeck({ components, wires }, { kind: "op" })).toThrow(/wire resistance.*invalid/i);
  });

  it("rejects case and sanitization collisions in SPICE instance names", () => {
    const baseWires = [
      wire("w1", [{ x: -32, y: 0 }, { x: 32, y: 0 }]),
      wire("w2", [{ x: 96, y: 0 }, { x: 160, y: 0 }]),
    ];
    const duplicateCase = [
      component("resistor", "R1", "1k", 0, 0),
      component("resistor", "r1", "2k", 128, 0),
      component("ground", "", "", -64, 0),
    ];
    expect(() => buildSpiceDeck({ components: duplicateCase, wires: baseWires }, { kind: "op" }))
      .toThrow(/duplicate SPICE instance name/i);

    const sanitized = [
      component("resistor", "R 1", "1k", 0, 0),
      component("resistor", "R@1", "2k", 128, 0),
      component("ground", "", "", -64, 0),
    ];
    expect(() => buildSpiceDeck({ components: sanitized, wires: baseWires }, { kind: "op" }))
      .toThrow(/duplicate SPICE instance name/i);
  });

  it("writes a proper AC source and sweep directive", () => {
    const components = [
      component("vac", "V1", "0 2 1k", 0, 32),
      component("ground", "", "", 0, 64),
    ];

    const deck = buildSpiceDeck(
      { components, wires: [] },
      { kind: "ac", startHz: 10, stopHz: 1e6, pointsPerDecade: 20 },
    );

    expect(deck.netlist).toContain("V1 n001 0 DC 0 AC 2 SIN(0 2 1000)");
    expect(deck.netlist).toContain(".ac dec 20 10 1000000");
  });

  it("writes a .dc source-sweep directive with a stop-directed increment", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];

    const up = buildSpiceDeck({ components, wires }, { kind: "dc", source: "V1", start: 0, stop: 10, step: 1 });
    expect(up.netlist).toContain(".dc V1 0 10 1");

    // A descending range flips the increment sign so ngspice walks start → stop.
    const down = buildSpiceDeck({ components, wires }, { kind: "dc", source: "V1", start: 10, stop: 0, step: 2 });
    expect(down.netlist).toContain(".dc V1 10 0 -2");
  });

  it("appends a nested outer source to the .dc directive (SPICE inner-first order)", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("vsource", "V2", "5", 64, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];

    const nested = buildSpiceDeck({ components, wires }, {
      kind: "dc", source: "V1", start: 0, stop: 5, step: 1,
      source2: "V2", start2: 0, stop2: 10, step2: 2,
    });
    expect(nested.netlist).toContain(".dc V1 0 5 1 V2 0 10 2");
  });

  it("carries a document's own .model/.lib/.subckt definitions into the deck", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck(
      {
        components,
        wires,
        directives: [
          ".model MyNPN NPN(Bf=250)",
          ".lib /path/std.lib NMOS",
          ".subckt myamp in out\\nR1 in out 1k\\n.ends",
          ".tran 1m", // analysis directive must NOT leak into the deck body
        ],
      },
      { kind: "op" },
    );
    expect(deck.netlist).toContain(".model MyNPN NPN(Bf=250)");
    expect(deck.netlist).toContain(".lib /path/std.lib NMOS");
    expect(deck.netlist).toContain(".subckt myamp in out");
    expect(deck.netlist).toContain(".ends");
    // The analysis directive is handled by the analysis line, not the body.
    expect(deck.netlist).not.toContain(".tran 1m");
  });

  it("references a semiconductor's own model name when the document defines it", () => {
    const components = [
      component("diode", "D1", "1N4148", 0, 0),
      component("nmos", "M1", "IRF540", 96, 0),
      component("ground", "", "", 16, 32),
    ];
    const deck = buildSpiceDeck(
      { components, wires: [], directives: [".model 1N4148 D(Is=2.5n)", ".model IRF540 NMOS(Vto=4)"] },
      { kind: "op" },
    );
    expect(deck.netlist).toMatch(/D1 n\d+ n\d+ 1N4148/);
    expect(deck.netlist).toMatch(/M1 (?:n\d+|0) (?:n\d+|0) (?:n\d+|0) (?:n\d+|0) IRF540/);
    // The device lines reference the user models, not the generic starters.
    expect(deck.netlist).not.toMatch(/D1 .*TAU_DIODE/);
    expect(deck.netlist).not.toMatch(/M1 .*TAU_NMOS/);
  });

  it("falls back to the generic model when the named one is undefined and unbundled", () => {
    const components = [
      component("diode", "D1", "XYZ999", 0, 0),
      component("ground", "", "", 16, 32),
    ];
    // No matching .model present and not a bundled standard part → must not emit
    // an undefined model reference; use the generic starter.
    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });
    expect(deck.netlist).toMatch(/D1 n\d+ n\d+ TAU_DIODE/);
    expect(deck.netlist).not.toContain("XYZ999");
  });

  it("emits a BJT whose Value names a document .subckt as an X instance (UHFpreamp MRF901)", () => {
    const components = [
      component("npn", "Q1", "MRF901", 0, 0),
      component("ground", "", "", -32, 64),
    ];
    const directives = [
      ".subckt MRF901 1 2 3\\nLc 1 4 0.451n\\nQA 4 2 3 QR99\\n.model QR99 NPN(BF=88)\\n.ends MRF901",
    ];
    const deck = buildSpiceDeck({ components, wires: [], directives }, { kind: "op" });
    // LTspice silently netlists a subckt-valued Q as an X with the same C B E
    // node order; a Q line would make ngspice fail with "could not find a
    // valid modelname".
    expect(deck.netlist).toMatch(/^XQ1 n\d+ n\d+ n\d+ MRF901$/m);
    expect(deck.netlist).not.toMatch(/^Q1 /m);
  });

  it("exports every remaining starter-library symbol to an ngspice primitive", () => {
    const components = [
      component("diode", "D1", "D", 0, 0),
      component("led", "D2", "LED", 96, 0),
      component("zener", "D3", "5V1", 192, 0),
      component("pmos", "M2", "PMOS", 288, 0),
      component("npn", "Q1", "NPN", 384, 0),
      component("pnp", "Q2", "PNP", 480, 0),
      component("opamp", "U1", "Ideal", 576, 0),
      component("potentiometer", "RV1", "10k", 672, 0),
      component("switch", "S1", "closed", 768, 0),
      component("transformer", "T1", "1:2", 864, 0),
      component("testpoint", "TP1", "", 960, 0),
      component("ground", "", "", 1024, 0),
    ];

    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });

    expect(deck.netlist).toContain("TAU_DIODE");
    expect(deck.netlist).toContain("TAU_LED");
    expect(deck.netlist).toContain("TAU_ZENER");
    expect(deck.netlist).toContain("TAU_PMOS");
    expect(deck.netlist).toContain("TAU_NPN");
    expect(deck.netlist).toContain("TAU_PNP");
    expect(deck.netlist).toContain("E_U1");
    expect(deck.netlist).toContain("R_RV1_a");
    expect(deck.netlist).toContain("R_S1");
    expect(deck.netlist).toContain("K_T1");
    expect(deck.netlist).not.toContain("TP1 ");
  });

  it("clamps an op-amp with driven supply pins to its rails (Class-D PWM comparator)", () => {
    // U1 at origin: in+(-32,16) in-(-32,-16) out(32,0) v+(0,-32) v-(0,32).
    // VP feeds v+ via a wire, v- is wired to ground - both rails driven, so the
    // deck must emit the rail-clamped B-source with the imported Avol, not the
    // unbounded E-source (which open-loop saturates to ~1e7 V).
    const components = [
      component("opamp", "U1", "Avol=1Meg GBW=10Gig Slew=10Gig", 0, 0),
      component("vsource", "VP", "10", 128, -96),
      component("vsource", "VIN", "1", -96, 48),
      component("resistor", "RL", "1k", 96, 32),
      component("ground", "", "", 0, 32), // on U1.v- → v- is the ground rail
      component("ground", "", "", 128, -64), // VP.n
      component("ground", "", "", -96, 80), // VIN.n
      component("ground", "", "", 128, 32), // RL.b
    ];
    const wires = [
      wire("wvp", [{ x: 0, y: -32 }, { x: 0, y: -128 }, { x: 128, y: -128 }]), // v+ → VP.p
      wire("win", [{ x: -32, y: 16 }, { x: -96, y: 16 }]), // in+ → VIN.p
      wire("wout", [{ x: 32, y: 0 }, { x: 64, y: 0 }, { x: 64, y: 32 }]), // out → RL.a
    ];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    expect(deck.netlist).toMatch(/B_U1 \S+ 0 V=\(V\(\S+\)\+V\(0\)\)\/2\+\(V\(\S+\)-V\(0\)\)\/2\*tanh\(1000000\*/);
    expect(deck.netlist).not.toContain("E_U1");
  });

  it("keeps the unbounded ideal op-amp when the supply pins float", () => {
    const components = [
      component("opamp", "U1", "Ideal", 0, 0),
      component("vsource", "VIN", "1", -96, 48),
      component("resistor", "RL", "1k", 96, 32),
      component("ground", "", "", -96, 80),
      component("ground", "", "", 128, 32),
    ];
    const wires = [
      wire("win", [{ x: -32, y: 16 }, { x: -96, y: 16 }]),
      wire("wout", [{ x: 32, y: 0 }, { x: 64, y: 0 }, { x: 64, y: 32 }]),
    ];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    expect(deck.netlist).toContain("E_U1");
    expect(deck.netlist).toContain("R_U1_out");
    expect(deck.netlist).not.toContain("B_U1");
  });

  it("emits a JFET (J device) with the generic NJF/PJF model", () => {
    // njf J1 at origin: d(16,-32) g(-32,0) s(16,32). Drain on a net, gate+source 0.
    const components = [
      component("njf", "J1", "NJF", 0, 0),
      component("vsource", "V1", "10", 16, -64),  // p=(16,-96), n=(16,-32)=d
      component("ground", "", "", 16, -96),       // V1 p → 0
      component("ground", "", "", -32, 0),        // g → 0
      component("ground", "", "", 16, 32),        // s → 0
    ];
    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });
    expect(deck.netlist).toMatch(/J1 \S+ 0 0 TAU_NJF/);
    expect(deck.netlist).toContain(".model TAU_NJF NJF(");
  });

  it("emits a bundled JFET standard model when referenced by name (2N3819)", () => {
    const components = [
      component("njf", "J1", "2N3819", 0, 0),
      component("vsource", "V1", "10", 16, -64),
      component("ground", "", "", 16, -96),
      component("ground", "", "", -32, 0),
      component("ground", "", "", 16, 32),
    ];
    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });
    // The device line uses the real part name, and its bundled model is emitted.
    expect(deck.netlist).toMatch(/J1 \S+ 0 0 2N3819/);
    expect(deck.netlist).toContain(".model 2N3819 NJF(");
  });

  it("emits an ideal lossless transmission line (T device, 4 nodes + Z0/TD)", () => {
    // tline T1 at origin: a1(-32,-16) a2(-32,16) b1(32,-16) b2(32,16).
    const components = [
      component("tline", "T1", "Td=50n Z0=75", 0, 0),
      component("vsource", "V1", "5", -32, 16),    // p=(-32,-16)=a1, n=(-32,48)
      component("resistor", "R1", "75", 64, -16),  // a=(32,-16)=b1, b=(96,-16)
      component("ground", "", "", -32, 16),        // a2 → 0
      component("ground", "", "", 32, 16),         // b2 → 0
      component("ground", "", "", -32, 48),        // V1 n → 0
      component("ground", "", "", 96, -16),        // R1 b → 0
    ];
    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "tran", stopTime: 5e-7, steps: 500 });
    // Port-A return (a2) and port-B return (b2) are grounded → nodes 2 and 4 are 0.
    expect(deck.netlist).toMatch(/T1 \S+ 0 \S+ 0 Z0=75 TD=5(\.0+\d*)?e-8/);
  });

  it("emits a digital AND gate as one B-source per connected output", () => {
    // A1 at origin: in1(-32,-32) in2(-32,-16) q(32,-16); qbar/com/in3-5 float.
    const components = [
      component("digitalGate", "A1", "and", 0, 0),
      component("vsource", "VA", "1", -128, -96), // p(-128,-128) n(-128,-64)
      component("vsource", "VB", "1", -224, -32), // p(-224,-64) n(-224,0)
      component("resistor", "RL", "1k", 96, -16), // a(64,-16) b(128,-16)
      component("ground", "", "", -128, -64),
      component("ground", "", "", -224, 0),
      component("ground", "", "", 128, -16),
    ];
    const wires = [
      wire("w1", [{ x: -32, y: -32 }, { x: -96, y: -32 }, { x: -96, y: -128 }, { x: -128, y: -128 }]),
      wire("w2", [{ x: -32, y: -16 }, { x: -160, y: -16 }, { x: -160, y: -64 }, { x: -224, y: -64 }]),
      wire("w3", [{ x: 32, y: -16 }, { x: 64, y: -16 }]),
    ];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    // Both driven inputs appear as threshold terms ANDed together; only the
    // connected true output emits a line (floating qbar/in3-5 are ignored).
    expect(deck.netlist).toMatch(
      /B_A1_Q \S+ 0 V=\(\(V\(\S+\)>0\.5\)&&\(V\(\S+\)>0\.5\)\) \? 1 : 0/,
    );
    expect(deck.netlist).not.toContain("B_A1_QB");
  });

  it("emits a dflop as adc bridge → XSPICE d_dff → dac bridge at its levels", () => {
    // A2 at origin: d(-32,-16) clk(-32,16) q(32,-16); pre/clr/qbar/com float.
    const components = [
      component("dflop", "A2", "Vhigh=5", 0, 0),
      component("vsource", "VD", "1", -128, 16),  // p(-128,-16) n(-128,48)
      component("vsource", "VC", "1", -224, 48),  // p(-224,16) n(-224,80)
      component("resistor", "RL", "1k", 96, -16), // a(64,-16) b(128,-16)
      component("ground", "", "", -128, 48),
      component("ground", "", "", -224, 80),
      component("ground", "", "", 128, -16),
    ];
    const wires = [
      wire("w1", [{ x: -32, y: -16 }, { x: -128, y: -16 }]),
      wire("w2", [{ x: -32, y: 16 }, { x: -224, y: 16 }]),
      wire("w3", [{ x: 32, y: -16 }, { x: 64, y: -16 }]),
    ];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    // Unconnected pre/clr tie to analog ground inside the adc bridge vector.
    expect(deck.netlist).toMatch(/A_a2_adc \[\S+ \S+ 0 0\] \[a2_dd a2_dclk a2_dpre a2_dclr\] a2_adc/);
    expect(deck.netlist).toContain(".model a2_adc adc_bridge(in_low=2.495 in_high=2.505)");
    expect(deck.netlist).toContain("A_a2 a2_dd a2_dclk a2_dpre a2_dclr a2_dq a2_dnq a2_dff");
    expect(deck.netlist).toContain(".model a2_dff d_dff(ic=0");
    // Connected q lands on its net; unconnected qbar on a private node.
    expect(deck.netlist).toMatch(/A_a2_dac \[a2_dq a2_dnq\] \[\S+ a2_qbnc\] a2_dac/);
    expect(deck.netlist).toContain(".model a2_dac dac_bridge(out_low=0 out_high=5 t_rise=1e-8 t_fall=1e-8)");
  });

  it("emits a sample-and-hold as switch + hold cap between B-source buffers", () => {
    // A1 at origin: in+(-32,-32) sh(-32,16) out(32,0); in-/clk/com float →
    // S/H (track-and-hold) mode, single-ended input.
    const components = [
      component("sampleHold", "A1", "", 0, 0),
      component("vsource", "VA", "1", -128, 0),   // p(-128,-32) n(-128,32)
      component("vsource", "VC", "1", -224, 64),  // p(-224,32) n(-224,96)
      component("resistor", "RL", "1k", 96, 0),   // a(64,0) b(128,0)
      component("ground", "", "", -128, 32),
      component("ground", "", "", -224, 96),
      component("ground", "", "", 128, 0),
    ];
    const wires = [
      wire("w1", [{ x: -32, y: -32 }, { x: -128, y: -32 }]),
      wire("w2", [{ x: -32, y: 16 }, { x: -160, y: 16 }, { x: -160, y: 32 }, { x: -224, y: 32 }]),
      wire("w3", [{ x: 32, y: 0 }, { x: 64, y: 0 }]),
    ];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    expect(deck.netlist).toMatch(/B_a1_in a1_s 0 V=V\(\S+\)/);
    expect(deck.netlist).toMatch(/B_a1_ctl a1_ctl 0 V=\(V\(\S+\)>0\.5\) \? 1 : 0/);
    expect(deck.netlist).toContain("S_a1 a1_s a1_h a1_ctl 0 a1_sw");
    expect(deck.netlist).toContain(".model a1_sw sw(vt=0.5 vh=0.2 ron=1 roff=1e12)");
    expect(deck.netlist).toContain("C_a1_h a1_h 0 1n");
    expect(deck.netlist).toMatch(/B_a1_out \S+ 0 V=V\(a1_h\)/);
    // No CLK master-slave stages in S/H mode.
    expect(deck.netlist).not.toContain("S_a1_1");
  });

  it("emits a modulator as a buffered XSPICE sine VCO", () => {
    // A1 at origin: fm(-32,-16) out(32,0); am/com float → unit amplitude,
    // ground-referenced. mark/space become the oscillator's freq_array.
    const components = [
      component("modulator", "A1", "mark=2K space=1K", 0, 0),
      component("vsource", "VF", "0.5", -128, 16), // p(-128,-16) n(-128,48)
      component("resistor", "RL", "1k", 96, 0),    // a(64,0) b(128,0)
      component("ground", "", "", -128, 48),
      component("ground", "", "", 128, 0),
    ];
    const wires = [
      wire("w1", [{ x: -32, y: -16 }, { x: -128, y: -16 }]),
      wire("w2", [{ x: 32, y: 0 }, { x: 64, y: 0 }]),
    ];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    expect(deck.netlist).toMatch(/B_a1_fm a1_fm 0 V=V\(\S+\)/);
    expect(deck.netlist).toContain("A_a1 %v(a1_fm) %v(a1_osc) a1_vco");
    expect(deck.netlist).toContain(".model a1_vco sine(cntl_array=[0 1] freq_array=[1000 2000] out_low=-1 out_high=1)");
    // AM unwired → no amplitude factor on the output buffer.
    expect(deck.netlist).toMatch(/B_a1_out \S+ 0 V=V\(a1_osc\)/);
  });

  it("gives a remapped placeholder a unique name that can't collide with a real part", () => {
    // A diac imports as a resistor keeping its `Q1` label; the old fallback made
    // that `R1` and clashed with a genuine `R1` (dimmer.asc). Now it's `RQ1`.
    const components = [
      component("vsource", "V1", "5", 0, 0),        // p(0,-32) n(0,32)
      component("resistor", "Q1", "1Meg", 32, -32), // a(0,-32) b(64,-32) - placeholder
      component("resistor", "R1", "1k", 32, 32),    // a(0,32)  b(64,32)  - real R1
      component("ground", "", "", 0, 32),
    ];
    const wires = [wire("w1", [{ x: 64, y: -32 }, { x: 64, y: 32 }])];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    const rLines = deck.netlist.split("\n").filter((l) => /^R\S+ /.test(l));
    const names = rLines.map((l) => l.split(/\s+/)[0]);
    expect(names).toContain("RQ1"); // placeholder diac, label-suffixed
    expect(names).toContain("R1");  // real resistor keeps its name
    expect(new Set(names).size).toBe(names.length); // no duplicates
  });

  it("disambiguates a manufactured name that lands on a refdes a sibling owns", () => {
    // PowerSim sub-blocks pair a resistor `Rb` with a part labeled `B` whose
    // manufactured fallback is also `RB`; the deck used to fail with a
    // duplicate-name error when such a block was opened standalone. The part
    // whose label owns the name keeps it regardless of component order.
    for (const ordered of [true, false]) {
      const pair = [
        component("resistor", "Rb", "1k", 0, 0),
        component("resistor", "B", "2k", 96, 0),
      ];
      const components = [...(ordered ? pair : pair.reverse()), component("ground", "", "", 0, 64)];
      const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });
      expect(deck.netlist).toMatch(/^Rb /m);
      expect(deck.netlist).toMatch(/^RB_2 /m);
    }
  });

  it("still rejects two parts that claim the same SPICE instance name", () => {
    const components = [
      component("resistor", "R1", "1k", 0, 0),
      { ...component("resistor", "r1", "2k", 96, 0), id: "r1-dup" },
      component("ground", "", "", 0, 64),
    ];
    expect(() => buildSpiceDeck({ components, wires: [] }, { kind: "op" }))
      .toThrow(/Duplicate SPICE instance name/);
  });
});
