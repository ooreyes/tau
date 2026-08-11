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

const renderExplorer = ({ onMoveNode, onRenameNode }: {
  onMoveNode?: (sourcePath: string, destinationDirectoryPath: string) => Promise<string | null>;
  onRenameNode?: (sourcePath: string, newName: string) => Promise<string | null>;
} = {}) => {
  const onOpenSimFile = vi.fn();
  const onOpenAscText = vi.fn();
  const onNotice = vi.fn();
  const rendered = render(
    <ExplorerPanel
      activeFilePath={null}
      onOpenSimFile={onOpenSimFile}
      onOpenAscText={onOpenAscText}
      onNotice={onNotice}
      onMoveNode={onMoveNode}
      onRenameNode={onRenameNode}
    />,
  );
  return { ...rendered, onOpenSimFile, onOpenAscText, onNotice };
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

describe("ExplorerPanel action row", () => {
  it("exposes New File, New Folder, Refresh, and Collapse as working controls", async () => {
    const { onNotice } = renderExplorer();
    for (const name of [
      "New schematic file",
      "New folder",
      "Import circuit",
      "Refresh explorer",
      "Collapse folders in explorer",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Refresh explorer" }).querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collapse folders in explorer" }).querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New schematic file" }).querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New folder" }).querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import circuit" }).querySelector("svg")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open Schematics folder" })).toBeNull();

    const initiallyExpanded = [...useProject.getState().expanded];
    expect(initiallyExpanded.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Collapse folders in explorer" }));
    expect(useProject.getState().expanded).toEqual([]);

    const restore = screen.getByRole("button", { name: "Restore expanded folders in explorer" });
    expect(restore.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(restore);
    expect(useProject.getState().expanded).toEqual(initiallyExpanded);

    fireEvent.click(screen.getByRole("button", { name: "Refresh explorer" }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("Explorer refreshed."));

    // The toggle remains deterministic when repeated, and a new project gets
    // its own restoration set rather than inheriting the old root's folders.
    fireEvent.click(screen.getByRole("button", { name: "Collapse folders in explorer" }));
    useProject.setState({
      rootPath: "web://workspace/other-project",
      rootName: "Other Project",
      tree: [],
      expanded: ["web://workspace/other-project"],
    });
    await waitFor(() => expect(screen.getAllByText("Other Project").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Collapse folders in explorer" }));
    expect(useProject.getState().expanded).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Restore expanded folders in explorer" }));
    expect(useProject.getState().expanded).toEqual(["web://workspace/other-project"]);
  });

  it("does not invent a restoration set for an already-collapsed tree", () => {
    useProject.setState({ expanded: [] });
    renderExplorer();

    fireEvent.click(screen.getByRole("button", { name: "Collapse folders in explorer" }));
    expect(useProject.getState().expanded).toEqual([]);
    expect(screen.queryByRole("button", { name: "Restore expanded folders in explorer" })).toBeNull();
  });

  it("keeps a long root identity while routing narrow actions through an overflow menu", async () => {
    const rootName = "工程 Δ — 测试项目";
    useProject.setState({ rootName });
    const { container } = renderExplorer();

    expect(container.querySelector(".explorer-root-name")?.textContent).toBe(rootName);
    expect(container.querySelector(".explorer-primary-actions")).toBeTruthy();
    const overflow = screen.getByRole("button", { name: "More explorer actions" });
    expect(overflow.classList.contains("explorer-overflow-trigger")).toBe(true);

    fireEvent.pointerDown(overflow, { button: 0, ctrlKey: false });
    await screen.findByRole("menu");
    for (const label of [
      "New schematic file",
      "New folder",
      "Import circuit",
      "Refresh explorer",
      "Collapse folders in explorer",
    ]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeTruthy();
    }
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
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept*=".asc"]');
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

  it("opens a safe VS Code-style context menu and renames without any destructive double-click", async () => {
    const root = useProject.getState().rootPath!;
    const path = await useProject.getState().createSchematicFile(root, "filter.asc");
    const onRenameNode = vi.fn().mockResolvedValue(`${root}/renamed.asc`);
    const deleteNode = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    useProject.setState({ deleteNode });
    renderExplorer({ onRenameNode });

    const row = screen.getByRole("button", { name: "filter.asc" });
    fireEvent.doubleClick(row);
    expect(deleteNode).not.toHaveBeenCalled();

    fireEvent.contextMenu(row);
    expect(await screen.findByRole("menuitem", { name: /Copy Path/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Copy Relative Path/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Rename/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Delete/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: /Copy Path/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(path));

    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Rename/ }));
    const input = await screen.findByRole("textbox", { name: "Rename filter.asc" });
    fireEvent.change(input, { target: { value: "renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onRenameNode).toHaveBeenCalledWith(path, "renamed"));
    expect(deleteNode).not.toHaveBeenCalled();
  });

  it("does not announce a successful refresh when the project refresh fails", async () => {
    useProject.setState({ refresh: vi.fn().mockResolvedValue(false) });
    const { onNotice } = renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: "Refresh explorer" }));
    await waitFor(() => expect(useProject.getState().refresh).toHaveBeenCalledOnce());
    expect(onNotice).not.toHaveBeenCalledWith("Explorer refreshed.");
  });

  it("keeps LTspice import in the compact toolbar without a redundant open-folder icon", () => {
    renderExplorer();
    expect(screen.queryByRole("button", { name: "Open Schematics folder" })).toBeNull();
    expect(screen.getByRole("button", { name: "Import circuit" })).toBeTruthy();
    expect(document.querySelector(".explorer-secondary-actions")).toBeNull();
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
    expect(screen.getByRole("button", { name: "Import circuit" })).toBeTruthy();
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

  it("moves a file onto a folder through the explicit project move contract", async () => {
    const root = useProject.getState().rootPath!;
    const source = await useProject.getState().createSchematicFile(root, "gain.asc");
    const folder = await useProject.getState().createFolder(root, "Filters");
    const onMoveNode = vi.fn().mockResolvedValue(`${folder}/gain.asc`);
    const { onNotice } = renderExplorer({ onMoveNode });
    const fileRow = screen.getByRole("button", { name: "gain.asc" });
    const folderRow = screen.getByRole("button", { name: "Filters" });
    const dataTransfer = dataTransferStub();

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

  it("uses pointer dragging in WKWebView where native HTML drag is unreliable", async () => {
    const root = useProject.getState().rootPath!;
    const source = await useProject.getState().createSchematicFile(root, "native.asc");
    const folder = await useProject.getState().createFolder(root, "Native Target");
    const onMoveNode = vi.fn().mockResolvedValue(`${folder}/native.asc`);
    renderExplorer({ onMoveNode });
    const fileRow = screen.getByRole("button", { name: "native.asc" });
    const folderRow = screen.getByRole("button", { name: "Native Target" });
    const destination = folderRow.closest<HTMLElement>("[data-project-dir-path]")!;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn().mockReturnValue(destination),
    });

    fireEvent.pointerDown(fileRow, { pointerId: 7, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(fileRow, { pointerId: 7, clientX: 120, clientY: 120 });
    fireEvent.pointerUp(fileRow, { pointerId: 7, clientX: 120, clientY: 120 });

    await waitFor(() => expect(onMoveNode).toHaveBeenCalledWith(source, folder));
    Reflect.deleteProperty(document, "elementFromPoint");
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

  it("treats a drop on a file inside an expanded folder as a drop on that folder", async () => {
    const root = useProject.getState().rootPath!;
    const led = await useProject.getState().createFolder(root, "LED");
    await useProject.getState().createSchematicFile(led!, "led.asc");
    const source = await useProject.getState().createSchematicFile(root, "driver.asc");
    const onMoveNode = vi.fn().mockResolvedValue(`${led}/driver.asc`);
    renderExplorer({ onMoveNode });
    const dataTransfer = dataTransferStub();

    fireEvent.dragStart(screen.getByRole("button", { name: "driver.asc" }), { dataTransfer });
    // Users commonly release over the child file row under an expanded LED/.
    fireEvent.dragOver(screen.getByRole("button", { name: "led.asc" }), { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("move");
    fireEvent.drop(screen.getByRole("button", { name: "led.asc" }), { dataTransfer });

    await waitFor(() => expect(onMoveNode).toHaveBeenCalledWith(source, led));
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
