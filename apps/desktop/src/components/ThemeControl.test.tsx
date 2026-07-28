// @vitest-environment jsdom
//
// Named ThemeControl.test.tsx rather than SettingsPanel.test.tsx on purpose:
// this directory already has a SettingsPanel.test.tsx exercising the
// unrelated SettingsPanel exported from ./ShellPanels (same export name,
// different module, owned by another concurrent change) - reusing that
// filename would clobber those tests instead of adding to them.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ThemeControl } from "./SettingsPanel";

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
  cleanup();
  document.documentElement.removeAttribute("data-theme");
});

describe("ThemeControl", () => {
  it("defaults to System selected and applies no data-theme override", () => {
    render(<ThemeControl />);
    const system = screen.getByRole("radio", { name: "System" });
    expect(system.getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("selecting Light stamps data-theme and persists the choice", () => {
    render(<ThemeControl />);
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("tau.ui.theme")).toBe("light");
    expect(screen.getByRole("radio", { name: "Light" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe("false");
  });

  it("selecting Dark then System clears the override again", () => {
    render(<ThemeControl />);
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    fireEvent.click(screen.getByRole("radio", { name: "System" }));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem("tau.ui.theme")).toBe("system");
  });

  it("reads a previously persisted preference on mount", () => {
    localStorage.setItem("tau.ui.theme", "dark");
    render(<ThemeControl />);
    expect(screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
