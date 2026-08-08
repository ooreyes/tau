/**
 * `.options` passthrough for the native ngspice deck.
 *
 * Tau emits a baseline `.options` line (gmin/reltol/abstol/vntol) for robust
 * convergence. When an imported `.asc` carries its own `.options` directives
 * (used 7× in the user's circuits, LTspice parity ), the user's settings must
 * win so the simulation matches LTspice. These helpers parse `.options` lines
 * into key/value pairs and merge them over the defaults.
 */

/** Tau's baseline simulator options, applied unless the document overrides them. */
export const DEFAULT_OPTIONS: Record<string, string> = {
  gmin: "1e-12",
  reltol: "1e-4",
  abstol: "1e-12",
  vntol: "1e-7",
  // A 1 TΩ resistor from every node to ground. ngspice (unlike LTspice) throws a
  // fatal "singular matrix" the moment any node lacks a DC path to ground - a
  // floating op-amp input, an AC-coupled stage, an ideal-transformer winding.
  // rshunt gives every node a negligible DC return so those circuits solve; at
  // 1e12 Ω its effect on real node voltages is below measurement noise. The
  // document can override or disable it.
  rshunt: "1e12",
  // 1 mΩ in series with every inductor - LTspice's own documented default
  // (an inductor without an explicit Rser gets 1 mΩ; Control Panel → Hacks).
  // Without it a loop of ideal inductors (or L across a V source) has an
  // indeterminate DC current split and ngspice's op fails with "singular
  // matrix: check node lN#branch" (Cohn/passive/varactor2 in the acceptance
  // corpus). Matching LTspice's default is therefore both the convergence fix
  // and the parity-faithful choice. The document can override or disable it.
  rseries: "1e-3",
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

/**
 * Convenience: parse a document's directives and produce the merged `.options`
 * line.
 *
 * `userDefaults` is the app-wide preference layer set in Settings. Precedence
 * is deliberate and is the whole point of the three-way merge:
 * `DEFAULT_OPTIONS` < the user's Settings < the document's own `.options`.
 * A schematic that pins `reltol` was authored to simulate that way, so it still
 * wins; opening someone else's circuit must not silently re-simulate it with
 * your tolerances.
 */
export function optionsLineFromDirectives(
  directives: ReadonlyArray<string>,
  userDefaults: Record<string, string> = {},
): string {
  return mergeOptionsLine({ ...userDefaults, ...parseOptionsDirectives(directives) });
}
