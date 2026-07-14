import { create } from "zustand";
import {
  basename,
  blankAscText,
  blankSimJson,
  EMPTY_PROJECT,
  isAscFile,
  joinPath,
  remapMovedProjectPath,
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
import { decodeSchematicText } from "../io/ascImport";

interface ProjectStore extends ProjectState {
  capability: fs.FsCapability;
  /** In-memory files for the temporary browser-only Schematics workspace. */
  workspaceFiles: Record<string, WorkspaceFile>;
  detectCapability: () => Promise<void>;
  /** Open an empty fallback only when no real filesystem is available. */
  ensureDefaultWorkspace: () => void;
  openFolder: () => Promise<boolean>;
  newProject: (suggestedName?: string) => Promise<boolean>;
  closeProject: () => void;
  refresh: () => Promise<boolean>;
  toggleExpanded: (path: string) => void;
  collapseAll: () => void;
  createFolder: (parentPath: string, name: string) => Promise<string | null>;
  createSchematicFile: (parentPath: string, name: string) => Promise<string | null>;
  /** Create a disk-backed schematic at the open project's root. */
  createSchematicInRoot: (name?: string) => Promise<string | null>;
  importAscFile: (parentPath: string, file: File) => Promise<string | null>;
  moveNode: (sourcePath: string, destinationDir: string) => Promise<string | null>;
  renameNode: (path: string, newName: string) => Promise<string | null>;
  deleteNode: (path: string) => Promise<void>;
  readSim: (path: string) => Promise<string>;
  writeSim: (path: string, contents: string) => Promise<void>;
}

function ensureSchematicExtension(name: string): string {
  const trimmed = name.trim();
  if (/\.(asc|sim|tau\.json)$/i.test(trimmed)) return trimmed;
  return `${trimmed || "untitled"}.asc`;
}

function isSafeLeafName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed !== "" && trimmed !== "." && trimmed !== ".." && !/[\\/]/.test(trimmed);
}

function failureMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  // Tauri IPC command rejections are commonly plain strings. Keeping the
  // command/permission detail is essential when the desktop capability is wrong.
  if (typeof error === "string" && error.trim()) return error.trim();
  return fallback;
}

function normalizedPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isPathInside(path: string, ancestor: string): boolean {
  const normalized = normalizedPath(path);
  const root = normalizedPath(ancestor);
  return normalized === root || normalized.startsWith(`${root}/`);
}

function parentPath(path: string): string {
  return normalizedPath(path).replace(/\/[^/]+$/, "");
}

