/**
 * Recursive named-device fidelity measurement (AGENTS ≥95% floor).
 *
 * Walks every unencrypted-eligible `.asc` under the user's LTspice corpus,
 * builds an `.op` deck with the same installed-library attach path the
 * acceptance runner uses, and prints:
 *
 *   NAMED-DEVICE-RECURSIVE: unencrypted=N exact=E refuse=R silent=S
 *     hard-failure=H encrypted-excluded=X exact-rate=RR.R%
 *
 * Stdout is truth. This script does NOT claim the DoD box — only a measured
 * exact-rate ≥95% with silent=0 and hard-failure=0 may.
 *
 * Deck-only (no ngspice): exact-model *build* rate, not authored-analysis
 * numeric parity. Encrypted ModelFile dependents are excluded from the
 * unencrypted denominator.
 *
 * Symbol metadata: unique-leaf installed `.asy` resolve (same as product /
 * acceptance) **only when** the authored ModelFile/SpiceModel has a plaintext
 * twin. Encrypted-only ModelFiles stay unresolved here so bare SYMBOL leaves
 * do not migrate refuse→encrypted-excluded and inflate exact-rate via
 * denominator shrink (CEO: never denominator games). Ambiguous leaves refuse.
 * Optional audits: NAMED_DEVICE_TRIAGE / NAMED_DEVICE_REFUSE_TRIAGE /
 * NAMED_DEVICE_ENCRYPTED_AUDIT=1.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { basename, delimiter, isAbsolute, join, normalize, relative, sep } from "node:path";
import { homedir } from "node:os";
import { describe, it, expect } from "vitest";
import { importAsc, makeSubcircuitResolver, decodeSchematicText, parseAsy, type AsySymbol } from "../src/io/ascImport";
import { buildParamScope } from "../src/simulation/paramScope";
import { buildSpiceDeck, unresolvedSubcktMessage, includedFileName, libraryFileKey } from "../src/engine/spiceNetlist";
import { modelLibLinesFromDirectives } from "../src/engine/modelDirectives";
import { bundledLibraryText } from "../src/engine/bundledSubcircuits";
import { validateSchematicDocument } from "../src/schematic/documentValidation";
import {
  classifyCorpusCapability,
  classifyNamedDeviceBucket,
  formatNamedDeviceRecursiveSummary,
  isEncryptedModelBytes,
  summarizeNamedDeviceFidelity,
  type CorpusRow,
} from "../src/io/corpusReport";
import { opampIdentity } from "../src/engine/opampModel";
import { installedLibraryFileCandidates, ltspiceModelFileFromSymbolAttrs } from "../src/io/ltspiceModelFile";
import { attachedInstalledModelLibraryTexts } from "../src/io/installedModelAttach";
import { resolveInstalledAsyPath } from "../src/io/ltspiceSymbolResolve";
import { ltspiceLibRoots } from "./ltspiceLibRoot";
import type { SchematicComponent } from "../src/schematic/types";

const HOME = homedir();
const CORPUS_MATCH = process.env.CORPUS_MATCH?.trim().toLowerCase() ?? "";

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
const encryptedModelCache = new Map<string, boolean>();

interface CorpusFile {
  path: string;
  display: string;
}

function collectCorpus(): CorpusFile[] {
  const files: CorpusFile[] = [];
  const walk = (dir: string, label: string, rel = "") => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = join(dir, entry.name);
      const relName = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, label, relName);
      else if (/\.asc$/i.test(entry.name)) {
        files.push({ path: abs, display: `${label}/${relName}` });
      }
    }
  };
  for (const { dir, label } of [
    { dir: DOWNLOADS_ROOT, label: "LTspice_export" },
    { dir: DOCUMENTS_ROOT, label: "LTspice" },
  ]) {
    if (existsSync(dir)) walk(dir, label);
  }
  for (const root of EXTRA_ROOTS) {
    if (existsSync(root)) walk(root, basename(root) || "external");
  }
  return files
    .filter((file, index, all) => all.findIndex((candidate) => candidate.path === file.path) === index)
    .filter((file) => !CORPUS_MATCH || file.display.toLowerCase().includes(CORPUS_MATCH))
    .sort((a, b) => a.display.localeCompare(b.display));
}

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

/**
 * Load plaintext `.lib`/`.include` files named by the schematic that sit beside
 * it (PowerAmpLayout → TIP121.LIB). Same relative-only confinement as
 * projectAscImport; never decrypt; bundled names stay for the deck builder.
 */
