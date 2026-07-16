/**
 * Anthropic API integration for Tau's assistant column. The key is the
 * user's own and entered in Settings. Native Tau stores it in the operating
 * system keychain; it is never placed in web storage or a project file.
 */
import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import Anthropic from "@anthropic-ai/sdk";
import {
  APPLY_CURRENT_ASC_TOOL,
  parseAssistantActions,
  type AssistantAscAction,
} from "./assistantActions";
import {
  ASSISTANT_CATALOG_PROMPT,
  GOLDEN_TWO_BIT_REGISTER_PLAN,
  compileAssistantCircuitPlan,
  GOLDEN_CLASS_D_ASSISTANT_PLAN,
  TAU_CIRCUIT_PLAN_TOOL,
  TAU_CIRCUIT_PLAN_TOOL_NAME,
} from "./assistantCircuitPlan";
import {
  executeAssistantOperation,
  findAssistantOperation,
  INSPECT_SIGNAL_TOOL,
  type AssistantOperationContext,
} from "./assistantOperations";
import type { AssistantRunMetrics } from "./assistantProvider";

/** Exact model id — no date suffix. Keep every call site pointed at this
 *  one constant so a future model bump is a one-line change.
 *  Sonnet 5 is the capable cheap default for Tau's Anthropic path
 *  (cheaper than Opus, strong enough for circuit Q&A + tool use). */
export const ASSISTANT_MODEL = "claude-sonnet-5";
export const ASSISTANT_MODEL_LABEL = "Sonnet 5";

export const ASSISTANT_MAX_OUTPUT_TOKENS = 6_000;
export const ASSISTANT_QUESTION_MAX_OUTPUT_TOKENS = 2_500;
export const ASSISTANT_CONNECT_TIMEOUT_MS = 45_000;
export const ASSISTANT_REQUEST_TIMEOUT_MS = 90_000;
export const ASSISTANT_QUESTION_TIMEOUT_MS = 60_000;
export const ASSISTANT_HISTORY_MESSAGE_LIMIT = 12;
export const ASSISTANT_HISTORY_CHAR_LIMIT = 12_000;

/** Anthropic uses the inner function schema directly, while the local
 * OpenAI-compatible provider uses TAU_CIRCUIT_PLAN_TOOL's outer wrapper. */
function anthropicSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(anthropicSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      // Anthropic strict tools use a structured-output subset that rejects
      // array cardinality keywords. Tau's local compiler still enforces the
      // original 80-part/160-net bounds after the call.
      .filter(([key]) => key !== "minItems" && key !== "maxItems")
      .map(([key, nested]) => [key, anthropicSchema(nested)]),
  );
}

const CLOUD_CIRCUIT_PLAN_TOOL = {
  name: TAU_CIRCUIT_PLAN_TOOL.function.name,
  description: TAU_CIRCUIT_PLAN_TOOL.function.description,
  strict: true,
  input_schema: anthropicSchema(TAU_CIRCUIT_PLAN_TOOL.function.parameters) as Anthropic.Tool.InputSchema,
} satisfies Anthropic.Tool;

