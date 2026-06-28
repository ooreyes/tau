/**
 * Map LTspice analysis directives (`.tran`, `.ac`) onto Tau's analysis option
 * shapes so an imported `.asc` runs with its *own* timestep / sweep settings
 * instead of the editor's hardcoded defaults (FEATURE_PARITY §1 d-analyses).
 *
 * Pure functions only — given a directive string they return option objects or
 * `null` (malformed / unsupported). Wiring into the run buttons lives in App.tsx.
 */

import { parseQuantity } from "../simulation/quantity";
import { MAX_TRANSIENT_STEPS, type AnalysisOptions } from "../simulation/linearTransient";
import { parseDcDirective, type DcSweepSpec } from "../simulation/dcSweep";
import { parseTfDirective, type TfSpec } from "../simulation/transferFunction";
import { parseNoiseDirective, type NoiseSpec } from "../simulation/noise";
import { parseFourDirective, type FourierSpec } from "../simulation/fourier";

/** Sample count used when a `.tran` gives no usable timestep. Mirrors the editor default. */
export const DEFAULT_TRAN_STEPS = 240;

/** Options accepted by `runAcSweep` / `runNativeAcSweep`. */
export interface AcAnalysisOptions {
  startHz: number;
  stopHz: number;
  pointsPerDecade: number;
}

/** Strip the leading `.`/`!` and the directive keyword, returning the argument body. */
function bodyAfterKeyword(directive: string, keyword: string): string | null {
  const m = directive.trim().match(new RegExp(`^[.!]?${keyword}\\b\\s*(.*)$`, "is"));
  return m ? m[1].trim() : null;
}

/** Parse a token as an SI quantity, returning null instead of throwing on non-numerics. */
function quantityOrNull(token: string): number | null {
  try {
    const v = parseQuantity(token);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Parse a `.tran` directive into `{ stopTime, steps }`.
 *
 * LTspice forms (modifiers like `uic`/`startup` are ignored):
 *   `.tran <Tstop>`                              → short form
 *   `.tran <Tstep> <Tstop> [<Tstart> [<Tmax>]]`  → full form
 *
 * One numeric token ⇒ that's Tstop. Two or more ⇒ first is Tstep, second is
 * Tstop, and the sample count is derived from `Tstop/Tstep` (clamped). A zero or
 * missing Tstep falls back to {@link DEFAULT_TRAN_STEPS}.
 */
export function parseTranDirective(directive: string): AnalysisOptions | null {
  const body = bodyAfterKeyword(directive, "tran");
  if (body === null) return null;

  const numbers = body
    .split(/[\s,()]+/)
    .filter(Boolean)
    .map(quantityOrNull)
    .filter((n): n is number => n !== null);
  if (numbers.length === 0) return null;

  // Short form: a single value is Tstop. Otherwise Tstep, Tstop, [Tstart, Tmax].
  const tstep = numbers.length === 1 ? 0 : numbers[0];
  const tstop = numbers.length === 1 ? numbers[0] : numbers[1];
  if (!(tstop > 0)) return null;

  let steps = DEFAULT_TRAN_STEPS;
  if (tstep > 0) {
    steps = Math.round(tstop / tstep);
  }
  steps = Math.max(2, Math.min(MAX_TRANSIENT_STEPS, steps));
  return { stopTime: tstop, steps };
}

/**
 * Parse a `.ac` directive into `{ startHz, stopHz, pointsPerDecade }`.
 *
 * LTspice form: `.ac <oct|dec|lin> <Npoints> <Fstart> <Fstop>`. For `dec`/`oct`,
 * `Npoints` is points-per-decade/octave and maps directly. For `lin`, `Npoints`
 * is the total point count over the whole span, so it's converted to an
 * equivalent points-per-decade across the start→stop frequency range.
 */
export function parseAcDirective(directive: string): AcAnalysisOptions | null {
  const body = bodyAfterKeyword(directive, "ac");
  if (body === null) return null;

  const tokens = body.split(/[\s,]+/).filter(Boolean);
  if (tokens.length < 4) return null;

  const sweep = tokens[0].toLowerCase();
  if (sweep !== "dec" && sweep !== "oct" && sweep !== "lin") return null;

  const npoints = quantityOrNull(tokens[1]);
  const startHz = quantityOrNull(tokens[2]);
  const stopHz = quantityOrNull(tokens[3]);
  if (npoints === null || startHz === null || stopHz === null) return null;
  if (!(npoints > 0) || !(startHz > 0) || !(stopHz > startHz)) return null;

  let pointsPerDecade: number;
  if (sweep === "lin") {
    // Spread Npoints total samples across however many decades the span covers.
    const decades = Math.log10(stopHz / startHz);
    pointsPerDecade = decades > 0 ? npoints / decades : npoints;
  } else if (sweep === "oct") {
    // Octaves-per-decade ≈ log2(10) ≈ 3.3219; convert points/octave → points/decade.
    pointsPerDecade = npoints * Math.log2(10);
  } else {
    pointsPerDecade = npoints;
  }
  pointsPerDecade = Math.max(1, Math.round(pointsPerDecade));
  return { startHz, stopHz, pointsPerDecade };
}

/**
 * Parse a `.temp <celsius>` directive → the temperature in °C, or null. Leading
 * `.`/`!` and SI suffixes are tolerated. The first value is used (LTspice/ngspice
 * accept a list, but Tau emits a single operating temperature).
 */
export function parseTempDirective(directive: string): number | null {
  const trimmed = directive.trim().replace(/^[.!]+/, "");
  const m = /^temp\b\s*(.*)$/i.exec(trimmed);
  if (!m) return null;
  const token = m[1].split(/[\s,]+/).filter(Boolean)[0];
  if (!token) return null;
  return quantityOrNull(token);
}

/** The kind of analysis a document's directives request, with parsed options. */
export interface DirectiveAnalyses {
  tran?: AnalysisOptions;
  ac?: AcAnalysisOptions;
  dc?: DcSweepSpec;
  tf?: TfSpec;
  noise?: NoiseSpec;
  /** `.four` Fourier analysis run over the transient result. */
  four?: FourierSpec;
  /** `.temp` circuit temperature in °C (emitted to the native deck). */
  temp?: number;
}

/**
 * Scan a document's directive lines and return the first `.tran` / `.ac` / `.dc`
 * analysis each maps to. Lets the app pick a default run + options for an
 * imported circuit. Unparseable directives are simply skipped.
 */
export function analysesFromDirectives(directives: string[]): DirectiveAnalyses {
  const result: DirectiveAnalyses = {};
  for (const directive of directives) {
    if (!result.tran) {
      const tran = parseTranDirective(directive);
      if (tran) result.tran = tran;
    }
    if (!result.ac) {
      const ac = parseAcDirective(directive);
      if (ac) result.ac = ac;
    }
    if (!result.dc) {
      const dc = parseDcDirective(directive);
      if (dc) result.dc = dc;
    }
    if (!result.tf) {
      const tf = parseTfDirective(directive);
      if (tf) result.tf = tf;
    }
    if (!result.noise) {
      const noise = parseNoiseDirective(directive);
      if (noise) result.noise = noise;
    }
    if (!result.four) {
      const four = parseFourDirective(directive);
      if (four) result.four = four;
    }
    if (result.temp === undefined) {
      const temp = parseTempDirective(directive);
      if (temp !== null) result.temp = temp;
    }
  }
  return result;
}
