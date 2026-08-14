import { create } from "zustand";
import { userFacingErrorMessage } from "../lib/errorMessage";
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
import { MAX_SCHEMATIC_FILE_BYTES } from "../schematic/documentValidation";

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

/**
 * A name typed without an extension becomes a `.sim`, not a `.asc`.
 *
 * `.asc` is LTspice's format, and the two halves of a hierarchy are NOT equally
 * expressible in it. A `.asc` sheet can state its own interface perfectly well -
 * each port is a `FLAG` plus an adjacent `IOPIN <dir>`, which Tau reads and
 * writes - so it makes a perfectly good CHILD. What it cannot record is a sheet
 * block's link: which sheet the block points at, and in what pin order. So a
 * sheet born `.asc` can be pointed AT but can never be the sheet doing the
 * pointing, and `serializeSchematicFile` refuses that save rather than dropping
 * the link silently.
 *
 * That refusal arrives long after the moment the extension was chosen, and the
 * moment is invisible: nothing on screen says a new sheet has just been made
 * unable to hold a block. Defaulting to Tau's own format keeps both roles open.
 * A name the user spells `.asc` still gets `.asc`, and opened or imported `.asc`
 * files are untouched by this.
 */
function ensureSchematicExtension(name: string): string {
  const trimmed = name.trim();
  if (/\.(asc|sim|tau\.json)$/i.test(trimmed)) return trimmed;
  return `${trimmed || "untitled"}.sim`;
}

