/**
 * The on-device provider: Tau-managed MLX inference speaking OpenAI chat
 * completions on a fixed private endpoint. Everything except the profile below
 * lives in openAiCompatibleAssistant.ts and is shared with the hosted Gemini
 * path, so the system prompt, tool wiring, and plan-repair loop can never drift
 * apart. Student-facing wording never mentions localhost, ports, or how to
 * start a server — Settings / LocalAiSetupDialog own ensure→download→load.
 */
import {
  OpenAiCompatibleAssistant,
  type ChatProviderProfile,
  type OpenAiCompatibleAssistantOptions,
} from "./openAiCompatibleAssistant";

export const LOCAL_MLX_MODEL_PRESETS = {
  "qwen3-1.7b-4bit": {
    label: "Qwen3 1.7B",
    model: "Qwen/Qwen3-1.7B-MLX-4bit",
  },
  "qwen3-4b-4bit": {
    label: "Qwen3 4B",
    model: "Qwen/Qwen3-4B-MLX-4bit",
  },
} as const;

export type LocalMlxModelPreset = keyof typeof LOCAL_MLX_MODEL_PRESETS;

const CHAT_COMPLETIONS_ENDPOINT = "http://127.0.0.1:8080/v1/chat/completions";
export const LOCAL_MLX_REQUEST_TIMEOUT_MS = 2 * 60_000;
export const LOCAL_MLX_DEFAULT_MODEL: LocalMlxModelPreset = "qwen3-4b-4bit";

export const LOCAL_MLX_PROFILE: ChatProviderProfile = {
  id: "local-mlx",
  endpoint: CHAT_COMPLETIONS_ENDPOINT,
  // Keep the request within the native server's fixed generation ceiling.
  maxTokens: 4096,
  timeoutMs: LOCAL_MLX_REQUEST_TIMEOUT_MS,
  resolveModel: (model) => (
    model in LOCAL_MLX_MODEL_PRESETS
      ? LOCAL_MLX_MODEL_PRESETS[model as LocalMlxModelPreset].model
      : model.replace(/^custom:/, "")
  ),
  sendChatTemplateKwargs: true,
  sendParallelToolCallsFlag: true,
  // Qwen3 emits a <think> block unless suppressed at both ends of the prompt.
  thinkingMarker: " /no_think",
  assistantLabel: "local circuit assistant",
  // Some MLX/Qwen combinations report finish_reason=tool_calls while dropping
  // message.tool_calls, so the bare-JSON fallback is genuinely needed here.
  allowTextToolFallback: true,
  wording: {
    // Student-facing copy: never mention localhost, ports, or server plumbing.
    subject: "on-device AI",
    unreachable: () => "On-device AI is not ready. Start it and try again.",
    httpStatus: (status) =>
      `On-device AI returned an unexpected response (HTTP ${status}). Try again in a moment.`,
    invalidJson: () => "On-device AI returned an invalid reply. Try again.",
    timedOut: (seconds) =>
      `On-device AI made no complete reply within ${seconds} seconds. Tau stopped the request.`,
    aborted: () => "The on-device AI request was stopped.",
    failed: () => "The on-device AI request failed.",
  },
};

export interface LocalMlxAssistantOptions extends OpenAiCompatibleAssistantOptions {
  model?: LocalMlxModelPreset | string;
}

/** OpenAI-compatible, non-streaming MLX provider. It returns proposals only;
 * file/canvas mutation remains entirely outside this interface. */
export class LocalMlxAssistant extends OpenAiCompatibleAssistant {
  constructor(options: LocalMlxAssistantOptions = {}) {
    super(LOCAL_MLX_PROFILE, { ...options, model: options.model ?? LOCAL_MLX_DEFAULT_MODEL });
  }
}
