// CSV export of waveform data (LTspice parity).
//
// LTspice can export the plotted data as a table; we produce the same kind of
// CSV - a header row naming the independent axis and each trace, then one row
// per sample. Kept as a pure string builder so it is trivially unit-testable
// and reusable for any axis (time, frequency, swept source).

/** A single named series of values aligned to the shared axis. */
export interface CsvSeries {
  label: string;
  values: ReadonlyArray<number>;
}

/**
 * Serialize an axis plus a set of aligned series into CSV text. The first
 * column is the axis; each subsequent column is a series. Rows run to the axis
 * length; a series shorter than the axis emits an empty cell past its end.
 * Values are written losslessly (full `String(number)`), with non-finite
 * samples (NaN/±Inf) written as empty cells so spreadsheets read them as gaps.
 */
export function seriesToCsv(axisName: string, axis: ReadonlyArray<number>, series: ReadonlyArray<CsvSeries>): string {
  const header = [axisName, ...series.map((s) => s.label)].map(csvCell).join(",");
  const rows: string[] = [header];
  for (let i = 0; i < axis.length; i++) {
    const cells = [num(axis[i]), ...series.map((s) => num(s.values[i]))];
    rows.push(cells.join(","));
  }
  return rows.join("\n");
}

/** Format a numeric cell: empty for missing/non-finite, lossless otherwise. */
function num(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "";
  return String(v);
}

/** Quote a header cell if it contains a comma, quote, or newline (RFC 4180). */
function csvCell(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * One stepped-family member on its own time grid. `.step` members do not share
 * a sample schedule after independent transient runs, so export keeps each
 * member's authored times rather than resampling onto a common axis.
 */
export interface StepFamilyCsvMember {
  label: string;
  times: ReadonlyArray<number>;
  values: ReadonlyArray<number>;
}

/**
 * Serialize a stepped family as a long-format CSV: `step,time,<signal>` with
 * one row per sample. Each member's time grid is preserved verbatim (empty /
 * non-finite values become blank cells). Header-only when `members` is empty.
 */
export function stepFamilyToCsv(
  signalLabel: string,
  members: ReadonlyArray<StepFamilyCsvMember>,
): string {
  const header = ["step", "time", signalLabel].map(csvCell).join(",");
  const rows: string[] = [header];
  for (const member of members) {
    const step = csvCell(member.label);
    const n = Math.min(member.times.length, member.values.length);
    // Prefer the shorter of times/values so a truncated series never invents
    // paired cells from undefined indices.
    for (let i = 0; i < n; i++) {
      rows.push([step, num(member.times[i]), num(member.values[i])].join(","));
    }
    // Trailing unpaired times (values shorter) still emit as gaps.
    for (let i = n; i < member.times.length; i++) {
      rows.push([step, num(member.times[i]), ""].join(","));
    }
  }
  return rows.join("\n");
}
