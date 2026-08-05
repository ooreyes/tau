// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  getStatus: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  install: vi.fn(),
}));
const ensure = vi.hoisted(() => ({ ensureLocalAi: vi.fn() }));

vi.mock("../lib/localAiRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/localAiRuntime")>()),
  getLocalAiStatus: runtime.getStatus,
  startLocalAi: runtime.start,
  stopLocalAi: runtime.stop,
  installLocalAiRuntime: runtime.install,
}));

vi.mock("../lib/localAiEnsure", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/localAiEnsure")>()),
  ensureLocalAi: ensure.ensureLocalAi,
}));

import { SettingsAiSection } from "./SettingsAiSection";
import { saveAssistantPreferences } from "../lib/assistantPreferences";
import { saveCloudAiConsent } from "../lib/cloudAiConsent";
import type { LocalAiStatus } from "../lib/localAiRuntime";

// jsdom lacks PointerEvent capture APIs that Radix Select uses on open.
Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};
Element.prototype.scrollIntoView = () => {};

async function chooseSelectOption(ariaLabel: string, optionName: string | RegExp) {
  const trigger = screen.getByRole("combobox", { name: ariaLabel });
  fireEvent.pointerDown(trigger, { button: 0, pointerId: 1, pointerType: "mouse" });
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.pointerUp(option, { button: 0, pointerId: 1, pointerType: "mouse" });
  fireEvent.click(option);
}

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, String(value)),
    removeItem: (key: string) => void storage.delete(key),
    clear: () => storage.clear(),
  },
});

function status({
  state = "stopped",
  managed = false,
  installed = true,
  downloaded17 = false,
  downloaded4 = false,
}: {
  state?: LocalAiStatus["state"];
  managed?: boolean;
  installed?: boolean;
  downloaded17?: boolean;
  downloaded4?: boolean;
} = {}): LocalAiStatus {
  return {
    state,
    endpoint: "http://127.0.0.1:8080/v1",
    managed,
    installed,
    modelId: state === "ready" || state === "starting" ? "qwen3-1.7b-4bit" : null,
    modelRepository: state === "ready" || state === "starting" ? "Qwen/Qwen3-1.7B-MLX-4bit" : null,
    detail: state === "ready" ? "Local inference is ready." : "Choose a model to start local inference.",
    presets: [
      { id: "qwen3-1.7b-4bit", repository: "Qwen/Qwen3-1.7B-MLX-4bit", label: "Qwen3 1.7B · 4-bit", downloadMb: 914, downloaded: downloaded17 },
      { id: "qwen3-4b-4bit", repository: "Qwen/Qwen3-4B-MLX-4bit", label: "Qwen3 4B · 4-bit", downloadMb: 2300, downloaded: downloaded4 },
    ],
  };
}

afterEach(() => cleanup());
beforeEach(() => {
  storage.clear();
  runtime.getStatus.mockReset();
  runtime.start.mockReset();
  runtime.stop.mockReset();
  runtime.install.mockReset();
  ensure.ensureLocalAi.mockReset();
  ensure.ensureLocalAi.mockResolvedValue({
    status: status({ state: "ready", managed: true }),
    decision: { type: "ready" },
  });
  saveAssistantPreferences({ provider: "local-mlx", localModel: "qwen3-1.7b-4bit" });
  saveCloudAiConsent({ consented: false });
});

describe("SettingsAiSection local assistant lifecycle", () => {
  it("offers Turn on when the runtime is missing", async () => {
    runtime.getStatus.mockResolvedValue(status({ installed: false }));
    render(<SettingsAiSection onNotice={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(ensure.ensureLocalAi).toHaveBeenCalled());
  });

  it("defaults to on-device with a labeled download and no localhost copy", async () => {
    runtime.getStatus.mockResolvedValue(status());
    render(<SettingsAiSection onNotice={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "On-device" }).getAttribute("aria-checked")).toBe("true");
    const model = screen.getByRole("combobox", { name: "On-device model" });
    expect(model.tagName).toBe("BUTTON");
    expect(model.getAttribute("data-slot")).toBe("select-trigger");
    expect(model.textContent).toMatch(/Qwen3 1\.7B/);
    expect(document.querySelector(".settings-field select")).toBeNull();
    expect(await screen.findByText("Download: 914 MB")).toBeTruthy();
    expect(screen.queryByText(/8080|127\.0\.0\.1|localhost/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Download & turn on" }));
    await waitFor(() => expect(ensure.ensureLocalAi).toHaveBeenCalled());
  });

  it("starts a cached model with Turn on", async () => {
    saveAssistantPreferences({ provider: "local-mlx", localModel: "qwen3-4b-4bit" });
    runtime.getStatus.mockResolvedValue(status({ downloaded4: true }));
    render(<SettingsAiSection onNotice={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(ensure.ensureLocalAi).toHaveBeenCalled());
  });

  it("exposes Turn off when ready", async () => {
    runtime.getStatus.mockResolvedValue(status({ state: "ready", managed: true, downloaded17: true }));
    runtime.stop.mockResolvedValue(status({ downloaded17: true }));
    render(<SettingsAiSection onNotice={vi.fn()} />);
    expect(await screen.findByText("On-device AI · Ready")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(runtime.stop).toHaveBeenCalledTimes(1));
  });

  it("imports a custom model from Advanced", async () => {
    runtime.getStatus.mockResolvedValue(status());
    const notice = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SettingsAiSection onNotice={notice} />);
    await screen.findByText("Download: 914 MB");
    fireEvent.click(screen.getByText("Advanced"));
    fireEvent.change(screen.getByRole("textbox", { name: "Hugging Face model repository" }), {
      target: { value: "mlx-community/Custom-Circuit-4bit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "On-device model" }).textContent)
      .toMatch(/Custom-Circuit-4bit|mlx-community/));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(confirm).toHaveBeenCalledOnce();
    confirm.mockRestore();
  });

  it("requires cloud consent before showing send-ready key path", async () => {
    runtime.getStatus.mockResolvedValue(status());
    render(<SettingsAiSection onNotice={vi.fn()} />);
    await screen.findByText("Download: 914 MB");
    fireEvent.click(screen.getByRole("radio", { name: "Cloud" }));
    expect(await screen.findByLabelText(/API key/)).toBeTruthy();
    expect(screen.getByText(/Consent is required/i)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "On-device model" })).toBeNull();
    const cloudProvider = screen.getByRole("combobox", { name: "Cloud provider" });
    expect(cloudProvider.tagName).toBe("BUTTON");
    expect(cloudProvider.getAttribute("data-slot")).toBe("select-trigger");
    expect(screen.getByRole("combobox", { name: "Gemini model" }).tagName).toBe("BUTTON");
    expect(document.querySelector(".settings-field select")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.queryByText(/Consent is required/i)).toBeNull();
  });

  it("picks Anthropic through cloud-provider ui/Select", async () => {
    runtime.getStatus.mockResolvedValue(status());
    render(<SettingsAiSection onNotice={vi.fn()} />);
    await screen.findByText("Download: 914 MB");
    fireEvent.click(screen.getByRole("radio", { name: "Cloud" }));
    await chooseSelectOption("Cloud provider", /Anthropic/);
    expect(await screen.findByLabelText(/Anthropic API key/)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Gemini model" })).toBeNull();
  });
});
