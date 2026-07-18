/**
 * Acceptance-corpus runner (AGENTS.md → Definition of Done): imports every
 * `.asc` in the user's own LTspice corpus, builds an `.op` deck for each, and
 * batch-runs it in the installed ngspice, then prints and asserts the
 * warning-clean / deck-built / op-converged counts.
 *
 * NOT part of the default suite (`pnpm test` includes only `src/**`): run it
 * via `scripts/acceptance-corpus.sh` at the repo root, which uses
 * `vitest.corpus.config.ts`. On machines without the corpus dirs the spec
 * skips instead of failing.
 *
 * Env knobs:
 *   CORPUS_ALL=1           also walk the full examples/ tree (~4,000 files)
 *   CORPUS_SKIP_NGSPICE=1  import + deck-build only (no op runs)
 *   CORPUS_EXTRA_ROOTS=…   path-delimited external roots, walked recursively
 *   CORPUS_SYMBOL_ROOTS=…  additional .asy/.asc search roots for hierarchy
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, delimiter, isAbsolute, join, normalize, relative, sep } from "node:path";
import { homedir, tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { importAsc, makeSubcircuitResolver, decodeSchematicText } from "../src/io/ascImport";
import { buildParamScope } from "../src/simulation/paramScope";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";
import { summarizeCorpus, formatCorpusReport, ngspiceOpSucceeded, type CorpusRow } from "../src/io/corpusReport";

const HOME = homedir();
const NGSPICE_TIMEOUT_MS = 20_000;

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

/** The canonical 82-file acceptance corpus (FEATURE_PARITY → KEY GOAL). */
const CORPUS_DIRS = [
  { dir: join(HOME, "Downloads", "LTspice_export"), label: "LTspice_export" },
  { dir: join(HOME, "Documents", "LTspice"), label: "LTspice" },
  { dir: join(HOME, "Documents", "LTspice", "examples", "Educational"), label: "Educational" },
];

interface CorpusFile {
  path: string;
  display: string;
}

function collectCorpus(): CorpusFile[] {
  const files: CorpusFile[] = [];
  const walk = (dir: string, label: string, rel = "") => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const relName = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, label, relName);
      else if (/\.asc$/i.test(entry.name)) files.push({ path: abs, display: `${label}/${relName}` });
    }
  };
  for (const { dir, label } of CORPUS_DIRS) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!/\.asc$/i.test(name)) continue;
      files.push({ path: join(dir, name), display: `${label}/${name}` });
    }
  }
  if (process.env.CORPUS_ALL === "1") {
    const examples = join(HOME, "Documents", "LTspice", "examples");
    if (existsSync(examples)) walk(examples, "examples");
  }
  for (const root of EXTRA_ROOTS) {
    if (existsSync(root)) walk(root, basename(root) || "external");
  }
  return files
    .filter((file, index, all) => all.findIndex((candidate) => candidate.path === file.path) === index)
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

function runFile(file: CorpusFile, tmpDir: string, skipNgspice: boolean): CorpusRow {
  const row: CorpusRow = {
    file: file.display,
    imported: false,
    warnings: 0,
    deckBuilt: false,
    opConverged: false,
  };

  let imported;
  try {
    const text = decodeSchematicText(readFileSync(file.path));
    imported = importAsc(text, { resolveSubcircuit: siblingResolver(join(file.path, "..")) });
    row.imported = true;
    row.warnings = imported.warnings.length;
  } catch (error) {
    row.error = `import: ${error instanceof Error ? error.message : String(error)}`;
    return row;
  }

  let netlist: string;
  try {
    const params = buildParamScope(imported.directives);
    const deck = buildSpiceDeck(
      {
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        params,
        directives: imported.directives,
      },
      { kind: "op" },
    );
    netlist = deck.netlist;
    row.deckBuilt = true;
  } catch (error) {
    row.error = `deck: ${error instanceof Error ? error.message : String(error)}`;
    return row;
  }

  if (skipNgspice) return row;

  const cirPath = join(tmpDir, `${file.display.replace(/[^A-Za-z0-9._-]/g, "_")}.cir`);
  writeFileSync(cirPath, netlist);
  const run = spawnSync("ngspice", ["-b", cirPath], {
    encoding: "utf8",
    timeout: NGSPICE_TIMEOUT_MS,
  });
  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  row.opConverged = ngspiceOpSucceeded(output, run.status);
  if (!row.opConverged) {
    const marker =
      output
        .split("\n")
        .find((l) => /singular|aborted|convergence|fatal|error/i.test(l))
        ?.trim() ?? (run.status === null ? "ngspice timeout" : `ngspice exit ${run.status}`);
    row.error = `op: ${marker.slice(0, 100)}`;
  }
  return row;
}

const corpus = collectCorpus();
const skipNgspice = process.env.CORPUS_SKIP_NGSPICE === "1" || spawnSync("ngspice", ["--version"], { encoding: "utf8" }).error !== undefined;

describe.skipIf(corpus.length === 0)("acceptance corpus (user's own LTspice files)", () => {
  it("imports, builds, and op-solves the corpus at or above the recorded baseline", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "tau-corpus-"));
    try {
      const rows = corpus.map((file) => runFile(file, tmpDir, skipNgspice));
      const summary = summarizeCorpus(rows);
      console.log(`\n${formatCorpusReport(rows)}\n`);
      if (skipNgspice) console.log("(ngspice runs skipped — CORPUS_SKIP_NGSPICE or ngspice not installed)");

      // Floors = the counts this runner actually measured on 2026-07-05
      // (82/79/82/82) — never hand-typed claims; this runner once disproved
      // those (deck-built claimed 82, measured 79). Raise a floor only when a
      // re-run proves the new count. The 3 non-clean files are misc\nigbt,
      // POWERPRODUCTS\LT1184F, and PLL2's PHIDET A-device. Converge fixes on
      // 2026-07-05: opamp/logamp (bundled opamp.sub), Cohn/passive/varactor2
      // (default rseries=1mΩ), Fc ({param} substitution on passthrough
      // .model lines), LoopGain2 (Mn orientation = rotate-then-mirror),
      // SoftDiodeRecovery+P2+UHFpreamp (per-line TEXT-block dispatch,
      // continuation folding, type=silicon strip, Q-on-subckt → X rewrite),
      // logamp (imported current-source polarity: LTspice "−" pin → Tau p).
      // ALL 82 op-converge as of the polarity fix.
      // Only enforced on the canonical corpus (CORPUS_ALL covers unvetted files).
      if (process.env.CORPUS_ALL !== "1" && EXTRA_ROOTS.length === 0) {
        expect(summary.imported).toBeGreaterThanOrEqual(82);
        expect(summary.warningClean).toBeGreaterThanOrEqual(79);
        expect(summary.deckBuilt).toBeGreaterThanOrEqual(82);
        if (!skipNgspice) expect(summary.opConverged).toBeGreaterThanOrEqual(82);
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
