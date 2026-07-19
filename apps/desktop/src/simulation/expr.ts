/**
 * LTspice/SPICE expression evaluator.
 *
 * Evaluates the `{...}` brace expressions and `.param`/`.func` bodies that
 * pervade real LTspice circuits (`.param` is used 180× across the user's files).
 * Pure arithmetic over a numeric scope - no side effects, no schematic access -
 * which keeps it trivially testable with hand-computed expected values.
 *
 * Grammar (precedence low → high):
 *   ternary   ? :
 *   logical   || (and `|`)   &&  (and `&`)
 *   equality  ==  !=
 *   relational <  <=  >  >=
 *   additive  +  -
 *   multiplicative  *  /  %
 *   unary     -  +  !
 *   power     ^  **   (right-associative, binds tighter than unary minus on the
 *             left so that -2^2 = -4, matching LTspice/SPICE)
 *   primary   number | ident | ident(args...) | ( expr )
 *
 * Numbers accept SI suffixes (1k, 2.2meg, 10n, 1mil) and an optional trailing
 * unit that is ignored (5V, 1kOhm), exactly like ngspice value parsing.
 */

export type Scope = Record<string, number>;

/** A user-defined `.func`: parameter names + an unparsed body expression. */
export interface FuncDef {
  params: string[];
  body: string;
}

export interface EvalContext {
  scope: Scope;
  funcs: Record<string, FuncDef>;
}

// --- numeric literal suffixes -------------------------------------------------

const PREFIX: Record<string, number> = {
  f: 1e-15,
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  µ: 1e-6,
  m: 1e-3,
  mil: 25.4e-6,
  k: 1e3,
  meg: 1e6,
  g: 1e9,
  t: 1e12,
};

/** Resolve a numeric literal's alpha suffix to a multiplier (LTspice rules). */
function suffixMultiplier(raw: string): number {
  if (!raw) return 1;
  const s = raw.toLowerCase();
  // Longest known prefixes first so "meg" wins over "m", "mil" over "m".
  if (s.startsWith("meg")) return PREFIX.meg;
  if (s.startsWith("mil")) return PREFIX.mil;
  const first = PREFIX[s[0]];
  // Unknown leading letter (a bare unit like "Ohm") → no scaling, value as-is.
  return first ?? 1;
}

// --- tokenizer ----------------------------------------------------------------

type Tok =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: string };

const TWO_CHAR_OPS = new Set(["**", "<=", ">=", "==", "!=", "&&", "||"]);

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    // number: digits / leading dot, optional exponent, optional alpha suffix
    if ((c >= "0" && c <= "9") || (c === "." && src[i + 1] >= "0" && src[i + 1] <= "9")) {
      let j = i;
      while (j < n && ((src[j] >= "0" && src[j] <= "9") || src[j] === ".")) j++;
      // exponent only when followed by a digit (so trailing "e" stays a unit)
      if (j < n && (src[j] === "e" || src[j] === "E")) {
        let k = j + 1;
        if (src[k] === "+" || src[k] === "-") k++;
        if (src[k] >= "0" && src[k] <= "9") {
          k++;
          while (k < n && src[k] >= "0" && src[k] <= "9") k++;
          j = k;
        }
      }
      const mantissa = Number(src.slice(i, j));
      // alpha suffix (SI prefix + optional unit letters)
      let s = j;
      while (s < n && /[a-zA-Zµ]/.test(src[s])) s++;
      const suffix = src.slice(j, s);
      if (!Number.isFinite(mantissa)) throw new Error(`Bad number in expression: "${src.slice(i, s)}"`);
      toks.push({ t: "num", v: mantissa * suffixMultiplier(suffix) });
      i = s;
      continue;
    }
    // identifier
    if (/[a-zA-Zµ_]/.test(c)) {
      let j = i;
      while (j < n && /[a-zA-Z0-9µ_]/.test(src[j])) j++;
      toks.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    // operators
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      toks.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/%^()<>=!&|,?:".includes(c)) {
      toks.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${c}" in expression`);
  }
  return toks;
}

// --- parser (to AST) ----------------------------------------------------------

export type Node =
  | { k: "num"; v: number }
  | { k: "var"; name: string }
  | { k: "call"; name: string; args: Node[] }
  | { k: "unary"; op: string; x: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "tern"; c: Node; a: Node; b: Node };

