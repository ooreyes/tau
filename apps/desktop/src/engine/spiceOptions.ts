/**
 * `.options` passthrough for the native ngspice deck.
 *
 * Tau emits a baseline `.options` line (gmin/reltol/abstol/vntol) for robust
 * convergence. When an imported `.asc` carries its own `.options` directives
 * (used 7× in the user's circuits, FEATURE_PARITY §4), the user's settings must
 * win so the simulation matches LTspice. These helpers parse `.options` lines
 * into key/value pairs and merge them over the defaults.
 */

/** Tau's baseline simulator options, applied unless the document overrides them. */
export const DEFAULT_OPTIONS: Record<string, string> = {
  gmin: "1e-12",
  reltol: "1e-4",
  abstol: "1e-12",
  vntol: "1e-7",
};

/**
 * Parse a document's directive lines, collecting every `.options`/`.option`
 * setting into a key→value map (later lines override earlier ones). Bare flags
 * (e.g. `.options noopiter`) map to an empty string. Keys are lower-cased; values
 * are kept verbatim. Non-`.options` directives are ignored.
 */
export function parseOptionsDirectives(directives: ReadonlyArray<string>): Record<string, string> {
  const opts: Record<string, string> = {};
  for (const directive of directives) {
    const trimmed = directive.trim().replace(/^[.!]+/, "");
    const m = /^option(?:s)?\b\s*(.*)$/i.exec(trimmed);
    if (!m) continue;
    for (const token of m[1].split(/[\s,]+/).filter(Boolean)) {
      const eq = token.indexOf("=");
      if (eq >= 0) {
        const key = token.slice(0, eq).trim().toLowerCase();
        if (key) opts[key] = token.slice(eq + 1).trim();
      } else {
        opts[token.toLowerCase()] = "";
      }
    }
  }
  return opts;
}

/**
 * Build the deck's `.options` line by merging the document's parsed options over
 * {@link DEFAULT_OPTIONS} (document wins). Flag-only options render as the bare
 * key. Keys are emitted in a stable order (defaults first, then any extras in
 * insertion order) so decks are deterministic and testable.
 */
export function mergeOptionsLine(userOptions: Record<string, string>): string {
  const merged: Record<string, string> = { ...DEFAULT_OPTIONS, ...userOptions };
  const ordered = [
    ...Object.keys(DEFAULT_OPTIONS),
    ...Object.keys(merged).filter((k) => !(k in DEFAULT_OPTIONS)),
  ];
  const parts = ordered.map((key) => (merged[key] === "" ? key : `${key}=${merged[key]}`));
  return `.options ${parts.join(" ")}`;
}

/** Convenience: parse a document's directives and produce the merged `.options` line. */
export function optionsLineFromDirectives(directives: ReadonlyArray<string>): string {
  return mergeOptionsLine(parseOptionsDirectives(directives));
}
