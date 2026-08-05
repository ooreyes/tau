import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasCloudAiConsent, loadCloudAiConsent, saveCloudAiConsent } from "./cloudAiConsent";

describe("cloud AI consent", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  });

  it("defaults to no consent so circuit data stays local until the student opts in", () => {
    expect(loadCloudAiConsent()).toEqual({ consented: false });
    expect(hasCloudAiConsent()).toBe(false);
  });

  it("round-trips an explicit consent", () => {
    saveCloudAiConsent({ consented: true });
    expect(hasCloudAiConsent()).toBe(true);
    saveCloudAiConsent({ consented: false });
    expect(hasCloudAiConsent()).toBe(false);
  });
});
