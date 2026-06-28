/**
 * Carry a document's `.model` / `.lib` / `.inc`(`.include`) / `.subckt`…`.ends`
 * directives through to the native ngspice deck (FEATURE_PARITY §3 model/library
 * import — the passthrough half).
 *
 * Real LTspice circuits keep their device models and library references in
 * on-canvas TEXT directives. `ascToSchematic` strips the leading `!` and stores
 * each TEXT block as one entry in `directives`; multi-line blocks (a whole
 * `.subckt … .ends`, or a `.model` spread over several lines) keep LTspice's
 * literal `\n` escape. Without this passthrough those definitions are silently
 * dropped and every semiconductor falls back to Tau's generic starter models.
 *
 * Pure function: given the document directives it returns deck lines, leaving
 * analysis/param/option directives (handled elsewhere) untouched.
 */

const BLOCK_KEYWORDS = ["model", "lib", "inc", "include", "subckt"] as const;

/** First whitespace-delimited keyword of a line, lower-cased, leading `.`/`!` stripped. */
function leadingKeyword(line: string): string {
  return line.trim().replace(/^[.!]+/, "").split(/\s+/)[0]?.toLowerCase() ?? "";
}

/**
 * Normalize the *opening* line of a model/library block: guarantee a single
 * leading dot and rewrite the `.inc` alias to ngspice's canonical `.include`.
 * Inner lines of a `.subckt` body (component instances, `.ends`, comments) are
 * emitted verbatim by the caller.
 */
function normalizeOpeningLine(line: string): string {
  const m = /^[.!]?(model|lib|inc|include|subckt)\b(.*)$/is.exec(line.trim());
  if (!m) return line.trim();
  const keyword = m[1].toLowerCase() === "inc" ? "include" : m[1].toLowerCase();
  return `.${keyword}${m[2]}`.trimEnd();
}

/**
 * Extract model/library deck lines from a document's directive list, preserving
 * document order. Multi-line blocks are expanded on LTspice's `\n` escape and
 * each non-empty physical line is emitted; blank lines inside a block are
 * dropped. Directives that are not a model/library kind are skipped.
 */
export function modelLibLinesFromDirectives(directives: ReadonlyArray<string>): string[] {
  const out: string[] = [];
  for (const raw of directives) {
    if (!BLOCK_KEYWORDS.includes(leadingKeyword(raw) as (typeof BLOCK_KEYWORDS)[number])) continue;
    // LTspice encodes multi-line TEXT blocks with a literal backslash-n.
    const physicalLines = raw.replace(/\\n/g, "\n").split("\n");
    physicalLines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      out.push(index === 0 ? normalizeOpeningLine(trimmed) : trimmed);
    });
  }
  return out;
}
