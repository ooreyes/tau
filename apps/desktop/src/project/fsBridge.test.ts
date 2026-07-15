import { afterEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => tauri);

import { moveProjectEntry, reserveProjectTextFile } from "./fsBridge";

afterEach(() => {
  tauri.isTauri.mockReturnValue(true);
  tauri.invoke.mockReset();
  vi.unstubAllGlobals();
});

describe("native project text-file reservation bridge", () => {
  it("maps an atomic native creation result and forwards the authorized path pieces", async () => {
    tauri.invoke.mockResolvedValueOnce({ status: "created", path: "/project/filter.asc" });

    await expect(reserveProjectTextFile(
      "/project",
      "/project",
      "filter.asc",
      "Version 4\n",
    )).resolves.toEqual({ status: "created", path: "/project/filter.asc", atomic: true });
    expect(tauri.invoke).toHaveBeenCalledWith("create_project_text_file_exclusive", {
      projectRoot: "/project",
      parentPath: "/project",
      name: "filter.asc",
      contents: "Version 4\n",
    });
  });

  it("keeps native AlreadyExists explicit so the store can retry without overwriting", async () => {
    tauri.invoke.mockResolvedValueOnce({ status: "alreadyExists" });

    await expect(reserveProjectTextFile(
      "/project",
      "/project",
      "filter.asc",
      "Version 4\n",
    )).resolves.toEqual({ status: "already-exists", atomic: true });
  });

  it("marks the browser File System Access fallback as non-atomic", async () => {
    tauri.isTauri.mockReturnValue(false);
    let written = "";
    const fileHandle = {
      createWritable: vi.fn(async () => ({
        write: async (contents: string) => { written = contents; },
        close: async () => {},
      })),
    };
    const directoryHandle = {
      name: "Tau_Design",
      getFileHandle: vi.fn(async (_name: string, options?: { create?: boolean }) => {
        if (!options?.create && !written) throw new Error("not found");
        return fileHandle;
      }),
    };
    vi.stubGlobal("window", {
      showDirectoryPicker: vi.fn(async () => directoryHandle),
    });
    const { pickProjectFolder } = await import("./fsBridge");
    await expect(pickProjectFolder()).resolves.toBe("web://Tau_Design");

    await expect(reserveProjectTextFile(
      "web://Tau_Design",
      "web://Tau_Design",
      "filter.asc",
      "Version 4\n",
    )).resolves.toEqual({
      status: "created",
      path: "web://Tau_Design/filter.asc",
      atomic: false,
    });
    expect(written).toBe("Version 4\n");

    await expect(reserveProjectTextFile(
      "web://Tau_Design",
      "web://Tau_Design",
      "filter.asc",
      "must not replace\n",
    )).resolves.toEqual({ status: "already-exists", atomic: false });
    expect(written).toBe("Version 4\n");
  });
});

describe("native project move bridge", () => {
  it("forwards the authorized root, source, and target directory to Rust", async () => {
    tauri.invoke.mockResolvedValueOnce("/project/Archive/Filters");

    await expect(moveProjectEntry(
      "/project",
      "/project/Analog/Filters",
      "/project/Archive",
      "dir",
    )).resolves.toBe("/project/Archive/Filters");
    expect(tauri.invoke).toHaveBeenCalledWith("move_project_entry", {
      projectRoot: "/project",
      sourcePath: "/project/Analog/Filters",
      targetDirectory: "/project/Archive",
      newName: null,
    });
  });
});