function preserveSchematicExtension(name: string, originalName: string): string {
  const trimmed = name.trim();
  if (/\.(asc|sim|tau\.json)$/i.test(trimmed)) return trimmed;
  const originalExtension = originalName.match(/(\.tau\.json|\.asc|\.sim)$/i)?.[1] ?? ".asc";
  return `${trimmed || "untitled"}${originalExtension}`;
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

function projectParentPath(path: string): string {
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

// Filename selection is a check-then-create transaction. Serialize it so two
// rapid `+`/Cmd-S actions cannot both reserve the same `untitled.sim` before
// either write becomes visible to the filesystem or temporary workspace.
let schematicCreationQueue: Promise<void> = Promise.resolve();

function enqueueSchematicCreation<T>(create: () => Promise<T>): Promise<T> {
  const next = schematicCreationQueue.then(create, create);
  schematicCreationQueue = next.then(() => undefined, () => undefined);
  return next;
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
      set({ error: userFacingErrorMessage(error, "Could not open folder.") });
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
      set({ error: userFacingErrorMessage(error, "Could not create project.") });
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
      set({ error: userFacingErrorMessage(error, "Could not refresh project.") });
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
      const rootPath = get().rootPath;
      if (!rootPath) throw new Error("Open a Schematics folder before creating a folder.");
      const createdPath = await fs.createProjectDirectory(rootPath, parentPath, folderName);
      await get().refresh();
      set((s) => ({
        expanded: [...new Set([...s.expanded, parentPath, createdPath])],
        error: null,
      }));
      return createdPath;
    } catch (error) {
      set({ error: failureMessage(error, "Could not create folder.") });
      return null;
    }
  },

  createSchematicFile: (parentPath, name) => enqueueSchematicCreation(async () => {
    if (!isSafeLeafName(name)) {
      set({ error: "Schematic names cannot contain folder paths." });
      return null;
    }
    const desiredName = ensureSchematicExtension(name);
    try {
      if (isWorkspacePath(parentPath)) {
        const { path, name: fileName } = await availableFilePath(parentPath, desiredName);
        const file = newFileContents(fileName);
        const files = {
          ...get().workspaceFiles,
          [path]: { path, name: fileName, ...file },
        };
        // Drop only this folder's placeholder once it has a real file. A
        // prefix check also matched descendant `.keep` files and silently
        // erased newly created nested folders when a root file was created.
        for (const key of Object.keys(files)) {
          if (projectParentPath(key) === normalizedPath(parentPath) && basename(key) === ".keep") delete files[key];
        }
        set({
          workspaceFiles: files,
          tree: rebuildWorkspaceTree(files),
          expanded: get().expanded.includes(parentPath) ? get().expanded : [...get().expanded, parentPath],
          error: null,
        });
        return path;
      }
      const rootPath = get().rootPath;
      if (!rootPath) throw new Error("Open a Schematics folder before creating a circuit.");
      let path = "";
      for (let index = 1; ; index += 1) {
        const fileName = index === 1 ? desiredName : numberedName(desiredName, index);
        const file = newFileContents(fileName);
        const reservation = await fs.reserveProjectTextFile(rootPath, parentPath, fileName, file.contents);
        if (reservation.status === "already-exists") continue;
        path = reservation.path;
        break;
      }
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
  }),

  // Unnamed sheets default to `.sim` for the reason `ensureSchematicExtension`
  // gives: a `.asc` can be a child but never the sheet that holds a block, and
  // an unnamed sheet is the one most likely to become either.
  createSchematicInRoot: async (name = "untitled.sim") => {
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
    // Match readTextFile's cap: reject an oversized file by its declared size
    // BEFORE reading it into memory, so a huge .asc cannot exhaust the renderer
    // (the native write path is capped in Rust, but the web/workspace branch and
    // the arrayBuffer read below are not otherwise bounded).
    if (file.size > MAX_SCHEMATIC_FILE_BYTES) {
      set({
        error: `Schematic files are limited to ${MAX_SCHEMATIC_FILE_BYTES.toLocaleString("en-US")} bytes.`,
      });
      return null;
    }
    const desiredName = /\.asc$/i.test(file.name) ? file.name : `${file.name}.asc`;
    try {
      const text = decodeSchematicText(await file.arrayBuffer());
      if (isWorkspacePath(parentPath)) {
        const { path, name } = await availableFilePath(parentPath, desiredName);
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
      const rootPath = get().rootPath;
      if (!rootPath) throw new Error("Open a Schematics folder before importing a circuit.");
      let path = "";
      for (let index = 1; ; index += 1) {
        const name = index === 1 ? desiredName : numberedName(desiredName, index);
        const reservation = await fs.reserveProjectTextFile(rootPath, parentPath, name, text);
        if (reservation.status === "already-exists") continue;
        path = reservation.path;
        break;
      }
      await get().refresh();
      return path;
    } catch (error) {
      set({ error: userFacingErrorMessage(error, "Could not import .asc.") });
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
    if (projectParentPath(source) === destination) {
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
      // A single root-tree refresh updates both the old parent and the new
      // destination. The filesystem move has already succeeded at this point,
      // so return its path even if refresh fails: callers must still remap open
      // tabs to the real on-disk location. Preserve the refresh error for the
      // Explorer instead of replacing it with a false success state.
      const refreshed = await get().refresh();
      set((state) => ({
        expanded: [...new Set([
          ...state.expanded.map((path) => remapMovedProjectPath(path, sourcePath, movedPath)),
          destinationDir,
        ])],
        ...(refreshed ? { error: null } : {}),
      }));
      return movedPath;
    } catch (error) {
      set({ error: failureMessage(error, "Could not move item.") });
      return null;
    }
  },

  renameNode: async (path, newName) => {
    const { rootPath, tree } = get();
    const node = flattenTree(tree).find((candidate) => normalizedPath(candidate.path) === normalizedPath(path));
    if (!node || !rootPath || !isPathInside(path, rootPath)) {
      set({ error: "Rename must stay inside the open Schematics folder." });
      return null;
    }
    const requestedName = newName.trim();
    if (!isSafeLeafName(requestedName)) {
      set({ error: "Names cannot be empty or contain folder paths." });
      return null;
    }
    const safeName = node.kind === "file"
      ? preserveSchematicExtension(requestedName, node.name)
      : requestedName;
    const parent = projectParentPath(path);
    const to = joinPath(parent, safeName);
    if (normalizedPath(to) === normalizedPath(path)) {
      set({ error: null });
      return path;
    }
    try {
      if (isWorkspacePath(path)) {
        const current = get().workspaceFiles;
        const moving = Object.entries(current).filter(([candidate]) => isPathInside(candidate, path));
        if (moving.length === 0) throw new Error("The selected item no longer exists.");
        if (Object.keys(current).some((candidate) => !isPathInside(candidate, path) && isPathInside(candidate, to))) {
          throw new Error(`“${safeName}” already exists in that folder.`);
        }
        const files = { ...current };
        for (const [candidate] of moving) delete files[candidate];
        for (const [candidate, file] of moving) {
          const nextPath = `${normalizedPath(to)}${normalizedPath(candidate).slice(normalizedPath(path).length)}`;
          files[nextPath] = { ...file, path: nextPath, name: basename(nextPath) };
        }
        set((state) => ({
          workspaceFiles: files,
          tree: rebuildWorkspaceTree(files),
          expanded: state.expanded.map((candidate) => remapMovedProjectPath(candidate, path, to)),
          error: null,
        }));
        return to;
      }
      if (await fs.pathExists(to)) throw new Error(`“${safeName}” already exists in that folder.`);
      await fs.renamePath(path, to);
      const refreshed = await get().refresh();
      set((state) => ({
        expanded: state.expanded.map((candidate) => remapMovedProjectPath(candidate, path, to)),
        ...(refreshed ? { error: null } : {}),
      }));
      return to;
    } catch (error) {
      set({ error: failureMessage(error, "Could not rename.") });
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
      set({ error: userFacingErrorMessage(error, "Could not delete.") });
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
