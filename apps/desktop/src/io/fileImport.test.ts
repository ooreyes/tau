import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProject } from "../store/useProject";
import { useSchematic } from "../store/useSchematic";
import { importDroppedFile } from "./fileImport";
import { MAX_MODEL_LIBRARIES, MAX_MODEL_LIBRARY_TOTAL_LENGTH } from "../schematic/documentValidation";

function fileFrom(name: string, text: string): File {
  const bytes = new TextEncoder().encode(text);
  return { name, arrayBuffer: async () => bytes.buffer } as File;
}

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
  // Mirrors the app's own startup sequence: a capability-"none" (browser)
  // session gets a default in-memory workspace immediately, so "no project
  // open yet" is not actually reachable there - only real Tauri sessions
  // start genuinely rootless (see the "asks the user to choose a
  // destination" test below, which overrides capability to exercise that).
  useProject.getState().ensureDefaultWorkspace();
  useSchematic.setState({ userModelLibraries: [], past: [], future: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("importDroppedFile", () => {
  it("persists a genuine .asc into the project unchanged and hands back its text to open", async () => {
    const source = "Version 4\nSHEET 1 880 680\n";
    const outcome = await importDroppedFile(fileFrom("existing.asc", source), { hasActiveSchematic: false });
    expect(outcome).toEqual({
      kind: "schematic",
      path: expect.stringMatching(/existing\.asc$/),
      text: source,
      warnings: [],
    });
    if (outcome.kind !== "schematic") throw new Error("unreachable");
    await expect(useProject.getState().readSim(outcome.path)).resolves.toBe(source);
  });

  it("converts a SPICE netlist into an asc file and reports its conversion warnings", async () => {
    const source = "* t\nR1 a 0 1k\nX1 a b mysub\n.end\n";
    const outcome = await importDroppedFile(fileFrom("board.cir", source), { hasActiveSchematic: false });
    expect(outcome.kind).toBe("schematic");
    if (outcome.kind !== "schematic") throw new Error("unreachable");
    expect(outcome.path).toMatch(/board\.asc$/);
    expect(outcome.warnings.some((w) => w.includes("X1"))).toBe(true);
    // The persisted file is real ASC text, not the original netlist.
    await expect(useProject.getState().readSim(outcome.path)).resolves.toContain("Version 4");
  });

  it("reports a precise error and writes nothing when the file is unsupported", async () => {
    const outcome = await importDroppedFile(fileFrom("photo.png", "hello"), { hasActiveSchematic: false });
    expect(outcome.kind).toBe("error");
    if (outcome.kind !== "error") throw new Error("unreachable");
    expect(outcome.message).toMatch(/does not recognize/);
    expect(useProject.getState().tree).toEqual([]);
  });

  it("attaches a dropped model library to the current schematic when one is open", async () => {
    const outcome = await importDroppedFile(
      fileFrom("opamps.lib", ".subckt OPX a b c\n.ends\n"),
      { hasActiveSchematic: true },
    );
    expect(outcome).toEqual({ kind: "model-library", name: "opamps.lib" });
    expect(useSchematic.getState().userModelLibraries).toEqual([
      { name: "opamps.lib", text: ".subckt OPX a b c\n.ends\n" },
    ]);
  });

  it("refuses to attach a model library when no schematic is open, without touching the store", async () => {
    const outcome = await importDroppedFile(
      fileFrom("opamps.lib", ".subckt OPX a b c\n.ends\n"),
      { hasActiveSchematic: false },
    );
    expect(outcome).toEqual({
      kind: "error",
      message: "Open or create a schematic before attaching a vendor model file.",
    });
    expect(useSchematic.getState().userModelLibraries).toEqual([]);
  });

  it("enforces the model-library attachment cap instead of silently accepting an over-limit file", async () => {
    useSchematic.setState({
      userModelLibraries: Array.from({ length: MAX_MODEL_LIBRARIES }, (_, i) => ({ name: `lib-${i}.lib`, text: "* x" })),
    });
    const outcome = await importDroppedFile(
      fileFrom("one-more.lib", ".model X D\n"),
      { hasActiveSchematic: true },
    );
    expect(outcome).toEqual({
      kind: "error",
      message: `Tau supports up to ${MAX_MODEL_LIBRARIES} attached model files.`,
    });
  });

  it("enforces the aggregate model-library character cap", async () => {
    useSchematic.setState({
      userModelLibraries: [{ name: "big.lib", text: "x".repeat(MAX_MODEL_LIBRARY_TOTAL_LENGTH) }],
    });
    const outcome = await importDroppedFile(
      fileFrom("small.lib", ".model X D\n"),
      { hasActiveSchematic: true },
    );
    expect(outcome.kind).toBe("error");
    if (outcome.kind !== "error") throw new Error("unreachable");
    expect(outcome.message).toMatch(/character limit/);
  });

  it("asks the user to choose a destination when creating a project fails (e.g. the picker is cancelled)", async () => {
    useProject.setState({ rootPath: null, rootName: null, capability: "tauri", newProject: vi.fn().mockResolvedValue(false) });
    const outcome = await importDroppedFile(fileFrom("existing.asc", "Version 4\nSHEET 1 880 680\n"), {
      hasActiveSchematic: false,
    });
    expect(outcome).toEqual({ kind: "error", message: "Choose a Schematics folder to import this file." });
  });
});
