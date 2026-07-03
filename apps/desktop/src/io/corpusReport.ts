/**
 * Acceptance-corpus reporting (AGENTS.md → Definition of Done). The corpus
 * runner (`scripts/acceptanceCorpus.corpus.ts`) walks the user's own LTspice
 * `.asc` files, imports each one, builds an `.op` deck, and batch-runs it in
 * ngspice; this module holds the pure, unit-testable pieces — per-file result
 * shape, ngspice-output verdict, aggregation, and the printed report — so the
 * script itself is only file/process glue.
 */

/** Outcome of pushing one corpus file through import → deck → ngspice op. */
export interface CorpusRow {
  /** Display name, e.g. "Educational/astable.asc". */
  file: string;
  /** parseAsc + ascToSchematic succeeded (throws → false). */
  imported: boolean;
  /** Import warnings (unmapped symbols, non-pin-accurate placements…). */
  warnings: number;
  /** buildSpiceDeck produced a netlist. */
  deckBuilt: boolean;
  /** ngspice -b solved the operating point. */
  opConverged: boolean;
  /** First failure message (import throw, deck throw, or ngspice marker). */
  error?: string;
}

export interface CorpusSummary {
  total: number;
  imported: number;
  /** Imported with zero warnings. */
  warningClean: number;
  deckBuilt: number;
  opConverged: number;
}

export function summarizeCorpus(rows: CorpusRow[]): CorpusSummary {
  return {
    total: rows.length,
    imported: rows.filter((r) => r.imported).length,
    warningClean: rows.filter((r) => r.imported && r.warnings === 0).length,
    deckBuilt: rows.filter((r) => r.deckBuilt).length,
    opConverged: rows.filter((r) => r.opConverged).length,
  };
}

/**
 * Judge a batch ngspice run. Exit status alone is not trustworthy (ngspice
 * exits 0 after printing "simulation(s) aborted"), so the verdict needs the
 * output text: any known failure marker fails, and a successful `.op` must
 * actually print its solution ("No. of Data Rows"). A null status means the
 * process was killed (timeout) — always a failure.
 */
export function ngspiceOpSucceeded(output: string, status: number | null): boolean {
  if (status === null || status !== 0) return false;
  const text = output.toLowerCase();
  const failureMarkers = [
    "simulation(s) aborted",
    "singular matrix",
    "fatal error",
    "no convergence",
    "run aborted",
    "unable to find definition of model",
    "could not find a valid modelname",
  ];
  if (failureMarkers.some((marker) => text.includes(marker))) return false;
  return text.includes("no. of data rows");
}

/** Fixed-width per-file table + summary block, ready to print. */
export function formatCorpusReport(rows: CorpusRow[]): string {
  const summary = summarizeCorpus(rows);
  const nameWidth = Math.max(4, ...rows.map((r) => r.file.length));
  const lines: string[] = [];
  lines.push(`${"file".padEnd(nameWidth)}  import  warn  deck  op`);
  for (const r of rows) {
    const mark = (ok: boolean) => (ok ? "  ✓ " : "  ✗ ");
    lines.push(
      `${r.file.padEnd(nameWidth)}  ${mark(r.imported)}   ${String(r.warnings).padStart(3)}${mark(r.deckBuilt)} ${mark(r.opConverged)}${r.error ? `  ${r.error}` : ""}`,
    );
  }
  lines.push("");
  lines.push(
    `total ${summary.total} · imported ${summary.imported} · warning-clean ${summary.warningClean} · deck-built ${summary.deckBuilt} · op-converged ${summary.opConverged}`,
  );
  return lines.join("\n");
}
