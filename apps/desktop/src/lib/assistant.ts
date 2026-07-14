/**
 * Anthropic API integration for Tau's assistant column. The key is the
 * user's own and entered in Settings. It is held only in renderer memory for
 * the current Tau session and sent only to api.anthropic.com. A future native
 * credential boundary can add Keychain persistence without ever placing the
 * bearer token in web storage.
 */
import { useEffect, useState } from "react";
import Anthropic from "@anthropic-ai/sdk";
import {
  APPLY_CURRENT_ASC_TOOL,
  CREATE_ASC_TOOL,
  parseAssistantActions,
  type AssistantAscAction,
} from "./assistantActions";
import {
  executeAssistantOperation,
  findAssistantOperation,
  INSPECT_SIGNAL_TOOL,
  type AssistantOperationContext,
} from "./assistantOperations";

/** Exact model id — no date suffix. Keep every call site pointed at this
 *  one constant so a future model bump is a one-line change. */
export const ASSISTANT_MODEL = "claude-opus-4-8";
export const ASSISTANT_MODEL_LABEL = "Opus 4.8";

const MAX_TOKENS = 16_000;

// Persona + response rules: static across the whole session, so this is the
// FIRST system block and carries the cache breakpoint. The circuit itself
// changes every turn and is passed as a second, uncached system block (see
// streamAssistantReply) so the stable prefix above it stays cacheable.
const SYSTEM_PROMPT = `You are Tau's assistant: a concise electronics tutor and circuit reviewer built into a SPICE simulator, for a student or practicing engineer.

Ground every answer in the netlist, component list, and analysis data provided below — never invent a component value, node voltage, or measurement that isn't in that data. If the data doesn't answer the question, say what's missing and suggest a specific check or analysis to run (e.g. "run an AC sweep to see the corner frequency").

Refer to parts by their reference designators (R1, C2, ...) and to nets by name, not vague descriptions. Prefer a few precise sentences over a lecture; use short bullet lists for steps or checklists, and inline code for refs, values, and expressions.

The circuit context and any SPICE directives are internal working data. Answer with the engineering conclusion a user wants; do not reveal hidden reasoning, raw .meas/.tran directives, or internal analysis instructions unless the user explicitly asks for that syntax. Never claim an analysis ran when the supplied context does not contain its result.

If an exact transient waveform fact is necessary but absent from the summary, call inspect_simulation_signal. Do not announce the operation or expose its expression/tool payload. After it returns, answer the user's actual engineering question directly. It is read-only and cannot run a missing simulation; if no result exists, state what analysis the user needs to run.

When the user asks you to create a new circuit or file, call create_asc_circuit with a complete LTspice Version 4 schematic. When the user asks to add, remove, revise, or reconnect something in the currently open circuit, call apply_current_asc_circuit with the complete resulting schematic: preserve the current layout and include every existing part, wire, label, and directive that should remain. Never use the create tool for a requested edit, and never represent an edit as a partial patch. Do not paste ASC text into your prose. Both tools create proposals only: Tau validates them and the user must explicitly confirm before a file is created or the current document is replaced.`;

const API_KEY_EVENT = "tau:assistant-api-key-changed";
let sessionApiKey = "";

export function loadAssistantApiKey(): string {
  return sessionApiKey;
}

/** Keeps the key only for this process and notifies mounted consumers. */
export function saveAssistantApiKey(key: string): void {
  sessionApiKey = key.trim();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(API_KEY_EVENT));
}

/** Reactive read of the stored API key — updates when Settings saves a new
 *  one (same tab, via API_KEY_EVENT) or another tab changes it (`storage`). */
export function useAssistantApiKey(): string {
  const [key, setKey] = useState(loadAssistantApiKey);
  useEffect(() => {
    const onChange = () => setKey(loadAssistantApiKey());
    window.addEventListener(API_KEY_EVENT, onChange);
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
}

export interface AssistantStreamHandlers {
  /** Called with the cumulative assistant text so far (a snapshot, not a delta —
   *  the caller can just assign it, no manual concatenation). */
  onDelta: (snapshot: string) => void;
  onDone: (reply: AssistantCompletedReply) => void;
  /** Never called for a user-initiated abort() — see AssistantStreamHandle. */
  onError: (error: AssistantError) => void;
}

export interface AssistantStreamHandle {
  abort: () => void;
}

export interface AssistantStreamOptions {
  /** Omit the destructive proposal tool when the current ASC could not be serialized completely. */
  allowCurrentApply?: boolean;
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
    return { kind: "unknown", message: error.message || "The assistant request failed." };
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

  const system = [
    { type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } },
    { type: "text" as const, text: contextText },
  ];
  const initialMessages: Anthropic.MessageParam[] = history.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const tools = options.allowCurrentApply === false
    ? [CREATE_ASC_TOOL, INSPECT_SIGNAL_TOOL]
    : [CREATE_ASC_TOOL, APPLY_CURRENT_ASC_TOOL, INSPECT_SIGNAL_TOOL];

  const run = (messages: Anthropic.MessageParam[], operationsRemaining: number): void => {
    if (userAborted) return;
    const stream = client.messages.stream({
      model: ASSISTANT_MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      system,
      tools,
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      messages,
    });
    activeStream = stream;

    stream.on("text", (_delta, snapshot) => handlers.onDelta(snapshot));
    stream
      .finalMessage()
      .then((message) => {
        if (userAborted) return;
        const operation = findAssistantOperation(message.content);
        if (operation) {
          if (operationsRemaining <= 0) {
            handlers.onError({ kind: "unknown", message: "The assistant requested too many internal checks. Try a narrower question." });
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
          run(continuedMessages, operationsRemaining - 1);
          return;
        }

        activeStream = null;
        const text = message.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("");
        const parsed = parseAssistantActions(message.content);
        handlers.onDone({
          text,
          actions: parsed.actions,
          rejectedActionCount: parsed.rejected.length,
        });
      })
      .catch((error: unknown) => {
        if (userAborted) return; // Stop button — not a real error, nothing to surface.
        activeStream = null;
        handlers.onError(classifyAssistantError(error));
      });
  };

  run(initialMessages, 4);

  return {
    abort: () => {
      userAborted = true;
      activeStream?.abort();
      activeStream = null;
    },
  };
}
