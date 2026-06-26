import { parseQuantity } from "../simulation/quantity";

/** Whether the source carries volts or amps on its level arguments. */
export type SourceUnit = "V" | "A";

export interface SourceSpec {
  /**
   * ngspice text emitted directly after the two node names, e.g.
   * `DC 0 SIN(0 7.5 1000)` or `DC -10 PULSE(-10 10 5e-6 ...)`.
   */
  text: string;
  /** Time-zero / DC value, used to seed the operating point and TS fallbacks. */
  dc: number;
}

/**
 * LTspice writes the transient stimulus inline on a `voltage`/`current` symbol's
 * Value attribute — `SINE(...)`, `PULSE(...)`, `PWL(...)`, `EXP(...)`, `SFFM(...)`.
 * ngspice understands the same families but is fussier about argument count and
 * unicode SI prefixes (LTspice emits `µ`, `meg`). This normalizer parses the
 * LTspice form, re-emits each numeric argument as a plain number (so ngspice
 * never sees `µ`), and trims the trailing `Ncycles` argument that ngspice's
 * SIN/PULSE do not accept.
 *
 * Returns `null` when the value is not a recognized function form (a plain DC
 * number), so callers fall back to their numeric path.
 */
export function parseSourceFunction(rawValue: string, unit: SourceUnit): SourceSpec | null {
  const value = rawValue.trim();
  const match = value.match(/^(SINE|SIN|PULSE|PWL|EXP|SFFM)\s*\(([^)]*)\)/i);
  if (!match) return null;

  const fn = match[1].toUpperCase();
  const args = match[2].trim().split(/[\s,]+/).filter(Boolean);

  // Per-argument unit so SI suffixes resolve correctly (s for time, Hz for
  // frequency, V/A for levels). Unknown/extra args parse as dimensionless.
  // Round to 12 significant digits so SI scaling (e.g. 10·1e-6) does not leak
  // binary-float noise like 0.0000099999999 into the ngspice deck.
  const num = (token: string | undefined, u: string, fallback = 0): number => {
    if (token === undefined) return fallback;
    try {
      const parsed = parseQuantity(token, u);
      if (!Number.isFinite(parsed)) return fallback;
      return parseFloat(parsed.toPrecision(12));
    } catch {
      return fallback;
    }
  };

  switch (fn) {
    case "SINE":
    case "SIN": {
      // LTspice SINE(Voffset Vamp Freq Td Theta Phi Ncycles)
      // ngspice    SIN(Voff Vamp Freq Td Theta Phase)  — drop Ncycles.
      const off = num(args[0], unit);
      const amp = num(args[1], unit);
      const freq = num(args[2], "Hz", 1e3);
      const td = num(args[3], "s");
      const theta = num(args[4], "Hz"); // damping factor [1/s]
      const phase = num(args[5], "deg");
      const tail = [off, amp, freq, td, theta, phase];
      while (tail.length > 3 && tail[tail.length - 1] === 0) tail.pop();
      return { text: `DC ${off} SIN(${tail.join(" ")})`, dc: off };
    }
    case "PULSE": {
      // LTspice PULSE(V1 V2 Tdelay Trise Tfall Ton Tperiod Ncycles)
      // ngspice  PULSE(V1 V2 TD TR TF PW PER) — drop Ncycles.
      const v1 = num(args[0], unit);
      const v2 = num(args[1], unit);
      const td = num(args[2], "s");
      const tr = num(args[3], "s");
      const tf = num(args[4], "s");
      const pw = num(args[5], "s");
      const per = num(args[6], "s");
      const tail = [v1, v2, td, tr, tf, pw, per];
      while (tail.length > 2 && tail[tail.length - 1] === 0) tail.pop();
      return { text: `DC ${v1} PULSE(${tail.join(" ")})`, dc: v1 };
    }
    case "PWL": {
      // Alternating time/level pairs; ngspice accepts the same form. Levels use
      // the source unit, times are seconds.
      const pairs: number[] = [];
      for (let i = 0; i < args.length; i += 2) {
        pairs.push(num(args[i], "s"));
        if (i + 1 < args.length) pairs.push(num(args[i + 1], unit));
      }
      const dc = pairs.length >= 2 ? pairs[1] : 0;
      return { text: `DC ${dc} PWL(${pairs.join(" ")})`, dc };
    }
    case "EXP": {
      // EXP(V1 V2 Td1 Tau1 Td2 Tau2)
      const v1 = num(args[0], unit);
      const v2 = num(args[1], unit);
      const td1 = num(args[2], "s");
      const tau1 = num(args[3], "s");
      const td2 = num(args[4], "s");
      const tau2 = num(args[5], "s");
      return { text: `DC ${v1} EXP(${v1} ${v2} ${td1} ${tau1} ${td2} ${tau2})`, dc: v1 };
    }
    case "SFFM": {
      // SFFM(Voff Vamp Fcar MDI Fsig)
      const off = num(args[0], unit);
      const amp = num(args[1], unit);
      const fc = num(args[2], "Hz");
      const mdi = num(args[3], "");
      const fs = num(args[4], "Hz");
      return { text: `DC ${off} SFFM(${off} ${amp} ${fc} ${mdi} ${fs})`, dc: off };
    }
  }
  return null;
}
