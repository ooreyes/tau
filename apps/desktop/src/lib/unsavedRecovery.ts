/**
 * Crash-safe unsaved schematic recovery (product-gates DoD slice).
 *
 * Persists a versioned dirty snapshot so a killed/crashed session can offer
 * Restore / Discard on the next launch instead of silently hydrating into the
 * live editor (which project-first open would then overwrite).
 *
 * Does not claim SHIPPABLE — other DoD boxes remain open.
 */

import type { SchematicDocument } from "../store/useSchematic";
import { validateSchematicDocument } from "../schematic/documentValidation";

export const UNSAVED_RECOVERY_KEY = "tau.unsaved.recovery.v1";
/** Legacy silent autosave key - still written for Settings "clear" + migrate. */
export const LEGACY_AUTOSAVE_KEY = "tau.schematic.v1";
export const UNSAVED_RECOVERY_VERSION = 1 as const;

export interface UnsavedRecoverySnapshot {
  version: typeof UNSAVED_RECOVERY_VERSION;
  savedAt: number;
  dirty: true;
  title: string;
  filePath: string | null;
  /** Id-independent semantic signature at snapshot time. */
  signature: string;
  document: SchematicDocument;
}

const MAX_TITLE_CHARS = 120;
const MAX_PATH_CHARS = 1_024;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** True when the document carries any authored circuit content worth recovering. */
export function documentHasRecoverableContent(doc: SchematicDocument): boolean {
  return (
    doc.components.length > 0
    || doc.wires.length > 0
    || (doc.probes?.length ?? 0) > 0
    || (doc.netLabels?.length ?? 0) > 0
    || (doc.directives?.length ?? 0) > 0
    || (doc.textAnnotations?.length ?? 0) > 0
    || (doc.ascShapes?.length ?? 0) > 0
    || (doc.ascDataFlags?.length ?? 0) > 0
    || (doc.ascForeignSymbols?.length ?? 0) > 0
    || (doc.ascHierarchicalBlocks?.length ?? 0) > 0
    || (doc.userModelLibraries?.length ?? 0) > 0
  );
}

function clampTitle(title: string): string {
  const trimmed = title.trim() || "untitled.asc";
  return trimmed.length > MAX_TITLE_CHARS ? trimmed.slice(0, MAX_TITLE_CHARS) : trimmed;
}

function clampPath(path: string | null | undefined): string | null {
  if (typeof path !== "string" || path.length === 0) return null;
  return path.length > MAX_PATH_CHARS ? path.slice(0, MAX_PATH_CHARS) : path;
}

function parseSnapshot(value: unknown): UnsavedRecoverySnapshot | null {
  const source = record(value);
  if (!source) return null;
  if (source.version !== UNSAVED_RECOVERY_VERSION) return null;
  if (source.dirty !== true) return null;
  if (typeof source.savedAt !== "number" || !Number.isFinite(source.savedAt) || source.savedAt <= 0) {
    return null;
  }
  if (typeof source.title !== "string" || source.title.length === 0) return null;
  if (typeof source.signature !== "string" || source.signature.length === 0) return null;
  const filePath = source.filePath === null || source.filePath === undefined
    ? null
    : typeof source.filePath === "string"
      ? clampPath(source.filePath)
      : null;
  try {
    const document = validateSchematicDocument(source.document);
    if (!documentHasRecoverableContent(document)) return null;
    return {
      version: UNSAVED_RECOVERY_VERSION,
      savedAt: source.savedAt,
      dirty: true,
      title: clampTitle(source.title),
      filePath,
      signature: source.signature,
      document,
    };
  } catch {
    return null;
  }
}

/** Persist a dirty crash-recovery snapshot. No-ops when storage is unavailable. */
export function saveUnsavedRecovery(input: {
  savedAt?: number;
  title: string;
  filePath?: string | null;
  signature: string;
  document: SchematicDocument;
}): void {
  if (typeof localStorage === "undefined") return;
  if (!documentHasRecoverableContent(input.document)) {
    clearUnsavedRecovery();
    return;
  }
  if (typeof input.signature !== "string" || input.signature.length === 0) return;
  const snapshot: UnsavedRecoverySnapshot = {
    version: UNSAVED_RECOVERY_VERSION,
    savedAt: input.savedAt ?? Date.now(),
    dirty: true,
    title: clampTitle(input.title),
    filePath: clampPath(input.filePath),
    signature: input.signature,
    document: input.document,
  };
  try {
    localStorage.setItem(UNSAVED_RECOVERY_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota / private mode - leave prior snapshot untouched.
  }
}

export function loadUnsavedRecovery(): UnsavedRecoverySnapshot | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(UNSAVED_RECOVERY_KEY);
    if (!raw) return null;
    return parseSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearUnsavedRecovery(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(UNSAVED_RECOVERY_KEY);
  } catch {
    // ignore
  }
}

/**
 * Clear both the versioned recovery envelope and the legacy silent autosave
 * blob (Settings "Clear local autosave" and Discard both call this).
 */
export function clearAllUnsavedLocalState(): void {
  clearUnsavedRecovery();
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(LEGACY_AUTOSAVE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Offer recovery when a versioned dirty snapshot exists, or when a legacy
 * non-empty autosave blob is present (one-shot migrate into the offer path).
 */
export function peekUnsavedRecoveryOffer(): UnsavedRecoverySnapshot | null {
  const current = loadUnsavedRecovery();
  if (current) return current;
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LEGACY_AUTOSAVE_KEY);
    if (!raw) return null;
    const document = validateSchematicDocument(JSON.parse(raw));
    if (!documentHasRecoverableContent(document)) return null;
    const migrated: UnsavedRecoverySnapshot = {
      version: UNSAVED_RECOVERY_VERSION,
      savedAt: Date.now(),
      dirty: true,
      title: "untitled.asc",
      filePath: null,
      signature: "legacy-autosave",
      document,
    };
    try {
      localStorage.setItem(UNSAVED_RECOVERY_KEY, JSON.stringify(migrated));
    } catch {
      // Still offer even if we could not rewrite the envelope.
    }
    return migrated;
  } catch {
    return null;
  }
}

/** Human-readable age for the recovery dialog body. */
export function formatRecoveryAge(savedAt: number, now = Date.now()): string {
  const delta = Math.max(0, now - savedAt);
  const seconds = Math.floor(delta / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
