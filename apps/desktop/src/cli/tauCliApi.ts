/**
 * Versioned Tau CLI/API (product-gates DoD slice — developer gate).
 *
 * Stable contract: `tau.cli.v1` with machine-readable diagnose envelopes
 * (`tau.cli.diagnose.v1`). Import → validate → deck-build (`.op` probe) and
 * emit structured diagnostics with stable codes + exit status. Does not run
 * ngspice (that stays on the native/corpus path); this surface is for scripts
 * and CI that need reproducible, parseable circuit diagnostics.
 *
 * Does not claim the full student/pro/dev product-gates box: first-success
 * learning path + contextual help remain open. SHIPPABLE? NO.
 */

import { importAsc, type AscImportOptions } from "../io/ascImport";
import { buildParamScope } from "../simulation/paramScope";
import { buildSpiceDeck, unresolvedSubcktMessage } from "../engine/spiceNetlist";
import { validateSchematicDocument } from "../schematic/documentValidation";
import { diskContentFingerprint } from "../lib/externalEditConflict";

export const TAU_CLI_API_VERSION = "tau.cli.v1" as const;
export const TAU_CLI_DIAGNOSE_KIND = "tau.cli.diagnose.v1" as const;
export const TAU_CLI_HELP_KIND = "tau.cli.help.v1" as const;

/** Documented commands for this API version. */
export const TAU_CLI_COMMANDS = ["diagnose", "help", "version"] as const;
export type TauCliCommand = (typeof TAU_CLI_COMMANDS)[number];

export type TauCliStatus = "ok" | "warning" | "error" | "refused";

/**
 * Process exit codes (stable for scripts):
 *   0 ok · 1 warning · 2 error · 3 refused · 64 usage
 */
export type TauCliExitCode = 0 | 1 | 2 | 3 | 64;

export interface TauCliDiagnostic {
  severity: "error" | "warning" | "info";
  /** Stable machine code, e.g. `import.warning`, `deck.refused`. */
  code: string;
  message: string;
}

export interface TauCliDiagnoseStages {
  import: {
    ok: boolean;
    warningCount: number;
    componentCount: number;
    wireCount: number;
    directiveCount: number;
  };
  validate: { ok: boolean };
  deck: {
    ok: boolean;
    refused: boolean;
    lineCount: number | null;
    unresolvedSubckts: string[];
    deckFingerprint: string | null;
  };
}

export interface TauCliDiagnoseResult {
  kind: typeof TAU_CLI_DIAGNOSE_KIND;
  apiVersion: typeof TAU_CLI_API_VERSION;
  status: TauCliStatus;
  exitCode: Exclude<TauCliExitCode, 64>;
  source: {
    path: string | null;
    title: string;
    /** Fingerprint of the input ASC bytes (not the deck). */
    contentFingerprint: string;
  };
  stages: TauCliDiagnoseStages;
  diagnostics: TauCliDiagnostic[];
}

export interface TauCliHelpResult {
  kind: typeof TAU_CLI_HELP_KIND;
  apiVersion: typeof TAU_CLI_API_VERSION;
  commands: readonly TauCliCommand[];
  usage: string[];
}

export interface TauCliVersionResult {
  kind: "tau.cli.version.v1";
  apiVersion: typeof TAU_CLI_API_VERSION;
  diagnoseKind: typeof TAU_CLI_DIAGNOSE_KIND;
}

export type TauCliResult = TauCliDiagnoseResult | TauCliHelpResult | TauCliVersionResult;

export interface DiagnoseAscInput {
  /** Raw `.asc` text (already decoded). */
  text: string;
  /** Display title, e.g. basename. */
  title?: string;
  /** Optional filesystem path for the envelope (never read here). */
  path?: string | null;
  /** Forwarded to `importAsc` (sibling hierarchy, symbol metadata, …). */
  importOptions?: AscImportOptions;
}

const MAX_DIAGNOSTICS = 64;
const MAX_MESSAGE_CHARS = 480;
const MAX_TITLE_CHARS = 120;
const MAX_PATH_CHARS = 1_024;

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

function pushDiagnostic(
  list: TauCliDiagnostic[],
  severity: TauCliDiagnostic["severity"],
  code: string,
  message: string,
): void {
  if (list.length >= MAX_DIAGNOSTICS) return;
  list.push({
    severity,
    code,
    message: clampText(message.trim() || code, MAX_MESSAGE_CHARS),
  });
}

