// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Forces the real useProject store's ensureDefaultWorkspace (see
// ExplorerPanel's mount effect in ShellPanels.tsx) to leave rootPath alone
// instead of seeding its in-memory browser fallback — the assistant
// scratchpad-fallback tests below need a genuine "no Schematics folder open"
// precondition, which normally only happens on the real desktop app before
// the user picks a folder (capability !== "none").
vi.mock("./project/fsBridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./project/fsBridge")>()),
  detectFsCapability: async () => "tauri" as const,
}));

// Keeps the assistant's proactive local-AI onboarding card (and the
// app-global LocalAiSetupDialog, which polls the same module) out of these
// layout/creation-flow tests — both are covered by their own component tests.
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
import {
  createConversation,
  saveConversationMessages,
  setActiveConversationId,
} from "./lib/assistantMemory";
import { DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME } from "./project/defaultWorkspace";
import { useProject } from "./store/useProject";
import { useSchematic } from "./store/useSchematic";

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
    this.callback([{ target, contentRect: { width: shellWidth, height: 600 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: TestResizeObserver });

let shellWidth = 1440;
beforeEach(() => {
  shellWidth = 1440;
  storage.clear();
  storage.set("tau.assistant.open", "1");
  useProject.setState({
    rootPath: null,
    rootName: null,
    tree: [],
    expanded: [],
    workspaceFiles: {},
    error: null,
    capability: "tauri",
    renameNode: defaultRenameNode,
  });
});
afterEach(() => cleanup());

async function renderOpenProject() {
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
  await screen.findByRole("tab", { name: /untitled\.asc/ });
}

describe("App schematic workspace tools", () => {
  it("keeps Components and Assistant as simultaneous independently resizable columns", async () => {
    await renderOpenProject();

    expect(screen.getByRole("complementary", { name: "Components" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize properties panel" })).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize assistant panel" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Workspace tools" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(screen.getByRole("complementary", { name: "Components" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Assistant" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Tauri" }));
    expect(screen.getByRole("complementary", { name: "Components" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy();
  });

  it("keeps AI and Components together at 900px, yielding Explorer until explicitly requested", async () => {
    shellWidth = 900;
    await renderOpenProject();

    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Components" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Project explorer" })).toBeNull();
    expect(screen.getAllByRole("separator")).toHaveLength(2); // Components + Assistant.

    fireEvent.click(screen.getByRole("button", { name: "Explorer" }));
    expect(screen.getByRole("complementary", { name: "Project explorer" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Components" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Components" }));
    expect(screen.getByRole("complementary", { name: "Components" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Project explorer" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(screen.queryByRole("complementary", { name: "Assistant" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Components" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Project explorer" })).toBeTruthy();
  });

  it("uses the same independent Assistant column in simulator mode", async () => {
    await renderOpenProject();
    fireEvent.click(screen.getByRole("button", { name: "Simulator" }));

    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize assistant panel" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Components" })).toBeNull();
  });

  it("explains the simulator is view-only when an edit shortcut is attempted", async () => {
    await renderOpenProject();
    act(() => useSchematic.getState().addComponent("resistor", 120, 120));
    const before = useSchematic.getState().components.length;
    fireEvent.click(screen.getByRole("button", { name: "Simulator" }));

    fireEvent.keyDown(document.body, { key: "Delete" });

    expect(screen.getByText("Simulator is view only. Return to Schematic to edit.")).toBeTruthy();
    expect(useSchematic.getState().components).toHaveLength(before);
  });

  it("keeps the assistant transcript mounted across Schematic ↔ Simulator switches", async () => {
    const id = createConversation();
    saveConversationMessages(`${DEFAULT_WORKSPACE_ID}/untitled.asc`, id, [
      { role: "user", content: "What does R1 do?" },
      { role: "assistant", content: "R1 sets the gain." },
    ]);
    setActiveConversationId(`${DEFAULT_WORKSPACE_ID}/untitled.asc`, id);

    await renderOpenProject();
    expect(screen.getByText("What does R1 do?")).toBeTruthy();
    expect(screen.getByText("R1 sets the gain.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Simulator" }));
    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy();
    expect(screen.getByText("What does R1 do?")).toBeTruthy();
    expect(screen.getByText("R1 sets the gain.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Schematic" }));
    expect(screen.getByText("What does R1 do?")).toBeTruthy();
    expect(screen.getByText("R1 sets the gain.")).toBeTruthy();
  });

  it("shows an unsaved dot after an edit and clears it after Save", async () => {
    await renderOpenProject();

    act(() => useSchematic.getState().addComponent("resistor", 120, 120));
    expect(await screen.findByRole("img", { name: "untitled.asc has unsaved changes" })).toBeTruthy();
    expect(screen.getByText("untitled.asc •")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "s", metaKey: true });
    await waitFor(() => {
      expect(screen.queryByRole("img", { name: "untitled.asc has unsaved changes" })).toBeNull();
      expect(screen.getAllByText("untitled.asc").length).toBeGreaterThan(0);
    });
  });

  it("automatically saves a lossless multi-segment ASC wire before Run", async () => {
    await renderOpenProject();
    const path = `${DEFAULT_WORKSPACE_ID}/untitled.asc`;
    act(() => useSchematic.getState().addWire([
      { x: 64, y: 64 },
      { x: 128, y: 64 },
      { x: 128, y: 128 },
    ]));

    fireEvent.click(screen.getAllByRole("button", { name: "Run simulation" })[0]);

    await waitFor(() => {
      const contents = useProject.getState().workspaceFiles[path].contents;
      expect(contents.match(/^WIRE /gm)).toHaveLength(2);
    });
    expect(screen.queryByText(/Save blocked/)).toBeNull();
    expect(screen.queryByRole("img", { name: "untitled.asc has unsaved changes" })).toBeNull();
  });

  it("saves an AC voltage source without the former vac export blocker", async () => {
    await renderOpenProject();
    const path = `${DEFAULT_WORKSPACE_ID}/untitled.asc`;
    act(() => useSchematic.getState().addComponent("vac", 160, 160));

    fireEvent.keyDown(document.body, { key: "s", metaKey: true });

    await waitFor(() => {
      const contents = useProject.getState().workspaceFiles[path].contents;
      expect(contents).toContain("SYMATTR TauKind vac");
      expect(contents).toContain("SINE(0 1 1k) AC 1");
    });
    expect(screen.queryByText(/Save blocked/)).toBeNull();
    expect(screen.queryByRole("img", { name: "untitled.asc has unsaved changes" })).toBeNull();
  });

  it("renames an open tab on disk and saves later edits only to the renamed path", async () => {
    let releaseRename!: () => void;
    const renameGate = new Promise<void>((resolve) => { releaseRename = resolve; });
    useProject.setState({
      renameNode: async (...args) => {
        await renameGate;
        return defaultRenameNode(...args);
      },
    });
    await renderOpenProject();
    const originalPath = `${DEFAULT_WORKSPACE_ID}/untitled.asc`;
    const renamedPath = `${DEFAULT_WORKSPACE_ID}/gain-stage.asc`;
    const tab = screen.getByRole("tab", { name: /untitled\.asc/ });

    fireEvent.doubleClick(tab);
    const renameInput = await screen.findByRole("textbox", { name: "Rename untitled.asc" });
    fireEvent.change(renameInput, { target: { value: "gain-stage" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });
    // Exercise the real race: Save arrives while the async native rename is
    // still pending. It must wait and then target only the new path.
    act(() => {
      useSchematic.getState().addComponent("resistor", 120, 120);
      useSchematic.getState().setProbes([{ id: "probe-1", x: 120, y: 120, color: "#53d6b5" }]);
    });
    fireEvent.keyDown(document.body, { key: "s", metaKey: true });
    expect(useProject.getState().workspaceFiles[originalPath].contents).not.toContain("SYMBOL res");
    await act(async () => releaseRename());

    await waitFor(() => expect(screen.getByRole("tab", { name: /gain-stage\.asc/ })).toBeTruthy());
    await waitFor(() => expect(useProject.getState().workspaceFiles[renamedPath].contents).toContain("SYMBOL res"));
    expect(useProject.getState().workspaceFiles[originalPath]).toBeUndefined();
    expect(screen.queryByText(/Save blocked/)).toBeNull();
  });
});

describe("App project-folder gate", () => {
  it("requires a project before exposing schematic editing or Tauri", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Open a project folder" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open folder" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create project" })).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Components" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Assistant" })).toBeNull();
  });

  it("does not let the toolbar bypass the project gate", () => {
    render(<App />);
    for (const name of ["Close Tauri", "Run simulation", "Simulator", "Components", "Waveforms"]) {
      expect(screen.getByRole("button", { name }).hasAttribute("disabled")).toBe(true);
    }
    expect(screen.queryByRole("complementary", { name: "Assistant" })).toBeNull();
  });
});
