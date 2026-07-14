/**
 * Empty in-memory workspace used only when Tau cannot access a real folder
 * (for example, the Vite browser preview). Native Tau starts without a root so
 * the Explorer can ask the user to open or create a Schematics folder.
 */

import type { ProjectNode } from "./types";

export const DEFAULT_WORKSPACE_ID = "workspace://Schematics";
export const DEFAULT_WORKSPACE_NAME = "Schematics";

export interface WorkspaceFile {
  path: string;
  name: string;
  /** Tau JSON for legacy `.sim` files; LTspice text for `.asc` files. */
  contents: string;
  kind: "sim" | "asc";
}

/** The temporary browser workspace intentionally contains no examples. */
export function defaultWorkspaceFiles(): WorkspaceFile[] {
  return [];
}

/** Build a ProjectNode tree from the temporary workspace's in-memory files. */
export function defaultWorkspaceTree(files: WorkspaceFile[] = []): ProjectNode[] {
  type DirAcc = { name: string; path: string; children: Map<string, DirAcc | ProjectNode> };
  const root: DirAcc = {
    name: DEFAULT_WORKSPACE_NAME,
    path: DEFAULT_WORKSPACE_ID,
    children: new Map(),
  };

  for (const file of files) {
    const rel = file.path.slice(DEFAULT_WORKSPACE_ID.length + 1);
    const parts = rel.split("/");
    let cur = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i];
      const childPath = `${cur.path}/${part}`;
      let next = cur.children.get(part);
      if (!next || !("children" in next)) {
        next = { name: part, path: childPath, children: new Map() };
        cur.children.set(part, next);
      }
      cur = next as DirAcc;
    }
    const fileName = parts[parts.length - 1];
    if (fileName === ".keep") continue;
    cur.children.set(fileName, { name: fileName, path: file.path, kind: "file" });
  }

  const toNodes = (acc: DirAcc): ProjectNode[] => {
    const nodes: ProjectNode[] = [];
    for (const child of acc.children.values()) {
      if ("kind" in child && child.kind === "file") {
        nodes.push(child);
      } else {
        const dir = child as DirAcc;
        nodes.push({ name: dir.name, path: dir.path, kind: "dir", children: toNodes(dir) });
      }
    }
    return nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  };

  return toNodes(root);
}

export function isWorkspacePath(path: string): boolean {
  return path.startsWith("workspace://");
}
