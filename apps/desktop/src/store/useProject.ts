import { create } from "zustand";
import {
  basename,
  blankSimJson,
  EMPTY_PROJECT,
  joinPath,
  type ProjectNode,
  type ProjectState,
} from "../project/types";
import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  defaultWorkspaceFiles,
  defaultWorkspaceTree,
  isWorkspacePath,
  type WorkspaceFile,
} from "../project/defaultWorkspace";
import * as fs from "../project/fsBridge";

interface ProjectStore extends ProjectState {
  capability: fs.FsCapability;
  /** In-memory file map for the seeded Powerboard workspace (and edits to it). */
  workspaceFiles: Record<string, WorkspaceFile>;
  detectCapability: () => Promise<void>;
  /** Ensure a project is open — seeds Powerboard if nothing is loaded. */
  ensureDefaultWorkspace: () => void;
  openFolder: () => Promise<boolean>;
  newProject: (suggestedName?: string) => Promise<boolean>;
  closeProject: () => void;
  refresh: () => Promise<boolean>;
  toggleExpanded: (path: string) => void;
  collapseAll: () => void;
  createFolder: (parentPath: string, name: string) => Promise<string | null>;
  createSimFile: (parentPath: string, name: string) => Promise<string | null>;
  importAscFile: (parentPath: string, file: File) => Promise<string | null>;
  renameNode: (path: string, newName: string) => Promise<string | null>;
  deleteNode: (path: string) => Promise<void>;
  readSim: (path: string) => Promise<string>;
  writeSim: (path: string, contents: string) => Promise<void>;
}

function ensureSimExtension(name: string): string {
  const trimmed = name.trim();
  if (/\.(sim|tau\.json)$/i.test(trimmed)) return trimmed;
  return `${trimmed || "untitled"}.sim`;
}

function seedWorkspace(): Pick<ProjectStore, "rootPath" | "rootName" | "tree" | "expanded" | "workspaceFiles" | "error"> {
  const files = defaultWorkspaceFiles();
  const map: Record<string, WorkspaceFile> = {};
  for (const f of files) map[f.path] = f;
  const tree = defaultWorkspaceTree(files);
  const expanded = [
    DEFAULT_WORKSPACE_ID,
    ...tree.filter((n) => n.kind === "dir").map((n) => n.path),
  ];
  return {
    rootPath: DEFAULT_WORKSPACE_ID,
    rootName: DEFAULT_WORKSPACE_NAME,
    tree,
    expanded,
    workspaceFiles: map,
    error: null,
  };
}

function rebuildWorkspaceTree(files: Record<string, WorkspaceFile>): ProjectNode[] {
  return defaultWorkspaceTree(Object.values(files));
}

