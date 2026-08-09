/**
 * The on-device Usage row can only ever show real numbers if something
 * actually calls `recordAiRequest("local-mlx", ...)`. This exercises that
 * wiring end-to-end through `LocalMlxAssistant`, not just `createLocalAiFetch`
 * in isolation, because the bug this guards against is the constructor never
 * wrapping the fetch it was given.
 *
 * Module-load order note: `aiUsage.ts` caches its store in a module-level
 * variable, and `localAiFetch.ts` / `localMlxAssistant.ts` both close over
 * whichever `aiUsage` instance they imported. So each test does a fresh
 * `vi.resetModules()` + dynamic import of the whole chain (the pattern from
 * `aiUsage.test.ts` / `cloudAiCredentials.test.ts`), otherwise usage counted
 * in one test would leak into the next.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantProvider } from "./assistantProvider";

// This test file's Node/jsdom Storage is disabled by default, matching the
// guard aiUsage.ts's underlying preferences.ts relies on. Install an
// in-memory Storage so the persistence path is actually exercised, copied
// from theme.test.ts lines 10-23 - including `removeItem`, whose absence let
// a sibling test file pass for the wrong reason (the module's try/catch
// swallowed the resulting TypeError).
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

const request = (): Parameters<AssistantProvider["complete"]>[0] => ({
  contextText: "SPICE netlist:\nR1 in 0 1k",
  history: [{ role: "user", content: "What does R1 do?" }],
});

const completion = (message: Record<string, unknown>, usage?: Record<string, unknown>) => new Response(JSON.stringify({
  id: "chatcmpl-local",
  choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: "stop" }],
  ...(usage ? { usage } : {}),
}), { status: 200, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("createLocalAiFetch, wired through LocalMlxAssistant", () => {
  it("an on-device reply is counted against the on-device row", async () => {
    const { LocalMlxAssistant } = await import("./localMlxAssistant");
    const { loadAiUsage } = await import("./aiUsage");

    const fetchImpl = vi.fn(async () => completion(
      { content: "R1 limits current." },
      { prompt_tokens: 42, completion_tokens: 7 },
    ));
    const provider: AssistantProvider = new LocalMlxAssistant({ fetchImpl });

    await provider.complete(request());

    const usage = loadAiUsage().providers["local-mlx"];
    expect(usage.requests).toBe(1);
    expect(usage.inputTokens).toBe(42);
    expect(usage.outputTokens).toBe(7);
    expect(usage.lastUsedAt).not.toBeNull();
  });

  it("a failed on-device request does not invent a count", async () => {
    const { LocalMlxAssistant } = await import("./localMlxAssistant");
    const { loadAiUsage } = await import("./aiUsage");

    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const provider: AssistantProvider = new LocalMlxAssistant({ fetchImpl });

    await expect(provider.complete(request())).rejects.toThrow();

    expect(loadAiUsage().providers["local-mlx"].requests).toBe(0);
  });

  it("the wrapper does not consume the body the assistant needs", async () => {
    const { LocalMlxAssistant } = await import("./localMlxAssistant");

    const fetchImpl = vi.fn(async () => completion({ content: "R1 limits current to the LED." }));
    const provider: AssistantProvider = new LocalMlxAssistant({ fetchImpl });

    const reply = await provider.complete(request());

    expect(reply.text).toBe("R1 limits current to the LED.");
  });
});