function numberedName(name: string, index: number): string {
  if (/\.tau\.json$/i.test(name)) return `${name.slice(0, -9)}-${index}.tau.json`;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}-${index}`;
  return `${name.slice(0, dot)}-${index}${name.slice(dot)}`;
}

function newFileContents(name: string): Pick<WorkspaceFile, "kind" | "contents"> {
  if (/\.asc$/i.test(name)) return { kind: "asc", contents: blankAscText() };
  return { kind: "sim", contents: blankSimJson() };
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

async function availableFilePath(parentPath: string, desiredName: string): Promise<{ path: string; name: string }> {
  for (let index = 1; ; index += 1) {
    const name = index === 1 ? desiredName : numberedName(desiredName, index);
    const path = joinPath(parentPath, name);
    const exists = isWorkspacePath(parentPath)
      ? Object.prototype.hasOwnProperty.call(useProject.getState().workspaceFiles, path)
      : await fs.pathExists(path);
    if (!exists) return { path, name };
  }
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
    if (get().rootPath || get().capability !== "none") return;
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

  newProject: async (suggestedName = DEFAULT_WORKSPACE_NAME) => {
    try {
      if ((await fs.detectFsCapability()) === "none") {
        set(seedWorkspace());
        return true;
      }
      const path = await fs.createProjectFolder(suggestedName);
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
      set({ error: error instanceof Error ? error.message : "Could not create project." });
      return false;
    }
  },

  closeProject: () => {
    const capability = get().capability;
    set(capability === "none"
      ? { ...seedWorkspace(), capability }
      : { ...EMPTY_PROJECT, capability, workspaceFiles: {} });
  },

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
    if (!isSafeLeafName(name)) {
      set({ error: "Folder names cannot contain folder paths." });
      return null;
    }
    const folderName = name.trim();
    const path = joinPath(parentPath, folderName);
    try {
      if (isWorkspacePath(parentPath)) {
        // Virtual folder: appears once a file is created under it; seed a placeholder marker.
        const markerPath = joinPath(path, ".keep");
        const files = {
          ...get().workspaceFiles,
          [markerPath]: { path: markerPath, name: ".keep", kind: "asc" as const, contents: "" },
        };
        set({
          workspaceFiles: files,
          tree: rebuildWorkspaceTree(files),
          expanded: get().expanded.includes(parentPath)
            ? get().expanded.includes(path)
              ? get().expanded
              : [...get().expanded, path]
            : [...get().expanded, parentPath, path],
          error: null,
        });
        return path;
      }
      await fs.mkdirPath(path);
      await get().refresh();
      set((s) => ({
        expanded: s.expanded.includes(parentPath) ? s.expanded : [...s.expanded, parentPath],
        error: null,
      }));
      return path;
    } catch (error) {
      set({ error: failureMessage(error, "Could not create folder.") });
      return null;
    }
  },

  createSchematicFile: async (parentPath, name) => {
    if (!isSafeLeafName(name)) {
      set({ error: "Schematic names cannot contain folder paths." });
      return null;
    }
    const desiredName = ensureSchematicExtension(name);
    try {
      const { path, name: fileName } = await availableFilePath(parentPath, desiredName);
      const file = newFileContents(fileName);
      if (isWorkspacePath(parentPath)) {
        const files = {
          ...get().workspaceFiles,
          [path]: { path, name: fileName, ...file },
        };
        // Drop .keep markers in the same folder once a real file exists.
        for (const key of Object.keys(files)) {
          if (key.startsWith(parentPath + "/") && key.endsWith("/.keep")) delete files[key];
        }
        set({
          workspaceFiles: files,
          tree: rebuildWorkspaceTree(files),
          expanded: get().expanded.includes(parentPath) ? get().expanded : [...get().expanded, parentPath],
          error: null,
        });
        return path;
      }
      await fs.writeTextFile(path, file.contents);
      await get().refresh();
      set((s) => ({
        expanded: s.expanded.includes(parentPath) ? s.expanded : [...s.expanded, parentPath],
        error: null,
      }));
      return path;
    } catch (error) {
      set({ error: failureMessage(error, "Could not create schematic.") });
      return null;
    }
  },

  createSchematicInRoot: async (name = "untitled.asc") => {
    const { rootPath } = get();
    if (!rootPath) {
      set({ error: "Open a Schematics folder before creating a circuit." });
      return null;
    }
    return get().createSchematicFile(rootPath, name);
  },

  importAscFile: async (parentPath, file) => {
    if (!isSafeLeafName(file.name)) {
      set({ error: "Imported filenames cannot contain folder paths." });
      return null;
    }
    const desiredName = /\.asc$/i.test(file.name) ? file.name : `${file.name}.asc`;
    try {
      const { path, name } = await availableFilePath(parentPath, desiredName);
      const text = decodeSchematicText(await file.arrayBuffer());
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

  moveNode: async (sourcePath, destinationDir) => {
    const { rootPath, tree } = get();
    const source = normalizedPath(sourcePath);
    const destination = normalizedPath(destinationDir);
    const root = rootPath ? normalizedPath(rootPath) : null;
    const nodes = flattenTree(tree);
    const sourceNode = nodes.find((node) => normalizedPath(node.path) === source);
    const destinationNode = destination === root
      ? { kind: "dir" as const }
      : nodes.find((node) => normalizedPath(node.path) === destination);

    if (!root || !sourceNode || destinationNode?.kind !== "dir"
      || !isPathInside(source, root) || !isPathInside(destination, root)) {
      set({ error: "Move must stay inside the open Schematics folder." });
      return null;
    }
    if (source === root || (sourceNode.kind === "dir" && isPathInside(destination, source))) {
      set({ error: "A folder cannot be moved into itself." });
      return null;
    }
    if (parentPath(source) === destination) {
      set({ error: null });
      return sourcePath;
    }

    const targetPath = joinPath(destinationDir, basename(sourcePath));
    const target = normalizedPath(targetPath);
    try {
      if (isWorkspacePath(sourcePath)) {
        const current = get().workspaceFiles;
        const moving = Object.entries(current).filter(([path]) => isPathInside(path, sourcePath));
        if (moving.length === 0) throw new Error("The selected item no longer exists.");
        if (Object.keys(current).some((path) => !isPathInside(path, sourcePath) && isPathInside(path, target))) {
          throw new Error(`“${basename(sourcePath)}” already exists in that folder.`);
        }
        const files = { ...current };
        for (const [path] of moving) delete files[path];
        for (const [path, file] of moving) {
          const nextPath = `${target}${normalizedPath(path).slice(source.length)}`;
          files[nextPath] = { ...file, path: nextPath, name: basename(nextPath) };
        }
        set({
          workspaceFiles: files,
          tree: rebuildWorkspaceTree(files),
          expanded: [...new Set([
            ...get().expanded.map((path) => remapMovedProjectPath(path, sourcePath, target)),
            destinationDir,
          ])],
          error: null,
        });
        return target;
      }

      if (await fs.pathExists(targetPath)) {
        throw new Error(`“${basename(sourcePath)}” already exists in that folder.`);
      }
      const movedPath = await fs.moveProjectEntry(rootPath!, sourcePath, destinationDir, sourceNode.kind);
      await get().refresh();
      set((state) => ({
        expanded: [...new Set([
          ...state.expanded.map((path) => remapMovedProjectPath(path, sourcePath, movedPath)),
          destinationDir,
        ])],
        error: null,
      }));
      return movedPath;
    } catch (error) {
      set({ error: failureMessage(error, "Could not move item.") });
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
          kind: prev?.kind ?? (isAscFile(path) ? "asc" : "sim"),
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
