// @vitest-environment jsdom
/**
 * Bench EE-trust: student-simple Settings chrome.
 *
 * REWRITTEN, deliberately. This file used to render `SettingsPanel` from
 * `./ShellPanels` - the 110-line Settings sheet docked in the side rail - and
 * assert that its advanced workspace rows stayed behind a closed disclosure at
 * 900x600.
 *
 * That sheet no longer exists. Settings is now `settings/SettingsWindow.tsx`, a
 * full surface over the schematic window, so "advanced rows hidden behind a
 * disclosure inside a viewport-capped sheet" is not a property the product has
 * any more: the pages are reached from a left nav and each one scrolls on its
 * own. Keeping the old assertions would have meant keeping a second Settings
 * surface alive purely to be tested.
 *
 * What the old file was actually protecting - a student is not shown solver
 * internals on the first screen, and the calm everyday switches are reachable
 * without hunting - is protected here against the new surface instead. The
 * sheet's one unique action, Clear probes, moved to the simulator beside the
 * probes it clears, where it appears only when there are probes and names how
 * many it will remove.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
const runtime = vi.hoisted(() => ({ getStatus: vi.fn(), stop: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
  isTauri: tauri.isTauri,
}));

vi.mock("../lib/localAiRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/localAiRuntime")>()),
  getLocalAiStatus: runtime.getStatus,
  stopLocalAi: runtime.stop,
}));

import { SettingsWindow } from "../settings/SettingsWindow";
import { saveAssistantPreferences } from "../lib/assistantPreferences";
import { saveCloudAiConsent } from "../lib/cloudAiConsent";

Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};
Element.prototype.scrollIntoView = () => {};

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

afterEach(() => cleanup());
beforeEach(() => {
  storage.clear();
  tauri.invoke.mockReset().mockResolvedValue(undefined);
  tauri.isTauri.mockReset().mockReturnValue(false);
  runtime.getStatus.mockReset().mockResolvedValue({
    state: "stopped",
    endpoint: "http://127.0.0.1:8080/v1",
    managed: false,
    installed: true,
    modelId: null,
    modelRepository: null,
    detail: "Choose a model.",
    presets: [],
  });
  saveCloudAiConsent({ consented: false });
  saveAssistantPreferences({ provider: "local-mlx", localModel: "qwen3-1.7b-4bit" });
});

describe("Settings window copy (student-calm)", () => {
  it("opens on General, with the everyday switches and no solver internals", () => {
    render(<SettingsWindow />);
    expect(screen.getByRole("heading", { level: 1, name: "General" })).toBeTruthy();
    expect(screen.getAllByText("Appearance").length).toBeGreaterThan(0);
    expect(screen.getByText("Recovery snapshot")).toBeTruthy();

    // The first screen a student sees must not lead with tolerances. They are a
    // deliberate click away, on Simulation.
    expect(screen.queryByLabelText("reltol override")).toBeNull();
    expect(screen.queryByText(/Solver tolerances/i)).toBeNull();
  });

  it("keeps solver internals on their own page, reachable in one click", async () => {
    render(<SettingsWindow />);
    fireEvent.click(screen.getByRole("button", { name: "Simulation" }));
    await waitFor(() => expect(screen.getByText("Solver tolerances")).toBeTruthy());
    expect(screen.getByLabelText("reltol override")).toBeTruthy();
  });

  it("still reaches the circuit assistant, now on its own page", async () => {
    render(<SettingsWindow />);
    fireEvent.click(screen.getByRole("button", { name: "Model configuration" }));
    await waitFor(() => expect(screen.getByText("Circuit assistant")).toBeTruthy());
  });

  it("scrolls each page rather than capping the whole surface to the viewport", () => {
    render(<SettingsWindow />);
    // The old sheet proved this with a max-h utility class. The window proves it
    // with a dedicated scroll region, so a dense page works at the declared
    // 720x480 minimum without the nav scrolling away.
    const scroll = document.querySelector(".tau-settings-scroll");
    expect(scroll).toBeTruthy();
    expect(document.querySelector(".tau-settings-nav")).toBeTruthy();
  });
});
