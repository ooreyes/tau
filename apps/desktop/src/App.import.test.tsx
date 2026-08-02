// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same isolation pattern App.workspace.test.tsx uses: keep the assistant's
// local-AI onboarding and its polling out of these import/drag-and-drop tests.
vi.mock("./lib/localAiRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/localAiRuntime")>()),
  isNativeDesktopApp: async () => false,
  getLocalAiStatus: async () => ({
    state: "ready" as const,
    endpoint: "http://127.0.0.1:8080/v1" as const,
    managed: true,
    installed: true,
    modelId: null,
    modelRepository: null,
    detail: "Local inference is ready.",
    presets: [],
  }),
}));

import App from "./App";
import { useProject } from "./store/useProject";
import { useSchematic } from "./store/useSchematic";

const defaultRenameNode = useProject.getState().renameNode;
const originalEnsureDefaultWorkspace = useProject.getState().ensureDefaultWorkspace;

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, String(value)),
    removeItem: (key: string) => void storage.delete(key),
    clear: () => storage.clear(),
  },
});
class TestResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target, contentRect: { width: 1440, height: 600 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: TestResizeObserver });

function fileFrom(name: string, text: string): File {
  const bytes = new TextEncoder().encode(text);
  return { name, arrayBuffer: async () => bytes.buffer } as File;
}

/** Enough of a real DataTransfer for `isFileDrag`'s `types` check and the
 *  drop handler's `files` read - jsdom does not implement DataTransfer itself. */
function fileDataTransfer(file?: File) {
  return {
    types: ["Files"],
    files: file ? [file] : [],
    dropEffect: "none",
  } as unknown as DataTransfer;
}

beforeEach(() => {
  storage.clear();
  useSchematic.getState().newCircuit();
  useSchematic.setState({ userModelLibraries: [] });
  useProject.setState({
    rootPath: null,
    rootName: null,
    tree: [],
    expanded: [],
    workspaceFiles: {},
    error: null,
    capability: "none",
    renameNode: defaultRenameNode,
    ensureDefaultWorkspace: originalEnsureDefaultWorkspace,
  });
});
afterEach(() => cleanup());

describe("App - unified import surface", () => {
  it("imports a .asc from the no-project empty state's Import action", async () => {
    render(<App />);
    // Both the Explorer header and the empty state offer this action by design,
    // so scope to the empty state rather than matching app-wide.
    const emptyState = await screen.findByRole("region", { name: "Project start" });
    expect(within(emptyState).getByRole("button", { name: "Import circuit" })).toBeTruthy();

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const source = "Version 4\nSHEET 1 880 680\n";
    fireEvent.change(input, { target: { files: [fileFrom("preamp.asc", source)] } });

    await screen.findByRole("tab", { name: /preamp\.asc/ });
    expect(useProject.getState().rootPath).not.toBeNull();
  });

  it("refuses a partial run when a freshly imported .asc skipped an electrical symbol", async () => {
    render(<App />);
    const emptyState = await screen.findByRole("region", { name: "Project start" });
    const input = within(emptyState).getByTitle("Import circuit") as HTMLInputElement;
    const source = `Version 4
SHEET 1 880 680
SYMBOL deadtime 336 -304 R0
SYMATTR InstName X1
TEXT 0 0 Left 2 !.tran 1m
`;
    fireEvent.change(input, { target: { files: [fileFrom("class-d.asc", source)] } });

    await screen.findByRole("tab", { name: /class-d\.asc/ });
    fireEvent.click(screen.getAllByRole("button", { name: "Run simulation" })[0]);

    expect((await screen.findAllByText(
      /Simulation refused: X1 \(deadtime\).*No approximate or partial circuit was run/,
    )).length).toBeGreaterThan(0);
  });

  it("shows a drop-target state while dragging a file over the editor, and imports it on drop", async () => {
    render(<App />);
    const dropZone = await screen.findByRole("region", { name: "Project start" });

    fireEvent.dragEnter(dropZone, { dataTransfer: fileDataTransfer() });
    expect(await screen.findByText("Drop to import")).toBeTruthy();

    const source = "Version 4\nSHEET 1 880 680\n";
    fireEvent.drop(dropZone, { dataTransfer: fileDataTransfer(fileFrom("dropped.asc", source)) });

    await screen.findByRole("tab", { name: /dropped\.asc/ });
    expect(screen.queryByText("Drop to import")).toBeNull();
  });

  it("hides the drop-target overlay again on drag leave without importing anything", async () => {
    render(<App />);
    const dropZone = await screen.findByRole("region", { name: "Project start" });

    fireEvent.dragEnter(dropZone, { dataTransfer: fileDataTransfer() });
    expect(await screen.findByText("Drop to import")).toBeTruthy();

    fireEvent.dragLeave(dropZone, { dataTransfer: fileDataTransfer() });
    await waitFor(() => expect(screen.queryByText("Drop to import")).toBeNull());
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("converts a dropped SPICE netlist and surfaces its per-part warning in Diagnostics", async () => {
    render(<App />);
    const dropZone = await screen.findByRole("region", { name: "Project start" });

    const source = "* t\nR1 a 0 1k\nX1 a b mysub\n.end\n";
    fireEvent.drop(dropZone, { dataTransfer: fileDataTransfer(fileFrom("board.cir", source)) });

    await screen.findByRole("tab", { name: /board\.asc/ });
    // Diagnostics auto-expands on new issues (ShellPanels' issueSignature
    // effect), so the warning is already on screen - clicking the header here
    // would collapse it, not reveal it.
    expect(await screen.findByText(/X1: subcircuit instance not imported/)).toBeTruthy();
  });

  it("refuses a file it does not recognize instead of silently doing nothing", async () => {
    render(<App />);
    const dropZone = await screen.findByRole("region", { name: "Project start" });

    fireEvent.drop(dropZone, { dataTransfer: fileDataTransfer(fileFrom("photo.png", "hello")) });

    expect(await screen.findByText(/does not recognize/)).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
  });
});
