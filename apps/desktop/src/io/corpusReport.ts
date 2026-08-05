/**
 * Acceptance-corpus reporting. The corpus
 * runner (`scripts/acceptanceCorpus.corpus.ts`) walks the user's own LTspice
 * `.asc` files, imports each one, builds an `.op` deck, and batch-runs it in
 * ngspice; this module holds the pure, unit-testable pieces - per-file result
 * shape, ngspice-output verdict, aggregation, and the printed report - so the
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
  /**
   * The imported document passed `validateSchematicDocument` - the same gate
   * every `.sim` load and the `.asc` open path both run through. Only
   * meaningful when `imported` is true (mirrors `warningClean`'s convention);
   * a regression guard against the validator silently over-tightening against
   * a real, non-hostile file.
   */
  validated: boolean;
  /** Named device models replaced by a generic starter. Must remain zero; a
   *  nonzero value is release-failing evidence even if ngspice converged. */
  modelSubstitutions: number;
  /** First failure message (import throw, deck throw, or ngspice marker). */
  error?: string;
  /**
   * Missing subcircuit names caught by `buildSpiceDeck` / the corpus harness
   * before ngspice (same list the app path refuses on). Structured signal for
   * capability classification — do not infer solely from error-message text.
   */
  unresolvedSubckts?: string[];
}

/**
 * Capability bucket for one corpus file. Replaces the old prefix-only
 * "honest refusal vs hard failure" split that could be gamed by error wording.
 *
 * - `success` — imported, validated, deck built, and (unless ngspice skipped) OP converged.
 * - `capability_refusal` — product refused at deck time (missing library /
 *   unsupported device / integrity block), including unresolvedSubckts.
 * - `deck_guard_leak` — reached ngspice and died on a missing subckt/model that
 *   the deck builder should have refused first.
 * - `failure` — import/validate/unexpected deck throw, or a real OP failure
 *   (singular matrix, convergence, timeout, …) that is not a guard leak.
 */
export type CorpusCapability =
  | "success"
  | "capability_refusal"
  | "deck_guard_leak"
  | "failure";

export interface CorpusCapabilitySummary {
  success: number;
  capability_refusal: number;
  deck_guard_leak: number;
  failure: number;
}

export interface CorpusSummary {
  total: number;
  imported: number;
  /** Imported with zero warnings. */
  warningClean: number;
  deckBuilt: number;
  opConverged: number;
  /** Imported AND passed validateSchematicDocument. */
  validated: number;
  modelSubstitutions: number;
}

export function summarizeCorpus(rows: CorpusRow[]): CorpusSummary {
  return {
    total: rows.length,
    imported: rows.filter((r) => r.imported).length,
    warningClean: rows.filter((r) => r.imported && r.warnings === 0).length,
    deckBuilt: rows.filter((r) => r.deckBuilt).length,
    opConverged: rows.filter((r) => r.opConverged).length,
    validated: rows.filter((r) => r.imported && r.validated).length,
    modelSubstitutions: rows.reduce((count, row) => count + row.modelSubstitutions, 0),
  };
}

/** OP-time markers that mean the deck let a missing definition reach ngspice. */
const DECK_GUARD_LEAK_MARKERS = [
  /unknown subckt/i,
  /could not find a valid modelname/i,
  /unable to find definition of model/i,
  /unknown model/i,
];

/**
 * Classify one corpus row into a capability bucket. Prefer structured fields
 * (`unresolvedSubckts`, stage flags) over message prefixes; prefixes remain a
 * fallback for product-copy refusals that do not yet attach structured data.
 */
export function classifyCorpusCapability(
  row: CorpusRow,
  options: { skipNgspice?: boolean } = {},
): CorpusCapability {
  const skipNgspice = options.skipNgspice === true;
  if (
    row.imported
    && row.validated
    && row.deckBuilt
    && (skipNgspice || row.opConverged)
    && !row.error
  ) {
    return "success";
  }

  if (row.unresolvedSubckts && row.unresolvedSubckts.length > 0) {
    return "capability_refusal";
  }

  if (row.error?.startsWith("deck: ")) {
    const body = row.error.slice("deck: ".length);
    if (
      body.startsWith("Simulation refused:")
      || body.startsWith("No imported library defines the subcircuit")
      || body.startsWith("No imported library defines these subcircuits:")
    ) {
      return "capability_refusal";
    }
    return "failure";
  }

  if (row.error?.startsWith("op: ")) {
    const body = row.error.slice("op: ".length);
    if (DECK_GUARD_LEAK_MARKERS.some((marker) => marker.test(body))) {
      return "deck_guard_leak";
    }
    return "failure";
  }

  return "failure";
}

export function summarizeCorpusCapability(
  rows: CorpusRow[],
  options: { skipNgspice?: boolean } = {},
): CorpusCapabilitySummary {
  const summary: CorpusCapabilitySummary = {
    success: 0,
    capability_refusal: 0,
    deck_guard_leak: 0,
    failure: 0,
  };
  for (const row of rows) {
    summary[classifyCorpusCapability(row, options)] += 1;
  }
  return summary;
}

export function formatCorpusCapabilitySummary(summary: CorpusCapabilitySummary): string {
  return [
    `success ${summary.success}`,
    `capability-refusal ${summary.capability_refusal}`,
    `deck-guard-leak ${summary.deck_guard_leak}`,
    `failure ${summary.failure}`,
  ].join(" · ");
}

