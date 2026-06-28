/**
 * Per-instance **initial condition** (`IC=`) on a capacitor or inductor
 * (FEATURE_PARITY §3 "C/L initial conditions" / §4 `.ic`). LTspice stores it in
 * a `SYMATTR SpiceLine`/`SpiceLine2`/`Value2` attribute (e.g. a 100 pF cap with
 * `SpiceLine2 IC=1`); on the SPICE line it rides after the value:
 *
 *     C1 n1 n2 100p IC=1
 *
 * The importer appends the `IC=` token to the component value; this module pulls
 * it back out for the deck builder (native ngspice). When any instance carries
 * an IC the transient must run with `uic` so the value holds at t=0.
 *
 * Pure functions, fully unit-tested. `parseIcValue` returns the IC token (as
 * written, SI suffix preserved) or `null`; `stripIcSpec` returns the value with
 * the `IC=` chunk removed.
 */

const IC_RE = /\bIC\s*=\s*([^\s,;]+)/i;

/** The initial-condition token from a value (`"100p IC=1"` → `"1"`), or null. */
export function parseIcValue(value: string): string | null {
  const m = IC_RE.exec(value);
  return m ? m[1] : null;
}

/** The value with its `IC=<token>` chunk removed and whitespace collapsed. */
export function stripIcSpec(value: string): string {
  return value.replace(IC_RE, " ").replace(/\s+/g, " ").trim();
}

/** ngspice deck text for the IC, e.g. ` IC=1` (empty if none). */
export function icSpecDeckText(value: string): string {
  const ic = parseIcValue(value);
  return ic === null ? "" : ` IC=${ic}`;
}
