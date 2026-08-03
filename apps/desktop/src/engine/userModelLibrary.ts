/**
 * Parse USER-PROVIDED vendor `.lib`/`.subckt`/`.mod` file text into a lookup
 * registry (LTspice parity gap): a component may reference a model or
 * subcircuit name that is neither inline in the document, nor one of Tau's
 * bundled parts (standardModels.ts's standard.dio/bjt/jft parts,
 * bundledSubcircuits.ts's library subcircuits). Without this there is
 * nowhere to get the real definition and the device falls back to a generic
 * `TAU_*` starter model.
 *
 * The native engine's deck sanitizer (src-tauri/src/spice.rs `deck_lines`)
 * REJECTS file-backed primitives (`.include`, `.lib`, `file=`, `filename=`,
 * `pwl(file...)`), so a matched definition can only ever reach the deck by
 * INLINING its literal text - this module's entire purpose is producing that
 * literal text; it never returns a path or a `.include`/`.lib` reference.
 *
 * Recursion note: an `.include`/`.lib` line found INSIDE a supplied library
 * text is ignored rather than followed - resolving further nested vendor
 * files is a follow-up, not this unit.
 *
 * Pure and dependency-light: no filesystem access, no schematic knowledge -
 * just text in, a registry out.
 */

import { parseQuantity } from "../simulation/quantity";
import { sanitizeSubcktName } from "./bundledSubcircuits";

export interface UserModelLibraryRegistry {
  /** Model name (lower-cased) -> its full `.model` line, with any `+`
   *  continuation lines collapsed into one ngspice-valid logical line. */
  readonly models: ReadonlyMap<string, string>;
  /** Sanitized subckt name (lower-cased, via {@link sanitizeSubcktName}) ->
   *  its full `.subckt … .ends` block. The interior is preserved as the vendor
   *  wrote it except for the LTspice-only constructs ngspice rejects, which are
   *  rewritten in place (see {@link normalizeSubcktInterior}); everything
   *  ngspice already accepts stays byte-for-byte. */
  readonly subckts: ReadonlyMap<string, string>;
}

/** Strip a SPICE end-of-line `;` comment. Matches the convention already used
 *  for directive lines elsewhere (paramScope.ts's `expandDirectiveLines`) -
 *  no quote-awareness; `;` always starts a comment running to end of line. */
function stripTrailingComment(line: string): string {
  const semi = line.indexOf(";");
  return (semi >= 0 ? line.slice(0, semi) : line).trim();
}

/**
 * Drop LTspice/vendor annotation parameters whose value is a bare word
 * (`mfg=NXP`, `mfg=STMicro`, `type=Sic`, …). ngspice FATALLY rejects a `.model`
 * parameter with a non-numeric value ("Error in netlist line …"), which sinks
 * the whole deck; but a genuine device-model parameter always begins with a
 * digit, sign, or decimal point, so a value that starts with a letter is always
 * datasheet metadata, never a simulation parameter. Only those letter-valued
 * assignments are removed - the model name and type, bare flags (`pchan`),
 * every numeric parameter, and the numeric annotations ngspice merely warns
 * about and ignores (`Vceo=60`, `Icrating=10`) are all left untouched, since
 * dropping a parameter by name could silently discard a real one. Tau already
 * hand-removes these keys when curating its bundled models (standardModels.ts);
 * this does the same for user-imported files.
 */
