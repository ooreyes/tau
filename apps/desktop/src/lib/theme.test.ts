// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyThemeMode, initThemeMode, loadThemeMode, saveThemeMode, setThemeMode } from "./theme";

// This jsdom build has localStorage disabled (typeof localStorage ===
// "undefined" - the same guard the module itself relies on). Install an
// in-memory Storage so the persistence path is actually exercised, matching
// the pattern in components/panelResize.test.tsx.
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

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});
afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

describe("loadThemeMode", () => {
  it("defaults to system when nothing is stored", () => {
    expect(loadThemeMode()).toBe("system");
  });

  it("round-trips a saved mode", () => {
    saveThemeMode("dark");
    expect(loadThemeMode()).toBe("dark");
    saveThemeMode("light");
    expect(loadThemeMode()).toBe("light");
  });

  it("falls back to system for a corrupt or unknown stored value", () => {
    localStorage.setItem("tau.ui.theme", "solarized");
    expect(loadThemeMode()).toBe("system");
  });
});

describe("applyThemeMode", () => {
  it("stamps data-theme for an explicit choice", () => {
    applyThemeMode("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    applyThemeMode("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("removes data-theme for system so the media query drives it", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    applyThemeMode("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});

describe("setThemeMode", () => {
  it("persists and applies in one call", () => {
    setThemeMode("light");
    expect(loadThemeMode()).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});

describe("initThemeMode", () => {
  it("reads the persisted preference and applies it, returning the mode", () => {
    saveThemeMode("dark");
    expect(initThemeMode()).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("applies system (no attribute) when nothing was ever saved", () => {
    expect(initThemeMode()).toBe("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