/**
 * Named-device fidelity bucket for one recursive-corpus file (AGENTS ≥95%
 * floor). Encrypted-model dependents are excluded from the unencrypted
 * denominator — they are not a product soft-fail we can fix in code.
 *
 * - `exact` — imported, validated, deck built with zero model substitutions.
 * - `refuse` — honest capability refusal that is not encrypted-dependent.
 * - `silent` — an accepted deck that substituted a named model (must stay 0).
 * - `hard_failure` — import/validate/unexpected deck/guard-leak/OP failure.
 * - `encrypted` — capability refusal whose schematic names an encrypted
 *   installed ModelFile (excluded from the ≥95% rate).
 */
export type NamedDeviceBucket =
  | "exact"
  | "refuse"
  | "silent"
  | "hard_failure"
  | "encrypted";

export interface NamedDeviceFidelitySummary {
  exact: number;
  refuse: number;
  silent: number;
  hardFailure: number;
  encryptedExcluded: number;
  /** Denominator for the ≥95% floor: exact + refuse + silent + hardFailure. */
  unencrypted: number;
  /** exact / unencrypted, or 0 when unencrypted is 0. */
  exactRate: number;
}

/**
 * Match the native `read_installed_ltspice_model` rejection: null bytes or a
 * high ratio of suspicious control bytes mean binary/encrypted ADI content.
 * Also recognizes LTspice's plaintext `<Binary File>` banner.
 */
export function isEncryptedModelBytes(bytes: Uint8Array | Buffer): boolean {
  if (bytes.length === 0) return false;
  const head = typeof bytes.slice === "function"
    ? bytes.subarray(0, Math.min(bytes.length, 64))
    : bytes;
  const headText = Buffer.from(head).toString("latin1");
  if (headText.includes("<Binary File>")) return true;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0) return true;
  }
  let suspicious = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i]!;
    if (byte < 0x09 || (byte >= 0x0e && byte < 0x20)) suspicious += 1;
  }
  return suspicious * 100 > bytes.length;
}

export function classifyNamedDeviceBucket(
  row: CorpusRow,
  options: { encryptedDependent?: boolean; skipNgspice?: boolean } = {},
): NamedDeviceBucket {
  if (row.deckBuilt && row.modelSubstitutions > 0) {
    return "silent";
  }

  const capability = classifyCorpusCapability(row, { skipNgspice: options.skipNgspice });
  if (capability === "success") {
    return "exact";
  }
  if (capability === "capability_refusal") {
    // Encrypted exclusion applies ONLY to honest capability refusals.
    // Never rebucket hard_failure here — that would hide real deck/import
    // failures behind encrypted-excluded and fake HF→0.
    return options.encryptedDependent ? "encrypted" : "refuse";
  }
  return "hard_failure";
}

export function summarizeNamedDeviceFidelity(
  rows: ReadonlyArray<{ row: CorpusRow; encryptedDependent: boolean }>,
  options: { skipNgspice?: boolean } = {},
): NamedDeviceFidelitySummary {
  let exact = 0;
  let refuse = 0;
  let silent = 0;
  let hardFailure = 0;
  let encryptedExcluded = 0;
  for (const entry of rows) {
    const bucket = classifyNamedDeviceBucket(entry.row, {
      encryptedDependent: entry.encryptedDependent,
      skipNgspice: options.skipNgspice,
    });
    switch (bucket) {
      case "exact":
        exact += 1;
        break;
      case "refuse":
        refuse += 1;
        break;
      case "silent":
        silent += 1;
        break;
      case "hard_failure":
        hardFailure += 1;
        break;
      case "encrypted":
        encryptedExcluded += 1;
        break;
    }
  }
  const unencrypted = exact + refuse + silent + hardFailure;
  return {
    exact,
    refuse,
    silent,
    hardFailure,
    encryptedExcluded,
    unencrypted,
    exactRate: unencrypted === 0 ? 0 : exact / unencrypted,
  };
}

/** Machine-readable stdout line — DoD claims must cite this, not prose. */
export function formatNamedDeviceRecursiveSummary(summary: NamedDeviceFidelitySummary): string {
  const pct = (summary.exactRate * 100).toFixed(1);
  return [
    "NAMED-DEVICE-RECURSIVE:",
    `unencrypted=${summary.unencrypted}`,
    `exact=${summary.exact}`,
    `refuse=${summary.refuse}`,
    `silent=${summary.silent}`,
    `hard-failure=${summary.hardFailure}`,
    `encrypted-excluded=${summary.encryptedExcluded}`,
    `exact-rate=${pct}%`,
  ].join(" ");
}

/**
 * Judge a batch ngspice run. Exit status alone is not trustworthy (ngspice
 * exits 0 after printing "simulation(s) aborted"), so the verdict needs the
 * output text: any known failure marker fails, and a successful `.op` must
 * actually print its solution ("No. of Data Rows"). A null status means the
 * process was killed (timeout) - always a failure.
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
  lines.push(`${"file".padEnd(nameWidth)}  import  warn  deck  op  valid  subst`);
  for (const r of rows) {
    const mark = (ok: boolean) => (ok ? "  ✓ " : "  ✗ ");
    lines.push(
      `${r.file.padEnd(nameWidth)}  ${mark(r.imported)}   ${String(r.warnings).padStart(3)}${mark(r.deckBuilt)} ${mark(r.opConverged)}${mark(r.validated)}  ${String(r.modelSubstitutions).padStart(3)}${r.error ? `  ${r.error}` : ""}`,
    );
  }
  lines.push("");
  lines.push(
    `total ${summary.total} · imported ${summary.imported} · warning-clean ${summary.warningClean} · deck-built ${summary.deckBuilt} · op-converged ${summary.opConverged} · schema-valid ${summary.validated} · model-substitutions ${summary.modelSubstitutions}`,
  );
  return lines.join("\n");
}
