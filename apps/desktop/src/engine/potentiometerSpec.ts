/** Track resistance text plus wiper position of a Tau potentiometer. */
export interface PotentiometerSpec {
  /** Track resistance exactly as written, e.g. "10k". Parsed by the caller so a
   *  bad value keeps its component-aware error message. */
  resistanceText: string;
  /** Wiper position as a fraction of the track measured from pin A, 0..1. */
  wiper: number;
}

export const DEFAULT_WIPER = 0.5;

/**
 * Parse a Tau potentiometer value into its track-resistance text and wiper
 * fraction. The value is the resistance plus an optional `Wiper=<0..1>`
 * token, order-independent and tolerant of spaces around `=`, e.g.
 * "10k Wiper=0.25" or "Wiper=0.25 10k". Any other token is left inside
 * `resistanceText` untouched - the caller's own parse decides whether it is
 * an error, exactly as it does today for a bare value.
 */
export function parsePotentiometerSpec(value: string): PotentiometerSpec {
  const text = (value ?? "").trim();
  const wiperMatch = /\bwiper\s*=\s*(\S+)/i.exec(text);
  const resistanceText = (
    wiperMatch
      ? text.slice(0, wiperMatch.index) + text.slice(wiperMatch.index + wiperMatch[0].length)
      : text
  ).replace(/\s+/g, " ").trim();
  const wiper = wiperMatch ? Number(wiperMatch[1]) : NaN;
  // A bare "10k" is a centred wiper - the spelling every schematic written
  // before this control existed uses - so a missing token defaults to centre.
  // A parsed-but-out-of-range fraction also falls back rather than erroring,
  // because it must not produce a leg the solver cannot stamp (see
  // potentiometerLegs's floor for the same concern at the extremes).
  return {
    resistanceText,
    wiper: Number.isFinite(wiper) && wiper >= 0 && wiper <= 1 ? wiper : DEFAULT_WIPER,
  };
}

/**
 * Split a track resistance into the pin-A-to-wiper and wiper-to-pin-B legs.
 */
export function potentiometerLegs(resistance: number, wiper: number): { a: number; b: number } {
  // One part per billion of the track is electrically negligible and keeps
  // the conductance ratio inside double precision, so a wiper run fully to
  // one end still emits a stampable (non-zero) resistor on both legs.
  const floor = resistance * 1e-9;
  const a = Math.max(resistance * wiper, floor);
  const b = Math.max(resistance * (1 - wiper), floor);
  // Trim binary-float noise (e.g. 10000*0.7 = 7000.000000000001) so the deck
  // reads as the round numbers the user typed.
  return { a: Number(a.toPrecision(12)), b: Number(b.toPrecision(12)) };
}
