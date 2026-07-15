export interface PersistedAssistantMessage {
  role: "user" | "assistant";
  content: string;
}

const HISTORY_PREFIX = "tau.assistant.history.v1:";
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 24_000;

function historyKey(memoryKey: string): string {
  return `${HISTORY_PREFIX}${encodeURIComponent(memoryKey || "untitled.asc")}`;
}

export function loadAssistantHistory(memoryKey: string): PersistedAssistantMessage[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(historyKey(memoryKey)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap<PersistedAssistantMessage>((item) => {
      if (item === null || typeof item !== "object") return [];
      const candidate = item as Record<string, unknown>;
      if ((candidate.role !== "user" && candidate.role !== "assistant") || typeof candidate.content !== "string") return [];
      const content = candidate.content.slice(0, MAX_MESSAGE_CHARS);
      return content.trim() ? [{ role: candidate.role, content }] : [];
    }).slice(-MAX_MESSAGES);
  } catch {
    return [];
  }
}

export function saveAssistantHistory(memoryKey: string, messages: readonly PersistedAssistantMessage[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    const bounded = messages
      .filter((message) => message.content.trim())
      .map((message) => ({ role: message.role, content: message.content.slice(0, MAX_MESSAGE_CHARS) }))
      .slice(-MAX_MESSAGES);
    if (bounded.length === 0) localStorage.removeItem(historyKey(memoryKey));
    else localStorage.setItem(historyKey(memoryKey), JSON.stringify(bounded));
  } catch {
    // Private mode/quota errors leave the active in-memory conversation intact.
  }
}
