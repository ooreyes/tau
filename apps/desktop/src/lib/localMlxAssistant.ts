/**
 * The on-device provider: a loopback MLX server speaking OpenAI chat
 * completions. Everything except the profile below lives in
 * openAiCompatibleAssistant.ts and is shared with the hosted Gemini path, so
 * the system prompt, tool wiring, and plan-repair loop can never drift apart.
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
    subject: "local model",
    unreachable: () => "Tau could not reach the local MLX server at 127.0.0.1. Start it and try again.",
    httpStatus: (status) =>
      `The local MLX server returned HTTP ${status}. Check that its OpenAI-compatible endpoint is running.`,
    invalidJson: () => "The local MLX server returned invalid JSON.",
    timedOut: (seconds) =>
      `The local MLX server made no complete reply within ${seconds} seconds. Tau stopped the request.`,
    aborted: () => "The local assistant request was stopped.",
    failed: () => "The local assistant request failed.",
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