function siblingDirectiveLibraries(
  parentDir: string,
  directives: readonly string[],
): { texts: string[]; names: string[] } {
  const texts: string[] = [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const line of modelLibLinesFromDirectives(directives)) {
    const fileRef = /^\.(include|lib)\s+(.+)$/i.exec(line.trim());
    if (!fileRef) continue;
    const file = includedFileName(fileRef[2]);
    if (!file || bundledLibraryText(file)) continue;
    const leaf = basename(file.replace(/\\/g, "/"));
    if (!leaf || leaf.includes("..") || isAbsolute(leaf)) continue;
    const key = libraryFileKey(leaf);
    if (seen.has(key)) continue;
    seen.add(key);
    const path = join(parentDir, leaf);
    const rel = relative(parentDir, path);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !existsSync(path)) continue;
    texts.push(decodeSchematicText(readFileSync(path)));
    names.push(leaf);
  }
  return { texts, names };
}

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
  const roots = [
    ...EXTRA_SYMBOL_ROOTS,
    ...ltspiceLibRoots().map((root) => join(root, "sym")),
  ];

  // Exact relative join first (path-qualified SYMBOL OpAmps\ADA4077-1).
  for (const root of roots) {
    const exactPath = join(root, `${relativeSymbol}.asy`);
    const rel = relative(root, exactPath);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !existsSync(exactPath)) continue;
    const parsed = parseAsy(decodeSchematicText(readFileSync(exactPath)));
    symbolMetadataCache.set(key, parsed);
    return parsed;
  }

  // Bare Applications leaf: unique-leaf only when ModelFile has plaintext.
  // Encrypted-only models stay foreign here (refuse) so we do not shrink the
  // unencrypted denominator via refuse→encrypted-excluded reclass.
  const path = resolveInstalledAsyPath(roots, symbolType);
  if (!path) {
    symbolMetadataCache.set(key, null);
    return null;
  }
  const parsed = parseAsy(decodeSchematicText(readFileSync(path)));
  const modelFile = ltspiceModelFileFromSymbolAttrs(parsed.attrs);
  if (modelFile && installedModelFileIsEncrypted(modelFile)) {
    symbolMetadataCache.set(key, null);
    return null;
  }
  symbolMetadataCache.set(key, parsed);
  return parsed;
}

/**
 * Encrypted-dependent only when every same-stem candidate is missing or
 * encrypted. Authored `LT1175.sub` with plaintext `LT1175.lib` is NOT encrypted
 * — the twin is exact-model plaintext (never a silent generic substitute).
 */
function installedModelFileIsEncrypted(relativeFile: string): boolean {
  const normalized = normalize(relativeFile.replace(/[\\/]+/g, sep));
  if (
    !normalized
    || isAbsolute(normalized)
    || normalized === ".."
    || normalized.startsWith(`..${sep}`)
  ) return false;
  const key = `any:${normalized.toLowerCase()}`;
  if (encryptedModelCache.has(key)) return encryptedModelCache.get(key)!;
  let sawEncrypted = false;
  for (const candidate of installedLibraryFileCandidates(normalized)) {
    const candidateKey = normalize(candidate.replace(/[\\/]+/g, sep));
    for (const root of ltspiceLibRoots().flatMap((entry) => [join(entry, "sub"), entry])) {
      const path = join(root, candidateKey);
      const rel = relative(root, path);
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !existsSync(path)) continue;
      if (!isEncryptedModelBytes(readFileSync(path))) {
        encryptedModelCache.set(key, false);
        return false;
      }
      sawEncrypted = true;
      break;
    }
  }
  encryptedModelCache.set(key, sawEncrypted);
  return sawEncrypted;
}