class Parser {
  private p = 0;
  constructor(private toks: Tok[]) {}

  parse(): Node {
    const node = this.ternary();
    if (this.p < this.toks.length) throw new Error("Trailing tokens in expression");
    return node;
  }

  private peek(): Tok | undefined {
    return this.toks[this.p];
  }
  private eatOp(v: string): boolean {
    const tk = this.toks[this.p];
    if (tk && tk.t === "op" && tk.v === v) {
      this.p++;
      return true;
    }
    return false;
  }
  private isOp(v: string): boolean {
    const tk = this.toks[this.p];
    return !!tk && tk.t === "op" && tk.v === v;
  }

  private ternary(): Node {
    const c = this.logicalOr();
    if (this.eatOp("?")) {
      const a = this.ternary();
      if (!this.eatOp(":")) throw new Error("Expected ':' in ternary expression");
      const b = this.ternary();
      return { k: "tern", c, a, b };
    }
    return c;
  }

  private logicalOr(): Node {
    let a = this.logicalAnd();
    while (this.isOp("||") || this.isOp("|")) {
      const op = (this.peek() as { v: string }).v;
      this.p++;
      a = { k: "bin", op: "||", a, b: this.logicalAnd() };
      void op;
    }
    return a;
  }

  private logicalAnd(): Node {
    let a = this.equality();
    while (this.isOp("&&") || this.isOp("&")) {
      this.p++;
      a = { k: "bin", op: "&&", a, b: this.equality() };
    }
    return a;
  }

  private equality(): Node {
    let a = this.relational();
    while (this.isOp("==") || this.isOp("!=")) {
      const op = (this.peek() as { v: string }).v;
      this.p++;
      a = { k: "bin", op, a, b: this.relational() };
    }
    return a;
  }

  private relational(): Node {
    let a = this.additive();
    while (this.isOp("<") || this.isOp("<=") || this.isOp(">") || this.isOp(">=")) {
      const op = (this.peek() as { v: string }).v;
      this.p++;
      a = { k: "bin", op, a, b: this.additive() };
    }
    return a;
  }

  private additive(): Node {
    let a = this.multiplicative();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.peek() as { v: string }).v;
      this.p++;
      a = { k: "bin", op, a, b: this.multiplicative() };
    }
    return a;
  }

  private multiplicative(): Node {
    let a = this.unary();
    while (this.isOp("*") || this.isOp("/") || this.isOp("%")) {
      const op = (this.peek() as { v: string }).v;
      this.p++;
      a = { k: "bin", op, a, b: this.unary() };
    }
    return a;
  }

  private unary(): Node {
    if (this.isOp("-") || this.isOp("+") || this.isOp("!")) {
      const op = (this.peek() as { v: string }).v;
      this.p++;
      return { k: "unary", op, x: this.unary() };
    }
    return this.power();
  }

  private power(): Node {
    const base = this.primary();
    if (this.isOp("^") || this.isOp("**")) {
      this.p++;
      // right-associative; exponent may itself be unary (2^-2)
      return { k: "bin", op: "^", a: base, b: this.unary() };
    }
    return base;
  }

  private primary(): Node {
    const tk = this.peek();
    if (!tk) throw new Error("Unexpected end of expression");
    if (tk.t === "num") {
      this.p++;
      return { k: "num", v: tk.v };
    }
    if (tk.t === "id") {
      this.p++;
      if (this.eatOp("(")) {
        const args: Node[] = [];
        if (!this.isOp(")")) {
          args.push(this.ternary());
          while (this.eatOp(",")) args.push(this.ternary());
        }
        if (!this.eatOp(")")) throw new Error(`Expected ')' after arguments to ${tk.v}()`);
        return { k: "call", name: tk.v, args };
      }
      return { k: "var", name: tk.v };
    }
    if (tk.t === "op" && tk.v === "(") {
      this.p++;
      const node = this.ternary();
      if (!this.eatOp(")")) throw new Error("Expected ')'");
      return node;
    }
    throw new Error(`Unexpected token "${tk.v}" in expression`);
  }
}

// --- built-in functions & constants ------------------------------------------

const CONSTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  true: 1,
  false: 0,
  // Boltzmann / charge, occasionally referenced in noise/thermal expressions.
  k: 1.380649e-23,
  q: 1.602176634e-19,
  // LTspice's fully-spelled physical-constant aliases.
  boltz: 1.380649e-23, // Boltzmann's constant (= k)
  echarge: 1.602176634e-19, // electron charge (= q)
  planck: 6.62607015e-34, // Planck's constant
  kelvin: -273.15, // 0 K in °C (LTspice's absolute-zero offset)
};

const bool = (b: boolean) => (b ? 1 : 0);
const sgn = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);

type Fn = (args: number[]) => number;

const FUNCS: Record<string, Fn> = {
  sin: ([x]) => Math.sin(x),
  cos: ([x]) => Math.cos(x),
  tan: ([x]) => Math.tan(x),
  asin: ([x]) => Math.asin(x),
  acos: ([x]) => Math.acos(x),
  atan: ([x]) => Math.atan(x),
  // LTspice arc* aliases for the inverse trig functions.
  arcsin: ([x]) => Math.asin(x),
  arccos: ([x]) => Math.acos(x),
  arctan: ([x]) => Math.atan(x),
  atan2: ([y, x]) => Math.atan2(y, x),
  sinh: ([x]) => Math.sinh(x),
  cosh: ([x]) => Math.cosh(x),
  tanh: ([x]) => Math.tanh(x),
  // Inverse hyperbolics (LTspice asinh/acosh/atanh).
  asinh: ([x]) => Math.asinh(x),
  acosh: ([x]) => Math.acosh(x),
  atanh: ([x]) => Math.atanh(x),
  exp: ([x]) => Math.exp(x),
  ln: ([x]) => Math.log(x),
  log: ([x]) => Math.log(x),
  log10: ([x]) => Math.log10(x),
  sqrt: ([x]) => Math.sqrt(x),
  abs: ([x]) => Math.abs(x),
  sgn: ([x]) => sgn(x),
  sign: ([x]) => sgn(x),
  floor: ([x]) => Math.floor(x),
  flr: ([x]) => Math.floor(x),
  ceil: ([x]) => Math.ceil(x),
  round: ([x]) => Math.round(x),
  nint: ([x]) => Math.round(x), // LTspice "nearest integer"
  int: ([x]) => Math.trunc(x),
  // 20·log10|x| - LTspice's dB helper.
  db: ([x]) => 20 * Math.log10(Math.abs(x)),
  hypot: (a) => Math.hypot(...a),
  min: (a) => Math.min(...a),
  max: (a) => Math.max(...a),
  pow: ([x, y]) => Math.pow(x, y),
  // LTspice pwr(x,a)=|x|^a, pwrs(x,a)=sgn(x)*|x|^a
  pwr: ([x, y]) => Math.pow(Math.abs(x), y),
  pwrs: ([x, y]) => sgn(x) * Math.pow(Math.abs(x), y),
  // if(cond, a, b)
  if: ([c, a, b]) => (c !== 0 ? a : b),
  // limit(x, lo, hi)
  limit: ([x, lo, hi]) => Math.min(Math.max(x, lo), hi),
  uramp: ([x]) => (x > 0 ? x : 0),
  u: ([x]) => bool(x > 0),
  buf: ([x]) => bool(x > 0.5),
  inv: ([x]) => bool(!(x > 0.5)),
  // LTspice boolean helper functions (operands true when > 0.5, matching buf/inv).
  and: ([a, b]) => bool(a > 0.5 && b > 0.5),
  or: ([a, b]) => bool(a > 0.5 || b > 0.5),
  not: ([x]) => bool(!(x > 0.5)),
  xor: ([a, b]) => bool((a > 0.5) !== (b > 0.5)),

  // LTspice statistical / Monte-Carlo functions. Tau runs a single deterministic
  // analysis, so these evaluate to their *nominal* (mean) value - the value
  // LTspice's nominal run uses before any `.step`-driven randomization. This lets
  // circuits that pepper component values with `mc()`/`gauss()`/`flat()` build and
  // simulate at nominal instead of failing on an unknown function (MonteCarlo.asc).
  mc: ([x]) => x, // mc(x,tol): uniform in x·[1−tol,1+tol]; nominal = x
  gauss: () => 0, // gauss(sigma): Gaussian, mean 0
  flat: () => 0, // flat(x): uniform in [−x,x], mean 0
  rand: () => 0.5, // rand(n): pseudo-random in [0,1); mean 0.5
  random: () => 0.5, // random(x): smooth pseudo-random in [0,1); mean 0.5
  white: () => 0, // white(x): band-limited white noise, mean 0
};

