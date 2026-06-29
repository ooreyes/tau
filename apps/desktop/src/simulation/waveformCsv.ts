// CSV export of waveform data (FEATURE_PARITY §6 "export CSV").
//
// LTspice can export the plotted data as a table; we produce the same kind of
// CSV — a header row naming the independent axis and each trace, then one row
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
