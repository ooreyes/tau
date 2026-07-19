/**
 * Resolve LTspice `.param` / `.func` directives into a numeric scope, and
 * evaluate component value fields that reference them (the `{...}` brace syntax).
 *
 * `.param` is the single most-used directive in the user's circuits (180×), and
 * nothing simulates correctly until `{R*2}`, `{1/(2*pi*f)}` and friends resolve.
 * Params may reference each other in any order, so resolution is an iterative
 * fixpoint with cycle detection.
 */

import { evaluateExpression, type FuncDef, type Scope } from "./expr";
import { parseStepDirective } from "./paramStep";
import type { SchematicComponent } from "../schematic/types";

export interface ParamScope {
  scope: Scope;
  funcs: Record<string, FuncDef>;
}

export const EMPTY_SCOPE: ParamScope = { scope: {}, funcs: {} };

/** Strip a directive's leading `.param` / `.func` keyword (case-insensitive). */
function stripKeyword(line: string, keyword: string): string | null {
  const m = line.trim().match(new RegExp(`^\\.${keyword}\\b\\s*(.*)$`, "is"));
  return m ? m[1] : null;
}

const isAssignEq = (s: string, i: number): boolean =>
  s[i] === "=" && s[i - 1] !== "<" && s[i - 1] !== ">" && s[i - 1] !== "!" && s[i - 1] !== "=" && s[i + 1] !== "=";

/** Scan back over whitespace then word chars to find the assignment's LHS name. */
function nameBefore(s: string, eqPos: number): { name: string; start: number } {
  let j = eqPos - 1;
  while (j >= 0 && /\s/.test(s[j])) j--;
  const end = j + 1;
  while (j >= 0 && /[A-Za-z0-9_]/.test(s[j])) j--;
  return { name: s.slice(j + 1, end), start: j + 1 };
}

/**
 * Split a `.param` body holding one or more `name=expr` assignments. Values may
 * contain spaces and braces (`a = 2 * b`), so each value runs up to the start of
 * the next assignment's name rather than to the next whitespace.
 */
export function parseParamAssignments(body: string): Array<{ name: string; expr: string }> {
  const eqs: number[] = [];
  for (let i = 0; i < body.length; i++) if (isAssignEq(body, i)) eqs.push(i);
  if (eqs.length === 0) {
    // Tolerate the rare "name value" form (no '=').
    const m = body.trim().match(/^([A-Za-z_]\w*)\s+(.+)$/s);
    return m ? [{ name: m[1], expr: m[2].trim() }] : [];
  }
  const out: Array<{ name: string; expr: string }> = [];
  for (let i = 0; i < eqs.length; i++) {
    const { name } = nameBefore(body, eqs[i]);
    const valStart = eqs[i] + 1;
    const valEnd = i + 1 < eqs.length ? nameBefore(body, eqs[i + 1]).start : body.length;
    const expr = body.slice(valStart, valEnd).trim();
    if (name) out.push({ name, expr });
  }
  return out;
}

/** Parse a `.func name(a,b) body` / `.func name(a,b)=body` directive. */
export function parseFuncDirective(body: string): { name: string; def: FuncDef } | null {
  const m = body.trim().match(/^([A-Za-z_]\w*)\s*\(([^)]*)\)\s*=?\s*(.+)$/s);
  if (!m) return null;
  const params = m[2]
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return { name: m[1], def: { params, body: stripBraces(m[3]) } };
}

/** Remove LTspice grouping braces; they map to parentheses we already support. */
function stripBraces(s: string): string {
  return s.replace(/[{}]/g, " ").trim();
}

/**
 * Build a resolved param scope from a list of directive strings (each may carry
 * a leading `.`). Unrecognized directives are ignored. Throws if a `.param`
 * references an undefined name or forms a dependency cycle.
 */
/**
 * Expand directive strings into individual physical lines: LTspice packs a
 * whole multi-line directive block into one `TEXT` entry using a literal `\n`
 * escape (e.g. `.param x=.54 ; pos\n.param R=50\n.param L=2.95u …`), and lines
 * may carry a trailing `;` comment. Split on the `\n` escape, drop the comment,
 * and trim, so each `.param`/`.func` line parses cleanly.
 */
