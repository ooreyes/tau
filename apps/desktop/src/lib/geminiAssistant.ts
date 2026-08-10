/**
 * Google Gemini via its OpenAI-compatible chat-completions endpoint. Tau reuses
 * the shared OpenAI-shaped machinery in openAiCompatibleAssistant.ts rather than
 * adding a second SDK, so Gemini inherits the same catalog-grounded system
 * prompt, the same strict plan compiler, the same bounded inspect round-trips,
 * and the same plan-repair loop as the on-device provider.
 *
 * Why Gemini specifically: its free tier needs no credit card, which is the
 * only cloud path a student can use. The key is the user's own and lives in the
 * OS keychain; native HTTPS attaches it inside Rust — Tau never proxies billing
 * and the renderer never holds the raw key for API calls.
 */
import { isTauri } from "@tauri-apps/api/core";
import {
  AssistantProviderError,
  type AssistantProviderReply,
  type AssistantProviderRequest,
} from "./assistantProvider";
import { createCloudAiFetch } from "./cloudAiFetch";
import { cloudAiConsentRefusal } from "./cloudAiConsent";
import {
  GEMINI_DEFAULT_MODEL,
  GEMINI_MODEL_PRESETS,
  type GeminiModelPreset,
} from "./geminiModels";
import {
  OpenAiCompatibleAssistant,
  type ChatProviderProfile,
  type OpenAiCompatibleAssistantOptions,
} from "./openAiCompatibleAssistant";

export { GEMINI_DEFAULT_MODEL, GEMINI_MODEL_PRESETS } from "./geminiModels";
export type { GeminiModelPreset } from "./geminiModels";

/** Google's OpenAI-compatibility shim. Pinned in the Tauri CSP connect-src
 *  historically; native desktop now routes via Rust so the renderer CSP no
 *  longer needs the Google host. */
const GEMINI_CHAT_COMPLETIONS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

export const GEMINI_REQUEST_TIMEOUT_MS = 3 * 60_000;
function resolveGeminiModel(model: string): string {
  if (model in GEMINI_MODEL_PRESETS) return GEMINI_MODEL_PRESETS[model as GeminiModelPreset].model;
  return model.replace(/^custom:/, "");
}

function geminiWording(): ChatProviderProfile["wording"] {
  return {
    subject: "Gemini model",
    unreachable: () =>
      "Tau could not reach Google's Gemini API. Check your network connection and try again.",
    httpStatus: (status) => {
      if (status === 400) {
        return "Gemini rejected the request as malformed (HTTP 400). If you set a custom model name, check its spelling.";
      }
      if (status === 401 || status === 403) {
        return "Gemini rejected the API key (HTTP "
          + status
          + "). Check the key in Settings; create one free at aistudio.google.com/apikey.";
      }
      if (status === 404) {
        return "Gemini does not recognize that model (HTTP 404). Pick a listed model in Settings, or correct the custom name.";
      }
      if (status === 429) {
        return "Gemini rate-limited this key (HTTP 429). The free tier has a daily request cap - wait and retry, or switch to the on-device model.";
      }
      if (status >= 500) {
        return `Gemini reported a server error (HTTP ${status}). This is on Google's side; retry shortly.`;
      }
      return `Gemini returned HTTP ${status}.`;
    },
    invalidJson: () => "Gemini returned invalid JSON.",
    timedOut: (seconds) =>
      `Gemini made no complete reply within ${seconds} seconds. Tau stopped the request.`,
    aborted: () => "The Gemini request was stopped.",
    failed: () => "The Gemini request failed.",
  };
}

/** Native profile: no auth headers — Rust attaches the keychain Bearer token. */
export function geminiNativeProfile(): ChatProviderProfile {
  return {
    id: "gemini",
    endpoint: GEMINI_CHAT_COMPLETIONS_ENDPOINT,
    maxTokens: 8192,
    timeoutMs: GEMINI_REQUEST_TIMEOUT_MS,
    resolveModel: resolveGeminiModel,
    authHeaders: () => ({}),
    sendChatTemplateKwargs: false,
    sendParallelToolCallsFlag: false,
    thinkingMarker: "",
    assistantLabel: "circuit assistant",
    allowTextToolFallback: false,
    wording: geminiWording(),
  };
}

/** Web/test profile that still puts Bearer on the request (injected fetch). */
export function geminiProfile(apiKey: string): ChatProviderProfile {
  return {
    ...geminiNativeProfile(),
    authHeaders: () => ({ Authorization: `Bearer ${apiKey}` }),
  };
}

export interface GeminiAssistantOptions extends OpenAiCompatibleAssistantOptions {
  /** Required for web/test when not using the native keychain proxy. */
  apiKey?: string;
  model?: GeminiModelPreset | string;
}

/** Hosted Gemini provider. Returns proposals only; every file/canvas mutation
 *  still requires the user's explicit confirmation outside this interface. */
export class GeminiAssistant extends OpenAiCompatibleAssistant {
  constructor(options: GeminiAssistantOptions = {}) {
    const useNativeProxy = isTauri() && !options.fetchImpl;
    const profile = useNativeProxy
      ? geminiNativeProfile()
      : geminiProfile(options.apiKey ?? "");
    super(profile, {
      ...options,
      model: options.model ?? GEMINI_DEFAULT_MODEL,
      fetchImpl: options.fetchImpl ?? (useNativeProxy ? createCloudAiFetch("gemini") : undefined),
    });
  }

  override async complete(
    request: AssistantProviderRequest,
    signal?: AbortSignal,
  ): Promise<AssistantProviderReply> {
    const refusal = cloudAiConsentRefusal();
    if (refusal) throw new AssistantProviderError("unknown", refusal);
    return super.complete(request, signal);
  }
}
