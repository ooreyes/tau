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

export class MalformedPwlError extends Error {
  constructor(message = "malformed PWL waveform") {
    super(message);
    this.name = "MalformedPwlError";
  }
}

/** True when a PWL card is visibly truncated (unclosed `(` or odd arg count). */
export function isMalformedPwlValue(rawValue: string): boolean {
  let value = rawValue.trim();
  const dcMatch = /^DC\s+([^\s,;]+)\s+/i.exec(value);
  if (dcMatch) value = value.slice(dcMatch[0].length).trim();
  const parenMatch = /^PWL\s*\((.*)$/is.exec(value);
  if (parenMatch) {
    const tail = parenMatch[1]!;
    if (!tail.includes(")")) return true;
    const inner = tail.slice(0, tail.lastIndexOf(")")).trim();
    const args = inner.split(/[\s,]+/).filter(Boolean);
    return args.length === 0 || args.length % 2 !== 0;
  }
  const parenlessMatch = /^PWL\s+(?!\()/is.exec(value);
  if (parenlessMatch) {
    const args = value.slice(parenlessMatch[0].length).trim().split(/[\s,]+/).filter(Boolean);
    return args.length === 0 || args.length % 2 !== 0;
  }
  return false;
}

/** Parse one LTspice PWL time token. A leading `+` is relative to the previous
 * breakpoint (not merely a positive absolute number). Reject backwards or
 * malformed time axes instead of silently turning them into time zero. */
export function parsePwlTimeToken(token: string, previous: number): number {
  const relative = token.startsWith("+");
  const quantity = relative ? token.slice(1) : token;
  let parsed: number;
  try {
    parsed = parseQuantity(quantity, "s");
  } catch {
    throw new MalformedPwlError(`PWL time "${token}" is invalid.`);
  }
  if (!Number.isFinite(parsed) || parsed < 0) throw new MalformedPwlError(`PWL time "${token}" is invalid.`);
  const time = relative ? previous + parsed : parsed;
  if (time < previous) throw new MalformedPwlError(`PWL time "${token}" goes backwards.`);
  return parseFloat(time.toPrecision(12));
}

/**
 * LTspice writes the transient stimulus inline on a `voltage`/`current` symbol's
 * Value attribute - `SINE(...)`, `PULSE(...)`, `PWL(...)`, `EXP(...)`, `SFFM(...)`.
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
  let value = rawValue.trim();
  let dcOverride: number | undefined;
  const dcMatch = /^DC\s+([^\s,;]+)\s+/i.exec(value);
  if (dcMatch) {
    try {
      const parsed = parseQuantity(dcMatch[1], unit);
      if (Number.isFinite(parsed)) dcOverride = parseFloat(parsed.toPrecision(12));
    } catch {
      return null;
    }
    value = value.slice(dcMatch[0].length).trim();
  }
  if (/^\s*PWL\b/i.test(value) && isMalformedPwlValue(value)) {
    throw new MalformedPwlError();
  }
  // LTspice accepts both `PWL(...)` and paren-less `PWL 0 0 +10u 3.3 …`
  // (LT8708-1 V3). Require a following `(` or whitespace+args so a bare
  // keyword alone is not treated as a waveform.
  const match = value.match(/^(SINE|SIN|PULSE|PWL|EXP|SFFM)(?:\s*\(([^)]*)\)|\s+(.+))$/i);
  if (!match) {
    if (/^\s*PWL\b/i.test(value)) throw new MalformedPwlError();
    return null;
  }

  const fn = match[1]!.toUpperCase();
  const args = (match[2] ?? match[3] ?? "").trim().split(/[\s,]+/).filter(Boolean);

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
      // ngspice    SIN(Voff Vamp Freq Td Theta Phase)  - drop Ncycles.
      const off = num(args[0], unit);
      const amp = num(args[1], unit);
      const freq = num(args[2], "Hz", 1e3);
      const td = num(args[3], "s");
      const theta = num(args[4], "Hz"); // damping factor [1/s]
      const phase = num(args[5], "deg");
      const tail = [off, amp, freq, td, theta, phase];
      while (tail.length > 3 && tail[tail.length - 1] === 0) tail.pop();
      const dc = dcOverride ?? off;
      return { text: `DC ${dc} SIN(${tail.join(" ")})`, dc };
    }
    case "PULSE": {
      // LTspice PULSE(V1 V2 Tdelay Trise Tfall Ton Tperiod Ncycles)
      // ngspice  PULSE(V1 V2 TD TR TF PW PER) - drop Ncycles.
      const v1 = num(args[0], unit);
      const v2 = num(args[1], unit);
      const td = num(args[2], "s");
      const tr = num(args[3], "s");
      const tf = num(args[4], "s");
      const pw = num(args[5], "s");
      const per = num(args[6], "s");
      const tail = [v1, v2, td, tr, tf, pw, per];
      while (tail.length > 2 && tail[tail.length - 1] === 0) tail.pop();
      const dc = dcOverride ?? v1;
      return { text: `DC ${dc} PULSE(${tail.join(" ")})`, dc };
    }
    case "PWL": {
      // Alternating time/level pairs; ngspice accepts the same form. Levels use
      // the source unit, times are seconds.
      if (args.length === 0 || args.length % 2 !== 0) throw new MalformedPwlError();
      const pairs: number[] = [];
      let previousTime = 0;
      for (let i = 0; i < args.length; i += 2) {
        let time: number;
        try {
          time = parsePwlTimeToken(args[i]!, previousTime);
        } catch (err) {
          if (err instanceof MalformedPwlError) throw err;
          throw new MalformedPwlError();
        }
        pairs.push(time);
        previousTime = time;
        if (i + 1 < args.length) pairs.push(num(args[i + 1], unit));
      }
      const dc = pairs.length >= 2 ? pairs[1] : 0;
      const operatingPoint = dcOverride ?? dc;
      return { text: `DC ${operatingPoint} PWL(${pairs.join(" ")})`, dc: operatingPoint };
    }
    case "EXP": {
      // EXP(V1 V2 Td1 Tau1 Td2 Tau2)
      const v1 = num(args[0], unit);
      const v2 = num(args[1], unit);
      const td1 = num(args[2], "s");
      const tau1 = num(args[3], "s");
      const td2 = num(args[4], "s");
      const tau2 = num(args[5], "s");
      const dc = dcOverride ?? v1;
      return { text: `DC ${dc} EXP(${v1} ${v2} ${td1} ${tau1} ${td2} ${tau2})`, dc };
    }
    case "SFFM": {
      // SFFM(Voff Vamp Fcar MDI Fsig)
      const off = num(args[0], unit);
      const amp = num(args[1], unit);
      const fc = num(args[2], "Hz");
      const mdi = num(args[3], "");
      const fs = num(args[4], "Hz");
      const dc = dcOverride ?? off;
      return { text: `DC ${dc} SFFM(${off} ${amp} ${fc} ${mdi} ${fs})`, dc };
    }
  }
  return null;
}
