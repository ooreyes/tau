import { importAsc, makeSubcircuitResolver, parseAsc, type AscImportResult } from "./ascImport";
import { joinPath } from "../project/types";

const MAX_HIERARCHY_SYMBOLS = 128;
const MAX_HIERARCHY_SOURCE_CHARS = 20 * 1024 * 1024;

export interface ProjectAscImportOptions {
  sourcePath: string;
  rootPath: string | null;
  readText: (path: string) => Promise<string>;
  pathExists: (path: string) => Promise<boolean>;
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

/**
 * Import an LTspice schematic from an authorized Tau project and preload the
 * sibling `.asy` + `.asc` pairs needed by hierarchical BLOCK/CELL symbols.
 * The pure ASC importer deliberately stays synchronous; this adapter performs
 * bounded filesystem reads first and then supplies an in-memory resolver.
 */
export async function importProjectAsc(
  text: string,
  options: ProjectAscImportOptions,
): Promise<AscImportResult> {
  const first = parseAsc(text);
  const sourceDir = parentPath(options.sourcePath);
  const roots = [
    sourceDir,
    ...(options.rootPath ? [joinPath(options.rootPath, "sym"), options.rootPath] : []),
  ].filter((root, index, all) => root !== "" && all.indexOf(root) === index);
  const files = new Map<string, { asy: string; asc: string }>();
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
    for (const root of roots) {
      const candidate = joinPath(root, `${symbolPath}${suffix}`);
      if (!(await options.pathExists(candidate))) continue;
      const contents = await options.readText(candidate);
      totalChars += contents.length;
      if (totalChars > MAX_HIERARCHY_SOURCE_CHARS) {
        throw new Error("Hierarchical symbol sources exceed Tau's 20 MiB import budget.");
      }
      return contents;
    }
    return undefined;
  };

  for (let index = 0; index < queue.length; index += 1) {
    const symbolPath = queue[index];
    const [asy, asc] = await Promise.all([
      readCandidate(symbolPath, ".asy"),
      readCandidate(symbolPath, ".asc"),
    ]);
    if (!asy || !asc) continue;
    files.set(symbolPath.toLowerCase(), { asy, asc });
    for (const nested of parseAsc(asc).symbols) enqueue(nested.type);
  }

  const resolver = makeSubcircuitResolver((symbolType) => {
    const safe = safeSymbolPath(symbolType);
    return safe ? files.get(safe.toLowerCase()) ?? null : null;
  });
  return importAsc(text, { resolveSubcircuit: resolver });
}
