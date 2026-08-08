import { parseQuantity } from "../simulation/quantity";

/**
 * LTspice idealized digital A-devices (`Digital\*.asy`), modelled behaviorally.
 *
 * LTspice's A-device pin contract (verified against the installed 17.2.4
 * `lib/sym/Digital` library): SpiceOrder 1-5 are inputs, 6 is the COMPLEMENTARY
 * output `_Q`, 7 is the true output `Q`, 8 is the `com` reference. There is no
 * INV function - `inv.asy` is a BUF exposing only the complementary output pin,
 * and `schmtinv.asy` is a SCHMITT likewise. So the function set reduces to
 * {buf, and, or, xor, schmitt}, and inversion falls out of *which output pin*
 * a line drives. Floating inputs are ignored (LTspice semantics).
 *
 * That pin contract is the IMPORT's, not the symbol Tau places. A gate placed
 * in Tau exposes N inputs and one output, because that is what a logic gate
 * has; see `schematic/pins.ts` and {@link nativelyPlacedGateSpec}, which is
 * where the two readings of `inv`/`schmtinv` are reconciled.
 *
 * Emission is a B-source per connected output using the ternary `cond ? a : b`
 * idiom (live-verified in ngspice-46; LTspice 17.2.4 accepts the same form).
 * Multi-input AND/OR must NOT use C-style `&&`/`||` — LTspice rejects those
 * with a grammatical error on the B-line. Use arithmetic on 0/1 comparisons
 * instead: AND = product of terms, OR = sum of terms `>0`. `==` and `abs()`
 * are likewise live-verified. Flip-flops (DFLOP / SRFLOP / T / JK) are stateful
 * and cannot be a B-source; they emit XSPICE d_dff / d_tff / d_jkff between
 * explicit adc/dac bridges (also live-verified — the AUTO bridge's default
 * thresholds sit above LTspice's 0..1 V logic levels, so explicit bridges at
 * Vt/Vlow/Vhigh are required). SRFLOP is an async latch (S→set, R→reset on
 * d_dff; no clock on the LTspice .asy).
 */
export type DigitalGateFn = "buf" | "and" | "or" | "xor" | "schmitt";

/**
 * Input-count bounds for a multi-input gate.
 *
 * The deck has always supported 1..5 — `spiceNetlist.ts` builds the condition
 * from whichever input pins are wired — but the symbol drew five leads whatever
 * the gate was, so a two-input AND arrived with three dangling terminals. The
 * count is now carried in the value (`Inputs=`) and drives both the pin bank
 * and the drawing. Two is the floor because an AND/OR/XOR of one input is not
 * that function at all, it is a buffer, which is a different `fn`.
 */
export const GATE_INPUTS_MIN = 2;
export const GATE_INPUTS_MAX = 5;
export const GATE_INPUTS_DEFAULT = 2;

/**
 * Drop Tau's `Inputs=` token from a gate value.
 *
 * The count is Tau's own, not LTspice's: over there a gate's input count is the
 * symbol (`Digital\and` is a five-input part) and the A-device `Value` holds
 * only `Vhigh=/Vlow=/Vt=/Vhys=/Td=`. So the token must not go out in an
 * exported `Value`, and it must not be shown on the canvas either — the drawing
 * already states the count by drawing that many leads.
 */
export function withoutGateInputCount(value: string): string {
  return value.replace(/(^|[\s,])inputs\s*=\s*[^\s,]+/gi, "$1").replace(/\s+/g, " ").trim();
}

/** Functions that take exactly one input whatever `Inputs=` says. */
export function isSingleInputGateFn(fn: DigitalGateFn): boolean {
  return fn === "buf" || fn === "schmitt";
}

/**
 * How many inputs a gate of this function really has.
 *
 * A buffer/inverter/Schmitt is single-input by construction, so `Inputs=` is
 * ignored rather than obeyed: honouring it would draw an inverter with three
 * leads that the deck could never read. Everything else is clamped into
 * {@link GATE_INPUTS_MIN}..{@link GATE_INPUTS_MAX} — the range the netlist can
 * actually emit — instead of trusting a hand-typed number.
 */
