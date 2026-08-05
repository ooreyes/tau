// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  isNative: vi.fn(),
  getStatus: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  install: vi.fn(),
}));

vi.mock("../lib/localAiRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/localAiRuntime")>()),
  isNativeDesktopApp: runtime.isNative,
  getLocalAiStatus: runtime.getStatus,
  startLocalAi: runtime.start,
  stopLocalAi: runtime.stop,
  installLocalAiRuntime: runtime.install,
}));

import { SettingsPanel } from "./ShellPanels";
import { saveAssistantPreferences } from "../lib/assistantPreferences";
import { hasCloudAiConsent, saveCloudAiConsent } from "../lib/cloudAiConsent";
import type { LocalAiStatus } from "../lib/localAiRuntime";

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
    detail: state === "ready"
      ? "Local inference is ready on 127.0.0.1:8080."
      : "MLX LM on port 8080. Choose a model.",
    presets: [
      { id: "qwen3-1.7b-4bit", repository: "Qwen/Qwen3-1.7B-MLX-4bit", label: "Qwen3 1.7B · 4-bit", downloadMb: 914, downloaded: downloaded17 },
      { id: "qwen3-4b-4bit", repository: "Qwen/Qwen3-4B-MLX-4bit", label: "Qwen3 4B · 4-bit", downloadMb: 2300, downloaded: downloaded4 },
    ],
  };
}

const props = {
  title: "untitled.asc",
  onClose: vi.fn(),
  onNewCircuit: vi.fn(),
  onOpenCommandPalette: vi.fn(),
  onNotice: vi.fn(),
};

afterEach(() => cleanup());
beforeEach(() => {
  storage.clear();
  runtime.isNative.mockReset();
  runtime.getStatus.mockReset();
  runtime.start.mockReset();
  runtime.stop.mockReset();
  runtime.install.mockReset();
  runtime.isNative.mockResolvedValue(true);
  saveCloudAiConsent({ consented: false });
  saveAssistantPreferences({ provider: "local-mlx", localModel: "qwen3-1.7b-4bit" });
});

describe("SettingsPanel local assistant lifecycle", () => {
  it("offers Turn on when the runtime is missing and installs then starts", async () => {
    runtime.getStatus.mockResolvedValue(status({ installed: false }));
    runtime.install.mockResolvedValue(status({ installed: true, state: "stopped" }));
    runtime.start.mockResolvedValue(status({ state: "starting", managed: true, installed: true }));
    render(<SettingsPanel {...props} />);

    expect(screen.queryByText(/8080|127\.0\.0\.1|localhost/i)).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(runtime.install).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(runtime.start).toHaveBeenCalled());
  });

  it("defaults to on-device and downloads via one Turn on control", async () => {
    runtime.getStatus.mockResolvedValue(status());
    runtime.start.mockResolvedValue(status({ state: "starting", managed: true }));
    render(<SettingsPanel {...props} />);

    expect(screen.getByRole("radio", { name: "On-device" }).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByRole("combobox", { name: "On-device model" }) as HTMLSelectElement).value).toBe("qwen3-1.7b-4bit");
    expect(await screen.findByText("Download: 914 MB")).toBeTruthy();
    expect(screen.queryByText(/8080|127\.0\.0\.1|localhost/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Download & turn on" }));
    await waitFor(() => expect(runtime.start).toHaveBeenCalledWith("qwen3-1.7b-4bit", true, undefined));
  });

  it("starts a cached model with Turn on", async () => {
    saveAssistantPreferences({ provider: "local-mlx", localModel: "qwen3-4b-4bit" });
    runtime.getStatus.mockResolvedValue(status({ downloaded4: true }));
    runtime.start.mockResolvedValue(status({ state: "starting", managed: true, downloaded4: true }));
    render(<SettingsPanel {...props} />);

    fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(runtime.start).toHaveBeenCalledWith("qwen3-4b-4bit", true, undefined));
  });

  it("exposes Turn off when ready", async () => {
    runtime.getStatus.mockResolvedValue(status({ state: "ready", managed: true, downloaded17: true }));
    runtime.stop.mockResolvedValue(status({ downloaded17: true }));
    render(<SettingsPanel {...props} />);

    expect(await screen.findByText("On-device AI · Ready")).toBeTruthy();
    expect(screen.queryByText(/8080|127\.0\.0\.1|localhost/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(runtime.stop).toHaveBeenCalledTimes(1));
  });

  it("imports a custom model from Advanced", async () => {
    runtime.getStatus.mockResolvedValue(status());
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SettingsPanel {...props} />);
    await screen.findByText("Download: 914 MB");

    const advanced = screen.getByText("Advanced").closest("details");
    if (advanced && !advanced.open) fireEvent.click(screen.getByText("Advanced"));

    fireEvent.change(screen.getByRole("textbox", { name: "Hugging Face model repository" }), {
      target: { value: "mlx-community/Custom-Circuit-4bit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect((screen.getByRole("combobox", { name: "On-device model" }) as HTMLSelectElement).value)
      .toBe("custom:mlx-community/Custom-Circuit-4bit"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(confirm).toHaveBeenCalledOnce();
    confirm.mockRestore();
  });

  it("requires cloud consent before circuit context can leave the Mac", async () => {
    runtime.getStatus.mockResolvedValue(status());
    render(<SettingsPanel {...props} />);
    await screen.findByText("Download: 914 MB");

    fireEvent.click(screen.getByRole("radio", { name: "Cloud" }));
    expect(await screen.findByLabelText(/API key/)).toBeTruthy();
    expect(screen.getByText(/Consent is required/i)).toBeTruthy();
    expect(hasCloudAiConsent()).toBe(false);

    fireEvent.click(screen.getByRole("checkbox"));
    expect(hasCloudAiConsent()).toBe(true);
    expect(screen.queryByText(/Consent is required/i)).toBeNull();
  });

  it("keeps student-simple Settings rows", async () => {
    runtime.getStatus.mockResolvedValue(status());
    render(<SettingsPanel {...props} />);
    expect(screen.getAllByText("Appearance").length).toBeGreaterThan(0);
    expect(screen.getByText("Circuit assistant")).toBeTruthy();
    expect(screen.getByText("Find parts")).toBeTruthy();
    expect(screen.getByText("Autosave")).toBeTruthy();
  });
});
