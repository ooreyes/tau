/**
 * Acceptance-corpus runner: recursively imports every `.asc` below
 * `~/Downloads/LTspice_export` and `~/Documents/LTspice`, builds an `.op` deck
 * for each, and
 * batch-runs it through Tau's isolated native worker and bundled ngspice, then
 * prints and asserts the
 * warning-clean / deck-built / op-converged counts.
 *
 * NOT part of the default suite (`pnpm test` includes only `src/**`): run it
 * via `scripts/acceptance-corpus.sh` at the repo root, which uses
 * `vitest.corpus.config.ts`. On machines without the corpus dirs the spec
 * skips instead of failing.
 *
 * Env knobs:
 *   CORPUS_CANONICAL_ONLY=1  run only the historical 82-file baseline
 *   CORPUS_SKIP_NGSPICE=1  import + deck-build only (no op runs)
 *   CORPUS_EXTRA_ROOTS=…   path-delimited external roots, walked recursively
 *   CORPUS_SYMBOL_ROOTS=…  additional .asy/.asc search roots for hierarchy
 *   CORPUS_MATCH=…         debug only: run files whose display path contains text
 *   CORPUS_DECK_DIR=…      debug only: retain generated decks in this directory
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { basename, delimiter, isAbsolute, join, normalize, relative, sep } from "node:path";
import { homedir, tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { importAsc, makeSubcircuitResolver, decodeSchematicText, parseAsy, type AsySymbol } from "../src/io/ascImport";
import { buildParamScope } from "../src/simulation/paramScope";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";
import { validateSchematicDocument } from "../src/schematic/documentValidation";
import { summarizeCorpus, formatCorpusReport, type CorpusRow } from "../src/io/corpusReport";
import { opampIdentity } from "../src/engine/opampModel";
import { parseUserModelLibraries, resolveUserSubckt, type UserModelLibraryRegistry } from "../src/engine/userModelLibrary";
import { ltspiceLibRoot, ltspiceLibRoots } from "./ltspiceLibRoot";
import { nativeWorkerPaths, runNativeSpiceWorker } from "./nativeSpiceWorker";

const HOME = homedir();
const NGSPICE_TIMEOUT_MS = 20_000;
const CORPUS_MATCH = process.env.CORPUS_MATCH?.trim().toLowerCase() ?? "";
const CORPUS_DECK_DIR = process.env.CORPUS_DECK_DIR?.trim() ?? "";

function envPaths(name: string): string[] {
  return (process.env[name] ?? "")
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const EXTRA_ROOTS = envPaths("CORPUS_EXTRA_ROOTS");
const EXTRA_SYMBOL_ROOTS = [
  ...envPaths("CORPUS_SYMBOL_ROOTS"),
  ...EXTRA_ROOTS.map((root) => join(root, "sym")),
].filter((root, index, roots) => existsSync(root) && roots.indexOf(root) === index);

const DOWNLOADS_ROOT = join(HOME, "Downloads", "LTspice_export");
const DOCUMENTS_ROOT = join(HOME, "Documents", "LTspice");
const LTSPICE_LIB_ROOT = ltspiceLibRoot();
const INSTALLED_STANDARD_MODEL_LIBRARIES = [
  "standard.dio",
  "standard.bjt",
  "standard.mos",
  "standard.jft",
]
  .map((name) => ltspiceLibRoots()
    .map((root) => join(root, "cmp", name))
    .find((path) => existsSync(path)))
  .filter((path): path is string => Boolean(path))
  .map((path) => decodeSchematicText(readFileSync(path)));
const symbolMetadataCache = new Map<string, AsySymbol | null>();
const modelRegistryCache = new Map<string, UserModelLibraryRegistry | null>();

/** Every user-owned tree the Definition of Done requires this runner to cover. */
const CORPUS_ROOTS = [
  { dir: DOWNLOADS_ROOT, label: "LTspice_export" },
  { dir: DOCUMENTS_ROOT, label: "LTspice" },
];

interface CorpusFile {
  path: string;
  display: string;
  canonical: boolean;
}

/**
 * The historical 82-file baseline is the two Downloads fixtures, the eleven
 * schematics directly below Documents/LTspice, and the 69 Educational
 * examples. Keep that subset for the ≥80/82 release floor while the default
 * runner still exercises every nested `.asc` file and reports its own totals.
 */
function isCanonical(path: string): boolean {
  const parent = normalize(join(path, ".."));
  return parent === normalize(DOWNLOADS_ROOT)
    || parent === normalize(DOCUMENTS_ROOT)
    || parent === normalize(join(DOCUMENTS_ROOT, "examples", "Educational"));
}