export function gateInputCount(fn: DigitalGateFn, requested: number | null | undefined): number {
  if (isSingleInputGateFn(fn)) return 1;
  if (requested === null || requested === undefined || !Number.isFinite(requested)) {
    return GATE_INPUTS_DEFAULT;
  }
  return Math.min(GATE_INPUTS_MAX, Math.max(GATE_INPUTS_MIN, Math.round(requested)));
}

export interface DigitalGateSpec {
  fn: DigitalGateFn;
  /**
   * When true, invert the primary `q` sense (EveryCircuit NAND/NOR/XNOR/NOT
   * place as a single-output part that still exposes complementary pins).
   * `q` gets the inverted levels; `qbar` gets the non-inverted ones.
   */
  invertOut: boolean;
  /**
   * The value named an LTspice symbol that exposes ONLY the complementary pin
   * (`inv.asy`, `schmtinv.asy`). On an imported part that is a pin fact, not a
   * function fact — the `.asy` really has no `q`, and inverting `q` as well
   * would make its one wired output non-inverting. On a natively placed gate,
   * which exposes a single output, it IS the function: see
   * {@link nativelyPlacedGateSpec}.
   */
  qbarOnly: boolean;
  /**
   * Input terminals this gate exposes, already clamped and already reduced to
   * 1 for the single-input functions. Drives `LOCAL_PINS.digitalGate` and the
   * drawn leads; the deck still counts only the pins that are wired, so an
   * imported `.asy` with its own pin bank is unaffected.
   */
  inputs: number;
  /** Output level for logic true (LTspice default 1 V). */
  vhigh: number;
  /** Output level for logic false (LTspice default 0 V). */
  vlow: number;
  /** Input threshold. Defaults to the midpoint of vhigh/vlow. */
  vt: number;
  /** Schmitt hysteresis half-width around vt (trip points vt±vhys). */
  vhys: number;
  /** Propagation delay (seconds). Carried for the d_dff; B-gates ignore it. */
  td: number;
}

/** LTspice symbol leaf / EveryCircuit preset → gate function (+ optional invert). */
const FN_ALIASES: Record<string, { fn: DigitalGateFn; invertOut?: boolean; qbarOnly?: boolean }> = {
  buf: { fn: "buf" },
  buf1: { fn: "buf" },
  // LTspice `inv.asy` is a BUF that exposes the complementary pin — do NOT
  // invert primary `q` or imported INV symbols that wire only qbar flip sense.
  inv: { fn: "buf", qbarOnly: true },
  // EveryCircuit palette "NOT" places an inverter on the primary Q pin.
  not: { fn: "buf", invertOut: true },
  and: { fn: "and" },
  nand: { fn: "and", invertOut: true },
  or: { fn: "or" },
  nor: { fn: "or", invertOut: true },
  xor: { fn: "xor" },
  xnor: { fn: "xor", invertOut: true },
  schmitt: { fn: "schmitt" },
  schmtbuf: { fn: "schmitt" },
  schmtinv: { fn: "schmitt", qbarOnly: true },
};

const KEY_ALIASES: Record<string, keyof Omit<DigitalGateSpec, "fn" | "invertOut" | "qbarOnly">> = {
  vhigh: "vhigh",
  vlow: "vlow",
  vt: "vt",
  vhys: "vhys",
  td: "td",
  inputs: "inputs",
};

/**
 * Parse a digital gate's value string: a leading function token (`and`, `inv`,
 * `schmtbuf`, …) followed by optional LTspice A-device `key=value` params
 * (`Vhigh=5 Vlow=0 Vt=2.5 Vhys=0.5 Td=10n`, case-insensitive, SI suffixes),
 * plus Tau's own `Inputs=` count. Unknown tokens are ignored so a partial spec
 * still yields a usable gate. Defaults are LTspice's: vhigh=1, vlow=0,
 * vt=midpoint, vhys=0; `Inputs=` defaults to {@link GATE_INPUTS_DEFAULT}.
 */
