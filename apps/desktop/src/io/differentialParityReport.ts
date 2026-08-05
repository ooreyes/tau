/**
 * Coverage matrix for authored-analysis differential parity (LTspice vs Tau /
 * ngspice). Pure helpers so the default unit suite can lock the report shape;
 * the corpus runner fills cells from real paired simulator runs.
 */

export type DifferentialAnalysis =
  | "tran"
  | "ac"
  | "dc"
  | "op"
  | "noise"
  | "tf"
  | "step"
  | "meas";

export type DifferentialCellStatus = "pass" | "gap" | "sibling";

export interface DifferentialCell {
  analysis: DifferentialAnalysis;
  circuit: string;
  topology: string;
  status: DifferentialCellStatus;
  /** One-line evidence: metric, tolerance, or why the cell is a gap. */
  note: string;
}

export interface DifferentialParityReport {
  generatedAt: string;
  cells: readonly DifferentialCell[];
}

const ANALYSES: readonly DifferentialAnalysis[] = [
  "tran", "ac", "dc", "op", "noise", "tf", "step", "meas",
];

export function summarizeDifferentialParity(cells: readonly DifferentialCell[]): {
  pass: number;
  sibling: number;
  gap: number;
  byAnalysis: Record<DifferentialAnalysis, { pass: number; sibling: number; gap: number }>;
} {
  const byAnalysis = Object.fromEntries(
    ANALYSES.map((analysis) => [analysis, { pass: 0, sibling: 0, gap: 0 }]),
  ) as Record<DifferentialAnalysis, { pass: number; sibling: number; gap: number }>;
  let pass = 0;
  let sibling = 0;
  let gap = 0;
  for (const cell of cells) {
    byAnalysis[cell.analysis][cell.status] += 1;
    if (cell.status === "pass") pass += 1;
    else if (cell.status === "sibling") sibling += 1;
    else gap += 1;
  }
  return { pass, sibling, gap, byAnalysis };
}

/** Format the coverage matrix for script stdout (the DoD source of truth). */
export function formatDifferentialParityReport(report: DifferentialParityReport): string {
  const summary = summarizeDifferentialParity(report.cells);
  const lines: string[] = [
    "DIFFERENTIAL PARITY (LTspice vs Tau/ngspice)",
    `generated: ${report.generatedAt}`,
    "",
    "status legend: pass = this harness asserted numeric match; sibling = proven by",
    "  another committed dod-parity corpus spec; gap = not yet differentially proven",
    "  (do not treat gap as a pass)",
    "",
    pad("analysis", 10) + pad("circuit", 18) + pad("status", 10) + "note",
    "-".repeat(96),
  ];
  for (const cell of report.cells) {
    lines.push(
      pad(cell.analysis, 10)
        + pad(cell.circuit, 18)
        + pad(cell.status, 10)
        + `${cell.topology}; ${cell.note}`,
    );
  }
  lines.push("-".repeat(96));
  lines.push(
    `SUMMARY pass=${summary.pass} sibling=${summary.sibling} gap=${summary.gap} `
      + `(DoD box stays open until broad authored-analysis matrix is green)`,
  );
  lines.push("GAPS (explicit):");
  for (const cell of report.cells.filter((entry) => entry.status === "gap")) {
    lines.push(`  - ${cell.analysis}/${cell.circuit}: ${cell.note}`);
  }
  return `${lines.join("\n")}\n`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? `${value} ` : value + " ".repeat(width - value.length);
}
