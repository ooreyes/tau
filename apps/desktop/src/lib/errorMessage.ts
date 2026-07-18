const MAX_USER_ERROR_CHARS = 240;
const MAX_TECHNICAL_ERROR_CHARS = 4_000;

function normalizedErrorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").trim();
}

function conciseNativeSpiceMessage(raw: string, fallback: string): string {
  const lower = raw.toLowerCase();
  if (/\.ic\s+syntax error|ic on non-existent node/.test(lower)) {
    return "An initial-condition directive is invalid or refers to a part that is no longer in the circuit.";
  }
  if (lower.includes("singular matrix")) {
    return "The circuit has a floating or conflicting node. Check ground and component connections.";
  }
  if (/timestep too small|time step too small/.test(lower)) {
    return "The transient solver could not converge. Check switching edges, models, and initial conditions.";
  }
  if (/unknown subckt|unknown subcircuit|could not find a model|model .* not found/.test(lower)) {
    return "A component model or subcircuit is missing. Import its LTspice library and try again.";
  }
  if (/worker.*timed out|timed out after/.test(lower)) {
    return "Simulation exceeded the safety time limit. Reduce the run length or maximum timestep.";
  }
  return fallback;
}

/** Normalize Error objects and Tauri's string rejections without reflecting
 * unbounded/arbitrary payloads into the UI. Native simulation commands reject
 * with strings, so Error-only handling hid the diagnostic users needed. */
export function userFacingErrorMessage(error: unknown, fallback: string): string {
  const normalized = normalizedErrorText(error);
  if (!normalized) return fallback;
  // Native ngspice failures contain stdout/stderr transcripts separated by
  // pipes. Those are useful diagnostics, but they are not product copy and
  // must stay collapsed behind Technical details.
  if (/\b(?:stdout|stderr)\b|ngspice rejected the circuit/i.test(normalized)) {
    return conciseNativeSpiceMessage(normalized, fallback);
  }
  return normalized.length <= MAX_USER_ERROR_CHARS
    ? normalized
    : `${normalized.slice(0, MAX_USER_ERROR_CHARS - 1)}…`;
}

/** Bounded engine diagnostics for a collapsed disclosure. Never use this as
 * the primary failure message. */
export function technicalErrorDetails(error: unknown): string | undefined {
  const normalized = normalizedErrorText(error);
  if (!normalized) return undefined;
  return normalized.length <= MAX_TECHNICAL_ERROR_CHARS
    ? normalized
    : `${normalized.slice(0, MAX_TECHNICAL_ERROR_CHARS - 1)}…`;
}