export function parseDigitalGate(value: string): DigitalGateSpec {
  const tokens = (value ?? "").trim().split(/[\s,]+/).filter(Boolean);
  let fn: DigitalGateFn = "buf";
  let invertOut = false;
  let qbarOnly = false;
  let vhigh = 1;
  let vlow = 0;
  let vt: number | null = null;
  let vhys = 0;
  let td = 0;
  let inputs: number | null = null;

  for (const token of tokens) {
    const eq = token.indexOf("=");
    if (eq > 0) {
      const key = KEY_ALIASES[token.slice(0, eq).toLowerCase()];
      if (!key) continue;
      const parsed = tryQuantity(token.slice(eq + 1));
      if (parsed === null) continue;
      if (key === "vhigh") vhigh = parsed;
      else if (key === "vlow") vlow = parsed;
      else if (key === "vt") vt = parsed;
      else if (key === "vhys") vhys = parsed;
      else if (key === "inputs") inputs = parsed;
      else td = parsed;
      continue;
    }
    const alias = FN_ALIASES[token.toLowerCase()];
    if (alias) {
      fn = alias.fn;
      invertOut = alias.invertOut === true;
      qbarOnly = alias.qbarOnly === true;
    }
  }

  return {
    fn,
    invertOut,
    qbarOnly,
    inputs: gateInputCount(fn, inputs),
    vhigh,
    vlow,
    vt: vt ?? (vhigh + vlow) / 2,
    vhys: Math.abs(vhys),
    td: Math.abs(td),
  };
}

/**
 * The spec a **natively placed** gate is drawn and solved with.
 *
 * A gate Tau places itself has one output (`q`), because that is what a logic
 * gate has; the LTspice 8-slot bank with its complementary pin belongs to the
 * imported `.asy`, which carries its own `pinOverride`. That makes the
 * qbar-only aliases mean something different on the two paths, and this is the
 * one place that difference is written down:
 *
 *  - imported `inv.asy` / `schmtinv.asy`: the part has no `q` at all, its one
 *    output is `qbar`, and `qbar` already carries the complement of `buf`. So
 *    `invertOut` must stay false or that output would stop inverting.
 *  - a natively placed gate valued `inv` / `schmtinv`: there is no `qbar` to
 *    take the complement from, so "inverter" has to live on `q` — exactly as
 *    it does for `not` / `nand` / `nor` / `xnor`.
 *
 * Without this a hand-typed (or dev-tool placed) `inv` would draw an unbubbled
 * buffer and emit a non-inverting B-source: a silent wrong answer, which is the
 * failure mode this repo treats as the worst kind.
 */
export function nativelyPlacedGateSpec(spec: DigitalGateSpec): DigitalGateSpec {
  if (!spec.qbarOnly) return spec;
  return { ...spec, invertOut: !spec.invertOut, qbarOnly: false };
}

/** Node assignments for a gate instance. Only *connected* pins are present -
 *  imported symbols carry pin overrides for exactly the pins the `.asy` has,
 *  and LTspice ignores floating gate inputs. `com` is the input/output voltage
 *  reference; omit it (or pass "0") when grounded. */
export interface DigitalGateNodes {
  ins: string[];
  q?: string;
  qbar?: string;
  com?: string;
}

/**
 * Build the B-source deck lines for a combinational/Schmitt gate. One line per
 * connected output: `q` gets `cond ? vhigh : vlow`, `qbar` the swap. All input
 * comparisons and both outputs are referenced to `com` when present.
 *
 * The Schmitt trigger uses the self-referential output-state idiom from
 * comparatorSpec (live-verified): the trip point is vt+vhys when the output is
 * low and vt−vhys when high. Its state is read back from whichever output
 * exists (q preferred; from qbar the sense inverts).
 */
