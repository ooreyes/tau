// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { parseCreateAscAction } from "./assistantActions";
import {
  clearAssistantRecovery,
  loadAssistantHistory,
  loadAssistantRecovery,
  saveAssistantHistory,
  saveAssistantRecovery,
} from "./assistantMemory";

const VALID_ASC = `Version 4
SHEET 1 880 680
WIRE 144 96 80 96
WIRE 304 96 224 96
WIRE 304 144 304 96
WIRE 80 192 80 96
WIRE 304 240 304 208
FLAG 80 192 0
FLAG 304 240 0
FLAG 304 96 vout
SYMBOL res 240 80 R90
SYMATTR InstName R1
SYMATTR Value 1k
SYMBOL cap 288 144 R0
SYMATTR InstName C1
SYMATTR Value 1u
SYMBOL voltage 80 80 R0
SYMATTR InstName V1
SYMATTR Value 5
TEXT 0 0 Left 2 !.tran 5m
`;

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

  it("restores a validated proposal and its speed/cost receipt after reload", () => {
    const action = parseCreateAscAction("create-1", { filename: "filter.asc", source: VALID_ASC });
    saveAssistantHistory("filter.asc", [{
      role: "assistant",
      content: "The filter is ready.",
      actions: [action],
      metrics: {
        durationMs: 12_000,
        attempts: 1,
        inputTokens: 30,
        outputTokens: 400,
        cacheCreationInputTokens: 5_800,
        cacheReadInputTokens: 0,
      },
    }]);

    const [restored] = loadAssistantHistory("filter.asc");
    expect(restored.actions?.[0]).toEqual(expect.objectContaining({
      type: "create_asc",
      filename: "filter.asc",
      componentCount: 3,
    }));
    expect(restored.actions?.[0].document.components.some((component) => component.label === "R1")).toBe(true);
    expect(restored.metrics).toEqual(expect.objectContaining({ cacheCreationInputTokens: 5_800 }));
  });

  it("persists an interrupted or failed turn for exact one-click recovery", () => {
    saveAssistantRecovery("tank.asc", { status: "running", prompt: "Build an LC tank" });
    expect(loadAssistantRecovery("tank.asc")).toEqual({ status: "running", prompt: "Build an LC tank" });

    saveAssistantRecovery("tank.asc", {
      status: "failed",
      prompt: "Build an LC tank",
      kind: "network",
      message: "Tau stopped the request after 90 seconds.",
    });
    expect(loadAssistantRecovery("tank.asc")).toEqual(expect.objectContaining({
      status: "failed",
      prompt: "Build an LC tank",
      kind: "network",
    }));

    clearAssistantRecovery("tank.asc");
    expect(loadAssistantRecovery("tank.asc")).toBeNull();
  });
});