// Persona + response rules: static across the whole session, so this is the
// FIRST system block and carries the cache breakpoint. The circuit itself
// changes every turn and is passed as a second, uncached system block (see
// streamAssistantReply) so the stable prefix above it stays cacheable.
const SYSTEM_PROMPT = `You are Tau's assistant: a concise electronics tutor and circuit reviewer built into a SPICE simulator, for a student or practicing engineer.

Ground every answer in the netlist, component list, and analysis data provided below — never invent a component value, node voltage, or measurement that isn't in that data. If the data doesn't answer the question, say what's missing and suggest a specific check or analysis to run (e.g. "run an AC sweep to see the corner frequency").

Refer to parts by their reference designators (R1, C2, ...) and to nets by name, not vague descriptions. Prefer a few precise sentences over a lecture; use short bullet lists for steps or checklists, and inline code for refs, values, and expressions.

The circuit context and any SPICE directives are internal working data. Answer with the engineering conclusion a user wants; do not reveal hidden reasoning, raw .meas/.tran directives, or internal analysis instructions unless the user explicitly asks for that syntax. Never claim an analysis ran when the supplied context does not contain its result.

If an exact transient waveform fact is necessary but absent from the summary, call inspect_simulation_signal. Do not announce the operation or expose its expression/tool payload. After it returns, answer the user's actual engineering question directly. It is read-only and cannot run a missing simulation; if no result exists, state what analysis the user needs to run.

When a build request omits values you need (source voltage, resistance, frequency, load), do not guess silently: if one conventional default is obvious, build with it and state the assumption in one sentence; if the request is genuinely ambiguous (for example just "a voltage source" or "a short"), ask one brief clarifying question instead of calling a tool.

When the user asks you to create a new circuit or file, call ${TAU_CIRCUIT_PLAN_TOOL_NAME}. Never write ASC, coordinates, or wire geometry for a new circuit: return only library parts and exact ref.pin nets. Tau deterministically validates, lays out, routes, and serializes that compact plan. Use mode=create and include a safe .asc filename. Every physical pin must appear in exactly one net, and every circuit needs a 0 ground net. Source values use portable LTspice syntax, for example vsource value "5", "SINE(0 1 1k)", or "PULSE(0 5 0 1n 1n 5u 10u)". State conventional defaults briefly in prose.

Tau generation catalog (only these kinds and pin ids are legal):
${JSON.stringify(ASSISTANT_CATALOG_PROMPT)}

For a supported Class-D approximation, follow this known-good topology instead of inventing gate-driver pins:
${JSON.stringify(GOLDEN_CLASS_D_ASSISTANT_PLAN)}

For D flip-flops, PRE and CLR are active-high: connect unused pre/clr and com to 0, never VDD. For a requested 2-bit 01→11→10 register, follow this native-ngspice-verified plan:
${JSON.stringify(GOLDEN_TWO_BIT_REGISTER_PLAN)}

When the user asks to add, remove, revise, or reconnect something in the currently open circuit, call apply_current_asc_circuit with the complete resulting schematic: preserve the current layout and include every existing part, wire, label, and directive that should remain. Never use a new-file plan for a requested edit, and never represent an edit as a partial patch. Do not paste plan JSON or ASC text into your prose. Both tools create proposals only: Tau validates them and the user must explicitly confirm before a file is created or the current document is replaced.

Extended thinking adds latency and cost. Use it only when it materially improves a multi-stage circuit decision; ordinary questions and small library plans should be answered directly.`;

const API_KEY_EVENT = "tau:assistant-api-key-changed";
let sessionApiKey = "";
let credentialHydration: Promise<void> | null = null;
let credentialSaveTimer: ReturnType<typeof setTimeout> | null = null;
let credentialRevision = 0;

export function loadAssistantApiKey(): string {
  return sessionApiKey;
}

function notifyApiKeyChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(API_KEY_EVENT));
}

/** Hydrates once per renderer lifetime from the native credential boundary. */
export function hydrateAssistantApiKey(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  if (!credentialHydration) {
    const revisionAtStart = credentialRevision;
    credentialHydration = invoke<string | null>("load_assistant_api_key")
      .then((key) => {
        // A user edit made while the native read was in flight wins.
        if (credentialRevision !== revisionAtStart) return;
        sessionApiKey = key?.trim() ?? "";
        notifyApiKeyChanged();
      })
      .catch(() => {
        // The assistant stays usable for a key entered during this session.
      });
  }
  return credentialHydration;
}

/** Updates this process immediately and debounces a native keychain write. */
export function saveAssistantApiKey(key: string): void {
  sessionApiKey = key.trim();
  credentialRevision += 1;
  notifyApiKeyChanged();
  if (!isTauri()) return;
  if (credentialSaveTimer) globalThis.clearTimeout(credentialSaveTimer);
  credentialSaveTimer = globalThis.setTimeout(() => {
    credentialSaveTimer = null;
    const apiKey = sessionApiKey;
    void invoke("save_assistant_api_key", { apiKey }).catch(() => {
      // Settings remains responsive; a later edit retries the keychain write.
    });
  }, 350);
}

/** Reactive read of the stored API key — updates when Settings saves a new
 *  one (same tab, via API_KEY_EVENT) or another tab changes it (`storage`). */
export function useAssistantApiKey(): string {
  const [key, setKey] = useState(loadAssistantApiKey);
  useEffect(() => {
    const onChange = () => setKey(loadAssistantApiKey());
    window.addEventListener(API_KEY_EVENT, onChange);
    void hydrateAssistantApiKey();
    return () => window.removeEventListener(API_KEY_EVENT, onChange);
  }, []);
  return key;
}

export type AssistantErrorKind = "auth" | "rate_limit" | "network" | "invalid_action" | "unknown";

