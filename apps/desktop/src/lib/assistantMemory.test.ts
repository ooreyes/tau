// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseCreateAscAction } from "./assistantActions";
import {
  clearAssistantRecovery,
  createConversation,
  deleteConversation,
  getActiveConversationId,
  listConversations,
  loadAssistantHistory,
  loadAssistantRecovery,
  loadConversation,
  mergeConversationHistory,
  migrateConversation,
  renameConversation,
  saveAssistantHistory,
  saveAssistantRecovery,
  saveConversationMessages,
  setActiveConversationId,
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

describe("assistant conversation store", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it("creates, saves, and lists conversations newest-updated first", () => {
    vi.useFakeTimers();
    const firstId = createConversation();
    vi.setSystemTime(1_000);
    saveConversationMessages("proj.asc", firstId, [{ role: "user", content: "First question" }]);

    const secondId = createConversation();
    vi.setSystemTime(2_000);
    saveConversationMessages("proj.asc", secondId, [{ role: "user", content: "Second question" }]);

    const list = listConversations("proj.asc");
    expect(list.map((conversation) => conversation.id)).toEqual([secondId, firstId]);
    expect(list[0].title).toBe("Second question");
    expect(list[1].title).toBe("First question");
    expect(loadConversation("proj.asc", secondId)?.title).toBe("Second question");
    expect(loadConversation("proj.asc", "missing-id")).toBeNull();
  });

  it("never persists a conversation that only ever held empty messages", () => {
    const id = createConversation();
    saveConversationMessages("empty.asc", id, []);
    saveConversationMessages("empty.asc", id, [{ role: "user", content: "   " }]);
    expect(listConversations("empty.asc")).toEqual([]);
  });

  it("freezes the title at first save instead of drifting on later turns", () => {
    const id = createConversation();
    const longPrompt = "Explain the RC time constant for this low-pass filter in as much detail as possible please";
    saveConversationMessages("title.asc", id, [{ role: "user", content: longPrompt }]);
    const firstTitle = loadConversation("title.asc", id)?.title;
    expect(firstTitle?.length).toBeLessThanOrEqual(48); // ellipsis counts against the cap
    expect(firstTitle?.endsWith("…")).toBe(true);

    saveConversationMessages("title.asc", id, [
      { role: "user", content: longPrompt },
      { role: "assistant", content: "R1 and C1 set the pole." },
      { role: "user", content: "A completely different second question" },
    ]);
    expect(loadConversation("title.asc", id)?.title).toBe(firstTitle);
  });

  it("renames a saved conversation while preserving and bounding its transcript", () => {
    const id = createConversation();
    saveConversationMessages("rename.asc", id, [
      { role: "user", content: "Old opening prompt" },
      { role: "assistant", content: "An answer" },
    ]);

    renameConversation("rename.asc", id, "  A much better opening prompt for this circuit  ");

    expect(loadConversation("rename.asc", id)).toEqual(expect.objectContaining({
      title: "A much better opening prompt for this circuit",
      messages: [
        { role: "user", content: "Old opening prompt" },
        { role: "assistant", content: "An answer" },
      ],
    }));
  });

  it("falls back to \"New chat\" when the first bounded message has no user turn", () => {
    const id = createConversation();
    saveConversationMessages("fallback.asc", id, [{ role: "assistant", content: "Hello, how can I help?" }]);
    expect(loadConversation("fallback.asc", id)?.title).toBe("New chat");
  });

  it("migrates a legacy single-thread history into one conversation on first read, and only once", () => {
    saveAssistantHistory("legacy.asc", [
      { role: "user", content: "What does R1 do?" },
      { role: "assistant", content: "It sets the gain." },
    ]);

    const list = listConversations("legacy.asc");
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("What does R1 do?");
    expect(list[0].messages).toEqual([
      { role: "user", content: "What does R1 do?" },
      { role: "assistant", content: "It sets the gain." },
    ]);
    expect(getActiveConversationId("legacy.asc")).toBe(list[0].id);
    // Folded in and removed — a second read must not fabricate a duplicate.
    expect(loadAssistantHistory("legacy.asc")).toEqual([]);
    const secondRead = listConversations("legacy.asc");
    expect(secondRead).toHaveLength(1);
    expect(secondRead[0].id).toBe(list[0].id);
  });

  it("does not fabricate a conversation for a circuit with no legacy history", () => {
    expect(listConversations("brand-new.asc")).toEqual([]);
  });

  it("deletes a conversation, clearing the active pointer only when it pointed at the deleted one", () => {
    const keepId = createConversation();
    saveConversationMessages("del.asc", keepId, [{ role: "user", content: "Keep me" }]);
    const dropId = createConversation();
    saveConversationMessages("del.asc", dropId, [{ role: "user", content: "Drop me" }]);
    setActiveConversationId("del.asc", dropId);

    deleteConversation("del.asc", dropId);

    expect(listConversations("del.asc").map((conversation) => conversation.id)).toEqual([keepId]);
    expect(getActiveConversationId("del.asc")).toBeNull();

    // Deleting a conversation that isn't the active one leaves the pointer alone.
    setActiveConversationId("del.asc", keepId);
    deleteConversation("del.asc", "not-a-real-id");
    expect(getActiveConversationId("del.asc")).toBe(keepId);
  });

  it("bounds the number of saved conversations per circuit, dropping the oldest by updatedAt", () => {
    vi.useFakeTimers();
    const ids: string[] = [];
    for (let index = 0; index < 31; index += 1) {
      const id = createConversation();
      vi.setSystemTime(1_000 + index);
      saveConversationMessages("many.asc", id, [{ role: "user", content: `Question ${index}` }]);
      ids.push(id);
    }

    const list = listConversations("many.asc");
    expect(list).toHaveLength(30);
    expect(list.some((conversation) => conversation.id === ids[0])).toBe(false);
    expect(list[0].id).toBe(ids[30]);
  });

  it("round-trips the active-id pointer independent of whether that conversation exists", () => {
    expect(getActiveConversationId("ptr.asc")).toBeNull();
    setActiveConversationId("ptr.asc", "some-id");
    expect(getActiveConversationId("ptr.asc")).toBe("some-id");
  });

  it("migrates an active conversation onto a new memoryKey (assistant Create remount)", () => {
    const id = createConversation();
    saveConversationMessages("untitled.asc", id, [
      { role: "user", content: "Build an RC filter" },
      { role: "assistant", content: "Here is a plan." },
    ]);
    setActiveConversationId("untitled.asc", id);

    expect(migrateConversation("untitled.asc", "rc-filter.asc")).toBe(id);
    expect(getActiveConversationId("rc-filter.asc")).toBe(id);
    expect(loadConversation("rc-filter.asc", id)?.messages).toEqual([
      { role: "user", content: "Build an RC filter" },
      { role: "assistant", content: "Here is a plan." },
    ]);
    expect(loadConversation("rc-filter.asc", id)?.title).toBe("Build an RC filter");
    // Source key is left intact — migrate is a copy, not a move.
    expect(loadConversation("untitled.asc", id)?.messages).toHaveLength(2);
  });

  it("merges legacy file chats into project history without replacing the active project thread", () => {
    const projectId = createConversation();
    saveConversationMessages("/project", projectId, [{ role: "user", content: "Project chat" }]);
    setActiveConversationId("/project", projectId);
    const fileId = createConversation();
    saveConversationMessages("/project/a.asc", fileId, [{ role: "user", content: "Older file chat" }]);
    setActiveConversationId("/project/a.asc", fileId);

    mergeConversationHistory("/project/a.asc", "/project");

    expect(listConversations("/project").map((conversation) => conversation.title)).toEqual(
      expect.arrayContaining(["Project chat", "Older file chat"]),
    );
    expect(getActiveConversationId("/project")).toBe(projectId);
    expect(listConversations("/project/a.asc")).toHaveLength(1);
  });

  it("migrateConversation no-ops when keys match or the source thread is empty", () => {
    const id = createConversation();
    expect(migrateConversation("same.asc", "same.asc", id)).toBe(id);
    expect(migrateConversation("empty-from.asc", "empty-to.asc")).toBeNull();
    saveConversationMessages("empty-from.asc", id, []);
    expect(migrateConversation("empty-from.asc", "empty-to.asc", id)).toBeNull();
  });
});

describe("assistant conversation store — localStorage unavailable", () => {
  let originalDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: undefined });
  });

  afterEach(() => {
    if (originalDescriptor) Object.defineProperty(globalThis, "localStorage", originalDescriptor);
  });

  it("no-ops instead of throwing when browser storage is unavailable", () => {
    expect(listConversations("any.asc")).toEqual([]);
    expect(loadConversation("any.asc", "some-id")).toBeNull();
    expect(typeof createConversation()).toBe("string");
    expect(() => saveConversationMessages("any.asc", "some-id", [{ role: "user", content: "hi" }])).not.toThrow();
    expect(() => deleteConversation("any.asc", "some-id")).not.toThrow();
    expect(getActiveConversationId("any.asc")).toBeNull();
    expect(() => setActiveConversationId("any.asc", "some-id")).not.toThrow();
    expect(migrateConversation("a.asc", "b.asc")).toBeNull();
  });
});
