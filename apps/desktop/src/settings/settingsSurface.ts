/**
 * The two environment questions Settings has to ask, and the one way it links
 * out.
 *
 * Settings is part of the schematic window, not a window of its own. It was a
 * second `WebviewWindow` for one revision and that was the wrong shape: a
 * second window is a second JavaScript context, so the key you saved there
 * updated a copy of the credential store the assistant never read, the model
 * libraries the schematic window had hydrated were absent, and preferences
 * could only cross back through `storage` events that WebKit does not promise
 * to deliver between WKWebView processes. One window means one store and no
 * sync layer to get wrong.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * True only where an OS keychain actually exists. Storage copy must be written
 * against this: telling a browser user their key went into the Mac keychain
 * would be a lie about where their secret is, which is the one thing a key
 * field must never get wrong.
 */
export function keychainAvailable(): boolean {
  return isTauri();
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
