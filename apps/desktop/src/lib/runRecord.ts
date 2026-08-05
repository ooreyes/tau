/**
 * Reproducible simulation run records (product-gates DoD slice).
 *
 * Each completed (or failed/refused) analysis produces a versioned
 * `tau.run.record.v1` envelope: circuit identity (document signature + optional
 * deck fingerprint), engine provenance, machine-readable diagnostics,
 * measurements, and a bounded summary — enough to re-open or compare runs
 * without shipping full waveform samples.
 *
 * Does not claim the full student/pro/dev product-gates box: first-success
 * learning path and versioned CLI/API remain open.
 */

import { diskContentFingerprint } from "./externalEditConflict";

export const RUN_RECORD_KIND = "tau.run.record.v1" as const;
export const RUN_RECORD_VERSION = 1 as const;
export const RUN_RECORD_HISTORY_KEY = "tau.run.history.v1";
export const RUN_RECORD_HISTORY_VERSION = 1 as const;
/** Cap persisted session history so localStorage cannot grow unbounded. */
export const RUN_RECORD_HISTORY_MAX = 20;
/** Cap diagnostic / measurement arrays on the wire format. */
const MAX_DIAGNOSTICS = 64;
const MAX_MEASUREMENTS = 64;
const MAX_HIGHLIGHTS = 32;
const MAX_TITLE_CHARS = 120;
const MAX_PATH_CHARS = 1_024;
const MAX_MESSAGE_CHARS = 480;
const MAX_DETAIL_CHARS = 4_000;

export type RunRecordAnalysis =
  | "tran"
  | "ac"
  | "dc"
  | "op"
  | "tf"
  | "noise"
  | "step";

export type RunRecordStatus = "ok" | "error" | "refused" | "cancelled";

export type RunRecordEngine = "ngspice" | "preview" | "unknown";

export interface RunRecordDiagnostic {
  severity: "error" | "warning" | "info";
  /** Stable machine code (e.g. `sim.error`, `sim.warning`). */
  code: string;
  message: string;
}

export interface RunRecordMeasurement {
  name: string;
  value: number | null;
  at?: number;
  error?: string;
}

export interface RunRecordHighlight {
  label: string;
  value: number;
  unit?: string;
}

export interface RunRecordSummary {
  sampleCount?: number;
  netCount?: number;
  componentCount?: number;
  stopTime?: number;
  durationMs?: number | null;
  highlights?: RunRecordHighlight[];
}

export interface TauRunRecord {
  kind: typeof RUN_RECORD_KIND;
  version: typeof RUN_RECORD_VERSION;
  createdAt: number;
  circuit: {
    title: string;
    filePath: string | null;
    documentSignature: string;
    deckFingerprint: string | null;
  };
  analysis: {
    kind: RunRecordAnalysis;
    directive: string | null;
    engine: RunRecordEngine;
  };
  status: RunRecordStatus;
  diagnostics: RunRecordDiagnostic[];
  measurements: RunRecordMeasurement[];
  summary: RunRecordSummary;
  technicalDetail: string | null;
}

export interface BuildRunRecordInput {
  title: string;
  filePath?: string | null;
  documentSignature: string;
  /** Derived SPICE deck text when available; fingerprinted, never stored raw. */
  deckText?: string | null;
  analysis: RunRecordAnalysis;
  directive?: string | null;
  engine?: RunRecordEngine | null;
  status: RunRecordStatus;
  message?: string | null;
  details?: string | null;
  warnings?: readonly string[];
  measurements?: readonly RunRecordMeasurement[];
  summary?: RunRecordSummary;
  createdAt?: number;
}