function attachedInstalledModelBlocks(components: readonly SchematicComponent[]): string[] {
  const files: string[] = [];
  const seen = new Set<string>();
  for (const component of components) {
    if (!component.ltModelFile || (component.kind !== "opamp" && component.kind !== "subckt")) continue;
    const opamp = component.kind === "opamp" ? opampIdentity(component) : null;
    if (opamp?.mode === "behavioral") continue;
    const key = component.ltModelFile.replace(/\\/g, "/").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    files.push(component.ltModelFile);
  }
  // Full library texts + nested .lib peers (AD8310 → UniversalOpAmp2/level2),
  // matching importProjectAsc — not a single extracted .subckt body.
  return attachedInstalledModelLibraryTexts(files, ltspiceLibRoots());
}

/** True when a token names an installed encrypted model with no plaintext twin. */
function tokenNamesEncryptedInstalledModel(token: string): boolean {
  const name = token.trim();
  if (!name) return false;
  const base = name.includes("/") || name.includes("\\")
    ? name.replace(/\\/g, "/").split("/").pop()!
    : name;
  const stem = base.replace(/\.(sub|lib|mod)$/i, "");
  return installedModelFileIsEncrypted(`${stem}.sub`)
    || installedModelFileIsEncrypted(`${stem}.lib`)
    || installedModelFileIsEncrypted(base);
}

/**
 * Encrypted-dependent: schematic names a ModelFile whose installed bytes are
 * encrypted, or an unresolved/requested subcircuit whose matching installed
 * `.sub`/`.lib` is encrypted. Missing plaintext models stay ordinary refusals.
 */
function circuitDependsOnEncryptedModel(
  components: readonly SchematicComponent[],
  unresolvedSubckts: readonly string[] = [],
): boolean {
  for (const component of components) {
    if (component.ltModelFile && installedModelFileIsEncrypted(component.ltModelFile)) {
      return true;
    }
    if (component.kind === "opamp" || component.kind === "subckt") {
      const opamp = component.kind === "opamp" ? opampIdentity(component) : null;
      if (opamp?.mode === "vendor" && tokenNamesEncryptedInstalledModel(opamp.modelName)) {
        return true;
      }
      if (!opamp) {
        const requested = component.value.trim().split(/\s+/)[0] ?? "";
        if (requested && tokenNamesEncryptedInstalledModel(requested)) return true;
      }
    }
  }
  for (const name of unresolvedSubckts) {
    if (tokenNamesEncryptedInstalledModel(name)) return true;
  }
  return false;
}

function runFile(file: CorpusFile): { row: CorpusRow; encryptedDependent: boolean } {
  const row: CorpusRow = {
    file: file.display,
    imported: false,
    warnings: 0,
    deckBuilt: false,
    opConverged: false,
    validated: false,
    modelSubstitutions: 0,
  };
  let components: readonly SchematicComponent[] = [];

  let imported;
  try {
    const text = decodeSchematicText(readFileSync(file.path));
    imported = importAsc(text, {
      resolveSubcircuit: siblingResolver(join(file.path, "..")),
      resolveSymbolMetadata: (symbolType) => {
        // Prefer sibling `.asy` beside the schematic (PAsystem/2N3904.asy, …)
        // before the installed LTspice lib/sym roots.
        const parentDir = join(file.path, "..");
        const leaf = symbolType.replace(/\\/g, "/").split("/").pop() ?? symbolType;
        const siblingPath = join(parentDir, `${leaf}.asy`);
        if (existsSync(siblingPath)) {
          return parseAsy(decodeSchematicText(readFileSync(siblingPath)));
        }
        return installedSymbolMetadata(symbolType);
      },
    });
    row.imported = true;
    row.warnings = imported.warnings.length;
    components = imported.components;
  } catch (error) {
    row.error = `import: ${error instanceof Error ? error.message : String(error)}`;
    return {
      row,
      encryptedDependent: circuitDependsOnEncryptedModel(components),
    };
  }

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

  try {
    const params = buildParamScope(imported.directives);
    const parentDir = join(file.path, "..");
    const siblingLibs = siblingDirectiveLibraries(parentDir, imported.directives);
    const userModelLibraries = [
      ...siblingLibs.texts,
      ...attachedInstalledModelBlocks(imported.components),
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
        userModelLibraryNames: siblingLibs.names,
        ascForeignSymbols: imported.foreignSymbols,
      },
      { kind: "op" },
    );
    if (deck.unresolvedSubckts.length > 0) {
      row.unresolvedSubckts = [...deck.unresolvedSubckts];
      throw new Error(unresolvedSubcktMessage(deck.unresolvedSubckts));
    }
    row.modelSubstitutions = deck.modelSubstitutions.length;
    row.deckBuilt = true;
  } catch (error) {
    row.error = `deck: ${error instanceof Error ? error.message : String(error)}`;
  }

  if (CORPUS_MATCH && process.env.NAMED_DEVICE_DUMP === "1") {
    // eslint-disable-next-line no-console
    console.log(`DUMP ${file.display}: error=${row.error ?? "(none)"} unresolved=${(row.unresolvedSubckts ?? []).join(",")}`);
  }

  return {
    row,
    encryptedDependent: circuitDependsOnEncryptedModel(components, row.unresolvedSubckts ?? []),
  };
}

