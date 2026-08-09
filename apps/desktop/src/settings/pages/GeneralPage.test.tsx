// @vitest-environment jsdom
/**
 * Regression coverage for "Reset to defaults" on the General page.
 *
 * It used to call exactly two of the app's preference stores
 * (`simulationPreferences.reset()`, `aiUsage.reset()`) while its copy claimed
 * to reset "every preference on every page" - silently leaving theme,
 * assistant provider/model, cloud AI consent, local AI setup, and the
 * learning path untouched. It now delegates to
 * `lib/preferenceRegistry.ts#resetAllPreferences`, and the copy names both
 * what is reset and what is deliberately preserved.
 *
 * Each test below was checked by reverting the behaviour it guards and
 * confirming this file goes red; see the reversion evidence in the unit
 * report.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// This jsdom build has localStorage disabled, matching the guard every
// preference module relies on. Install an in-memory Storage so the
// persistence path is actually exercised, per apps/desktop/src/lib/theme.test.ts:10-23.
// `removeItem` is implemented deliberately: a stub missing it lets a reset's
// own try/catch swallow the resulting TypeError and pass for the wrong reason.
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

import { GeneralPage } from "./GeneralPage";
import { loadCloudAiConsent, saveCloudAiConsent } from "../../lib/cloudAiConsent";
import { resetAllPreferences } from "../../lib/preferenceRegistry";
import { loadThemeMode, setThemeMode } from "../../lib/theme";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
});

beforeEach(() => {
  backing.clear();
  // The underlying stores cache in module scope; resetting is the cleanest
  // way to give every test a known-clean baseline (see lib/preferences.ts).
  resetAllPreferences();
  document.documentElement.removeAttribute("data-theme");
});

function renderPage() {
  render(<GeneralPage onNotice={() => {}} />);
}

describe("GeneralPage Reset to defaults", () => {
  it("Reset clears every preference the copy names", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    setThemeMode("dark");
    saveCloudAiConsent({ consented: true });
    expect(loadThemeMode()).toBe("dark");
    expect(loadCloudAiConsent().consented).toBe(true);

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));

    // Reverting `resetEverything` to only call
    // `simulationPreferences.reset()` / `aiUsage.reset()` must turn both of
    // these red: neither store is one of those two.
    expect(loadThemeMode()).toBe("light");
    expect(loadCloudAiConsent().consented).toBe(false);
  });

  it("the Reset copy names what it does not touch", () => {
    renderPage();

    const hint = screen.getByText(/Not affected:/i);
    const text = hint.textContent ?? "";

    // Trimming the copy back to "every preference on every page" (the old
    // group note, with no named exclusions) must turn every assertion below
    // red.
    expect(text).toMatch(/API keys/i);
    expect(text).toMatch(/schematics/i);
    expect(text).toMatch(/recovery snapshot/i);
    expect(text).toMatch(/run history/i);
    expect(text).toMatch(/assistant conversations/i);
    expect(text).toMatch(/panel sizes/i);
  });
});
