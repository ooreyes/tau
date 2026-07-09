import { create } from "zustand";
import {
  basename,
  blankSimJson,
  EMPTY_PROJECT,
  joinPath,
  type ProjectNode,
  type ProjectState,
} from "../project/types";
import * as fs from "../project/fsBridge";

interface ProjectStore extends ProjectState {
  capability: fs.FsCapability;
  detectCapability: () => Promise<void>;
  openFolder: () => Promise<boolean>;
  newProject: (suggestedName?: string) => Promise<boolean>;
  closeProject: () => void;
  refresh: () => Promise<void>;
  toggleExpanded: (path: string) => void;
  createFolder: (parentPath: string, name: string) => Promise<string | null>;
  createSimFile: (parentPath: string, name: string) => Promise<string | null>;
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

export const useProject = create<ProjectStore>((set, get) => ({
  ...EMPTY_PROJECT,
  capability: "none",

  detectCapability: async () => {
    const capability = await fs.detectFsCapability();
    set({ capability });
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
        error: null,
      });
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not open folder." });
      return false;
    }
  },

  newProject: async (suggestedName = "Tau Project") => {
    try {
      const path = await fs.createProjectFolder(suggestedName);
      if (!path) return false;
      // Seed with a blank schematic so the tree isn't empty.
      const simPath = joinPath(path, "untitled.sim");
      await fs.writeTextFile(simPath, blankSimJson());
      const tree = await fs.readProjectTree(path);
      set({
        rootPath: path,
        rootName: basename(path).replace(/^web:\/\//, ""),
        tree,
        expanded: [path],
        error: null,
      });
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not create project." });
      return false;
    }
  },

  closeProject: () => set({ ...EMPTY_PROJECT, capability: get().capability }),

  refresh: async () => {
    const { rootPath } = get();
    if (!rootPath) return;
    try {
      const tree = await fs.readProjectTree(rootPath);
      set({ tree, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not refresh project." });
    }
  },

  toggleExpanded: (path) =>
    set((s) => ({
      expanded: s.expanded.includes(path)
        ? s.expanded.filter((p) => p !== path)
        : [...s.expanded, path],
    })),

  createFolder: async (parentPath, name) => {
    const folderName = name.trim() || "New Folder";
    const path = joinPath(parentPath, folderName);
    try {
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

  renameNode: async (path, newName) => {
    const parent = path.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
    const to = joinPath(parent, newName.trim());
    if (to === path) return path;
    try {
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
      await fs.removePath(path);
      await get().refresh();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not delete." });
    }
  },

  readSim: (path) => fs.readTextFile(path),
  writeSim: (path, contents) => fs.writeTextFile(path, contents),
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
