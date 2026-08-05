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

/** Generic long-format family member: own axis grid (freq / sweep / time). */
export interface AnalysisFamilyCsvMember {
  label: string;
  axis: ReadonlyArray<number>;
  values: ReadonlyArray<number>;
}

/**
 * Serialize a stepped / analysis family as long-format CSV:
 * `step,<axis>,<signal>` with one row per sample. Each member's axis grid is
 * preserved verbatim (empty / non-finite values become blank cells).
 * Header-only when `members` is empty.
 */
export function analysisFamilyToCsv(
  axisName: string,
  signalLabel: string,
  members: ReadonlyArray<AnalysisFamilyCsvMember>,
): string {
  const axis = axisName.trim() || "axis";
  const header = ["step", axis, signalLabel].map(csvCell).join(",");
  const rows: string[] = [header];
  for (const member of members) {
    const step = csvCell(member.label);
    const n = Math.min(member.axis.length, member.values.length);
    // Prefer the shorter of axis/values so a truncated series never invents
    // paired cells from undefined indices.
    for (let i = 0; i < n; i++) {
      rows.push([step, num(member.axis[i]), num(member.values[i])].join(","));
    }
    // Trailing unpaired axis samples (values shorter) still emit as gaps.
    for (let i = n; i < member.axis.length; i++) {
      rows.push([step, num(member.axis[i]), ""].join(","));
    }
  }
  return rows.join("\n");
}

/**
 * Serialize a stepped transient family as a long-format CSV: `step,time,<signal>`
 * with one row per sample. Each member's time grid is preserved verbatim.
 */
export function stepFamilyToCsv(
  signalLabel: string,
  members: ReadonlyArray<StepFamilyCsvMember>,
): string {
  return analysisFamilyToCsv(
    "time",
    signalLabel,
    members.map((m) => ({ label: m.label, axis: m.times, values: m.values })),
  );
}

/**
 * Serialize an FFT amplitude spectrum: `freq_Hz,<signal>,<signal>_dB` one row
 * per bin (including DC). Reuses {@link seriesToCsv} so quoting/non-finite
 * cells match every other analysis export. THD stays in the FFT meter — this
 * is the numeric spectrum dump LTspice's FFT viewer can File→Export.
 */
export function spectrumToCsv(
  spectrum: {
    frequencies: ReadonlyArray<number>;
    magnitude: ReadonlyArray<number>;
    magnitudeDb: ReadonlyArray<number>;
  },
  signalLabel = "magnitude",
): string {
  const label = signalLabel.trim() || "magnitude";
  return seriesToCsv("freq_Hz", spectrum.frequencies, [
    { label, values: spectrum.magnitude },
    { label: `${label}_dB`, values: spectrum.magnitudeDb },
  ]);
}

/** Minimal two-cursor readout shape for CSV export (matches `cursorReadout`). */
export interface CursorCsvReadout {
  x1: number;
  x2: number;
  dx: number;
  inverseDx: number;
  traces: ReadonlyArray<{
    label: string;
    unit?: string;
    y1: number;
    y2: number;
    dy: number;
    slope: number;
  }>;
}

/**
 * Serialize a two-cursor readout as `signal,unit,c1,c2,delta,slope`.
 * The first data row is the independent axis (`time` by default); slope there
 * is `1/|Δt|` (Hz). Per-trace rows follow with value deltas and dy/dx slope.
 */
export function cursorReadoutToCsv(readout: CursorCsvReadout, axisLabel = "time", axisUnit = "s"): string {
  const header = ["signal", "unit", "c1", "c2", "delta", "slope"].map(csvCell).join(",");
  const rows: string[] = [header];
  rows.push(
    [
      csvCell(axisLabel),
      csvCell(axisUnit),
      num(readout.x1),
      num(readout.x2),
      num(readout.dx),
      num(readout.inverseDx),
    ].join(","),
  );
  for (const t of readout.traces) {
    rows.push(
      [
        csvCell(t.label),
        csvCell(t.unit ?? ""),
        num(t.y1),
        num(t.y2),
        num(t.dy),
        num(t.slope),
      ].join(","),
    );
  }
  return rows.join("\n");
}
