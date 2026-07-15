// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ExplorerPanel } from "./ShellPanels";
import { useProject } from "../store/useProject";

const originalProjectActions = {
  detectCapability: useProject.getState().detectCapability,
  ensureDefaultWorkspace: useProject.getState().ensureDefaultWorkspace,
};

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

beforeEach(() => {
  useProject.setState({
    rootPath: null,
    rootName: null,
    tree: [],
    expanded: [],
    error: null,
    capability: "none",
    workspaceFiles: {},
    ...originalProjectActions,
  });
  useProject.getState().ensureDefaultWorkspace();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderExplorer = ({ onMoveNode }: { onMoveNode?: (sourcePath: string, destinationDirectoryPath: string) => Promise<string | null> } = {}) => {
  const onOpenSimFile = vi.fn();
  const onOpenAscText = vi.fn();
  const onNotice = vi.fn();
  render(
    <ExplorerPanel
      activeFilePath={null}
      onOpenSimFile={onOpenSimFile}
      onOpenAscText={onOpenAscText}
      onNotice={onNotice}
      onMoveNode={onMoveNode}
    />,
  );
  return { onOpenSimFile, onOpenAscText, onNotice };
};

function dataTransferStub(): DataTransfer {
  const values = new Map<string, string>();
  return {
    effectAllowed: "uninitialized",
    dropEffect: "none",
    setData: vi.fn((type: string, value: string) => values.set(type, value)),
    getData: vi.fn((type: string) => values.get(type) ?? ""),
  } as unknown as DataTransfer;
}

describe("ExplorerPanel VS Code action row", () => {
  it("exposes New File, New Folder, Refresh, and Collapse as working controls", async () => {
    const { onNotice } = renderExplorer();
    for (const name of [
      "New schematic file",
      "New folder",
      "Import LTspice schematic",
      "Open Schematics folder",
      "Refresh explorer",
      "Collapse folders in explorer",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Refresh explorer" }).querySelector(".lucide-refresh-cw")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collapse folders in explorer" }).querySelector(".lucide-copy-minus")).toBeTruthy();

    expect(useProject.getState().expanded.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Collapse folders in explorer" }));
    expect(useProject.getState().expanded).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Refresh explorer" }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("Explorer refreshed."));
  });

  it("creates and opens an ASC schematic from the New File control", async () => {
    const { onOpenAscText } = renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: "New schematic file" }));
    const input = screen.getByRole("textbox", { name: "New schematic name" });
    fireEvent.change(input, { target: { value: "gain-stage" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onOpenAscText).toHaveBeenCalledWith(
      expect.stringMatching(/gain-stage\.asc$/),
      "gain-stage.asc",
      "Version 4\nSHEET 1 880 680\n",
    ));
    expect(screen.getByText("gain-stage.asc")).toBeTruthy();
  });

  it("creates a visible folder from the New Folder control", async () => {
    renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    const input = screen.getByRole("textbox", { name: "New folder name" });
    fireEvent.change(input, { target: { value: "Filters" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Filters")).toBeTruthy());
  });

  it("imports and opens ASC text without changing its filename", async () => {
    const { onOpenAscText } = renderExplorer();
    const source = "Version 4\nSHEET 1 880 680\n";
    const bytes = new TextEncoder().encode(source);
    const file = { name: "existing.asc", arrayBuffer: async () => bytes.buffer } as File;
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept=".asc"]');
    expect(input).toBeTruthy();

    fireEvent.change(input!, { target: { files: [file] } });
    await waitFor(() => expect(onOpenAscText).toHaveBeenCalledWith(
      expect.stringMatching(/existing\.asc$/),
      "existing.asc",
      source,
    ));
    expect(screen.getByText("existing.asc")).toBeTruthy();
  });

  it("still opens an explicit legacy .sim document", async () => {
    const root = useProject.getState().rootPath!;
    const path = await useProject.getState().createSchematicFile(root, "legacy.sim");
    const { onOpenSimFile } = renderExplorer();

    fireEvent.click(screen.getByRole("button", { name: "legacy.sim" }));
    await waitFor(() => expect(onOpenSimFile).toHaveBeenCalledWith(
      path,
      "legacy.sim",
      expect.stringContaining('"app": "Tau"'),
    ));
  });

  it("does not announce a successful refresh when the project refresh fails", async () => {
    useProject.setState({ refresh: vi.fn().mockResolvedValue(false) });
    const { onNotice } = renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: "Refresh explorer" }));
    await waitFor(() => expect(useProject.getState().refresh).toHaveBeenCalledOnce());
    expect(onNotice).not.toHaveBeenCalledWith("Explorer refreshed.");
  });

  it("keeps folder opening and LTspice import in the compact toolbar without a redundant footer", () => {
    const { onNotice } = renderExplorer();
    expect(screen.getByRole("button", { name: "Open Schematics folder" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import LTspice schematic" })).toBeTruthy();
    expect(document.querySelector(".explorer-secondary-actions")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Schematics folder" }));
    expect(onNotice).toHaveBeenCalledWith("Opening a disk folder needs the Tau desktop app.");
  });

  it("offers real-folder actions when native Tau has no project open", () => {
    useProject.setState({
      rootPath: null,
      rootName: null,
      tree: [],
      capability: "tauri",
      detectCapability: vi.fn().mockResolvedValue(undefined),
      ensureDefaultWorkspace: vi.fn(),
    });
    renderExplorer();

    expect(screen.getByRole("button", { name: "Open Schematics folder" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Schematics folder" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import LTspice schematic" })).toBeTruthy();
    expect(document.querySelector(".explorer-empty-actions")).toBeNull();
    expect(screen.getByText("Schematics")).toBeTruthy();
  });

  it("does not claim the browser can create a folder", () => {
    useProject.setState({
      rootPath: null,
      rootName: null,
      tree: [],
      capability: "web",
      detectCapability: vi.fn().mockResolvedValue(undefined),
      ensureDefaultWorkspace: vi.fn(),
    });
    renderExplorer();

    expect(screen.getByRole("button", { name: "Open Schematics folder" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create Schematics folder" })).toBeNull();
  });

  it("moves a draggable file onto a folder through the explicit project move contract", async () => {
    const root = useProject.getState().rootPath!;
    const source = await useProject.getState().createSchematicFile(root, "gain.asc");
    const folder = await useProject.getState().createFolder(root, "Filters");
    const onMoveNode = vi.fn().mockResolvedValue(`${folder}/gain.asc`);
    const { onNotice } = renderExplorer({ onMoveNode });
    const fileRow = screen.getByRole("button", { name: "gain.asc" });
    const folderRow = screen.getByRole("button", { name: "Filters" });
    const dataTransfer = dataTransferStub();

    expect(fileRow.getAttribute("draggable")).toBe("true");
    expect(fileRow.getAttribute("aria-describedby")).toBe("explorer-drag-help");
    expect(screen.getByText(/Drag a file or folder onto another folder/)).toBeTruthy();

    fireEvent.dragStart(fileRow, { dataTransfer });
    expect(fileRow.getAttribute("data-dragging")).toBe("true");
    expect(fileRow.getAttribute("aria-grabbed")).toBe("true");
    fireEvent.dragOver(folderRow, { dataTransfer });
    expect(folderRow.getAttribute("data-drop-target")).toBe("true");
    expect(dataTransfer.dropEffect).toBe("move");
    fireEvent.drop(folderRow, { dataTransfer });

    await waitFor(() => expect(onMoveNode).toHaveBeenCalledWith(source, folder));
    expect(onNotice).toHaveBeenCalledWith("Moved gain.asc");
    expect(folderRow.getAttribute("data-drop-target")).toBeNull();
  });

  it("uses the drag payload when React drag state has not committed yet", async () => {
    const root = useProject.getState().rootPath!;
    const source = await useProject.getState().createSchematicFile(root, "race.asc");
    const folder = await useProject.getState().createFolder(root, "New Destination");
    const onMoveNode = vi.fn().mockResolvedValue(`${folder}/race.asc`);
    renderExplorer({ onMoveNode });
    const dataTransfer = dataTransferStub();
    dataTransfer.setData("application/x-tau-project-node", source!);

    // A drop backed only by dataTransfer reproduces the browser ordering where
    // dragover/drop can precede React's setDraggedNode commit.
    fireEvent.drop(screen.getByRole("button", { name: "New Destination" }), { dataTransfer });

    await waitFor(() => expect(onMoveNode).toHaveBeenCalledWith(source, folder));
  });

  it("makes a failed move visible instead of silently clearing the drag", async () => {
    const root = useProject.getState().rootPath!;
    await useProject.getState().createSchematicFile(root, "blocked.asc");
    await useProject.getState().createFolder(root, "Destination");
    const onMoveNode = vi.fn(async () => {
      useProject.setState({ error: "A file named blocked.asc already exists in Destination." });
      return null;
    });
    const { onNotice } = renderExplorer({ onMoveNode });
    const dataTransfer = dataTransferStub();

    fireEvent.dragStart(screen.getByRole("button", { name: "blocked.asc" }), { dataTransfer });
    fireEvent.drop(screen.getByRole("button", { name: "Destination" }), { dataTransfer });

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("A file named blocked.asc already exists in Destination."));
    expect(screen.getByRole("alert").textContent).toContain("already exists");
  });

  it("supports moving a nested explorer item back to the project root", async () => {
    const root = useProject.getState().rootPath!;
    const folder = await useProject.getState().createFolder(root, "Filters");
    const source = await useProject.getState().createSchematicFile(folder!, "nested.asc");
    const onMoveNode = vi.fn().mockResolvedValue(`${root}/nested.asc`);
    renderExplorer({ onMoveNode });
    const fileRow = screen.getByRole("button", { name: "nested.asc" });
    const rootTarget = screen.getByRole("button", {
      name: /Project root .+; drop files or folders here/i,
    });
    const dataTransfer = dataTransferStub();

    fireEvent.dragStart(fileRow, { dataTransfer });
    fireEvent.dragOver(rootTarget, { dataTransfer });
    expect(rootTarget.getAttribute("data-drop-target")).toBe("true");
    expect(dataTransfer.dropEffect).toBe("move");
    fireEvent.drop(rootTarget, { dataTransfer });

    await waitFor(() => expect(onMoveNode).toHaveBeenCalledWith(source, root));
  });

  it("moves a root file into a nested folder", async () => {
    const root = useProject.getState().rootPath!;
    const parent = await useProject.getState().createFolder(root, "Analog");
    const destination = await useProject.getState().createFolder(parent!, "Filters");
    const source = await useProject.getState().createSchematicFile(root, "root-filter.asc");
    const onMoveNode = vi.fn().mockResolvedValue(`${destination}/root-filter.asc`);
    renderExplorer({ onMoveNode });
    const dataTransfer = dataTransferStub();

    fireEvent.dragStart(screen.getByRole("button", { name: "root-filter.asc" }), { dataTransfer });
    fireEvent.dragOver(screen.getByRole("button", { name: "Filters" }), { dataTransfer });
    fireEvent.drop(screen.getByRole("button", { name: "Filters" }), { dataTransfer });

    await waitFor(() => expect(onMoveNode).toHaveBeenCalledWith(source, destination));
  });

  it("moves a folder and its contents across sibling folders", async () => {
    const root = useProject.getState().rootPath!;
    const sourceParent = await useProject.getState().createFolder(root, "Analog");
    const destination = await useProject.getState().createFolder(root, "Archive");
    const movingFolder = await useProject.getState().createFolder(sourceParent!, "Filters");
    await useProject.getState().createSchematicFile(movingFolder!, "low-pass.asc");
    const onMoveNode = vi.fn().mockResolvedValue(`${destination}/Filters`);
    renderExplorer({ onMoveNode });
    const dataTransfer = dataTransferStub();

    fireEvent.dragStart(screen.getByRole("button", { name: "Filters" }), { dataTransfer });
    fireEvent.dragOver(screen.getByRole("button", { name: "Archive" }), { dataTransfer });
    fireEvent.drop(screen.getByRole("button", { name: "Archive" }), { dataTransfer });

    await waitFor(() => expect(onMoveNode).toHaveBeenCalledWith(movingFolder, destination));
  });

  it("rejects dropping a folder into its own descendant", async () => {
    const root = useProject.getState().rootPath!;
    const parent = await useProject.getState().createFolder(root, "Parent");
    await useProject.getState().createFolder(parent!, "Child");
    const onMoveNode = vi.fn().mockResolvedValue("unused");
    renderExplorer({ onMoveNode });
    const parentRow = screen.getByRole("button", { name: "Parent" });
    const childRow = screen.getByRole("button", { name: "Child" });
    const dataTransfer = dataTransferStub();

    fireEvent.dragStart(parentRow, { dataTransfer });
    fireEvent.dragOver(childRow, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("none");
    expect(childRow.getAttribute("data-drop-target")).toBeNull();
    fireEvent.drop(childRow, { dataTransfer });

    expect(onMoveNode).not.toHaveBeenCalled();
  });

  it("explains the missing persistence capability instead of faking a move", async () => {
    const root = useProject.getState().rootPath!;
    await useProject.getState().createSchematicFile(root, "gain.asc");
    await useProject.getState().createFolder(root, "Filters");
    const { onNotice } = renderExplorer();
    const dataTransfer = dataTransferStub();

    fireEvent.dragStart(screen.getByRole("button", { name: "gain.asc" }), { dataTransfer });
    fireEvent.dragOver(screen.getByRole("button", { name: "Filters" }), { dataTransfer });
    fireEvent.drop(screen.getByRole("button", { name: "Filters" }), { dataTransfer });

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("Moving explorer items needs a project move action."));
  });
});