/** table(x, x1,y1, x2,y2, ...) - piecewise-linear lookup, clamped at the ends. */
function tableFn(args: number[]): number {
  const x = args[0];
  const pts: Array<[number, number]> = [];
  for (let i = 1; i + 1 < args.length; i += 2) pts.push([args[i], args[i + 1]]);
  if (pts.length === 0) return 0;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    if (x >= x0 && x <= x1) {
      if (x1 === x0) return y0;
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

// --- evaluation ---------------------------------------------------------------

function evalNode(node: Node, ctx: EvalContext, depth: number): number {
  if (depth > 64) throw new Error("Expression recursion too deep (cyclic .func?)");
  switch (node.k) {
    case "num":
      return node.v;
    case "var": {
      const name = node.name;
      if (name in ctx.scope) return ctx.scope[name];
      const lower = name.toLowerCase();
      if (lower in ctx.scope) return ctx.scope[lower];
      if (name in CONSTS) return CONSTS[name];
      if (lower in CONSTS) return CONSTS[lower];
      throw new Error(`Unknown parameter "${name}"`);
    }
    case "unary": {
      const x = evalNode(node.x, ctx, depth + 1);
      if (node.op === "-") return -x;
      if (node.op === "+") return x;
      return bool(x === 0); // "!"
    }
    case "tern":
      return evalNode(node.c, ctx, depth + 1) !== 0
        ? evalNode(node.a, ctx, depth + 1)
        : evalNode(node.b, ctx, depth + 1);
    case "bin": {
      const a = evalNode(node.a, ctx, depth + 1);
      // short-circuit logicals
      if (node.op === "&&") return bool(a !== 0 && evalNode(node.b, ctx, depth + 1) !== 0);
      if (node.op === "||") return bool(a !== 0 || evalNode(node.b, ctx, depth + 1) !== 0);
      const b = evalNode(node.b, ctx, depth + 1);
      switch (node.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return a / b;
        case "%":
          return a % b;
        case "^":
          return Math.pow(a, b);
        case "<":
          return bool(a < b);
        case "<=":
          return bool(a <= b);
        case ">":
          return bool(a > b);
        case ">=":
          return bool(a >= b);
        case "==":
          return bool(a === b);
        case "!=":
          return bool(a !== b);
        default:
          throw new Error(`Unknown operator "${node.op}"`);
      }
    }
    case "call": {
      const name = node.name.toLowerCase();
      const args = node.args.map((a) => evalNode(a, ctx, depth + 1));
      if (name === "table") return tableFn(args);
      const user = ctx.funcs[name];
      if (user) {
        if (user.params.length !== args.length) {
          throw new Error(`Function ${name}() expects ${user.params.length} args, got ${args.length}`);
        }
        const childScope: Scope = { ...ctx.scope };
        user.params.forEach((p, idx) => {
          childScope[p] = args[idx];
          childScope[p.toLowerCase()] = args[idx];
        });
        return evalNode(parse(user.body), { scope: childScope, funcs: ctx.funcs }, depth + 1);
      }
      const fn = FUNCS[name];
      if (!fn) throw new Error(`Unknown function "${node.name}"`);
      return fn(args);
    }
  }
}

// --- public API ---------------------------------------------------------------

/** Parse an expression string into an AST (throws on malformed input). */
export function parse(src: string): Node {
  const toks = tokenize(src);
  if (toks.length === 0) throw new Error("Empty expression");
  return new Parser(toks).parse();
}

/**
 * Evaluate an expression string to a number.
 * @param src   the expression (no surrounding braces)
 * @param scope variable bindings (param name → value); case-insensitive lookup
 * @param funcs user `.func` definitions (keys lowercased)
 */
export function evaluateExpression(
  src: string,
  scope: Scope = {},
  funcs: Record<string, FuncDef> = {},
): number {
  return evalNode(parse(src), { scope, funcs }, 0);
}
