/**
 * Credentials-out-of-renderer contract: Tauri never hydrates raw BYOK keys into
 * module state for API use; cloud HTTPS goes through `cloud_ai_proxy`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn(() => true);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("cloud AI credential boundary", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    // Every command must get a thenable; keychain writes go out immediately.
    invokeMock.mockResolvedValue(undefined);
    isTauriMock.mockReturnValue(true);
    vi.useRealTimers();
    vi.resetModules();
  });

  /**
   * Answer presence queries by command name rather than by call order. Call
   * order was load-bearing here while saves were debounced out of the way: a
   * `mockResolvedValueOnce` meant for `has_*` is eaten by the `save_*` that now
   * goes out first, and hydration then reads `undefined` as its answer.
   */
  function answerPresence(command: string, present: boolean) {
    invokeMock.mockImplementation((name: string) =>
      Promise.resolve(name === command ? present : undefined),
    );
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hydrates Anthropic presence only — never a raw key — under Tauri", async () => {
    answerPresence("has_assistant_api_key", true);
    const { hydrateAssistantApiKey, loadAssistantApiKey, hasAssistantApiKey, saveAssistantApiKey } =
      await import("./assistant");
    saveAssistantApiKey("");
    await hydrateAssistantApiKey();
    expect(invokeMock).toHaveBeenCalledWith("has_assistant_api_key");
    expect(hasAssistantApiKey()).toBe(true);
    expect(loadAssistantApiKey()).toBe("");
  });

  it("writes Anthropic keys to the keychain without retaining them in Tauri", async () => {
    // Fake timers on purpose, never advanced: the write must already be out.
    // It used to sit behind a 350 ms debounce that coalesced nothing - the only
    // caller is an explicit Save press - and quitting Tau inside that window
    // dropped the key after the UI had said it was saved.
    vi.useFakeTimers();
    const { saveAssistantApiKey, loadAssistantApiKey, hasAssistantApiKey } = await import("./assistant");
    saveAssistantApiKey("sk-ant-never-in-renderer");
    expect(hasAssistantApiKey()).toBe(true);
    expect(loadAssistantApiKey()).toBe("");
    expect(invokeMock).toHaveBeenCalledWith("save_assistant_api_key", {
      apiKey: "sk-ant-never-in-renderer",
    });
  });

  it("hydrates Gemini presence only under Tauri", async () => {
    answerPresence("has_provider_api_key", true);
    const { hydrateGeminiApiKey, loadGeminiApiKey, hasGeminiApiKey, saveGeminiApiKey } =
      await import("./providerApiKey");
    saveGeminiApiKey("");
    await hydrateGeminiApiKey();
    expect(invokeMock).toHaveBeenCalledWith("has_provider_api_key", { provider: "gemini" });
    expect(hasGeminiApiKey()).toBe(true);
    expect(loadGeminiApiKey()).toBe("");
  });

  it("proxies Gemini fetches without Authorization headers on the IPC payload", async () => {
    invokeMock.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok", tool_calls: [] } }] }),
      headers: [["content-type", "application/json"]],
    });
    const { createCloudAiFetch } = await import("./cloudAiFetch");
    const fetchImpl = createCloudAiFetch("gemini");
    const response = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer should-never-cross-ipc",
      },
      body: JSON.stringify({ model: "gemini-2.5-flash", messages: [] }),
    });
    expect(response.ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0][0]).toBe("cloud_ai_proxy");
    const payload = invokeMock.mock.calls[0][1] as {
      request: { provider: string; url: string; method: string; headers: Array<[string, string]>; body: string };
    };
    expect(payload.request.provider).toBe("gemini");
    expect(payload.request.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    expect(payload.request.method).toBe("POST");
    expect(payload.request.headers).toEqual([["content-type", "application/json"]]);
    expect(JSON.stringify(payload)).not.toContain("should-never-cross-ipc");
    expect(JSON.stringify(payload.request.headers)).not.toMatch(/authorization/i);
  });

  it("proxies Anthropic fetches without x-api-key on the IPC payload", async () => {
    invokeMock.mockResolvedValue({
      status: 200,
      body: '{"type":"message","content":[]}',
      headers: [["content-type", "application/json"]],
    });
    const { createCloudAiFetch } = await import("./cloudAiFetch");
    const fetchImpl = createCloudAiFetch("anthropic");
    await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": "sk-ant-should-never-cross-ipc",
      },
      body: "{}",
    });
    const payload = invokeMock.mock.calls[0][1] as {
      request: { provider: string; headers: Array<[string, string]> };
    };
    expect(payload.request.provider).toBe("anthropic");
    expect(payload.request.headers).toEqual(
      expect.arrayContaining([
        ["content-type", "application/json"],
        ["anthropic-version", "2023-06-01"],
      ]),
    );
    expect(payload.request.headers).toHaveLength(2);
    expect(JSON.stringify(payload)).not.toContain("sk-ant-should-never-cross-ipc");
    expect(JSON.stringify(payload.request.headers)).not.toMatch(/x-api-key/i);
  });

  it("keeps a web-only session key outside Tauri for unit-test seams", async () => {
    isTauriMock.mockReturnValue(false);
    const { saveAssistantApiKey, loadAssistantApiKey, hasAssistantApiKey } = await import("./assistant");
    saveAssistantApiKey("web-only-test-key");
    expect(hasAssistantApiKey()).toBe(true);
    expect(loadAssistantApiKey()).toBe("web-only-test-key");
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
