/**
 * Local tally of assistant requests, per provider.
 *
 * Tau does not proxy anyone's spending and therefore cannot know what a
 * provider charged. What it can honestly report is what this Mac sent: how
 * many requests went to each provider, when the last one was, and the token
 * counts a provider volunteered in its own response. Those counts are the
 * provider's numbers, not Tau's estimate, and are absent when the response did
 * not carry them.
 *
 * The authoritative figure is always the provider's own dashboard. The Usage
 * page says so and links there; this module exists so the page is not empty,
 * not so it can stand in for a bill.
 */
import { createPreferenceStore } from "./preferences";

export type UsageProvider = "anthropic" | "openai" | "gemini" | "local-mlx";

export interface ProviderUsage {
  /** Requests Tau sent to this provider from this Mac. */
  requests: number;
  /** Tokens the provider reported for input. Absent responses contribute nothing. */
  inputTokens: number;
  outputTokens: number;
  /** Epoch ms of the most recent request, or null if never used. */
  lastUsedAt: number | null;
}

export interface AiUsage {
  since: number;
  providers: Record<UsageProvider, ProviderUsage>;
}

export const USAGE_PROVIDERS: readonly UsageProvider[] = [
  "anthropic",
  "openai",
  "gemini",
  "local-mlx",
];

export const USAGE_PROVIDER_LABELS: Record<UsageProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Google Gemini",
  "local-mlx": "On-device",
};

function emptyProvider(): ProviderUsage {
  return { requests: 0, inputTokens: 0, outputTokens: 0, lastUsedAt: null };
}

function emptyUsage(): AiUsage {
  return {
    since: Date.now(),
    providers: {
      anthropic: emptyProvider(),
      openai: emptyProvider(),
      gemini: emptyProvider(),
      "local-mlx": emptyProvider(),
    },
  };
}

function count(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
}

function validProviderUsage(raw: unknown): ProviderUsage {
  if (!raw || typeof raw !== "object") return emptyProvider();
  const source = raw as Record<string, unknown>;
  const lastUsedAt = source.lastUsedAt;
  return {
    requests: count(source.requests),
    inputTokens: count(source.inputTokens),
    outputTokens: count(source.outputTokens),
    lastUsedAt:
      typeof lastUsedAt === "number" && Number.isFinite(lastUsedAt) && lastUsedAt > 0
        ? lastUsedAt
        : null,
  };
}

function validUsage(raw: unknown): AiUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const providers = (source.providers ?? {}) as Record<string, unknown>;
  const since = source.since;
  return {
    since: typeof since === "number" && Number.isFinite(since) && since > 0 ? since : Date.now(),
    providers: {
      anthropic: validProviderUsage(providers.anthropic),
      openai: validProviderUsage(providers.openai),
      gemini: validProviderUsage(providers.gemini),
      "local-mlx": validProviderUsage(providers["local-mlx"]),
    },
  };
}

export const aiUsage = createPreferenceStore<AiUsage>({
  key: "tau.ai.usage.v1",
  defaults: emptyUsage(),
  validate: validUsage,
  makeDefaults: emptyUsage,
});

export const loadAiUsage = aiUsage.load;
export const useAiUsage = aiUsage.use;

/** Forget every counter and restart the window at now. */
export function clearAiUsage(): void {
  aiUsage.save(emptyUsage());
}

/**
 * Record one assistant request. Token counts are optional because only some
 * providers report them, and a missing count must read as "not reported"
 * rather than as zero spend.
 */
export function recordAiRequest(
  provider: UsageProvider,
  tokens: { input?: number; output?: number } = {},
): void {
  const current = loadAiUsage();
  const previous = current.providers[provider] ?? emptyProvider();
  aiUsage.save({
    ...current,
    providers: {
      ...current.providers,
      [provider]: {
        requests: previous.requests + 1,
        inputTokens: previous.inputTokens + count(tokens.input),
        outputTokens: previous.outputTokens + count(tokens.output),
        lastUsedAt: Date.now(),
      },
    },
  });
}

/**
 * Pull token counts out of a provider response body. Anthropic reports
 * `usage.input_tokens`, the OpenAI-compatible shape reports
 * `usage.prompt_tokens`, Gemini reports `usageMetadata.promptTokenCount`.
 * Anything unrecognised yields no counts rather than a guess.
 */
export function tokensFromResponseBody(body: string): { input?: number; output?: number } {
  if (!body || body.length > 2_000_000) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const root = parsed as Record<string, unknown>;
  const usage = root.usage as Record<string, unknown> | undefined;
  const metadata = root.usageMetadata as Record<string, unknown> | undefined;
  const pick = (...candidates: unknown[]): number | undefined => {
    for (const candidate of candidates) {
      if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) {
        return Math.floor(candidate);
      }
    }
    return undefined;
  };
  const input = pick(usage?.input_tokens, usage?.prompt_tokens, metadata?.promptTokenCount);
  const output = pick(usage?.output_tokens, usage?.completion_tokens, metadata?.candidatesTokenCount);
  return { ...(input === undefined ? {} : { input }), ...(output === undefined ? {} : { output }) };
}
