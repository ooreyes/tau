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

function findAsyByBasename(root: string, leafName: string): string | null {
  const target = `${leafName}.asy`.toLowerCase();
  const walk = (dir: string): string | null => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = join(dir, entry.name);
      if (!isSafeUnderRoot(root, abs)) continue;
      if (entry.isDirectory()) {
        const nested = walk(abs);
        if (nested) return nested;
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase() === target) return abs;
    }
    return null;
  };
  return walk(root);
}

/**
 * Resolve an installed LTspice `.asy` path under one or more `sym` roots.
 * Tries the authored relative path first, then a case-insensitive basename walk.
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

  for (const root of symRoots) {
    const found = findAsyByBasename(root, leaf);
    if (!found) continue;
    cacheResolvedPath([queryKey, leafKey], found);
    const relativeKey = relative(root, found).replace(/\.asy$/i, "").toLowerCase();
    if (relativeKey && relativeKey !== queryKey && relativeKey !== leafKey) {
      cacheResolvedPath([relativeKey], found);
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
