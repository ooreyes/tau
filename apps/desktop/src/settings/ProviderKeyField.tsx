/**
 * The one place in Tau where an API key is typed.
 *
 * Two rules drive the whole component:
 *
 * 1. **A stored key is never rendered.** The store exposes presence as a
 *    boolean and nothing else, because `has_provider_api_key` was written to
 *    return a boolean for exactly this reason. When a key is saved this renders
 *    the sentence "A key is saved" and two buttons; there is no element whose
 *    value, placeholder, title or `data-` attribute holds the secret, so a
 *    screenshot, a screen reader, or a DOM dump cannot leak it.
 *
 * 2. **The copy names the real storage.** In the desktop app the key goes to
 *    the macOS keychain. In a browser there is no keychain, so it stays in
 *    memory for the session and the copy says that instead. Claiming keychain
 *    storage where none exists would be a lie about where a secret lives.
 *
 * The typed-but-not-yet-saved value does live in React state while the user is
 * typing, in a masked input, and is cleared the moment it is handed to the
 * store. That is unavoidable and is a different thing from reading a stored key
 * back out.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { keychainAvailable } from "./settingsSurface";

export interface ProviderKeyFieldProps {
  /** Used for the input id and label; must be unique on the page. */
  id: string;
  /** e.g. "Anthropic API key" - also the accessible name. */
  label: string;
  /** Shown in the empty field so a paste can be checked by eye. */
  keyPrefix: string;
  hasKey: boolean;
  onSave: (key: string) => void;
  onNotice?: (message: string) => void;
}

/** Where a saved key actually lives, phrased for the environment Tau is in. */
export function keyStorageDescription(): string {
  return keychainAvailable()
    ? "Saved in the macOS keychain and attached by Tau's native process. It is never held in the page and never written into a schematic file."
    : "This is a browser preview with no keychain. A key you enter stays in memory for this tab only, is not written to disk, and is gone when you reload.";
}

export function ProviderKeyField({
  id,
  label,
  keyPrefix,
  hasKey,
  onSave,
  onNotice,
}: ProviderKeyFieldProps) {
  const [draft, setDraft] = useState("");
  const [replacing, setReplacing] = useState(false);

  const editing = replacing || !hasKey;
  const trimmed = draft.trim();

  const commit = () => {
    if (!trimmed) return;
    onSave(trimmed);
    // Drop the plaintext from component state as soon as the store has it.
    setDraft("");
    setReplacing(false);
    onNotice?.(
      keychainAvailable()
        ? `${label} saved to the macOS keychain.`
        : `${label} saved in memory for this browser session.`,
    );
  };

  const remove = () => {
    // An empty value is how the store and the Rust side both spell "delete".
    onSave("");
    setDraft("");
    setReplacing(false);
    onNotice?.(`${label} removed.`);
  };

  return (
    <div className="tau-key-field" data-has-key={hasKey ? "yes" : "no"}>
      <div className="tau-key-status">
        <span
          className={`tau-key-lamp${hasKey ? " on" : ""}`}
          aria-hidden="true"
        />
        {/* The single source of truth the user gets about their key. Presence
            only: the value itself is not available to this component. */}
        <span className="tau-key-status-text" role="status">
          {hasKey ? "A key is saved" : "No key saved"}
        </span>
        {hasKey && !replacing && (
          <div className="tau-key-actions">
            <Button size="sm" variant="outline" onClick={() => setReplacing(true)}>
              Replace
            </Button>
            <Button size="sm" variant="outline" onClick={remove}>
              Remove
            </Button>
          </div>
        )}
      </div>

      {editing && (
        <div className="tau-key-entry">
          <label className="tau-key-label" htmlFor={id}>
            {label}
          </label>
          <div className="tau-key-input-row">
            {/* Named by the visible <label htmlFor> above. No aria-label: two
                accessible names for one field is one name too many. */}
            <Input
              id={id}
              type="password"
              variant="mono"
              autoComplete="off"
              spellCheck={false}
              placeholder={`${keyPrefix}…`}
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit();
                }
              }}
            />
            <Button size="sm" disabled={!trimmed} onClick={commit}>
              Save key
            </Button>
            {replacing && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDraft("");
                  setReplacing(false);
                }}
              >
                Cancel
              </Button>
            )}
          </div>
          <p className="tau-key-storage">{keyStorageDescription()}</p>
        </div>
      )}
    </div>
  );
}
