// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  isNative: vi.fn(),
  getStatus: vi.fn(),
  start: vi.fn(),
  install: vi.fn(),
}));

vi.mock("../lib/localAiRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/localAiRuntime")>()),
  isNativeDesktopApp: runtime.isNative,
  getLocalAiStatus: runtime.getStatus,
  startLocalAi: runtime.start,
  installLocalAiRuntime: runtime.install,
}));

import { LocalAiSetupDialog } from "./LocalAiSetupDialog";
import { saveAssistantPreferences } from "../lib/assistantPreferences";
import type { LocalAiStatus } from "../lib/localAiRuntime";

// jsdom lacks PointerEvent capture APIs that Radix Select uses on open.
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
  },
});

function status(overrides: Partial<LocalAiStatus> & {
  installed?: boolean;
  downloaded?: boolean;
} = {}): LocalAiStatus {
  const installed = overrides.installed ?? true;
  const downloaded = overrides.downloaded ?? false;
  return {
    state: overrides.state ?? "stopped",
    endpoint: "http://127.0.0.1:8080/v1",
    managed: overrides.managed ?? false,
    installed,
    modelId: null,
    modelRepository: null,
    detail: overrides.detail ?? "Choose a model.",
    presets: [
      {
        id: "qwen3-4b-4bit",
        repository: "Qwen/Qwen3-4B-MLX-4bit",
        label: "Qwen3 4B · 4-bit",
        downloadMb: 2_300,
        downloaded,
      },
      {
        id: "qwen3-1.7b-4bit",
        repository: "Qwen/Qwen3-1.7B-MLX-4bit",
        label: "Qwen3 1.7B · 4-bit",
        downloadMb: 914,
        downloaded: false,
      },
    ],
  };
}

afterEach(() => cleanup());
beforeEach(() => {
  storage.clear();
  runtime.isNative.mockReset();
  runtime.getStatus.mockReset();
  runtime.start.mockReset();
  runtime.install.mockReset();
  saveAssistantPreferences({ provider: "local-mlx", localModel: "qwen3-4b-4bit" });
});

describe("LocalAiSetupDialog", () => {
  it("stays closed in the browser", async () => {
    runtime.isNative.mockResolvedValue(false);
    render(<LocalAiSetupDialog />);
    await waitFor(() => expect(runtime.isNative).toHaveBeenCalled());
    expect(screen.queryByText("Use on-device AI")).toBeNull();
  });

  it("opens on first native launch and installs then starts via Turn on", async () => {
    runtime.isNative.mockResolvedValue(true);
    runtime.getStatus.mockResolvedValue(status({ installed: false }));
    runtime.install.mockResolvedValue(status({ installed: true, state: "stopped" }));
    runtime.start.mockResolvedValue(status({ state: "starting", managed: true, installed: true }));
    render(<LocalAiSetupDialog />);

    expect(await screen.findByRole("heading", { name: "Use on-device AI" })).toBeTruthy();
    expect(screen.queryByText(/8080|127\.0\.0\.1|localhost|loopback/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(runtime.install).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(runtime.start).toHaveBeenCalled());
  });

  it("downloads and starts the selected model after the runtime is present", async () => {
    runtime.isNative.mockResolvedValue(true);
    runtime.getStatus.mockResolvedValue(status({ installed: true, downloaded: false }));
    runtime.start.mockResolvedValue(status({ state: "starting", managed: true, installed: true }));
    render(<LocalAiSetupDialog />);

    const model = await screen.findByRole("combobox", { name: "Setup local model" });
    expect(model.tagName).toBe("BUTTON");
    expect(model.getAttribute("data-slot")).toBe("select-trigger");
    expect(document.querySelector(".settings-field select")).toBeNull();

    // First-run prefers the smaller 1.7B download for tryouts.
    fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(runtime.start).toHaveBeenCalledWith("qwen3-1.7b-4bit", true, undefined));
  });

  it("skips and does not reopen after dismiss", async () => {
    runtime.isNative.mockResolvedValue(true);
    runtime.getStatus.mockResolvedValue(status({ installed: false }));
    const { unmount } = render(<LocalAiSetupDialog />);
    fireEvent.click(await screen.findByRole("button", { name: "Skip for now" }));
    expect(screen.queryByRole("heading", { name: "Use on-device AI" })).toBeNull();
    unmount();
    render(<LocalAiSetupDialog />);
    await waitFor(() => expect(runtime.getStatus).toHaveBeenCalled());
    expect(screen.queryByRole("heading", { name: "Use on-device AI" })).toBeNull();
  });
});
