/**
 * Attach plaintext installed LTspice model libraries for corpus / deck builds,
 * matching {@link importProjectAsc}'s nested `.lib` / `.include` walk.
 *
 * Extracting only the requested `.subckt` (old corpus path) dropped nested
 * peers such as AD8310.lib → `.lib UniversalOpAmp2.lib` → `level2`, so the
 * deck refused an unresolved subckt despite a complete installed tree.
 */
import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import { includedFileName } from "../engine/spiceNetlist";
import { installedLibraryFileCandidates } from "./ltspiceModelFile";
import { isEncryptedModelBytes } from "./corpusReport";
import { decodeSchematicText } from "./ascImport";

const AUTO_MODEL_EXTENSIONS = new Set(["lib", "sub", "subckt", "mod", "inc"]);

/** File names a library text's own `.include`/`.lib`/`.inc` cards name. */
export function nestedLibraryFileRefs(text: string): string[] {
  const refs: string[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("*") || line.startsWith(";")) continue;
    const fileRef = /^\.(?:include|inc|lib)\s+(.+)$/i.exec(line);
    if (!fileRef) continue;
    const file = includedFileName(fileRef[1]);
    if (file) refs.push(file);
  }
  return refs;
}

function safeRelativeModelPath(ref: string): string | null {
  const normalized = normalize(ref.replace(/[\\/]+/g, sep));
  if (
    !normalized
    || isAbsolute(normalized)
    || normalized === ".."
    || normalized.startsWith(`..${sep}`)
  ) return null;
  const base = normalized.split(sep).pop() ?? normalized;
  const dot = base.lastIndexOf(".");
  const ext = dot < 0 ? "" : base.slice(dot + 1).toLowerCase();
  if (!AUTO_MODEL_EXTENSIONS.has(ext)) return null;
  return normalized;
}

/** Read one plaintext installed library (authored path + same-stem twins). */
function readInstalledPlaintextLibrary(
  relativeFile: string,
  libRoots: readonly string[],
): string | null {
  const safe = safeRelativeModelPath(relativeFile);
  if (!safe) return null;
  const withoutSubPrefix = safe.toLowerCase().startsWith(`sub${sep}`)
    ? safe.slice(4)
    : safe;
  for (const candidate of installedLibraryFileCandidates(withoutSubPrefix)) {
    const normalizedCandidate = normalize(candidate.replace(/[\\/]+/g, sep));
    for (const root of libRoots.flatMap((entry) => [join(entry, "sub"), entry])) {
      const path = join(root, normalizedCandidate);
      const underRoot = relative(root, path);
      if (
        underRoot === ".."
        || underRoot.startsWith(`..${sep}`)
        || isAbsolute(underRoot)
        || !existsSync(path)
      ) {
        continue;
      }
      const bytes = readFileSync(path);
      if (isEncryptedModelBytes(bytes)) continue;
      return decodeSchematicText(bytes);
    }
  }
  return null;
}

/**
 * Full library texts for the given relative ModelFile paths, including nested
 * `.lib`/`.include` peers under the same installed roots (product parity).
 */
export function attachedInstalledModelLibraryTexts(
  relativeFiles: readonly string[],
  libRoots: readonly string[],
): string[] {
  const libraries: string[] = [];
  const seen = new Set<string>();
  const pending = [...relativeFiles];
  for (let index = 0; index < pending.length; index += 1) {
    const file = pending[index]?.trim() ?? "";
    if (!file) continue;
    const key = file.replace(/\\/g, "/").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const contents = readInstalledPlaintextLibrary(file, libRoots);
    if (contents === null) continue;
    libraries.push(contents);
    pending.push(...nestedLibraryFileRefs(contents));
  }
  return libraries;
}
