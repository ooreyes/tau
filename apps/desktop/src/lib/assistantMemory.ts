import { nanoid } from "nanoid";

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

/** One saved chat thread for a project. `messages` is the same bounded shape
 *  the legacy single-thread store used, so every existing restore/redact rule
 *  (action validation, metrics validation, char/message caps) applies per
 *  conversation instead of per circuit. */
export interface AssistantConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: PersistedAssistantMessage[];
}

const HISTORY_PREFIX = "tau.assistant.history.v1:";
const RECOVERY_PREFIX = "tau.assistant.recovery.v1:";
const CONVERSATIONS_PREFIX = "tau.assistant.conversations.v2:";
const ACTIVE_CONVERSATION_PREFIX = "tau.assistant.activeConversation.v2:";
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 24_000;
export const ASSISTANT_PROMPT_CHAR_LIMIT = 12_000;
const MAX_ERROR_CHARS = 1_000;
const MAX_TITLE_CHARS = 48;
/** Per-circuit cap on saved chats - oldest-by-updatedAt drops first, mirroring
 *  MAX_MESSAGES' sliding-window rule for a single thread. */
const MAX_CONVERSATIONS = 30;

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

/** Shared by the legacy single-thread store and every per-conversation
 *  record: validates role/content, restores at most one proposal action, and
 *  bounds to the newest MAX_MESSAGES entries. */
function restoreMessages(value: unknown): PersistedAssistantMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap<PersistedAssistantMessage>((item) => {
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
}

/** Filters empty turns and truncates content/actions, keeping the
 *  PersistedAssistantMessage shape (actions still parsed objects) - the form
 *  an AssistantConversation holds in memory. */
function boundPersistedMessages(messages: readonly PersistedAssistantMessage[]): PersistedAssistantMessage[] {
  return messages
    .filter((message) => message.content.trim() || Boolean(message.actions?.length))
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, MAX_MESSAGE_CHARS),
      ...(message.actions?.length ? { actions: message.actions.slice(0, 1) } : {}),
      ...(message.metrics ? { metrics: message.metrics } : {}),
    }))
    .slice(-MAX_MESSAGES);
}

/** JSON-safe form of boundPersistedMessages (actions serialized to plain
 *  records) - what actually goes into localStorage. */
function serializeMessages(messages: readonly PersistedAssistantMessage[]): Array<Record<string, unknown>> {
  return boundPersistedMessages(messages).map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.actions?.length ? { actions: message.actions.map(serializeAction) } : {}),
    ...(message.metrics ? { metrics: message.metrics } : {}),
  }));
}

/** @deprecated Superseded by the multi-conversation store below
 *  (listConversations/saveConversationMessages/…). Kept working as the
 *  read side of one-time migration (see migrateLegacyHistory) and for any
 *  pre-existing caller; a fresh circuit never writes this key again. */
export function loadAssistantHistory(memoryKey: string): PersistedAssistantMessage[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return restoreMessages(JSON.parse(localStorage.getItem(storageKey(HISTORY_PREFIX, memoryKey)) ?? "[]"));
  } catch {
    return [];
  }
}

