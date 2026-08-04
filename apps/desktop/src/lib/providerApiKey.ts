/**
 * Per-provider API-key store. Same guarantees as the Anthropic path in
 * assistant.ts: the key lives in module scope for this renderer's lifetime and
 * in the OS keychain across launches - never in localStorage, never in a
 * project file, never logged. Each provider gets its own keychain entry, so
 * holding a Gemini key never exposes an Anthropic one.
 */
import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

export interface ProviderKeyStore {
  load(): string;
  hydrate(): Promise<void>;
  save(key: string): void;
  useKey(): string;
}

export function createProviderKeyStore(provider: string): ProviderKeyStore {
  const changeEvent = `tau:assistant-api-key-changed:${provider}`;
  let sessionKey = "";
  let hydration: Promise<void> | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let revision = 0;

  const notify = () => {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(changeEvent));
  };

  const load = () => sessionKey;

  const hydrate = (): Promise<void> => {
    if (!isTauri()) return Promise.resolve();
    if (!hydration) {
      const revisionAtStart = revision;
      hydration = invoke<string | null>("load_provider_api_key", { provider })
        .then((key) => {
          // A user edit made while the native read was in flight wins.
          if (revision !== revisionAtStart) return;
          sessionKey = key?.trim() ?? "";
          notify();
        })
        .catch(() => {
          // The assistant stays usable for a key entered during this session.
        });
    }
    return hydration;
  };

  const save = (key: string): void => {
    sessionKey = key.trim();
    revision += 1;
    notify();
    if (!isTauri()) return;
    if (saveTimer) globalThis.clearTimeout(saveTimer);
    saveTimer = globalThis.setTimeout(() => {
      saveTimer = null;
      const apiKey = sessionKey;
      void invoke("save_provider_api_key", { provider, apiKey }).catch(() => {
        // Settings remains responsive; a later edit retries the keychain write.
      });
    }, 350);
  };

  const useKey = (): string => {
    const [key, setKey] = useState(load);
    useEffect(() => {
      const onChange = () => setKey(load());
      window.addEventListener(changeEvent, onChange);
      void hydrate();
      return () => window.removeEventListener(changeEvent, onChange);
    }, []);
    return key;
  };

  return { load, hydrate, save, useKey };
}

const geminiStore = createProviderKeyStore("gemini");

export const loadGeminiApiKey = geminiStore.load;
export const hydrateGeminiApiKey = geminiStore.hydrate;
export const saveGeminiApiKey = geminiStore.save;
export const useGeminiApiKey = geminiStore.useKey;