const corpus = collectCorpus();

describe.skipIf(corpus.length === 0)("named-device recursive exact-model %", () => {
  it("measures exact / refuse / silent / hard-failure on the unencrypted recursive corpus", async () => {
    const entries: Array<{ row: CorpusRow; encryptedDependent: boolean }> = [];
    for (let index = 0; index < corpus.length; index += 1) {
      entries.push(runFile(corpus[index]!));
      if ((index + 1) % 50 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }

    const summary = summarizeNamedDeviceFidelity(entries, { skipNgspice: true });
    const line = formatNamedDeviceRecursiveSummary(summary);
    // eslint-disable-next-line no-console
    console.log(`\n${line}\n`);

    if (process.env.NAMED_DEVICE_TRIAGE === "1") {
      const hard = entries.filter((e) =>
        classifyNamedDeviceBucket(e.row, {
          encryptedDependent: e.encryptedDependent,
          skipNgspice: true,
        }) === "hard_failure"
      );
      const buckets = new Map<string, { count: number; samples: string[] }>();
      for (const entry of hard) {
        const err = entry.row.error ?? "(no error)";
        let key = err;
        if (err.startsWith("import: ")) key = `import: ${err.slice(8, 80)}`;
        else if (err.startsWith("validate: ")) key = `validate: ${err.slice(10, 100)}`;
        else if (err.startsWith("deck: ")) {
          const body = err.slice(6);
          // Collapse variable parts: quoted names, paths, refdes.
          key = `deck: ${body
            .replace(/"[^"]+"/g, '"…"')
            .replace(/\b[A-Z][A-Za-z0-9]*\d+\b/g, "REF")
            .replace(/\b[A-Za-z0-9_./\\-]{24,}\b/g, "…")
            .slice(0, 140)}`;
        } else {
          key = err.slice(0, 140);
        }
        const slot = buckets.get(key) ?? { count: 0, samples: [] };
        slot.count += 1;
        if (slot.samples.length < 2) slot.samples.push(entry.row.file);
        buckets.set(key, slot);
      }
      const ranked = [...buckets.entries()].sort((a, b) => b[1].count - a[1].count);
      // eslint-disable-next-line no-console
      console.log(`\nHARD-FAILURE TRIAGE (${hard.length} files, ${ranked.length} classes):\n`);
      for (const [key, info] of ranked) {
        // eslint-disable-next-line no-console
        console.log(`  ${info.count}× ${key}`);
        for (const sample of info.samples) {
          // eslint-disable-next-line no-console
          console.log(`      e.g. ${sample}`);
        }
      }
    }

    if (process.env.NAMED_DEVICE_REFUSE_TRIAGE === "1") {
      const refused = entries.filter((e) =>
        classifyNamedDeviceBucket(e.row, {
          encryptedDependent: e.encryptedDependent,
          skipNgspice: true,
        }) === "refuse"
      );
      const buckets = new Map<string, { count: number; samples: string[] }>();
      const pathBuckets = new Map<string, number>();
      const pathFamily = (file: string): string => {
        const n = file.replace(/\\/g, "/").toLowerCase();
        if (n.includes("/applications/") || n.includes("examples/applications/")) return "Applications";
        if (n.includes("/fra/") || n.includes("examples/fra/")) return "FRA";
        if (n.includes("/educational/") || n.includes("examples/educational/")) return "Educational";
        if (n.includes("/powerproducts/") || n.includes("examples/powerproducts/")) return "PowerProducts";
        if (n.startsWith("ltspice_export/") || n.includes("/ltspice_export/")) return "Downloads/LTspice_export";
        if (n.startsWith("ltspice/") || n.includes("documents/ltspice")) return "Documents/LTspice";
        return "other";
      };
      const isNoEquiv = (err: string) =>
        /no electrically equivalent Tau model/i.test(err);
      let noEquivCount = 0;
      for (const entry of refused) {
        const err = entry.row.error ?? "(no error)";
        if (isNoEquiv(err)) noEquivCount += 1;
        const fam = pathFamily(entry.row.file);
        pathBuckets.set(fam, (pathBuckets.get(fam) ?? 0) + 1);
        let key = err;
        if (err.startsWith("import: ")) key = `import: ${err.slice(8, 80)}`;
        else if (err.startsWith("validate: ")) key = `validate: ${err.slice(10, 100)}`;
        else if (err.startsWith("deck: ")) {
          const body = err.slice(6);
          key = `deck: ${body
            .replace(/"[^"]+"/g, '"…"')
            .replace(/\b[A-Z][A-Za-z0-9]*\d+\b/g, "REF")
            .replace(/\b[A-Za-z0-9_./\\-]{24,}\b/g, "…")
            .slice(0, 140)}`;
        } else {
          key = err.slice(0, 140);
        }
        const slot = buckets.get(key) ?? { count: 0, samples: [] };
        slot.count += 1;
        if (slot.samples.length < 2) slot.samples.push(entry.row.file);
        buckets.set(key, slot);
      }
      const ranked = [...buckets.entries()].sort((a, b) => b[1].count - a[1].count);
      const pathRanked = [...pathBuckets.entries()].sort((a, b) => b[1] - a[1]);
      const otherClasses = ranked.filter(([key]) => !isNoEquiv(key));
      // eslint-disable-next-line no-console
      console.log(`\nREFUSE TRIAGE (${refused.length} files, ${ranked.length} classes):\n`);
      // eslint-disable-next-line no-console
      console.log(
        `  summary: no-electrically-equivalent=${noEquivCount} other-refuse=${refused.length - noEquivCount}`,
      );
      // eslint-disable-next-line no-console
      console.log("  by path family:");
      for (const [fam, count] of pathRanked) {
        // eslint-disable-next-line no-console
        console.log(`    ${count}× ${fam}`);
      }
      // eslint-disable-next-line no-console
      console.log("  top message classes:");
      for (const [key, info] of ranked.slice(0, 40)) {
        // eslint-disable-next-line no-console
        console.log(`  ${info.count}× ${key}`);
        for (const sample of info.samples) {
          // eslint-disable-next-line no-console
          console.log(`      e.g. ${sample}`);
        }
      }
      if (otherClasses.length > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `\n  non-no-equiv classes (${otherClasses.length}; full list — NIGBT/Chan/FRA leftovers):\n`,
        );
        for (const [key, info] of otherClasses) {
          // eslint-disable-next-line no-console
          console.log(`  ${info.count}× ${key}`);
          for (const sample of info.samples) {
            // eslint-disable-next-line no-console
            console.log(`      e.g. ${sample}`);
          }
        }
      }
    }

    if (process.env.NAMED_DEVICE_ENCRYPTED_AUDIT === "1") {
      // CEO red-flag audit: encrypted-excluded must be capability_refusal ∩
      // encryptedDependent only. Clearing the flag must yield refuse, never
      // hard_failure — otherwise HF was hidden behind encrypted-excluded.
      const encrypted = entries.filter((e) =>
        classifyNamedDeviceBucket(e.row, {
          encryptedDependent: e.encryptedDependent,
          skipNgspice: true,
        }) === "encrypted"
      );
      let wouldRefuse = 0;
      let wouldHard = 0;
      let wouldOther = 0;
      const buckets = new Map<string, { count: number; samples: string[] }>();
      const unresolvedStems = new Map<string, number>();
      let viaUnresolvedEncStem = 0;
      let viaOtherEncSignal = 0;
      for (const entry of encrypted) {
        const without = classifyNamedDeviceBucket(entry.row, {
          encryptedDependent: false,
          skipNgspice: true,
        });
        if (without === "refuse") wouldRefuse += 1;
        else if (without === "hard_failure") wouldHard += 1;
        else wouldOther += 1;
        const hasUnresolvedEnc = (entry.row.unresolvedSubckts ?? []).some((n) =>
          tokenNamesEncryptedInstalledModel(n)
        );
        if (hasUnresolvedEnc) viaUnresolvedEncStem += 1;
        else viaOtherEncSignal += 1;
        for (const name of entry.row.unresolvedSubckts ?? []) {
          const stem = name.replace(/\\/g, "/").split("/").pop()!.toLowerCase();
          unresolvedStems.set(stem, (unresolvedStems.get(stem) ?? 0) + 1);
        }
        const err = entry.row.error ?? "(no error)";
        let key = err;
        if (err.startsWith("deck: ")) {
          const body = err.slice(6);
          key = `deck: ${body
            .replace(/"[^"]+"/g, '"…"')
            .replace(/\b[A-Z][A-Za-z0-9]*\d+\b/g, "REF")
            .replace(/\b[A-Za-z0-9_./\\-]{24,}\b/g, "…")
            .slice(0, 140)}`;
        } else {
          key = err.slice(0, 140);
        }
        const slot = buckets.get(key) ?? { count: 0, samples: [] };
        slot.count += 1;
        if (slot.samples.length < 2) slot.samples.push(entry.row.file);
        buckets.set(key, slot);
      }
      const ranked = [...buckets.entries()].sort((a, b) => b[1].count - a[1].count);
      const topStems = [...unresolvedStems.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
      // eslint-disable-next-line no-console
      console.log(
        `\nENCRYPTED-EXCLUSION AUDIT (${encrypted.length} files): without-flag refuse=${wouldRefuse} hard_failure=${wouldHard} other=${wouldOther}`,
      );
      // eslint-disable-next-line no-console
      console.log(
        `  reasons: unresolvedEncStem=${viaUnresolvedEncStem} otherEncSignal=${viaOtherEncSignal}`,
      );
      // eslint-disable-next-line no-console
      console.log(
        `  integrity: hard_failure-with-flag-cleared must be 0 (got ${wouldHard}) — HF cannot hide in encrypted-excluded\n`,
      );
      for (const [key, info] of ranked.slice(0, 25)) {
        // eslint-disable-next-line no-console
        console.log(`  ${info.count}× ${key}`);
        for (const sample of info.samples) {
          // eslint-disable-next-line no-console
          console.log(`      e.g. ${sample}`);
        }
      }
      if (topStems.length > 0) {
        // eslint-disable-next-line no-console
        console.log("\n  top unresolved stems among encrypted-excluded:");
        for (const [stem, count] of topStems) {
          // eslint-disable-next-line no-console
          console.log(`    ${count}× ${stem}`);
        }
      }
      expect(
        wouldHard,
        "encryptedDependent must not rebucket hard_failure → encrypted",
      ).toBe(0);
      expect(wouldRefuse).toBe(encrypted.length);
    }

    // Integrity guards only — never assert the ≥95% floor here. Claiming that
    // DoD box requires a measured exact-rate with silent=0 and hard-failure=0.
    expect(summary.silent, "no accepted deck may silently substitute a named model").toBe(0);
    expect(summary.exact + summary.refuse + summary.silent + summary.hardFailure + summary.encryptedExcluded)
      .toBe(corpus.length);

    // Soft visibility: capability buckets must partition the same rows.
    const capabilityExact = entries.filter((e) =>
      classifyCorpusCapability(e.row, { skipNgspice: true }) === "success"
    ).length;
    expect(summary.exact).toBe(capabilityExact);

    if (summary.unencrypted > 0 && summary.exactRate >= 0.95 && summary.hardFailure === 0) {
      // eslint-disable-next-line no-console
      console.log(
        "(measured exact-rate ≥95% with silent=0 and hard-failure=0 — eligible to claim DoD only after docs cite this stdout)",
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(
        `(DoD ≥95% floor NOT met or not claimable: exact-rate=${(summary.exactRate * 100).toFixed(1)}% silent=${summary.silent} hard-failure=${summary.hardFailure})`,
      );
    }
  });
});
