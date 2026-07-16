import { useEffect, useState } from "react";
import type { LocalAiPresetInfo } from "./localAiRuntime";

export type AssistantProviderChoice = "local-mlx" | "anthropic";

export interface AssistantPreferences {
  provider: AssistantProviderChoice;
  localModel: LocalAiPresetInfo["id"];
}

const STORAGE_KEY = "tau.assistant.preferences.v1";
const CHANGE_EVENT = "tau:assistant-preferences-changed";

const DEFAULT_PREFERENCES: AssistantPreferences = {
  provider: "local-mlx",
  // The 4B quantization still fits an 8 GB Apple-silicon Mac, and live Tau
  // plan tests show materially better component/pin completeness than 1.7B.
  localModel: "qwen3-4b-4bit",
};

function validPreferences(value: unknown): AssistantPreferences | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AssistantPreferences>;
  if (candidate.provider !== "local-mlx" && candidate.provider !== "anthropic") return null;
  if (typeof candidate.localModel !== "string" || candidate.localModel.length === 0) return null;
  return { provider: candidate.provider, localModel: candidate.localModel };
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

export function saveAssistantPreferences(preferences: AssistantPreferences): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
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