export function digitalGateDeckLines(
  base: string,
  nodes: DigitalGateNodes,
  spec: DigitalGateSpec,
): string[] {
  const { fn, invertOut, vhigh, vlow, vt, vhys } = spec;
  const com = nodes.com && nodes.com !== "0" ? nodes.com : null;
  const vin = (n: string) => (com ? `V(${n},${com})` : `V(${n})`);
  const term = (n: string, threshold: number) => `(${vin(n)}>${threshold})`;
  const ins = nodes.ins;
  // InvertOut (NAND/NOR/XNOR/NOT): swap the levels driven onto q vs qbar.
  const qHi = invertOut ? vlow : vhigh;
  const qLo = invertOut ? vhigh : vlow;

  let cond: string;
  if (ins.length === 0) {
    cond = "0"; // all inputs floating → logic false (ternary picks vlow)
  } else if (fn === "and") {
    // Product of 0/1 comparisons — LTspice rejects C-style `&&` in B-sources.
    cond = ins.map((n) => term(n, vt)).join("*");
  } else if (fn === "or") {
    // Sum of 0/1 comparisons > 0 — LTspice rejects C-style `||` in B-sources.
    cond = `(${ins.map((n) => term(n, vt)).join("+")})>0`;
  } else if (fn === "xor") {
    // LTspice XOR is "exactly one input true" (equals classic XOR at 2 inputs).
    cond = `(${ins.map((n) => term(n, vt)).join("+")})==1`;
  } else if (fn === "schmitt" && vhys > 0) {
    // State is read from an output: high state ⇔ V(q) above the level midpoint
    // (or V(qbar) below it). Read the INTERNAL drive node (`…_qd`, before the
    // series output resistor) so an external load can't corrupt the state.
    // With neither output connected the gate drives nothing, so cond is
    // irrelevant - fall through to the ideal threshold.
    const mid = (vhigh + vlow) / 2;
    const state = nodes.q
      ? `V(${base}_qd)>${mid}`
      : nodes.qbar
        ? `V(${base}_qbd)<${mid}`
        : null;
    cond = state
      ? `(${state}) ? ${term(ins[0], vt - vhys)} : ${term(ins[0], vt + vhys)}`
      : term(ins[0], vt);
  } else {
    cond = term(ins[0], vt); // buf / ideal schmitt
  }

  // cond must be parenthesized: the Schmitt cond is itself a ternary, and
  // ternary right-associativity would otherwise swallow `? hi : lo` into its
  // false branch (wrong output level whenever vhigh/vlow aren't 1/0).
  const out = (hi: number, lo: number) =>
    com
      ? `V=((${cond}) ? ${hi} : ${lo})+V(${com})`
      : `V=(${cond}) ? ${hi} : ${lo}`;

  // Drive each output through a small series resistance instead of an ideal
  // B voltage source directly on the net. LTspice's A-devices have finite
  // drive impedance, so its libraries freely parallel gate outputs (PowerSim's
  // DEADTIME inside TLVR); two ideal B sources on one net make the matrix
  // singular ("check node b_…_q#branch"). 1 Ω is far below any realistic load.
  const lines: string[] = [];
  if (nodes.q) {
    lines.push(`B_${base}_Q ${base}_qd 0 ${out(qHi, qLo)}`);
    lines.push(`R_${base}_Q ${base}_qd ${nodes.q} 1`);
  }
  if (nodes.qbar) {
    lines.push(`B_${base}_QB ${base}_qbd 0 ${out(qLo, qHi)}`);
    lines.push(`R_${base}_QB ${base}_qbd ${nodes.qbar} 1`);
  }
  return lines;
}

/** Node assignments for a DFLOP instance (pins per LTspice `dflop.asy`). */
export interface DflopNodes {
  d?: string;
  clk?: string;
  pre?: string;
  clr?: string;
  q?: string;
  qbar?: string;
}

/**
 * Build the XSPICE deck lines for an LTspice DFLOP: an adc_bridge (thresholds
 * at vt) into a d_dff, back out through a dac_bridge (levels vlow/vhigh).
 * Unconnected D/CLK/PRE/CLR tie to analog ground = digital 0 (inactive; d_dff
 * set/reset are active-high). Unconnected outputs land on private nodes.
 * LTspice's TD= maps onto the d_dff's clk/set/reset delays (min 1 ns so the
 * event queue always advances).
 */
export function dflopDeckLines(base: string, nodes: DflopNodes, spec: DigitalGateSpec): string[] {
  return xspiceFlopDeckLines(base, "dff", spec, {
    adcIns: [nodes.d, nodes.clk, nodes.pre, nodes.clr],
    digIns: ["dd", "dclk", "dpre", "dclr"],
    instancePorts: (b) => `${b}_dd ${b}_dclk ${b}_dpre ${b}_dclr ${b}_dq ${b}_dnq`,
    q: nodes.q,
    qbar: nodes.qbar,
  });
}

/** Node assignments for an SR latch (LTspice `srflop.asy`: S/R/Q/_Q). */
export interface SrflopNodes {
  s?: string;
  r?: string;
  q?: string;
  qbar?: string;
}

/**
 * Async SR latch: S → d_dff async set, R → async reset. D/CLK held at digital 0
 * via ADC from analog ground. Live-verified in ngspice — level-sensitive set/
 * reset matches LTspice Digital\srflop (no clock pin on the .asy).
 */
