/**
 * How Settings is opened, and how it links out, in each of the two places Tau
 * runs.
 *
 * Desktop: Settings is a real second OS window. Rust owns creating it, so the
 * renderer can ask for that one window and cannot create arbitrary webviews.
 *
 * Browser (`pnpm dev:web`): there is no window manager to ask and no keychain
 * to write to. Settings opens as a full-surface in-app route instead. That is a
 * genuine downgrade, and the pages say so rather than pretending: see
 * `keychainAvailable`, which every piece of storage copy is written against.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";

/** Fired in the browser fallback, where there is no second window to open. */
export const SETTINGS_ROUTE_EVENT = "tau:open-settings-route";

/**
 * True only where an OS keychain actually exists. Storage copy must be written
 * against this: telling a browser user their key went into the Mac keychain
 * would be a lie about where their secret is, which is the one thing a key
 * field must never get wrong.
 */
export function keychainAvailable(): boolean {
  return isTauri();
}

/** True when Settings can be a separate OS window rather than an in-app route. */
export function standaloneWindowAvailable(): boolean {
  return isTauri();
}

/**
 * Show Settings. Returns the surface actually used, so a caller can tell the
 * difference between "a window is now in front of you" and "this page changed".
 */
export async function openSettings(): Promise<"window" | "route"> {
  if (isTauri()) {
    await invoke("open_settings_window");
    return "window";
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SETTINGS_ROUTE_EVENT));
  }
  return "route";
}

/**
 * Hand a provider page to the system browser. In the desktop app Rust checks
 * the address against a closed allowlist first; Tau's own webview never
 * navigates away from the app, because a page that can be steered elsewhere is
 * a page that can be dressed up as Tau while it asks for a key.
 */
export async function openProviderPage(url: string): Promise<void> {
  if (isTauri()) {
    await invoke("open_external_url", { url });
    return;
  }
  // Browser: the surrounding browser is already the trust boundary.
  window.open(url, "_blank", "noopener,noreferrer");
}
