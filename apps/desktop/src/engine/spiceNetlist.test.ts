import { describe, expect, it } from "vitest";
import {
  buildSpiceDeck,
  includedFileName,
  transformerWindings,
  unresolvedLibraryWarning,
  unresolvedSubcktMessage,
} from "./spiceNetlist";
import { buildParamScope } from "../simulation/paramScope";
import type { NetLabel, PinOverride, SchematicComponent, SchematicWire } from "../schematic/types";
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
    expect(deck.netlist).toContain(".subckt myamp in out");
    expect(deck.netlist).toContain(".ends");
    // An unresolvable `.lib` is reported, not emitted: the native sanitizer
    // rejects a file-backed card, so passing it through failed the whole deck.
    expect(deck.netlist).not.toContain(".lib /path/std.lib NMOS");
    expect(deck.circuit.warnings).toContain(unresolvedLibraryWarning("/path/std.lib"));
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

  it("resolves a semiconductor model from a user-supplied vendor library (no inline/bundled model exists)", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("diode", "D1", "ACME_D1", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const userModelLibraries = [".model ACME_D1 D(Is=3e-9 N=1.1 Rs=0.4)"];
    const deck = buildSpiceDeck({ components, wires, userModelLibraries }, { kind: "op" });
    // The user library's real model line is inlined and the device references it.
    expect(deck.netlist).toContain(".model ACME_D1 D(Is=3e-9 N=1.1 Rs=0.4)");
    expect(deck.netlist).toMatch(/D1 \S+ \S+ ACME_D1/);
    // The generic TAU_DIODE substitute is NOT used for this part's device line.
    expect(deck.netlist).not.toMatch(/D1 \S+ \S+ TAU_DIODE/);
  });

  it("prefers an attached user library's model over a same-named bundled standard part", () => {
    // Resolution order: inline document .model > attached user library >
    // Tau's bundled standard part, so a user-attached vendor file that
    // redefines a name Tau also bundles wins (LTspice local-definition-wins
    // semantics) instead of being silently shadowed by the bundled model.
    const components = [component("diode", "D1", "1N4148", 0, 0), component("ground", "", "", 16, 32)];
    const userModelLibraries = [".model 1N4148 D(Is=999 N=999)"];
    const deck = buildSpiceDeck({ components, wires: [], userModelLibraries }, { kind: "op" });
    expect(deck.netlist).toMatch(/^\.model 1N4148 D\(Is=999 N=999\)/m);
    expect(deck.netlist).not.toContain("Is=2.52n");
  });

  it("prefers an attached user library's subckt over a same-named bundled subcircuit", () => {
    // Same local-definition-wins rule for subckts: "opamp" is a bundled
    // library subcircuit (Opamps\\opamp.asy → OPAMP_SUB); an attached vendor
    // file that redefines it must win and the bundled body must not appear.
    let counter = 0;
    const uid = (p: string) => `${p}-${++counter}`;
    const sub = (label: string, pins: Array<[string, string, number, number]>): SchematicComponent => ({
      id: uid("subckt"),
      kind: "subckt",
      x: 0,
      y: 0,
      rotation: 0,
      value: "opamp",
      label,
      pinOverride: pins.map(([id, pinLabel, x, y]): PinOverride => ({ id, label: pinLabel, x, y })),
    });
    const lbl = (x: number, y: number, text: string): NetLabel => ({ id: uid("flag"), x, y, text });

    const comps = [sub("U1", [["p1", "1", 0, 0], ["p2", "2", 0, 80], ["p3", "3", 160, 40]])];
    const netLabels = [lbl(0, 80, "0")];
    const userModelLibraries = [".subckt opamp 1 2 3\nR1 1 3 1\n.ends opamp"];
    const deck = buildSpiceDeck({ components: comps, wires: [], netLabels, userModelLibraries }, { kind: "op" });
    expect(deck.netlist).toContain("R1 1 3 1");
    expect(deck.netlist).not.toContain("G1 0 3 2 1");
    expect(deck.netlist.match(/^\.subckt opamp /gm)?.length).toBe(1);
  });

  it("resolves a same-named subckt from the FIRST attached library when two both define it", () => {
    // Deterministic collision resolution across two attachments: the caller
    // always builds `userModelLibraries` in the schematic's attachment order
    // (store/useSchematic.ts's attachModelLibrary appends), and
    // parseUserModelLibraries keeps the first definition it sees - so "first
    // attached" always wins, never an arbitrary iteration order.
    let counter = 0;
    const uid = (p: string) => `${p}-${++counter}`;
    const sub = (label: string, pins: Array<[string, string, number, number]>): SchematicComponent => ({
      id: uid("subckt"),
      kind: "subckt",
      x: 0,
      y: 0,
      rotation: 0,
      value: "opamp",
      label,
      pinOverride: pins.map(([id, pinLabel, x, y]): PinOverride => ({ id, label: pinLabel, x, y })),
    });
    const lbl = (x: number, y: number, text: string): NetLabel => ({ id: uid("flag"), x, y, text });

    const comps = [sub("U1", [["p1", "1", 0, 0], ["p2", "2", 0, 80], ["p3", "3", 160, 40]])];
    const netLabels = [lbl(0, 80, "0")];
    const userModelLibraries = [
      ".subckt opamp 1 2 3\nR1 1 3 111\n.ends opamp",
      ".subckt opamp 1 2 3\nR1 1 3 222\n.ends opamp",
    ];
    const deck = buildSpiceDeck({ components: comps, wires: [], netLabels, userModelLibraries }, { kind: "op" });
    expect(deck.netlist).toContain("R1 1 3 111");
    expect(deck.netlist).not.toContain("R1 1 3 222");
  });

  it("resolves a subckt from a user-supplied vendor library, emitted once even when referenced twice", () => {
    let counter = 0;
    const uid = (p: string) => `${p}-${++counter}`;
    const sub = (label: string, pins: Array<[string, string, number, number]>): SchematicComponent => ({
      id: uid("subckt"),
      kind: "subckt",
      x: 0,
      y: 0,
      rotation: 0,
      value: "VendorBlock",
      label,
      pinOverride: pins.map(([id, pinLabel, x, y]): PinOverride => ({ id, label: pinLabel, x, y })),
    });
    const lbl = (x: number, y: number, text: string): NetLabel => ({ id: uid("flag"), x, y, text });

    const comps = [
      sub("U1", [["p1", "+", 0, 0], ["p2", "-", 0, 80]]),
      sub("U2", [["p1", "+", 160, 0], ["p2", "-", 160, 80]]),
    ];
    const netLabels = [lbl(0, 80, "0")]; // establishes the circuit's ground reference
    const userModelLibraries = [".subckt VendorBlock a b\nR1 a b 4.7k\n.ends VendorBlock"];
    const deck = buildSpiceDeck(
      { components: comps, wires: [], netLabels, userModelLibraries },
      { kind: "op" },
    );
    // Both instances reference the block; it is inlined exactly once.
    expect(deck.netlist.match(/^\.subckt VendorBlock /gm)?.length).toBe(1);
    expect(deck.netlist).toMatch(/^XU1 \S+ \S+ VendorBlock$/m);
    expect(deck.netlist).toMatch(/^XU2 \S+ \S+ VendorBlock$/m);
    expect(deck.netlist).toContain("R1 a b 4.7k");
    // A fully-resolved deck reports nothing missing.
    expect(deck.unresolvedSubckts).toEqual([]);
  });

  it("reports subckt references with no inline, bundled, or imported definition", () => {
    let counter = 0;
    const uid = (p: string) => `${p}-${++counter}`;
    const sub = (label: string, value: string, pins: Array<[string, string, number, number]>): SchematicComponent => ({
      id: uid("subckt"),
      kind: "subckt",
      x: 0,
      y: 0,
      rotation: 0,
      value,
      label,
      pinOverride: pins.map(([id, pinLabel, x, y]): PinOverride => ({ id, label: pinLabel, x, y })),
    });
    const lbl = (x: number, y: number, text: string): NetLabel => ({ id: uid("flag"), x, y, text });

    const comps = [
      // Two instances of the same missing vendor op-amp (dedup) plus one of a
      // second missing part (sorted). No inline .subckt, not a bundled block,
      // and no user library is attached.
      sub("U1", "LT1001", [["p1", "+", 0, 0], ["p2", "-", 0, 80]]),
      sub("U2", "LT1001", [["p1", "+", 160, 0], ["p2", "-", 160, 80]]),
      sub("U3", "AD8000", [["p1", "+", 320, 0], ["p2", "-", 320, 80]]),
    ];
    const netLabels = [lbl(0, 80, "0")]; // ground reference
    const deck = buildSpiceDeck({ components: comps, wires: [], netLabels }, { kind: "op" });

    expect(deck.unresolvedSubckts).toEqual(["AD8000", "LT1001"]);
    // The netlist still emits the X lines; the field is advisory, not a rewrite.
    expect(deck.netlist).toMatch(/^XU1 \S+ \S+ LT1001$/m);
    expect(deck.netlist).toMatch(/^XU3 \S+ \S+ AD8000$/m);
  });

  it("does not report a subckt that a document .subckt directive defines inline", () => {
    let counter = 0;
    const uid = (p: string) => `${p}-${++counter}`;
    const sub = (label: string, value: string, pins: Array<[string, string, number, number]>): SchematicComponent => ({
      id: uid("subckt"),
      kind: "subckt",
      x: 0,
      y: 0,
      rotation: 0,
      value,
      label,
      pinOverride: pins.map(([id, pinLabel, x, y]): PinOverride => ({ id, label: pinLabel, x, y })),
    });
    const lbl = (x: number, y: number, text: string): NetLabel => ({ id: uid("flag"), x, y, text });

    const comps = [sub("U1", "MyBlock", [["p1", "a", 0, 0], ["p2", "b", 0, 80]])];
    const netLabels = [lbl(0, 80, "0")];
    const directives = [".subckt MyBlock a b\\nR1 a b 2.2k\\n.ends MyBlock"];
    const deck = buildSpiceDeck({ components: comps, wires: [], netLabels, directives }, { kind: "op" });

    expect(deck.unresolvedSubckts).toEqual([]);
    expect(deck.netlist).toMatch(/^XU1 \S+ \S+ MyBlock$/m);
  });

  it("leaves deck output unchanged when no user model libraries are supplied (regression guard)", () => {
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
    const withoutField = buildSpiceDeck({ components, wires }, { kind: "op" });
    const withEmptyLibraries = buildSpiceDeck({ components, wires, userModelLibraries: [] }, { kind: "op" });
    expect(withEmptyLibraries.netlist).toBe(withoutField.netlist);
    // Sanity: the bundled standard model still wins with no user library present.
    expect(withoutField.netlist).toMatch(/^\.model 1N4148 D\(/m);
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

  // ngspice hands back a semiconductor's own current only for a deck that named
  // it. Without these cards a clamp probe on a transistor resolves to nothing.
  describe("device current `.save`", () => {
    const semiconductors = () => [
      component("ground", "", "", -32, 64),
      component("npn", "Q1", "NPN", 0, 0),
      component("diode", "D1", "D", 128, 0),
      component("nmos", "M1", "NMOS", 256, 0),
      component("njf", "J1", "NJF", 384, 0),
      component("resistor", "R1", "1k", 512, 0),
    ];

    it("asks for each semiconductor's own current, and for `all` so the defaults survive", () => {
      const deck = buildSpiceDeck(
        { components: semiconductors(), wires: [] },
        { kind: "tran", stopTime: 1e-3, steps: 100 },
      );
      // `all` is the whole safety of this card: a bare `.save` REPLACES
      // ngspice's default set, so without it the run comes back with the device
      // currents and nothing else - no node voltages, no source branches.
      expect(deck.netlist).toMatch(/^\.save all @q1\[ic\] @d1\[id\] @m1\[id\] @j1\[id\]$/m);
      // Passives have no device vector; their currents are derived from the
      // node voltages instead.
      expect(deck.netlist).not.toContain("@r1");
      expect(deck.deviceCurrents).toEqual([
        { componentId: "Q1", vector: "@q1[ic]" },
        { componentId: "D1", vector: "@d1[id]" },
        { componentId: "M1", vector: "@m1[id]" },
        { componentId: "J1", vector: "@j1[id]" },
      ]);
    });

    it("asks for the same device currents on an `.op` deck as on a transient deck, with node/source content otherwise unchanged", () => {
      // Proven against real ngspice: on an `.op` deck, `.save all @q1[ic] …` is
      // a STRICT SUPERSET of the default vector set - every node voltage and
      // every `#branch` current still comes back, plus the named device
      // currents - so the operating point is the other analysis (besides
      // transient) that can read a semiconductor's own current back.
      const opDeck = buildSpiceDeck({ components: semiconductors(), wires: [] }, { kind: "op" });
      const tranDeck = buildSpiceDeck(
        { components: semiconductors(), wires: [] },
        { kind: "tran", stopTime: 1e-3, steps: 100 },
      );
      expect(opDeck.netlist).toMatch(/^\.save all @q1\[ic\] @d1\[id\] @m1\[id\] @j1\[id\]$/m);
      expect(opDeck.deviceCurrents).toEqual(tranDeck.deviceCurrents);
      // The `.save` card and the trailing analysis line are the only place an
      // `.op` deck and a `.tran` deck built from the same schematic may
      // differ - every node name, source line, and model line is identical.
      const withoutSaveAndAnalysis = (netlist: string) =>
        netlist.split("\n").filter((line) => !/^(\.save\b|\+ @|\.op$|\.tran\b)/.test(line));
      expect(withoutSaveAndAnalysis(opDeck.netlist)).toEqual(withoutSaveAndAnalysis(tranDeck.netlist));
    });

    it("carries no `.save` on an analysis that does not read device currents", () => {
      for (const analysis of [{ kind: "ac" as const, startHz: 1, stopHz: 1e3, pointsPerDecade: 10 }]) {
        const deck = buildSpiceDeck({ components: semiconductors(), wires: [] }, analysis);
        expect(deck.netlist, analysis.kind).not.toContain(".save");
        expect(deck.deviceCurrents, analysis.kind).toEqual([]);
      }
    });

    it("asks for nothing on a BJT emitted as a subcircuit call, which has no device vector", () => {
      const components = [
        component("npn", "Q1", "MRF901", 0, 0),
        component("ground", "", "", -32, 64),
      ];
      const directives = [".subckt MRF901 1 2 3\\nQA 1 2 3 QR99\\n.model QR99 NPN(BF=88)\\n.ends MRF901"];
      const deck = buildSpiceDeck(
        { components, wires: [], directives },
        { kind: "tran", stopTime: 1e-3, steps: 100 },
      );
      expect(deck.netlist).toMatch(/^XQ1 /m);
      expect(deck.netlist).not.toContain(".save");
      expect(deck.deviceCurrents).toEqual([]);
    });

    it("wraps a long card onto `+` continuations rather than one enormous line", () => {
      const many = [
        component("ground", "", "", -32, 64),
        ...Array.from({ length: 24 }, (_, index) => component("npn", `Q${index + 1}`, "NPN", index * 128, 0)),
      ];
      const deck = buildSpiceDeck({ components: many, wires: [] }, { kind: "tran", stopTime: 1e-3, steps: 100 });
      const card = deck.netlist.split("\n").filter((line) => /^(\.save|\+ @)/.test(line));
      expect(card.length).toBeGreaterThan(1);
      expect(card[0].startsWith(".save all ")).toBe(true);
      expect(card.slice(1).every((line) => line.startsWith("+ "))).toBe(true);
      expect(Math.max(...card.map((line) => line.length))).toBeLessThanOrEqual(120);
      // Every device is still named exactly once across the wrapped card.
      const named = card.join(" ").match(/@q\d+\[ic\]/g) ?? [];
      expect(new Set(named).size).toBe(24);
    });
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

  // A switched load: V1 -> S1 -> R1 -> ground, with S1's NC+/NC- pair driven by
  // VC. Reused by the three switch cases below, which differ only in wiring.
  const switchedLoad = (controlled: boolean) => {
    const components = [
      component("vsource", "V1", "5", -128, 32),
      component("ground", "", "", -128, 64),
      component("switch", "S1", "MYSW", 0, 0),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 128, 0),
      ...(controlled
        ? [
          component("vsource", "VC", "2", -16, 96),
          component("ground", "", "", -16, 128),
          component("ground", "", "", 16, 32),
        ]
        : []),
    ];
    const wires = [
      wire("w1", [{ x: -128, y: 0 }, { x: -32, y: 0 }]),
      wire("w2", [{ x: 32, y: 0 }, { x: 64, y: 0 }]),
      ...(controlled ? [wire("w3", [{ x: -16, y: 32 }, { x: -16, y: 64 }])] : []),
    ];
    return { components, wires, directives: [".model MYSW SW(Ron=1 Roff=1Meg Vt=1)"] };
  };

  it("emits a voltage-controlled switch as an S device driven by its control pair", () => {
    const deck = buildSpiceDeck(switchedLoad(true), { kind: "op" });

    // S <n+> <n-> <control+> <control-> <model> - not a fixed resistance.
    expect(deck.netlist).toMatch(/^S1 \S+ \S+ \S+ \S+ MYSW$/m);
    expect(deck.netlist).not.toMatch(/^R_S1 /m);
    expect(deck.circuit.warnings).toEqual([]);
  });

  it("reports a model-named switch with no control wiring instead of silently opening it", () => {
    const deck = buildSpiceDeck(switchedLoad(false), { kind: "op" });

    expect(deck.netlist).toMatch(/^R_S1 \S+ \S+ 1e12$/m);
    expect(deck.circuit.warnings.some((w) => w.startsWith("S1 has no control connection"))).toBe(true);
    // The optional control pair must not also surface as extraction noise:
    // assistantActions treats any extraction warning as a fatal rejection.
    expect(deck.circuit.warnings.filter((w) => w.includes("only connected to one pin"))).toEqual([]);
  });

  it("keeps a switch left on Tau's static state a fixed resistance, unwarned", () => {
    const open = { ...switchedLoad(false), components: switchedLoad(false).components };
    open.components[2] = component("switch", "S1", "open", 0, 0);
    expect(buildSpiceDeck(open, { kind: "op" }).netlist).toMatch(/^R_S1 \S+ \S+ 1e12$/m);
    expect(buildSpiceDeck(open, { kind: "op" }).circuit.warnings).toEqual([]);

    const closed = { ...switchedLoad(false), components: switchedLoad(false).components };
    closed.components[2] = component("switch", "S1", "closed", 0, 0);
    expect(buildSpiceDeck(closed, { kind: "op" }).netlist).toMatch(/^R_S1 \S+ \S+ 1m$/m);
    expect(buildSpiceDeck(closed, { kind: "op" }).circuit.warnings).toEqual([]);
  });

  it("falls back to the starter switch model when the document defines none", () => {
    const deck = buildSpiceDeck({ ...switchedLoad(true), directives: [] }, { kind: "op" });

    expect(deck.netlist).toMatch(/^S1 \S+ \S+ \S+ \S+ TAU_SW$/m);
    expect(deck.netlist).toContain(".model TAU_SW SW(");
    expect(deck.modelSubstitutions.map((s) => s.ref)).toContain("S1");
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

describe("unresolvedSubcktMessage", () => {
  it("names a single missing subcircuit and how to supply it", () => {
    const message = unresolvedSubcktMessage(["LT1001"]);
    expect(message).toBe(
      'No imported library defines the subcircuit "LT1001". Attach the vendor model file (.lib or .subckt) that defines it under Model libraries, then run again.',
    );
    // Plain product copy: userFacingErrorMessage must be able to surface it
    // verbatim, so it carries no engine transcript markers or JS-error shapes.
    expect(message).not.toMatch(/stdout|stderr|ngspice|is not a function/i);
  });

  it("lists several missing subcircuits in the plural", () => {
    expect(unresolvedSubcktMessage(["AD8000", "LT1001"])).toBe(
      'No imported library defines these subcircuits: "AD8000", "LT1001". Attach the vendor model files (.lib or .subckt) that define them under Model libraries, then run again.',
    );
  });

  it("caps the enumerated list so the message stays short", () => {
    const names = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const message = unresolvedSubcktMessage(names);
    expect(message).toContain('"A", "B", "C", "D", "E", "F", and 2 more');
    expect(message).not.toContain('"G"');
  });
});

describe("model substitution reporting", () => {
  const grounded = () => component("ground", "", "", 0, 0);

  it("reports a named vendor part that resolved to a generic starter", () => {
    // The trust-destroying case: the deck happily emits a textbook Level=1
    // device under the vendor part's designator. Silence here means the user
    // reads a confident waveform for a device Tau does not have.
    const deck = buildSpiceDeck(
      { components: [grounded(), component("nmos", "M1", "IRF540", 128, 128)], wires: [] },
      { kind: "op" },
    );

    expect(deck.modelSubstitutions).toEqual([
      { ref: "M1", requested: "IRF540", substituted: "TAU_NMOS" },
    ]);
    expect(deck.netlist).toContain("TAU_NMOS");

    const [warning] = deck.circuit.warnings.filter((w) => w.includes("IRF540"));
    expect(warning).toBe(
      'M1: model "IRF540" was not found. Tau simulates it as a generic NMOS (Level=1), which will not match the real device.',
    );
  });

  it("stays silent for a part left on its Library default value", () => {
    // Placing an NMOS from the Library and not naming a part is not a
    // substitution - warning here would fire on every default-placed device
    // and train the user to ignore the channel that matters.
    const deck = buildSpiceDeck(
      { components: [grounded(), component("nmos", "M1", "NMOS W=10u L=1u", 128, 128)], wires: [] },
      { kind: "op" },
    );

    expect(deck.modelSubstitutions).toEqual([]);
  });

  it("stays silent when the document defines the model it names", () => {
    const deck = buildSpiceDeck(
      {
        components: [grounded(), component("nmos", "M1", "MYFET", 128, 128)],
        wires: [],
        directives: [".model MYFET NMOS(Level=1 Vto=2)"],
      },
      { kind: "op" },
    );

    expect(deck.modelSubstitutions).toEqual([]);
    expect(deck.netlist).toContain("MYFET");
  });

  it("names every unresolved part, not just the first", () => {
    // BC847C is deliberately not one of the bundled standard parts; 2N3904 is,
    // and is asserted below to stay silent.
    const deck = buildSpiceDeck(
      {
        components: [
          grounded(),
          component("nmos", "M1", "IRF540", 128, 128),
          component("npn", "Q1", "BC847C", 256, 128),
        ],
        wires: [],
      },
      { kind: "op" },
    );

    expect(deck.modelSubstitutions.map((s) => s.ref).sort()).toEqual(["M1", "Q1"]);
  });

  it("stays silent for a part the bundled standard library defines", () => {
    // 2N3904 ships in standardModels.ts, so it resolves for real. Warning on a
    // part Tau actually models would be a false alarm.
    const deck = buildSpiceDeck(
      { components: [grounded(), component("npn", "Q1", "2N3904", 128, 128)], wires: [] },
      { kind: "op" },
    );

    expect(deck.modelSubstitutions).toEqual([]);
    expect(deck.netlist).toContain("2N3904");
  });
});

describe("transformerWindings", () => {
  it("defaults to a 10 mH magnetizing inductance and near-unity coupling", () => {
    expect(transformerWindings("1:1")).toEqual({ primary: 10e-3, secondary: 10e-3, coupling: 0.999 });
  });

  it("derives the secondary from the turns ratio", () => {
    // L2 = L1 * (Ns/Np)^2
    expect(transformerWindings("1:2").secondary).toBeCloseTo(40e-3, 9);
    expect(transformerWindings("2:1").secondary).toBeCloseTo(2.5e-3, 9);
  });

  it("honors explicit L1, L2 and k instead of the hardcoded defaults", () => {
    // Magnetizing and leakage inductance are the two numbers a flyback is
    // designed around; before this they were unreachable.
    const spec = transformerWindings("1:2 L1=2m L2=8m k=0.98");
    expect(spec.primary).toBeCloseTo(2e-3, 9);
    expect(spec.secondary).toBeCloseTo(8e-3, 9);
    expect(spec.coupling).toBeCloseTo(0.98, 9);
  });

  it("keeps the ratio-derived secondary when only L1 is given", () => {
    const spec = transformerWindings("1:3 L1=1m");
    expect(spec.primary).toBeCloseTo(1e-3, 9);
    expect(spec.secondary).toBeCloseTo(9e-3, 9);
  });

  it("refuses a coupling of 1, which makes the coupled pair singular", () => {
    expect(transformerWindings("1:1 k=1").coupling).toBe(0.999);
    expect(transformerWindings("1:1 k=1.5").coupling).toBe(0.999);
  });

  it("emits the parsed values into the deck", () => {
    const deck = buildSpiceDeck(
      {
        components: [
          component("ground", "", "", 0, 0),
          component("transformer", "T1", "1:2 L1=2m k=0.95", 128, 128),
        ],
        wires: [],
      },
      { kind: "op" },
    );
    expect(deck.netlist).toContain("L_T1_p");
    expect(deck.netlist).toMatch(/L_T1_p \S+ \S+ 0\.002/);
    expect(deck.netlist).toMatch(/K_T1 L_T1_p L_T1_s 0\.95/);
  });
});

describe("includedFileName", () => {
  it("takes the path only, dropping a .lib section name", () => {
    expect(includedFileName("mymodels.lib")).toBe("mymodels.lib");
    expect(includedFileName("/path/to/std.lib NMOS")).toBe("/path/to/std.lib");
    expect(includedFileName("  spaced.lib  ")).toBe("spaced.lib");
  });

  it("keeps the spaces inside a quoted path", () => {
    expect(includedFileName('"C:\\my models\\adi.lib"')).toBe("C:\\my models\\adi.lib");
    expect(includedFileName("'my models/adi.lib' TYP")).toBe("my models/adi.lib");
  });
});

describe("unresolvable .include/.lib directives", () => {
  const rc = (directives: string[]) =>
    buildSpiceDeck(
      {
        components: [
          component("vsource", "V1", "5", 0, 32),
          component("resistor", "R1", "1k", 96, 0),
          component("ground", "", "", 0, 64),
        ],
        wires: [wire("w1", [{ x: 0, y: 0 }, { x: 96, y: 0 }])],
        directives,
      },
      { kind: "op" },
    );

  // The native sanitizer (src-tauri/src/spice.rs `deck_lines`) rejects every
  // file-backed card, so a passed-through `.include` failed the whole run.
  it("keeps the directive out of the deck so the run is not rejected outright", () => {
    const deck = rc([".include mymodels.lib"]);
    expect(deck.netlist).not.toMatch(/^\.(?:include|lib)\b/m);
    expect(deck.netlist).toContain(".op");
  });

  it("names the file it could not resolve on the warning channel", () => {
    expect(rc([".include mymodels.lib"]).circuit.warnings).toContain(
      unresolvedLibraryWarning("mymodels.lib"),
    );
  });

  it("reports the path alone for the `.inc` alias and a sectioned `.lib`", () => {
    expect(rc([".inc sub/vendor.mod"]).circuit.warnings).toContain(
      unresolvedLibraryWarning("sub/vendor.mod"),
    );
    // The path is reported as the document wrote it, not shortened to a
    // basename - a user looking for the file needs the reference they typed.
    expect(rc([".lib /opt/models/std.lib NMOS"]).circuit.warnings).toContain(
      unresolvedLibraryWarning("/opt/models/std.lib"),
    );
  });

  it("reports each missing file once, however many directives name it", () => {
    const warnings = rc([".include dup.lib", ".inc dup.lib", ".include other.lib"]).circuit.warnings;
    expect(warnings.filter((w) => w.includes("dup.lib"))).toHaveLength(1);
    expect(warnings.filter((w) => w.includes("other.lib"))).toHaveLength(1);
  });

  // The importer reads a `.include`d file that sits beside the schematic and
  // attaches it, so the same directive that used to be unresolvable now has
  // its text in the deck. Warning about it anyway would contradict the run.
  it("says nothing when the named file is attached as a model library", () => {
    const deck = buildSpiceDeck(
      {
        components: [
          component("vsource", "V1", "5", 0, 32),
          component("resistor", "R1", "1k", 96, 0),
          component("ground", "", "", 0, 64),
        ],
        wires: [wire("w1", [{ x: 0, y: 0 }, { x: 96, y: 0 }])],
        directives: [".include models/vendor.lib"],
        userModelLibraries: [".subckt VEND 1 2\nR1 1 2 1k\n.ends VEND"],
        userModelLibraryNames: ["vendor.lib"],
      },
      { kind: "op" },
    );
    expect(deck.circuit.warnings.filter((w) => w.includes("Could not resolve"))).toEqual([]);
  });

  it("still warns when the attached libraries do not include the named file", () => {
    const deck = buildSpiceDeck(
      {
        components: [
          component("vsource", "V1", "5", 0, 32),
          component("resistor", "R1", "1k", 96, 0),
          component("ground", "", "", 0, 64),
        ],
        wires: [wire("w1", [{ x: 0, y: 0 }, { x: 96, y: 0 }])],
        directives: [".include models/vendor.lib"],
        userModelLibraries: [".subckt OTHER 1 2\nR1 1 2 1k\n.ends OTHER"],
        userModelLibraryNames: ["unrelated.lib"],
      },
      { kind: "op" },
    );
    expect(deck.circuit.warnings).toContain(unresolvedLibraryWarning("models/vendor.lib"));
  });

  it("says nothing when the reference resolves to a bundled library", () => {
    const deck = rc([".include TowTom2.sub"]);
    expect(deck.netlist).toContain(".subckt TowTom2");
    expect(deck.circuit.warnings.filter((w) => w.includes("Could not resolve"))).toEqual([]);
  });

  // Dropping the directive must not disturb the `.subckt … .ends` depth
  // tracking that decides whether a `{param}` is substituted here or left for
  // ngspice to resolve against the subcircuit's own scope.
  it("leaves a document-defined subcircuit around it intact", () => {
    const directives = [
      ".param Rload=1k",
      ".subckt buf a b\n.include vendor.lib\nR1 a b {Rload}\n.ends",
      ".model DX D(Is={Rload})",
    ];
    const deck = buildSpiceDeck(
      {
        components: [component("resistor", "R1", "1k", 96, 0), component("ground", "", "", 0, 64)],
        wires: [],
        directives,
        params: buildParamScope(directives),
      },
      { kind: "op" },
    );
    expect(deck.netlist).toContain(".subckt buf a b");
    // Inside the block the brace stays for the subcircuit's own scope; the
    // `.model` after `.ends` is back at document scope and gets substituted.
    // Both only hold if dropping the `.include` left the depth count alone.
    expect(deck.netlist).toContain("R1 a b {Rload}");
    expect(deck.netlist).toContain(".model DX D(Is=1000)");
    expect(deck.netlist).not.toMatch(/^\.(?:include|lib)\b/m);
    expect(deck.circuit.warnings).toContain(unresolvedLibraryWarning("vendor.lib"));
  });
});
