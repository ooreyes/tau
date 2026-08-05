import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { isEncryptedModelBytes } from "./corpusReport";
import { ltspiceModelFileFromSymbolAttrs } from "./ltspiceModelFile";

const installedAsyPathCache = new Map<string, string | null>();

/** Normalize LTspice SYMBOL type paths; reject absolute and parent-escape forms. */
export function normalizeSymbolType(symbolType: string): string | null {
  const relativeSymbol = normalize(symbolType.replace(/[\\/]+/g, sep));
  if (
    !relativeSymbol
    || isAbsolute(relativeSymbol)
    || relativeSymbol === ".."
    || relativeSymbol.startsWith(`..${sep}`)
  ) return null;
  return relativeSymbol;
}

function isSafeUnderRoot(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function cacheResolvedPath(keys: Iterable<string>, path: string | null): void {
  for (const key of keys) {
    const normalized = key.toLowerCase();
    if (!normalized || installedAsyPathCache.has(normalized)) continue;
    installedAsyPathCache.set(normalized, path);
  }
}

/** Collect every `${leaf}.asy` under root (case-insensitive), path-confined. */
function findAllAsyByBasename(root: string, leafName: string): string[] {
  const target = `${leafName}.asy`.toLowerCase();
  const hits: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = join(dir, entry.name);
      if (!isSafeUnderRoot(root, abs)) continue;
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase() === target) hits.push(abs);
    }
  };
  walk(root);
  return hits;
}

/** Pull ModelFile / library-shaped SpiceModel from raw `.asy` text. */
function modelFileFromAsyBytes(bytes: Buffer): string | undefined {
  const attrs: Record<string, string> = {};
  for (const raw of bytes.toString("latin1").split(/\r?\n/)) {
    const match = /^\s*SYMATTR\s+(\S+)\s+(.+)$/i.exec(raw);
    if (!match) continue;
    attrs[match[1]!] = match[2]!.trim();
  }
  return ltspiceModelFileFromSymbolAttrs(attrs);
}

/**
 * True when the **authored** ModelFile/SpiceModel path (no same-stem twin
 * expansion) exists as plaintext under the lib roots. Encrypted `.sub` with a
 * plaintext `.lib` twin returns false — callers use that to prefer the asy
 * that names the plaintext file (AD8561 OpAmps `.lib` over Comparators `.sub`).
 */
function authoredModelFileIsPlaintext(relativeFile: string, libRoots: readonly string[]): boolean {
  const normalized = normalize(relativeFile.replace(/[\\/]+/g, sep));
  if (
    !normalized
    || isAbsolute(normalized)
    || normalized === ".."
    || normalized.startsWith(`..${sep}`)
  ) {
    return false;
  }
  for (const root of libRoots) {
    for (const base of [join(root, "sub"), root]) {
      const path = join(base, normalized);
      const rel = relative(base, path);
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !existsSync(path)) {
        continue;
      }
      try {
        return !isEncryptedModelBytes(readFileSync(path));
      } catch {
        return false;
      }
    }
  }
  return false;
}

type BasenameHit = { abs: string; relKey: string; root: string };

/**
 * When several families share a bare leaf, prefer the single hit whose authored
 * ModelFile/SpiceModel is plaintext on disk. Different plaintext families or
 * encrypted-only collisions stay unresolved (never silent wrong-family attach).
 */
function disambiguateByPlaintextModelFile(
  hits: readonly BasenameHit[],
  uniqueRel: readonly string[],
  libRoots: readonly string[],
): BasenameHit | null {
  const plaintext: BasenameHit[] = [];
  const stems = new Set<string>();
  for (const rel of uniqueRel) {
    const hit = hits.find((entry) => entry.relKey === rel);
    if (!hit) continue;
    let bytes: Buffer;
    try {
      bytes = readFileSync(hit.abs);
    } catch {
      continue;
    }
    const modelFile = modelFileFromAsyBytes(bytes);
    if (!modelFile || !authoredModelFileIsPlaintext(modelFile, libRoots)) continue;
    plaintext.push(hit);
    const stem = modelFile.replace(/\\/g, "/").toLowerCase().replace(/\.(lib|sub|mod)$/i, "");
    stems.add(stem);
  }
  if (plaintext.length === 1) return plaintext[0]!;
  if (plaintext.length > 1 && stems.size === 1) {
    return [...plaintext].sort((a, b) => a.relKey.localeCompare(b.relKey))[0]!;
  }
  return null;
}

