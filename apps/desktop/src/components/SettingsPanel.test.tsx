// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  getStatus: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  install: vi.fn(),
}));

vi.mock("../lib/localAiRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/localAiRuntime")>()),
  getLocalAiStatus: runtime.getStatus,
  startLocalAi: runtime.start,
  stopLocalAi: runtime.stop,
  installLocalAiRuntime: runtime.install,
}));

import { SettingsPanel } from "./ShellPanels";
import { saveAssistantPreferences } from "../lib/assistantPreferences";
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
    detail: state === "ready" ? "Local inference is ready." : "Choose a model to start local inference.",
    presets: [
      {
        id: "qwen3-1.7b-4bit",
        repository: "Qwen/Qwen3-1.7B-MLX-4bit",
        label: "Qwen3 1.7B · 4-bit",
        downloadMb: 914,
        downloaded: downloaded17,
      },
      {
        id: "qwen3-4b-4bit",
        repository: "Qwen/Qwen3-4B-MLX-4bit",
        label: "Qwen3 4B · 4-bit",
        downloadMb: 2_300,
        downloaded: downloaded4,
      },
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
  runtime.getStatus.mockReset();
  runtime.start.mockReset();
  runtime.stop.mockReset();
  runtime.install.mockReset();
  saveAssistantPreferences({ provider: "local-mlx", localModel: "qwen3-1.7b-4bit" });
});

describe("SettingsPanel local assistant lifecycle", () => {
  it("offers Set up local AI when the runtime is missing", async () => {
    runtime.getStatus.mockResolvedValue(status({ installed: false }));
    runtime.install.mockResolvedValue(status({ installed: true }));
    render(<SettingsPanel {...props} />);

    fireEvent.click(await screen.findByRole("button", { name: "Set up local AI" }));
    await waitFor(() => expect(runtime.install).toHaveBeenCalledTimes(1));
    expect(runtime.start).not.toHaveBeenCalled();
  });

  it("defaults to Local MLX and requires an explicit size-labeled download start", async () => {
    const stopped = status();
    runtime.getStatus.mockResolvedValue(stopped);
    runtime.start.mockResolvedValue(status({ state: "starting", managed: true }));
    render(<SettingsPanel {...props} />);

    expect((screen.getByRole("combobox", { name: "Provider" }) as HTMLSelectElement).value).toBe("local-mlx");
    expect((screen.getByRole("combobox", { name: "Local model" }) as HTMLSelectElement).value).toBe("qwen3-1.7b-4bit");
    expect(screen.queryByLabelText("Anthropic API key")).toBeNull();
    expect(await screen.findByText("Download size: 914 MB")).toBeTruthy();
    expect(runtime.start).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Download & Start" }));
    await waitFor(() => expect(runtime.start).toHaveBeenCalledWith("qwen3-1.7b-4bit", true));
  });

  it("starts an already cached selected model without download permission", async () => {
    saveAssistantPreferences({ provider: "local-mlx", localModel: "qwen3-4b-4bit" });
    runtime.getStatus.mockResolvedValue(status({ downloaded4: true }));
    runtime.start.mockResolvedValue(status({ state: "starting", managed: true, downloaded4: true }));
    render(<SettingsPanel {...props} />);

    const start = await screen.findByRole("button", { name: "Start" });
    expect(screen.queryByText(/Download size:/)).toBeNull();
    fireEvent.click(start);
    await waitFor(() => expect(runtime.start).toHaveBeenCalledWith("qwen3-4b-4bit", false));
  });

  it("queries managed ready state and exposes an explicit Stop action", async () => {
    runtime.getStatus.mockResolvedValue(status({ state: "ready", managed: true, downloaded17: true }));
    runtime.stop.mockResolvedValue(status({ downloaded17: true }));
    render(<SettingsPanel {...props} />);

    expect(await screen.findByText("Local inference · Ready")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(runtime.stop).toHaveBeenCalledTimes(1));
  });

  it("imports, selects, starts, and removes a custom Hugging Face MLX model", async () => {
    runtime.getStatus.mockResolvedValue(status());
    runtime.start.mockResolvedValue(status({ state: "starting", managed: true }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SettingsPanel {...props} />);
    await screen.findByText("Download size: 914 MB");

    fireEvent.change(screen.getByRole("textbox", { name: "Hugging Face model repository" }), {
      target: { value: "mlx-community/Custom-Circuit-4bit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect((screen.getByRole("combobox", { name: "Local model" }) as HTMLSelectElement).value)
      .toBe("custom:mlx-community/Custom-Circuit-4bit"));
    fireEvent.click(screen.getByRole("button", { name: "Download & Start" }));
    await waitFor(() => expect(runtime.start).toHaveBeenCalledWith(
      "custom:mlx-community/Custom-Circuit-4bit",
      true,
      "mlx-community/Custom-Circuit-4bit",
    ));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(confirm).toHaveBeenCalledOnce();
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Local model" }) as HTMLSelectElement).value)
      .toBe("qwen3-4b-4bit"));
    confirm.mockRestore();
  });

  it("shows the cloud key only after Anthropic is selected", async () => {
    runtime.getStatus.mockResolvedValue(status());
    render(<SettingsPanel {...props} />);
    await screen.findByText("Download size: 914 MB");

    fireEvent.change(screen.getByRole("combobox", { name: "Provider" }), {
      target: { value: "anthropic" },
    });
    expect(await screen.findByLabelText("Anthropic API key")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Local model" })).toBeNull();
    expect(screen.queryByText(/Download size:/)).toBeNull();
  });

  it("keeps workspace recovery controls behind a closed disclosure", async () => {
    runtime.getStatus.mockResolvedValue(status());
    render(<SettingsPanel {...props} />);
    expect(screen.getByText("Find parts")).toBeTruthy();
    expect(screen.getByText("Circuit assistant")).toBeTruthy();
    const workspace = screen.getByText("Workspace").closest("details");
    expect(workspace).toBeTruthy();
    expect(workspace?.hasAttribute("open")).toBe(false);
    expect(screen.queryByText("Recovery copy of untitled edits")).toBeNull();
    fireEvent.click(screen.getByText("Workspace"));
    expect(screen.getByText("Recovery copy of untitled edits")).toBeTruthy();
  });
});
