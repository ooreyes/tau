/**
 * Parse ngspice's printed `.meas` / `.four` results out of the engine message
 * log (P1.6). Deck emission already sends those cards to ngspice; this is the
 * read-back half so the UI can show the engine's numbers instead of only the
 * TypeScript re-implementations.
 *
 * Formats observed from ngspice 46 (sharedspice SendChar lines, optionally
 * prefixed `stdout`/`stderr`):
 *
 *   peak                =  2.54392e-01 at=  4.57296e-04
 *   vavg                =  6.99335e-03 from=  2.00000e-03 to=  5.00000e-03
 *   .meas tran bad max v(nope) failed!
 *
 *   Fourier analysis for v(out):
 *     No. Harmonics: 10, THD: 0.267908 %, …
 *   Harmonic Frequency   Magnitude   Phase       Norm. Mag   Norm. Phase
 *    0       0           0.0018007   0           0           0
 *    1       1000        0.157061    -80.753     1           0
 */

import type { FourierHarmonic, FourierResult } from "./fourier";
import type { MeasResult } from "./measure";

/** Strip the stream tag sharedspice sometimes prefixes onto SendChar text. */
function stripStreamPrefix(line: string): string {
  return line.replace(/^\s*(?:stdout|stderr)\s*/i, "").trim();
}

const MEAS_VALUE =
  /^([A-Za-z_][\w.]*)\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(?:at\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?))?/i;

const MEAS_FAILED = /^\.?meas(?:ure)?\b.*\bfailed\s*!?\s*$/i;

const FOURIER_HEADER = /^Fourier analysis for\s+(.+?)\s*:?\s*$/i;
const FOURIER_THD = /\bTHD:\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*%/i;
const FOURIER_ROW =
  /^\s*(\d+)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*$/;

function parseFloatToken(token: string): number | null {
  const value = Number(token);
  return Number.isFinite(value) ? value : null;
}

/**
 * Extract successful and failed `.meas` rows from ngspice diagnostics.
 * Skips the section banner ("Measurements for Transient Analysis") and any
 * unrelated engine chatter. Later duplicate names win (last print).
 */
export function parseNativeMeasurements(messages: ReadonlyArray<string>): MeasResult[] {
  const byName = new Map<string, MeasResult>();
  for (const raw of messages) {
    const line = stripStreamPrefix(raw);
    if (!line) continue;

    const failed = MEAS_FAILED.exec(line);
    if (failed) {
      const nameMatch = /^\.?meas(?:ure)?\s+(?:tran|ac|dc|op|tf|noise)?\s*([A-Za-z_][\w.]*)/i.exec(line);
      const name = nameMatch?.[1];
      if (name) {
        byName.set(name.toLowerCase(), {
          name,
          value: null,
          error: "ngspice measurement failed",
        });
      }
      continue;
    }

    // Ignore Fourier / harmonic table rows and section headers.
    if (/^Fourier analysis\b/i.test(line) || /^Harmonic\b/i.test(line) || /^-+$/.test(line)) continue;
    if (/^Measurements for\b/i.test(line)) continue;

    const match = MEAS_VALUE.exec(line);
    if (!match) continue;
    const name = match[1];
    // Reject words that are clearly not measurement names (e.g. DRAM stats).
    if (/^(total|no|using|node|circuit|doing|initial)$/i.test(name)) continue;
    const value = parseFloatToken(match[2]);
    if (value === null) continue;
    const at = match[3] !== undefined ? parseFloatToken(match[3]) : undefined;
    const result: MeasResult = { name, value };
    if (at !== null && at !== undefined) result.at = at;
    byName.set(name.toLowerCase(), result);
  }
  return [...byName.values()];
}

/**
 * Extract `.four` tables from ngspice diagnostics. One {@link FourierResult}
 * per "Fourier analysis for <signal>:" block; THD is converted from percent to
 * a fraction to match Tau's TS `runFourier` contract.
 */
export function parseNativeFourier(messages: ReadonlyArray<string>): FourierResult[] {
  const results: FourierResult[] = [];
  let current: {
    output: string;
    thdPercent: number | null;
    harmonics: FourierHarmonic[];
  } | null = null;

  const flush = () => {
    if (!current || current.harmonics.length === 0) {
      current = null;
      return;
    }
    const dc = current.harmonics.find((h) => h.harmonic === 0)?.magnitude ?? 0;
    const fundamental = current.harmonics.find((h) => h.harmonic === 1);
    results.push({
      output: current.output,
      frequency: fundamental?.frequency ?? 0,
      dc,
      harmonics: current.harmonics,
      thd: (current.thdPercent ?? 0) / 100,
    });
    current = null;
  };

  for (const raw of messages) {
    const line = stripStreamPrefix(raw);
    if (!line) continue;

    const header = FOURIER_HEADER.exec(line);
    if (header) {
      flush();
      current = { output: normalizeFourierOutput(header[1]), thdPercent: null, harmonics: [] };
      continue;
    }

    if (!current) continue;

    const thd = FOURIER_THD.exec(line);
    if (thd) {
      current.thdPercent = parseFloatToken(thd[1]);
      continue;
    }

    if (/^Harmonic\b/i.test(line) || /^-+/.test(line)) continue;

    const row = FOURIER_ROW.exec(line);
    if (!row) {
      // Unrelated trailing chatter ends the table.
      if (/^(Total|DRAM|Maximum|Current|Note:|Circuit:)/i.test(line)) {
        flush();
      }
      continue;
    }
    const harmonic = Number(row[1]);
    const frequency = parseFloatToken(row[2]);
    const magnitude = parseFloatToken(row[3]);
    const phase = parseFloatToken(row[4]);
    const normalized = parseFloatToken(row[5]);
    if (
      !Number.isInteger(harmonic) ||
      frequency === null ||
      magnitude === null ||
      phase === null ||
      normalized === null
    ) {
      continue;
    }
    current.harmonics.push({ harmonic, frequency, magnitude, phase, normalized });
  }
  flush();
  return results;
}

/** Prefer `V(out)` casing for UI labels when ngspice printed `v(out)`. */
function normalizeFourierOutput(raw: string): string {
  const trimmed = raw.trim();
  const voltage = /^v\((.+)\)$/i.exec(trimmed);
  if (voltage) return `V(${voltage[1]})`;
  const current = /^i\((.+)\)$/i.exec(trimmed);
  if (current) return `I(${current[1]})`;
  return trimmed;
}