function defaultLibRootsFromSymRoots(symRoots: readonly string[]): string[] {
  const roots: string[] = [];
  for (const symRoot of symRoots) {
    const parent = dirname(symRoot);
    if (parent && !roots.includes(parent)) roots.push(parent);
  }
  return roots;
}

export type ResolveInstalledAsyOptions = {
  /**
   * Library roots used to probe authored ModelFile/SpiceModel plaintext when
   * disambiguating bare-leaf collisions. Defaults to each sym root's parent
   * (the LTspice `lib/` folder that contains `sym/` + `sub/`).
   */
  libRoots?: readonly string[];
};

/**
 * Resolve an installed LTspice `.asy` path under one or more `sym` roots.
 *
 * 1. Prefer the authored relative path (`OpAmps\AD711`).
 * 2. Else basename-search under each root. Return a hit when the leaf name is
 *    **unique** across all roots.
 * 3. Ambiguous leaves: if exactly one family names an on-disk **plaintext**
 *    ModelFile/SpiceModel (authored path, not twin expansion), pick that hit
 *    (AD8561 OpAmps `.lib` over Comparators encrypted `.sub`). Distinct
 *    plaintext families and encrypted-only collisions stay unresolved.
 */
export function resolveInstalledAsyPath(
  symRoots: string[],
  symbolType: string,
  options: ResolveInstalledAsyOptions = {},
): string | null {
  const relativeSymbol = normalizeSymbolType(symbolType);
  if (!relativeSymbol) return null;

  const queryKey = relativeSymbol.toLowerCase();
  if (installedAsyPathCache.has(queryKey)) return installedAsyPathCache.get(queryKey) ?? null;

  const leaf = basename(relativeSymbol);
  const leafKey = leaf.toLowerCase();

  for (const root of symRoots) {
    const exactPath = join(root, `${relativeSymbol}.asy`);
    if (isSafeUnderRoot(root, exactPath) && existsSync(exactPath)) {
      cacheResolvedPath([queryKey, leafKey], exactPath);
      const relativeKey = relative(root, exactPath).replace(/\.asy$/i, "").toLowerCase();
      if (relativeKey && relativeKey !== queryKey && relativeKey !== leafKey) {
        cacheResolvedPath([relativeKey], exactPath);
      }
      return exactPath;
    }
  }

  // Bare names (Applications `SYMBOL AD4000`) need a unique leaf match.
  // Uniqueness is by relative path under each sym root — the same
  // `OpAmps/ADA4077-1.asy` in a staged autobuilder tree and the live LTspice
  // lib is one identity (prefer the first root), not an ambiguous family
  // collision. Distinct relatives (`ADC/X.asy` vs `Misc/X.asy`) still refuse
  // unless plaintext-authored ModelFile disambiguation picks exactly one.
  const basenameHits: BasenameHit[] = [];
  for (const root of symRoots) {
    for (const abs of findAllAsyByBasename(root, leaf)) {
      const relKey = relative(root, abs).replace(/\\/g, "/").toLowerCase();
      basenameHits.push({ abs, relKey, root });
    }
  }
  const uniqueRel = [...new Set(basenameHits.map((hit) => hit.relKey))];
  let chosen: BasenameHit | undefined;
  if (uniqueRel.length === 1) {
    chosen = basenameHits.find((hit) => hit.relKey === uniqueRel[0]);
  } else if (uniqueRel.length > 1) {
    const libRoots = options.libRoots?.length
      ? options.libRoots
      : defaultLibRootsFromSymRoots(symRoots);
    chosen = disambiguateByPlaintextModelFile(basenameHits, uniqueRel, libRoots) ?? undefined;
  }
  if (chosen) {
    cacheResolvedPath([queryKey, leafKey], chosen.abs);
    const relativeKey = relative(chosen.root, chosen.abs).replace(/\.asy$/i, "").toLowerCase();
    if (relativeKey && relativeKey !== queryKey && relativeKey !== leafKey) {
      cacheResolvedPath([relativeKey], chosen.abs);
    }
    return chosen.abs;
  }

  cacheResolvedPath([queryKey, leafKey], null);
  return null;
}

/** Test-only: clear the module path cache between cases. */
export function resetInstalledAsyPathCacheForTests(): void {
  installedAsyPathCache.clear();
}
