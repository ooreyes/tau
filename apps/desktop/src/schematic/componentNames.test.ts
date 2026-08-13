import { describe, expect, it } from "vitest";

import { CATALOG_BY_KIND } from "./catalog";
import { COMPONENT_DISPLAY_NAME, componentDisplayName } from "./componentNames";
import { COMPONENT_KINDS } from "./types";

/**
 * One source of truth for what a part is CALLED.
 *
 * Before this map the answer lived in three places and disagreed with itself:
 * the catalog's palette name ("PMOS"), a private partial map in the telemetry
 * dock that fell back to a capitalised enum, and the Properties panel, which
 * printed the raw kind ("pmos") beside the palette name. These tests exist to
 * keep it from splitting again - the totality check in particular, which is the
 * one that fires when someone adds a kind and forgets to name it.
 */
describe("component display names", () => {
  it("names every kind, so a new part cannot ship as a bare enum", () => {
    const missing = COMPONENT_KINDS.filter((kind) => !COMPONENT_DISPLAY_NAME[kind]?.trim());
    expect(missing).toEqual([]);
  });

  it("reads as prose, not as an identifier", () => {
    for (const kind of COMPONENT_KINDS) {
      const name = COMPONENT_DISPLAY_NAME[kind];
      // A name equal to the kind string is the fallback leaking through.
      expect(name).not.toBe(kind);
      expect(name).toBe(name.trim());
      expect(name.startsWith(name[0].toUpperCase()) || /^[a-z]?[A-Z]/.test(name)).toBe(true);
    }
  });

  it("spells the reference's three parts out in full", () => {
    expect(componentDisplayName("pmos")).toBe("P-channel MOSFET");
    expect(componentDisplayName("potentiometer")).toBe("Potentiometer");
    expect(componentDisplayName("vcvs")).toBe("Voltage-controlled voltage source");
  });

  it("stays distinct from the catalog's short palette name where the two differ", () => {
    // The palette name is tuned for a narrow browse column and is allowed to be
    // an abbreviation; this map is not. Where the catalog abbreviates, this
    // must not simply copy it.
    for (const kind of ["pmos", "nmos", "vcvs", "vccs", "cccs", "ccvs", "modulator", "subckt"] as const) {
      expect(componentDisplayName(kind)).not.toBe(CATALOG_BY_KIND[kind].name);
    }
  });

  it("returns an unknown kind unchanged rather than inventing a title for it", () => {
    expect(componentDisplayName("notAKind")).toBe("notAKind");
  });
});

/**
 * PDF-3 item 1. The inspector title is the surface the report caught lying:
 * "DC source" over a Waveform selector reading Sine
 * (`screenshots/pdf3-report/img-001-000.png`). An independent source's identity
 * is its waveform, and the waveform lives in the value.
 */
describe("an independent source is named for its waveform", () => {
  it("names every voltage waveform with the Waveform dropdown's own word", () => {
    expect(componentDisplayName("vsource", "5")).toBe("DC source");
    expect(componentDisplayName("vsource", "SINE(0 1 1k)")).toBe("Sine voltage source");
    expect(componentDisplayName("vsource", "PULSE(0 5 0 1n 1n 5u 10u)")).toBe("Pulse voltage source");
    expect(componentDisplayName("vsource", "PWL(0 0 1m 1)")).toBe("Piecewise linear voltage source");
    expect(componentDisplayName("vsource", "EXP(0 1 0 1u 1m 1u)")).toBe("Exponential voltage source");
    expect(componentDisplayName("vsource", "SFFM(0 1 1k 1 100)")).toBe("Single-frequency FM voltage source");
  });

  it("names every current waveform the same way", () => {
    expect(componentDisplayName("isource", "1m")).toBe("Current source");
    expect(componentDisplayName("isource", "SINE(0 1m 1k)")).toBe("Sine current source");
    expect(componentDisplayName("isource", "PULSE(0 1m 0 1n 1n 5u 10u)")).toBe("Pulse current source");
    expect(componentDisplayName("isource", "PWL(0 0 1m 1m)")).toBe("Piecewise linear current source");
    expect(componentDisplayName("isource", "EXP(0 1m 0 1u 1m 1u)")).toBe("Exponential current source");
    expect(componentDisplayName("isource", "SFFM(0 1m 1k 1 100)")).toBe("Single-frequency FM current source");
  });

  it("reads an imported LTspice source correctly without mutating it", () => {
    // The case a kind rewrite could never reach: this value arrived from a
    // file, so nothing in Tau ever "chose" a waveform for it.
    expect(componentDisplayName("vsource", "DC 2 SINE(0 1 1k)")).toBe("Sine voltage source");
    expect(componentDisplayName("vsource", "SINE(0 1 1k) AC 1")).toBe("Sine voltage source");
  });

  it("decodes the legacy alias kinds in their own positional dialect", () => {
    // `vac`'s "1 1k" is amplitude+frequency, not a DC level; `vpulse`'s four
    // tokens are low/high/frequency/duty. Reading either as a plain number
    // would title a sine source "DC source" all over again.
    expect(componentDisplayName("vac", "1 1k")).toBe("Sine voltage source");
    expect(componentDisplayName("iac", "1m 1k")).toBe("Sine current source");
    expect(componentDisplayName("vpulse", "0 5 100k 0.5")).toBe("Pulse voltage source");
    // A legal LTspice `vac` carrying an explicit pulse function (pinned in
    // engine/spiceNetlist.test.ts) is a pulse source, whatever the kind says.
    expect(componentDisplayName("vac", "DC 2 PULSE(0 5 0 1n 1n 5u 10u)")).toBe("Pulse voltage source");
  });

  it("never titles a non-DC waveform 'DC source' - the exact state the report caught", () => {
    const values = [
      "SINE(5 1 1k)", "DC 2 SINE(0 1 1k)", "PULSE(0 5 0 1n 1n 5u 10u)",
      "PWL(0 0 1m 1)", "EXP(0 1 0 1u 1m 1u)", "SFFM(0 1 1k 1 100)", "SIN(0 1 1k)",
    ];
    for (const kind of ["vsource", "isource", "vac", "iac", "vpulse"] as const) {
      for (const value of values) {
        expect(componentDisplayName(kind, value), `${kind} ${value}`).not.toBe("DC source");
      }
    }
  });

  it("keeps bare kinds stable apart from the explicit PDF4 terminology", () => {
    // 27 existing call sites still pass a bare kind; source identities remain
    // stable, while LED/SPST spelling is deliberately more specific in PDF4.
    expect(componentDisplayName("vsource")).toBe("DC source");
    expect(componentDisplayName("isource")).toBe("Current source");
    expect(componentDisplayName("vac")).toBe("Sine voltage source");
    // A value on a kind that has no waveform is ignored, so callers may always
    // pass the whole component without checking what it is first.
    expect(componentDisplayName("resistor", "1k")).toBe("Resistor");
    expect(componentDisplayName("led", "LED color=green")).toBe("Generic LED");
    expect(componentDisplayName("switch", "open")).toBe("SPST switch");
    expect(componentDisplayName("notAKind", "anything")).toBe("notAKind");
  });
});