export function expandDirectiveLines(directives: string[]): string[] {
  const out: string[] = [];
  for (const raw of directives) {
    for (const physical of raw.replace(/\\n/g, "\n").split("\n")) {
      const semi = physical.indexOf(";");
      const line = (semi >= 0 ? physical.slice(0, semi) : physical).trim();
      if (!line) continue;
      // A leading `+` is SPICE line continuation (P2's `K1 L4 L5\n+ L6 L7 1`):
      // fold it into the previous directive so single-line consumers see the
      // whole logical line instead of a truncated one plus an orphan.
      if (line.startsWith("+") && out.length > 0) {
        out[out.length - 1] += ` ${line.slice(1).trim()}`;
      } else {
        out.push(line);
      }
    }
  }
  return out;
}

/** A param scope plus the `.param` assignments that could NOT be evaluated
 *  (they reference an enclosing scope, e.g. a subcircuit body's
 *  `.param Co=1/({f}*2k*PI)` whose `f` is bound by the instance). */
export interface PartialParamScope extends ParamScope {
  unresolved: Map<string, string>;
}

export function buildParamScope(directives: string[]): ParamScope {
  const partial = buildPartialParamScope(directives);
  if (partial.unresolved.size > 0) {
    const names = [...partial.unresolved.keys()].join(", ");
    throw new Error(`Unresolvable .param definitions (cycle or undefined): ${names} - ${partial.lastError}`);
  }
  return { scope: partial.scope, funcs: partial.funcs };
}

/** Like {@link buildParamScope} but never throws: evaluates every assignment it
 *  can and reports the rest (name → raw expression) in `unresolved`. */
export function buildPartialParamScope(directives: string[]): PartialParamScope & { lastError: string } {
  const funcs: Record<string, FuncDef> = {};
  const assignments: Array<{ name: string; expr: string }> = [];

  for (const raw of expandDirectiveLines(directives)) {
    const funcBody = stripKeyword(raw, "func");
    if (funcBody !== null) {
      const parsed = parseFuncDirective(funcBody);
      if (parsed) funcs[parsed.name.toLowerCase()] = parsed.def;
      continue;
    }
    // LTspice accepts both `.param` and the plural `.params` for definitions.
    const paramBody = stripKeyword(raw, "params") ?? stripKeyword(raw, "param");
    if (paramBody !== null) {
      for (const a of parseParamAssignments(paramBody)) {
        assignments.push({ name: a.name, expr: stripBraces(a.expr) });
      }
    }
  }

  // Later assignments override earlier ones (LTspice last-definition-wins).
  const pending = new Map<string, string>();
  for (const a of assignments) pending.set(a.name, a.expr);

  // Seed each `.step param X …` swept variable with its FIRST value so a default
  // (non-stepped) run can resolve `{X}` component values - a stepped run later
  // overrides X per value via `withStepValue`. (Imported deferred to avoid a
  // top-level cycle; used only here in the function body.)
  for (const line of expandDirectiveLines(directives)) {
    if (!/^\.step\b/i.test(line)) continue;
    const spec = parseStepDirective(line);
    if (spec?.kind === "param" && spec.name && spec.values.length > 0) {
      pending.set(spec.name, String(spec.values[0]));
    }
  }

  const scope: Scope = {};
  const setScope = (name: string, v: number) => {
    scope[name] = v;
    scope[name.toLowerCase()] = v;
  };

  let remaining = Array.from(pending.entries());
  let lastError = "";
  while (remaining.length > 0) {
    const next: Array<[string, string]> = [];
    let progressed = false;
    for (const [name, expr] of remaining) {
      try {
        setScope(name, evaluateExpression(expr, scope, funcs));
        progressed = true;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        next.push([name, expr]);
      }
    }
    if (!progressed) break;
    remaining = next;
  }

  // Lowercased keys - SPICE names are case-insensitive and every consumer
  // looks identifiers up in lowercase.
  return { scope, funcs, unresolved: new Map(remaining.map(([name, expr]) => [name.toLowerCase(), expr])), lastError };
}

/**
 * Evaluate a component value field to a number, resolving `{...}` expressions and
 * bare param references against the scope. Plain quantities ("10k") pass straight
 * through. Throws on empty/unparseable input (e.g. a model name).
 */
export function evaluateValueExpr(value: string, ctx: ParamScope = EMPTY_SCOPE): number {
  const stripped = stripBraces(value);
  if (!stripped) throw new Error("Empty value expression");
  return evaluateExpression(stripped, ctx.scope, ctx.funcs);
}

/**
 * Does this value field need expression evaluation (vs. a plain quantity)?
 * True when it contains braces, an operator, or a function/param reference.
 */
