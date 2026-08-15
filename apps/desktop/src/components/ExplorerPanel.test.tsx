// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  EXPLORER_DRAG_AUTO_EXPAND_MS,
  EXPLORER_DRAG_THRESHOLD,
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
const pdf6ExplorerCss = (): string =>
  readFileSync(join(__dirname, "..", "styles", "pdf6Explorer.css"), "utf8");
const appCss = (): string => readFileSync(join(__dirname, "..", "App.css"), "utf8");

/**
 * One declaration out of one rule, read from CSS source text - the house pattern
 * from styles/pdf4Chrome.css.test.ts. jsdom applies no stylesheet, so the
 * cascade cannot be measured here, only the rules that produce it.
 */
const declaration = (css: string, selector: string, property: string): string => {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} is missing from the stylesheet`).toBeGreaterThan(-1);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(body);
  expect(match, `${selector} declares no ${property}`).toBeTruthy();
  return match![1].trim();
};

/**
 * Drive the pointer gesture a hand performs: press the source row, travel past
 * the threshold, cross each waypoint, release on the last one.
 *
 * `fireEvent` dispatches real bubbling events, so the panel's window listeners
 * receive exactly what a browser delivers. Nothing here stubs
 * `document.elementFromPoint`: the destination is resolved from `event.target`,
 * which is why these tests can no longer pass while the shipped app aims at the
 * wrong row - the failure mode that made the old suite green against a feature
 * the reader could not use.
 */
let pointerIdSeed = 0;
const pointerDragFrom = (row: Element) => {
  const pointerId = (pointerIdSeed += 1);
  let x = 20;
  fireEvent.pointerDown(row, { pointerId, button: 0, clientX: x, clientY: 20 });
  // One move past the threshold is what turns the press into a drag.
  x += EXPLORER_DRAG_THRESHOLD + 1;
  fireEvent.pointerMove(row, { pointerId, clientX: x, clientY: 20 });
  return {
    /** The pointer is now over `target`. */
    over(target: Element) {
      x += 4;
      fireEvent.pointerMove(target, { pointerId, clientX: x, clientY: 40 });
    },
    release(target: Element) {
      fireEvent.pointerUp(target, { pointerId, clientX: x, clientY: 40 });
    },
    /** Escape reaches the panel's capture-phase window listener from anywhere. */
    escape() {
      fireEvent.keyDown(document.body, { key: "Escape" });
    },
  };
};

const dragGhost = (): HTMLElement | null => document.querySelector<HTMLElement>(".explorer-drag-ghost");

/** An OS file drag, which is an import rather than a move. `types` is what the
 *  panel keys off, exactly as the browser reports it. */
const fileDragStub = (file: File): DataTransfer => ({
  types: ["Files"],
  files: [file],
  effectAllowed: "all",
  dropEffect: "none",
  setData: vi.fn(),
  getData: vi.fn(() => ""),
} as unknown as DataTransfer);

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
  // Hover-to-expand is the one behaviour here that needs fake timers; leaving
  // them installed would strand every later test's waitFor.
  vi.useRealTimers();
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

  it("creates and opens a Tau schematic from the New File control", async () => {
    /*
     * Re-expected, not repaired. A name typed without an extension used to
     * become `.asc`, and that decided something the reader could not see: an
     * `.asc` can persist neither a sheet interface nor a sheet block's link, so
     * a brand-new sheet was born unable to take part in a hierarchy and only
     * found out much later, at save or Run. It now becomes `.sim`, which keeps
     * every route open. The `.asc` route is still reachable by spelling it, and
     * the case below covers that.
     */
    const { onOpenSimFile } = renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: "New schematic file" }));
    const input = screen.getByRole("textbox", { name: "New schematic name" });
    fireEvent.change(input, { target: { value: "gain-stage" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("gain-stage.sim")).toBeTruthy());
    await waitFor(() => expect(onOpenSimFile).toHaveBeenCalled());
    expect(String(onOpenSimFile.mock.calls[0]?.[0] ?? "")).toMatch(/gain-stage\.sim$/);
  });

  it("still creates a .asc when the name spells one", async () => {
    // The extension remains the reader's to choose; only the DEFAULT moved. An
    // `.asc` also has to keep getting LTspice's own template, not Tau JSON.
    const { onOpenAscText } = renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: "New schematic file" }));
    const input = screen.getByRole("textbox", { name: "New schematic name" });
    fireEvent.change(input, { target: { value: "from-ltspice.asc" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onOpenAscText).toHaveBeenCalledWith(
      expect.stringMatching(/from-ltspice\.asc$/),
      "from-ltspice.asc",
      "Version 4\nSHEET 1 880 680\n",
    ));
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

  it("uses the drag payload when React drag state has not committed yet", async () => {
    const root = useProject.getState().rootPath!;
    const source = await useProject.getState().createSchematicFile(root, "race.asc");
    const folder = await useProject.getState().createFolder(root, "New Destination");
    const onMoveNode = vi.fn().mockResolvedValue(`${folder}/race.asc`);
    renderExplorer({ onMoveNode });
    const dataTransfer = dataTransferStub();
    dataTransfer.setData("application/x-tau-project-node", source!);

    // A drop backed only by dataTransfer reproduces the browser ordering where
    // dragover/drop can precede React's setDraggedNode commit. This is the
    // interop half of the contract - see the PDF6-01 block below for why the
    // rows are no longer native drag sources but these handlers stayed.
    fireEvent.drop(screen.getByRole("button", { name: "New Destination" }), { dataTransfer });

    await waitFor(() => expect(onMoveNode).toHaveBeenCalledWith(source, folder));
  });
});

/**
 * PDF6-01. "In this section the drag and drop is still not functional I cant
 * seem to move .asc files into folders. This needs to be completely resolved."
 * "Since VScode is forked or open source can you copy their drag and drop
 * mechanism?"
 *
 * Two mechanisms used to share these rows and both lost. Tauri v2 defaults
 * `dragDropEnabled` to true, which installs a native drag handler on the
 * WKWebView that swallows HTML5 drag events; the `draggable` row still fired
 * `dragstart`, which made the old code abandon its pointer gesture, and then
 * neither half delivered a drop. And on the one path that did work - a
 * synthesised pointer drag in Chromium - NO drop-target highlight ever appeared,
 * so a reader watching the screen had no reason to believe the feature existed.
 *
 * The whole section is therefore re-expressed on VS Code's model: one pointer
 * gesture, a travel threshold, a ghost label, the nearest enclosing folder as the
 * target, hover-to-expand, Escape to cancel. Every behaviour the old
 * dragStart/dragOver/drop suite asserted is asserted here through that protocol,
 * because that protocol is what a hand now performs.
 */
describe("PDF6-01 - dragging a file into a folder, VS Code style", () => {
  it("disables the Tauri handler that was swallowing the drag events", () => {
    /*
     * The root cause, pinned where it cannot be lost to a merge. Tauri v2's
     * `dragDropEnabled` defaults to TRUE, and on macOS that installs a native
     * drag-and-drop handler on the WKWebView which eats HTML5 drag events before
     * the page sees them. Nothing in this app subscribes to Tauri's own
     * `onDragDropEvent`, so turning it off costs nothing and is the documented
     * remedy; leaving it on is why the shipped app moved nothing while every
     * jsdom test passed.
     */
    const config = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "src-tauri", "tauri.conf.json"), "utf8"),
    );
    expect(config.app.windows[0].dragDropEnabled).toBe(false);
  });

  it("no longer makes a tree row a native drag source", async () => {
    /*
     * Reversed from P3-02 on purpose. That pass added `draggable` because
     * without it `dragstart` can never fire - true, and beside the point: with
     * Tauri's native handler live, a `draggable` row started a drag that could
     * never finish AND starting it aborted the pointer gesture that could have.
     * The literal string is still what is asserted, because App.css keys a grab
     * cursor and `-webkit-user-drag: element` on `[draggable="true"]`; both
     * affordances moved onto the row classes in styles/pdf6Explorer.css rather
     * than being dropped.
     */
    const root = useProject.getState().rootPath!;
    await useProject.getState().createSchematicFile(root, "gain.asc");
    await useProject.getState().createFolder(root, "Filters");
    renderExplorer();

    expect(screen.getByRole("button", { name: "gain.asc" }).getAttribute("draggable")).not.toBe("true");
    expect(screen.getByRole("button", { name: "Filters" }).getAttribute("draggable")).not.toBe("true");
    expect(screen.getByRole("button", { name: /Project root/i }).getAttribute("draggable")).not.toBe("true");

    const css = pdf6ExplorerCss();
    const rows = ".tree-file,\n.tree-folder-row:not(.tree-project-root-row)";
    expect(declaration(css, rows, "cursor")).toBe("grab");
    expect(declaration(css, rows, "user-select")).toBe("none");
  });

  it("moves a file onto a folder, and highlights that folder while the drag is in flight", async () => {
    const root = useProject.getState().rootPath!;
    const source = await useProject.getState().createSchematicFile(root, "gain.asc");
    const folder = await useProject.getState().createFolder(root, "Filters");
    const onMoveNode = vi.fn().mockResolvedValue(`${folder}/gain.asc`);
    const { container, onNotice, onOpenAscText } = renderExplorer({ onMoveNode });
    const fileRow = screen.getByRole("button", { name: "gain.asc" });
    const folderRow = screen.getByRole("button", { name: "Filters" });
    const folderDir = container.querySelector<HTMLElement>(`.tree-dir[data-project-dir-path="${folder}"]`)!;
    const treeList = container.querySelector<HTMLElement>(".tree-list")!;

    expect(fileRow.getAttribute("aria-describedby")).toBe("explorer-drag-help");
    expect(screen.getByText(/Drag a file or folder onto another folder/)).toBeTruthy();

    const drag = pointerDragFrom(fileRow);
    expect(fileRow.getAttribute("data-dragging")).toBe("true");
    expect(fileRow.getAttribute("aria-grabbed")).toBe("true");
    // Not hovered yet, so nothing may claim to be a destination.
    expect(folderRow.getAttribute("data-drop-target")).toBeNull();

    drag.over(folderRow);
    /*
     * THE regression. The move already worked in Chromium and still read as
     * broken because this attribute never appeared: styles/pdf6Explorer.css
     * paints both the row and its `.tree-dir` wrapper off it, so both are
     * asserted, and the tree says which kind of drop is under the pointer.
     */
    expect(folderRow.getAttribute("data-drop-target")).toBe("true");
    expect(folderDir.getAttribute("data-drop-target")).toBe("true");
    expect(treeList.getAttribute("data-explorer-dragging")).toBe("valid");
    // The ghost names what is being carried, and is not marked no-drop.
    expect(dragGhost()?.textContent).toContain("gain.asc");
    expect(dragGhost()?.getAttribute("data-invalid")).toBeNull();
    // …and a reader who cannot see any of that is TOLD where it would land.
    expect(screen.getByRole("status").textContent).toBe("Drop gain.asc into Filters.");

    drag.release(folderRow);
    await waitFor(() => expect(onMoveNode).toHaveBeenCalledWith(source, folder));
    expect(onNotice).toHaveBeenCalledWith("Moved gain.asc");
    // Nothing left lit, nothing left following the cursor.
    expect(folderRow.getAttribute("data-drop-target")).toBeNull();
    expect(treeList.getAttribute("data-explorer-dragging")).toBeNull();
    expect(dragGhost()).toBeNull();
    // The click the browser synthesises from this same press must not also open
    // the file that was just moved.
    fireEvent.click(fileRow);
    expect(onOpenAscText).not.toHaveBeenCalled();
  });

  it("keeps a click a click below the drag threshold", async () => {
    const root = useProject.getState().rootPath!;
    const path = await useProject.getState().createSchematicFile(root, "gain.asc");
    const folder = await useProject.getState().createFolder(root, "Filters");
    const { onOpenAscText } = renderExplorer();
    const fileRow = screen.getByRole("button", { name: "gain.asc" });

    // A hand is never perfectly still. One pixel short of the threshold is a
    // click, not a drag - and a rename double-click depends on the same rule.
    fireEvent.pointerDown(fileRow, { pointerId: 90, button: 0, clientX: 30, clientY: 30 });
    fireEvent.pointerMove(fileRow, { pointerId: 90, clientX: 30 + EXPLORER_DRAG_THRESHOLD - 1, clientY: 30 });
    expect(dragGhost()).toBeNull();
    expect(fileRow.getAttribute("data-dragging")).toBeNull();
    fireEvent.pointerUp(fileRow, { pointerId: 90, clientX: 30 + EXPLORER_DRAG_THRESHOLD - 1, clientY: 30 });
    fireEvent.click(fileRow);
    await waitFor(() => expect(onOpenAscText).toHaveBeenCalledWith(path, "gain.asc", expect.any(String)));

    // The same rule for a folder row, whose click toggles instead of opening.
    const folderRow = screen.getByRole("button", { name: "Filters" });
    const expandedBefore = useProject.getState().expanded.includes(folder!);
    fireEvent.pointerDown(folderRow, { pointerId: 91, button: 0, clientX: 30, clientY: 30 });
    fireEvent.pointerUp(folderRow, { pointerId: 91, clientX: 30, clientY: 30 });
    fireEvent.click(folderRow);
    expect(useProject.getState().expanded.includes(folder!)).toBe(!expandedBefore);
  });

  it("cancels on Escape mid-drag, leaving no move and no lingering highlight", async () => {
    const root = useProject.getState().rootPath!;
    await useProject.getState().createSchematicFile(root, "gain.asc");
    const folder = await useProject.getState().createFolder(root, "Filters");
    const onMoveNode = vi.fn().mockResolvedValue(`${folder}/gain.asc`);
    const { container, onOpenAscText } = renderExplorer({ onMoveNode });
    const fileRow = screen.getByRole("button", { name: "gain.asc" });
    const folderRow = screen.getByRole("button", { name: "Filters" });
    const treeList = container.querySelector<HTMLElement>(".tree-list")!;

    const drag = pointerDragFrom(fileRow);
    drag.over(folderRow);
    expect(folderRow.getAttribute("data-drop-target")).toBe("true");
    expect(dragGhost()).toBeTruthy();

    drag.escape();
    expect(folderRow.getAttribute("data-drop-target")).toBeNull();
    expect(treeList.getAttribute("data-explorer-dragging")).toBeNull();
    expect(dragGhost()).toBeNull();
    expect(fileRow.getAttribute("data-dragging")).toBeNull();

    // The pointer is still down. Neither the release nor the click it
    // synthesises may move the file or open it.
    drag.release(folderRow);
    fireEvent.click(fileRow);
    expect(onMoveNode).not.toHaveBeenCalled();
    expect(onOpenAscText).not.toHaveBeenCalled();
  });

  it("cancels when the pointer is released outside the tree", async () => {
    const root = useProject.getState().rootPath!;
    await useProject.getState().createSchematicFile(root, "gain.asc");
    const folder = await useProject.getState().createFolder(root, "Filters");
    const onMoveNode = vi.fn().mockResolvedValue(`${folder}/gain.asc`);
    renderExplorer({ onMoveNode });
    const fileRow = screen.getByRole("button", { name: "gain.asc" });
    const folderRow = screen.getByRole("button", { name: "Filters" });

    const drag = pointerDragFrom(fileRow);
    drag.over(folderRow);
    expect(folderRow.getAttribute("data-drop-target")).toBe("true");
    // The folder row had a dragLeave for this; a pointer gesture gets it for
    // free, because the destination is whatever is under the pointer NOW.
    drag.over(document.body);
    expect(folderRow.getAttribute("data-drop-target")).toBeNull();
    expect(dragGhost()?.getAttribute("data-invalid")).toBe("true");

    drag.release(document.body);
    expect(onMoveNode).not.toHaveBeenCalled();
    expect(dragGhost()).toBeNull();
  });

  it("opens a collapsed folder the drag hovers, so a nested folder is one gesture", async () => {
    const root = useProject.getState().rootPath!;
    const outer = await useProject.getState().createFolder(root, "Analog");
    const destination = await useProject.getState().createFolder(outer!, "Filters");
    const source = await useProject.getState().createSchematicFile(root, "gain.asc");
    const onMoveNode = vi.fn().mockResolvedValue(`${destination}/gain.asc`);
    // Analog closed: without hover-to-expand, Filters cannot be reached at all
    // without dropping the file somewhere else first.
    act(() => { useProject.setState({ expanded: [root] }); });
    renderExplorer({ onMoveNode });
    expect(screen.queryByRole("button", { name: "Filters" })).toBeNull();

    vi.useFakeTimers();
    const drag = pointerDragFrom(screen.getByRole("button", { name: "gain.asc" }));
    drag.over(screen.getByRole("button", { name: "Analog" }));
    // Not instant: a folder merely crossed on the way somewhere else must not
    // flap open under the cursor.
    expect(screen.queryByRole("button", { name: "Filters" })).toBeNull();
    act(() => { vi.advanceTimersByTime(EXPLORER_DRAG_AUTO_EXPAND_MS); });

    const nestedRow = screen.getByRole("button", { name: "Filters" });
    drag.over(nestedRow);
    expect(nestedRow.getAttribute("data-drop-target")).toBe("true");
    drag.release(nestedRow);
    expect(onMoveNode).toHaveBeenCalledWith(source, destination);
  });

  it("supports moving a nested explorer item back to the project root", async () => {
    const root = useProject.getState().rootPath!;
    const folder = await useProject.getState().createFolder(root, "Filters");
    const source = await useProject.getState().createSchematicFile(folder!, "nested.asc");
    const onMoveNode = vi.fn().mockResolvedValue(`${root}/nested.asc`);
    renderExplorer({ onMoveNode });
    const rootTarget = screen.getByRole("button", {
      name: /Project root .+; drop files or folders here/i,
    });

    const drag = pointerDragFrom(screen.getByRole("button", { name: "nested.asc" }));
    drag.over(rootTarget);
    expect(rootTarget.getAttribute("data-drop-target")).toBe("true");
    drag.release(rootTarget);

    await waitFor(() => expect(onMoveNode).toHaveBeenCalledWith(source, root));
  });

  it("moves a root file into a nested folder", async () => {
    const root = useProject.getState().rootPath!;
    const parent = await useProject.getState().createFolder(root, "Analog");
    const destination = await useProject.getState().createFolder(parent!, "Filters");
    const source = await useProject.getState().createSchematicFile(root, "root-filter.asc");
    const onMoveNode = vi.fn().mockResolvedValue(`${destination}/root-filter.asc`);
    renderExplorer({ onMoveNode });

    const drag = pointerDragFrom(screen.getByRole("button", { name: "root-filter.asc" }));
    const nested = screen.getByRole("button", { name: "Filters" });
    drag.over(nested);
    drag.release(nested);

    await waitFor(() => expect(onMoveNode).toHaveBeenCalledWith(source, destination));
  });

  it("treats a release over a file inside an expanded folder as a drop on that folder", async () => {
    const root = useProject.getState().rootPath!;
    const led = await useProject.getState().createFolder(root, "LED");
    await useProject.getState().createSchematicFile(led!, "led.asc");
    const source = await useProject.getState().createSchematicFile(root, "driver.asc");
    const onMoveNode = vi.fn().mockResolvedValue(`${led}/driver.asc`);
    const { container } = renderExplorer({ onMoveNode });
    const ledDir = container.querySelector<HTMLElement>(`.tree-dir[data-project-dir-path="${led}"]`)!;

    const drag = pointerDragFrom(screen.getByRole("button", { name: "driver.asc" }));
    // Readers commonly release over the child file row under an expanded LED/.
    const childRow = screen.getByRole("button", { name: "led.asc" });
    drag.over(childRow);
    // The child row is not a destination; the folder that owns it is, and that is
    // what has to look like the target.
    expect(childRow.getAttribute("data-drop-target")).toBeNull();
    expect(ledDir.getAttribute("data-drop-target")).toBe("true");
    drag.release(childRow);

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

    const drag = pointerDragFrom(screen.getByRole("button", { name: "Filters" }));
    const archive = screen.getByRole("button", { name: "Archive" });
    drag.over(archive);
    expect(archive.getAttribute("data-drop-target")).toBe("true");
    drag.release(archive);

    await waitFor(() => expect(onMoveNode).toHaveBeenCalledWith(movingFolder, destination));
  });

  it("refuses to highlight or move a folder into its own descendant", async () => {
    const root = useProject.getState().rootPath!;
    const parent = await useProject.getState().createFolder(root, "Parent");
    await useProject.getState().createFolder(parent!, "Child");
    const onMoveNode = vi.fn().mockResolvedValue("unused");
    const { container } = renderExplorer({ onMoveNode });
    const treeList = container.querySelector<HTMLElement>(".tree-list")!;
    const childRow = screen.getByRole("button", { name: "Child" });

    const drag = pointerDragFrom(screen.getByRole("button", { name: "Parent" }));
    drag.over(childRow);
    expect(childRow.getAttribute("data-drop-target")).toBeNull();
    // An illegal target is not merely un-highlighted, it says no: the tree wears
    // the no-drop cursor and the ghost is marked.
    expect(treeList.getAttribute("data-explorer-dragging")).toBe("invalid");
    expect(dragGhost()?.getAttribute("data-invalid")).toBe("true");
    expect(screen.getByRole("status").textContent).toMatch(/^Moving Parent\. No folder under the pointer/);
    drag.release(childRow);

    expect(onMoveNode).not.toHaveBeenCalled();
  });

  it("refuses a drop onto the row itself and back into the folder it already lives in", async () => {
    const root = useProject.getState().rootPath!;
    const analog = await useProject.getState().createFolder(root, "Analog");
    await useProject.getState().createSchematicFile(analog!, "nested.asc");
    const onMoveNode = vi.fn().mockResolvedValue("unused");
    const { container } = renderExplorer({ onMoveNode });
    const treeList = container.querySelector<HTMLElement>(".tree-list")!;
    const folderRow = screen.getByRole("button", { name: "Analog" });

    // Onto itself: canMoveProjectNode's source !== destination clause.
    const selfDrag = pointerDragFrom(folderRow);
    selfDrag.over(folderRow);
    expect(folderRow.getAttribute("data-drop-target")).toBeNull();
    selfDrag.release(folderRow);

    // Into its own parent: a no-op move that would still churn disk and tabs.
    const parentDrag = pointerDragFrom(screen.getByRole("button", { name: "nested.asc" }));
    parentDrag.over(folderRow);
    expect(folderRow.getAttribute("data-drop-target")).toBeNull();
    // …and the refusal does not fall back to an ancestor offering the project
    // root instead. Lighting the root here would promise a move that the drop
    // then refuses - which is what the bubbling native handler used to do.
    expect(treeList.getAttribute("data-drop-target")).toBeNull();
    parentDrag.release(folderRow);

    expect(onMoveNode).not.toHaveBeenCalled();
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

    const drag = pointerDragFrom(screen.getByRole("button", { name: "blocked.asc" }));
    const destination = screen.getByRole("button", { name: "Destination" });
    drag.over(destination);
    drag.release(destination);

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("A file named blocked.asc already exists in Destination."));
    expect(screen.getByRole("alert").textContent).toContain("already exists");
  });

  it("explains the missing persistence capability instead of faking a move", async () => {
    const root = useProject.getState().rootPath!;
    await useProject.getState().createSchematicFile(root, "gain.asc");
    await useProject.getState().createFolder(root, "Filters");
    const { onNotice } = renderExplorer();

    const drag = pointerDragFrom(screen.getByRole("button", { name: "gain.asc" }));
    const folderRow = screen.getByRole("button", { name: "Filters" });
    drag.over(folderRow);
    drag.release(folderRow);

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("Moving explorer items needs a project move action."));
  });

  it("imports a file dropped onto the tree from the Finder", async () => {
    /*
     * The other half of "drag and drop does not work here". App.tsx has had an
     * import drop zone on `.editor-shell` for a while; the tree - the surface
     * that looks like where files live - had none, so a drop from Finder onto the
     * explorer did nothing at all. It also could not have worked while Tauri's
     * native handler was on. This is an IMPORT: it must not light a move target,
     * and it must survive being released over a folder row, which used to
     * stopPropagation on every drop.
     */
    const { onOpenAscText, container } = renderExplorer();
    const source = "Version 4\nSHEET 1 880 680\n";
    const bytes = new TextEncoder().encode(source);
    const file = { name: "from-finder.asc", arrayBuffer: async () => bytes.buffer } as File;
    const treeList = container.querySelector<HTMLElement>(".tree-list")!;
    const dataTransfer = fileDragStub(file);

    fireEvent.dragOver(treeList, { dataTransfer });
    // Without preventDefault on dragover the browser never fires `drop` at all.
    expect(dataTransfer.dropEffect).toBe("copy");
    expect(treeList.getAttribute("data-drop-target")).toBeNull();
    fireEvent.drop(treeList, { dataTransfer });

    await waitFor(() => expect(onOpenAscText).toHaveBeenCalledWith(
      expect.stringMatching(/from-finder\.asc$/),
      "from-finder.asc",
      source,
    ));
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
 * The interop half of PDF6-01.
 *
 * No row is a native drag source any more, but the HTML5 drop handlers stayed:
 * a host that synthesises the protocol still performs a move (Playwright's
 * `dragTo`, and App.workspace.test.tsx's "the open tab follows its file" case,
 * which drives dragStart/dragOver/drop through the real App), and `dataTransfer`
 * is still where a drop reads its source when React state has not committed.
 * These cases guard the seam between the two mechanisms - chiefly that starting
 * a synthesised native drag hands the pointer gesture over cleanly, so a
 * `pointercancel` arriving afterwards (engine-dependent ordering) cannot tear
 * down a drag that is still in flight.
 */
describe("PDF6-01 interop - a synthesised HTML5 drag still moves a node", () => {
  it("still opens a file on click, on Enter, and still opens its context menu", async () => {
    const root = useProject.getState().rootPath!;
    const path = await useProject.getState().createSchematicFile(root, "gain.asc");
    const { onOpenAscText } = renderExplorer();
    const fileRow = screen.getByRole("button", { name: "gain.asc" });

    // Three gestures share this element (Radix's context menu, the pointer drag,
    // and keyboard activation). Prove the plain ones still land.
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

    // Real ordering hazard: pointerdown starts a pointer gesture, then the host
    // starts a native drag and delivers pointercancel AFTER dragstart. It used to
    // null the drag source mid-drag, after which markDropTarget highlighted
    // targets it had not validated. `beginNodeDrag` now takes the gesture's
    // window listeners down with it, so there is nothing left to hear the cancel.
    fireEvent.pointerDown(fileRow, { pointerId: 3, button: 0, clientX: 40, clientY: 40 });
    fireEvent.dragStart(fileRow, { dataTransfer });
    fireEvent.pointerCancel(fileRow, { pointerId: 3 });

    expect(fileRow.getAttribute("data-dragging")).toBe("true");
    fireEvent.dragOver(folderRow, { dataTransfer });
    expect(folderRow.getAttribute("data-drop-target")).toBe("true");
    expect(dataTransfer.dropEffect).toBe("move");
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

/**
 * PDF6-02. "These options need to be closer together theyre too far apart. THey
 * should be close like VSCODE."
 *
 * The number the complaint is about is the distance between two adjacent GLYPHS,
 * not between two button boxes: App.css sized `.explorer-icons button` at
 * `--control-hit` (28px) with `gap: 0` around a 16px glyph, so 12px of empty box
 * sat between every pair of icons and the five of them read as five unrelated
 * controls. VS Code's pane-header actions are 22px boxes 2px apart, i.e. 8px
 * between glyph edges.
 *
 * jsdom applies no stylesheet, so the box comes from the rule this lane owns and
 * the glyph from the rendered SVG; the arithmetic between them is what the eye
 * actually reads.
 */
describe("PDF6-02 - the explorer header actions must read as one group", () => {
  it("puts the action glyphs VS Code-close without dropping a hit target below 24px", () => {
    const css = pdf6ExplorerCss();
    const gap = Number.parseFloat(declaration(css, ".explorer-icons", "gap"));
    expect(gap).toBe(0);

    // The box is a token, not a literal, so the WCAG floor and the box claiming
    // to sit on it cannot drift apart in two files.
    const boxSelector = ".explorer-icons button,\n.explorer-overflow-trigger";
    expect(declaration(css, boxSelector, "width")).toBe("var(--control-hit-compact)");
    expect(declaration(css, boxSelector, "height")).toBe("var(--control-hit-compact)");
    const boxMatch = /--control-hit-compact:\s*(\d+(?:\.\d+)?)px/.exec(appCss());
    expect(boxMatch, "App.css no longer defines --control-hit-compact").toBeTruthy();
    const box = Number.parseFloat(boxMatch![1]);

    // The glyph, off the rendered DOM rather than a second copy of the number.
    const { container } = renderExplorer();
    const button = container.querySelector<HTMLElement>(".explorer-primary-actions button")!;
    const glyph = Number.parseFloat(button.querySelector("svg")!.getAttribute("width")!);
    expect(glyph).toBe(16);

    const betweenGlyphEdges = box - glyph + gap;
    expect(betweenGlyphEdges, "header glyphs sit further apart than VS Code's").toBeLessThanOrEqual(8);
    // The shipped value this replaces. Stated so a future widening cannot quietly
    // restore the complaint while still satisfying the bar above.
    expect(betweenGlyphEdges).toBeLessThan(12);
    expect(box, "a header action is under WCAG 2.2 SC 2.5.8's 24px floor").toBeGreaterThanOrEqual(24);
  });

  it("keeps EXPLORER_ICON_SIZE mirroring the stylesheet, or the overflow menu mis-counts", () => {
    /*
     * The budget that decides how many icons render is computed from a constant
     * in ShellPanels.tsx that mirrors the CSS box. It is private, so it is
     * RECOVERED from the exported layout rather than restated: two widths whose
     * icon counts differ share the same header gaps and the same overflow
     * clearance, so those cancel in the difference and the box is what is left.
     */
    const boxMatch = /--control-hit-compact:\s*(\d+(?:\.\d+)?)px/.exec(appCss())!;
    const box = Number.parseFloat(boxMatch[1]);

    const wide = explorerHeaderLayout(EXPLORER_PANEL_WIDTH.maxWidth, 5);
    const narrow = explorerHeaderLayout(EXPLORER_PANEL_WIDTH.minWidth, 5);
    expect(narrow.visibleActions, "the narrow case must still show an icon").toBeGreaterThan(0);
    expect(wide.visibleActions).toBeGreaterThan(narrow.visibleActions);

    const mirrored = (wide.overflowGap - narrow.overflowGap) / (wide.visibleActions - narrow.visibleActions);
    expect(mirrored, "EXPLORER_ICON_SIZE no longer mirrors the stylesheet's box").toBe(box);
  });
});
