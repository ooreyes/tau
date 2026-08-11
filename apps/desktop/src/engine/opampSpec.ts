import { parseQuantity } from "../simulation/quantity";

/**
 * Rail-clamped ideal op-amp emission (LTspice parity).
 *
 * The plain ideal model (`E out 0 in+ in- 1e6`) is only valid inside a feedback
 * loop: run open-loop it saturates to ~1e7 V. LTspice's UniversalOpamp2 instead
 * clamps its output to the V+/V− supply pins, which is exactly how
 * class-d_starter.asc uses it - an open-loop PWM comparator whose output slams
 * rail to rail. When an imported op-amp's supply pins are actually driven, the
 * deck builder swaps in the clamped behavioral form built here.
 */

/** LTspice UniversalOpamp default open-loop gain (Avol). */
export const DEFAULT_OPAMP_AVOL = 1e6;
export const DEFAULT_OPAMP_VMIN = -15;
export const DEFAULT_OPAMP_VMAX = 15;

/**
 * Extract the open-loop gain from an op-amp value string of key=value tokens
 * (UniversalOpamp2 writes `Avol=1Meg GBW=10Meg Slew=10Meg`). Only `Avol` is
 * modeled; GBW/Slew/Vos/… are ignored (no dynamics in the ideal model). A
 * missing, unparseable, or non-positive Avol falls back to the 1e6 default so
 * a partial spec still yields a usable amplifier.
 */
export function parseOpampAvol(value: string): number {
  const match = /(?:^|[\s,])(?:avol|gain)\s*=\s*([^\s,]+)/i.exec(value ?? "");
  if (!match) return DEFAULT_OPAMP_AVOL;
  try {
    const avol = parseQuantity(match[1]);
    return Number.isFinite(avol) && avol > 0 ? avol : DEFAULT_OPAMP_AVOL;
  } catch {
    return DEFAULT_OPAMP_AVOL;
  }
}

export function parseOpampOutputLimits(value: string): { min: number; max: number } {
  const read = (names: string[], fallback: number) => {
    const match = new RegExp(`(?:^|[\\s,])(?:${names.join("|")})\\s*=\\s*([^\\s,]+)`, "i").exec(value ?? "");
    if (!match) return fallback;
    try {
      const parsed = parseQuantity(match[1]!);
      return Number.isFinite(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  };
  const min = read(["vmin", "vlow", "vlo", "min"], DEFAULT_OPAMP_VMIN);
  const max = read(["vmax", "vhigh", "vhi", "max"], DEFAULT_OPAMP_VMAX);
  return min < max ? { min, max } : { min: DEFAULT_OPAMP_VMIN, max: DEFAULT_OPAMP_VMAX };
}

/**
 * Deck line for the rail-clamped op-amp: a behavioral voltage source
 * `Vmid + Vhalf·tanh(Avol·Vd / Vhalf)` - output centered between the rails,
 * saturating smoothly at them, with small-signal gain exactly Avol.
 *
 * Formulation chosen empirically (Wien/LoopGain/Howland/phono/Draft10 all
 * op-converge, class-d PWM still slams rail to rail):
 *   - a hard `max(min(Avol·Vd, V+), V−)` clamp kills ngspice's gmin/source
 *     stepping on feedback circuits (zero derivative when saturated →
 *     singular matrix / "timestep too small");
 *   - the classic E-source + rail clamp diodes macro dies the other way: run
 *     open loop the unbounded internal node forces ~1e5 A through the clamp;
 *   - tanh is smooth everywhere, and the divisor is guarded with
 *     `max(|Vhalf|, 0.5)` - it must not collapse while source stepping ramps
 *     the supplies through 0. The floor must be a large fraction of a volt: a
 *     tiny guard (1µ) makes the early source steps see slope ~Avol/1µ ≈ 1e12,
 *     which breaks source stepping itself (phono.asc, live-verified - 0.5
 *     converges, 1µ does not). Gain is exact whenever the rail span ≥ 1 V.
 */
export function railClampedOpampLine(
  name: string,
  outNode: string,
  inPlus: string,
  inMinus: string,
  vPlus: string,
  vMinus: string,
  avol: number,
  outputMin?: number,
  outputMax?: number,
): string {
  const low = outputMin === undefined ? `V(${vMinus})` : `max(V(${vMinus}),${outputMin})`;
  const high = outputMax === undefined ? `V(${vPlus})` : `min(V(${vPlus}),${outputMax})`;
  const mid = `(${high}+${low})/2`;
  const half = `(${high}-${low})/2`;
  const diff = `(V(${inPlus})-V(${inMinus}))`;
  return `${name} ${outNode} 0 V=${mid}+${half}*tanh(${avol}*${diff}/max(abs(${half}),0.5))`;
}

/** Bounded generic op-amp used when no physical supply pins are wired. */
export function boundedOpampLine(
  name: string,
  outNode: string,
  inPlus: string,
  inMinus: string,
  avol: number,
  outputMin: number,
  outputMax: number,
): string {
  const mid = (outputMax + outputMin) / 2;
  const half = (outputMax - outputMin) / 2;
  const diff = `(V(${inPlus})-V(${inMinus}))`;
  return `${name} ${outNode} 0 V=${mid}+${half}*tanh(${avol}*${diff}/max(abs(${half}),0.5))`;
}
