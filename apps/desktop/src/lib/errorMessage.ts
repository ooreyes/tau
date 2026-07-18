const MAX_USER_ERROR_CHARS = 2_000;

/** Normalize Error objects and Tauri's string rejections without reflecting
 * unbounded/arbitrary payloads into the UI. Native simulation commands reject
 * with strings, so Error-only handling hid the diagnostic users needed. */
export function userFacingErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const normalized = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").trim();
  if (!normalized) return fallback;
  return normalized.length <= MAX_USER_ERROR_CHARS
    ? normalized
    : `${normalized.slice(0, MAX_USER_ERROR_CHARS - 1)}…`;
}
