import { useEffect, useState } from "react";
import type { LocalAiPresetInfo } from "./localAiRuntime";
import { GEMINI_DEFAULT_MODEL } from "./geminiAssistant";

export type AssistantProviderChoice = "local-mlx" | "anthropic" | "gemini";

const PROVIDER_CHOICES: readonly AssistantProviderChoice[] = ["local-mlx", "anthropic", "gemini"];

export interface AssistantPreferences {
  provider: AssistantProviderChoice;
  localModel: LocalAiPresetInfo["id"];
  /** Gemini preset id, or `custom:<model>`. Independent of localModel so
   *  switching providers never loses the other's selection. */
  geminiModel: string;
}

const STORAGE_KEY = "tau.assistant.preferences.v1";
const CHANGE_EVENT = "tau:assistant-preferences-changed";

const DEFAULT_PREFERENCES: AssistantPreferences = {
  provider: "local-mlx",
  // The 4B quantization still fits an 8 GB Apple-silicon Mac, and live Tau
  // plan tests show materially better component/pin completeness than 1.7B.
  localModel: "qwen3-4b-4bit",
  geminiModel: GEMINI_DEFAULT_MODEL,
};

function validPreferences(value: unknown): AssistantPreferences | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AssistantPreferences>;
  if (!candidate.provider || !PROVIDER_CHOICES.includes(candidate.provider)) return null;
  if (typeof candidate.localModel !== "string" || candidate.localModel.length === 0) return null;
  // geminiModel was added after v1 of this key; an older stored blob is still
  // valid and simply inherits the default rather than resetting the provider.
  const geminiModel = typeof candidate.geminiModel === "string" && candidate.geminiModel.length > 0
    ? candidate.geminiModel
    : GEMINI_DEFAULT_MODEL;
  return { provider: candidate.provider, localModel: candidate.localModel, geminiModel };
}

export function loadAssistantPreferences(): AssistantPreferences {
  if (typeof localStorage === "undefined") return DEFAULT_PREFERENCES;
  try {
    const parsed = validPreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
    return parsed ?? DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/** Accepted by `saveAssistantPreferences`: a caller that only cares about the
 *  provider and local model may omit `geminiModel` and inherit the default. */
export type AssistantPreferencesInput =
  Omit<AssistantPreferences, "geminiModel"> & { geminiModel?: string };

export function saveAssistantPreferences(preferences: AssistantPreferencesInput): void {
  if (typeof localStorage === "undefined") return;
  const complete: AssistantPreferences = {
    ...preferences,
    geminiModel: preferences.geminiModel ?? GEMINI_DEFAULT_MODEL,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(complete));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Clears the persisted preference and notifies listeners so any open
 *  Settings UI falls back to the shipped default (local Qwen3 4B) live. */
export function resetAssistantPreferences(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* quota exceeded or storage disabled - nothing more to do here */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useAssistantPreferences(): AssistantPreferences {
  const [preferences, setPreferences] = useState(loadAssistantPreferences);
  useEffect(() => {
    const sync = () => setPreferences(loadAssistantPreferences());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return preferences;
}
