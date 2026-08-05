/**
 * Explicit cloud-data consent for Gemini / Anthropic BYOK paths.
 * Circuit context must not leave the machine until the student opts in.
 * This is not a Tau OAuth login — keys stay in the OS keychain.
 */
const STORAGE_KEY = "tau.cloud-ai.consent.v1";
const CHANGE_EVENT = "tau:cloud-ai-consent-changed";

/** Shown when a cloud provider is selected before the student opts in. */
export const CLOUD_AI_CONSENT_REQUIRED =
  "Allow cloud AI in Settings before Tau can send circuit context off this Mac.";

export interface CloudAiConsent {
  /** Student acknowledged circuit data may be sent to the cloud provider. */
  consented: boolean;
}

const DEFAULT: CloudAiConsent = { consented: false };

function valid(value: unknown): CloudAiConsent | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CloudAiConsent>;
  if (typeof candidate.consented !== "boolean") return null;
  return { consented: candidate.consented };
}

export function loadCloudAiConsent(): CloudAiConsent {
  if (typeof localStorage === "undefined") return DEFAULT;
  try {
    return valid(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")) ?? DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function saveCloudAiConsent(consent: CloudAiConsent): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function hasCloudAiConsent(): boolean {
  return loadCloudAiConsent().consented;
}

/** Fail-closed gate for cloud providers — returns null when consent is present. */
export function cloudAiConsentRefusal(): string | null {
  return hasCloudAiConsent() ? null : CLOUD_AI_CONSENT_REQUIRED;
}

export { CHANGE_EVENT as CLOUD_AI_CONSENT_CHANGE_EVENT };
