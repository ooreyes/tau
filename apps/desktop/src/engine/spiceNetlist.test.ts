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

  it("falls back to the generic model when the named one is undefined", () => {
    const components = [
      component("diode", "D1", "1N4148", 0, 0),
      component("ground", "", "", 16, 32),
    ];
    // No matching .model present → must not emit an undefined model reference.
    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });
    expect(deck.netlist).toMatch(/D1 n\d+ n\d+ TAU_DIODE/);
    expect(deck.netlist).not.toContain("1N4148");
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
});
