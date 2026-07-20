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

import { sanitizeSubcktName } from "./bundledSubcircuits";

export interface UserModelLibraryRegistry {
  /** Model name (lower-cased) -> its full `.model` line, with any `+`
   *  continuation lines collapsed into one ngspice-valid logical line. */
  readonly models: ReadonlyMap<string, string>;
  /** Sanitized subckt name (lower-cased, via {@link sanitizeSubcktName}) ->
   *  its full `.subckt … .ends` block, verbatim (interior untouched). */
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
 * Parse one or more raw vendor library file texts into a combined registry.
 * When the same model/subckt name appears more than once (within one file or
 * across several), the FIRST definition wins and later duplicates are
 * ignored - consistent with how the deck builder's own dedup sets treat a
 * name as claimed once it is known (spiceNetlist.ts's `knownModels`/
 * `emittedSubckts`).
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
        const block = rawLines.slice(start, i).join("\n").trimEnd();
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
        const line = parts.filter((part) => part !== "").join(" ");
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
