/**
 * Per-provider API-key presence store. In the native app the secret lives only
 * in the OS keychain: the renderer may write a new key (Settings) or learn
 * whether one exists, but never hydrates the raw value for API calls. Cloud
 * HTTPS attaches the credential inside Rust (`cloud_ai_proxy`).
 *
 * Outside Tauri (unit tests / web preview) a process-local key is kept so
 * injected fetch seams can still authenticate — that path is not the packaged
 * desktop security boundary.
 */
import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

export interface ProviderKeyStore {
  /** Raw key for web/test only; always "" in Tauri. */
  load(): string;
  hasKey(): boolean;
  hydrate(): Promise<void>;
  save(key: string): void;
  useHasKey(): boolean;
}

export function createProviderKeyStore(provider: string): ProviderKeyStore {
  const changeEvent = `tau:assistant-api-key-changed:${provider}`;
  /** Packaged app: presence only. Web/test: optional raw key for fetch seams. */
  let sessionHasKey = false;
  let webOnlyKey = "";
  let hydration: Promise<void> | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let revision = 0;

  const notify = () => {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(changeEvent));
  };

  const load = () => (isTauri() ? "" : webOnlyKey);

  const hasKey = () => sessionHasKey;

  const hydrate = (): Promise<void> => {
    if (!isTauri()) return Promise.resolve();
    if (!hydration) {
      const revisionAtStart = revision;
      hydration = invoke<boolean>("has_provider_api_key", { provider })
        .then((present) => {
          if (revision !== revisionAtStart) return;
          sessionHasKey = present;
          webOnlyKey = "";
          notify();
        })
        .catch(() => {
          // Presence stays whatever the user typed this session.
        });
    }
    return hydration;
  };

  const save = (key: string): void => {
    const trimmed = key.trim();
    revision += 1;
    sessionHasKey = trimmed.length > 0;
    if (isTauri()) {
      webOnlyKey = "";
    } else {
      webOnlyKey = trimmed;
    }
    notify();
    if (!isTauri()) return;
    if (saveTimer) globalThis.clearTimeout(saveTimer);
    saveTimer = globalThis.setTimeout(() => {
      saveTimer = null;
      void invoke("save_provider_api_key", { provider, apiKey: trimmed }).catch(() => {
        // Settings remains responsive; a later edit retries the keychain write.
      });
    }, 350);
  };

  const useHasKey = (): boolean => {
    const [present, setPresent] = useState(hasKey);
    useEffect(() => {
      const onChange = () => setPresent(hasKey());
      window.addEventListener(changeEvent, onChange);
      void hydrate();
      return () => window.removeEventListener(changeEvent, onChange);
    }, []);
    return present;
  };

  return { load, hasKey, hydrate, save, useHasKey };
}

const openAiStore = createProviderKeyStore("openai");

export const loadOpenAiApiKey = openAiStore.load;
export const hasOpenAiApiKey = openAiStore.hasKey;
export const hydrateOpenAiApiKey = openAiStore.hydrate;
export const saveOpenAiApiKey = openAiStore.save;
export const useHasOpenAiApiKey = openAiStore.useHasKey;

const geminiStore = createProviderKeyStore("gemini");

export const loadGeminiApiKey = geminiStore.load;
export const hasGeminiApiKey = geminiStore.hasKey;
export const hydrateGeminiApiKey = geminiStore.hydrate;
export const saveGeminiApiKey = geminiStore.save;
export const useHasGeminiApiKey = geminiStore.useHasKey;

/** @deprecated Prefer useHasGeminiApiKey — raw keys are never exposed in Tauri. */
export const useGeminiApiKey = (): string => (useHasGeminiApiKey() ? (loadGeminiApiKey() || "saved") : "");