function collectCorpus(): CorpusFile[] {
  const files: CorpusFile[] = [];
  const walk = (dir: string, label: string, rel = "") => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = join(dir, entry.name);
      const relName = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, label, relName);
      else if (/\.asc$/i.test(entry.name)) {
        files.push({ path: abs, display: `${label}/${relName}`, canonical: isCanonical(abs) });
      }
    }
  };
  for (const { dir, label } of CORPUS_ROOTS) {
    if (existsSync(dir)) walk(dir, label);
  }
  for (const root of EXTRA_ROOTS) {
    if (existsSync(root)) walk(root, basename(root) || "external");
  }
  return files
    .filter((file, index, all) => all.findIndex((candidate) => candidate.path === file.path) === index)
    .filter((file) => process.env.CORPUS_CANONICAL_ONLY !== "1" || file.canonical)
    .filter((file) => !CORPUS_MATCH || file.display.toLowerCase().includes(CORPUS_MATCH))
    .sort((a, b) => a.display.localeCompare(b.display));
}

/** Sibling-file subcircuit resolver: `<type>.asy` + `<type>.asc` next to the parent. */
function siblingResolver(parentDir: string) {
  return makeSubcircuitResolver((symbolType) => {
    const relativeSymbol = normalize(symbolType.replace(/[\\/]+/g, sep));
    if (
      !relativeSymbol
      || isAbsolute(relativeSymbol)
      || relativeSymbol === ".."
      || relativeSymbol.startsWith(`..${sep}`)
    ) return null;
    const roots = [parentDir, ...EXTRA_SYMBOL_ROOTS];
    const read = (suffix: ".asy" | ".asc"): string | undefined => {
      for (const root of roots) {
        const path = join(root, `${relativeSymbol}${suffix}`);
        const rel = relative(root, path);
        if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !existsSync(path)) continue;
        return decodeSchematicText(readFileSync(path));
      }
      return undefined;
    };
    const asy = read(".asy");
    const asc = read(".asc");
    if (!asy && !asc) return null;
    return { asy, asc };
  });
}

/** Read only the user's installed/staged LTspice `.asy` metadata. The ASC text
 * usually omits Value2/SpiceModel defaults, but those fields select the real
 * vendor subcircuit and file. No third-party bytes are copied into Tau. */
function installedSymbolMetadata(symbolType: string): AsySymbol | null {
  const relativeSymbol = normalize(symbolType.replace(/[\\/]+/g, sep));
  if (
    !relativeSymbol
    || isAbsolute(relativeSymbol)
    || relativeSymbol === ".."
    || relativeSymbol.startsWith(`..${sep}`)
  ) return null;
  const key = relativeSymbol.toLowerCase();
  if (symbolMetadataCache.has(key)) return symbolMetadataCache.get(key) ?? null;
  const roots = [...EXTRA_SYMBOL_ROOTS, join(LTSPICE_LIB_ROOT, "sym")];
  for (const root of roots) {
    const path = join(root, `${relativeSymbol}.asy`);
    const rel = relative(root, path);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !existsSync(path)) continue;
    const parsed = parseAsy(decodeSchematicText(readFileSync(path)));
    symbolMetadataCache.set(key, parsed);
    return parsed;
  }
  symbolMetadataCache.set(key, null);
  return null;
}

/** Extract only the selected vendor block from the user's model file. Parsing
 * is cached per file so the 4k corpus never repeatedly scans LTC.lib/ADI*.lib. */
function attachedOpampBlocks(components: readonly import("../src/schematic/types").SchematicComponent[]): string[] {
  const blocks = new Map<string, string>();
  for (const component of components) {
    if (component.kind !== "opamp" || !component.ltModelFile) continue;
    const identity = opampIdentity(component);
    if (identity.mode !== "vendor") continue;
    const relativeFile = normalize(component.ltModelFile.replace(/[\\/]+/g, sep));
    if (
      !relativeFile
      || isAbsolute(relativeFile)
      || relativeFile === ".."
      || relativeFile.startsWith(`..${sep}`)
    ) continue;
    let registry = modelRegistryCache.get(relativeFile.toLowerCase());
    if (registry === undefined) {
      registry = null;
      for (const root of [join(LTSPICE_LIB_ROOT, "sub"), LTSPICE_LIB_ROOT]) {
        const path = join(root, relativeFile);
        const rel = relative(root, path);
        if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !existsSync(path)) continue;
        registry = parseUserModelLibraries([decodeSchematicText(readFileSync(path))]);
        break;
      }
      modelRegistryCache.set(relativeFile.toLowerCase(), registry);
    }
    if (!registry) continue;
    const block = resolveUserSubckt(registry, identity.modelName);
    if (block) blocks.set(identity.modelName.toLowerCase(), block);
  }
  return [...blocks.values()];
}