export interface RunRecordHistoryEnvelope {
  version: typeof RUN_RECORD_HISTORY_VERSION;
  records: TauRunRecord[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function clampText(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function clampTitle(title: string): string {
  const trimmed = title.trim() || "untitled.asc";
  return clampText(trimmed, MAX_TITLE_CHARS);
}

function clampPath(path: string | null | undefined): string | null {
  if (typeof path !== "string" || path.length === 0) return null;
  return path.length > MAX_PATH_CHARS ? path.slice(0, MAX_PATH_CHARS) : path;
}

const ANALYSIS_KINDS = new Set<RunRecordAnalysis>([
  "tran", "ac", "dc", "op", "tf", "noise", "step",
]);
const STATUSES = new Set<RunRecordStatus>(["ok", "error", "refused", "cancelled"]);
const ENGINES = new Set<RunRecordEngine>(["ngspice", "preview", "unknown"]);

/** Fingerprint of the derived deck — length-prefixed FNV shared with disk edits. */
export function deckFingerprint(deckText: string | null | undefined): string | null {
  if (typeof deckText !== "string" || deckText.length === 0) return null;
  return diskContentFingerprint(deckText);
}

/**
 * Build a versioned run record. Waveform samples are intentionally omitted —
 * reproducibility is keyed by document signature + deck fingerprint + analysis.
 */
export function buildRunRecord(input: BuildRunRecordInput): TauRunRecord {
  const diagnostics: RunRecordDiagnostic[] = [];
  if (input.status === "error" || input.status === "refused") {
    const message = typeof input.message === "string" && input.message.trim()
      ? clampText(input.message.trim(), MAX_MESSAGE_CHARS)
      : input.status === "refused"
        ? "Simulation refused."
        : "Simulation failed.";
    diagnostics.push({
      severity: "error",
      code: input.status === "refused" ? "sim.refused" : "sim.error",
      message,
    });
  } else if (input.status === "cancelled") {
    diagnostics.push({
      severity: "info",
      code: "sim.cancelled",
      message: typeof input.message === "string" && input.message.trim()
        ? clampText(input.message.trim(), MAX_MESSAGE_CHARS)
        : "Simulation cancelled.",
    });
  }
  for (const warning of input.warnings ?? []) {
    if (typeof warning !== "string" || !warning.trim()) continue;
    diagnostics.push({
      severity: "warning",
      code: "sim.warning",
      message: clampText(warning.trim(), MAX_MESSAGE_CHARS),
    });
    if (diagnostics.length >= MAX_DIAGNOSTICS) break;
  }

  const measurements: RunRecordMeasurement[] = [];
  for (const meas of input.measurements ?? []) {
    if (!meas || typeof meas.name !== "string" || !meas.name.trim()) continue;
    const entry: RunRecordMeasurement = {
      name: clampText(meas.name.trim(), 80),
      value: typeof meas.value === "number" && Number.isFinite(meas.value) ? meas.value : null,
    };
    if (typeof meas.at === "number" && Number.isFinite(meas.at)) entry.at = meas.at;
    if (typeof meas.error === "string" && meas.error.trim()) {
      entry.error = clampText(meas.error.trim(), MAX_MESSAGE_CHARS);
    }
    measurements.push(entry);
    if (measurements.length >= MAX_MEASUREMENTS) break;
  }

  const summary: RunRecordSummary = {};
  if (input.summary) {
    if (typeof input.summary.sampleCount === "number" && Number.isFinite(input.summary.sampleCount)) {
      summary.sampleCount = input.summary.sampleCount;
    }
    if (typeof input.summary.netCount === "number" && Number.isFinite(input.summary.netCount)) {
      summary.netCount = input.summary.netCount;
    }
    if (typeof input.summary.componentCount === "number" && Number.isFinite(input.summary.componentCount)) {
      summary.componentCount = input.summary.componentCount;
    }
    if (typeof input.summary.stopTime === "number" && Number.isFinite(input.summary.stopTime)) {
      summary.stopTime = input.summary.stopTime;
    }
    if (input.summary.durationMs === null) {
      summary.durationMs = null;
    } else if (typeof input.summary.durationMs === "number" && Number.isFinite(input.summary.durationMs)) {
      summary.durationMs = input.summary.durationMs;
    }
    if (Array.isArray(input.summary.highlights) && input.summary.highlights.length > 0) {
      summary.highlights = input.summary.highlights
        .filter((h): h is RunRecordHighlight =>
          Boolean(h)
          && typeof h.label === "string"
          && h.label.trim().length > 0
          && typeof h.value === "number"
          && Number.isFinite(h.value),
        )
        .slice(0, MAX_HIGHLIGHTS)
        .map((h) => ({
          label: clampText(h.label.trim(), 80),
          value: h.value,
          ...(typeof h.unit === "string" && h.unit.trim() ? { unit: clampText(h.unit.trim(), 16) } : {}),
        }));
    }
  }

  const createdAt = typeof input.createdAt === "number" && Number.isFinite(input.createdAt) && input.createdAt > 0
    ? input.createdAt
    : Date.now();

  const detail = typeof input.details === "string" && input.details.trim()
    ? clampText(input.details.trim(), MAX_DETAIL_CHARS)
    : null;

  return {
    kind: RUN_RECORD_KIND,
    version: RUN_RECORD_VERSION,
    createdAt,
    circuit: {
      title: clampTitle(input.title),
      filePath: clampPath(input.filePath),
      documentSignature: input.documentSignature,
      deckFingerprint: deckFingerprint(input.deckText),
    },
    analysis: {
      kind: input.analysis,
      directive: typeof input.directive === "string" && input.directive.trim()
        ? clampText(input.directive.trim(), MAX_MESSAGE_CHARS)
        : null,
      engine: input.engine && ENGINES.has(input.engine) ? input.engine : "unknown",
    },
    status: input.status,
    diagnostics,
    measurements,
    summary,
    technicalDetail: detail,
  };
}

function parseDiagnostic(value: unknown): RunRecordDiagnostic | null {
  const source = record(value);
  if (!source) return null;
  if (source.severity !== "error" && source.severity !== "warning" && source.severity !== "info") {
    return null;
  }
  if (typeof source.code !== "string" || !source.code) return null;
  if (typeof source.message !== "string" || !source.message) return null;
  return {
    severity: source.severity,
    code: source.code,
    message: source.message,
  };
}

function parseMeasurement(value: unknown): RunRecordMeasurement | null {
  const source = record(value);
  if (!source) return null;
  if (typeof source.name !== "string" || !source.name) return null;
  const entry: RunRecordMeasurement = {
    name: source.name,
    value: typeof source.value === "number" && Number.isFinite(source.value) ? source.value : null,
  };
  if (typeof source.at === "number" && Number.isFinite(source.at)) entry.at = source.at;
  if (typeof source.error === "string" && source.error) entry.error = source.error;
  return entry;
}

function parseHighlight(value: unknown): RunRecordHighlight | null {
  const source = record(value);
  if (!source) return null;
  if (typeof source.label !== "string" || !source.label) return null;
  if (typeof source.value !== "number" || !Number.isFinite(source.value)) return null;
  return {
    label: source.label,
    value: source.value,
    ...(typeof source.unit === "string" && source.unit ? { unit: source.unit } : {}),
  };
}

function parseSummary(value: unknown): RunRecordSummary {
  const source = record(value);
  if (!source) return {};
  const summary: RunRecordSummary = {};
  if (typeof source.sampleCount === "number" && Number.isFinite(source.sampleCount)) {
    summary.sampleCount = source.sampleCount;
  }
  if (typeof source.netCount === "number" && Number.isFinite(source.netCount)) {
    summary.netCount = source.netCount;
  }
  if (typeof source.componentCount === "number" && Number.isFinite(source.componentCount)) {
    summary.componentCount = source.componentCount;
  }
  if (typeof source.stopTime === "number" && Number.isFinite(source.stopTime)) {
    summary.stopTime = source.stopTime;
  }
  if (source.durationMs === null) summary.durationMs = null;
  else if (typeof source.durationMs === "number" && Number.isFinite(source.durationMs)) {
    summary.durationMs = source.durationMs;
  }
  if (Array.isArray(source.highlights)) {
    const highlights = source.highlights
      .map(parseHighlight)
      .filter((h): h is RunRecordHighlight => h !== null)
      .slice(0, MAX_HIGHLIGHTS);
    if (highlights.length > 0) summary.highlights = highlights;
  }
  return summary;
}

/** Strict parse — wrong version / corrupt payload returns null (never throws). */
export function parseRunRecord(value: unknown): TauRunRecord | null {
  const source = record(value);
  if (!source) return null;
  if (source.kind !== RUN_RECORD_KIND) return null;
  if (source.version !== RUN_RECORD_VERSION) return null;
  if (typeof source.createdAt !== "number" || !Number.isFinite(source.createdAt) || source.createdAt <= 0) {
    return null;
  }
  const circuit = record(source.circuit);
  if (!circuit) return null;
  if (typeof circuit.title !== "string" || !circuit.title) return null;
  if (typeof circuit.documentSignature !== "string" || !circuit.documentSignature) return null;
  const filePath = circuit.filePath === null || circuit.filePath === undefined
    ? null
    : typeof circuit.filePath === "string"
      ? circuit.filePath
      : null;
  const deckFingerprint = circuit.deckFingerprint === null || circuit.deckFingerprint === undefined
    ? null
    : typeof circuit.deckFingerprint === "string"
      ? circuit.deckFingerprint
      : null;

  const analysis = record(source.analysis);
  if (!analysis) return null;
  if (typeof analysis.kind !== "string" || !ANALYSIS_KINDS.has(analysis.kind as RunRecordAnalysis)) {
    return null;
  }
  if (typeof analysis.engine !== "string" || !ENGINES.has(analysis.engine as RunRecordEngine)) {
    return null;
  }
  const directive = analysis.directive === null || analysis.directive === undefined
    ? null
    : typeof analysis.directive === "string"
      ? analysis.directive
      : null;

  if (typeof source.status !== "string" || !STATUSES.has(source.status as RunRecordStatus)) {
    return null;
  }
  if (!Array.isArray(source.diagnostics) || !Array.isArray(source.measurements)) return null;

  const diagnostics = source.diagnostics
    .map(parseDiagnostic)
    .filter((d): d is RunRecordDiagnostic => d !== null)
    .slice(0, MAX_DIAGNOSTICS);
  const measurements = source.measurements
    .map(parseMeasurement)
    .filter((m): m is RunRecordMeasurement => m !== null)
    .slice(0, MAX_MEASUREMENTS);

  const technicalDetail = source.technicalDetail === null || source.technicalDetail === undefined
    ? null
    : typeof source.technicalDetail === "string"
      ? source.technicalDetail
      : null;

  return {
    kind: RUN_RECORD_KIND,
    version: RUN_RECORD_VERSION,
    createdAt: source.createdAt,
    circuit: {
      title: circuit.title,
      filePath,
      documentSignature: circuit.documentSignature,
      deckFingerprint,
    },
    analysis: {
      kind: analysis.kind as RunRecordAnalysis,
      directive,
      engine: analysis.engine as RunRecordEngine,
    },
    status: source.status as RunRecordStatus,
    diagnostics,
    measurements,
    summary: parseSummary(source.summary),
    technicalDetail,
  };
}

/** Pretty JSON suitable for `.tau-run.json` download / file write. */
export function serializeRunRecord(run: TauRunRecord): string {
  return `${JSON.stringify(run, null, 2)}\n`;
}

/** Download basename: `tank.asc` → `tank.tau-run.json`. */
export function runRecordFileName(title: string): string {
  const base = clampTitle(title).replace(/\.(asc|cir|net|sp)$/i, "") || "untitled";
  const safe = base.replace(/[^\w.\-]+/g, "_").replace(/^_+|_+$/g, "") || "untitled";
  return `${safe}.tau-run.json`;
}

/**
 * Identity key for reproducibility: same circuit + deck + analysis + status
 * diagnostics codes (ignores wall-clock createdAt / durationMs).
 */
export function runRecordReproducibilityKey(run: TauRunRecord): string {
  return JSON.stringify({
    documentSignature: run.circuit.documentSignature,
    deckFingerprint: run.circuit.deckFingerprint,
    analysis: run.analysis.kind,
    directive: run.analysis.directive,
    engine: run.analysis.engine,
    status: run.status,
    diagnosticCodes: run.diagnostics.map((d) => d.code),
    measurementNames: run.measurements.map((m) => m.name),
    sampleCount: run.summary.sampleCount ?? null,
    netCount: run.summary.netCount ?? null,
    componentCount: run.summary.componentCount ?? null,
    stopTime: run.summary.stopTime ?? null,
  });
}

function parseHistory(value: unknown): RunRecordHistoryEnvelope | null {
  const source = record(value);
  if (!source) return null;
  if (source.version !== RUN_RECORD_HISTORY_VERSION) return null;
  if (!Array.isArray(source.records)) return null;
  const records = source.records
    .map(parseRunRecord)
    .filter((r): r is TauRunRecord => r !== null)
    .slice(0, RUN_RECORD_HISTORY_MAX);
  return { version: RUN_RECORD_HISTORY_VERSION, records };
}

/** Newest-first session history from localStorage (empty when absent/corrupt). */
export function loadRunRecordHistory(storage: Storage = localStorage): TauRunRecord[] {
  try {
    const raw = storage.getItem(RUN_RECORD_HISTORY_KEY);
    if (!raw) return [];
    const parsed = parseHistory(JSON.parse(raw) as unknown);
    return parsed?.records ?? [];
  } catch {
    return [];
  }
}

/** Prepend a run; drop oldest past the cap. Returns the new newest-first list. */
export function rememberRunRecord(
  run: TauRunRecord,
  storage: Storage = localStorage,
): TauRunRecord[] {
  const next = [run, ...loadRunRecordHistory(storage).filter((r) => r.createdAt !== run.createdAt)]
    .slice(0, RUN_RECORD_HISTORY_MAX);
  try {
    const envelope: RunRecordHistoryEnvelope = {
      version: RUN_RECORD_HISTORY_VERSION,
      records: next,
    };
    storage.setItem(RUN_RECORD_HISTORY_KEY, JSON.stringify(envelope));
  } catch {
    // Quota / private mode — history is best-effort; export still works.
  }
  return next;
}

export function clearRunRecordHistory(storage: Storage = localStorage): void {
  try {
    storage.removeItem(RUN_RECORD_HISTORY_KEY);
  } catch {
    // ignore
  }
}
