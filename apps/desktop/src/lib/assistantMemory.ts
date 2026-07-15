import {
  parseApplyCurrentAscAction,
  parseCreateAscAction,
  type AssistantAscAction,
} from "./assistantActions";
import type { AssistantRunMetrics } from "./assistantProvider";

export interface PersistedAssistantMessage {
  role: "user" | "assistant";
  content: string;
  /** Validated proposals survive a reload so a successful cloud call does not
   *  turn into prose with a missing Create/Apply button. */
  actions?: AssistantAscAction[];
  metrics?: AssistantRunMetrics;
}

export interface PersistedAssistantRecovery {
  status: "running" | "failed";
  prompt: string;
  kind?: "auth" | "rate_limit" | "network" | "invalid_action" | "unknown";
  message?: string;
}

const HISTORY_PREFIX = "tau.assistant.history.v1:";
const RECOVERY_PREFIX = "tau.assistant.recovery.v1:";
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 24_000;
const MAX_PROMPT_CHARS = 12_000;
const MAX_ERROR_CHARS = 1_000;

function storageKey(prefix: string, memoryKey: string): string {
  return `${prefix}${encodeURIComponent(memoryKey || "untitled.asc")}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function restoreAction(value: unknown): AssistantAscAction | null {
  const candidate = record(value);
  if (!candidate || typeof candidate.id !== "string" || typeof candidate.source !== "string") return null;
  try {
    if (candidate.type === "create_asc" && typeof candidate.filename === "string") {
      return parseCreateAscAction(candidate.id, {
        filename: candidate.filename,
        source: candidate.source,
      });
    }
    if (candidate.type === "apply_current_asc") {
      return parseApplyCurrentAscAction(candidate.id, { source: candidate.source });
    }
  } catch {
    // A stale/corrupt proposal is omitted while its ordinary prose survives.
  }
  return null;
}

function restoreMetrics(value: unknown): AssistantRunMetrics | undefined {
  const candidate = record(value);
  if (!candidate) return undefined;
  const keys = [
    "durationMs",
    "attempts",
    "inputTokens",
    "outputTokens",
    "cacheCreationInputTokens",
    "cacheReadInputTokens",
  ] as const;
  if (keys.some((key) => typeof candidate[key] !== "number" || !Number.isFinite(candidate[key]) || candidate[key] < 0)) {
    return undefined;
  }
  return Object.fromEntries(keys.map((key) => [key, candidate[key]])) as unknown as AssistantRunMetrics;
}

function serializeAction(action: AssistantAscAction): Record<string, string> {
  return action.type === "create_asc"
    ? { type: action.type, id: action.id, filename: action.filename, source: action.source }
    : { type: action.type, id: action.id, source: action.source };
}

export function loadAssistantHistory(memoryKey: string): PersistedAssistantMessage[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(HISTORY_PREFIX, memoryKey)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap<PersistedAssistantMessage>((item) => {
      const candidate = record(item);
      if (!candidate || (candidate.role !== "user" && candidate.role !== "assistant") || typeof candidate.content !== "string") return [];
      const content = candidate.content.slice(0, MAX_MESSAGE_CHARS);
      const actions = Array.isArray(candidate.actions)
        ? candidate.actions.flatMap((action) => restoreAction(action) ?? []).slice(0, 1)
        : [];
      if (!content.trim() && actions.length === 0) return [];
      const metrics = restoreMetrics(candidate.metrics);
      return [{
        role: candidate.role,
        content,
        ...(actions.length > 0 ? { actions } : {}),
        ...(metrics ? { metrics } : {}),
      }];
    }).slice(-MAX_MESSAGES);
  } catch {
    return [];
  }
}

export function saveAssistantHistory(memoryKey: string, messages: readonly PersistedAssistantMessage[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    const bounded = messages
      .filter((message) => message.content.trim() || Boolean(message.actions?.length))
      .map((message) => ({
        role: message.role,
        content: message.content.slice(0, MAX_MESSAGE_CHARS),
        ...(message.actions?.length ? { actions: message.actions.slice(0, 1).map(serializeAction) } : {}),
        ...(message.metrics ? { metrics: message.metrics } : {}),
      }))
      .slice(-MAX_MESSAGES);
    const key = storageKey(HISTORY_PREFIX, memoryKey);
    if (bounded.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(bounded));
  } catch {
    // Private mode/quota errors leave the active in-memory conversation intact.
  }
}

export function loadAssistantRecovery(memoryKey: string): PersistedAssistantRecovery | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const candidate = record(JSON.parse(localStorage.getItem(storageKey(RECOVERY_PREFIX, memoryKey)) ?? "null"));
    if (!candidate || (candidate.status !== "running" && candidate.status !== "failed") || typeof candidate.prompt !== "string") return null;
    const prompt = candidate.prompt.slice(0, MAX_PROMPT_CHARS).trim();
    if (!prompt) return null;
    const allowedKinds = new Set(["auth", "rate_limit", "network", "invalid_action", "unknown"]);
    return {
      status: candidate.status,
      prompt,
      ...(typeof candidate.kind === "string" && allowedKinds.has(candidate.kind)
        ? { kind: candidate.kind as PersistedAssistantRecovery["kind"] }
        : {}),
      ...(typeof candidate.message === "string" ? { message: candidate.message.slice(0, MAX_ERROR_CHARS) } : {}),
    };
  } catch {
    return null;
  }
}

export function saveAssistantRecovery(memoryKey: string, recovery: PersistedAssistantRecovery): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(RECOVERY_PREFIX, memoryKey), JSON.stringify({
      status: recovery.status,
      prompt: recovery.prompt.slice(0, MAX_PROMPT_CHARS),
      ...(recovery.kind ? { kind: recovery.kind } : {}),
      ...(recovery.message ? { message: recovery.message.slice(0, MAX_ERROR_CHARS) } : {}),
    }));
  } catch {
    // Recovery is best-effort; the live request and transcript stay intact.
  }
}

export function clearAssistantRecovery(memoryKey: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(storageKey(RECOVERY_PREFIX, memoryKey));
  } catch {
    // Nothing else to do when browser storage is unavailable.
  }
}