function statusFromDiagnostics(
  diagnostics: readonly TauCliDiagnostic[],
  refused: boolean,
  importOk: boolean,
  validateOk: boolean,
  deckOk: boolean,
): { status: TauCliStatus; exitCode: Exclude<TauCliExitCode, 64> } {
  if (!importOk || diagnostics.some((d) => d.code === "import.error" || d.code === "validate.error")) {
    return { status: "error", exitCode: 2 };
  }
  if (refused || diagnostics.some((d) => d.code.startsWith("deck.refused") || d.code === "deck.error")) {
    // Explicit capability refusals vs hard deck errors share exit 3 when refused,
    // exit 2 for unexpected deck throws without refuse flag.
    if (refused) return { status: "refused", exitCode: 3 };
    return { status: "error", exitCode: 2 };
  }
  if (!validateOk || !deckOk) {
    return { status: "error", exitCode: 2 };
  }
  if (diagnostics.some((d) => d.severity === "warning")) {
    return { status: "warning", exitCode: 1 };
  }
  return { status: "ok", exitCode: 0 };
}

/**
 * Diagnose ASC text: import → schema validate → `.op` deck build.
 * Never calls ngspice. Waveform samples are never included.
 */
export function diagnoseAsc(input: DiagnoseAscInput): TauCliDiagnoseResult {
  const diagnostics: TauCliDiagnostic[] = [];
  const title = clampTitle(input.title ?? "untitled.asc");
  const path = clampPath(input.path);
  const contentFingerprint = diskContentFingerprint(input.text);

  const stages: TauCliDiagnoseStages = {
    import: {
      ok: false,
      warningCount: 0,
      componentCount: 0,
      wireCount: 0,
      directiveCount: 0,
    },
    validate: { ok: false },
    deck: {
      ok: false,
      refused: false,
      lineCount: null,
      unresolvedSubckts: [],
      deckFingerprint: null,
    },
  };

  let imported;
  try {
    imported = importAsc(input.text, input.importOptions ?? {});
    stages.import.ok = true;
    stages.import.warningCount = imported.warnings.length;
    stages.import.componentCount = imported.components.length;
    stages.import.wireCount = imported.wires.length;
    stages.import.directiveCount = imported.directives.length;
    for (const warning of imported.warnings) {
      pushDiagnostic(diagnostics, "warning", "import.warning", warning);
    }
    for (const note of imported.notes) {
      pushDiagnostic(diagnostics, "info", "import.note", note);
    }
  } catch (error) {
    pushDiagnostic(
      diagnostics,
      "error",
      "import.error",
      error instanceof Error ? error.message : String(error),
    );
    const { status, exitCode } = statusFromDiagnostics(diagnostics, false, false, false, false);
    return {
      kind: TAU_CLI_DIAGNOSE_KIND,
      apiVersion: TAU_CLI_API_VERSION,
      status,
      exitCode,
      source: { path, title, contentFingerprint },
      stages,
      diagnostics,
    };
  }

  try {
    validateSchematicDocument({
      components: imported.components,
      wires: imported.wires,
      probes: [],
      netLabels: imported.netLabels,
      directives: imported.directives,
      textAnnotations: imported.textAnnotations,
      ascShapes: imported.shapes,
      ascDataFlags: imported.dataFlags,
      ascForeignSymbols: imported.foreignSymbols,
      ascHierarchicalBlocks: imported.hierarchicalBlocks,
    });
    stages.validate.ok = true;
  } catch (error) {
    pushDiagnostic(
      diagnostics,
      "error",
      "validate.error",
      error instanceof Error ? error.message : String(error),
    );
    const { status, exitCode } = statusFromDiagnostics(diagnostics, false, true, false, false);
    return {
      kind: TAU_CLI_DIAGNOSE_KIND,
      apiVersion: TAU_CLI_API_VERSION,
      status,
      exitCode,
      source: { path, title, contentFingerprint },
      stages,
      diagnostics,
    };
  }

  try {
    const params = buildParamScope(imported.directives);
    const deck = buildSpiceDeck(
      {
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        params,
        directives: imported.directives,
        ascForeignSymbols: imported.foreignSymbols,
      },
      { kind: "op" },
    );
    if (deck.unresolvedSubckts.length > 0) {
      stages.deck.refused = true;
      stages.deck.unresolvedSubckts = [...deck.unresolvedSubckts];
      pushDiagnostic(
        diagnostics,
        "error",
        "deck.refused.unresolved_subckt",
        unresolvedSubcktMessage(deck.unresolvedSubckts),
      );
    } else {
      stages.deck.ok = true;
      stages.deck.lineCount = deck.netlist.split("\n").filter((line) => line.length > 0).length;
      stages.deck.deckFingerprint = diskContentFingerprint(deck.netlist);
      pushDiagnostic(diagnostics, "info", "deck.ok", "Built .op deck.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const refused = /refused|no electrically equivalent|unsupported/i.test(message);
    stages.deck.refused = refused;
    pushDiagnostic(
      diagnostics,
      "error",
      refused ? "deck.refused" : "deck.error",
      message,
    );
  }

  const { status, exitCode } = statusFromDiagnostics(
    diagnostics,
    stages.deck.refused,
    stages.import.ok,
    stages.validate.ok,
    stages.deck.ok,
  );

  return {
    kind: TAU_CLI_DIAGNOSE_KIND,
    apiVersion: TAU_CLI_API_VERSION,
    status,
    exitCode,
    source: { path, title, contentFingerprint },
    stages,
    diagnostics,
  };
}

export function cliHelp(): TauCliHelpResult {
  return {
    kind: TAU_CLI_HELP_KIND,
    apiVersion: TAU_CLI_API_VERSION,
    commands: TAU_CLI_COMMANDS,
    usage: [
      "tau-cli version",
      "tau-cli help",
      "tau-cli diagnose [--json] <file.asc>",
      "tau-cli diagnose --text --json   # read ASC from stdin",
    ],
  };
}

export function cliVersion(): TauCliVersionResult {
  return {
    kind: "tau.cli.version.v1",
    apiVersion: TAU_CLI_API_VERSION,
    diagnoseKind: TAU_CLI_DIAGNOSE_KIND,
  };
}

export interface ParsedCliArgs {
  command: TauCliCommand | null;
  json: boolean;
  /** When true, diagnose reads ASC from `text` / stdin instead of a path. */
  fromStdin: boolean;
  path: string | null;
  usageError: string | null;
}

/** Parse argv after the process name (e.g. `process.argv.slice(2)`). */
export function parseTauCliArgs(argv: readonly string[]): ParsedCliArgs {
  const args = [...argv];
  let json = false;
  let fromStdin = false;
  const positionals: string[] = [];

  for (const arg of args) {
    if (arg === "--json" || arg === "-j") {
      json = true;
      continue;
    }
    if (arg === "--text" || arg === "--stdin") {
      fromStdin = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return { command: "help", json, fromStdin: false, path: null, usageError: null };
    }
    if (arg === "--version" || arg === "-V") {
      return { command: "version", json, fromStdin: false, path: null, usageError: null };
    }
    if (arg.startsWith("-")) {
      return {
        command: null,
        json,
        fromStdin,
        path: null,
        usageError: `Unknown option: ${arg}`,
      };
    }
    positionals.push(arg);
  }

  const commandRaw = positionals[0] ?? null;
  if (!commandRaw) {
    return {
      command: "help",
      json,
      fromStdin: false,
      path: null,
      usageError: null,
    };
  }
  if (!(TAU_CLI_COMMANDS as readonly string[]).includes(commandRaw)) {
    return {
      command: null,
      json,
      fromStdin,
      path: null,
      usageError: `Unknown command: ${commandRaw}`,
    };
  }
  const command = commandRaw as TauCliCommand;
  if (command === "diagnose") {
    const path = positionals[1] ?? null;
    if (!fromStdin && !path) {
      return {
        command: null,
        json,
        fromStdin,
        path: null,
        usageError: "diagnose requires <file.asc> or --text",
      };
    }
    if (fromStdin && path) {
      return {
        command: null,
        json,
        fromStdin,
        path: null,
        usageError: "diagnose: pass either <file.asc> or --text, not both",
      };
    }
    return { command, json, fromStdin, path, usageError: null };
  }
  if (positionals.length > 1) {
    return {
      command: null,
      json,
      fromStdin,
      path: null,
      usageError: `${command} does not take a file argument`,
    };
  }
  return { command, json, fromStdin: false, path: null, usageError: null };
}

/** Pretty JSON for machine consumers (trailing newline). */
export function serializeCliResult(result: TauCliResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

/** Human-readable summary when `--json` is not set. */
export function formatCliText(result: TauCliResult): string {
  if (result.kind === TAU_CLI_HELP_KIND) {
    return [
      `Tau CLI ${result.apiVersion}`,
      "Commands:",
      ...result.usage.map((line) => `  ${line}`),
      "",
      "Diagnose emits machine-readable JSON with --json (stable codes + exit status).",
      "Does not claim full product-gates DoD. SHIPPABLE? NO.",
      "",
    ].join("\n");
  }
  if (result.kind === "tau.cli.version.v1") {
    return `${result.apiVersion} (${result.diagnoseKind})\n`;
  }
  const lines = [
    `${result.kind}  status=${result.status}  exit=${result.exitCode}`,
    `source: ${result.source.path ?? result.source.title}  fp=${result.source.contentFingerprint}`,
    `import: ok=${result.stages.import.ok} warnings=${result.stages.import.warningCount} components=${result.stages.import.componentCount}`,
    `validate: ok=${result.stages.validate.ok}`,
    `deck: ok=${result.stages.deck.ok} refused=${result.stages.deck.refused} lines=${result.stages.deck.lineCount ?? "—"}`,
  ];
  for (const d of result.diagnostics) {
    lines.push(`  [${d.severity}] ${d.code}: ${d.message}`);
  }
  return `${lines.join("\n")}\n`;
}

export function exitCodeForUsageError(): TauCliExitCode {
  return 64;
}
