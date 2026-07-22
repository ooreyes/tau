/**
 * Thin filesystem bridge for VS Code-style folder projects.
 * Prefers Tauri dialog/fs plugins; falls back to the Chrome File System Access
 * API in the browser; otherwise reports that a desktop app is required.
 */

import { basename, isProjectFile, joinPath, type ProjectNode } from "./types";
import { decodeSchematicText } from "../io/ascImport";
import { MAX_SCHEMATIC_FILE_BYTES } from "../schematic/documentValidation";

export type FsCapability = "tauri" | "web" | "none";

async function isTauri(): Promise<boolean> {
  try {
    const { isTauri } = await import("@tauri-apps/api/core");
    return isTauri();
  } catch {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  }
}

export async function detectFsCapability(): Promise<FsCapability> {
  if (await isTauri()) return "tauri";
  if (typeof window !== "undefined" && "showDirectoryPicker" in window) return "web";
  return "none";
}

/** Prompt the user to pick a project folder. Returns absolute path or null. */
export async function pickProjectFolder(): Promise<string | null> {
  if (await isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
      recursive: true,
      title: "Open Project Folder",
    });
    if (typeof selected !== "string") return null;
    await authorizeProjectDirectory(selected);
    return selected;
  }
  // Web File System Access API - we keep a handle map keyed by a synthetic path.
  if (typeof window !== "undefined" && "showDirectoryPicker" in window) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
      const key = `web://${handle.name}`;
      webHandles.set(key, handle);
      return key;
    } catch {
      return null; // user cancelled
    }
  }
  return null;
}

/** Prompt for a new empty folder (Tauri: pick parent + name via mkdir). */
export async function createProjectFolder(suggestedName = "Tau Project"): Promise<string | null> {
  if (await isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const parent = await open({
      directory: true,
      multiple: false,
      recursive: true,
      title: "Choose parent folder for new project",
    });
    if (typeof parent !== "string") return null;
    const name = suggestedName.trim() || "Tau Project";
    const path = joinPath(parent, name);
    const { mkdir } = await import("@tauri-apps/plugin-fs");
    await mkdir(path, { recursive: true });
    await authorizeProjectDirectory(path);
    return path;
  }
  return pickProjectFolder();
}

/** Promote a folder-picker grant to the recursive project scope Tau needs. */
async function authorizeProjectDirectory(projectRoot: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("authorize_project_directory", { projectRoot });
}

// ── Web directory-handle cache (session only) ───────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const webHandles = new Map<string, any>();

async function webDir(path: string) {
  const rootKey = [...webHandles.keys()].find((k) => path === k || path.startsWith(k + "/"));
  if (!rootKey) throw new Error("No open web directory handle for this path.");
  const root = webHandles.get(rootKey)!;
  if (path === rootKey) return root;
  const rel = path.slice(rootKey.length + 1).split("/").filter(Boolean);
  let cur = root;
  for (const part of rel) {
    cur = await cur.getDirectoryHandle(part);
  }
  return cur;
}

async function webFile(path: string, create = false) {
  const parentPath = path.replace(/\\/g, "/").replace(/\/[^/]+$/, "") || path;
  const name = basename(path);
  const dir = await webDir(parentPath === path ? path : parentPath);
  return dir.getFileHandle(name, { create });
}

/** Check for a file without creating it, across native and browser projects. */
export async function pathExists(path: string): Promise<boolean> {
  if (path.startsWith("web://")) {
    try {
      await webFile(path);
      return true;
    } catch {
      return false;
    }
  }
  const { exists } = await import("@tauri-apps/plugin-fs");
  return exists(path);
}

/** Recursively list a project folder (dirs + .sim / .tau.json files). */
export async function readProjectTree(rootPath: string): Promise<ProjectNode[]> {
  if (rootPath.startsWith("web://")) {
    return readWebTree(rootPath, await webDir(rootPath));
  }
  const { readDir } = await import("@tauri-apps/plugin-fs");
  return readTauriTree(rootPath, readDir);
}

