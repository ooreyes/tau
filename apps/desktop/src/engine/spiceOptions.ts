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
  // A resistor from every node to ground. ngspice (unlike LTspice) throws a
  // fatal "singular matrix" the moment any node lacks a DC path to ground - a
  // floating op-amp input, an AC-coupled stage, an ideal-transformer winding.
  // rshunt gives every node a negligible DC return so those circuits solve.
  //
  // This is the FLOOR, not the value: `shuntForMaxResistance` raises it for
  // high-impedance circuits. The comment here used to claim that 1e12 Ω was
  // "below measurement noise" full stop, and that is only true while the
  // circuit's own resistances are far below it. Measured against a 1:1
  // divider, whose answer is exactly 0.5 V for any R:
  //
  //     R = 1 k     0.500000000 V     error 2.5e-10 V
  //     R = 1 Meg   0.499999750 V     error 2.5e-7 V
  //     R = 1 G     0.499750125 V     error 0.05 %
  //     R = 1 T     0.333333333 V     error 33 %
  //
  // The error is 0.5·R/rshunt, so it is the RATIO that has to stay large, not
  // the shunt. An electrometer or photodiode front end sits exactly where the
  // fixed value fails worst - and those are among the circuits rshunt was
  // added to rescue in the first place. The document can still override or
  // disable it.
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

/** Smallest shunt Tau will emit: today's value, so a circuit whose resistances
 *  are all well under a megohm gets exactly the deck it got before. */
const RSHUNT_FLOOR = 1e12;
/** Largest shunt Tau will emit.
 *
 *  Not arbitrary. Past roughly 1e18 the shunt stops being a usable DC return
 *  and the thing it exists to prevent comes back: at 1e21 an AC-coupled node
 *  that should settle to 0 V solved to 0.99 V instead - a floating node
 *  reported as a confident wrong answer, which is worse than the singular
 *  matrix. 1e18 was clean on the same circuit. */
const RSHUNT_CEILING = 1e18;
/** How far above the circuit's own impedance the shunt should sit. The error
 *  a shunt introduces is 0.5·R/rshunt, so 1e6 buys about 5e-7 relative - two
 *  orders below any tolerance an engineer reads a node voltage to. */
const RSHUNT_RATIO = 1e6;

/**
 * The shunt to hang off every node, given the largest resistance in the
 * circuit.
 *
 * Rounded up to a whole decade so the emitted deck stays something a person
 * can read and diff, and clamped at both ends (see the constants above).
 * Below about a megohm this returns the historical `1e12` unchanged, so the
 * decks that already solve keep solving with the deck they already had.
 */
export function shuntForMaxResistance(maxResistanceOhms: number): string {
  if (!Number.isFinite(maxResistanceOhms) || maxResistanceOhms <= 0) {
    return `1e${Math.log10(RSHUNT_FLOOR)}`;
  }
  const wanted = Math.min(RSHUNT_CEILING, Math.max(RSHUNT_FLOOR, maxResistanceOhms * RSHUNT_RATIO));
  const decade = Math.min(
    Math.log10(RSHUNT_CEILING),
    Math.max(Math.log10(RSHUNT_FLOOR), Math.ceil(Math.log10(wanted))),
  );
  return `1e${decade}`;
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
  maxResistanceOhms?: number,
): string {
  // The scaled shunt goes in at the DEFAULT layer, underneath both the user's
  // Settings and the document's own `.options`. A schematic that pins rshunt
  // was authored to simulate that way and still wins.
  const scaled: Record<string, string> = maxResistanceOhms === undefined
    ? {}
    : { rshunt: shuntForMaxResistance(maxResistanceOhms) };
  return mergeOptionsLine({ ...scaled, ...userDefaults, ...parseOptionsDirectives(directives) });
}
