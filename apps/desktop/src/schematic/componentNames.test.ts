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
