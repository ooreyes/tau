// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Forces the real useProject store's ensureDefaultWorkspace (see
// ExplorerPanel's mount effect in ShellPanels.tsx) to leave rootPath alone
// instead of seeding its in-memory browser fallback - the assistant
// scratchpad-fallback tests below need a genuine "no Schematics folder open"
// precondition, which normally only happens on the real desktop app before
// the user picks a folder (capability !== "none").
vi.mock("./project/fsBridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./project/fsBridge")>()),
  detectFsCapability: async () => "tauri" as const,
}));

// Keeps the assistant's proactive local-AI onboarding card (and the
// app-global LocalAiSetupDialog, which polls the same module) out of these
// layout/creation-flow tests - both are covered by their own component tests.
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

import App, { schematicDocumentSignature } from "./App";
import {
  createConversation,
  saveConversationMessages,
  setActiveConversationId,
} from "./lib/assistantMemory";
import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  defaultWorkspaceTree,
} from "./project/defaultWorkspace";
import { useProject } from "./store/useProject";
import { useSchematic } from "./store/useSchematic";

const defaultRenameNode = useProject.getState().renameNode;

describe("schematicDocumentSignature", () => {
  it("ignores regenerated internal ids while retaining semantic edits", () => {
    const first = {
      components: [{ id: "r-old", kind: "resistor" as const, x: 96, y: 0, rotation: 0 as const, value: "1k", label: "R1" }],
      wires: [{ id: "w-old", points: [{ x: 64, y: 0 }, { x: 128, y: 0 }] }],
      probes: [{ id: "p-old", x: 96, y: 0, color: "var(--trace-red)", componentId: "r-old" }],
      netLabels: [{ id: "n-old", x: 64, y: 0, text: "OUT" }],
      directives: [".op"],
    };
    const reloaded = {
      ...first,
      components: [{ ...first.components[0], id: "r-new" }],
      wires: [{ ...first.wires[0], id: "w-new" }],
      probes: [{ ...first.probes[0], id: "p-new", componentId: "r-new" }],
      netLabels: [{ ...first.netLabels[0], id: "n-new" }],
    };

    expect(schematicDocumentSignature(reloaded)).toBe(schematicDocumentSignature(first));
    expect(schematicDocumentSignature({
      ...reloaded,
      components: [{ ...reloaded.components[0], value: "2k" }],
    })).not.toBe(schematicDocumentSignature(first));
  });
});

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
  useSchematic.getState().newCircuit();
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

    fireEvent.click(screen.getByRole("button", { name: "Open Bode" }));
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

  it("uses an imported .tran card instead of auto-resolution until manually overridden", async () => {
    await renderOpenProject();
    act(() => useSchematic.setState({ directives: [".tran 500µ startup"] }));

    fireEvent.click(screen.getByRole("button", { name: "Simulator" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle advanced settings" }));

    expect((screen.getByLabelText("Simulation stop time") as HTMLInputElement).value).toBe("500");
    expect((screen.getByLabelText("Simulation stop time SI prefix") as HTMLSelectElement).value).toBe("u");
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
    saveConversationMessages(DEFAULT_WORKSPACE_ID, id, [
      { role: "user", content: "What does R1 do?" },
      { role: "assistant", content: "R1 sets the gain." },
    ]);
    setActiveConversationId(DEFAULT_WORKSPACE_ID, id);

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

  it("keeps the Assistant draft and active project chat while switching schematic files", async () => {
    await renderOpenProject();
    fireEvent.change(screen.getByRole("textbox", { name: "Message the assistant" }), {
      target: { value: "Continue the two-bit register work" },
    });

    fireEvent.click(screen.getByRole("button", { name: "New schematic" }));
    await screen.findByRole("tab", { name: /untitled-2\.asc/ });
    expect(screen.getByRole("textbox", { name: "Message the assistant" })).toHaveProperty(
      "value",
      "Continue the two-bit register work",
    );

    fireEvent.click(screen.getByRole("tab", { name: /^untitled\.asc/ }));
    expect(screen.getByRole("textbox", { name: "Message the assistant" })).toHaveProperty(
      "value",
      "Continue the two-bit register work",
    );
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

  it("asks Save / Don’t Save / Cancel before closing a dirty schematic", async () => {
    await renderOpenProject();
    act(() => useSchematic.getState().addComponent("resistor", 120, 120));

    fireEvent.click(screen.getByRole("button", { name: "Close untitled.asc" }));
    let dialog = await screen.findByRole("alertdialog", { name: "Save changes to “untitled.asc”?" });
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Don’t Save" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("img", { name: "untitled.asc has unsaved changes" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close untitled.asc" }));
    dialog = await screen.findByRole("alertdialog", { name: "Save changes to “untitled.asc”?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Don’t Save" }));
    await waitFor(() => expect(useSchematic.getState().components).toEqual([]));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("saves a dirty schematic from the close confirmation before closing", async () => {
    await renderOpenProject();
    const path = `${DEFAULT_WORKSPACE_ID}/untitled.asc`;
    act(() => useSchematic.getState().addComponent("resistor", 120, 120));

    fireEvent.click(screen.getByRole("button", { name: "Close untitled.asc" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Save changes to “untitled.asc”?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(useProject.getState().workspaceFiles[path].contents).toContain("SYMBOL res"));
    await waitFor(() => expect(useSchematic.getState().components).toEqual([]));
  });

  it("saves imported comments, directive placement, and custom sheet geometry", async () => {
    const path = `${DEFAULT_WORKSPACE_ID}/commented.asc`;
    const contents = [
      "Version 4",
      "SHEET 1 1120 760",
      "TEXT 48 624 Left 2 !.op",
      "TEXT 48 656 Left 2 ;Keep this engineering note",
      "",
    ].join("\n");
    const file = { path, name: "commented.asc", contents, kind: "asc" as const };
    useProject.setState({
      rootPath: DEFAULT_WORKSPACE_ID,
      rootName: DEFAULT_WORKSPACE_NAME,
      tree: defaultWorkspaceTree([file]),
      expanded: [DEFAULT_WORKSPACE_ID],
      workspaceFiles: { [path]: file },
      error: null,
      capability: "none",
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "commented.asc" }));
    await screen.findByRole("tab", { name: /commented\.asc/ });
    act(() => useSchematic.getState().addComponent("resistor", 120, 120));
    fireEvent.keyDown(document.body, { key: "s", metaKey: true });

    await waitFor(() => expect(screen.queryByText(/Save blocked/)).toBeNull());
    await waitFor(() => {
      const saved = useProject.getState().workspaceFiles[path].contents;
      expect(saved).toContain("SHEET 1 1120 760");
      expect(saved).toContain("TEXT 48 624 Left 2 !.op");
      expect(saved).toContain("TEXT 48 656 Left 2 ;Keep this engineering note");
      expect(saved).toContain("SYMBOL res");
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

  it("refuses Run when a preserved LTspice symbol has no Tau electrical model", async () => {
    await renderOpenProject();
    act(() => useSchematic.setState({
      directives: [".tran 1m"],
      ascForeignSymbols: [{
        type: "PowerProducts\\LTC4449",
        x: 96,
        y: 64,
        orientation: "R0",
        attrs: { InstName: "U1", Value: "LTC4449" },
      }],
    }));

    fireEvent.click(screen.getAllByRole("button", { name: "Run simulation" })[0]);

    const refusals = await screen.findAllByText(
      /Simulation refused: U1 \(PowerProducts\\LTC4449\).*No approximate or partial circuit was run/,
    );
    expect(refusals.length).toBeGreaterThan(0);
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

  it("clears an imported lossy ASC into a new safe file without overwriting the source", async () => {
    const originalPath = `${DEFAULT_WORKSPACE_ID}/vendor-power-stage.asc`;
    const replacementPath = `${DEFAULT_WORKSPACE_ID}/untitled.asc`;
    const originalContents = [
      "Version 4",
      "SHEET 1 880 680",
      // A real LTspice record Tau cannot reproduce exactly, so the source stays
      // protected: a WINDOW placement with no SYMBOL to attach to. Drawing
      // primitives no longer qualify, and neither do DATAFLAG readouts - both
      // survive a save now.
      "WINDOW 0 32 32 Left 2",
      "TEXT 32 96 Left 2 !.tran 10m",
      "",
    ].join("\n");
    const importedFile = {
      path: originalPath,
      name: "vendor-power-stage.asc",
      contents: originalContents,
      kind: "asc" as const,
    };
    useProject.setState({
      rootPath: DEFAULT_WORKSPACE_ID,
      rootName: DEFAULT_WORKSPACE_NAME,
      tree: defaultWorkspaceTree([importedFile]),
      expanded: [DEFAULT_WORKSPACE_ID],
      workspaceFiles: { [originalPath]: importedFile },
      error: null,
      capability: "none",
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "vendor-power-stage.asc" }));
    expect(await screen.findByRole("tab", { name: /vendor-power-stage\.asc/ })).toBeTruthy();
    await waitFor(() => expect(useSchematic.getState().directives).toEqual([".tran 10m"]));

    // Run is allowed from the validated in-memory document. Its best-effort
    // autosave must not nag about source records that Tau is deliberately
    // protecting; explicit Cmd+S still surfaces that protection.
    fireEvent.click(screen.getAllByRole("button", { name: "Run simulation" })[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Schematic" })).toBeTruthy());
    expect(screen.queryByText(/Save blocked/)).toBeNull();
    expect(useProject.getState().workspaceFiles[originalPath].contents).toBe(originalContents);
    fireEvent.click(screen.getByRole("button", { name: "Schematic" }));

    fireEvent.click(screen.getByRole("button", { name: "Clear scratchpad" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Clear scratchpad?" });
    expect(within(dialog).getByText(/leaves the original file unchanged/i)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear scratchpad" }));

    expect(await screen.findByRole("tab", { name: /untitled\.asc/ })).toBeTruthy();
    expect(useSchematic.getState().components).toEqual([]);
    expect(useSchematic.getState().directives).toEqual([]);
    expect(useProject.getState().workspaceFiles[originalPath].contents).toBe(originalContents);

    act(() => useSchematic.getState().addComponent("resistor", 256, 192));
    fireEvent.keyDown(document.body, { key: "s", metaKey: true });

    await waitFor(() => {
      const saved = useProject.getState().workspaceFiles[replacementPath]?.contents;
      expect(saved).toContain("SYMBOL res");
      expect(saved).not.toContain("WINDOW 0 32 32");
      expect(saved).not.toContain(".tran 10m");
    });
    expect(useProject.getState().workspaceFiles[originalPath].contents).toBe(originalContents);
    expect(screen.queryByText(/Save blocked/)).toBeNull();
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
  it("requires a project before exposing schematic editing or Bode", () => {
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
    for (const name of ["Close Bode", "Run simulation", "Simulator", "Components", "Waveforms"]) {
      expect(screen.getByRole("button", { name }).hasAttribute("disabled")).toBe(true);
    }
    expect(screen.queryByRole("complementary", { name: "Assistant" })).toBeNull();
  });
});