export const useProject = create<ProjectStore>((set, get) => ({
  ...EMPTY_PROJECT,
  capability: "none",
  workspaceFiles: {},

  detectCapability: async () => {
    const capability = await fs.detectFsCapability();
    set({ capability });
  },

  ensureDefaultWorkspace: () => {
    if (get().rootPath) return;
    set(seedWorkspace());
  },

  openFolder: async () => {
    try {
      const path = await fs.pickProjectFolder();
      if (!path) return false;
      const tree = await fs.readProjectTree(path);
      set({
        rootPath: path,
        rootName: basename(path).replace(/^web:\/\//, ""),
        tree,
        expanded: [path],
        workspaceFiles: {},
        error: null,
      });
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not open folder." });
      return false;
    }
  },

  newProject: async (suggestedName = "Powerboard") => {
    try {
      if ((await fs.detectFsCapability()) === "none") {
        // Stay in the seeded workspace; just rename display.
        set({
          ...seedWorkspace(),
          rootName: suggestedName.trim() || DEFAULT_WORKSPACE_NAME,
        });
        return true;
      }
      const path = await fs.createProjectFolder(suggestedName);
      if (!path) return false;
      const simPath = joinPath(path, "untitled.sim");
      await fs.writeTextFile(simPath, blankSimJson());
      const tree = await fs.readProjectTree(path);
      set({
        rootPath: path,
        rootName: basename(path).replace(/^web:\/\//, ""),
        tree,
        expanded: [path],
        workspaceFiles: {},
        error: null,
      });
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not create project." });
      return false;
    }
  },

  closeProject: () => set({ ...seedWorkspace(), capability: get().capability }),

  refresh: async () => {
    const { rootPath, workspaceFiles } = get();
    if (!rootPath) return false;
    if (isWorkspacePath(rootPath)) {
      set({ tree: rebuildWorkspaceTree(workspaceFiles), error: null });
      return true;
    }
    try {
      const tree = await fs.readProjectTree(rootPath);
      set({ tree, error: null });
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not refresh project." });
      return false;
    }
  },

  toggleExpanded: (path) =>
    set((s) => ({
      expanded: s.expanded.includes(path)
        ? s.expanded.filter((p) => p !== path)
        : [...s.expanded, path],
    })),

  collapseAll: () => set({ expanded: [] }),

  createFolder: async (parentPath, name) => {
    const folderName = name.trim() || "New Folder";
    const path = joinPath(parentPath, folderName);
    try {
      if (isWorkspacePath(parentPath)) {
        // Virtual folder: appears once a file is created under it; seed a placeholder marker.
        const markerPath = joinPath(path, ".keep");
        const files = {
          ...get().workspaceFiles,
          [markerPath]: { path: markerPath, name: ".keep", kind: "sim" as const, contents: "" },
        };
        set({
          workspaceFiles: files,
          tree: rebuildWorkspaceTree(files),
          expanded: get().expanded.includes(parentPath)
            ? get().expanded.includes(path)
              ? get().expanded
              : [...get().expanded, path]
            : [...get().expanded, parentPath, path],
        });
        return path;
      }
      await fs.mkdirPath(path);
      await get().refresh();
      set((s) => ({
        expanded: s.expanded.includes(parentPath) ? s.expanded : [...s.expanded, parentPath],
      }));
      return path;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not create folder." });
      return null;
    }
  },

  createSimFile: async (parentPath, name) => {
    const fileName = ensureSimExtension(name);
    const path = joinPath(parentPath, fileName);
    try {
      if (isWorkspacePath(parentPath)) {
        const files = {
          ...get().workspaceFiles,
          [path]: { path, name: fileName, kind: "sim" as const, contents: blankSimJson() },
        };
        // Drop .keep markers in the same folder once a real file exists.
        for (const key of Object.keys(files)) {
          if (key.startsWith(parentPath + "/") && key.endsWith("/.keep")) delete files[key];
        }
        set({
          workspaceFiles: files,
          tree: rebuildWorkspaceTree(files),
          expanded: get().expanded.includes(parentPath) ? get().expanded : [...get().expanded, parentPath],
        });
        return path;
      }
      await fs.writeTextFile(path, blankSimJson());
      await get().refresh();
      set((s) => ({
        expanded: s.expanded.includes(parentPath) ? s.expanded : [...s.expanded, parentPath],
      }));
      return path;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not create simulation." });
      return null;
    }
  },

  importAscFile: async (parentPath, file) => {
    const name = file.name.endsWith(".asc") || file.name.endsWith(".ASC") ? file.name : `${file.name}.asc`;
    const path = joinPath(parentPath, name);
    try {
      const text = await file.text();
      if (isWorkspacePath(parentPath)) {
        const files = {
          ...get().workspaceFiles,
          [path]: { path, name, kind: "asc" as const, contents: text },
        };
        set({
          workspaceFiles: files,
          tree: rebuildWorkspaceTree(files),
          expanded: get().expanded.includes(parentPath) ? get().expanded : [...get().expanded, parentPath],
        });
        return path;
      }
      await fs.writeTextFile(path, text);
      await get().refresh();
      return path;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not import .asc." });
      return null;
    }
  },

  renameNode: async (path, newName) => {
    const parent = path.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
    const to = joinPath(parent, newName.trim());
    if (to === path) return path;
    try {
      if (isWorkspacePath(path)) {
        const files = { ...get().workspaceFiles };
        const src = files[path];
        if (!src) return null;
        delete files[path];
        files[to] = { ...src, path: to, name: newName.trim() };
        set({ workspaceFiles: files, tree: rebuildWorkspaceTree(files) });
        return to;
      }
      await fs.renamePath(path, to);
      await get().refresh();
      return to;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not rename." });
      return null;
    }
  },

  deleteNode: async (path) => {
    try {
      if (isWorkspacePath(path)) {
        const files = { ...get().workspaceFiles };
        for (const key of Object.keys(files)) {
          if (key === path || key.startsWith(path + "/")) delete files[key];
        }
        set({ workspaceFiles: files, tree: rebuildWorkspaceTree(files) });
        return;
      }
      await fs.removePath(path);
      await get().refresh();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not delete." });
    }
  },

  readSim: async (path) => {
    if (isWorkspacePath(path)) {
      const file = get().workspaceFiles[path];
      if (!file) throw new Error("File not found in workspace.");
      return file.contents;
    }
    return fs.readTextFile(path);
  },

  writeSim: async (path, contents) => {
    if (isWorkspacePath(path)) {
      const prev = get().workspaceFiles[path];
      const files = {
        ...get().workspaceFiles,
        [path]: {
          path,
          name: basename(path),
          kind: (prev?.kind ?? "sim") as "sim" | "asc",
          contents,
        },
      };
      set({ workspaceFiles: files, tree: rebuildWorkspaceTree(files) });
      return;
    }
    await fs.writeTextFile(path, contents);
  },
}));

/** Flatten tree for tests / search. */
export function flattenTree(nodes: ProjectNode[]): ProjectNode[] {
  const out: ProjectNode[] = [];
  for (const n of nodes) {
    out.push(n);
    if (n.children) out.push(...flattenTree(n.children));
  }
  return out;
}
