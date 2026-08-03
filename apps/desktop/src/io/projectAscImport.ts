import { importAsc, makeSubcircuitResolver, parseAsc, parseAsy, type AscImportResult } from "./ascImport";
import { joinPath } from "../project/types";
import { bundledLibraryText } from "../engine/bundledSubcircuits";
import { modelLibLinesFromDirectives } from "../engine/modelDirectives";
import { includedFileName, libraryFileKey } from "../engine/spiceNetlist";
import { MAX_MODEL_LIBRARIES, MAX_MODEL_LIBRARY_TOTAL_LENGTH } from "../schematic/documentValidation";
import type { SchematicModelLibrary } from "../store/useSchematic";

const MAX_HIERARCHY_SYMBOLS = 128;
const MAX_HIERARCHY_SOURCE_CHARS = 20 * 1024 * 1024;

/**
 * Extensions a `.include`/`.lib` may name for Tau to read the file on its own.
 * The directive is document text, so it is attacker-controllable in a shared
 * `.asc`; auto-reading therefore stays on suffixes that only ever hold SPICE
 * models. LTspice also lets a model live in a `.txt`/`.cir`, and those still
 * work - through Model Libraries, where the user picks the file themselves.
 */
const AUTO_MODEL_LIBRARY_EXTENSIONS = new Set(["lib", "sub", "subckt", "mod", "inc"]);

export interface ProjectAscImportOptions {
  sourcePath: string;
  rootPath: string | null;
  readText: (path: string) => Promise<string>;
  pathExists: (path: string) => Promise<boolean>;
}

export interface ProjectAscImportResult extends AscImportResult {
  /** Vendor model files a `.include`/`.lib` named and Tau resolved from disk. */
  modelLibraries: SchematicModelLibrary[];
}

function parentPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const slash = normalized.lastIndexOf("/");
  return slash < 0 ? "" : normalized.slice(0, slash);
}

function safeSymbolPath(symbolType: string): string | null {
  const normalized = symbolType.replace(/\\+/g, "/").replace(/\/+/g, "/").trim();
  if (
    normalized === ""
    || normalized.startsWith("/")
    || /^[a-z]:/i.test(normalized)
    || normalized.split("/").some((part) => part === "" || part === "." || part === "..")
  ) return null;
  return normalized;
}

/** A library reference Tau may read on its own: relative, inside the project,
 *  and carrying a model-file extension. Returns null for anything else, which
 *  leaves the deck builder to warn that the file did not resolve. */
function safeLibraryPath(ref: string): string | null {
  const safe = safeSymbolPath(ref);
  if (!safe) return null;
  const dot = safe.lastIndexOf(".");
  const ext = dot < 0 ? "" : safe.slice(dot + 1).toLowerCase();
  return AUTO_MODEL_LIBRARY_EXTENSIONS.has(ext) ? safe : null;
}

/**
 * Read the vendor model files a document's `.include`/`.lib` directives name.
 * LTspice resolves these relative to the schematic, which is the case that
 * makes a real design work at all; Tau otherwise drops the directive and can
 * only tell the user to attach the file by hand.
 *
 * Reads are confined the same way hierarchical symbol reads are - relative
 * paths only, no `..` segment, under the schematic's folder or the project
 * root - because the directive comes from the document, not from the user. A
 * reference that resolves to nothing is simply left alone here.
 */
async function resolveModelLibraries(
  directives: readonly string[],
  implicitFiles: readonly string[],
  roots: readonly string[],
  options: ProjectAscImportOptions,
): Promise<SchematicModelLibrary[]> {
  const libraries: SchematicModelLibrary[] = [];
  const seen = new Set<string>();
  let totalChars = 0;

  const explicitFiles = modelLibLinesFromDirectives(directives).flatMap((line) => {
    const fileRef = /^\.(include|lib)\s+(.+)$/i.exec(line.trim());
    return fileRef ? [includedFileName(fileRef[2])] : [];
  });
  for (const file of [...explicitFiles, ...implicitFiles]) {
    // A name the bundled LTspice libraries already satisfy is inlined by the
    // deck builder; reading a same-named file would duplicate every definition.
    if (!file || bundledLibraryText(file)) continue;
    const safe = safeLibraryPath(file);
    if (!safe) continue;
    const key = libraryFileKey(safe);
    if (seen.has(key)) continue;
    seen.add(key);
    if (libraries.length >= MAX_MODEL_LIBRARIES) break;

    for (const root of roots) {
      const candidate = joinPath(root, safe);
      if (!(await options.pathExists(candidate))) continue;
      // Resolving a library is an optional improvement on top of the import,
      // so a failed read must not sink the document the way a failed symbol
      // read does. The reader rejects anything past its byte cap, and the file
      // can also vanish between the probe and the read; either way the
      // schematic still opens and the deck builder still names the file it
      // could not resolve. Stop looking after the first match rather than
      // falling through to a same-named file elsewhere, which would quietly
      // substitute different models than the reference asked for.
      let contents: string;
      try {
        contents = await options.readText(candidate);
      } catch {
        break;
      }
      // Same aggregate budget an attachment picked by hand has to clear, so a
      // document cannot use auto-resolution to exceed what the store accepts.
      if (totalChars + contents.length > MAX_MODEL_LIBRARY_TOTAL_LENGTH) break;
      totalChars += contents.length;
      libraries.push({ name: key, text: contents });
      break;
    }
  }
  return libraries;
}

