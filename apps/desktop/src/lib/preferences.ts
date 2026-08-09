/**
 * Versioned preference stores shared by the app.
 *
 * Settings is a surface inside the schematic window, not a separate window.
 * A preference written by Settings reaches the rest of the app via a same-window
 * `CustomEvent`, which is the live notification path. The `storage` event listener
 * remains in the codebase as a harmless leftover from the two-window era when
 * Settings ran in its own OS window and had to wake the schematic window through
 * cross-process storage events.
 *
 * Shape follows `assistantPreferences.ts`: a versioned key, a validator that
 * returns `null` rather than throwing, and a defaults constant that a corrupt
 * or half-written value falls back to. Storage is best-effort throughout; a
 * private-mode webview that refuses to persist must still leave the app usable
 * with in-memory values for the session.
 */
import { useEffect, useState } from "react";

export interface PreferenceStore<T> {
  /** Current value: persisted if readable and valid, otherwise the defaults. */
  load(): T;
  /** Replace the whole value. Invalid input is rejected and the store is unchanged. */
  save(next: T): void;
  /** Merge a partial change over the current value. */
  update(patch: Partial<T>): void;
  /** Drop the persisted value and return to the defaults. */
  reset(): void;
  /** React binding that re-renders on changes from this window or any other. */
  use(): T;
  readonly key: string;
  readonly defaults: T;
}

function readStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    // Private mode / disabled storage: the session still runs on defaults.
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    // Quota or a storage-less webview. The in-memory value already changed.
  }
}

export function createPreferenceStore<T extends object>({
  key,
  defaults,
  validate,
}: {
  key: string;
  defaults: T;
  /** Returns a fully-populated value, or `null` when the stored blob is unusable. */
  validate: (raw: unknown) => T | null;
}): PreferenceStore<T> {
  const changeEvent = `tau:preferences-changed:${key}`;
  // Cached so `load()` stays cheap enough to call from render, and so a webview
  // that cannot persist still holds the user's choice for the session.
  let cached: T | null = null;

  const parse = (text: string | null): T | null => {
    if (!text) return null;
    try {
      return validate(JSON.parse(text) as unknown);
    } catch {
      return null;
    }
  };

  const load = (): T => {
    if (cached) return cached;
    cached = parse(readStorage(key)) ?? defaults;
    return cached;
  };

  const notify = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(changeEvent));
  };

  const save = (next: T): void => {
    const valid = validate(next);
    if (!valid) return;
    cached = valid;
    writeStorage(key, JSON.stringify(valid));
    notify();
  };

  const update = (patch: Partial<T>): void => save({ ...load(), ...patch });

  const reset = (): void => {
    cached = defaults;
    writeStorage(key, null);
    notify();
  };

  const use = (): T => {
    const [value, setValue] = useState<T>(load);
    useEffect(() => {
      const sync = () => setValue(load());
      // Same window: the store's own event. Other windows: `storage`, which
      // only fires in windows that did not perform the write.
      const onStorage = (event: StorageEvent) => {
        if (event.key !== null && event.key !== key) return;
        cached = parse(readStorage(key)) ?? defaults;
        setValue(cached);
      };
      window.addEventListener(changeEvent, sync);
      window.addEventListener("storage", onStorage);
      sync();
      return () => {
        window.removeEventListener(changeEvent, sync);
        window.removeEventListener("storage", onStorage);
      };
    }, []);
    return value;
  };

  return { load, save, update, reset, use, key, defaults };
}

/** Clamp helper for numeric preferences that must stay inside a solver's sane range. */
export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
