/**
 * LTspice independent sources carry their **AC analysis stimulus** separately
 * from their transient/DC value: a `voltage`/`current` symbol stores the
 * transient function (or DC level) in `SYMATTR Value` and an `AC <mag> [phase]`
 * spec in `SYMATTR Value2`. On the SPICE netlist line these concatenate, e.g.
 *
 *     V1 n1 0 SINE(0 1 1) AC 1
 *
 * The importer joins `Value` + `Value2` so the AC spec rides on the component
 * value; this module pulls it back out for the deck builder (native ngspice)
 * and the TS AC solver. Without it an imported `.asc`'s `.ac` sweep / `.meas ac`
 * sees a 0 V source and produces nothing (real cases: Draft1, Draft2).
 *
 * Pure functions, fully unit-tested. `parseAcSpec` returns `null` when the
 * value has no `AC` keyword; `stripAcSpec` returns the value with the AC chunk
 * removed so the remaining text parses as a clean function/DC level.
 */

import { parseQuantity } from "../simulation/quantity";

export interface AcSpec {
  /** AC magnitude (volts or amps), SI suffixes resolved. */
  mag: number;
  /** AC phase in degrees; 0 when LTspice omits it. */
  phase: number;
}

// `\bAC\b` then a magnitude token (SI-suffixed allowed), then an OPTIONAL phase
// that must look numeric (leading optional sign + digit) so a trailing
// SpiceLine token like `Rser=0.1` is never mistaken for the phase. The source
// transient functions (SINE/SIN/PULSE/PWL/EXP/SFFM) contain no `AC`, so the
// keyword is unambiguous on a source value.
const AC_RE = /\bAC\b\s+([^\s,;]+)(?:\s+([+-]?\d[\w.+-]*))?/i;

/**
 * Extract an `AC <mag> [phase]` stimulus from a source value string.
 * Returns `null` if there is no `AC` keyword or the magnitude is unparseable.
 */
export function parseAcSpec(value: string): AcSpec | null {
  const m = AC_RE.exec(value);
  if (!m) return null;
  let mag: number;
  try {
    mag = parseQuantity(m[1], "");
  } catch {
    return null;
  }
  if (!Number.isFinite(mag)) return null;
  let phase = 0;
  if (m[2] !== undefined) {
    const p = Number(m[2]);
    if (Number.isFinite(p)) phase = p;
  }
  return { mag, phase };
}

/**
 * Return `value` with the `AC <mag> [phase]` chunk removed and whitespace
 * collapsed, leaving the transient function or DC level. Idempotent; a value
 * with no AC spec is returned trimmed/space-normalized.
 */
export function stripAcSpec(value: string): string {
  return value.replace(AC_RE, " ").replace(/\s+/g, " ").trim();
}

/**
 * Remove LTspice source *instance-parameter* tokens (`Rser=50`, `Cpar=10p`,
 * `wavefile=…`, `chan=0`, …) from a source value so the remaining text parses
 * as a clean DC level / transient function. ngspice rejects these inline
 * (`unknown parameter (rser)`). The deck builder extracts `Rser=` first via
 * `passiveSeriesResistance` and expands it to an explicit series resistor
 * (Educational NoiseFigure.asc); this strip still runs on the residual value
 * so a leftover `Rser=1K` cannot fail as "needs a valid V value". Transient
 * functions (SINE/PULSE/PWL/EXP/SFFM) contain no bare `key=value` tokens, so
 * this never disturbs them.
 */
export function stripSourceModifiers(value: string): string {
  return value.replace(/\b[A-Za-z_]\w*\s*=\s*\S+/g, " ").replace(/\s+/g, " ").trim();
}

/** ngspice deck text for an AC spec, e.g. ` AC 1` or ` AC 1 90` (empty if none). */
export function acSpecDeckText(value: string): string {
  const ac = parseAcSpec(value);
  if (!ac) return "";
  return ac.phase ? ` AC ${ac.mag} ${ac.phase}` : ` AC ${ac.mag}`;
}