/** @deprecated See loadAssistantHistory. */
export function saveAssistantHistory(memoryKey: string, messages: readonly PersistedAssistantMessage[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    const bounded = serializeMessages(messages);
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
    const prompt = candidate.prompt.slice(0, ASSISTANT_PROMPT_CHAR_LIMIT).trim();
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
      prompt: recovery.prompt.slice(0, ASSISTANT_PROMPT_CHAR_LIMIT),
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

// ── Multi-conversation store ────────────────────────────────────────────
// One circuit (memoryKey) now owns a list of AssistantConversation rows
// instead of a single message array. Everything below composes the
// validation/bounding helpers above per-conversation, plus a bounded list of
// conversations and a separate "which one is active" pointer so a reload can
// reopen the right thread.

function deriveTitle(messages: readonly PersistedAssistantMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user" && message.content.trim());
  if (!firstUser) return "New chat";
  const collapsed = firstUser.content.trim().replace(/\s+/g, " ");
  // The ellipsis counts against the cap so the result is never longer than
  // MAX_TITLE_CHARS - serializeConversation/restoreConversation re-slice to
  // that same bound as a defensive round-trip cap, which would otherwise
  // silently chop the trailing "…" off a 48-char-plus-ellipsis title.
  return collapsed.length > MAX_TITLE_CHARS ? `${collapsed.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…` : collapsed;
}

function restoreConversation(value: unknown): AssistantConversation | null {
  const candidate = record(value);
  if (!candidate || typeof candidate.id !== "string" || !candidate.id) return null;
  const messages = restoreMessages(candidate.messages);
  const now = Date.now();
  const createdAt = typeof candidate.createdAt === "number" && Number.isFinite(candidate.createdAt) ? candidate.createdAt : now;
  const updatedAt = typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : createdAt;
  const title = typeof candidate.title === "string" && candidate.title.trim()
    ? candidate.title.slice(0, MAX_TITLE_CHARS)
    : deriveTitle(messages);
  return { id: candidate.id, title, createdAt, updatedAt, messages };
}

function serializeConversation(conversation: AssistantConversation): Record<string, unknown> {
  return {
    id: conversation.id,
    title: conversation.title.slice(0, MAX_TITLE_CHARS),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messages: serializeMessages(conversation.messages),
  };
}

/** Bounds to MAX_CONVERSATIONS newest-by-updatedAt and writes the whole list;
 *  an empty result clears the key instead of storing `[]`, matching every
 *  other store in this file. Caller owns the try/catch. */
function writeConversations(memoryKey: string, conversations: readonly AssistantConversation[]): void {
  const key = storageKey(CONVERSATIONS_PREFIX, memoryKey);
  const bounded = [...conversations]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS)
    .map(serializeConversation);
  if (bounded.length === 0) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(bounded));
}

export function getActiveConversationId(memoryKey: string): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const id = localStorage.getItem(storageKey(ACTIVE_CONVERSATION_PREFIX, memoryKey));
    return id && id.trim() ? id : null;
  } catch {
    return null;
  }
}

export function setActiveConversationId(memoryKey: string, id: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(ACTIVE_CONVERSATION_PREFIX, memoryKey), id);
  } catch {
    // Best-effort pointer; the in-memory active conversation stays correct
    // for this session even if it can't be durably remembered.
  }
}

/** A pre-v2 install has at most one thread per circuit, under the legacy
 *  history key. Folded into the new store as a single conversation the first
 *  time this circuit is read after upgrading, so switching to multi-chat
 *  history never drops a transcript. Idempotent: the legacy key is removed
 *  once folded in, so a v2 store (even an empty `[]`) always wins on every
 *  read after the first, and this body never runs twice for real. */
function migrateLegacyHistory(memoryKey: string): AssistantConversation[] {
  const legacyMessages = loadAssistantHistory(memoryKey);
  if (legacyMessages.length === 0) return [];
  const now = Date.now();
  const conversation: AssistantConversation = {
    id: nanoid(),
    title: deriveTitle(legacyMessages),
    createdAt: now,
    updatedAt: now,
    messages: legacyMessages,
  };
  writeConversations(memoryKey, [conversation]);
  setActiveConversationId(memoryKey, conversation.id);
  try {
    localStorage.removeItem(storageKey(HISTORY_PREFIX, memoryKey));
  } catch {
    // Best-effort cleanup - the v2 store above is already populated and is
    // checked first on every future read, so a leftover legacy key is inert.
  }
  return [conversation];
}

/** Newest-updated first. Triggers the one-time legacy migration above when
 *  this circuit has never been read under the v2 store. */
export function listConversations(memoryKey: string): AssistantConversation[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(CONVERSATIONS_PREFIX, memoryKey));
    if (raw === null) return migrateLegacyHistory(memoryKey);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .flatMap((item) => restoreConversation(item) ?? [])
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CONVERSATIONS);
  } catch {
    return [];
  }
}

export function loadConversation(memoryKey: string, id: string): AssistantConversation | null {
  return listConversations(memoryKey).find((conversation) => conversation.id === id) ?? null;
}

/** Id generation only - independent of any circuit's store. The row is
 *  created lazily the moment saveConversationMessages first sees real
 *  content for this id, so an opened-but-never-used "New chat" never
 *  clutters the list (mirrors the legacy store's clear-on-empty rule). */
export function createConversation(): string {
  return nanoid();
}

