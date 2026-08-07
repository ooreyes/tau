import { describe, expect, it } from "vitest";
import { TERMINAL_ROLES, terminalRole } from "./terminalRoles";
import { getLocalPins } from "../schematic/pins";
import { COMPONENT_KINDS } from "../schematic/types";

/**
 * The guard that did not exist when the flow visualizer was written.
 *
 * `pinInjection` used to key on the pin id alone, so an NPN's base (`c,b,e`),
 * a MOSFET's bulk (`d,g,s,b`) and a seven-segment display's segments
 * (`a,b,c,d,…`) were all read as a two-terminal part's second leg. Asserting
 * that every kind declares a role for exactly its real pins is what makes that
 * class of bug impossible to reintroduce quietly.
 */
describe("terminal roles cover every kind and pin", () => {
  it("declares a role for every kind", () => {
    for (const kind of COMPONENT_KINDS) {
      expect(TERMINAL_ROLES[kind], `no roles declared for "${kind}"`).toBeDefined();
    }
  });

  it("declares exactly the pins each kind actually has", () => {
    for (const kind of COMPONENT_KINDS) {
      const real = getLocalPins(kind).map((p) => p.id).sort();
      const declared = Object.keys(TERMINAL_ROLES[kind]).sort();
      expect(declared, `role table for "${kind}" does not match its pins`).toEqual(real);
    }
  });

  it("never reads an overloaded id as a two-terminal leg", () => {
    // The three specific misreadings that shipped.
    expect(terminalRole("npn", "b")).toEqual({ role: "terminal", terminal: "b" });
    expect(terminalRole("nmos", "b")).toEqual({ role: "none" });
    // Segments drive LEDs, so they carry real but unquantified current — a
    // boundary, never a two-terminal leg.
    expect(terminalRole("sevenSeg", "a")).toEqual({ role: "unknown" });
    expect(terminalRole("sevenSeg", "b")).toEqual({ role: "unknown" });
  });

  it("gives a diode's cathode the current its anode already had", () => {
    // `k` was missing entirely, so dots marched up to every diode and vanished.
    expect(terminalRole("diode", "a")).toEqual({ role: "series", sign: -1 });
    expect(terminalRole("diode", "k")).toEqual({ role: "series", sign: 1 });
  });

  it("treats a current source's output sense as opposite to a voltage source", () => {
    // A v-source reports its MNA branch (negative while delivering); an
    // i-source reports its output current. Reading both the same way made the
    // arrow direction depend on which way the wire was drawn.
    expect(terminalRole("vsource", "p")).toEqual({ role: "series", sign: -1 });
    expect(terminalRole("isource", "p")).toEqual({ role: "series", sign: 1 });
  });

  it("treats ground as a boundary, not as zero current", () => {
    // Ground is where a net's current leaves. Calling it zero is what made
    // every wire to a ground symbol read 0 A.
    expect(terminalRole("ground", "g")).toEqual({ role: "unknown" });
  });

  it("defaults an unmapped pin to unknown rather than to two-terminal", () => {
    expect(terminalRole("resistor", "not-a-pin")).toEqual({ role: "unknown" });
  });

  it("separates high-impedance inputs from current-sourcing outputs", () => {
    // A logic input draws nothing; a logic output really does drive a load.
    // Calling an output "none" would make a gate-to-resistor net unbalanced
    // and animate nothing.
    expect(terminalRole("digitalGate", "in1")).toEqual({ role: "none" });
    expect(terminalRole("digitalGate", "q")).toEqual({ role: "unknown" });
    expect(terminalRole("dflop", "clk")).toEqual({ role: "none" });
    expect(terminalRole("dflop", "q")).toEqual({ role: "unknown" });
    expect(terminalRole("opamp", "in+")).toEqual({ role: "none" });
    expect(terminalRole("opamp", "out")).toEqual({ role: "unknown" });
  });
});
