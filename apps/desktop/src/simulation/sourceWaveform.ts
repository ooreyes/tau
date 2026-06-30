import { parseQuantity } from "./quantity";
import { stripAcSpec } from "../engine/acSpec";

/** Independent-source value unit: volts or amps on the level arguments. */
export type SourceUnit = "V" | "A";

/**
 * A transient independent source resolved into a time-domain evaluator. Built
 * once from a component's Value string; `at(t)` returns the instantaneous level
 * and `dc` is the t=0 / operating-point bias used to seed `.op` and the first
 * transient step.
 */
export interface TransientSource {
  /** Operating-point / time-zero value (volts or amps). */
  dc: number;
  /** Instantaneous source level at time `t` (seconds). */
  at: (time: number) => number;
  /** Representative max frequency [Hz] for sampling resolution; 0 if aperiodic. */
  maxFrequencyHz: number;
}

const DEG2RAD = Math.PI / 180;

/**
 * Parse an LTspice/ngspice transient source spec — `SINE(...)`, `PULSE(...)`,
 * `PWL(...)`, `EXP(...)`, `SFFM(...)` — into a numeric time-domain evaluator.
 * A trailing `AC <mag>` spec (LTspice writes `SINE(0 1 1k) AC 1`) is ignored
 * here; it only matters to AC analysis. A plain numeric value (no function
 * head) resolves to a constant DC source.
 *
 * Mirrors `engine/sourceFunction.ts` (which emits the same families as ngspice
 * deck text); this module is the interim TS solver's runtime evaluator so the
 * browser/test engine reproduces the same waveforms without ngspice.
 */
