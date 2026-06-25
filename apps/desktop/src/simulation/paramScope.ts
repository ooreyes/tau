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
export function buildParamScope(directives: string[]): ParamScope {
  const funcs: Record<string, FuncDef> = {};
  const assignments: Array<{ name: string; expr: string }> = [];

  for (const raw of directives) {
    const funcBody = stripKeyword(raw, "func");
    if (funcBody !== null) {
      const parsed = parseFuncDirective(funcBody);
      if (parsed) funcs[parsed.name.toLowerCase()] = parsed.def;
      continue;
    }
    const paramBody = stripKeyword(raw, "param");
    if (paramBody !== null) {
      for (const a of parseParamAssignments(paramBody)) {
        assignments.push({ name: a.name, expr: stripBraces(a.expr) });
      }
    }
  }

  // Later assignments override earlier ones (LTspice last-definition-wins).
  const pending = new Map<string, string>();
  for (const a of assignments) pending.set(a.name, a.expr);

  const scope: Scope = {};
  const setScope = (name: string, v: number) => {
    scope[name] = v;
    scope[name.toLowerCase()] = v;
  };

  let remaining = Array.from(pending.entries());
  while (remaining.length > 0) {
    const next: Array<[string, string]> = [];
    let progressed = false;
    let lastError = "";
    for (const [name, expr] of remaining) {
      try {
        setScope(name, evaluateExpression(expr, scope, funcs));
        progressed = true;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        next.push([name, expr]);
      }
    }
    if (!progressed) {
      const names = next.map(([n]) => n).join(", ");
      throw new Error(`Unresolvable .param definitions (cycle or undefined): ${names} — ${lastError}`);
    }
    remaining = next;
  }

  return { scope, funcs };
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
