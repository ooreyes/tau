// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  EXPLORER_PANEL_WIDTH,
  ExplorerPanel,
  explorerHeaderLayout,
  explorerPrimaryActionCount,
  treeRowIndent,
} from "./ShellPanels";
import { useProject } from "../store/useProject";

/** jsdom evaluates no stylesheet, so the rules this lane owns are asserted as
 *  source text. Same technique ShellPanels.test.tsx already uses on App.css. */
const explorerTreeCss = (): string =>
  readFileSync(join(__dirname, "..", "styles", "explorerTree.css"), "utf8");

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

/**
 * This jsdom run has no localStorage at all (Node's own global refuses without
 * --localstorage-file), so `loadPanelWidth` always hands back the panel's
 * 226px default and no test can exercise another width. Stubbing the one API
 * it reads is also the real path a user-resized panel takes.
 *
 * Most of this file is about tree behaviour, not the header's pixel budget, so
 * it renders at a width where every primary icon legitimately fits (the
 * five-icon threshold is 240px - see the P3-04A block). Tests that care what
 * the *shipped* default renders say so explicitly and stub their own width.
 */
const WIDTH_WITH_EVERY_ICON = 300;

const stubExplorerWidth = (width: number) => {
  const stored = new Map<string, string>([[EXPLORER_PANEL_WIDTH.storageKey, String(width)]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
};

beforeEach(() => {
  stubExplorerWidth(WIDTH_WITH_EVERY_ICON);
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

  // "Collapse, then open one folder myself, then press it again" has to
  // collapse. It used to restore the pre-collapse set instead, throwing away
  // the folder the reader had just opened and reinstating folders they had
  // deliberately left behind.
  it("collapses again rather than restoring once the reader expands anything", () => {
    renderExplorer();
    const root = useProject.getState().rootPath!;
    const before = [...useProject.getState().expanded];
    expect(before.length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Collapse folders in explorer" }));
    expect(useProject.getState().expanded).toEqual([]);

    // The reader opens a folder by hand. The button is no longer "undo my
    // collapse" - the tree is not as the button left it.
    const handOpened = [root, `${root}/nested`];
    act(() => { useProject.setState({ expanded: handOpened }); });
    expect(
      screen.queryByRole("button", { name: "Restore expanded folders in explorer" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Collapse folders in explorer" }));
    expect(useProject.getState().expanded).toEqual([]);

    // …and the fresh snapshot is the hand-opened set, not the stale one.
    fireEvent.click(screen.getByRole("button", { name: "Restore expanded folders in explorer" }));
    expect(useProject.getState().expanded).toEqual(handOpened);
    expect(useProject.getState().expanded).not.toEqual(before);
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

/**
 * P3-06. "Id like for the files to look indented almost to denote they live
 * within a folder." The tree used to render the project root's own children at
 * depth 0 - the same 8px the root row itself sat at - and file rows carried no
 * caret column, so a file's glyphs started 17px LEFT of a sibling folder's.
 * Both halves are measured here from the inline padding the browser actually
 * applies, not from a class name.
 */
describe("P3-06 - tree rows must read as nested inside their folder", () => {
  const paddingLeftOf = (row: Element | null, what: string): number => {
    expect(row, `${what} is missing from the tree`).toBeTruthy();
    const declared = (row as HTMLElement).style.paddingLeft;
    expect(declared, `${what} has no explicit padding-left, so its indent is a <button> UA default`)
      .toMatch(/^\d+(\.\d+)?px$/);
    return parseFloat(declared);
  };

  it("indents each level strictly past its parent, the project root row included", async () => {
    const root = useProject.getState().rootPath!;
    const folder = await useProject.getState().createFolder(root, "Filters");
    await useProject.getState().createSchematicFile(folder!, "low-pass.asc");
    await useProject.getState().createSchematicFile(root, "gain.asc");
    renderExplorer();

    const rootIndent = paddingLeftOf(
      screen.getByRole("button", { name: /Project root .+; drop files or folders here/i }),
      "the project root row",
    );
    const depth1Folder = paddingLeftOf(screen.getByRole("button", { name: "Filters" }), "the Filters folder row");
    const depth1File = paddingLeftOf(screen.getByRole("button", { name: "gain.asc" }), "the root-level gain.asc row");
    const depth2File = paddingLeftOf(screen.getByRole("button", { name: "low-pass.asc" }), "the nested low-pass.asc row");
    // Siblings share a column; each level steps strictly inward.
    expect(depth1File).toBe(depth1Folder);
    expect(depth1Folder).toBeGreaterThan(rootIndent);
    expect(depth2File).toBeGreaterThan(depth1Folder);
    // A step a reader can SEE. The packaged verify gate refuses anything under
    // 10px per level because the pre-fix tree stepped by 2px, which satisfies
    // "greater than" and satisfies nobody looking at it.
    expect(depth1Folder - rootIndent).toBeGreaterThanOrEqual(10);
    expect(depth2File - depth1Folder).toBeGreaterThanOrEqual(10);
  });

  it("gives file rows the folder's caret column so equal depths share a glyph column", async () => {
    const root = useProject.getState().rootPath!;
    await useProject.getState().createSchematicFile(root, "gain.asc");
    renderExplorer();

    const fileRow = screen.getByRole("button", { name: "gain.asc" });
    const folderRow = screen.getByRole("button", { name: /Project root/i });
    // Without a spacer the file's icon is the row's first child and starts a
    // whole caret-width (13px) + gap left of every folder icon in the tree.
    expect(fileRow.querySelector(".tree-caret")).not.toBeNull();
    expect(folderRow.querySelector(".tree-caret")).not.toBeNull();
    expect(fileRow.firstElementChild?.className).toContain("tree-caret");
    // The spacer must never announce itself or become a second focus stop.
    expect(fileRow.querySelector(".tree-caret")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("publishes the row indent to CSS so the nesting guide cannot drift from it", async () => {
    const root = useProject.getState().rootPath!;
    const folder = await useProject.getState().createFolder(root, "Filters");
    await useProject.getState().createSchematicFile(folder!, "low-pass.asc");
    const { container } = renderExplorer();

    const dir = container.querySelector<HTMLElement>(`.tree-dir[data-project-dir-path="${folder}"]`);
    expect(dir, "the Filters directory wrapper is missing").toBeTruthy();
    expect(dir!.getAttribute("data-open")).toBe("true");
    // Single source of truth: the guide's x is derived from the same number the
    // row's padding uses, so changing the indent step cannot desync the line.
    const folderRow = screen.getByRole("button", { name: "Filters" });
    expect(dir!.style.getPropertyValue("--tree-indent")).toBe(folderRow.style.paddingLeft);

    const css = explorerTreeCss();
    expect(css, "no vertical nesting guide is defined").toMatch(/\.tree-dir\[data-open="true"\]::before/);
    expect(css).toMatch(/var\(--tree-indent/);
    expect(css).toMatch(/background:\s*var\(--border-subtle\)/);
    expect(css).toMatch(/\.tree-dir\s*\{[^}]*position:\s*relative/);
  });

  it("hangs a guide off the project root too, not only off deeper folders", async () => {
    // img-003-005 crops exactly one relationship: the project root and the
    // folder living in it. The root row is not rendered by ProjectTree, so it
    // used to be the one open folder in the tree with no `.tree-dir` wrapper -
    // and therefore the one parent-child pair the guide did not mark.
    const root = useProject.getState().rootPath!;
    await useProject.getState().createFolder(root, "Filters");
    const { container } = renderExplorer();

    const rootDir = container.querySelector<HTMLElement>(".tree-project-root-dir");
    expect(rootDir, "the project root has no .tree-dir wrapper to hang a guide from").toBeTruthy();
    expect(rootDir!.classList.contains("tree-dir")).toBe(true);
    expect(rootDir!.getAttribute("data-open")).toBe("true");
    const rootRow = screen.getByRole("button", { name: /Project root/i });
    expect(rootDir!.style.getPropertyValue("--tree-indent")).toBe(rootRow.style.paddingLeft);
    // The wrapper must contain the rows it is annotating, or the guide hangs
    // beside nothing.
    expect(rootDir!.contains(screen.getByRole("button", { name: "Filters" }))).toBe(true);

    // A collapsed root has no children to group; the guide must not draw a stub.
    act(() => { useProject.setState({ expanded: [] }); });
    expect(container.querySelector<HTMLElement>(".tree-project-root-dir")!.getAttribute("data-open")).toBeNull();

    // The root row is 26px + 2px, not the 22px the shared rule assumes.
    const css = explorerTreeCss();
    expect(css).toMatch(/\.tree-project-root-dir\[data-open="true"\]::before\s*\{[^}]*top:\s*28px/);
  });

  it("walks every rendered row and finds its indent exactly one step past its parent's", async () => {
    const root = useProject.getState().rootPath!;
    const analog = await useProject.getState().createFolder(root, "Analog");
    const filters = await useProject.getState().createFolder(analog!, "Filters");
    await useProject.getState().createSchematicFile(filters!, "low-pass.asc");
    await useProject.getState().createSchematicFile(analog!, "mid.asc");
    await useProject.getState().createSchematicFile(root, "gain.asc");
    const { container } = renderExplorer();

    // Depth from the DOM, not from the component: one `.tree-dir` wrapper per
    // level. A folder row sits inside its OWN wrapper, a file row does not, so
    // a file is one level deeper than its ancestor-wrapper count. The project
    // root's wrapper is the exception - it exists to hang the root's guide
    // line, and the row inside it is depth 0, not depth 1.
    const depthOf = (row: Element): number => {
      let wrappers = 0;
      for (let el = row.parentElement; el; el = el.parentElement) {
        if (el.classList.contains("tree-dir") && !el.classList.contains("tree-project-root-dir")) {
          wrappers += 1;
        }
        if (el.classList.contains("tree-list")) break;
      }
      return row.matches(".tree-file") ? wrappers + 1 : wrappers;
    };

    const rows = [...container.querySelectorAll<HTMLElement>(".tree-folder-row, button.tree-file")];
    expect(rows.length).toBe(6); // root, Analog, Filters, low-pass, mid, gain
    const seen = new Map<number, number>();
    for (const row of rows) {
      const depth = depthOf(row);
      const indent = parseFloat(row.style.paddingLeft);
      expect(indent, `${row.textContent?.trim()} at depth ${depth}`).toBe(treeRowIndent(depth));
      const previous = seen.get(depth);
      if (previous !== undefined) expect(indent).toBe(previous); // siblings align
      seen.set(depth, indent);
    }
    const depths = [...seen.keys()].sort((a, b) => a - b);
    expect(depths).toEqual([0, 1, 2, 3]);
    for (let i = 1; i < depths.length; i += 1) {
      expect(seen.get(depths[i])!).toBeGreaterThan(seen.get(depths[i - 1])!);
    }
  });

  it("keeps a file's icon column on the folder's, not 1px off it", () => {
    // `.tree-file` shipped `gap: 5px` while `.tree-folder-row` uses 4px, so even
    // with the caret spacer in place a file's icon would sit 1px right of every
    // folder icon in the tree. Same column, or the ladder reads crooked.
    const css = explorerTreeCss().replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/\.tree-file\s*\{[^}]*gap:\s*4px/);
    expect(css).toMatch(/\.tree-caret-spacer\s*\{[^}]*visibility:\s*hidden/);
  });

  it("keeps the indent arithmetic in one helper rather than a magic number per row", () => {
    // treeRowIndent(0) is the project root row; its children are depth 1.
    expect(treeRowIndent(1) - treeRowIndent(0)).toBe(treeRowIndent(2) - treeRowIndent(1));
    expect(treeRowIndent(1)).toBeGreaterThan(treeRowIndent(0));
  });
});

/**
 * P3-02. `grep -n draggable ShellPanels.tsx` returned nothing: no row set the
 * attribute, so `dragstart` could never fire in a real engine and the whole
 * native protocol - plus App.css's `[draggable="true"]` grab cursor and
 * `-webkit-user-drag: element` - was unreachable. jsdom does not gate dragstart
 * on the attribute, which is exactly why the drag tests above passed against
 * dead code; asserting the attribute string is the only teeth jsdom can give.
 */
describe("P3-02 - rows must actually be draggable", () => {
  it("marks file and folder rows draggable, and leaves the root row a drop target only", async () => {
    const root = useProject.getState().rootPath!;
    await useProject.getState().createSchematicFile(root, "gain.asc");
    await useProject.getState().createFolder(root, "Filters");
    renderExplorer();

    // The literal string, not truthiness: App.css keys the grab cursor and
    // WebKit's -webkit-user-drag on [draggable="true"], and React renders a
    // falsy value as no attribute at all - which would silently re-break both.
    expect(screen.getByRole("button", { name: "gain.asc" }).getAttribute("draggable")).toBe("true");
    expect(screen.getByRole("button", { name: "Filters" }).getAttribute("draggable")).toBe("true");
    // The root row cannot be a source: useProject.moveNode refuses source===root.
    expect(
      screen.getByRole("button", { name: /Project root/i }).getAttribute("draggable"),
    ).not.toBe("true");
  });

  it("still opens a file on click, on Enter, and still opens its context menu while draggable", async () => {
    const root = useProject.getState().rootPath!;
    const path = await useProject.getState().createSchematicFile(root, "gain.asc");
    const { onOpenAscText } = renderExplorer();
    const fileRow = screen.getByRole("button", { name: "gain.asc" });

    // Three gestures now share this element (Radix's context menu, the pointer
    // fallback, and the native drag). Prove the plain ones still land.
    fireEvent.click(fileRow);
    await waitFor(() => expect(onOpenAscText).toHaveBeenCalledWith(path, "gain.asc", expect.any(String)));

    onOpenAscText.mockClear();
    fireEvent.keyDown(fileRow, { key: "Enter" });
    fireEvent.click(fileRow); // the activation a browser synthesises for Enter
    await waitFor(() => expect(onOpenAscText).toHaveBeenCalledWith(path, "gain.asc", expect.any(String)));

    fireEvent.contextMenu(fileRow);
    expect(await screen.findByRole("menuitem", { name: /Rename/ })).toBeTruthy();
  });

  it("does not let a late pointercancel wipe a native drag that has already started", async () => {
    const root = useProject.getState().rootPath!;
    const source = await useProject.getState().createSchematicFile(root, "gain.asc");
    const folder = await useProject.getState().createFolder(root, "Filters");
    const onMoveNode = vi.fn().mockResolvedValue(`${folder}/gain.asc`);
    renderExplorer({ onMoveNode });
    const fileRow = screen.getByRole("button", { name: "gain.asc" });
    const folderRow = screen.getByRole("button", { name: "Filters" });
    const dataTransfer = dataTransferStub();

    // Real ordering hazard: pointerdown takes pointer capture, then the engine
    // decides to start a native drag and delivers pointercancel AFTER
    // dragstart. Unguarded, cancelPointerDrag nulled the drag source mid-drag,
    // after which markDropTarget highlighted targets it had not validated.
    fireEvent.pointerDown(fileRow, { pointerId: 3, button: 0, clientX: 40, clientY: 40 });
    fireEvent.dragStart(fileRow, { dataTransfer });
    fireEvent.pointerCancel(fileRow, { pointerId: 3 });

    expect(fileRow.getAttribute("data-dragging")).toBe("true");
    fireEvent.dragOver(folderRow, { dataTransfer });
    expect(folderRow.getAttribute("data-drop-target")).toBe("true");
    fireEvent.drop(folderRow, { dataTransfer });
    await waitFor(() => expect(onMoveNode).toHaveBeenCalledWith(source, folder));
  });

  it("refuses to highlight an invalid target after a pointercancel, instead of trusting the MIME type alone", async () => {
    const root = useProject.getState().rootPath!;
    const parent = await useProject.getState().createFolder(root, "Parent");
    await useProject.getState().createFolder(parent!, "Child");
    const onMoveNode = vi.fn().mockResolvedValue("unused");
    renderExplorer({ onMoveNode });
    const parentRow = screen.getByRole("button", { name: "Parent" });
    const childRow = screen.getByRole("button", { name: "Child" });
    const dataTransfer = dataTransferStub();

    fireEvent.pointerDown(parentRow, { pointerId: 4, button: 0, clientX: 40, clientY: 40 });
    fireEvent.dragStart(parentRow, { dataTransfer });
    fireEvent.pointerCancel(parentRow, { pointerId: 4 });
    fireEvent.dragOver(childRow, { dataTransfer });

    expect(childRow.getAttribute("data-drop-target")).toBeNull();
    expect(dataTransfer.dropEffect).toBe("none");
    fireEvent.drop(childRow, { dataTransfer });
    expect(onMoveNode).not.toHaveBeenCalled();
  });

  it("refuses a drop onto the row itself and back into the folder it already lives in", async () => {
    const root = useProject.getState().rootPath!;
    const analog = await useProject.getState().createFolder(root, "Analog");
    await useProject.getState().createSchematicFile(analog!, "nested.asc");
    const onMoveNode = vi.fn().mockResolvedValue("unused");
    const { container } = renderExplorer({ onMoveNode });
    const treeList = container.querySelector(".tree-list")!;

    // Onto itself: canMoveProjectNode's source !== destination clause.
    const folderRow = screen.getByRole("button", { name: "Analog" });
    const selfDrop = dataTransferStub();
    fireEvent.dragStart(folderRow, { dataTransfer: selfDrop });
    fireEvent.dragOver(folderRow, { dataTransfer: selfDrop });
    expect(folderRow.getAttribute("data-drop-target")).toBeNull();
    expect(selfDrop.dropEffect).toBe("none");
    fireEvent.drop(folderRow, { dataTransfer: selfDrop });
    fireEvent.dragEnd(folderRow);

    // Into its own parent: a no-op move that would still churn disk and tabs.
    const parentDrop = dataTransferStub();
    const nestedRow = screen.getByRole("button", { name: "nested.asc" });
    fireEvent.dragStart(nestedRow, { dataTransfer: parentDrop });
    fireEvent.dragOver(folderRow, { dataTransfer: parentDrop });
    expect(folderRow.getAttribute("data-drop-target")).toBeNull();
    expect(parentDrop.dropEffect).toBe("none");
    // …and the refusal does not bubble into an ancestor offering the project
    // root instead. Lighting the root here promised a move the row's own onDrop
    // would then refuse.
    expect(treeList.getAttribute("data-drop-target")).toBeNull();
    fireEvent.drop(folderRow, { dataTransfer: parentDrop });

    expect(onMoveNode).not.toHaveBeenCalled();
  });

  it("clears the drop highlight when the cursor leaves a file row", async () => {
    const root = useProject.getState().rootPath!;
    const led = await useProject.getState().createFolder(root, "LED");
    await useProject.getState().createSchematicFile(led!, "led.asc");
    await useProject.getState().createSchematicFile(root, "driver.asc");
    const onMoveNode = vi.fn().mockResolvedValue("unused");
    const { container } = renderExplorer({ onMoveNode });
    const dataTransfer = dataTransferStub();
    const ledDir = container.querySelector<HTMLElement>(`.tree-dir[data-project-dir-path="${led}"]`)!;
    const childRow = screen.getByRole("button", { name: "led.asc" });

    fireEvent.dragStart(screen.getByRole("button", { name: "driver.asc" }), { dataTransfer });
    fireEvent.dragOver(childRow, { dataTransfer });
    expect(ledDir.getAttribute("data-drop-target")).toBe("true");

    // The folder row had an onDragLeave; the file row did not, so the highlight
    // stayed lit on a folder the cursor had already left.
    fireEvent.dragLeave(childRow, { dataTransfer, relatedTarget: document.body });
    expect(ledDir.getAttribute("data-drop-target")).toBeNull();
  });
});

/**
 * P3-04A. "There is ample space to show the settings… we should be able to see
 * them at a smaller window size as long as it has decent space from the text of
 * the folder name it should be able to dynamically adjust."
 *
 * The header was a binary swap keyed on a 280px container query, and the panel
 * ships at 226px - so the shipped default hid all five icons and showed only
 * the ⋯ (evidence img-002-003), while every width above 280px hid the ⋯
 * entirely. jsdom computes no layout, so the contract is pinned on the pixel
 * budget the component derives from the width the panel really renders at, plus
 * the stylesheet text; the ≥8px measured gap is re-proven natively by
 * scripts/pdf3-verify.mjs.
 */
describe("P3-04A - the overflow trigger must survive every width", () => {
  const renderAtWidth = (width: number) => {
    stubExplorerWidth(width);
    return renderExplorer();
  };

  /**
   * Ink width of the default "SCHEMATICS" caption, measured off the evidence
   * shot rather than derived from the constant under test: in
   * screenshots/pdf3-report/img-002-003.png (2x) the caption's lit columns run
   * 22-164, and the ⋯ glyph fixes the scale at 2, so 71 CSS px. An assertion
   * against EXPLORER_ROOT_NAME_MIN itself would be circular; this number comes
   * from outside the code.
   */
  const CAPTION_INK_PX = 71;

  it("always renders the overflow trigger, at the narrowest width and the widest", () => {
    for (const width of [EXPLORER_PANEL_WIDTH.minWidth, 208, 226, EXPLORER_PANEL_WIDTH.maxWidth]) {
      const { unmount } = renderAtWidth(width);
      expect(
        screen.getByRole("button", { name: "More explorer actions" }),
        `the ⋯ trigger is missing at ${width}px`,
      ).toBeTruthy();
      unmount();
    }
  });

  it("keeps the trigger displayed and clear of the root name outside any container query", () => {
    // App.css:5288 sets `display: none` unconditionally and only un-hides the
    // trigger inside `@container explorer-shell (max-width: 280px)`. Neutralise
    // both, at equal specificity, from a later sheet - App.css stays untouched.
    // Comments go first: this file's own prose quotes `@container ... {`, and
    // stripping blocks before comments swallowed the rules under it.
    const unconditional = explorerTreeCss()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/@container[^{]*\{[\s\S]*?\n\}/g, "");
    expect(unconditional).toMatch(/\.explorer-overflow-trigger\s*\{[^}]*display:\s*grid/);
    expect(unconditional).toMatch(/\.explorer-primary-actions\s*\{[^}]*display:\s*flex/);
    // The flex gap alone lands exactly on the 8px bar; the clearance puts it
    // strictly above it in engines that lay the header out on subpixels.
    expect(unconditional).toMatch(/\.explorer-overflow-trigger\s*\{[^}]*margin-left:\s*2px/);
  });

  it("drops primary icons one at a time as the panel narrows, and never below zero", () => {
    const counts = [168, 190, 212, 226, 300, 420].map((w) => explorerPrimaryActionCount(w, 5));
    // Monotonic in width, saturating at the five actions that exist.
    for (let i = 1; i < counts.length; i += 1) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    expect(counts[counts.length - 1]).toBe(5);
    expect(explorerPrimaryActionCount(EXPLORER_PANEL_WIDTH.minWidth, 5)).toBeLessThan(5);
    expect(explorerPrimaryActionCount(EXPLORER_PANEL_WIDTH.minWidth, 5)).toBeGreaterThan(0);
    expect(explorerPrimaryActionCount(40, 5)).toBe(0);
  });

  it("keeps the ⋯ at least 8px clear of the root name at 168, 208, 226 and 420px", () => {
    // The contract's numbers. 208 is the width UI_UX_PDF3.md calls the
    // explorer's minWidth; the real floor is EXPLORER_PANEL_WIDTH.minWidth =
    // 168 (208 is COMPONENTS_RAIL_WIDTH.minWidth), so both are checked.
    for (const width of [EXPLORER_PANEL_WIDTH.minWidth, 208, EXPLORER_PANEL_WIDTH.defaultWidth, EXPLORER_PANEL_WIDTH.maxWidth]) {
      const layout = explorerHeaderLayout(width, 5);
      expect(layout.overflowGap, `⋯ clear of the root name at ${width}px`).toBeGreaterThanOrEqual(8);
      // The root name is the only flexible item, so it absorbing at least its
      // reserve is exactly "the header does not overflow and the ⋯ is not the
      // casualty" - the failure mode img-002-003 shows the other side of.
      expect(layout.rootNameWidth, `root name box at ${width}px`).toBeGreaterThanOrEqual(CAPTION_INK_PX);
      expect(layout.visibleActions, `icons at ${width}px`).toBeGreaterThan(0);
      expect(
        layout.rootNameWidth + layout.visibleActions * 22 + 8 * 2 + 24,
        `header demand at ${width}px`,
      ).toBeLessThanOrEqual(layout.innerWidth);
    }
  });

  it("fails OPEN on an unmeasured width so the action row can never vanish", () => {
    // jsdom has no layout; a width-derived count that returned 0 for an
    // unknown width would hide every header control and take a dozen callers
    // that reach for those buttons by name down with it.
    expect(explorerPrimaryActionCount(Number.NaN, 5)).toBe(5);
    expect(explorerPrimaryActionCount(0, 5)).toBe(5);
    expect(explorerPrimaryActionCount(Number.POSITIVE_INFINITY, 5)).toBe(5);
  });

  it("puts icons back in the shipped-default header without squeezing the caption to an ellipsis", () => {
    // The 'ample space' complaint: at 226px the header used to be a bare
    // `SCHEMATICS ⋯`. It is not, any more - but the fix must not overshoot into
    // the failure on the other side. 226px cannot hold the caption, five 22px
    // icons, the ⋯ and two 8px gaps (18 + 71 + 8 + 110 + 8 + 24 = 239 > 226),
    // so the honest answer at the default is four icons and an intact name; the
    // fifth is one ⋯ click away. Charging the caption only 56px approved all
    // five here and rendered "SCHEMATI…".
    const { container } = renderAtWidth(EXPLORER_PANEL_WIDTH.defaultWidth);
    const shown = [...container.querySelectorAll(".explorer-primary-actions button")]
      .map((b) => b.getAttribute("aria-label"));
    expect(shown.length).toBeGreaterThan(1);
    expect(shown[0]).toBe("New schematic file");
    expect(screen.getByRole("button", { name: "More explorer actions" })).toBeTruthy();

    const layout = explorerHeaderLayout(EXPLORER_PANEL_WIDTH.defaultWidth, 5);
    expect(layout.visibleActions).toBe(shown.length);
    expect(
      layout.rootNameWidth,
      "the SCHEMATICS caption is being truncated to make room for an icon",
    ).toBeGreaterThanOrEqual(CAPTION_INK_PX);
  });

  it("restores the fifth icon as soon as the panel is wide enough to hold it honestly", () => {
    // Progressive, not binary: every icon comes back on its own, and the one
    // that comes back last is the one that left first.
    const { container } = renderAtWidth(WIDTH_WITH_EVERY_ICON);
    /*
     * Compared against the width the panel ACTUALLY laid out at, read off its
     * own inline style, not against the width this test asked for. Those can
     * differ - usePanelWidth clamps and persists - and a hardcoded expectation
     * then reports a width-plumbing surprise as an icon-count bug, which is
     * what happened when the hit size moved from 22px to 28px.
     */
    const panel = container.querySelector(".explorer-panel") as HTMLElement;
    const laidOutWidth = Number.parseFloat(panel.style.width);
    expect(Number.isFinite(laidOutWidth)).toBe(true);
    expect(container.querySelectorAll(".explorer-primary-actions button"))
      .toHaveLength(explorerPrimaryActionCount(laidOutWidth, 5));
    expect(screen.getByRole("button", { name: "More explorer actions" })).toBeTruthy();
    expect(explorerHeaderLayout(laidOutWidth, 5).rootNameWidth)
      .toBeGreaterThanOrEqual(CAPTION_INK_PX);
    /*
     * …and the count grows ONE icon at a time, with the fifth arriving at a
     * single definite width.
     *
     * The threshold is found by scanning the function rather than restated as a
     * literal or re-derived from a copy of its arithmetic. Both of those have now
     * failed once each in this file: the literal was 240, correct only while an
     * icon was 22px, and a hand-rederivation omitted the header's padding and its
     * two flex gaps. What is actually worth asserting is the SHAPE - monotonic,
     * never skipping a step, and exactly one width where 4 becomes 5 - which
     * survives any change to the constants behind it.
     */
    let fifthIconAt = 0;
    let previous = 0;
    for (let width = 100; width <= 600; width += 1) {
      const count = explorerPrimaryActionCount(width, 5);
      expect(count - previous, `count jumped by more than one at ${width}px`).toBeLessThanOrEqual(1);
      expect(count, `count went backwards at ${width}px`).toBeGreaterThanOrEqual(previous);
      if (count === 5 && fifthIconAt === 0) fifthIconAt = width;
      previous = count;
    }
    expect(fifthIconAt, "no width in 100-600px shows all five icons").toBeGreaterThan(0);
    expect(explorerPrimaryActionCount(fifthIconAt - 1, 5)).toBe(4);
    // And the shipped default is deliberately BELOW it - that is the fix for the
    // truncated caption, not an accident.
    expect(EXPLORER_PANEL_WIDTH.defaultWidth).toBeLessThan(fifthIconAt);
  });

  it("keeps every dropped action reachable from the ⋯ menu at the narrowest width", async () => {
    const { container } = renderAtWidth(EXPLORER_PANEL_WIDTH.minWidth);
    const shown = [...container.querySelectorAll(".explorer-primary-actions button")]
      .map((b) => b.getAttribute("aria-label"));
    expect(shown.length).toBeLessThan(5);
    // Least-essential-first: every icon is 22px wide, so the contract's
    // "widest-first" degenerates to a priority order, and New schematic file -
    // the reason the header exists - is the last one standing.
    expect(shown[0]).toBe("New schematic file");
    expect(shown).not.toContain("Collapse folders in explorer");

    fireEvent.pointerDown(screen.getByRole("button", { name: "More explorer actions" }), { button: 0, ctrlKey: false });
    await screen.findByRole("menu");
    for (const label of [
      "New schematic file",
      "New folder",
      "Import circuit",
      "Refresh explorer",
      "Collapse folders in explorer",
    ]) {
      expect(screen.getByRole("menuitem", { name: label }), `${label} is unreachable`).toBeTruthy();
    }
  });
});
