import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadAssistantPreferences, saveAssistantPreferences } from "./assistantPreferences";

describe("assistant provider preferences", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  });

  it("defaults to the local 4B model without requiring a cloud credential", () => {
    expect(loadAssistantPreferences()).toEqual({
      provider: "local-mlx",
      localModel: "qwen3-4b-4bit",
    });
  });

  it("round-trips only an audited provider and model preset", () => {
    saveAssistantPreferences({ provider: "anthropic", localModel: "qwen3-1.7b-4bit" });
    expect(loadAssistantPreferences()).toEqual({
      provider: "anthropic",
      localModel: "qwen3-1.7b-4bit",
    });
  });
});
