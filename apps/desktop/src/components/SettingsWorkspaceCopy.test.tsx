// @vitest-environment jsdom
/**
 * Bench EE-trust: student-simple Settings chrome (Find parts + Workspace
 * disclosure). Keeps Freshman's SettingsAiSection lifecycle tests alone.
 */
import { cleanup, render, screen } from "@testing-library/react";
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
import { saveCloudAiConsent } from "../lib/cloudAiConsent";
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

function status(): LocalAiStatus {
  return {
    state: "stopped",
    endpoint: "http://127.0.0.1:8080/v1",
    managed: false,
    installed: true,
    modelId: null,
    modelRepository: null,
    detail: "Choose a model.",
    presets: [
      { id: "qwen3-1.7b-4bit", repository: "Qwen/Qwen3-1.7B-MLX-4bit", label: "Qwen3 1.7B · 4-bit", downloadMb: 914, downloaded: false },
      { id: "qwen3-4b-4bit", repository: "Qwen/Qwen3-4B-MLX-4bit", label: "Qwen3 4B · 4-bit", downloadMb: 2300, downloaded: false },
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
  runtime.isNative.mockResolvedValue(true);
  runtime.getStatus.mockResolvedValue(status());
  saveCloudAiConsent({ consented: false });
  saveAssistantPreferences({ provider: "local-mlx", localModel: "qwen3-1.7b-4bit" });
});

describe("Settings workspace copy (student-calm)", () => {
  it("keeps advanced workspace rows behind a closed disclosure", () => {
    render(<SettingsPanel {...props} />);
    expect(screen.getAllByText("Appearance").length).toBeGreaterThan(0);
    expect(screen.getByText("Circuit assistant")).toBeTruthy();
    expect(screen.getByText("Find parts")).toBeTruthy();
    const workspace = screen.getByText("Workspace").closest("details");
    expect(workspace).toBeTruthy();
    expect(workspace?.hasAttribute("open")).toBe(false);
    expect(screen.getByText("Autosave")).toBeTruthy();
  });
});
