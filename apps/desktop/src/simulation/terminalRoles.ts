/**
 * What current flows into the wire at a given component pin.
 *
 * The flow visualizer used to answer this from the pin id alone — "a" and "p"
 * drain the wire, "b" and "n" feed it. Pin ids are not unique across kinds, so
 * that rule read an NPN's BASE (`c,b,e`) and a MOSFET's BULK (`d,g,s,b`) as a
 * two-terminal part's second leg and injected the device's *collector* /
 * *drain* current there. On a common-source stage that animated the gate wire
 * at ~110x the true current, in the wrong direction, while the drain and source
 * wires — which carry that current for real — stayed dead.
 *
 * So the mapping is declared per (kind, pin), and `Record<ComponentKind, …>`
 * makes adding a kind without deciding its terminals a compile error. The
 * companion test asserts every kind's key set matches `LOCAL_PINS`, which is
 * the guard that would have caught the original bug the day it was written.
 */
import type { ComponentKind } from "../schematic/types";

export type TerminalRole =
  /** Pin carries the part's own (primary) current. `sign` is the direction:
   *  -1 drains the wire into the part, +1 feeds the wire from it. */
  | { role: "series"; sign: 1 | -1 }
  /** Pin has its own engine-reported terminal current (`ib`, `ie`, `ig`, `is`).
   *  Engines report current INTO the terminal, so the wire sees the negative. */
  | { role: "terminal"; terminal: string }
  /** Provably carries no current — an ideal op-amp input, a JFET gate at DC. */
  | { role: "none" }
  /** Not knowable from the data available. The net is treated as having a
   *  boundary here rather than being given a confident wrong number. */
  | { role: "unknown" };

const SERIES_IN: TerminalRole = { role: "series", sign: -1 };
const SERIES_OUT: TerminalRole = { role: "series", sign: 1 };
const NONE: TerminalRole = { role: "none" };
const UNKNOWN: TerminalRole = { role: "unknown" };

/** a → b two-terminal passive: current enters at `a`, leaves at `b`. */
const TWO_TERMINAL = { a: SERIES_IN, b: SERIES_OUT } as const;

/** Voltage-source MNA convention: the reported branch current flows INTO `p`,
 *  and is negative while the source delivers. The wire at `p` therefore sees
 *  the negative of it — the same shape as a passive's `a`. */
const V_SOURCE = { p: SERIES_IN, n: SERIES_OUT } as const;

/** A current source reports its OUTPUT current, positive out of `p` — the
 *  opposite sense to the voltage-source branch above. Getting this backwards
 *  made the arrow direction depend on which way the user dragged the wire,
 *  because the two ends of a wire then disagreed and the solver took whichever
 *  end happened to be the DFS root. */
const I_SOURCE = { p: SERIES_OUT, n: SERIES_IN } as const;

/** Multi-element expansions (a pot's two half-resistors, a relay's coil plus
 *  contact, a transformer's two windings) emit several deck instances under one
 *  component id, so a single reported current cannot be attributed to a pin. */
const unknownPins = <K extends string>(...ids: K[]): Record<K, TerminalRole> =>
  Object.fromEntries(ids.map((id) => [id, UNKNOWN])) as Record<K, TerminalRole>;

export const TERMINAL_ROLES: Readonly<
  Record<ComponentKind, Readonly<Record<string, TerminalRole>>>