export interface AssistantError {
  kind: AssistantErrorKind;
  message: string;
}

export interface AssistantChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantCompletedReply {
  /** User-visible prose only; thinking and tool payloads are never included. */
  text: string;
  /** Validated actions which still require an explicit user confirmation. */
  actions: AssistantAscAction[];
  /** Count only: raw validation details stay out of the ordinary transcript. */
  rejectedActionCount: number;
  metrics?: AssistantRunMetrics;
}

export interface AssistantStreamHandlers {
  /** Called with the cumulative assistant text so far (a snapshot, not a delta —
   *  the caller can just assign it, no manual concatenation). */
  onDelta: (snapshot: string) => void;
  onDone: (reply: AssistantCompletedReply) => void;
  /** Coarse, non-sensitive lifecycle only; never exposes hidden reasoning. */
  onProgress?: (phase: AssistantProgressPhase) => void;
  /** Never called for a user-initiated abort() — see AssistantStreamHandle. */
  onError: (error: AssistantError) => void;
}

export type AssistantProgressPhase =
  | "connecting"
  | "reasoning"
  | "drafting"
  | "inspecting"
  | "validating"
  | "repairing"
  | "responding";

export interface AssistantStreamHandle {
  abort: () => void;
}

export interface AssistantStreamOptions {
  /** Omit the destructive proposal tool when the current ASC could not be serialized completely. */
  allowCurrentApply?: boolean;
}

/** Mutation turns get the larger design budget and plan/edit tools. Ordinary
 * questions get a low-effort, read-only path so "Explain results" cannot
 * accidentally spend a minute drafting another schematic. */
export function assistantRequestIsMutation(request: string): boolean {
  return /\b(?:create|build|design|generate|draw|draft|make|prepare|add|insert|remove|delete|change|edit|revise|replace|reconnect|rewire|rename|move|rotate|mirror|fix|update|set)\b/i.test(request);
}

export function assistantRequestTimeoutMs(request: string): number {
  return assistantRequestIsMutation(request) ? ASSISTANT_REQUEST_TIMEOUT_MS : ASSISTANT_QUESTION_TIMEOUT_MS;
}

/** Provider history remains useful without allowing a long UI transcript to
 * become an unbounded recurring API bill. Always retain the newest user turn,
 * then fill backward within both message and character budgets. */
export function compactAssistantHistory(
  history: readonly AssistantChatMessage[],
): AssistantChatMessage[] {
  const selected: AssistantChatMessage[] = [];
  let chars = 0;
  for (let index = history.length - 1; index >= 0 && selected.length < ASSISTANT_HISTORY_MESSAGE_LIMIT; index -= 1) {
    const message = history[index];
    const remaining = ASSISTANT_HISTORY_CHAR_LIMIT - chars;
    if (remaining <= 0) break;
    if (selected.length > 0 && message.content.length > remaining) break;
    const content = message.content.slice(0, remaining);
    selected.push({ ...message, content });
    chars += content.length;
  }
  selected.reverse();
  while (selected[0]?.role === "assistant") selected.shift();
  return selected;
}

interface ParsedCloudActions {
  actions: AssistantAscAction[];
  rejected: string[];
  rejectedToolUses: Array<{ id: string; error: string }>;
}

function toolUseRecord(value: unknown): { id: string; name: string; input: unknown } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const block = value as Record<string, unknown>;
  if (block.type !== "tool_use" || typeof block.id !== "string" || typeof block.name !== "string") return null;
  return { id: block.id, name: block.name, input: block.input };
}

/** Parse the compact deterministic plan tool alongside the legacy exact-ASC
 * current-document edit tool. At most one mutation proposal may survive. */
function parseCloudActions(content: readonly unknown[]): ParsedCloudActions {
  const actions: AssistantAscAction[] = [];
  const rejected: string[] = [];
  const rejectedToolUses: Array<{ id: string; error: string }> = [];
  for (const block of content) {
    const call = toolUseRecord(block);
    if (!call) continue;
    if (call.name === TAU_CIRCUIT_PLAN_TOOL_NAME) {
      try {
        if (actions.length > 0) throw new Error("Only one circuit change can be proposed in a turn.");
        actions.push(compileAssistantCircuitPlan(call.id, call.input));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid logical circuit plan.";
        rejected.push(message);
        rejectedToolUses.push({ id: call.id, error: message });
      }
      continue;
    }
    const direct = parseAssistantActions([block]);
    if (direct.actions.length > 0 && actions.length > 0) {
      const message = "Only one circuit change can be proposed in a turn.";
      rejected.push(message);
      rejectedToolUses.push({ id: call.id, error: message });
    } else {
      actions.push(...direct.actions);
      rejected.push(...direct.rejected);
      rejectedToolUses.push(...direct.rejectedToolUses);
    }
  }
  return { actions, rejected, rejectedToolUses };
}

