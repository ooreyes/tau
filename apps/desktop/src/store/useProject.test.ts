import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  defaultWorkspaceFiles,
} from "../project/defaultWorkspace";
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
});
