// @vitest-environment jsdom
//
// Named ThemeControl.test.tsx rather than SettingsPanel.test.tsx on purpose:
// this directory already has a SettingsPanel.test.tsx exercising the
// unrelated SettingsPanel exported from ./ShellPanels (same export name,
// different module, owned by another concurrent change) - reusing that
// filename would clobber those tests instead of adding to them.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ThemeControl } from "./SettingsPanel";
import { resetThemeMode } from "../lib/theme";

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
  it("defaults to Light selected and stamps data-theme=light", () => {
    render(<ThemeControl />);
    const light = screen.getByRole("radio", { name: "Light" });
    expect(light.getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(screen.getByText("Default")).toBeTruthy();
  });

  it("selecting Dark stamps data-theme and persists the choice", () => {
    render(<ThemeControl />);
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("tau.ui.theme")).toBe("dark");
    expect(screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Light" }).getAttribute("aria-checked")).toBe("false");
  });

  it("selecting Dark then System clears the override again", () => {
    render(<ThemeControl />);
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    fireEvent.click(screen.getByRole("radio", { name: "System" }));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem("tau.ui.theme")).toBe("system");
    expect(screen.getByText("Follows macOS")).toBeTruthy();
  });

  it("reads a previously persisted preference on mount", () => {
    localStorage.setItem("tau.ui.theme", "dark");
    render(<ThemeControl />);
    expect(screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  // Reset to defaults lives on the same Settings page as this control, so the
  // mode can change without this component being the one that changed it.
  it("follows a reset performed elsewhere on the page", () => {
    render(<ThemeControl />);
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));

    act(() => resetThemeMode());

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(screen.getByRole("radio", { name: "Light" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("false");
  });

  // The failure this really guards. Without the change event the control keeps
  // its own stale `mode`, so choosing the level it wrongly believes is already
  // selected sets the same value, the apply effect never re-runs, and the user
  // is stuck in Light with no way back except leaving the page.
  it("can still return to Dark after a reset", () => {
    render(<ThemeControl />);
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    act(() => resetThemeMode());

    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("tau.ui.theme")).toBe("dark");
  });
});