async function readTauriTree(
  dirPath: string,
  readDir: (path: string) => Promise<Array<{ name?: string; isDirectory?: boolean; isFile?: boolean }>>,
): Promise<ProjectNode[]> {
  const entries = await readDir(dirPath);
  const nodes: ProjectNode[] = [];
  for (const entry of entries) {
    const name = entry.name;
    if (!name || name.startsWith(".")) continue;
    const path = joinPath(dirPath, name);
    if (entry.isDirectory) {
      const children = await readTauriTree(path, readDir);
      nodes.push({ name, path, kind: "dir", children });
    } else if (entry.isFile && isProjectFile(name)) {
      nodes.push({ name, path, kind: "file" });
    }
  }
  return sortNodes(nodes);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readWebTree(dirPath: string, handle: any): Promise<ProjectNode[]> {
  const nodes: ProjectNode[] = [];
  for await (const [name, child] of handle.entries()) {
    if (name.startsWith(".")) continue;
    const path = joinPath(dirPath, name);
    if (child.kind === "directory") {
      webHandles.set(path, child);
      const children = await readWebTree(path, child);
      nodes.push({ name, path, kind: "dir", children });
    } else if (child.kind === "file" && isProjectFile(name)) {
      nodes.push({ name, path, kind: "file" });
    }
  }
  return sortNodes(nodes);
}

function sortNodes(nodes: ProjectNode[]): ProjectNode[] {
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export async function readTextFile(path: string): Promise<string> {
  if (path.startsWith("web://")) {
    const file = await (await webFile(path)).getFile();
    assertProjectTextByteLength(file.size);
    const bytes = await file.arrayBuffer();
    assertProjectTextByteLength(bytes.byteLength);
    return decodeSchematicText(bytes);
  }
  const { readFile: read, stat } = await import("@tauri-apps/plugin-fs");
  const metadata = await stat(path);
  assertProjectTextByteLength(metadata.size);
  const bytes = await read(path);
  // The file can change after stat(). Recheck the bytes actually returned so
  // an external grow/replace race cannot allocate unbounded schematic text.
  assertProjectTextByteLength(bytes.byteLength);
  return decodeSchematicText(bytes);
}

export async function writeTextFile(path: string, contents: string): Promise<void> {
  assertProjectTextByteLength(new TextEncoder().encode(contents).byteLength);
  if (path.startsWith("web://")) {
    const handle = await webFile(path, true);
    const writable = await handle.createWritable();
    await writable.write(contents);
    await writable.close();
    return;
  }
  const { writeTextFile: write } = await import("@tauri-apps/plugin-fs");
  await write(path, contents);
}

function assertProjectTextByteLength(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_SCHEMATIC_FILE_BYTES) {
    throw new Error(
      `Schematic files are limited to ${MAX_SCHEMATIC_FILE_BYTES.toLocaleString("en-US")} bytes.`,
    );
  }
}

export interface PickedTextFile {
  name: string;
  text: string;
}

/**
 * Prompt the user to pick one vendor SPICE model file (`.lib`/`.subckt`/…) to
 * attach to the document. Returns null on cancel. Uses the same double
 * byte-cap check as {@link readTextFile} so an attached file can never smuggle
 * in more text than an imported schematic could.
 */
export async function pickModelLibraryFile(): Promise<PickedTextFile | null> {
  if (await isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      title: "Attach vendor model file",
      filters: [
        { name: "SPICE model files", extensions: ["lib", "sub", "subckt", "mod", "cir", "spi", "inc", "txt"] },
      ],
    });
    if (typeof selected !== "string") return null;
    const { readFile: read, stat } = await import("@tauri-apps/plugin-fs");
    const metadata = await stat(selected);
    assertProjectTextByteLength(metadata.size);
    const bytes = await read(selected);
    // The file can change after stat(); recheck the bytes actually returned so
    // an external grow/replace race cannot allocate unbounded attachment text.
    assertProjectTextByteLength(bytes.byteLength);
    return { name: basename(selected), text: decodeSchematicText(bytes) };
  }

  if (typeof window !== "undefined" && "showOpenFilePicker" in window) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let handles: any[];
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handles = await (window as any).showOpenFilePicker({ multiple: false });
    } catch {
      return null; // user cancelled
    }
    const handle = handles[0];
    if (!handle) return null;
    const file = await handle.getFile();
    assertProjectTextByteLength(file.size);
    const bytes = await file.arrayBuffer();
    assertProjectTextByteLength(bytes.byteLength);
    return { name: file.name as string, text: decodeSchematicText(bytes) };
  }

  throw new Error("Attaching model files requires the Tau desktop app or a browser with file access.");
}

export type ProjectTextFileReservation =
  | { status: "created"; path: string; atomic: boolean }
  | { status: "already-exists"; atomic: boolean };

