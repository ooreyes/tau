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

  it("rejects path traversal in folder names", async () => {
    useProject.getState().ensureDefaultWorkspace();
    await expect(useProject.getState().createFolder(DEFAULT_WORKSPACE_ID, "../escape")).resolves.toBeNull();
    expect(useProject.getState().workspaceFiles).toEqual({});
    expect(useProject.getState().error).toBe("Folder names cannot contain folder paths.");
  });

  it("uses the native write bridge for a real blank ASC and clears stale failures", async () => {
    const root = "/Users/test/Tau_Design";
    vi.spyOn(fs, "pathExists").mockResolvedValue(false);
    const write = vi.spyOn(fs, "writeTextFile").mockResolvedValue(undefined);
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
    expect(write).toHaveBeenCalledWith(`${root}/filter.asc`, "Version 4\nSHEET 1 880 680\n");
    expect(useProject.getState().error).toBeNull();
  });

  it("uses the same safe bridge contract for a picked browser directory", async () => {
    const root = "web://Tau_Design";
    vi.spyOn(fs, "pathExists").mockResolvedValue(false);
    const write = vi.spyOn(fs, "writeTextFile").mockResolvedValue(undefined);
    vi.spyOn(fs, "readProjectTree").mockResolvedValue([
      { name: "browser.asc", path: `${root}/browser.asc`, kind: "file" },
    ]);
    useProject.setState({ capability: "web", rootPath: root, rootName: "Tau_Design", expanded: [root] });

    await expect(useProject.getState().createSchematicFile(root, "browser")).resolves.toBe(`${root}/browser.asc`);
    expect(write).toHaveBeenCalledWith(`${root}/browser.asc`, "Version 4\nSHEET 1 880 680\n");
    expect(useProject.getState().error).toBeNull();
  });

  it("surfaces a Tauri string rejection instead of hiding the native permission failure", async () => {
    const root = "/Users/test/Tau_Design";
    vi.spyOn(fs, "pathExists").mockResolvedValue(false);
    vi.spyOn(fs, "writeTextFile").mockRejectedValue("fs.write_text_file not allowed");
    useProject.setState({ capability: "tauri", rootPath: root, rootName: "Tau_Design" });

    await expect(useProject.getState().createSchematicFile(root, "blocked.asc")).resolves.toBeNull();
    expect(useProject.getState().error).toBe("fs.write_text_file not allowed");
  });
});

describe("project node moves", () => {
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
    vi.spyOn(fs, "readProjectTree").mockResolvedValue([
      {
        name: "Archive",
        path: destination,
        kind: "dir",
        children: [{ name: "filter.asc", path: `${destination}/filter.asc`, kind: "file" }],
      },
    ]);

    await expect(useProject.getState().moveNode(source, destination)).resolves.toBe(`${destination}/filter.asc`);
    expect(move).toHaveBeenCalledWith(root, source, destination, "file");
    expect(useProject.getState().expanded).toContain(destination);
    expect(useProject.getState().error).toBeNull();
  });
});