/**
 * Import an LTspice schematic from an authorized Tau project and preload the
 * sibling `.asy` + `.asc` pairs needed by hierarchical BLOCK/CELL symbols.
 * The pure ASC importer deliberately stays synchronous; this adapter performs
 * bounded filesystem reads first and then supplies an in-memory resolver.
 */
export async function importProjectAsc(
  text: string,
  options: ProjectAscImportOptions,
): Promise<ProjectAscImportResult> {
  const first = parseAsc(text);
  const sourceDir = parentPath(options.sourcePath);
  const roots = [
    sourceDir,
    ...(options.rootPath ? [joinPath(options.rootPath, "sym"), options.rootPath] : []),
  ].filter((root, index, all) => root !== "" && all.indexOf(root) === index);
  const files = new Map<string, { asy: string; asc: string }>();
  const symbolMetadata = new Map<string, string>();
  const queued = new Set<string>();
  const queue: string[] = [];
  let totalChars = 0;

  const enqueue = (symbolType: string) => {
    const safe = safeSymbolPath(symbolType);
    if (!safe) return;
    const key = safe.toLowerCase();
    if (queued.has(key)) return;
    if (queued.size >= MAX_HIERARCHY_SYMBOLS) {
      throw new Error(`Hierarchical imports are limited to ${MAX_HIERARCHY_SYMBOLS} unique symbols.`);
    }
    queued.add(key);
    queue.push(safe);
  };
  for (const symbol of first.symbols) enqueue(symbol.type);

  const readCandidate = async (symbolPath: string, suffix: ".asy" | ".asc") => {
    // LTspice library search paths let a schematic refer to `DEADTIME` even
    // when the files live at `sym/PowerSim/DEADTIME.{asy,asc}`. PowerSim uses
    // that bare-name form pervasively; probing only `sym/DEADTIME` silently
    // dropped almost its entire power stage. Keep explicit paths authoritative,
    // then try the conventional PowerSim library for bare names.
    const libraryPaths = symbolPath.includes("/")
      ? [symbolPath]
      : [symbolPath, `PowerSim/${symbolPath}`];
    for (const libraryPath of libraryPaths) {
      for (const root of roots) {
        const candidate = joinPath(root, `${libraryPath}${suffix}`);
        if (!(await options.pathExists(candidate))) continue;
        const contents = await options.readText(candidate);
        totalChars += contents.length;
        if (totalChars > MAX_HIERARCHY_SOURCE_CHARS) {
          throw new Error("Hierarchical symbol sources exceed Tau's 20 MiB import budget.");
        }
        return contents;
      }
    }
    return undefined;
  };

  for (let index = 0; index < queue.length; index += 1) {
    const symbolPath = queue[index];
    const [asy, asc] = await Promise.all([
      readCandidate(symbolPath, ".asy"),
      readCandidate(symbolPath, ".asc"),
    ]);
    if (asy) symbolMetadata.set(symbolPath.toLowerCase(), asy);
    if (!asy || !asc) continue;
    files.set(symbolPath.toLowerCase(), { asy, asc });
    for (const nested of parseAsc(asc).symbols) enqueue(nested.type);
  }

  const resolver = makeSubcircuitResolver((symbolType) => {
    const safe = safeSymbolPath(symbolType);
    return safe ? files.get(safe.toLowerCase()) ?? null : null;
  });
  const result = importAsc(text, {
    resolveSubcircuit: resolver,
    resolveSymbolMetadata: (symbolType) => {
      const safe = safeSymbolPath(symbolType);
      const asy = safe ? symbolMetadata.get(safe.toLowerCase()) : undefined;
      return asy ? parseAsy(asy) : null;
    },
  });
  // LTspice looks for an included library beside the schematic first, then in
  // its own library folders. Keep that order so a copy the user dropped next
  // to the design wins over a project-wide one of the same name.
  const libraryRoots = [
    sourceDir,
    ...(options.rootPath
      ? [joinPath(options.rootPath, "lib"), joinPath(options.rootPath, "lib/sub"), options.rootPath]
      : []),
  ].filter((root, index, all) => root !== "" && all.indexOf(root) === index);
  const implicitModelFiles = result.components
    .flatMap((component) => component.ltModelFile ? [component.ltModelFile] : []);
  const modelLibraries = await resolveModelLibraries(
    result.directives,
    implicitModelFiles,
    libraryRoots,
    options,
  );
  return { ...result, modelLibraries };
}