type NativeProjectTextFileReservation =
  | { status: "created"; path: string }
  | { status: "alreadyExists" };

/**
 * Reserve a new project file without replacing an existing one. Native Tau
 * delegates to Rust's `create_new(true)` path and is atomic across processes.
 * The browser File System Access API exposes no exclusive-create primitive, so
 * its fallback is explicitly marked non-atomic; the project store still
 * serializes Tau's own concurrent creation requests.
 */
export async function reserveProjectTextFile(
  projectRoot: string,
  parentPath: string,
  name: string,
  contents: string,
): Promise<ProjectTextFileReservation> {
  if (await isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<NativeProjectTextFileReservation>("create_project_text_file_exclusive", {
      projectRoot,
      parentPath,
      name,
      contents,
    });
    return result.status === "created"
      ? { status: "created", path: result.path, atomic: true }
      : { status: "already-exists", atomic: true };
  }

  if (!projectRoot.startsWith("web://") || (!parentPath.startsWith(`${projectRoot}/`) && parentPath !== projectRoot)) {
    throw new Error("Exclusive project file creation requires Tau desktop or an open browser folder.");
  }
  const path = joinPath(parentPath, name);
  // Non-atomic browser fallback: another process can win after this check.
  // Returning `atomic: false` keeps callers and tests honest about that limit.
  if (await pathExists(path)) return { status: "already-exists", atomic: false };
  // Do not attempt cleanup after a failed write: without exclusive creation we
  // cannot prove the handle still belongs to this request rather than a racer.
  await writeTextFile(path, contents);
  return { status: "created", path, atomic: false };
}

/** Create a real Explorer folder inside the authorized project root. Native
 * Tau performs validation and `create_dir` in one Rust command; the browser
 * fallback uses the already-authorized File System Access directory handle. */
export async function createProjectDirectory(
  projectRoot: string,
  parentPath: string,
  name: string,
): Promise<string> {
  if (await isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("create_project_directory", {
      projectRoot,
      parentPath,
      name,
    });
  }
  if (!projectRoot.startsWith("web://") || (!parentPath.startsWith(`${projectRoot}/`) && parentPath !== projectRoot)) {
    throw new Error("Project folder creation requires Tau desktop or an open browser folder.");
  }
  const path = joinPath(parentPath, name);
  await mkdirPath(path);
  return path;
}

export async function mkdirPath(path: string): Promise<void> {
  if (path.startsWith("web://")) {
    const parent = path.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
    const name = basename(path);
    const dir = await webDir(parent);
    const child = await dir.getDirectoryHandle(name, { create: true });
    webHandles.set(path, child);
    return;
  }
  const { mkdir } = await import("@tauri-apps/plugin-fs");
  await mkdir(path, { recursive: true });
}

export async function removePath(path: string): Promise<void> {
  if (path.startsWith("web://")) {
    const parent = path.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
    const name = basename(path);
    const dir = await webDir(parent);
    try {
      await dir.removeEntry(name, { recursive: true });
    } catch {
      await dir.removeEntry(name);
    }
    webHandles.delete(path);
    return;
  }
  const { remove } = await import("@tauri-apps/plugin-fs");
  await remove(path, { recursive: true });
}

export async function renamePath(from: string, to: string): Promise<void> {
  if (from.startsWith("web://")) {
    // Web FS Access has no rename - read + write + delete.
    const text = await readTextFile(from);
    await writeTextFile(to, text);
    await removePath(from);
    return;
  }
  const { rename } = await import("@tauri-apps/plugin-fs");
  await rename(from, to);
}

/**
 * Atomically move an Explorer entry. Native Tau delegates validation and the
 * rename to Rust so traversal, symlink escape, descendant moves, and overwrite
 * races are checked at the filesystem boundary. The web File System Access API
 * can move files by copy/delete but cannot safely move directory handles.
 */
export async function moveProjectEntry(
  projectRoot: string,
  sourcePath: string,
  targetDirectory: string,
  kind: "file" | "dir",
): Promise<string> {
  if (await isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("move_project_entry", {
      projectRoot,
      sourcePath,
      targetDirectory,
      newName: null,
    });
  }
  if (kind === "dir") {
    throw new Error("This browser cannot move folders. Use the Tau desktop app.");
  }
  const targetPath = joinPath(targetDirectory, basename(sourcePath));
  await renamePath(sourcePath, targetPath);
  return targetPath;
}