function runFile(file: CorpusFile, tmpDir: string, skipNgspice: boolean): CorpusRow {
  const row: CorpusRow = {
    file: file.display,
    imported: false,
    warnings: 0,
    deckBuilt: false,
    opConverged: false,
    validated: false,
    modelSubstitutions: 0,
  };

  let imported;
  try {
    const text = decodeSchematicText(readFileSync(file.path));
    imported = importAsc(text, {
      resolveSubcircuit: siblingResolver(join(file.path, "..")),
      resolveSymbolMetadata: installedSymbolMetadata,
    });
    row.imported = true;
    row.warnings = imported.warnings.length;
  } catch (error) {
    row.error = `import: ${error instanceof Error ? error.message : String(error)}`;
    return row;
  }

  // Regression guard: every document the .asc importer hands back must also
  // clear validateSchematicDocument - the same gate the .sim loader and the
  // App-level .asc open path both run the result through. A failure here on a
  // real (non-hostile) corpus file means the validator has drifted tighter
  // than a genuine LTspice import needs, which is exactly what this guard is
  // for; it must never happen on the recorded corpus.
  try {
    validateSchematicDocument({
      components: imported.components,
      wires: imported.wires,
      probes: [],
      netLabels: imported.netLabels,
      directives: imported.directives,
      ascForeignSymbols: imported.foreignSymbols,
      ascHierarchicalBlocks: imported.hierarchicalBlocks,
    });
    row.validated = true;
  } catch (error) {
    row.error = row.error ?? `validate: ${error instanceof Error ? error.message : String(error)}`;
  }

  let netlist: string;
  try {
    const params = buildParamScope(imported.directives);
    // LTspice implicitly consults these four standard databases for named
    // semiconductors. Read the user's installed copy in place; never stage,
    // copy, or redistribute it with Tau. Schematic-specific blocks remain
    // first so an explicit local definition wins a name collision.
    const userModelLibraries = [
      ...attachedOpampBlocks(imported.components),
      ...INSTALLED_STANDARD_MODEL_LIBRARIES,
    ];
    const deck = buildSpiceDeck(
      {
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        params,
        directives: imported.directives,
        userModelLibraries,
        ascForeignSymbols: imported.foreignSymbols,
      },
      { kind: "op" },
    );
    row.modelSubstitutions = deck.modelSubstitutions.length;
    netlist = deck.netlist;
    row.deckBuilt = true;
  } catch (error) {
    row.error = `deck: ${error instanceof Error ? error.message : String(error)}`;
    return row;
  }

  if (skipNgspice) return row;

  const deckDir = CORPUS_DECK_DIR || tmpDir;
  if (CORPUS_DECK_DIR) mkdirSync(deckDir, { recursive: true });
  const cirPath = join(deckDir, `${file.display.replace(/[^A-Za-z0-9._-]/g, "_")}.cir`);
  writeFileSync(cirPath, netlist);
  const run = runNativeSpiceWorker(netlist, NGSPICE_TIMEOUT_MS);
  const output = [run.error, ...run.messages].filter(Boolean).join("\n");
  row.opConverged = run.ok;
  if (!row.opConverged) {
    const lines = output.split("\n");
    const markerIndex = lines.findIndex((line) => /singular|aborted|convergence|fatal|error/i.test(line));
    const marker = markerIndex >= 0
      ? lines
        .slice(markerIndex, markerIndex + 4)
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" | ")
      : (run.error ?? "Tau's native ngspice worker returned no result");
    row.error = `op: ${marker.slice(0, 320)}`;
  }
  return row;
}

const corpus = collectCorpus();
const skipNgspice = process.env.CORPUS_SKIP_NGSPICE === "1" || nativeWorkerPaths() === null;

