/**
 * Solver preferences, and the precedence rule that makes them safe:
 * Tau's defaults < the user's Settings < the open document's own `.options`.
 *
 * The last part is the one that matters. A global tolerance that overrode a
 * schematic's authored `.options` would silently re-simulate other people's
 * circuits, which is the failure this layer exists to avoid.
 */
import { beforeEach, describe, expect, it } from "vitest";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, String(value)),
    removeItem: (key: string) => void storage.delete(key),
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  },
});

import { DEFAULT_OPTIONS, optionsLineFromDirectives } from "../engine/spiceOptions";
import {
  DEFAULT_SIMULATION_PREFERENCES,
  effectiveTolerance,
  hasToleranceOverrides,
  isValidToleranceValue,
  simulationPreferences,
  solverOptionOverrides,
} from "./simulationPreferences";

beforeEach(() => {
  storage.clear();
  simulationPreferences.reset();
});

describe("tolerance validation", () => {
  it("accepts the numeric forms ngspice reads", () => {
    for (const value of ["1e-4", "1E-6", "0.001", "1e12", "12"]) {
      expect(isValidToleranceValue(value), value).toBe(true);
    }
  });

  it("refuses anything ngspice would choke the whole deck on", () => {
    // A bad `.options` value is not a bad option, it is a failed simulation.
    for (const value of ["", "  ", "abc", "1e", "-1e-4", "0", "1e-4;.end", "1,5", "NaN"]) {
      expect(isValidToleranceValue(value), value).toBe(false);
    }
  });

  it("drops an invalid stored value rather than passing it to the engine", () => {
    storage.set(
      simulationPreferences.key,
      JSON.stringify({ tolerances: { reltol: "abc; .end", abstol: "1e-13" } }),
    );
    simulationPreferences.reset();
    storage.set(
      simulationPreferences.key,
      JSON.stringify({ tolerances: { reltol: "abc; .end", abstol: "1e-13" } }),
    );
    // Re-read through a fresh load by clearing the module cache via reset+set.
    const overrides = solverOptionOverrides({
      ...DEFAULT_SIMULATION_PREFERENCES,
      tolerances: { reltol: "abc; .end", abstol: "1e-13", vntol: null, gmin: null },
    });
    expect(overrides.reltol).toBeUndefined();
    expect(overrides.abstol).toBe("1e-13");
  });
});

describe("override reporting", () => {
  it("reports Tau's default until the user sets one", () => {
    expect(hasToleranceOverrides(DEFAULT_SIMULATION_PREFERENCES)).toBe(false);
    expect(effectiveTolerance("reltol", DEFAULT_SIMULATION_PREFERENCES)).toBe(
      DEFAULT_OPTIONS.reltol,
    );
  });

  it("reports the override once set", () => {
    const preferences = {
      ...DEFAULT_SIMULATION_PREFERENCES,
      tolerances: { ...DEFAULT_SIMULATION_PREFERENCES.tolerances, reltol: "1e-6" },
    };
    expect(hasToleranceOverrides(preferences)).toBe(true);
    expect(effectiveTolerance("reltol", preferences)).toBe("1e-6");
  });

  it("emits nothing for keys the user has not touched", () => {
    expect(solverOptionOverrides(DEFAULT_SIMULATION_PREFERENCES)).toEqual({});
  });
});

describe("precedence in the generated .options line", () => {
  it("puts the user's tolerance over Tau's default", () => {
    const line = optionsLineFromDirectives([], { reltol: "1e-6" });
    expect(line).toContain("reltol=1e-6");
    expect(line).not.toContain(`reltol=${DEFAULT_OPTIONS.reltol}`);
  });

  it("still lets the document win over the user", () => {
    // The rule that keeps someone else's circuit simulating their way.
    const line = optionsLineFromDirectives([".options reltol=1e-9"], { reltol: "1e-6" });
    expect(line).toContain("reltol=1e-9");
    expect(line).not.toContain("reltol=1e-6");
  });

  it("leaves untouched keys at Tau's defaults", () => {
    const line = optionsLineFromDirectives([], { reltol: "1e-6" });
    expect(line).toContain(`abstol=${DEFAULT_OPTIONS.abstol}`);
    expect(line).toContain(`gmin=${DEFAULT_OPTIONS.gmin}`);
  });

  it("is a no-op when the user has set nothing", () => {
    expect(optionsLineFromDirectives([], {})).toBe(optionsLineFromDirectives([]));
  });
});

describe("persistence", () => {
  it("round-trips a saved override", () => {
    simulationPreferences.update({
      tolerances: { reltol: "1e-5", abstol: null, vntol: null, gmin: null },
    });
    expect(simulationPreferences.load().tolerances.reltol).toBe("1e-5");
    expect(solverOptionOverrides()).toEqual({ reltol: "1e-5" });
  });

  it("falls back to defaults on a corrupt blob instead of throwing", () => {
    storage.set(simulationPreferences.key, "{not json");
    simulationPreferences.reset();
    expect(simulationPreferences.load()).toEqual(DEFAULT_SIMULATION_PREFERENCES);
  });
});
