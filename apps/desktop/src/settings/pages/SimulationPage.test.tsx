// @vitest-environment jsdom
/**
 * Regression test for the tolerance override fields on the Simulation page.
 *
 * Each field used to be uncontrolled (`defaultValue={override ?? ""}`) on a
 * `SettingsRow` keyed by the static tolerance name, so it never remounted.
 * Clicking Restore correctly cleared the stored preference and the adjacent
 * state label, but React never re-applies `defaultValue` to a mounted input,
 * so whatever the user had typed stayed on screen looking like Restore did
 * nothing.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// This jsdom build has localStorage disabled, matching the guard the
// preference store itself relies on. Install an in-memory Storage so the
// persistence path is actually exercised, per apps/desktop/src/lib/theme.test.ts.
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

import { SimulationPage } from "./SimulationPage";
import { DEFAULT_OPTIONS } from "../../engine/spiceOptions";
import { simulationPreferences, solverOptionOverrides } from "../../lib/simulationPreferences";

afterEach(() => cleanup());
beforeEach(() => {
  // The store caches in module scope, so clearing storage alone leaks a
  // preference set by an earlier test into the next one.
  backing.clear();
  simulationPreferences.reset();
});

function renderPage() {
  render(<SimulationPage onNotice={() => {}} />);
}

describe("Simulation page tolerance fields", () => {
  it("Restore clears the text in the field, not just the label beside it", () => {
    renderPage();
    const input = screen.getByLabelText("reltol override") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "1e-9" } });
    fireEvent.blur(input);
    expect(input.value).toBe("1e-9");

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    // The text has to actually leave the box, not just the state label next
    // to it. Reverting `value={draft}` back to `defaultValue={override ?? ""}`
    // must turn this assertion red.
    expect(input.value).toBe("");
    expect(screen.getByText(`default ${DEFAULT_OPTIONS.reltol}`)).toBeTruthy();
  });

  it("an unparsable entry snaps back to what is actually stored", () => {
    renderPage();
    const input = screen.getByLabelText("reltol override") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);

    expect(input.value).toBe("");
    expect(solverOptionOverrides()).toEqual({});
  });

  it("a valid entry is trimmed and reaches the .options line", () => {
    renderPage();
    const input = screen.getByLabelText("reltol override") as HTMLInputElement;

    fireEvent.change(input, { target: { value: " 1e-6 " } });
    fireEvent.blur(input);

    expect(input.value).toBe("1e-6");
    expect(solverOptionOverrides()).toEqual({ reltol: "1e-6" });
  });
});
