/**
 * Carry a document's mutual-inductance (`K`) coupling directives through to the
 * native ngspice deck (FEATURE_PARITY §3 coupled inductors `K`).
 *
 * Real LTspice transformer circuits keep their winding coupling in on-canvas
 * TEXT directives, e.g. `K1 L1 L2 1`, `K3 L1 L2 .95`, the all-windings form
 * `K1 L1 L2 L3 L4 1`, or a parameterized coefficient `Kcup1 L2 L3 {Kcup}`.
 * `ascToSchematic` stores each TEXT block in `directives` with the leading `!`
 * stripped. The model/lib passthrough and the analysis/param/option handlers all
 * ignore `K` lines, so without this they were silently dropped — turning a
 * coupled transformer into independent, uncoupled inductors and producing the
 * wrong waveforms (Transformer, varactor, Royer, …).
 *
 * ngspice accepts the same `Kxxx Lyyy Lzzz [Lwww …] coeff` syntax as LTspice, so
 * the line passes through verbatim once any `{expr}` coefficient is resolved.
 *
 * One twist: a `K` line names inductors by their LTspice instance name (e.g.
 * `K2 T2a T2b T2c 1`), but the deck builder renames an inductor whose label
 * doesn't start with `L` (an ngspice inductor must — `T2a` would be parsed as a
 * transmission line). The caller passes the original-label → emitted-name map so
 * the references are rewritten to match (else ngspice: "coupling to non-existent
 * inductor", Electrometer.asc).
 *
 * Pure function. The coefficient may be a braced parameter expression, so the
 * caller's resolved `ParamScope` is applied via `substituteBraces`.
 */

import { substituteBraces, EMPTY_SCOPE, type ParamScope } from "../simulation/paramScope";

/** A directive is a K coupling line when its first token is `K` + a name. */
function isCouplingLine(line: string): boolean {
  return /^k\w+\s+\S/i.test(line.trim());
}

/**
 * Rewrite the inductor-reference tokens of a `K` line (every token except the
 * leading `K`-name and the trailing coefficient) through the rename map, so they
 * match the inductor names the deck actually emits. Tokens not in the map (and
 * the coefficient) pass through unchanged.
 */
function rewriteCouplingNames(line: string, names: ReadonlyMap<string, string>): string {
  if (names.size === 0) return line;
  const toks = line.split(" ");
  for (let i = 1; i < toks.length - 1; i += 1) {
    const mapped = names.get(toks[i].toLowerCase());
    if (mapped) toks[i] = mapped;
  }
  return toks.join(" ");
}

/**
 * Extract mutual-inductance deck lines from a document's directive list, in
 * document order, with any `{expr}` coupling coefficient resolved against the
 * param scope. Multi-line TEXT blocks are split on LTspice's `\n` escape.
 *
 * @param inductorNames original-label (lower-cased) → emitted deck name, used to
 *   rewrite `K` inductor references to the renamed instances.
 */
export function couplingLinesFromDirectives(
  directives: ReadonlyArray<string>,
  params: ParamScope = EMPTY_SCOPE,
  inductorNames: ReadonlyMap<string, string> = new Map(),
): string[] {
  const out: string[] = [];
  for (const raw of directives) {
    for (const physical of raw.replace(/\\n/g, "\n").split("\n")) {
      const line = physical.trim();
      if (!line || !isCouplingLine(line)) continue;
      // Collapse any whitespace runs (LTspice sometimes double-spaces before a
      // braced coefficient) and resolve a parameterized coefficient.
      const resolved = substituteBraces(line, params).replace(/\s+/g, " ").trim();
      out.push(rewriteCouplingNames(resolved, inductorNames));
    }
  }
  return out;
}
