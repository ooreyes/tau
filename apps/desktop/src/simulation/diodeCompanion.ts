/**
 * Newton companion models for the junction-diode family (diode / LED / zener)
 * in the interim TS transient solver.
 *
 * Each device is a Shockley junction I(V) = Is·(exp(V/(n·Vt)) − 1); the zener
 * adds a mirrored exponential reverse-breakdown term at its rated voltage.
 * Per Newton iteration the device contributes a linearized companion -
 * conductance g = dI/dV in parallel with current source Ieq = I(v₀) − g·v₀ -
 * exactly the classic SPICE formulation, including pnjlim voltage limiting so
 * the exponential cannot overflow between iterations.
 */

/** kT/q at ~300 K. */
export const THERMAL_VOLTAGE = 0.025852;

/** Past this argument exp() is continued linearly (keeps g finite + monotonic). */
const EXP_ARG_LIMIT = 80;

export interface DiodeSpec {
  /** Saturation current Is (A). */
  isat: number;
  /** Emission coefficient n (a.k.a. ideality). */
  emission: number;
  /** Reverse breakdown magnitude (V) - zeners only. */
  breakdown?: number;
}

export const DIODE_KINDS = new Set(["diode", "led", "zener", "photodiode"]);

/** `5V1` / `5.1` / `BZX55C5V1`-style breakdown ratings; null when unparseable. */
export function parseZenerBreakdown(value: string): number | null {
  const trimmed = value.trim();
  const digitVolt = /(\d+)V(\d+)/i.exec(trimmed);
  const parsed = digitVolt
    ? Number(`${digitVolt[1]}.${digitVolt[2]}`)
    : Number(/(\d+(?:\.\d+)?)/.exec(trimmed)?.[1]);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 200 ? parsed : null;
}

/** Built-in default models, LTspice-flavored: silicon diode ≈0.7 V, LED ≈2.0 V
 *  at 10 mA, zener breaks down at its rated (or 5.1 V fallback) voltage.
 *  Photodiode uses the silicon junction; illumination is a parallel Iph. */
export function diodeSpecFor(kind: string, value: string): DiodeSpec {
  switch (kind) {
    case "led":
      return { isat: 1e-16, emission: 2.4 };
    case "zener":
      return { isat: 1e-14, emission: 1, breakdown: parseZenerBreakdown(value) ?? 5.1 };
    case "photodiode":
      return { isat: 1e-14, emission: 1 };
    default:
      return { isat: 1e-14, emission: 1 };
  }
}

/** exp(x) with a linear continuation beyond EXP_ARG_LIMIT so huge Newton
 *  excursions produce large-but-finite currents with a nonzero derivative. */
function safeExp(x: number): number {
  if (x <= EXP_ARG_LIMIT) return Math.exp(x);
  return Math.exp(EXP_ARG_LIMIT) * (1 + (x - EXP_ARG_LIMIT));
}

function safeExpDerivative(x: number): number {
  return x <= EXP_ARG_LIMIT ? Math.exp(x) : Math.exp(EXP_ARG_LIMIT);
}

/** Device current for anode→cathode voltage v (SPICE sign convention). */
export function diodeCurrent(spec: DiodeSpec, v: number): number {
  const vte = spec.emission * THERMAL_VOLTAGE;
  let current = spec.isat * (safeExp(v / vte) - 1);
  if (spec.breakdown !== undefined) {
    current -= spec.isat * safeExp(-(v + spec.breakdown) / THERMAL_VOLTAGE);
  }
  return current;
}

/** dI/dV at v - always positive, so the companion conductance never breaks
 *  matrix diagonal dominance. */
export function diodeConductance(spec: DiodeSpec, v: number): number {
  const vte = spec.emission * THERMAL_VOLTAGE;
  let conductance = (spec.isat / vte) * safeExpDerivative(v / vte);
  if (spec.breakdown !== undefined) {
    conductance += (spec.isat / THERMAL_VOLTAGE) * safeExpDerivative(-(v + spec.breakdown) / THERMAL_VOLTAGE);
  }
  return conductance;
}

/** Classic SPICE pnjlim: damp forward-bias Newton steps once past vcrit so the
 *  exponential cannot explode; below vcrit the raw step is kept (fast). */
function pnjlim(vnew: number, vold: number, vt: number, vcrit: number): number {
  if (vnew > vcrit && Math.abs(vnew - vold) > vt + vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt;
      return arg > 0 ? vold + vt * Math.log(arg) : vcrit;
    }
    return vt * Math.log(vnew / vt);
  }
  return vnew;
}

/** Limit one Newton voltage update for this device (forward junction, and the
 *  mirrored breakdown junction when the spec has one). */
export function limitDiodeVoltage(spec: DiodeSpec, vnew: number, vold: number): number {
  const vte = spec.emission * THERMAL_VOLTAGE;
  const vcrit = vte * Math.log(vte / (Math.SQRT2 * spec.isat));
  let limited = pnjlim(vnew, vold, vte, vcrit);
  if (spec.breakdown !== undefined) {
    const vcritBreak = THERMAL_VOLTAGE * Math.log(THERMAL_VOLTAGE / (Math.SQRT2 * spec.isat));
    const mirroredNew = -(limited + spec.breakdown);
    const mirroredOld = -(vold + spec.breakdown);
    limited = -spec.breakdown - pnjlim(mirroredNew, mirroredOld, THERMAL_VOLTAGE, vcritBreak);
  }
  return limited;
}
