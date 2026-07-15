// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { loadAssistantHistory, saveAssistantHistory } from "./assistantMemory";

const backing = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => void backing.set(key, String(value)),
    removeItem: (key: string) => void backing.delete(key),
    clear: () => backing.clear(),
  } as Storage,
});

describe("assistant document memory", () => {
  beforeEach(() => localStorage.clear());

  it("restores a transcript only for its schematic", () => {
    saveAssistantHistory("/circuits/filter.asc", [
      { role: "user", content: "Why is the cutoff low?" },
      { role: "assistant", content: "R1 and C1 set it." },
    ]);

    expect(loadAssistantHistory("/circuits/filter.asc")).toEqual([
      { role: "user", content: "Why is the cutoff low?" },
      { role: "assistant", content: "R1 and C1 set it." },
    ]);
    expect(loadAssistantHistory("/circuits/amplifier.asc")).toEqual([]);
  });

  it("bounds history and clears storage with an empty transcript", () => {
    saveAssistantHistory("bounded.asc", Array.from({ length: 45 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `message-${index}`,
    })));
    expect(loadAssistantHistory("bounded.asc")).toHaveLength(40);
    expect(loadAssistantHistory("bounded.asc")[0].content).toBe("message-5");

    saveAssistantHistory("bounded.asc", []);
    expect(loadAssistantHistory("bounded.asc")).toEqual([]);
  });

  it("ignores malformed stored data", () => {
    localStorage.setItem("tau.assistant.history.v1:bad.asc", "not-json");
    expect(loadAssistantHistory("bad.asc")).toEqual([]);
  });
});