function classifyAssistantError(error: unknown): AssistantError {
  if (error instanceof Anthropic.AuthenticationError) {
    return { kind: "auth", message: "Authentication failed. Check your API key in Settings." };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { kind: "rate_limit", message: "Rate limited — try again shortly." };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { kind: "network", message: "Couldn't reach Anthropic. Check your connection and try again." };
  }
  if (error instanceof Anthropic.APIError) {
    return error.status !== undefined && error.status >= 500
      ? { kind: "network", message: "Anthropic's assistant service is temporarily unavailable. Retry shortly." }
      : { kind: "unknown", message: "Anthropic rejected the assistant request. Retry once; if it repeats, update Tau." };
  }
  return { kind: "unknown", message: error instanceof Error ? error.message : "Something went wrong." };
}

/**
 * Starts a streamed reply for one turn. `contextText` is the freshly-built
 * circuit context (lib/assistantContext.ts) for THIS send; `history` is the
 * running conversation including the just-added user turn — the API is
 * stateless, so the full history goes on every call.
 */
export function streamAssistantReply(
  apiKey: string,
  contextText: string,
  history: readonly AssistantChatMessage[],
  handlers: AssistantStreamHandlers,
  operationContext?: AssistantOperationContext,
  options: AssistantStreamOptions = {},
): AssistantStreamHandle {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  let userAborted = false;
  let activeStream: { abort: () => void } | null = null;
  let clearActiveDeadline = () => {};
  let terminal = false;
  const startedAt = Date.now();
  let attempts = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;

  const system = [
    { type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } },
    { type: "text" as const, text: contextText },
  ];
  const initialMessages: Anthropic.MessageParam[] = compactAssistantHistory(history).map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const requestText = [...history].reverse().find((message) => message.role === "user")?.content ?? "";
  const mutationRequest = assistantRequestIsMutation(requestText);
  const requestTimeoutMs = assistantRequestTimeoutMs(requestText);
  const tools = mutationRequest
    ? options.allowCurrentApply === false
      ? [CLOUD_CIRCUIT_PLAN_TOOL, INSPECT_SIGNAL_TOOL]
      : [CLOUD_CIRCUIT_PLAN_TOOL, APPLY_CURRENT_ASC_TOOL, INSPECT_SIGNAL_TOOL]
    : [INSPECT_SIGNAL_TOOL];

  let overallTimer: ReturnType<typeof setTimeout> | null = null;
  const clearOverallTimer = () => {
    if (overallTimer) globalThis.clearTimeout(overallTimer);
    overallTimer = null;
  };
  const finishWithError = (error: AssistantError) => {
    if (terminal || userAborted) return;
    terminal = true;
    clearOverallTimer();
    clearActiveDeadline();
    activeStream?.abort();
    activeStream = null;
    handlers.onError(error);
  };
  const finishWithReply = (reply: Omit<AssistantCompletedReply, "metrics">) => {
    if (terminal || userAborted) return;
    terminal = true;
    clearOverallTimer();
    clearActiveDeadline();
    activeStream = null;
    handlers.onDone({
      ...reply,
      metrics: {
        durationMs: Date.now() - startedAt,
        attempts,
        inputTokens,
        outputTokens,
        cacheCreationInputTokens,
        cacheReadInputTokens,
      },
    });
  };
  overallTimer = globalThis.setTimeout(() => {
    finishWithError({
      kind: "network",
      message: mutationRequest
        ? "Tau stopped Sonnet after 90 seconds. No file was created. Retry the build or simplify the request."
        : "Tau stopped Sonnet after 60 seconds. Any partial answer remains above; retry the analysis if needed.",
    });
  }, requestTimeoutMs);

  const run = (
    messages: Anthropic.MessageParam[],
    operationsRemaining: number,
    repairsRemaining: number,
  ): void => {
    if (userAborted || terminal) return;
    attempts += 1;
    const stream = client.messages.stream({
      model: ASSISTANT_MODEL,
      max_tokens: mutationRequest ? ASSISTANT_MAX_OUTPUT_TOKENS : ASSISTANT_QUESTION_MAX_OUTPUT_TOKENS,
      cache_control: { type: "ephemeral" },
      output_config: { effort: mutationRequest ? "medium" : "low" },
      system,
      tools,
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      messages,
    });
    activeStream = stream;

    let requestSettled = false;
    let connectTimer: ReturnType<typeof setTimeout> | null = globalThis.setTimeout(() => {
      connectTimer = null;
      if (userAborted || requestSettled || activeStream !== stream) return;
      requestSettled = true;
      finishWithError({
        kind: "network",
        message: "Sonnet didn't start responding within 45 seconds. Tau stopped the request — retry when your connection is stable.",
      });
    }, ASSISTANT_CONNECT_TIMEOUT_MS);
    const clearDeadline = () => {
      if (connectTimer) globalThis.clearTimeout(connectTimer);
      connectTimer = null;
    };
    clearActiveDeadline = clearDeadline;
    const markConnected = () => clearDeadline();

    stream.on("thinking", () => {
      markConnected();
      handlers.onProgress?.("reasoning");
    });
    stream.on("streamEvent", (event) => {
      markConnected();
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        handlers.onProgress?.(event.content_block.name === INSPECT_SIGNAL_TOOL.name ? "inspecting" : "drafting");
      }
    });
    stream.on("text", (_delta, snapshot) => {
      markConnected();
      handlers.onProgress?.("responding");
      handlers.onDelta(snapshot);
    });
    stream
      .finalMessage()
      .then((message) => {
        if (userAborted || terminal || requestSettled) return;
        requestSettled = true;
        clearDeadline();
        inputTokens += message.usage?.input_tokens ?? 0;
        outputTokens += message.usage?.output_tokens ?? 0;
        cacheCreationInputTokens += message.usage?.cache_creation_input_tokens ?? 0;
        cacheReadInputTokens += message.usage?.cache_read_input_tokens ?? 0;
        const operation = findAssistantOperation(message.content);
        if (operation) {
          if (operationsRemaining <= 0) {
            finishWithError({ kind: "unknown", message: "The assistant requested too many internal checks. Try a narrower question." });
            return;
          }
          const result = operationContext
            ? executeAssistantOperation(operation, operationContext)
            : { ok: false, content: JSON.stringify({ ok: false, error: "No simulation snapshot is available." }) };
          // Any intermediate prose (for example, “let me check”) is replaced;
          // the ordinary transcript receives only the final engineering answer.
          handlers.onDelta("");
          const continuedMessages: Anthropic.MessageParam[] = [
            ...messages,
            {
              role: "assistant",
              content: message.content as Anthropic.ContentBlockParam[],
            },
            {
              role: "user",
              content: [{
                type: "tool_result",
                tool_use_id: operation.id,
                content: result.content,
                is_error: !result.ok,
              }],
            },
          ];
          run(continuedMessages, operationsRemaining - 1, repairsRemaining);
          return;
        }

        activeStream = null;
        handlers.onProgress?.("validating");
        const text = message.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("");
        const parsed = parseCloudActions(message.content);
        if (parsed.actions.length === 0 && parsed.rejectedToolUses.length > 0 && repairsRemaining > 0) {
          const rejected = parsed.rejectedToolUses[0];
          handlers.onDelta("");
          handlers.onProgress?.("repairing");
          const repairMessages: Anthropic.MessageParam[] = [
            ...initialMessages,
            {
              role: "user",
              content: `Tau rejected the prior logical circuit plan: ${rejected.error}. Regenerate one complete corrected ${TAU_CIRCUIT_PLAN_TOOL_NAME} call for the user's same request. Return no ASC or coordinates.`,
            },
          ];
          run(repairMessages, operationsRemaining, repairsRemaining - 1);
          return;
        }
        finishWithReply({
          text,
          actions: parsed.actions,
          rejectedActionCount: parsed.rejected.length,
        });
      })
      .catch((error: unknown) => {
        if (userAborted || terminal || requestSettled) return; // Stop/timeout already handled.
        requestSettled = true;
        clearDeadline();
        finishWithError(classifyAssistantError(error));
      });
  };

  handlers.onProgress?.("connecting");
  run(initialMessages, 4, 1);

  return {
    abort: () => {
      userAborted = true;
      terminal = true;
      clearOverallTimer();
      clearActiveDeadline();
      activeStream?.abort();
      activeStream = null;
    },
  };
}
