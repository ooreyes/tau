// @vitest-environment jsdom
/**
 * Settings: every page renders, a saved key reaches the keychain and the same
 * store the assistant reads, a saved key is never readable from the DOM, the
 * payment statement is present, and the browser build does not claim keychain
 * storage it does not have.
 *
 * Each test below was checked by reverting the behaviour it guards and
 * confirming this file goes red; the mapping is recorded in the report.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

import { SettingsWindow } from "./SettingsWindow";
import { openProviderPage } from "./settingsSurface";
import { PROVIDERS } from "./providerCatalog";
import { saveAssistantApiKey } from "../lib/assistant";
import { hasGeminiApiKey, saveGeminiApiKey, saveOpenAiApiKey } from "../lib/providerApiKey";

// Radix Select needs pointer-capture APIs jsdom does not implement.
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
  // Key presence lives in module state in the provider stores, not in
  // localStorage, so clearing storage alone would leak a key saved by an
  // earlier test into the next one.
  saveAssistantApiKey("");
  saveGeminiApiKey("");
  saveOpenAiApiKey("");
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
});

function go(page: string) {
  fireEvent.click(screen.getByRole("button", { name: page }));
}

describe("Settings runs in the schematic window", () => {
  it("saves a key into the same store the assistant reads, with no timer in between", async () => {
    tauri.isTauri.mockReturnValue(true);
    render(<SettingsWindow />);
    go("Model configuration");

    fireEvent.change(await screen.findByLabelText("Google Gemini API key"), {
      target: { value: "AIza-one-window" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    // No timer is advanced here on purpose. The write used to be debounced by
    // 350 ms even though the only caller is this button, so quitting Tau inside
    // that window discarded the key with the UI already saying it was saved.
    expect(tauri.invoke).toHaveBeenCalledWith("save_provider_api_key", {
      provider: "gemini",
      apiKey: "AIza-one-window",
    });

    // The module instance the assistant's send gate reads. While Settings was a
    // second WebviewWindow this was a *different copy* of the store, so a key
    // saved here left the assistant gated until the app was relaunched.
    expect(hasGeminiApiKey()).toBe(true);

    // And nothing asks the shell for a second window any more.
    expect(tauri.invoke).not.toHaveBeenCalledWith("open_settings_window");
  });

  it("routes external links through the allowlisted Rust command, never the webview", async () => {
    tauri.isTauri.mockReturnValue(true);
    await openProviderPage("https://console.anthropic.com/settings/keys");
    expect(tauri.invoke).toHaveBeenCalledWith("open_external_url", {
      url: "https://console.anthropic.com/settings/keys",
    });
  });
});

describe("every page renders", () => {
  const PAGES: readonly [string, string][] = [
    ["General", "General"],
    ["Profile", "Profile"],
    ["Model configuration", "Model configuration"],
    ["Usage", "Usage"],
    ["Simulation", "Simulation"],
    ["Model libraries", "Model libraries"],
    ["Keyboard shortcuts", "Keyboard shortcuts"],
  ];

  it.each(PAGES)("shows the %s page when its nav item is chosen", async (nav, heading) => {
    render(<SettingsWindow />);
    go(nav);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: heading })).toBeTruthy(),
    );
  });

  it("offers all seven pages in the nav", () => {
    render(<SettingsWindow />);
    const nav = screen.getByRole("navigation", { name: "Settings pages" });
    expect(within(nav).getAllByRole("button")).toHaveLength(7);
  });
});

describe("Usage page payment responsibility", () => {
  it("states that the user pays the provider and Tau does not bill them", () => {
    render(<SettingsWindow />);
    go("Usage");
    // The heading itself must carry the claim: a user who reads nothing else
    // still learns who is charging them.
    expect(
      screen.getByText("You pay your provider directly. Tau does not bill you."),
    ).toBeTruthy();
    expect(screen.getByText(/does not proxy your spending/i)).toBeTruthy();
    expect(screen.getByText(/Tau charges nothing and takes no percentage/i)).toBeTruthy();
  });

  it("keeps the statement above the numbers rather than under them", () => {
    render(<SettingsWindow />);
    go("Usage");
    const statement = screen.getByText("You pay your provider directly. Tau does not bill you.");
    const firstNumber = screen.getByText("Assistant requests");
    // Node.DOCUMENT_POSITION_FOLLOWING === 4
    expect(statement.compareDocumentPosition(firstNumber) & 4).toBeTruthy();
  });
});

describe("Model configuration key handling", () => {
  it("offers all three providers with a how-to and a link", async () => {
    render(<SettingsWindow />);
    go("Model configuration");
    for (const provider of PROVIDERS) {
      expect(provider.steps.length).toBeGreaterThan(3);
      expect(provider.keyPageUrl.startsWith("https://")).toBe(true);
    }
    expect(screen.getByRole("combobox", { name: "API key provider" })).toBeTruthy();
    // Default provider's steps are on screen, numbered, without assuming
    // the reader has made a key before.
    expect(screen.getByRole("list", { name: /Steps to create a .* key/ })).toBeTruthy();
  });

  it("discards a half-typed key when the provider changes", async () => {
    // A secret typed for one provider must never follow the dropdown to
    // another. React reconciles by element type and position, so without a
    // `key` on the field the SAME instance survives the provider change and
    // carries its draft with it -- and the next Save would send an Anthropic
    // key to OpenAI as a bearer token.
    render(<SettingsWindow />);
    go("Model configuration");

    const typed = "sk-ant-WRONG-PROVIDER-CANARY-4471";
    fireEvent.change(await screen.findByLabelText("Google Gemini API key"), {
      target: { value: typed },
    });

    const chooser = screen.getByRole("combobox", { name: "API key provider" });
    fireEvent.pointerDown(chooser, { button: 0, pointerId: 1, pointerType: "mouse" });
    const option = await screen.findByRole("option", { name: /OpenAI/i });
    fireEvent.pointerUp(option, { button: 0, pointerId: 1, pointerType: "mouse" });
    fireEvent.click(option);

    const openaiField = await screen.findByLabelText(/OpenAI API key/i) as HTMLInputElement;
    expect(openaiField.value).toBe("");
    // Belt and braces: the canary must not survive anywhere in the page.
    expect(document.body.textContent ?? "").not.toContain(typed);
    for (const input of Array.from(document.querySelectorAll("input"))) {
      expect((input as HTMLInputElement).value).not.toContain(typed);
    }
  });

  it("saves a key, reports it as saved, and never renders it back into the DOM", async () => {
    render(<SettingsWindow />);
    go("Model configuration");

    const secret = "AIzaSyTOTALLY-UNIQUE-TEST-SECRET-9137";
    const field = await screen.findByLabelText("Google Gemini API key");
    fireEvent.change(field, { target: { value: secret } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    // Reports presence.
    await waitFor(() => expect(screen.getByText("A key is saved")).toBeTruthy());
    expect(screen.queryByText("No key saved")).toBeNull();

    // And the value is gone from the document: not in text, not in an input
    // value, not in an attribute, and not in any serialized form.
    expect(document.body.innerHTML).not.toContain(secret);
    expect(document.body.textContent ?? "").not.toContain(secret);
    for (const input of Array.from(document.querySelectorAll("input"))) {
      expect(input.value).not.toContain(secret);
    }
    for (const element of Array.from(document.querySelectorAll("*"))) {
      for (const attribute of Array.from(element.attributes)) {
        expect(attribute.value).not.toContain(secret);
      }
    }
  });

  it("offers replace and remove once a key is saved, and forgets it on remove", async () => {
    render(<SettingsWindow />);
    go("Model configuration");
    fireEvent.change(await screen.findByLabelText("Google Gemini API key"), {
      target: { value: "AIza-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await waitFor(() => expect(screen.getByText("A key is saved")).toBeTruthy());

    expect(screen.getByRole("button", { name: "Replace" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByText("No key saved")).toBeTruthy());
  });
});

describe("browser fallback honesty", () => {
  it("does not claim keychain storage when there is no keychain", async () => {
    tauri.isTauri.mockReturnValue(false);
    render(<SettingsWindow />);
    go("Model configuration");
    const storageCopy = await screen.findByText(/browser preview with no keychain/i);
    expect(storageCopy.textContent).toMatch(/stays in memory for this tab only/i);
    expect(screen.queryByText(/macOS keychain/i)).toBeNull();
  });

  it("names the keychain only in the desktop app", async () => {
    tauri.isTauri.mockReturnValue(true);
    render(<SettingsWindow />);
    go("Model configuration");
    expect(await screen.findByText(/Saved in the macOS keychain/i)).toBeTruthy();
    expect(screen.queryByText(/browser preview with no keychain/i)).toBeNull();
  });

  it("reports local-only storage on Profile in a browser", () => {
    tauri.isTauri.mockReturnValue(false);
    render(<SettingsWindow />);
    go("Profile");
    expect(screen.getByText("Memory, this session only")).toBeTruthy();
    expect(screen.getByText(/Tau does not have user accounts/i)).toBeTruthy();
  });
});

describe("Profile page does not invent an account", () => {
  it("says what the page is for instead of showing fake identity rows", () => {
    render(<SettingsWindow />);
    go("Profile");
    expect(screen.getByText("There is nothing to sign in to")).toBeTruthy();
    // No text input anywhere: an editable name or avatar row would be a lie.
    expect(document.querySelectorAll(".tau-settings-page input").length).toBe(0);
    expect(screen.getByText("Never")).toBeTruthy();
  });
});
