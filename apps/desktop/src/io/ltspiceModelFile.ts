/**
 * Resolve LTspice ModelFile / SpiceModel library path candidates.
 *
 * LTspice often names `ModelFile AD4000.sub` while a plaintext twin may exist
 * as `AD4000.lib` (or the reverse). Prefer the authored path first; callers
 * skip encrypted bytes and try the next candidate.
 */

/** Yield authored relative path plus same-stem `.sub`/`.lib`/`.mod` siblings. */
export function installedLibraryFileCandidates(relativeFile: string): string[] {
  const trimmed = relativeFile.trim();
  if (!trimmed) return [];
  const normalized = trimmed.replace(/\\/g, "/");
  const candidates = [normalized];
  const match = /^(.*)\.(sub|lib|mod)$/i.exec(normalized);
  if (!match) return candidates;
  const stem = match[1]!;
  for (const ext of ["sub", "lib", "mod"] as const) {
    const alt = `${stem}.${ext}`;
    if (!candidates.some((entry) => entry.toLowerCase() === alt.toLowerCase())) {
      candidates.push(alt);
    }
  }
  return candidates;
}

/**
 * Library path from `.asy` attrs: prefer `ModelFile`; use `SpiceModel` only when
 * it looks like a file (`.lib`/`.sub`/`.mod`), not a subckt/profile name.
 */
export function ltspiceModelFileFromSymbolAttrs(
  attrs: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const modelFile = attrs.ModelFile?.trim();
  if (modelFile) return modelFile;
  const spiceModel = attrs.SpiceModel?.trim();
  if (spiceModel && /\.(lib|sub|mod)$/i.test(spiceModel)) return spiceModel;
  return undefined;
}