export function saveConversationMessages(memoryKey: string, id: string, messages: readonly PersistedAssistantMessage[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    const bounded = boundPersistedMessages(messages);
    const current = listConversations(memoryKey);
    const existing = current.find((conversation) => conversation.id === id);
    if (bounded.length === 0) {
      // Mirrors the legacy store's clear-on-empty rule: a conversation that
      // never held a real message leaves no row.
      if (existing) writeConversations(memoryKey, current.filter((conversation) => conversation.id !== id));
      return;
    }
    const next: AssistantConversation = {
      id,
      // Frozen at first save so it reads like a stable subject line - it
      // must not drift if a later turn pushes the opening message out of
      // the MAX_MESSAGES window.
      title: existing?.title ?? deriveTitle(bounded),
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      messages: bounded,
    };
    writeConversations(memoryKey, [...current.filter((conversation) => conversation.id !== id), next]);
  } catch {
    // Private mode/quota errors leave the active in-memory conversation intact.
  }
}

/** Updates a saved chat's display name without touching its transcript. Used
 *  when the opening prompt is edited and resent so the past-chats list keeps
 *  describing the conversation the user actually sees. */
export function renameConversation(memoryKey: string, id: string, title: string): void {
  if (typeof localStorage === "undefined") return;
  const normalized = title.trim().replace(/\s+/g, " ");
  if (!normalized) return;
  try {
    const current = listConversations(memoryKey);
    const existing = current.find((conversation) => conversation.id === id);
    if (!existing) return;
    const boundedTitle = normalized.length > MAX_TITLE_CHARS
      ? `${normalized.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`
      : normalized;
    writeConversations(memoryKey, current.map((conversation) => (
      conversation.id === id
        ? { ...conversation, title: boundedTitle, updatedAt: Date.now() }
        : conversation
    )));
  } catch {
    // The active in-memory chat remains usable if browser storage is full.
  }
}

export function deleteConversation(memoryKey: string, id: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    writeConversations(memoryKey, listConversations(memoryKey).filter((conversation) => conversation.id !== id));
    if (getActiveConversationId(memoryKey) === id) {
      localStorage.removeItem(storageKey(ACTIVE_CONVERSATION_PREFIX, memoryKey));
    }
  } catch {
    // Nothing else to do when browser storage is unavailable.
  }
}

/**
 * Fold conversations written by pre-project builds (which keyed chat storage
 * by the active `.asc` path) into the project's shared chat history. The
 * source is intentionally retained so downgrading Tau cannot destroy it.
 * Existing destination rows win only when they are newer, and the source's
 * active thread becomes active only when the project has no active thread.
 */
export function mergeConversationHistory(fromKey: string, projectKey: string): void {
  if (typeof localStorage === "undefined" || !fromKey || !projectKey || fromKey === projectKey) return;
  try {
    const source = listConversations(fromKey);
    if (source.length === 0) return;
    const destination = listConversations(projectKey);
    const merged = new Map(destination.map((conversation) => [conversation.id, conversation]));
    let changed = false;
    for (const conversation of source) {
      const existing = merged.get(conversation.id);
      if (!existing || conversation.updatedAt > existing.updatedAt) {
        merged.set(conversation.id, conversation);
        changed = true;
      }
    }
    if (changed) writeConversations(projectKey, [...merged.values()]);
    if (!getActiveConversationId(projectKey)) {
      const sourceActive = getActiveConversationId(fromKey);
      if (sourceActive && merged.has(sourceActive)) setActiveConversationId(projectKey, sourceActive);
    }
  } catch {
    // Migration is best-effort; neither the source nor live transcript changes.
  }
}

/** Copies an active (or explicitly identified) conversation from one circuit
 *  memoryKey onto another and points the destination's active-id at it.
 *  Used when an assistant Create remounts AssistantPanel under a new
 *  file/title key so the chat that produced the circuit is not wiped.
 *  No-ops when keys match, the source thread is missing/empty, or storage
 *  is unavailable. Returns the migrated conversation id, or null. */
export function migrateConversation(
  fromKey: string,
  toKey: string,
  conversationId?: string | null,
): string | null {
  if (typeof localStorage === "undefined") return null;
  if (fromKey === toKey) return conversationId ?? getActiveConversationId(fromKey);
  const id = conversationId ?? getActiveConversationId(fromKey);
  if (!id) return null;
  const source = loadConversation(fromKey, id);
  if (!source || source.messages.length === 0) return null;
  try {
    const current = listConversations(toKey);
    const existing = current.find((conversation) => conversation.id === id);
    const next: AssistantConversation = {
      id: source.id,
      title: existing?.title ?? source.title,
      createdAt: existing?.createdAt ?? source.createdAt,
      updatedAt: Date.now(),
      messages: boundPersistedMessages(source.messages),
    };
    writeConversations(toKey, [...current.filter((conversation) => conversation.id !== id), next]);
    setActiveConversationId(toKey, id);
    return id;
  } catch {
    return null;
  }
}
