import { kindToLtspiceType, schematicToAsc } from "../io/ascExport";
import { importAsc, ltspiceTypeToKind, parseAsc } from "../io/ascImport";
import type { SchematicDocument } from "../store/useSchematic";

/** On-disk / in-memory project tree node (VS Code–style folder project). */
export type ProjectNodeKind = "dir" | "file";

export interface ProjectNode {
  name: string;
  /** Absolute path (Tauri) or virtual path under the project root. */
  path: string;
  kind: ProjectNodeKind;
  children?: ProjectNode[];
}

export interface ProjectState {
  /** Absolute folder path, or null when no project is open. */
  rootPath: string | null;
  /** Display name (folder basename). */
  rootName: string | null;
  tree: ProjectNode[];
  /** Paths currently expanded in the explorer. */
  expanded: string[];
  error: string | null;
}

export const EMPTY_PROJECT: ProjectState = {
  rootPath: null,
  rootName: null,
  tree: [],
  expanded: [],
  error: null,
};

/** Blank Tau schematic document written as a legacy `.sim` file. */
export const blankSimJson = (): string =>
  JSON.stringify(
    {
      app: "Tau",
      version: 1,
      components: [],
      wires: [],
      probes: [],
      netLabels: [],
      directives: [],
    },
    null,
    2,
  );

/** Minimal valid LTspice schematic used for a new Tau-native document. */
export const blankAscText = (): string => "Version 4\nSHEET 1 880 680\n";

export function isSimFile(name: string): boolean {
  return /\.(sim|tau\.json)$/i.test(name);
}

/** LTspice schematic — importable into a Tau tab from the project tree. */
export function isAscFile(name: string): boolean {
  return /\.asc$/i.test(name);
}

/** Any file the explorer should list (native Tau + LTspice import). */
export function isProjectFile(name: string): boolean {
  return isSimFile(name) || isAscFile(name);
}

export interface SerializedSchematicFile {
  contents: string;
  warnings: string[];
}

const normalizeLtspiceType = (type: string): string =>
  type.replace(/\\+/g, "/").toLowerCase();

/**
 * Report source constructs that Tau's structured exporter cannot faithfully
 * reproduce yet. Imported files with any of these risks remain viewable and
 * simulatable, but in-place Save must be blocked instead of overwriting user
 * data with a simplified schematic.
 */
export function ascRewriteRisks(source: string): string[] {
  const parsed = parseAsc(source);
  const risks = new Set<string>();

  if (parsed.unknown.length > 0) risks.add("unknown LTspice records");
  if (parsed.shapes.length > 0) risks.add("drawing primitives");
  if (parsed.texts.some((text) => !text.directive)) risks.add("schematic comments");
  if (parsed.texts.some((text) => text.directive && (text.x !== 0 || text.y !== 0))) {
    risks.add("directive annotation placement");
  }
  if (parsed.sheet.index !== 1 || parsed.sheet.width !== 880 || parsed.sheet.height !== 680) {
    risks.add("custom sheet geometry");
  }
  if (/^\s*WINDOW\b/im.test(source)) risks.add("symbol label placement");
  if (/^\s*IOPIN\b/im.test(source)) risks.add("hierarchy ports");

  for (const symbol of parsed.symbols) {
    const kind = ltspiceTypeToKind(symbol.type);
    const canonical = kind ? kindToLtspiceType(kind) : null;
    if (!canonical || normalizeLtspiceType(canonical) !== normalizeLtspiceType(symbol.type)) {
      risks.add("symbol-library identity");
    }
    if (Object.keys(symbol.attrs).some((key) => key !== "InstName" && key !== "Value")) {
      risks.add("extended symbol attributes");
    }
  }

  if (importAsc(source).warnings.length > 0) risks.add("partially supported devices");
  return [...risks];
}

/** Return the first reason an ASC save would discard information. */
export function ascSaveBlockReason(
  sourceRisks: readonly string[],
  probeCount: number,
  exportWarnings: readonly string[],
): string | null {
  if (sourceRisks.length > 0) return `Tau cannot yet preserve ${sourceRisks[0]}.`;
  if (probeCount > 0) return ".asc cannot preserve Tau probe dots yet.";
  if (exportWarnings.length > 0) return exportWarnings[0];
  return null;
}

/**
 * Serialize a schematic according to its real file extension. Keeping this
 * decision below the App prevents Tau JSON from ever being written to `.asc`.
 */
export function serializeSchematicFile(
  path: string,
  document: SchematicDocument,
  savedAt = new Date().toISOString(),
): SerializedSchematicFile {
  if (isAscFile(path)) {
    const result = schematicToAsc({
      components: document.components,
      wires: document.wires,
      netLabels: document.netLabels ?? [],
      directives: document.directives ?? [],
    });
    return { contents: result.text, warnings: result.warnings };
  }

  return {
    contents: JSON.stringify(
      {
        app: "Tau",
        version: 1,
        savedAt,
        components: document.components,
        wires: document.wires,
        probes: document.probes ?? [],
        netLabels: document.netLabels ?? [],
        directives: document.directives ?? [],
      },
      null,
      2,
    ),
    warnings: [],
  };
}

export function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export function joinPath(parent: string, child: string): string {
  if (!parent) return child;
  const sep = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return parent.endsWith(sep) ? `${parent}${child}` : `${parent}${sep}${child}`;
}
