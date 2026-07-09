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

/** Blank Tau schematic document written as a new `.sim` file. */
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

export function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export function joinPath(parent: string, child: string): string {
  if (!parent) return child;
  const sep = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return parent.endsWith(sep) ? `${parent}${child}` : `${parent}${sep}${child}`;
}