> = {
  // ── Two-terminal passives ────────────────────────────────────────────────
  resistor: TWO_TERMINAL,
  capacitor: TWO_TERMINAL,
  polarizedCapacitor: TWO_TERMINAL,
  inductor: TWO_TERMINAL,
  bulb: TWO_TERMINAL,
  motor: TWO_TERMINAL,
  pushButton: TWO_TERMINAL,

  // ── Sources ──────────────────────────────────────────────────────────────
  vsource: V_SOURCE,
  vac: V_SOURCE,
  vpulse: V_SOURCE,
  logicConstant: V_SOURCE,
  bsource: V_SOURCE,
  isource: I_SOURCE,
  iac: I_SOURCE,

  // ── Diodes: anode in, cathode out. `k` was simply missing from the old
  //    rule, so dots marched up to every diode and vanished. ───────────────
  diode: { a: SERIES_IN, k: SERIES_OUT },
  led: { a: SERIES_IN, k: SERIES_OUT },
  zener: { a: SERIES_IN, k: SERIES_OUT },
  photodiode: { a: SERIES_IN, k: SERIES_OUT },

  // ── Bipolars: primary current is the collector; base and emitter have their
  //    own engine vectors. All three sum to zero, so KCL closes exactly. ────
  npn: { c: SERIES_IN, b: { role: "terminal", terminal: "b" }, e: { role: "terminal", terminal: "e" } },
  pnp: { c: SERIES_IN, b: { role: "terminal", terminal: "b" }, e: { role: "terminal", terminal: "e" } },

  // ── MOSFETs: primary is the drain; gate and source have vectors. The bulk
  //    has no reported vector and carries no current through a reverse-biased
  //    junction in normal operation, so it is `none` rather than `unknown` —
  //    marking it unknown would put a boundary on every body-tied net and
  //    refuse the most common MOS topology there is. ─────────────────────────
  nmos: { d: SERIES_IN, g: { role: "terminal", terminal: "g" }, s: { role: "terminal", terminal: "s" }, b: NONE },
  pmos: { d: SERIES_IN, g: { role: "terminal", terminal: "g" }, s: { role: "terminal", terminal: "s" }, b: NONE },

  // ── JFETs: only the drain vector exists. The gate is a reverse-biased
  //    junction at DC, so source = -drain by KCL and the pair is exact. ──────
  njf: { d: SERIES_IN, g: NONE, s: SERIES_OUT },
  pjf: { d: SERIES_IN, g: NONE, s: SERIES_OUT },

  // ── Controlled sources: the output pair carries the reported branch
  //    current; the voltage-sensing input pair draws none. ──────────────────
  vcvs: { op: SERIES_IN, on: SERIES_OUT, cp: NONE, cn: NONE },
  vccs: { op: SERIES_IN, on: SERIES_OUT, cp: NONE, cn: NONE },
  cccs: { op: SERIES_IN, on: SERIES_OUT, cp: UNKNOWN, cn: UNKNOWN },
  ccvs: { op: SERIES_IN, on: SERIES_OUT, cp: UNKNOWN, cn: UNKNOWN },

  // ── Switches: the switched path is series; the control pair senses voltage
  //    only. A relay additionally has a coil current that is a different
  //    number from the contact current, so its pins stay unknown. ───────────
  switch: { a: SERIES_IN, b: SERIES_OUT, cp: NONE, cn: NONE },
  relay: unknownPins("a", "b", "cp", "cn"),
  spdt: unknownPins("com", "no", "nc"),

  // ── Multi-element expansions: one id, several deck instances. ────────────
  potentiometer: unknownPins("a", "b", "w"),
  transformer: unknownPins("p1", "p2", "s1", "s2"),
  ctTransformer: unknownPins("p1", "p2", "s1", "ct", "s2"),
  tline: unknownPins("a1", "a2", "b1", "b2"),
  subckt: unknownPins("p1", "p2"),

  // ── Analog ICs: ideal inputs draw nothing; outputs and rails carry current
  //    nobody reports per-pin. ───────────────────────────────────────────────
  opamp: { "in+": NONE, "in-": NONE, out: UNKNOWN, "v+": UNKNOWN, "v-": UNKNOWN },
  comparator: { "in+": NONE, "in-": NONE, out: UNKNOWN },
  sampleHold: { "in+": NONE, "in-": NONE, clk: NONE, sh: NONE, out: UNKNOWN, com: UNKNOWN },
  modulator: { fm: NONE, am: NONE, out: UNKNOWN, com: UNKNOWN },
  timer555: {
    trig: NONE, thres: NONE, cont: NONE, reset: NONE,
    out: UNKNOWN, disch: UNKNOWN, vcc: UNKNOWN, gnd: UNKNOWN,
  },
  adc: { vin: NONE, vref: NONE, d0: UNKNOWN, d1: UNKNOWN, d2: UNKNOWN, d3: UNKNOWN, com: UNKNOWN },
  dac: { d0: NONE, d1: NONE, d2: NONE, d3: NONE, vref: NONE, out: UNKNOWN, com: UNKNOWN },

  // ── Digital. The split that matters is input vs output, not analog vs
  //    digital: a logic INPUT is high-impedance and draws nothing, but a logic
  //    OUTPUT really does source current into whatever it drives. Calling an
  //    output `none` would leave a gate-to-resistor net looking unbalanced and
  //    animate nothing; calling it `unknown` makes it the net's single boundary,
  //    so the load's own current resolves the wire exactly. ──────────────────
  digitalGate: {
    in1: NONE, in2: NONE, in3: NONE, in4: NONE, in5: NONE,
    q: UNKNOWN, qbar: UNKNOWN, com: UNKNOWN,
  },
  dflop: { d: NONE, clk: NONE, pre: NONE, clr: NONE, q: UNKNOWN, qbar: UNKNOWN, com: UNKNOWN },
  srflop: { s: NONE, r: NONE, q: UNKNOWN, qbar: UNKNOWN, com: UNKNOWN },
  tflop: { t: NONE, clk: NONE, pre: NONE, clr: NONE, q: UNKNOWN, qbar: UNKNOWN, com: UNKNOWN },
  jkflop: {
    j: NONE, k: NONE, clk: NONE, pre: NONE, clr: NONE,
    q: UNKNOWN, qbar: UNKNOWN, com: UNKNOWN,
  },
  counter: {
    clk: NONE, rst: NONE,
    q0: UNKNOWN, q1: UNKNOWN, q2: UNKNOWN, q3: UNKNOWN, com: UNKNOWN,
  },
  // Every segment drives an LED, so each carries real current.
  sevenSeg: unknownPins("a", "b", "c", "d", "e", "f", "g", "dp", "com"),

  // ── Structural ───────────────────────────────────────────────────────────
  /** Ground is where a net's current LEAVES. It is not zero-injection — the
   *  old model treated it that way and every wire running to a ground symbol
   *  read 0 A. It is the slack node, handled by the solver. */
  ground: { g: UNKNOWN },
};

/** The role of a pin, defaulting to `unknown` for anything unmapped so a new
 *  pin id can never silently inherit two-terminal behaviour. */
export function terminalRole(kind: ComponentKind, pinId: string): TerminalRole {
  return TERMINAL_ROLES[kind]?.[pinId] ?? UNKNOWN;
}
