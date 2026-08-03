/**
 * Carry a document's `.model` / `.lib` / `.inc`(`.include`) / `.subckt`…`.ends`
 * directives through to the native ngspice deck (LTspice parity).
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

import { translateSwitchModelCard } from "./userModelLibrary";

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
/**
 * Collect the set of model/subckt *names* a document defines (lower-cased), from
 * its `.model <name> …` and `.subckt <name> …` directives (multi-line blocks
 * included). Lets the deck builder safely reference a semiconductor's own model
 * name only when that model is actually present, falling back to Tau's generic
 * starters otherwise - so this never introduces an "undefined model" error.
 */
export function definedModelNames(directives: ReadonlyArray<string>): Set<string> {
  const names = new Set<string>();
  for (const raw of directives) {
    for (const line of raw.replace(/\\n/g, "\n").split("\n")) {
      const m = /^[.!]?(model|subckt)\b\s+([^\s(]+)/i.exec(line.trim());
      if (m) names.add(m[2].toLowerCase());
    }
  }
  return names;
}

/**
 * The subset of `definedModelNames` that are `.subckt` definitions (lower-cased).
 * LTspice lets a semiconductor symbol's Value name a subcircuit instead of a
 * `.model` (UHFpreamp's BJT is `Q1 … MRF901` over `.subckt MRF901 c b e`) and
 * silently netlists the device as an `X` instance; ngspice does not, so the
 * deck builder needs to know which names demand that rewrite.
 */
export function definedSubcktNames(directives: ReadonlyArray<string>): Set<string> {
  const names = new Set<string>();
  for (const raw of directives) {
    for (const line of raw.replace(/\\n/g, "\n").split("\n")) {
      const m = /^[.!]?subckt\b\s+([^\s(]+)/i.exec(line.trim());
      if (m) names.add(m[1].toLowerCase());
    }
  }
  return names;
}

/**
 * Map every document-defined `.model <name> <type>(…)` to its type token
 * (both lower-cased). Lets the deck builder distinguish a 3-terminal **VDMOS**
 * power MOSFET - whose ngspice device line is `M nd ng ns model` - from an
 * ordinary 4-terminal level-1 MOS (`M nd ng ns nb model`). Emitting the 4-node
 * form against a VDMOS model silently reinterprets the bulk node as the model's
 * optional thermal node (or floats it), so the device must drop the bulk pin.
 * Subckts have no model type and are skipped.
 */
export function definedModelTypes(directives: ReadonlyArray<string>): Map<string, string> {
  const types = new Map<string, string>();
  for (const raw of directives) {
    for (const line of raw.replace(/\\n/g, "\n").split("\n")) {
      const m = /^[.!]?model\b\s+([^\s(]+)\s+([A-Za-z][\w-]*)/i.exec(line.trim());
      if (m) types.set(m[1].toLowerCase(), m[2].toLowerCase());
    }
  }
  return types;
}

/**
 * ngspice has no lateral-BJT model types: LTspice's `LPNP`/`LNPN` (used by the
 * discrete LM741/LM308 demos) must become plain `PNP`/`NPN`, or ngspice reports
 * "Unknown model type lpnp - ignored" and every transistor on that model fails
 * with a type mismatch. Rewrites only the model-type token on a `.model` line.
 */
function translateModelType(line: string): string {
  const translated = line.replace(/^(\.model\s+\S+\s+)l(pnp|npn)\b/i, (_m, head: string, type: string) => `${head}${type.toUpperCase()}`);
  return stripInformationalDiodeParams(translateSwitchModelCard(translated));
}

/**
 * LTspice diode models carry informational-only parameters (`type=silicon`,
 * `mfg=OnSemi`) whose values are bare words. ngspice tries to evaluate the word
 * as an expression and dies with "Undefined parameter [silicon]" (P2.asc's
 * `.model 1N484 D(Rs=3 Cjo=4p type=silicon)`), killing the whole deck - so
 * strip them from `.model … D(…)` lines. Numeric informational params (Vpk,
 * Iave, …) only draw a warning and are left alone.
 */
function stripInformationalDiodeParams(line: string): string {
  if (!/^\.model\s+\S+\s+D\s*\(/i.test(line)) return line;
  return line.replace(/\s*\b(?:type|mfg)=[^\s()]+/gi, "").replace(/\(\s+/, "(");
}

export function modelLibLinesFromDirectives(directives: ReadonlyArray<string>): string[] {
  const out: string[] = [];
  // A logical SPICE block may be split across multiple LTspice TEXT records.
  // Keep block/continuation state for the entire ordered directive stream,
  // rather than resetting it at each annotation boundary.
  let subcktDepth = 0;
  let prevEmitted = false;
  for (const raw of directives) {
    // LTspice encodes multi-line TEXT blocks with a literal backslash-n. One
    // block freely MIXES kinds (SoftDiodeRecovery: `.tran 0 60u\n.model X …`;
    // UHFpreamp opens its `.subckt MRF901` block with `*` copyright comments),
    // so each physical line is dispatched on its own keyword - gating on the
    // block's first line silently drops models the circuit depends on, and
    // conversely leaks `.tran`/`.step` lines from a model-led block.
    for (const physical of raw.replace(/\\n/g, "\n").split("\n")) {
      const trimmed = physical.trim();
      if (!trimmed) continue;
      const keyword = leadingKeyword(trimmed);
      if (subcktDepth > 0) {
        // Inside a `.subckt` body everything is emitted verbatim - instances,
        // nested models (still lateral-BJT translated), comments, `.ends`.
        if (keyword === "subckt") subcktDepth += 1;
        else if (keyword === "ends") subcktDepth -= 1;
        out.push(translateModelType(trimmed));
        prevEmitted = true;
      } else if (trimmed.startsWith("+")) {
        if (prevEmitted) out.push(trimmed);
      } else if (BLOCK_KEYWORDS.includes(keyword as (typeof BLOCK_KEYWORDS)[number])) {
        if (keyword === "subckt") subcktDepth = 1;
        out.push(translateModelType(normalizeOpeningLine(trimmed)));
        prevEmitted = true;
      } else {
        prevEmitted = false;
      }
    }
  }
  return out;
}
