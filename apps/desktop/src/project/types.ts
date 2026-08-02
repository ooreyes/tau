import {
  canEmitLtSymbolVerbatim,
  isLossyCarrierWarning,
  kindToLtspiceType,
  schematicToAsc,
  TAU_CARRIER_KINDS,
} from "../io/ascExport";
import { extendedSymbolAttrs, importAsc, ltspiceTypeToKind, parseAsc } from "../io/ascImport";
import type { SchematicDocument } from "../store/useSchematic";
import { extractCircuit } from "../schematic/netlist";

/** On-disk / in-memory project tree node (VS Code-style folder project). */
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

/** LTspice schematic - importable into a Tau tab from the project tree. */
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

/** Canonical terminal partition used as the Save semantic postcondition. Net
 * ids may be regenerated, but the same component pins must remain equivalent. */
export function schematicTopologySignature(document: SchematicDocument): string[] {
  const circuit = extractCircuit(document.components, document.wires, document.netLabels ?? []);
  const byId = new Map(document.components.map((component) => [component.id, component]));
  return circuit.nets
    .map((net) => net.pins.map((pin) => {
      const component = byId.get(pin.componentId);
      const identity = component
        ? `${component.label || component.kind}@${component.x},${component.y}`
        : pin.componentId;
      return `${identity}.${pin.id}`;
    }).sort().join("|"))
    .filter(Boolean)
    .sort();
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
  // Drawing primitives (LINE/RECTANGLE/CIRCLE/ARC) are carried on the document
  // in `shapes` and re-emitted by the exporter. One Tau could not parse and
  // re-emit exactly (a non-integer coordinate, an unrecognized width word, …)
  // is parsed into `unknown` instead, which is already a risk above.
  // WINDOW records are carried on the component and re-emitted by the exporter
  // when the part keeps its source symbol. One Tau could not attach or could
  // not reproduce exactly is parsed into `unknown` instead, which is already a
  // risk above; a symbol that changes on export raises its own export warning.
  // A hierarchy port is carried on the net label its FLAG became and re-emitted
  // after that FLAG. One Tau could not pair or reproduce exactly is parsed into
  // `unknown` instead, which is already a risk above.

  for (const symbol of parsed.symbols) {
    const kind = ltspiceTypeToKind(symbol.type);
    const canonical = kind ? kindToLtspiceType(kind) : null;
    const normalizedType = normalizeLtspiceType(symbol.type);
    const dynamicDigitalSymbol = kind === "digitalGate" && /^digital\/(?:and|or|xor|buf|buf1|inv|schmitt|schmtbuf|schmtinv)$/.test(normalizedType);
    // A symbol the exporter re-emits verbatim (banked geometry, same kind and
    // value on re-import) keeps its library identity even when it is not the
    // canonical export symbol - e.g. a 3-pin `nmos` or a vendor op-amp.
    const verbatim = kind !== null && canEmitLtSymbolVerbatim(symbol.type, kind);
    if (!verbatim && (!canonical || normalizeLtspiceType(canonical) !== normalizedType) && !dynamicDigitalSymbol) {
      risks.add("symbol-library identity");
    }
    // Extended attribute slots (Value2, SpiceLine, …) are carried on the part
    // and written back into the slots they came from, but only onto the symbol
    // that declared them - so a part Tau would re-emit under a different symbol
    // still loses them. A part written under a carrier symbol is the exception:
    // the carrier records the part's real kind, so the slots ride along with it
    // and come back on reopen. A value edit that cannot be split back across
    // the slots is caught on the export side, where the current value is known.
    const carried = kind !== null && TAU_CARRIER_KINDS.has(kind);
    if (!verbatim && !carried && extendedSymbolAttrs(symbol.attrs)) {
      risks.add("extended symbol attributes");
    }
  }

  if (importAsc(source).warnings.length > 0) risks.add("partially supported devices");
  return [...risks];
}

/** Return the first reason an ASC save would discard information. */
export function ascSaveBlockReason(
  sourceRisks: readonly string[],
  _probeCount: number,
  exportWarnings: readonly string[],
): string | null {
  if (sourceRisks.length > 0) return `Tau cannot yet preserve ${sourceRisks[0]}.`;
  // Probe dots are session-only viewer annotations, not schematic topology.
  // They must never prevent saving otherwise lossless LTspice content.
  //
  // Nor may a lossy-carrier notice. Those parts DO round-trip through Tau via
  // their `Tau*` attributes - the notice only says the file reads differently
  // in LTspice. Blocking on it would refuse to save any schematic containing a
  // switch, subcircuit, comparator, CCCS, CCVS or test point.
  const blocking = exportWarnings.filter((warning) => !isLossyCarrierWarning(warning));
  if (blocking.length > 0) return blocking[0];
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
      textAnnotations: document.textAnnotations ?? [],
      shapes: document.ascShapes,
      ...(document.ascSheet ? { sheet: document.ascSheet } : {}),
    });
    const reopened = importAsc(result.text);
    const topologyChanged = JSON.stringify(schematicTopologySignature(document))
      !== JSON.stringify(schematicTopologySignature(reopened));
    return {
      contents: result.text,
      warnings: [
        ...result.warnings,
        ...(topologyChanged ? ["ASC round-trip changed terminal connectivity; save was not written."] : []),
      ],
    };
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
        ...(document.textAnnotations && document.textAnnotations.length > 0
          ? { textAnnotations: document.textAnnotations }
          : {}),
        ...(document.ascShapes && document.ascShapes.length > 0
          ? { ascShapes: document.ascShapes }
          : {}),
        ...(document.ascSheet ? { ascSheet: document.ascSheet } : {}),
        // Additive: only present when the document carries attached vendor model
        // files, so legacy `.sim` output is byte-for-byte unchanged.
        ...(document.userModelLibraries && document.userModelLibraries.length > 0
          ? { userModelLibraries: document.userModelLibraries }
          : {}),
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

/** Remap a file or descendant path after an Explorer file/folder move. */
export function remapMovedProjectPath(path: string, sourcePath: string, movedPath: string): string {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "");
  const current = normalize(path);
  const source = normalize(sourcePath);
  const moved = normalize(movedPath);
  if (current === source) return moved;
  return current.startsWith(`${source}/`) ? `${moved}${current.slice(source.length)}` : path;
}
