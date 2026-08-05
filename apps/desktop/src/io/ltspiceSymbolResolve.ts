import { existsSync, readdirSync } from "node:fs";
import { basename, isAbsolute, join, normalize, relative, sep } from "node:path";

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

/**
 * Resolve an installed LTspice `.asy` path under one or more `sym` roots.
 *
 * 1. Prefer the authored relative path (`OpAmps\AD711`).
 * 2. Else basename-search under each root. Return a hit only when the leaf
 *    name is **unique** across all roots — ambiguous leaves stay unresolved
 *    (honest refuse) rather than attaching the wrong family's ModelFile.
 */
export function resolveInstalledAsyPath(symRoots: string[], symbolType: string): string | null {
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
  const basenameHits: string[] = [];
  for (const root of symRoots) {
    basenameHits.push(...findAllAsyByBasename(root, leaf));
  }
  const unique = [...new Set(basenameHits.map((path) => path.toLowerCase()))];
  if (unique.length === 1) {
    const found = basenameHits[0]!;
    cacheResolvedPath([queryKey, leafKey], found);
    for (const root of symRoots) {
      if (!found.toLowerCase().startsWith(root.toLowerCase())) continue;
      const relativeKey = relative(root, found).replace(/\.asy$/i, "").toLowerCase();
      if (relativeKey && relativeKey !== queryKey && relativeKey !== leafKey) {
        cacheResolvedPath([relativeKey], found);
      }
      break;
    }
    return found;
  }

  cacheResolvedPath([queryKey, leafKey], null);
  return null;
}

/** Test-only: clear the module path cache between cases. */
export function resetInstalledAsyPathCacheForTests(): void {
  installedAsyPathCache.clear();
}
