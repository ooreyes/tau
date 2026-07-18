import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  defaultWorkspaceFiles,
} from "../project/defaultWorkspace";
import * as fs from "../project/fsBridge";
import { flattenTree, useProject } from "./useProject";

const ASC_SOURCE = "Version 4\nSHEET 1 880 680\nFLAG 80 80 0\n";

beforeEach(() => {
  useProject.setState({
    rootPath: null,
    rootName: null,
    tree: [],
    expanded: [],
    error: null,
    capability: "none",
    workspaceFiles: {},
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ASC-native project workspace", () => {
  it("uses an empty temporary Schematics workspace only without filesystem access", () => {
    expect(defaultWorkspaceFiles()).toEqual([]);
    useProject.getState().ensureDefaultWorkspace();
    expect(useProject.getState()).toEqual(expect.objectContaining({
      rootPath: DEFAULT_WORKSPACE_ID,
      rootName: DEFAULT_WORKSPACE_NAME,
      tree: [],
      workspaceFiles: {},
    }));
  });

  it("leaves native startup rootless so the user can choose a real folder", () => {
    useProject.setState({ capability: "tauri" });
    useProject.getState().ensureDefaultWorkspace();
    expect(useProject.getState().rootPath).toBeNull();
    expect(useProject.getState().tree).toEqual([]);
  });

  it("creates and reads a valid .asc by default", async () => {
    useProject.getState().ensureDefaultWorkspace();
    const root = useProject.getState().rootPath!;
    const path = await useProject.getState().createSchematicFile(root, "filter");

    expect(path).toBe(`${DEFAULT_WORKSPACE_ID}/filter.asc`);
    expect(flattenTree(useProject.getState().tree).map((node) => node.name)).toEqual(["filter.asc"]);
    await expect(useProject.getState().readSim(path!)).resolves.toBe("Version 4\nSHEET 1 880 680\n");
  });

  it("preserves explicit legacy .sim creation", async () => {
    useProject.getState().ensureDefaultWorkspace();
    const path = await useProject.getState().createSchematicFile(DEFAULT_WORKSPACE_ID, "legacy.sim");
    const contents = await useProject.getState().readSim(path!);
    expect(JSON.parse(contents)).toEqual(expect.objectContaining({ app: "Tau", version: 1 }));
  });

  it("imports the original ASC text under its real filename", async () => {
    useProject.getState().ensureDefaultWorkspace();
    const bytes = new TextEncoder().encode(ASC_SOURCE);
    const file = {
      name: "source.Asc",
      arrayBuffer: async () => bytes.buffer,
    } as File;
    const path = await useProject.getState().importAscFile(DEFAULT_WORKSPACE_ID, file);

    expect(path).toBe(`${DEFAULT_WORKSPACE_ID}/source.Asc`);
    await expect(useProject.getState().readSim(path!)).resolves.toBe(ASC_SOURCE);
    expect(useProject.getState().workspaceFiles[path!]?.kind).toBe("asc");
  });

  it("decodes UTF-16 LTspice imports before storing them", async () => {
    useProject.getState().ensureDefaultWorkspace();
    const encoded = new Uint8Array(2 + ASC_SOURCE.length * 2);
    encoded.set([0xff, 0xfe]);
    for (let index = 0; index < ASC_SOURCE.length; index += 1) {
      encoded[2 + index * 2] = ASC_SOURCE.charCodeAt(index);
    }
    const file = {
      name: "utf16.asc",
      arrayBuffer: async () => encoded.buffer,
    } as File;

    const path = await useProject.getState().importAscFile(DEFAULT_WORKSPACE_ID, file);
    await expect(useProject.getState().readSim(path!)).resolves.toBe(ASC_SOURCE);
  });

  it("uses collision-safe names instead of overwriting schematics", async () => {
    useProject.getState().ensureDefaultWorkspace();
    const first = await useProject.getState().createSchematicFile(DEFAULT_WORKSPACE_ID, "filter.asc");
    await useProject.getState().writeSim(first!, ASC_SOURCE);
    const second = await useProject.getState().createSchematicFile(DEFAULT_WORKSPACE_ID, "filter.asc");

    expect(second).toBe(`${DEFAULT_WORKSPACE_ID}/filter-2.asc`);
    await expect(useProject.getState().readSim(first!)).resolves.toBe(ASC_SOURCE);
  });

  it("serializes rapid plus-button creation into distinct files", async () => {
    useProject.getState().ensureDefaultWorkspace();
    const [first, second] = await Promise.all([
      useProject.getState().createSchematicInRoot(),
      useProject.getState().createSchematicInRoot(),
    ]);

    expect(first).toBe(`${DEFAULT_WORKSPACE_ID}/untitled.asc`);
    expect(second).toBe(`${DEFAULT_WORKSPACE_ID}/untitled-2.asc`);
    expect(flattenTree(useProject.getState().tree).map((node) => node.name)).toEqual([
      "untitled-2.asc",
      "untitled.asc",
    ]);
  });

  it("keeps .tau.json as one extension when resolving a collision", async () => {
    useProject.getState().ensureDefaultWorkspace();
    await useProject.getState().createSchematicFile(DEFAULT_WORKSPACE_ID, "legacy.tau.json");
    const second = await useProject.getState().createSchematicFile(DEFAULT_WORKSPACE_ID, "legacy.tau.json");
    expect(second).toBe(`${DEFAULT_WORKSPACE_ID}/legacy-2.tau.json`);
    expect(flattenTree(useProject.getState().tree).map((node) => node.name)).toContain("legacy-2.tau.json");
  });

  it("rejects path traversal in created and imported filenames", async () => {
    useProject.getState().ensureDefaultWorkspace();
    await expect(useProject.getState().createSchematicFile(DEFAULT_WORKSPACE_ID, "../escape.asc")).resolves.toBeNull();
    const file = { name: "../escape.asc", arrayBuffer: async () => new ArrayBuffer(0) } as File;
    await expect(useProject.getState().importAscFile(DEFAULT_WORKSPACE_ID, file)).resolves.toBeNull();
    expect(useProject.getState().workspaceFiles).toEqual({});
  });

  it("rejects an oversized .asc import before reading it into memory", async () => {
    useProject.getState().ensureDefaultWorkspace();
    let read = false;
    const file = {
      name: "huge.asc",
      size: 20 * 1024 * 1024,
      arrayBuffer: async () => {
        read = true;
        return new ArrayBuffer(0);
      },
    } as unknown as File;
    await expect(useProject.getState().importAscFile(DEFAULT_WORKSPACE_ID, file)).resolves.toBeNull();
    expect(read).toBe(false);
    expect(useProject.getState().workspaceFiles).toEqual({});
    expect(useProject.getState().error).toMatch(/limited to/i);
  });

  it("rejects path traversal in folder names", async () => {
    useProject.getState().ensureDefaultWorkspace();
    await expect(useProject.getState().createFolder(DEFAULT_WORKSPACE_ID, "../escape")).resolves.toBeNull();
    expect(useProject.getState().workspaceFiles).toEqual({});
    expect(useProject.getState().error).toBe("Folder names cannot contain folder paths.");
  });

  it("uses the native write bridge for a real blank ASC and clears stale failures", async () => {
    const root = "/Users/test/Tau_Design";
    const reserve = vi.spyOn(fs, "reserveProjectTextFile").mockResolvedValue({
      status: "created",
      path: `${root}/filter.asc`,
      atomic: true,
    });
    vi.spyOn(fs, "readProjectTree").mockResolvedValue([
      { name: "filter.asc", path: `${root}/filter.asc`, kind: "file" },
    ]);
    useProject.setState({
      capability: "tauri",
      rootPath: root,
      rootName: "Tau_Design",
      expanded: [root],
      error: "Could not create schematic.",
    });

    await expect(useProject.getState().createSchematicFile(root, "filter")).resolves.toBe(`${root}/filter.asc`);
    expect(reserve).toHaveBeenCalledWith(root, root, "filter.asc", "Version 4\nSHEET 1 880 680\n");
    expect(useProject.getState().error).toBeNull();
  });

  it("creates editor-tab schematics in the open project root", async () => {
    const root = "/Users/test/Tau_Design";
    const reserve = vi.spyOn(fs, "reserveProjectTextFile").mockResolvedValue({
      status: "created",
      path: `${root}/untitled.asc`,
      atomic: true,
    });
    vi.spyOn(fs, "readProjectTree").mockResolvedValue([
      { name: "untitled.asc", path: `${root}/untitled.asc`, kind: "file" },
    ]);
    useProject.setState({
      capability: "tauri",
      rootPath: root,
      rootName: "Tau_Design",
      expanded: [root],
    });

    await expect(useProject.getState().createSchematicInRoot()).resolves.toBe(`${root}/untitled.asc`);
    expect(reserve).toHaveBeenCalledWith(root, root, "untitled.asc", "Version 4\nSHEET 1 880 680\n");
    expect(useProject.getState().error).toBeNull();
  });

  it("creates a native folder and moves a disk-backed file into and back out of it", async () => {
    const root = "/Users/test/Tau_Design";
    const folder = `${root}/New Folder`;
    const source = `${root}/filter.asc`;
    const nested = `${folder}/filter.asc`;
    const rootTree = [{ name: "filter.asc", path: source, kind: "file" as const }];
    const folderTree = [
      { name: "New Folder", path: folder, kind: "dir" as const, children: [] },
      ...rootTree,
    ];
    const nestedTree = [{
      name: "New Folder",
      path: folder,
      kind: "dir" as const,
      children: [{ name: "filter.asc", path: nested, kind: "file" as const }],
    }];
    const createDirectory = vi.spyOn(fs, "createProjectDirectory").mockResolvedValue(folder);
    vi.spyOn(fs, "readProjectTree")
      .mockResolvedValueOnce(folderTree)
      .mockResolvedValueOnce(nestedTree)
      .mockResolvedValueOnce(folderTree);
    vi.spyOn(fs, "pathExists").mockResolvedValue(false);
    const move = vi.spyOn(fs, "moveProjectEntry")
      .mockResolvedValueOnce(nested)
      .mockResolvedValueOnce(source);
    useProject.setState({
      capability: "tauri",
      rootPath: root,
      rootName: "Tau_Design",
      tree: rootTree,
      expanded: [root],
    });

    await expect(useProject.getState().createFolder(root, "New Folder")).resolves.toBe(folder);
    expect(createDirectory).toHaveBeenCalledWith(root, root, "New Folder");
    expect(useProject.getState().expanded).toEqual(expect.arrayContaining([root, folder]));

    await expect(useProject.getState().moveNode(source, folder)).resolves.toBe(nested);
    expect(move).toHaveBeenNthCalledWith(1, root, source, folder, "file");
    expect(flattenTree(useProject.getState().tree).map((node) => node.path)).toContain(nested);

    await expect(useProject.getState().moveNode(nested, root)).resolves.toBe(source);
    expect(move).toHaveBeenNthCalledWith(2, root, nested, root, "file");
    expect(flattenTree(useProject.getState().tree).map((node) => node.path)).toContain(source);
    expect(useProject.getState().error).toBeNull();
  });

  it("retries the collision-numbered name after an atomic native AlreadyExists result", async () => {
    const root = "/Users/test/Tau_Design";
    const reserve = vi.spyOn(fs, "reserveProjectTextFile")
      .mockResolvedValueOnce({ status: "already-exists", atomic: true })
      .mockResolvedValueOnce({ status: "created", path: `${root}/filter-2.asc`, atomic: true });
    vi.spyOn(fs, "readProjectTree").mockResolvedValue([
      { name: "filter.asc", path: `${root}/filter.asc`, kind: "file" },
      { name: "filter-2.asc", path: `${root}/filter-2.asc`, kind: "file" },
    ]);
    useProject.setState({
      capability: "tauri",
      rootPath: root,
      rootName: "Tau_Design",
      expanded: [root],
    });

    await expect(useProject.getState().createSchematicFile(root, "filter.asc"))
      .resolves.toBe(`${root}/filter-2.asc`);
    expect(reserve.mock.calls.map((call) => call[2])).toEqual(["filter.asc", "filter-2.asc"]);
  });

  it("atomically imports ASC text without replacing an external collision", async () => {
    const root = "/Users/test/Tau_Design";
    const reserve = vi.spyOn(fs, "reserveProjectTextFile")
      .mockResolvedValueOnce({ status: "already-exists", atomic: true })
      .mockResolvedValueOnce({ status: "created", path: `${root}/source-2.asc`, atomic: true });
    vi.spyOn(fs, "readProjectTree").mockResolvedValue([
      { name: "source.asc", path: `${root}/source.asc`, kind: "file" },
      { name: "source-2.asc", path: `${root}/source-2.asc`, kind: "file" },
    ]);
    useProject.setState({ capability: "tauri", rootPath: root, rootName: "Tau_Design", expanded: [root] });
    const bytes = new TextEncoder().encode(ASC_SOURCE);
    const file = { name: "source.asc", arrayBuffer: async () => bytes.buffer } as File;

    await expect(useProject.getState().importAscFile(root, file)).resolves.toBe(`${root}/source-2.asc`);
    expect(reserve.mock.calls.map((call) => [call[2], call[3]])).toEqual([
      ["source.asc", ASC_SOURCE],
      ["source-2.asc", ASC_SOURCE],
    ]);
  });

  it("refuses a pathless editor tab when no Schematics folder is open", async () => {
    await expect(useProject.getState().createSchematicInRoot()).resolves.toBeNull();
    expect(useProject.getState().error).toBe("Open a Schematics folder before creating a circuit.");
  });

  it("uses the same safe bridge contract for a picked browser directory", async () => {
    const root = "web://Tau_Design";
    const reserve = vi.spyOn(fs, "reserveProjectTextFile").mockResolvedValue({
      status: "created",
      path: `${root}/browser.asc`,
      atomic: false,
    });
    vi.spyOn(fs, "readProjectTree").mockResolvedValue([
      { name: "browser.asc", path: `${root}/browser.asc`, kind: "file" },
    ]);
    useProject.setState({ capability: "web", rootPath: root, rootName: "Tau_Design", expanded: [root] });

    await expect(useProject.getState().createSchematicFile(root, "browser")).resolves.toBe(`${root}/browser.asc`);
    expect(reserve).toHaveBeenCalledWith(root, root, "browser.asc", "Version 4\nSHEET 1 880 680\n");
    expect(useProject.getState().error).toBeNull();
  });

  it("surfaces a Tauri string rejection instead of hiding the native permission failure", async () => {
    const root = "/Users/test/Tau_Design";
    vi.spyOn(fs, "reserveProjectTextFile").mockRejectedValue("project folder is not authorized");
    useProject.setState({ capability: "tauri", rootPath: root, rootName: "Tau_Design" });

    await expect(useProject.getState().createSchematicFile(root, "blocked.asc")).resolves.toBeNull();
    expect(useProject.getState().error).toBe("project folder is not authorized");
  });
});

describe("project node moves", () => {
  it("moves a root file into a nested folder and back to the project root", async () => {
    useProject.getState().ensureDefaultWorkspace();
    const root = useProject.getState().rootPath!;
    const analog = await useProject.getState().createFolder(root, "Analog");
    const filters = await useProject.getState().createFolder(analog!, "Filters");
    const source = await useProject.getState().createSchematicFile(root, "round-trip.asc");

    const nested = await useProject.getState().moveNode(source!, filters!);
    expect(nested).toBe(`${filters}/round-trip.asc`);
    expect(flattenTree(useProject.getState().tree).map((node) => node.path)).not.toContain(source);
    await expect(useProject.getState().readSim(nested!)).resolves.toBe("Version 4\nSHEET 1 880 680\n");

    const returned = await useProject.getState().moveNode(nested!, root);
    expect(returned).toBe(source);
    expect(flattenTree(useProject.getState().tree).map((node) => node.path)).toContain(source);
    await expect(useProject.getState().readSim(source!)).resolves.toBe("Version 4\nSHEET 1 880 680\n");
  });

  it("moves a temporary-workspace folder and all of its files", async () => {
    useProject.getState().ensureDefaultWorkspace();
    const sourceDir = await useProject.getState().createFolder(DEFAULT_WORKSPACE_ID, "Analog");
    const destinationDir = await useProject.getState().createFolder(DEFAULT_WORKSPACE_ID, "Archive");
    const file = await useProject.getState().createSchematicFile(sourceDir!, "filter.asc");

    const moved = await useProject.getState().moveNode(sourceDir!, destinationDir!);

    expect(moved).toBe(`${destinationDir}/Analog`);
    expect(useProject.getState().workspaceFiles[file!]).toBeUndefined();
    await expect(useProject.getState().readSim(`${destinationDir}/Analog/filter.asc`))
      .resolves.toBe("Version 4\nSHEET 1 880 680\n");
    expect(flattenTree(useProject.getState().tree).map((node) => node.path)).toContain(`${destinationDir}/Analog`);
  });

  it("rejects moving a folder into itself or outside the open project", async () => {
    useProject.getState().ensureDefaultWorkspace();
    const sourceDir = await useProject.getState().createFolder(DEFAULT_WORKSPACE_ID, "Analog");
    const childDir = await useProject.getState().createFolder(sourceDir!, "Filters");

    await expect(useProject.getState().moveNode(sourceDir!, childDir!)).resolves.toBeNull();
    expect(useProject.getState().error).toBe("A folder cannot be moved into itself.");
    await expect(useProject.getState().moveNode(sourceDir!, "/tmp/outside")).resolves.toBeNull();
    expect(useProject.getState().error).toBe("Move must stay inside the open Schematics folder.");
  });

  it("does not overwrite an existing item at the move destination", async () => {
    useProject.getState().ensureDefaultWorkspace();
    const sourceDir = await useProject.getState().createFolder(DEFAULT_WORKSPACE_ID, "Analog");
    const destinationDir = await useProject.getState().createFolder(DEFAULT_WORKSPACE_ID, "Archive");
    const source = await useProject.getState().createSchematicFile(sourceDir!, "filter.asc");
    const existing = await useProject.getState().createSchematicFile(destinationDir!, "filter.asc");
    await useProject.getState().writeSim(existing!, ASC_SOURCE);

    await expect(useProject.getState().moveNode(source!, destinationDir!)).resolves.toBeNull();
    expect(useProject.getState().error).toContain("already exists");
    await expect(useProject.getState().readSim(existing!)).resolves.toBe(ASC_SOURCE);
    await expect(useProject.getState().readSim(source!)).resolves.toBe("Version 4\nSHEET 1 880 680\n");
  });

  it("moves a native node through the atomic project bridge and refreshes the tree", async () => {
    const root = "/Users/test/Tau_Design";
    const destination = `${root}/Archive`;
    const source = `${root}/filter.asc`;
    useProject.setState({
      capability: "tauri",
      rootPath: root,
      rootName: "Tau_Design",
      tree: [
        { name: "Archive", path: destination, kind: "dir", children: [] },
        { name: "filter.asc", path: source, kind: "file" },
      ],
      expanded: [root],
    });
    vi.spyOn(fs, "pathExists").mockResolvedValue(false);
    const move = vi.spyOn(fs, "moveProjectEntry").mockResolvedValue(`${destination}/filter.asc`);
    const readTree = vi.spyOn(fs, "readProjectTree").mockResolvedValue([
      {
        name: "Archive",
        path: destination,
        kind: "dir",
        children: [{ name: "filter.asc", path: `${destination}/filter.asc`, kind: "file" }],
      },
    ]);

    await expect(useProject.getState().moveNode(source, destination)).resolves.toBe(`${destination}/filter.asc`);
    expect(move).toHaveBeenCalledWith(root, source, destination, "file");
    expect(readTree).toHaveBeenCalledWith(root);
    expect(useProject.getState().expanded).toContain(destination);
    expect(flattenTree(useProject.getState().tree).map((node) => node.path)).toContain(`${destination}/filter.asc`);
    expect(useProject.getState().error).toBeNull();
  });

  it("returns the real moved path for tab remapping when the post-move refresh fails", async () => {
    const root = "/Users/test/Tau_Design";
    const sourceDir = `${root}/Analog`;
    const destination = `${root}/Archive`;
    const source = `${sourceDir}/filter.asc`;
    useProject.setState({
      capability: "tauri",
      rootPath: root,
      rootName: "Tau_Design",
      tree: [
        {
          name: "Analog",
          path: sourceDir,
          kind: "dir",
          children: [{ name: "filter.asc", path: source, kind: "file" }],
        },
        { name: "Archive", path: destination, kind: "dir", children: [] },
      ],
      expanded: [root, sourceDir],
    });
    vi.spyOn(fs, "pathExists").mockResolvedValue(false);
    vi.spyOn(fs, "moveProjectEntry").mockResolvedValue(`${destination}/filter.asc`);
    vi.spyOn(fs, "readProjectTree").mockRejectedValue(new Error("Disk refresh failed."));

    await expect(useProject.getState().moveNode(source, destination))
      .resolves.toBe(`${destination}/filter.asc`);
    expect(useProject.getState().expanded).toContain(destination);
    expect(useProject.getState().error).toBe("Disk refresh failed.");
  });
});

describe("project node renames", () => {
  it("renames a workspace folder and remaps every descendant path", async () => {
    useProject.getState().ensureDefaultWorkspace();
    const root = useProject.getState().rootPath!;
    const folder = await useProject.getState().createFolder(root, "Analog");
    const file = await useProject.getState().createSchematicFile(folder!, "filter.asc");

    await expect(useProject.getState().renameNode(folder!, "Filters"))
      .resolves.toBe(`${root}/Filters`);
    expect(useProject.getState().workspaceFiles[file!]).toBeUndefined();
    expect(useProject.getState().workspaceFiles[`${root}/Filters/filter.asc`]).toBeTruthy();
    expect(flattenTree(useProject.getState().tree).map((node) => node.path))
      .toContain(`${root}/Filters/filter.asc`);
  });

  it("adds the schematic extension and performs a native disk rename", async () => {
    const root = "/Users/test/Tau_Design";
    const source = `${root}/untitled.asc`;
    const destination = `${root}/gain-stage.asc`;
    useProject.setState({
      capability: "tauri",
      rootPath: root,
      rootName: "Tau_Design",
      tree: [{ name: "untitled.asc", path: source, kind: "file" }],
      expanded: [root],
    });
    vi.spyOn(fs, "pathExists").mockResolvedValue(false);
    const rename = vi.spyOn(fs, "renamePath").mockResolvedValue(undefined);
    vi.spyOn(fs, "readProjectTree").mockResolvedValue([
      { name: "gain-stage.asc", path: destination, kind: "file" },
    ]);

    await expect(useProject.getState().renameNode(source, "gain-stage")).resolves.toBe(destination);
    expect(rename).toHaveBeenCalledWith(source, destination);
    expect(useProject.getState().error).toBeNull();
  });

  it("rejects path-like names before touching disk", async () => {
    const root = "/Users/test/Tau_Design";
    const source = `${root}/filter.asc`;
    useProject.setState({
      capability: "tauri",
      rootPath: root,
      rootName: "Tau_Design",
      tree: [{ name: "filter.asc", path: source, kind: "file" }],
    });
    const rename = vi.spyOn(fs, "renamePath").mockResolvedValue(undefined);

    await expect(useProject.getState().renameNode(source, "../escape.asc")).resolves.toBeNull();
    expect(rename).not.toHaveBeenCalled();
    expect(useProject.getState().error).toContain("cannot be empty or contain folder paths");
  });
});
