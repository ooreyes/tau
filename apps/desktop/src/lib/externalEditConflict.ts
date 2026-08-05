/**
 * Safe external-edit / conflict handling (product-gates DoD slice).
 *
 * Disk-backed tabs remember a fingerprint of the last synced file bytes.
 * On focus (and before overwrite Save) Tau re-reads the path and classifies:
 *   - in-sync: bytes match
 *   - external-only: disk changed, editor still matches last save
 *   - conflict: disk changed and the editor has local edits
 *   - missing: path no longer exists
 *
 * Does not claim the full product-gates box: learning path, run records,
 * and versioned CLI/API remain open.
 */

export type ExternalEditKind = "in-sync" | "external-only" | "conflict" | "missing";

export interface ExternalEditClassification {
  kind: ExternalEditKind;
  /** Present when the file still exists. */
  diskFingerprint: string | null;
}

/**
 * Stable fingerprint of on-disk schematic bytes. Length-prefixed FNV-1a so a
 * single-character swap or truncate is visible without storing the full text.
 */
export function diskContentFingerprint(contents: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < contents.length; i += 1) {
    hash ^= contents.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v1:${contents.length}:${(hash >>> 0).toString(16)}`;
}

/**
 * Classify the relationship between the last-synced bytes, the live editor,
 * and what is currently on disk.
 */
export function classifyExternalEdit(input: {
  /** Fingerprint recorded at last open/save (or Keep-mine acknowledge). */
  syncedFingerprint: string;
  /** Fingerprint of bytes just read from disk; null if the path is gone. */
  diskFingerprint: string | null;
  /** True when the live editor differs from the last successful save/open. */
  editorDirty: boolean;
}): ExternalEditClassification {
  const { syncedFingerprint, diskFingerprint, editorDirty } = input;
  if (diskFingerprint === null) {
    return { kind: "missing", diskFingerprint: null };
  }
  if (diskFingerprint === syncedFingerprint) {
    return { kind: "in-sync", diskFingerprint };
  }
  if (editorDirty) {
    return { kind: "conflict", diskFingerprint };
  }
  return { kind: "external-only", diskFingerprint };
}

/** Human-facing copy for the conflict dialog title. */
export function externalEditDialogTitle(kind: Exclude<ExternalEditKind, "in-sync">): string {
  switch (kind) {
    case "external-only":
      return "File changed on disk";
    case "conflict":
      return "File conflict";
    case "missing":
      return "File missing on disk";
  }
}

/** Human-facing body for the conflict dialog. */
export function externalEditDialogBody(
  kind: Exclude<ExternalEditKind, "in-sync">,
  title: string,
): string {
  const name = `“${title}”`;
  switch (kind) {
    case "external-only":
      return `${name} was modified outside Tau. Reload to take the disk version, or keep the open editor (Save will overwrite disk).`;
    case "conflict":
      return `${name} changed on disk while you have unsaved edits. Reloading discards your edits; Keep mine keeps the editor and will overwrite disk on Save.`;
    case "missing":
      return `${name} is no longer on disk. Keep open detaches the tab so Save can recreate the file; Discard closes without writing.`;
  }
}
