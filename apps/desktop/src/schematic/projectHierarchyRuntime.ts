import { isAscFile, isProjectFile, type ProjectNode } from "../project/types";
import { validateSchematicDocument } from "./documentValidation";
import { importProjectAsc } from "../io/projectAscImport";
import {
  asciiFold,
  canonicalProjectOwnerPath,
  projectRelativeSheetPath,
} from "./projectSubcircuit";
import {
  ProjectHierarchyError,
  type ProjectHierarchySheet,
} from "./projectHierarchy";
import type { SchematicDocument } from "../store/useSchematic";

export interface OpenProjectDocument {
  path: string;
  document: SchematicDocument;
}

export interface ProjectHierarchySheetLoadInput {
  projectRoot: string;
  rootSheetPath: string;
  tree: readonly ProjectNode[];
  readText: (path: string) => Promise<string>;
  openDocuments?: readonly OpenProjectDocument[];
}

function normalizedPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

function pathKey(path: string): string {
  return asciiFold(normalizedPath(path));
}

function flattenFiles(nodes: readonly ProjectNode[]): ProjectNode[] {
  return nodes.flatMap((node) => [
    ...(node.kind === "file" ? [node] : []),
    ...flattenFiles(node.children ?? []),
  ]);
}

/**
 * The ROOT's own path, under the owner grammar. A root owns links, so it must be
 * a format that can persist them - see {@link canonicalProjectOwnerPath}. This
 * deliberately does NOT use the target grammar: that one admits `.asc`, which is
 * readable as a child but cannot store a parent's hierarchy.
 */
function rootRelativeSheetPath(projectRoot: string, absolutePath: string): string | null {
  const root = normalizedPath(projectRoot);
  const candidate = normalizedPath(absolutePath);
  if (!root || !candidate || !pathKey(candidate).startsWith(`${pathKey(root)}/`)) return null;
  return canonicalProjectOwnerPath(candidate.slice(root.length + 1));
}

function loadError(path: string, message: string): ProjectHierarchyError {
  return new ProjectHierarchyError("invalid-contract", `Could not load project sheet "${path}": ${message}`, path);
}

/**
 * Load every Tau sheet visible in the open project tree. The hierarchy
 * compiler intentionally accepts no file reader, so this is the one runtime
 * seam that turns the project filesystem and open-tab snapshots into its
 * complete, validated input. A malformed or out-of-root candidate is a hard
 * refusal; callers must not fall back to a flat root deck.
 */
export async function loadProjectHierarchySheets(
  input: ProjectHierarchySheetLoadInput,
): Promise<{ rootPath: string; sheets: ProjectHierarchySheet[] }> {
  const rootPath = rootRelativeSheetPath(input.projectRoot, input.rootSheetPath);
  if (!rootPath) {
    throw new ProjectHierarchyError(
      "invalid-path",
      "A project-linked hierarchy must be saved as a Tau .sim or .tau.json sheet inside the open project.",
    );
  }

  const openByPath = new Map((input.openDocuments ?? []).map((entry) => [pathKey(entry.path), entry.document]));
  const sheets: ProjectHierarchySheet[] = [];
  for (const node of flattenFiles(input.tree)) {
    // `.asc` included: a linked child may be an LTspice sheet. Filtering to
    // `.sim` here is what made `.asc` support unreachable even once the
    // compiler accepted it - the sheet was never enumerated, so the link
    // failed as `missing-sheet` instead of compiling.
    if (!isProjectFile(node.name)) continue;
    const path = projectRelativeSheetPath(input.projectRoot, node.path);
    if (!path) {
      throw new ProjectHierarchyError(
        "invalid-path",
        `Project sheet "${node.path}" is outside the open project root and cannot be used in a hierarchy.`,
        node.path,
      );
    }
    if (asciiFold(path) === asciiFold(rootPath)) continue;

    const openDocument = openByPath.get(pathKey(node.path));
    if (openDocument) {
      sheets.push({ path, document: openDocument });
      continue;
    }

    let document: SchematicDocument;
    try {
      const text = await input.readText(node.path);
      if (isAscFile(node.name)) {
        // Route through the same project-aware importer the editor uses when it
        // opens a `.asc`, rather than a second reduced parser: a child sheet has
        // to see the identical components, pin geometry and net labels the user
        // sees on screen, or the block would compile from a different circuit
        // than the one they are looking at.
        const imported = await importProjectAsc(text, {
          sourcePath: node.path,
          rootPath: input.projectRoot,
          readText: input.readText,
          // A child sheet is resolved for compilation, not for editing, so no
          // symbol/library discovery beyond the project is attempted here. A
          // part that needed one surfaces as a foreign symbol, which
          // `compileChildBlock` already refuses by name.
          pathExists: async () => false,
        });
        document = validateSchematicDocument({
          components: imported.components,
          wires: imported.wires,
          netLabels: imported.netLabels,
          directives: imported.directives,
          textAnnotations: imported.textAnnotations,
          ascShapes: imported.shapes,
          ascDataFlags: imported.dataFlags,
          ascForeignSymbols: imported.foreignSymbols,
          ascHierarchicalBlocks: imported.hierarchicalBlocks,
          ascSheet: imported.sheet,
          probes: [],
          ...(imported.modelLibraries.length > 0 ? { userModelLibraries: imported.modelLibraries } : {}),
        });
      } else {
        document = validateSchematicDocument(JSON.parse(text) as unknown);
      }
    } catch (error) {
      if (error instanceof ProjectHierarchyError) throw error;
      // Name the format that actually failed. "invalid Tau JSON" was the only
      // fallback, which is a false statement about a `.asc` and sends the user
      // looking for a JSON error in an LTspice file.
      const fallback = isAscFile(node.name) ? "could not be read as an LTspice .asc sheet" : "invalid Tau JSON";
      const detail = error instanceof Error && error.message.trim() ? error.message : fallback;
      throw loadError(path, detail);
    }
    sheets.push({ path, document });
  }
  return { rootPath, sheets };
}
