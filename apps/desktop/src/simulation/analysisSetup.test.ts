import { describe, expect, it } from "vitest";
import { COMPONENT_KINDS } from "../schematic/types";
import { canCurrentProbe } from "./analysisSetup";

describe("canCurrentProbe", () => {
  it("accepts every three- and four-terminal semiconductor", () => {
    // Regression: these were spelled "nmosp"/"pmosp"/"njfet"/"pjfet", which are
    // not ComponentKind values, so the clamp meter silently refused every FET.
    for (const kind of ["nmos", "pmos", "njf", "pjf", "npn", "pnp"] as const) {
      expect(canCurrentProbe(kind), `${kind} should be current-probeable`).toBe(true);
    }
  });

  it("accepts passives and sources", () => {
    for (const kind of ["resistor", "capacitor", "inductor", "vsource", "isource"] as const) {
      expect(canCurrentProbe(kind), `${kind} should be current-probeable`).toBe(true);
    }
  });

  it("only names kinds that actually exist", () => {
    // The original bug was a string that matched no kind. Anything the probe
    // list claims to support must be a real ComponentKind, or it is dead code
    // that reads as support while silently doing nothing.
    const probeable = COMPONENT_KINDS.filter((kind) => canCurrentProbe(kind));
    expect(probeable.length).toBeGreaterThanOrEqual(11);
  });

  it("rejects ground", () => {
    expect(canCurrentProbe("ground")).toBe(false);
  });
});