export function parseTransientSource(rawValue: string, unit: SourceUnit): TransientSource {
  const value = stripAcSpec(rawValue ?? "").trim();
  const match = value.match(/^(SINE|SIN|PULSE|PWL|EXP|SFFM)\s*\(([^)]*)\)/i);

  if (!match) {
    // Plain DC level (possibly with a leading `DC` keyword). NaN → 0.
    const dc = parseLevel(value.replace(/^DC\s+/i, ""), unit, 0);
    return { dc, at: () => dc, maxFrequencyHz: 0 };
  }

  const fn = match[1].toUpperCase();
  const args = match[2].trim().split(/[\s,]+/).filter(Boolean);
  const lvl = (i: number, fallback = 0) => parseLevel(args[i], unit, fallback);
  const sec = (i: number, fallback = 0) => parseLevel(args[i], "s", fallback);

  switch (fn) {
    case "SINE":
    case "SIN": {
      // SINE(Voffset Vamp Freq Td Theta Phi Ncycles)
      const off = lvl(0);
      const amp = lvl(1);
      const freq = parseLevel(args[2], "Hz", 0);
      const td = sec(3);
      const theta = parseLevel(args[4], "", 0); // damping [1/s]
      const phaseRad = parseLevel(args[5], "", 0) * DEG2RAD;
      const ncycles = args[6] !== undefined ? parseLevel(args[6], "", 0) : 0;
      const at = (t: number): number => {
        if (t <= td) return off + amp * Math.sin(phaseRad);
        const dt = t - td;
        if (ncycles > 0 && freq > 0 && dt > ncycles / freq) {
          // After the requested cycle count LTspice holds the unmodulated offset.
          return off;
        }
        const damp = theta !== 0 ? Math.exp(-dt * theta) : 1;
        return off + amp * damp * Math.sin(2 * Math.PI * freq * dt + phaseRad);
      };
      return { dc: off + amp * Math.sin(phaseRad), at, maxFrequencyHz: freq };
    }
    case "PULSE": {
      // PULSE(V1 V2 Tdelay Trise Tfall Ton Tperiod Ncycles)
      const v1 = lvl(0);
      const v2 = lvl(1);
      const td = sec(2);
      const tr = sec(3);
      const tf = sec(4);
      const pw = sec(5);
      const per = sec(6);
      const ncycles = args[7] !== undefined ? parseLevel(args[7], "", 0) : 0;
      const at = (t: number): number => {
        if (t < td) return v1;
        let local = t - td;
        if (per > 0) {
          if (ncycles > 0 && local >= ncycles * per) return v1;
          local %= per;
        }
        if (local < tr) return tr > 0 ? v1 + (v2 - v1) * (local / tr) : v2;
        if (local < tr + pw) return v2;
        if (local < tr + pw + tf) return tf > 0 ? v2 + (v1 - v2) * ((local - tr - pw) / tf) : v1;
        return v1;
      };
      return { dc: v1, at, maxFrequencyHz: per > 0 ? 1 / per : 0 };
    }
    case "PWL": {
      // Alternating time/level pairs; linear interpolation, flat-held at the ends.
      const times: number[] = [];
      const levels: number[] = [];
      for (let i = 0; i + 1 < args.length; i += 2) {
        times.push(parseLevel(args[i], "s", 0));
        levels.push(parseLevel(args[i + 1], unit, 0));
      }
      const first = levels.length > 0 ? levels[0] : 0;
      const at = (t: number): number => {
        if (times.length === 0) return 0;
        if (t <= times[0]) return levels[0];
        for (let i = 1; i < times.length; i++) {
          if (t <= times[i]) {
            const span = times[i] - times[i - 1];
            if (span <= 0) return levels[i];
            return levels[i - 1] + (levels[i] - levels[i - 1]) * ((t - times[i - 1]) / span);
          }
        }
        return levels[levels.length - 1];
      };
      // PWL breakpoints are user-authored; like LTspice we impose no minimum-step
      // sampling requirement from them (a tiny segment would otherwise force an
      // impractically high step count and reject an otherwise-fine circuit).
      return { dc: first, at, maxFrequencyHz: 0 };
    }
    case "EXP": {
      // EXP(V1 V2 Td1 Tau1 Td2 Tau2)
      const v1 = lvl(0);
      const v2 = lvl(1);
      const td1 = sec(2);
      const tau1 = parseLevel(args[3], "s", 0);
      const td2 = sec(4);
      const tau2 = parseLevel(args[5], "s", 0);
      const at = (t: number): number => {
        const rise = t > td1 && tau1 > 0 ? (v2 - v1) * (1 - Math.exp(-(t - td1) / tau1)) : 0;
        const fall = t > td2 && tau2 > 0 ? (v1 - v2) * (1 - Math.exp(-(t - td2) / tau2)) : 0;
        return v1 + rise + fall;
      };
      return { dc: v1, at, maxFrequencyHz: 0 };
    }
    case "SFFM": {
      // SFFM(Voff Vamp Fcarrier MDI Fsignal)
      const off = lvl(0);
      const amp = lvl(1);
      const fc = parseLevel(args[2], "Hz", 0);
      const mdi = parseLevel(args[3], "", 0);
      const fs = parseLevel(args[4], "Hz", 0);
      const at = (t: number): number =>
        off + amp * Math.sin(2 * Math.PI * fc * t + mdi * Math.sin(2 * Math.PI * fs * t));
      return { dc: off, at, maxFrequencyHz: Math.max(fc, fs) };
    }
  }
  const dc = parseLevel(value, unit, 0);
  return { dc, at: () => dc, maxFrequencyHz: 0 };
}

/** True when the value is a recognized transient function form (SINE/PULSE/…). */
export function isFunctionSource(rawValue: string): boolean {
  return /^(SINE|SIN|PULSE|PWL|EXP|SFFM)\s*\(/i.test(stripAcSpec(rawValue ?? "").trim());
}

function parseLevel(token: string | undefined, unit: string, fallback: number): number {
  if (token === undefined || token === "") return fallback;
  try {
    const parsed = parseQuantity(token, unit);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}
