/** First-run local AI onboarding persistence for the native Mac app. */

const STORAGE_KEY = "tau.local-ai.setup.v1";
const CHANGE_EVENT = "tau:local-ai-setup-changed";

export interface LocalAiSetupPreferences {
  /** User finished setup with a ready local model, or explicitly skipped. */
  dismissed: boolean;
}

const DEFAULT: LocalAiSetupPreferences = { dismissed: false };

function valid(value: unknown): LocalAiSetupPreferences | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<LocalAiSetupPreferences>;
  if (typeof candidate.dismissed !== "boolean") return null;
  return { dismissed: candidate.dismissed };
}

export function loadLocalAiSetupPreferences(): LocalAiSetupPreferences {
  if (typeof localStorage === "undefined") return DEFAULT;
  try {
    return valid(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")) ?? DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function saveLocalAiSetupPreferences(preferences: LocalAiSetupPreferences): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function dismissLocalAiSetup(): void {
  saveLocalAiSetupPreferences({ dismissed: true });
}

export function shouldOfferLocalAiSetup(options: {
  isNative: boolean;
  dismissed: boolean;
  status: { state: string; installed: boolean } | null;
}): boolean {
  if (!options.isNative || options.dismissed) return false;
  if (!options.status) return true;
  return options.status.state !== "ready";
}
