import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPreferenceStore } from "./preferences";

// This build has localStorage disabled by default in the "node" test
// environment. Install an in-memory Storage so the persistence path is
// actually exercised, matching the pattern in theme.test.ts.
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
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createPreferenceStore", () => {
  it("reset re-derives defaults that depend on the clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
    const store = createPreferenceStore<{ stamp: number }>({
      key: "test.clock-defaults",
      defaults: { stamp: Date.now() },
      validate: (raw) => {
        if (!raw || typeof raw !== "object") return null;
        const stamp = (raw as { stamp?: unknown }).stamp;
        return typeof stamp === "number" ? { stamp } : null;
      },
      makeDefaults: () => ({ stamp: Date.now() }),
    });

    vi.setSystemTime(new Date("2030-06-15T00:00:00Z"));
    store.reset();

    expect(store.load().stamp).toBe(Date.parse("2030-06-15T00:00:00Z"));
  });

  it("a store without makeDefaults still returns the shared constant", () => {
    const defaults = { volume: 5 };
    const store = createPreferenceStore<{ volume: number }>({
      key: "test.constant-defaults",
      defaults,
      validate: (raw) => {
        if (!raw || typeof raw !== "object") return null;
        const volume = (raw as { volume?: unknown }).volume;
        return typeof volume === "number" ? { volume } : null;
      },
    });

    store.save({ volume: 11 });
    store.reset();

    expect(store.load()).toBe(store.defaults);
  });

  it("round-trips a saved value", () => {
    const store = createPreferenceStore<{ label: string }>({
      key: "test.round-trip",
      defaults: { label: "default" },
      validate: (raw) => {
        if (!raw || typeof raw !== "object") return null;
        const label = (raw as { label?: unknown }).label;
        return typeof label === "string" ? { label } : null;
      },
    });

    store.save({ label: "custom" });
    expect(store.load()).toEqual({ label: "custom" });
  });

  it("falls back to defaults on a corrupt stored value instead of throwing", () => {
    localStorage.setItem("test.corrupt-value", "{not json");
    const store = createPreferenceStore<{ label: string }>({
      key: "test.corrupt-value",
      defaults: { label: "default" },
      validate: (raw) => {
        if (!raw || typeof raw !== "object") return null;
        const label = (raw as { label?: unknown }).label;
        return typeof label === "string" ? { label } : null;
      },
    });

    expect(() => store.load()).not.toThrow();
    expect(store.load()).toEqual({ label: "default" });
  });
});