export function isExpression(value: string): boolean {
  return /[{}]/.test(value) || /[+\-*/^()]/.test(value.replace(/^[-+]?\d*\.?\d+(e[-+]?\d+)?/i, ""));
}

/** Format an evaluated number as a plain SPICE-parseable literal (no µ/prefix). */
function spiceNumber(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`Expression produced a non-finite value (${v})`);
  return String(v);
}

/**
 * Substitute every `{expr}` occurrence in a value string with its evaluated
 * numeric literal, exactly as LTspice does before handing the deck to the
 * engine. Leaves the rest of the string (compound source specs like
 * `PULSE(0 {Vhi} ...)`, model names, units) untouched.
 */
export function substituteBraces(text: string, ctx: ParamScope = EMPTY_SCOPE): string {
  if (!text.includes("{")) return text;
  return text.replace(/\{([^{}]*)\}/g, (_match, inner: string) => spiceNumber(evaluateExpression(inner, ctx.scope, ctx.funcs)));
}

/**
 * Like {@link substituteBraces}, but lenient: a brace whose expression cannot
 * be evaluated in `ctx` is kept verbatim instead of throwing. For deck
 * passthrough of document `.model`/`.lib` lines (LTspice evaluates `{…}`
 * against the global `.param` scope there - Fc.asc's
 * `.model DX D(Cjo={Cjo} …)`), where an unresolvable name may still be
 * legitimate for ngspice to resolve later (e.g. inside a `.subckt` body with
 * its own params, which the caller must NOT route through this).
 */
export function substituteKnownBraces(text: string, ctx: ParamScope = EMPTY_SCOPE): string {
  if (!text.includes("{")) return text;
  return text.replace(/\{([^{}]*)\}/g, (match, inner: string) => {
    try {
      return spiceNumber(evaluateExpression(inner, ctx.scope, ctx.funcs));
    } catch {
      return match;
    }
  });
}

/** Identifiers a behavioral expression legitimately resolves at RUN time -
 *  never substitute these even when a same-named param exists. */
const RUNTIME_IDENTIFIERS = new Set(["time", "pi", "temp", "temper", "hertz", "true", "false"]);

/**
 * Textually replace known `.param` names inside a behavioral expression with
 * their numeric values, leaving everything the engine resolves at run time
 * intact: `time`-like keywords, function calls, and the arguments of
 * `V(...)`/`I(...)`/`x(...)` accessors (whose node names may collide with a
 * param name). LTspice lets subcircuit B-sources reference params bare (e.g.
 * PowerSim's TIMER: `V=IF(time>=T,1,0)` with `.param T=1m`), so flattening and
 * deck-building must bind those names before ngspice parses the expression.
 */
export function substituteScopeIdentifiers(expr: string, ctx: ParamScope = EMPTY_SCOPE): string {
  return substituteIdentifiers(expr, (word) => {
    const exact = word in ctx.scope ? word : word.toLowerCase();
    if (!RUNTIME_IDENTIFIERS.has(word.toLowerCase()) && exact in ctx.scope && Number.isFinite(ctx.scope[exact])) {
      return spiceNumber(ctx.scope[exact]);
    }
    return null;
  });
}

/**
 * Textually replace bare identifiers with raw EXPRESSIONS from `map` (keys
 * lowercase), parenthesized, with any braces inside the expression flattened
 * to parens so the result can legally sit inside an enclosing `{…}`. Used for
 * subcircuit params whose values only an enclosing scope can evaluate.
 */
export function substituteIdentifierExpressions(expr: string, map: Map<string, string>): string {
  return substituteIdentifiers(expr, (word) => {
    const replacement = map.get(word.toLowerCase());
    if (replacement === undefined || RUNTIME_IDENTIFIERS.has(word.toLowerCase())) return null;
    return `(${replacement.replace(/\{/g, "(").replace(/\}/g, ")")})`;
  });
}

/**
 * Textually inline `.func` calls in a behavioral expression: `Voc(V(soc))`
 * becomes the func body with each parameter replaced by its (parenthesized)
 * argument text. LTspice resolves `.func` late from the subckt scope; the
 * flattened deck drops those directives, so run-time expressions (PowerSim's
 * BATTERY_ECM `V = s * Voc(V(soc))` with table-lookup funcs) must be expanded
 * here. Recursion is depth-capped; unknown functions pass through untouched.
 */
