// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { canvasModuleLoaded } = vi.hoisted(() => ({ canvasModuleLoaded: vi.fn() }));

// A lazy import invokes this factory only when React renders the canvas
// element. Keeping the mock in this isolated App-level contract lets us prove
// the project-start screen does not request the editor payload at all.
vi.mock("./components/Canvas", () => {
  canvasModuleLoaded();
  return { Canvas: () => <svg data-testid="lazy-canvas" /> };
});

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
import { DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME } from "./project/defaultWorkspace";
import { useProject } from "./store/useProject";
import { useSchematic } from "./store/useSchematic";

const originalEnsureDefaultWorkspace = useProject.getState().ensureDefaultWorkspace;
const defaultRenameNode = useProject.getState().renameNode;
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
    this.callback([{ target, contentRect: { width: 1440, height: 800 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: TestResizeObserver });

beforeEach(() => {
  storage.clear();
  canvasModuleLoaded.mockClear();
  useSchematic.getState().newCircuit();
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

describe("App lazy Canvas boundary", () => {
  it("does not request the schematic renderer on the project-start screen", async () => {
    render(<App />);

    await screen.findByRole("region", { name: "Project start" });
    expect(canvasModuleLoaded).not.toHaveBeenCalled();
  });

  it("loads the renderer once a user creates a schematic and preserves the canvas landmark", async () => {
    useProject.setState({
      rootPath: DEFAULT_WORKSPACE_ID,
      rootName: DEFAULT_WORKSPACE_NAME,
      tree: [],
      expanded: [DEFAULT_WORKSPACE_ID],
      workspaceFiles: {},
      error: null,
      capability: "none",
    });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "New schematic" }));
    await screen.findByTestId("lazy-canvas");
    expect(canvasModuleLoaded).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("main", { name: "Schematic canvas" })).toBeTruthy();
  });
});
