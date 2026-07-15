import { afterEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => core);

import {
  LOCAL_AI_ENDPOINT,
  getLocalAiStatus,
  startLocalAi,
  stopLocalAi,
} from "./localAiRuntime";

afterEach(() => {
  core.isTauri.mockReturnValue(true);
  core.invoke.mockReset();
  vi.unstubAllGlobals();
});

describe("local AI native lifecycle bridge", () => {
  it("keeps lifecycle commands on the audited native boundary", async () => {
    core.invoke.mockResolvedValue({ state: "ready", endpoint: LOCAL_AI_ENDPOINT, presets: [] });

    await getLocalAiStatus();
    await startLocalAi("qwen3-4b-4bit", true);
    await stopLocalAi();

    expect(core.invoke.mock.calls).toEqual([
      ["local_ai_status", undefined],
      ["start_local_ai", { modelId: "qwen3-4b-4bit", allowDownload: true }],
      ["stop_local_ai", undefined],
    ]);
  });

  it("only probes the fixed loopback models endpoint in browser preview", async () => {
    core.isTauri.mockReturnValue(false);
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getLocalAiStatus()).resolves.toMatchObject({
      state: "ready",
      endpoint: LOCAL_AI_ENDPOINT,
      managed: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${LOCAL_AI_ENDPOINT}/models`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("never starts a process from the browser fallback", async () => {
    core.isTauri.mockReturnValue(false);
    await expect(startLocalAi("qwen3-1.7b-4bit", false)).rejects.toThrow("Tau desktop");
    expect(core.invoke).not.toHaveBeenCalled();
  });
});