export function srflopDeckLines(base: string, nodes: SrflopNodes, spec: DigitalGateSpec): string[] {
  return xspiceFlopDeckLines(base, "dff", spec, {
    adcIns: [undefined, undefined, nodes.s, nodes.r],
    digIns: ["dd", "dclk", "ds", "dr"],
    instancePorts: (b) => `${b}_dd ${b}_dclk ${b}_ds ${b}_dr ${b}_dq ${b}_dnq`,
    q: nodes.q,
    qbar: nodes.qbar,
  });
}

/** Node assignments for a T flip-flop (XSPICE `d_tff`). */
export interface TflopNodes {
  t?: string;
  clk?: string;
  pre?: string;
  clr?: string;
  q?: string;
  qbar?: string;
}

/** Edge-triggered T flip-flop via XSPICE d_tff between adc/dac bridges. */
export function tflopDeckLines(base: string, nodes: TflopNodes, spec: DigitalGateSpec): string[] {
  return xspiceFlopDeckLines(base, "tff", spec, {
    adcIns: [nodes.t, nodes.clk, nodes.pre, nodes.clr],
    digIns: ["dt", "dclk", "dpre", "dclr"],
    instancePorts: (b) => `${b}_dt ${b}_dclk ${b}_dpre ${b}_dclr ${b}_dq ${b}_dnq`,
    q: nodes.q,
    qbar: nodes.qbar,
  });
}

/** Node assignments for a JK flip-flop (XSPICE `d_jkff`). */
export interface JkflopNodes {
  j?: string;
  k?: string;
  clk?: string;
  pre?: string;
  clr?: string;
  q?: string;
  qbar?: string;
}

/** Edge-triggered JK flip-flop via XSPICE d_jkff between adc/dac bridges. */
export function jkflopDeckLines(base: string, nodes: JkflopNodes, spec: DigitalGateSpec): string[] {
  return xspiceFlopDeckLines(base, "jkff", spec, {
    adcIns: [nodes.j, nodes.k, nodes.clk, nodes.pre, nodes.clr],
    digIns: ["dj", "dk", "dclk", "dpre", "dclr"],
    instancePorts: (b) => `${b}_dj ${b}_dk ${b}_dclk ${b}_dpre ${b}_dclr ${b}_dq ${b}_dnq`,
    q: nodes.q,
    qbar: nodes.qbar,
  });
}

type XspiceFlopModel = "dff" | "tff" | "jkff";

function xspiceFlopDeckLines(
  base: string,
  model: XspiceFlopModel,
  spec: DigitalGateSpec,
  opts: {
    adcIns: Array<string | undefined>;
    digIns: string[];
    instancePorts: (b: string) => string;
    q?: string;
    qbar?: string;
  },
): string[] {
  const { vhigh, vlow, vt, td } = spec;
  const b = base.toLowerCase();
  const a = (n: string | undefined) => n ?? "0";
  const bridgeBand = Math.max(Math.abs(vhigh - vlow) * 1e-3, 1e-9);
  const inLow = Number((vt - bridgeBand).toPrecision(12));
  const inHigh = Number((vt + bridgeBand).toPrecision(12));
  const delay = Number(Math.max(td, 1e-9).toPrecision(12));
  const digNodes = opts.digIns.map((suffix) => `${b}_${suffix}`);
  return [
    `.model ${b}_adc adc_bridge(in_low=${inLow} in_high=${inHigh})`,
    `A_${b}_adc [${opts.adcIns.map(a).join(" ")}] [${digNodes.join(" ")}] ${b}_adc`,
    `.model ${b}_${model} d_${model}(ic=0 clk_delay=${delay} set_delay=${delay} reset_delay=${delay} rise_delay=1e-9 fall_delay=1e-9)`,
    `A_${b} ${opts.instancePorts(b)} ${b}_${model}`,
    `.model ${b}_dac dac_bridge(out_low=${vlow} out_high=${vhigh} t_rise=1e-8 t_fall=1e-8)`,
    `A_${b}_dac [${b}_dq ${b}_dnq] [${opts.q ?? `${b}_qnc`} ${opts.qbar ?? `${b}_qbnc`}] ${b}_dac`,
  ];
}

function tryQuantity(text: string): number | null {
  try {
    return parseQuantity(text);
  } catch {
    return null;
  }
}
