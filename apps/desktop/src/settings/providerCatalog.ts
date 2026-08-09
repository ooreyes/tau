/**
 * What Settings needs to know about each AI provider, in one place.
 *
 * The how-to steps assume the reader has never made an API key before. That is
 * the actual audience: a student who was told to "add your key" and has no idea
 * that a key is a thing you create on a website, that it is shown exactly once,
 * or that it is attached to a billing account they are responsible for.
 *
 * Every URL here must also appear in `ALLOWED_EXTERNAL_URLS` in
 * `src-tauri/src/external_url.rs`. Tau opens no other address, so a link
 * added here without its Rust counterpart simply refuses, loudly, rather than
 * opening something unreviewed.
 */

export type ProviderId = "anthropic" | "openai" | "gemini";

export interface ProviderInfo {
  id: ProviderId;
  /** What the user calls the company. */
  label: string;
  /** The product they will see once they arrive. */
  consoleName: string;
  keyPageUrl: string;
  usagePageUrl: string;
  pricingPageUrl: string;
  /** Shown in the empty field so a pasted key can be sanity-checked by eye. */
  keyPrefix: string;
  /** One line on what signing up actually costs. */
  costNote: string;
  /** Ordered, literal steps. No step may assume prior API experience. */
  steps: readonly string[];
}

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    consoleName: "Anthropic Console",
    keyPageUrl: "https://console.anthropic.com/settings/keys",
    usagePageUrl: "https://console.anthropic.com/settings/usage",
    pricingPageUrl: "https://www.anthropic.com/pricing",
    keyPrefix: "sk-ant-",
    costNote:
      "Pay as you go. Anthropic asks for a card and a prepaid balance before the first request. A Claude.ai subscription does not cover API keys, and buying one will not make this work.",
    steps: [
      "Open the Anthropic Console and sign in, or create an account.",
      "Add a payment method under Billing and buy a small amount of credit. API keys do not work on a zero balance.",
      "Go to Settings, then API keys, and choose Create key.",
      "Give it a name you will recognise later, such as Tau on my laptop.",
      "Copy the key the moment it appears. Anthropic shows it once and cannot show it again.",
      "Paste it below and choose Save key.",
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    consoleName: "OpenAI Platform",
    keyPageUrl: "https://platform.openai.com/api-keys",
    usagePageUrl: "https://platform.openai.com/usage",
    pricingPageUrl: "https://openai.com/api/pricing/",
    keyPrefix: "sk-",
    costNote:
      "Pay as you go. OpenAI bills the API separately from ChatGPT Plus. Paying for ChatGPT gives you no API credit.",
    steps: [
      "Open the OpenAI Platform and sign in, or create an account.",
      "Under Billing, add a payment method and buy credit. A new account with no credit is refused on the first request.",
      "Go to API keys and choose Create new secret key.",
      "Name it so you can revoke this one later without touching your others.",
      "Copy the key straight away. OpenAI shows the full value once.",
      "Paste it below and choose Save key.",
    ],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    consoleName: "Google AI Studio",
    keyPageUrl: "https://aistudio.google.com/apikey",
    usagePageUrl: "https://aistudio.google.com/usage",
    pricingPageUrl: "https://ai.google.dev/pricing",
    keyPrefix: "AIza",
    costNote:
      "Has a free tier. Google AI Studio issues a key without a card, at a limited request rate. This is the cheapest way to try the assistant.",
    steps: [
      "Open Google AI Studio and sign in with a Google account.",
      "Choose Get API key, then Create API key.",
      "Pick a Google Cloud project, or let Studio make one for you.",
      "Copy the key it shows.",
      "Paste it below and choose Save key.",
      "Leave billing alone unless you outgrow the free rate limit.",
    ],
  },
];

export function providerInfo(id: ProviderId): ProviderInfo {
  const found = PROVIDERS.find((provider) => provider.id === id);
  // The id set is closed and typed; this is a last resort rather than a path.
  if (!found) throw new Error(`Unknown provider: ${id}`);
  return found;
}
