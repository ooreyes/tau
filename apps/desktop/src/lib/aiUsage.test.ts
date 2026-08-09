/**
 * Regression coverage for the "reset re-derives clock-dependent defaults" fix
 * in `preferences.ts`, exercised through the AI usage store that motivated it.
 *
 * Module-load order note: `aiUsage.ts` builds its store with
 * `defaults: emptyUsage()`, a value computed exactly once, at import time.
 * To prove `reset()` genuinely recomputes "since" (via `makeDefaults`)
 * rather than replaying that frozen import-time value, the test below must
 * import the module at one instant and then move the clock forward *before*
 * calling `reset()`. A plain top-level `import` would bake in whatever time
 * the whole test file happened to load, and reusing the same module instance
 * across tests would leak accumulated usage between cases. So each test does
 * a `vi.resetModules()` + dynamic `await import("./aiUsage")` (the pattern
 * from `cloudAiCredentials.test.ts`) to get its own fresh store, and takes
 * its snapshot of "now" via `vi.useFakeTimers()` *before* that import — so
 * the frozen defaults reflect the moment of import, exactly like the real
 * "stamped at app launch" bug — and only then calls `vi.setSystemTime` to
 * jump forward and invoke `reset()`. Skipping that ordering (e.g. setting
 * the system time before importing) would make both the buggy and fixed
 * code paths agree, silently disarming the test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("aiUsage", () => {
  it("reset restarts the counting window at now, not at app launch", async () => {
    // Freeze "now" at the real current time first, so the module's
    // `defaults: emptyUsage()` (evaluated during the import below) captures
    // the same kind of real-launch timestamp the bug depends on.
    vi.useFakeTimers();
    const { aiUsage, loadAiUsage } = await import("./aiUsage");

    // Now jump the clock forward, well past module load, and reset.
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    aiUsage.reset();

    expect(loadAiUsage().since).toBe(Date.parse("2030-01-01T00:00:00Z"));
  });

  it("recordAiRequest accumulates per provider and clearAiUsage zeroes it", async () => {
    const { recordAiRequest, loadAiUsage, clearAiUsage } = await import("./aiUsage");

    recordAiRequest("anthropic", { input: 10, output: 20 });
    recordAiRequest("anthropic", { input: 5 });
    recordAiRequest("openai", { input: 1, output: 2 });

    const usage = loadAiUsage();
    expect(usage.providers.anthropic.requests).toBe(2);
    expect(usage.providers.anthropic.inputTokens).toBe(15);
    expect(usage.providers.anthropic.outputTokens).toBe(20);
    expect(usage.providers.anthropic.lastUsedAt).not.toBeNull();
    expect(usage.providers.openai.requests).toBe(1);

    clearAiUsage();
    const cleared = loadAiUsage();
    expect(cleared.providers.anthropic).toEqual({
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      lastUsedAt: null,
    });
    expect(cleared.providers.openai.requests).toBe(0);
  });
});