export function inlineFuncCalls(expr: string, funcs: Record<string, FuncDef>, depth = 0): string {
  if (depth > 8 || Object.keys(funcs).length === 0) return expr;
  let out = "";
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (!/[A-Za-z_]/.test(ch)) {
      out += ch;
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < expr.length && /\w/.test(expr[j])) j += 1;
    const word = expr.slice(i, j);
    let k = j;
    while (k < expr.length && /\s/.test(expr[k])) k += 1;
    if (expr[k] !== "(") {
      out += word;
      i = j;
      continue;
    }
    // Balanced argument group.
    let paren = 0;
    let m = k;
    while (m < expr.length) {
      if (expr[m] === "(") paren += 1;
      else if (expr[m] === ")") paren -= 1;
      m += 1;
      if (paren === 0) break;
    }
    const def = funcs[word.toLowerCase()];
    if (!def) {
      if (/^[vix]$/i.test(word)) {
        out += expr.slice(i, m); // node/branch accessor - verbatim
      } else {
        out += word + "(" + inlineFuncCalls(expr.slice(k + 1, m - 1), funcs, depth + 1) + ")";
      }
      i = m;
      continue;
    }
    const args = splitTopLevelCommas(expr.slice(k + 1, m - 1)).map((a) => inlineFuncCalls(a.trim(), funcs, depth + 1));
    if (args.length !== def.params.length) {
      out += expr.slice(i, m); // arity mismatch - leave for the engine to report
      i = m;
      continue;
    }
    const body = substituteIdentifiers(def.body, (w) => {
      const index = def.params.findIndex((p) => p.toLowerCase() === w.toLowerCase());
      return index >= 0 ? `(${args[index]})` : null;
    });
    out += `(${inlineFuncCalls(body, funcs, depth + 1)})`;
    i = m;
  }
  return out;
}

/** Split on top-level commas (ignoring commas inside nested parens). */
function splitTopLevelCommas(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Shared scanner: walks `expr`, calls `resolve` on each bare identifier
 *  (skipping function names and the balanced argument group of V(...)/I(...)/
 *  x(...) accessors), and splices in the replacement when non-null. */
function substituteIdentifiers(expr: string, resolve: (word: string) => string | null): string {
  let out = "";
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (!/[A-Za-z_]/.test(ch)) {
      out += ch;
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < expr.length && /\w/.test(expr[j])) j += 1;
    const word = expr.slice(i, j);
    let k = j;
    while (k < expr.length && /\s/.test(expr[k])) k += 1;
    if (expr[k] === "(") {
      if (/^[vix]$/i.test(word)) {
        // Node/branch accessor: copy the balanced paren group verbatim.
        let depth = 0;
        let m = k;
        while (m < expr.length) {
          if (expr[m] === "(") depth += 1;
          else if (expr[m] === ")") depth -= 1;
          m += 1;
          if (depth === 0) break;
        }
        out += expr.slice(i, m);
        i = m;
        continue;
      }
      out += word; // function name - arguments recurse through the main loop
      i = j;
      continue;
    }
    out += resolve(word) ?? word;
    i = j;
    continue;
  }
  return out;
}

/**
 * Brace resolution for behavioral (`V=`/`I=`/`R=`) values: evaluate each `{…}`
 * that the param scope can satisfy; where evaluation fails (typically because
 * the expression needs run-time state such as `time` or `V(node)` - LTspice
 * tolerates these inside braces and PowerSim relies on it), substitute the
 * known params textually and UNWRAP the braces so the engine evaluates the
 * remainder at run time instead of numparam choking on it.
 */
export function substituteBehavioralBraces(text: string, ctx: ParamScope = EMPTY_SCOPE): string {
  if (!text.includes("{")) return text;
  return text.replace(/\{([^{}]*)\}/g, (_match, inner: string) => {
    try {
      return spiceNumber(evaluateExpression(inner, ctx.scope, ctx.funcs));
    } catch {
      return `(${substituteScopeIdentifiers(inner, ctx)})`;
    }
  });
}

/**
 * Return a copy of `components` with every `{expr}` in each value resolved
 * against `ctx`. Components without brace expressions are returned untouched
 * (and the whole list is returned as-is when there are no params), so the
 * common no-parameter circuit pays nothing.
 */
export function resolveComponentValues(components: SchematicComponent[], ctx: ParamScope = EMPTY_SCOPE): SchematicComponent[] {
  if (Object.keys(ctx.scope).length === 0 && Object.keys(ctx.funcs).length === 0) return components;
  return components.map((component) =>
    component.value && component.value.includes("{")
      ? { ...component, value: substituteBraces(component.value, ctx) }
      : component,
  );
}
