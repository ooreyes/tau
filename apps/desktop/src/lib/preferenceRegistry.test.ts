// @vitest-environment jsdom
/**
 * Guards `resetAllPreferences` - the function GeneralPage's "Reset to
 * defaults" button now calls instead of hand-listing two stores.
 *
 * Each test below was checked by breaking the behaviour it guards and
 * confirming it goes red; see the reversion evidence in the unit report.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// This jsdom build has localStorage disabled - the same guard every module
// under test relies on. Install an in-memory Storage so the persistence path
// is actually exercised, per apps/desktop/src/lib/theme.test.ts:10-23.
//
// `removeItem` MUST be implemented: several `reset*` functions call it, and
// without it a real TypeError is thrown on every reset - which the modules'
// own try/catch (and `resetAllPreferences`'s per-item try/catch) would
// silently swallow, letting a broken stub pass for the wrong reason.
const backing = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => void backing.set(key, String(value)),
    removeItem: (key: string) => void backing.delete(key),
    clear: () => backing.clear(),
    key: (index: number) => [...backing.keys()][index] ?? null,
    get length() {
      return backing.size;
    },
  } as Storage,
});

import { loadAiUsage, recordAiRequest } from "./aiUsage";
import { loadAssistantPreferences, saveAssistantPreferences } from "./assistantPreferences";
import { loadCloudAiConsent, saveCloudAiConsent } from "./cloudAiConsent";
import { GEMINI_DEFAULT_MODEL } from "./geminiAssistant";
import { defaultLearningPathState, loadLearningPathState, saveLearningPathState } from "./learningPath";
import { loadLocalAiSetupPreferences, saveLocalAiSetupPreferences } from "./localAiSetup";
import {
  RESETTABLE_PREFERENCES,
  resetAllPreferences,
  type ResettablePreference,
} from "./preferenceRegistry";
import { DEFAULT_SIMULATION_PREFERENCES, simulationPreferences } from "./simulationPreferences";
import { loadThemeMode, setThemeMode } from "./theme";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

beforeEach(() => {
  backing.clear();
  // The stores cache their value in module scope (see lib/preferences.ts),
  // so clearing storage alone would leak a value set by an earlier test into
  // the next one. Reset is exactly the thing under test, so use it to give
  // every test a known-clean starting point.
  resetAllPreferences();
  document.documentElement.removeAttribute("data-theme");
});

describe("resetAllPreferences", () => {
  it("reset clears everything the registry lists", () => {
    simulationPreferences.update({
      transientDetail: "precision",
      alwaysShowTechnicalDetails: true,
      tolerances: { reltol: "1e-9", abstol: null, vntol: null, gmin: null },
    });
    setThemeMode("dark");
    saveAssistantPreferences({ provider: "anthropic", localModel: "qwen3-4b-4bit", geminiModel: "custom:foo" });
    saveCloudAiConsent({ consented: true });
    saveLocalAiSetupPreferences({ dismissed: true });
    recordAiRequest("anthropic", { input: 10, output: 5 });
    saveLearningPathState({ ...defaultLearningPathState(), status: "completed", completedAt: Date.now() });

    resetAllPreferences();

    expect(simulationPreferences.load()).toEqual(DEFAULT_SIMULATION_PREFERENCES);
    expect(loadThemeMode()).toBe("light");
    expect(loadAssistantPreferences()).toEqual({
      provider: "local-mlx",
      localModel: "qwen3-4b-4bit",
      geminiModel: GEMINI_DEFAULT_MODEL,
    });
    expect(loadCloudAiConsent()).toEqual({ consented: false });
    expect(loadLocalAiSetupPreferences()).toEqual({ dismissed: false });
    expect(loadAiUsage().providers.anthropic.requests).toBe(0);
    expect(loadLearningPathState()).toEqual(defaultLearningPathState());
  });

  it("reset leaves preserved state alone", () => {
    const seeds: Record<string, string> = {
      "tau.unsaved.recovery.v1": JSON.stringify({ dirty: true, note: "half-drawn opamp" }),
      "tau.run.history.v1": JSON.stringify([{ id: "run-1", ok: true }]),
      "tau.local-ai.custom-models.v1": JSON.stringify([{ id: "custom-1", path: "/models/x.gguf" }]),
      "tau.assistant.history.v1:my-project.asc": JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      "tau.ui.explorerWidth": "321",
    };
    for (const [key, value] of Object.entries(seeds)) {
      localStorage.setItem(key, value);
    }

    resetAllPreferences();

    // Moving the recovery snapshot (or any of the other four) into
    // RESETTABLE_PREFERENCES must turn this assertion red.
    for (const [key, value] of Object.entries(seeds)) {
      expect(localStorage.getItem(key)).toBe(value);
    }
  });

  it("cloud consent resets to off, never on", () => {
    saveCloudAiConsent({ consented: true });
    expect(loadCloudAiConsent().consented).toBe(true);

    resetAllPreferences();

    expect(loadCloudAiConsent().consented).toBe(false);
  });

  it("reset returns the document to the shipped theme", () => {
    setThemeMode("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    resetAllPreferences();

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(loadThemeMode()).toBe("light");
  });

  it("one failing module does not abort the rest", () => {
    const target = RESETTABLE_PREFERENCES.find(
      (p): p is ResettablePreference => p.key === "tau.cloud-ai.consent.v1",
    );
    expect(target).toBeTruthy();
    const original = target!.reset;
    target!.reset = () => {
      throw new Error("storage is hostile");
    };

    try {
      setThemeMode("dark");
      saveCloudAiConsent({ consented: true });

      expect(() => resetAllPreferences()).not.toThrow();

      // The other registered preferences still reset...
      expect(loadThemeMode()).toBe("light");
      // ...even though the throwing module's own state was left as it was,
      // proving the failure was contained rather than silently "succeeding".
      expect(loadCloudAiConsent().consented).toBe(true);
    } finally {
      target!.reset = original;
    }
  });
});