function stripAnnotationParams(line: string): string {
  return line
    .replace(/(?<=[\s(])[A-Za-z_][\w.]*\s*=\s*[A-Za-z][^\s()]*/g, "")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Remove LTspice's bare `noiseless` device flag. ngspice has no such keyword:
 * on an R/C/L INSTANCE line it is read as an unknown model/parameter and
 * FATALLY aborts the whole deck ("unknown parameter (noiseless)" -> "incomplete
 * or empty netlist"), while inside a `.model` card ngspice merely warns and
 * ignores it. Vendor macromodels (Analog Devices' among them) tag every
 * internal passive `noiseless`, so a single unstripped flag on an instance line
 * sinks the entire imported part - a real ADI op-amp like ADA4351 (140 such
 * flags) goes from an empty netlist to a full operating point once they are
 * gone. The token is matched whole-word and case-insensitively; the whitespace
 * it leaves behind is collapsed (leading indentation preserved) so the emitted
 * card stays clean.
 */
function stripNoiselessFlag(line: string): string {
  if (!/\bnoiseless\b/i.test(line)) return line;
  const lead = /^[ \t]*/.exec(line)?.[0] ?? "";
  const body = line
    .slice(lead.length)
    .replace(/\bnoiseless\b/gi, "")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/g, "");
  return lead + body;
}

/** Emit a computed switch threshold as a clean deck token: strip the binary
 *  float noise that `(Von+Voff)/2` produces (`0.3500000000000001`) while
 *  keeping every significant digit a real threshold carries. */
function formatSwitchLevel(value: number): string {
  return String(Number(value.toPrecision(12)));
}

/**
 * Translate an LTspice switch `.model` card into the ngspice spelling. LTspice's
 * `VSWITCH`/`ISWITCH` (voltage- and current-controlled) are `SW`/`CSW` in
 * ngspice, and the threshold pair is stated differently: LTspice gives the on
 * and off control levels directly (`Von`/`Voff`, `Ion`/`Ioff`), ngspice gives a
 * center threshold plus a hysteresis half-width (`Vt`/`Vh`, `It`/`Ih`). A bare
 * rename is NOT enough - ngspice reads `von`/`voff` on an `SW` card as unknown
 * parameters and silently ignores them, leaving `Vt=Vh=0` (the switch then
 * trips at zero, not the vendor's level), so the levels must be converted:
 *   Vt = (Von + Voff) / 2,  Vh = (Von - Voff) / 2   (and likewise It/Ih).
 * `Ron`/`Roff` carry across unchanged and are re-emitted as their original
 * strings, so no SPICE suffix or precision is lost. Any bare flag in the body
 * that is not a switch parameter - notably LTspice's `noiseless` - is dropped,
 * since only the four recognized keys are re-emitted.
 *
 * A line that is not a switch `.model`, or whose `vswitch(...)`/`iswitch(...)`
 * body cannot be matched (e.g. a `+` continuation split the parentheses across
 * lines), is returned UNCHANGED - the caller then inlines it as the vendor
 * wrote it, exactly as before, rather than risk emitting a malformed card.
 */
export function translateSwitchModelCard(line: string): string {
  const match = /^\s*\.model\s+(\S+)\s+(vswitch|iswitch)\s*\(([^()]*)\)/i.exec(line);
  if (!match) return line;
  const [, name, kind, body] = match;
  const isVoltage = kind.toLowerCase() === "vswitch";

  // key -> raw value string, from `key=value` pairs (comma OR whitespace
  // separated). Bare tokens (e.g. `noiseless`) have no `=` and are skipped.
  const params = new Map<string, string>();
  for (const pair of body.matchAll(/([A-Za-z_]\w*)\s*=\s*([^\s,()]+)/g)) {
    params.set(pair[1].toLowerCase(), pair[2]);
  }

  const on = params.get(isVoltage ? "von" : "ion");
  const off = params.get(isVoltage ? "voff" : "ioff");
  const ron = params.get("ron");
  const roff = params.get("roff");

  const out: string[] = [];
  if (ron !== undefined) out.push(`RON=${ron}`);
  if (roff !== undefined) out.push(`ROFF=${roff}`);
  if (on !== undefined && off !== undefined) {
    let onVal: number;
    let offVal: number;
    try {
      onVal = parseQuantity(on);
      offVal = parseQuantity(off);
    } catch {
      return line; // an unparseable threshold: leave the whole card untouched.
    }
    const tKey = isVoltage ? "VT" : "IT";
    const hKey = isVoltage ? "VH" : "IH";
    out.push(`${tKey}=${formatSwitchLevel((onVal + offVal) / 2)}`);
    out.push(`${hKey}=${formatSwitchLevel((onVal - offVal) / 2)}`);
  }

  return `.model ${name} ${isVoltage ? "SW" : "CSW"}(${out.join(" ")})`;
}

/**
 * Rewrite the LTspice-only constructs inside a captured `.subckt` block that
 * ngspice's build rejects, so an inlined vendor macromodel actually simulates.
 * The transform is deliberately SURGICAL and line-gated - every line ngspice
 * already accepts passes through byte-for-byte; only these constructs change:
 *   - a switch `.model` card (`VSWITCH`/`ISWITCH`), via
 *     {@link translateSwitchModelCard};
 *   - a voltage-switch instance (`Sxxx n+ n- (nc+,nc-) MODEL`), whose control
 *     nodes LTspice wraps in parentheses - ngspice wants them bare, so the
 *     parentheses are removed and any comma inside becomes a space. Current
 *     switches (`Wxxx n+ n- Vsource MODEL`) name their control source and carry
 *     no such parentheses, so they are left alone;
 *   - a bare `noiseless` device flag on any instance or `.model` line, via
 *     {@link stripNoiselessFlag} - fatal on an instance line, so it must go.
 * Full-line comments (`*`/`;`) are left untouched. Everything else (transistor
 * models, POLY sources, passives) is already valid ngspice and stays exactly as
 * the vendor wrote it.
 */
function normalizeSubcktInterior(block: string): string {
  return block
    .split("\n")
    .map((line) => {
      if (/^\s*[*;]/.test(line)) return line;
      if (/^\s*\.model\b/i.test(line)) return stripNoiselessFlag(translateSwitchModelCard(line));
      let out = line;
      if (/^\s*S[\w$]/i.test(out) && out.includes("(")) {
        out = out.replace(/\(([^()]*)\)/, (_full, inner: string) => inner.replace(/,/g, " ").trim());
      }
      return stripNoiselessFlag(out);
    })
    .join("\n");
}

/**
 * Parse one or more raw vendor library file texts into a combined registry.
 * When the same model/subckt name appears more than once (within one file or
 * across several), the FIRST definition wins and later duplicates are
 * ignored - consistent with how the deck builder's own dedup sets treat a
 * name as claimed once it is known (spiceNetlist.ts's `knownModels`/
 * `emittedSubckts`). A `.model` line is stored with its LTspice string-valued
 * annotation parameters removed (see {@link stripAnnotationParams}) and its
 * bare `noiseless` flag stripped (see {@link stripNoiselessFlag}) so the inlined
 * card actually loads in ngspice; `.subckt` blocks are captured as the vendor
 * wrote them except for the LTspice-only constructs ngspice rejects, which are
 * normalized in place (see {@link normalizeSubcktInterior}).
 *
 * This "first wins" rule is deterministic across two attached libraries that
 * both define the same name: `texts` is walked in array order, and the caller
 * always builds that array from the schematic's `userModelLibraries` in
 * attachment order (each `attachModelLibrary` call appends - see
 * store/useSchematic.ts) - so "first in `texts`" always means "first
 * attached", never an arbitrary iteration order.
 */
export function parseUserModelLibraries(texts: readonly string[]): UserModelLibraryRegistry {
  const models = new Map<string, string>();
  const subckts = new Map<string, string>();

  for (const text of texts) {
    const rawLines = text.replace(/\r\n/g, "\n").split("\n");
    let i = 0;
    while (i < rawLines.length) {
      const trimmed = rawLines[i].trim();

      // Blank lines and full-line `*` comments carry no definition.
      if (trimmed === "" || trimmed.startsWith("*")) {
        i += 1;
        continue;
      }

      // `.subckt … .ends`: captured verbatim, nesting-aware. A block may
      // legitimately contain its own nested `.subckt`/`.model`/comments;
      // touching the interior risks corrupting text ngspice already accepts
      // as-is, so only the outer span is sliced out and stored untouched.
      if (/^\.subckt\b/i.test(trimmed)) {
        const start = i;
        let depth = 1;
        i += 1;
        while (i < rawLines.length && depth > 0) {
          const inner = rawLines[i].trim();
          if (/^\.subckt\b/i.test(inner)) depth += 1;
          else if (/^\.ends\b/i.test(inner)) depth -= 1;
          i += 1;
        }
        const block = normalizeSubcktInterior(rawLines.slice(start, i).join("\n").trimEnd());
        const name = /^\.subckt\s+([^\s(]+)/i.exec(trimmed)?.[1];
        if (name) {
          const key = sanitizeSubcktName(name).toLowerCase();
          if (!subckts.has(key)) subckts.set(key, block);
        }
        continue;
      }

      // `.include`/`.lib`: a further file this unit does not recurse into -
      // skip so it never leaks into deck output as a bare directive the
      // native sanitizer would reject.
      if (/^\.(?:include|lib)\b/i.test(trimmed)) {
        i += 1;
        continue;
      }

      // `.model`, with any `+`-continuation lines folded into one logical
      // line - the same fold paramScope.ts's `expandDirectiveLines` applies
      // to single-line directives, so the stored text is always one
      // ngspice-ready line regardless of how the vendor file wrapped it.
      if (/^\.model\b/i.test(trimmed)) {
        const parts = [stripTrailingComment(trimmed)];
        i += 1;
        while (i < rawLines.length) {
          const cont = rawLines[i].trim();
          if (!cont.startsWith("+")) break;
          parts.push(stripTrailingComment(cont.slice(1).trim()));
          i += 1;
        }
        const line = stripNoiselessFlag(translateSwitchModelCard(
          stripAnnotationParams(parts.filter((part) => part !== "").join(" ")),
        ));
        const name = /^\.model\s+([^\s(]+)/i.exec(line)?.[1];
        if (name) {
          const key = name.toLowerCase();
          if (!models.has(key)) models.set(key, line);
        }
        continue;
      }

      // Anything else (.param, .options, other directives, …) carries no
      // model/subckt definition for this registry - skip.
      i += 1;
    }
  }

  return { models, subckts };
}

/**
 * Look up a `.model` line by name (case-insensitive), tolerating a value that
 * carries trailing tokens after the name - the same calling convention as
 * standardModels.ts's `standardModelLine`. Returns `null` when the registry
 * has no such model.
 */
export function resolveUserModel(registry: UserModelLibraryRegistry, name: string): string | null {
  const key = name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return key ? registry.models.get(key) ?? null : null;
}

/**
 * Look up a `.subckt … .ends` block by name (case-insensitive, sanitized like
 * {@link sanitizeSubcktName}), tolerating a value that carries trailing
 * instance params - the same calling convention as bundledSubcircuits.ts's
 * `bundledSubcircuitBlock`. Returns `null` when the registry has no such
 * subckt.
 */
export function resolveUserSubckt(registry: UserModelLibraryRegistry, name: string): string | null {
  const first = name.trim().split(/\s+/)[0] ?? "";
  if (!first) return null;
  return registry.subckts.get(sanitizeSubcktName(first).toLowerCase()) ?? null;
}
