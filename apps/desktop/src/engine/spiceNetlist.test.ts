import { describe, expect, it } from "vitest";
import { buildSpiceDeck } from "./spiceNetlist";
import type { SchematicComponent, SchematicWire } from "../schematic/types";

const component = (
  kind: SchematicComponent["kind"],
  label: string,
  value: string,
  x: number,
  y: number,
): SchematicComponent => ({ id: label, kind, label, value, x, y, rotation: 0 });

const wire = (id: string, points: { x: number; y: number }[]): SchematicWire => ({ id, points });

describe("buildSpiceDeck", () => {
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
    // (ngspice: M nd ng ns model). The bulk node must be dropped — emitting it
    // would reinterpret the bulk as the model's optional thermal node.
    const components = [
      component("nmos", "M1", "IRFZ44N", 0, 0),
      component("ground", "", "", 16, 32),
    ];

    const deck = buildSpiceDeck(
      { components, wires: [], directives: [".model IRFZ44N VDMOS(Vto=4 Kp=20 Rd=20m)"] },
      { kind: "op" },
    );

    // 3 nodes (d g s) then the model name — no 4th bulk node before IRFZ44N.
    expect(deck.netlist).toMatch(/M1 n\d+ n\d+ 0 IRFZ44N\b/);
    expect(deck.netlist).not.toMatch(/M1 n\d+ n\d+ 0 n\d+ IRFZ44N/);
    // The VDMOS model definition is carried into the deck verbatim.
    expect(deck.netlist).toContain(".model IRFZ44N VDMOS(Vto=4 Kp=20 Rd=20m)");
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
    // VP feeds v+ via a wire, v- is wired to ground — both rails driven, so the
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
});
