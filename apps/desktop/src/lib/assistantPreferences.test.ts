import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadAssistantPreferences, saveAssistantPreferences } from "./assistantPreferences";
import { GEMINI_DEFAULT_MODEL } from "./geminiAssistant";

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
      geminiModel: GEMINI_DEFAULT_MODEL,
    });
  });

  it("round-trips only an audited provider and model preset", () => {
    saveAssistantPreferences({ provider: "anthropic", localModel: "qwen3-1.7b-4bit" });
    expect(loadAssistantPreferences()).toEqual({
      provider: "anthropic",
      localModel: "qwen3-1.7b-4bit",
      geminiModel: GEMINI_DEFAULT_MODEL,
    });
  });

  it("accepts Gemini as a provider and keeps its model independent of the local one", () => {
    saveAssistantPreferences({
      provider: "gemini",
      localModel: "qwen3-4b-4bit",
      geminiModel: "gemini-2.5-pro",
    });
    expect(loadAssistantPreferences()).toEqual({
      provider: "gemini",
      localModel: "qwen3-4b-4bit",
      geminiModel: "gemini-2.5-pro",
    });
  });

  it("rejects a provider outside the audited set", () => {
    localStorage.setItem(
      "tau.assistant.preferences.v1",
      JSON.stringify({ provider: "openai", localModel: "qwen3-4b-4bit", geminiModel: "gemini-2.5-flash" }),
    );
    expect(loadAssistantPreferences().provider).toBe("local-mlx");
  });

  it("upgrades a stored blob written before geminiModel existed", () => {
    localStorage.setItem(
      "tau.assistant.preferences.v1",
      JSON.stringify({ provider: "anthropic", localModel: "qwen3-1.7b-4bit" }),
    );
    expect(loadAssistantPreferences()).toEqual({
      provider: "anthropic",
      localModel: "qwen3-1.7b-4bit",
      geminiModel: GEMINI_DEFAULT_MODEL,
    });
  });
});
