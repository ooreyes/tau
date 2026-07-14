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

  it("keeps Open Folder and LTspice import available as secondary project actions", () => {
    renderExplorer();
    expect(screen.getByRole("button", { name: "Open Folder…" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import .asc…" })).toBeTruthy();
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

    expect(screen.getByRole("button", { name: "Open Folder" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Folder" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import .asc…" })).toBeTruthy();
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

    expect(screen.getByRole("button", { name: "Open Folder" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create Folder" })).toBeNull();
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
    expect(screen.getByText(/Drag a file or folder onto a folder/)).toBeTruthy();

    fireEvent.dragStart(fileRow, { dataTransfer });
    expect(fileRow.getAttribute("data-dragging")).toBe("true");
    fireEvent.dragOver(folderRow, { dataTransfer });
    expect(folderRow.getAttribute("data-drop-target")).toBe("true");
    expect(dataTransfer.dropEffect).toBe("move");
    fireEvent.drop(folderRow, { dataTransfer });

    await waitFor(() => expect(onMoveNode).toHaveBeenCalledWith(source, folder));
    expect(onNotice).toHaveBeenCalledWith("Moved gain.asc");
    expect(folderRow.getAttribute("data-drop-target")).toBeNull();
  });

  it("supports moving a nested explorer item back to the project root", async () => {
    const root = useProject.getState().rootPath!;
    const folder = await useProject.getState().createFolder(root, "Filters");
    const source = await useProject.getState().createSchematicFile(folder!, "nested.asc");
    const onMoveNode = vi.fn().mockResolvedValue(`${root}/nested.asc`);
    renderExplorer({ onMoveNode });
    const fileRow = screen.getByRole("button", { name: "nested.asc" });
    const tree = document.querySelector<HTMLElement>(".tree-list")!;
    const dataTransfer = dataTransferStub();

    fireEvent.dragStart(fileRow, { dataTransfer });
    fireEvent.dragOver(tree, { dataTransfer });
    expect(tree.getAttribute("data-drop-target")).toBe("true");
    fireEvent.drop(tree, { dataTransfer });

    await waitFor(() => expect(onMoveNode).toHaveBeenCalledWith(source, root));
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
