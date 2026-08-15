// @vitest-environment jsdom
//
// Named after the control rather than after its module, following
// ThemeControl.test.tsx: this directory's SettingsPanel.test.tsx exercises the
// unrelated `SettingsAiSection`, and reusing that filename would clobber those
// tests instead of adding to them.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// jsdom here has localStorage disabled; install an in-memory Storage so the
// persistence path is really exercised (same shim as ThemeControl.test.tsx).
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

import { DiagnosticsSeverityControl } from "./SettingsPanel";
import {
  loadDiagnosticsSeverityPolicy,
  resetDiagnosticsPreferences,
  saveDiagnosticsSeverityPolicy,
} from "../lib/diagnosticsHealth";
import { resetAllPreferences } from "../lib/preferenceRegistry";

beforeEach(() => {
  backing.clear();
  resetDiagnosticsPreferences();
});
afterEach(() => cleanup());

describe("DiagnosticsSeverityControl", () => {
  it("defaults to showing warnings", () => {
    render(<DiagnosticsSeverityControl />);
    expect(screen.getByRole("radio", { name: "Warnings" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Errors only" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Red will not run, yellow runs with advice, green is clear.")).toBeTruthy();
  });

  it("persists Errors only and reads it back on a fresh mount", () => {
    const first = render(<DiagnosticsSeverityControl />);
    fireEvent.click(screen.getByRole("radio", { name: "Errors only" }));

    expect(loadDiagnosticsSeverityPolicy()).toBe("errors-only");
    expect(localStorage.getItem("tau.diagnostics.preferences.v1")).toContain("errors-only");
    expect(screen.getByText("Red or green only. Warnings are hidden.")).toBeTruthy();

    first.unmount();
    render(<DiagnosticsSeverityControl />);
    expect(screen.getByRole("radio", { name: "Errors only" }).getAttribute("aria-checked")).toBe("true");
  });

  it("follows a change made outside the control", () => {
    render(<DiagnosticsSeverityControl />);
    // This is the failure ThemeControl needed a change listener to avoid: a
    // control that seeded its state once would keep showing Warnings while the
    // app was hiding them, and clicking Warnings would be a no-op.
    // `act` because the store notifies through a window event rather than
    // through a React setter, so the re-render it causes is outside React's own
    // batching.
    act(() => saveDiagnosticsSeverityPolicy("errors-only"));
    expect(screen.getByRole("radio", { name: "Errors only" }).getAttribute("aria-checked")).toBe("true");
  });

  it("is returned to showing warnings by Reset to defaults", () => {
    render(<DiagnosticsSeverityControl />);
    fireEvent.click(screen.getByRole("radio", { name: "Errors only" }));
    expect(screen.getByRole("radio", { name: "Errors only" }).getAttribute("aria-checked")).toBe("true");

    // Through the registry, not through the module directly: registering the
    // module is the part that is easy to forget, and the point of the registry.
    act(() => resetAllPreferences());

    expect(loadDiagnosticsSeverityPolicy()).toBe("all");
    expect(screen.getByRole("radio", { name: "Warnings" }).getAttribute("aria-checked")).toBe("true");
  });
});
