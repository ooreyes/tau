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