describe.skipIf(corpus.length === 0)("acceptance corpus (user's own LTspice files)", () => {
  it("imports, builds, and op-solves the corpus at or above the recorded baseline", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "tau-corpus-"));
    try {
      const rows: CorpusRow[] = [];
      for (let index = 0; index < corpus.length; index += 1) {
        rows.push(runFile(corpus[index]!, tmpDir, skipNgspice));
        // `spawnSync` keeps each individual ngspice invocation simple and
        // bounded, but thousands back-to-back would starve Vitest's worker RPC
        // heartbeat for more than a minute. Yield periodically so the full
        // recursive release gate cannot finish with a false infrastructure
        // timeout after completing all of its circuit work.
        if ((index + 1) % 25 === 0) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
      const summary = summarizeCorpus(rows);
      const canonicalRows = rows.filter((_, index) => corpus[index]?.canonical);
      const canonicalSummary = summarizeCorpus(canonicalRows);
      const unsupportedRefusals = rows.filter((row) => row.error?.startsWith("deck: Simulation refused:"));
      const hardFailures = rows.filter((row) => (
        !row.imported
        || !row.validated
        || (!row.error?.startsWith("deck: Simulation refused:") && (
          !row.deckBuilt || (!skipNgspice && !row.opConverged)
        ))
      ));
      console.log([
        "",
        "ALL DISCOVERED FILES",
        `total ${summary.total} · imported ${summary.imported} · warning-clean ${summary.warningClean} · deck-built ${summary.deckBuilt} · op-converged ${summary.opConverged} · schema-valid ${summary.validated} · model-substitutions ${summary.modelSubstitutions}`,
        hardFailures.length > 0
          ? `\nHARD FAILURES (${hardFailures.length})\n${formatCorpusReport(hardFailures)}`
          : "\nHARD FAILURES (0)",
        unsupportedRefusals.length > 0
          ? `\nHONEST UNSUPPORTED REFUSALS (${unsupportedRefusals.length})\n${formatCorpusReport(unsupportedRefusals)}`
          : "\nHONEST UNSUPPORTED REFUSALS (0)",
        "",
      ].join("\n"));
      console.log(`\nCANONICAL RELEASE SUBSET\n${formatCorpusReport(canonicalRows)}\n`);
      if (skipNgspice) console.log("(ngspice runs skipped - CORPUS_SKIP_NGSPICE or ngspice not installed)");

      // Regression guard (always enforced, canonical corpus or not): every
      // successfully-imported file must also pass validateSchematicDocument.
      // See the comment on the validate step in runFile() above.
      expect.soft(summary.validated, "all imported files must remain schema-valid").toBe(summary.imported);
      expect.soft(summary.modelSubstitutions, "no accepted deck may substitute a named device model").toBe(0);

      // Floors = the truthful release target from AGENTS.md: at least 80 of the
      // canonical 82 must build and converge. Earlier 82/82 measurements
      // counted unsupported symbols that had been silently dropped or replaced
      // by unrelated devices. DIAC/TRIAC now invoke the document's own models,
      // VARISTOR and PHIDET have LTspice-backed parity proofs, and the remaining
      // two (NIGBT and encrypted LT1184F) refuse explicitly. The non-clean files
      // are those two honest refusals. Converge fixes on
      // 2026-07-05: opamp/logamp (bundled opamp.sub), Cohn/passive/varactor2
      // (default rseries=1mΩ), Fc ({param} substitution on passthrough
      // .model lines), LoopGain2 (Mn orientation = rotate-then-mirror),
      // SoftDiodeRecovery+P2+UHFpreamp (per-line TEXT-block dispatch,
      // continuation folding, type=silicon strip, Q-on-subckt → X rewrite),
      // logamp (imported current-source polarity: LTspice "−" pin → Tau p).
      // ALL 82 op-converge as of the polarity fix.
      // `expect.soft` is deliberate: a missing input must not mask a separate
      // warning/deck/convergence regression in the same run's report.
      if (EXTRA_ROOTS.length === 0 && !CORPUS_MATCH) {
        expect.soft(canonicalSummary.total, "canonical input files discovered").toBeGreaterThanOrEqual(82);
        expect.soft(canonicalSummary.imported, "canonical imports").toBeGreaterThanOrEqual(82);
        expect.soft(canonicalSummary.warningClean, "canonical warning-clean floor").toBeGreaterThanOrEqual(80);
        expect.soft(canonicalSummary.deckBuilt, "canonical deck-build floor").toBeGreaterThanOrEqual(80);
        if (!skipNgspice) {
          expect.soft(canonicalSummary.opConverged, "canonical operating-point floor").toBeGreaterThanOrEqual(80);
        }
        if (process.env.CORPUS_CANONICAL_ONLY !== "1") {
          expect.soft(hardFailures.length, "full-corpus non-refusal hard-failure ceiling").toBeLessThanOrEqual(7);
        }
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
