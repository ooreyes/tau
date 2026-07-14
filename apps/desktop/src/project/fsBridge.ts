/**
 * Thin filesystem bridge for VS Code–style folder projects.
 * Prefers Tauri dialog/fs plugins; falls back to the Chrome File System Access
 * API in the browser; otherwise reports that a desktop app is required.
 */

import { basename, isProjectFile, joinPath, type ProjectNode } from "./types";
import { decodeSchematicText } from "../io/ascImport";

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
    const selected = await open({ directory: true, multiple: false, title: "Open Project Folder" });
    return typeof selected === "string" ? selected : null;
  }
  // Web File System Access API — we keep a handle map keyed by a synthetic path.
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
      title: "Choose parent folder for new project",
    });
    if (typeof parent !== "string") return null;
    const name = suggestedName.trim() || "Tau Project";
    const path = joinPath(parent, name);
    const { mkdir } = await import("@tauri-apps/plugin-fs");
    await mkdir(path, { recursive: true });
    return path;
  }
  return pickProjectFolder();
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
    return decodeSchematicText(await file.arrayBuffer());
  }
  const { readFile: read } = await import("@tauri-apps/plugin-fs");
  return decodeSchematicText(await read(path));
}

export async function writeTextFile(path: string, contents: string): Promise<void> {
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
    // Web FS Access has no rename — read + write + delete.
    const text = await readTextFile(from);
    await writeTextFile(to, text);
    await removePath(from);
    return;
  }
  const { rename } = await import("@tauri-apps/plugin-fs");
  await rename(from, to);
}
