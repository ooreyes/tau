import { isSimFile, type ProjectNode } from "../project/types";
import { validateSchematicDocument } from "./documentValidation";
import {
  asciiFold,
  canonicalProjectSheetPath,
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

function rootRelativeSheetPath(projectRoot: string, absolutePath: string): string | null {
  const root = normalizedPath(projectRoot);
  const candidate = normalizedPath(absolutePath);
  if (!root || !candidate || !pathKey(candidate).startsWith(`${pathKey(root)}/`)) return null;
  return canonicalProjectSheetPath(candidate.slice(root.length + 1));
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
    if (!isSimFile(node.name)) continue;
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
      document = validateSchematicDocument(JSON.parse(text) as unknown);
    } catch (error) {
      if (error instanceof ProjectHierarchyError) throw error;
      const detail = error instanceof Error && error.message.trim() ? error.message : "invalid Tau JSON";
      throw loadError(path, detail);
    }
    sheets.push({ path, document });
  }
  return { rootPath, sheets };
}
