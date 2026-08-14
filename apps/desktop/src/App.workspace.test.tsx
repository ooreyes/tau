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
// These assertions exercise the Settings surface after it is open; they do
// not exercise Vite's code-splitting transport.  Preload the lazy module as
// part of this test module so an unrelated worker's transform/load backlog
// cannot consume the test's UI assertion budget before React gets a chance to
// commit the dialog.  App still uses the real lazy boundary in production.
import { SettingsWindow } from "./settings/SettingsWindow";
import { AssistantPanel } from "./components/AssistantPanel";
import { SimulationPanel } from "./components/SimulationPanel";
import { CommandPalette } from "./components/CommandPalette";
import {
  createConversation,
  saveConversationMessages,
  setActiveConversationId,
} from "./lib/assistantMemory";
import { simulationPreferences } from "./lib/simulationPreferences";
import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  defaultWorkspaceTree,
} from "./project/defaultWorkspace";
import { blankAscText, blankSimJson } from "./project/types";
import { useProject } from "./store/useProject";
import { useSchematic } from "./store/useSchematic";

const defaultRenameNode = useProject.getState().renameNode;
// Captured for the same reason `renameNode` is: the P3-05 delete-failure test
// swaps in a no-op `deleteNode`, and a leaked override would silently disarm
// every later test that asserts a file really went away.
const defaultDeleteNode = useProject.getState().deleteNode;

void SettingsWindow;
void AssistantPanel;
void SimulationPanel;
void CommandPalette;

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

  it("canonicalizes child-sheet port label ids across a reopened document", () => {
    const first = {
      components: [],
      wires: [],
      netLabels: [{ id: "label-old", x: 64, y: 0, text: "OUT", port: "Out" as const }],
      projectPorts: [{ name: "OUT", labelId: "label-old", direction: "Out" as const }],
      directives: [],
    };
    const reopened = {
      ...first,
      netLabels: [{ ...first.netLabels[0], id: "label-new" }],
      projectPorts: [{ ...first.projectPorts[0], labelId: "label-new" }],
    };

    expect(schematicDocumentSignature(reopened)).toBe(schematicDocumentSignature(first));
    expect(schematicDocumentSignature({
      ...reopened,
      projectPorts: [{ ...reopened.projectPorts[0], name: "IN" }],
    })).not.toBe(schematicDocumentSignature(first));

    // Exercise the real reopen path too: loadCircuit remints the label id and
    // remaps the port reference, but the saved semantic signature stays clean.
    useSchematic.getState().loadCircuit(first);
    const liveAfterReopen = useSchematic.getState();
    expect(liveAfterReopen.netLabels[0]?.id).not.toBe("label-old");
    expect(schematicDocumentSignature({
      components: liveAfterReopen.components,
      wires: liveAfterReopen.wires,
      netLabels: liveAfterReopen.netLabels,
      projectPorts: liveAfterReopen.projectPorts,
      directives: liveAfterReopen.directives,
    })).toBe(schematicDocumentSignature(first));
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
  simulationPreferences.reset();
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
    deleteNode: defaultDeleteNode,
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
  await screen.findByRole("tab", { name: /untitled/ });
  await screen.findByRole("complementary", { name: "Assistant" });
}

/**
 * Seed one empty `.asc` into the workspace and open it from the explorer.
 *
 * The cases that use this are about the LTspice WRITER - the `SYMBOL`, `WIRE`
 * and `SYMATTR` records it emits - and used to reach that writer only because
 * the scratch buffer happened to be `.asc`. What a new sheet is minted as moved
 * to `.sim` (Tau JSON), so each of them now names `.asc` on purpose, the same
 * way `commented.asc` and `source.asc` further down this file already do.
 *
 * A `.asc` tab's accessible name is the whole filename; only `.sim` is stripped
 * from the label (`EditorChrome`), which is why `name` is matched exactly here.
 */
async function openBlankAsc(name: string): Promise<string> {
  const path = `${DEFAULT_WORKSPACE_ID}/${name}`;
  const file = { path, name, contents: blankAscText(), kind: "asc" as const };
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
  fireEvent.click(await screen.findByRole("button", { name }));
  await screen.findByRole("tab", { name });
  return path;
}

describe("App schematic workspace tools", () => {
  it("loads the command palette when Search is explicitly requested", async () => {
    await renderOpenProject();

    // cmdk focuses its active row as the dialog mounts; jsdom does not expose
    // the browser scrolling method the real surface calls.
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: () => {},
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByRole("dialog", { name: "Add component" })).toBeTruthy();
  });

  it("mounts Components inside the schematic stage as a summoned surface", async () => {
    await renderOpenProject();

    const canvas = screen.getByRole("main", { name: "Schematic canvas" });
    const componentsRail = screen.getByRole("complementary", { name: "Components" });
    expect(canvas.contains(componentsRail)).toBe(true);
    expect(componentsRail.parentElement).toBe(canvas);
  });

  it("keeps the Components overlay and Assistant independently resizable together", async () => {
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
    /*
     * Named, not counted. A bare length of 2 broke the moment the results
     * drawer grew its own drag handle - which is a separator, and a correct
     * addition - and reported a new feature as a panel-layout regression. What
     * this case is actually about is which PANEL resize handles are present, so
     * it asks for those two by name and leaves the drawer's alone.
     */
    const panelHandles = screen.getAllByRole("separator")
      .filter((el) => !/results drawer/i.test(el.getAttribute("aria-label") ?? ""));
    expect(panelHandles.map((el) => el.getAttribute("aria-label"))).toEqual([
      "Resize properties panel",
      "Resize assistant panel",
    ]);

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
    // The simulator's own divider, between the circuit and the analysis. Named
    // rather than counted: the count-of-2 case above is schematic mode, which
    // the split cannot reach, and a bare count here would pass just as happily
    // if the analysis divider replaced the assistant's rather than joining it.
    expect(screen.getByRole("separator", { name: "Resize analysis pane" })).toBeTruthy();
  });

  it("starts a new run at the waveform detail chosen in Settings", async () => {
    simulationPreferences.update({ transientDetail: "precision" });
    await renderOpenProject();

    fireEvent.click(screen.getByRole("button", { name: "Simulator" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle advanced settings" }));

    expect((screen.getByLabelText("Exact output points") as HTMLInputElement).value).toBe("480");
  });

  it("leaves Tau's shipped balance alone when nobody has chosen", async () => {
    await renderOpenProject();

    fireEvent.click(screen.getByRole("button", { name: "Simulator" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle advanced settings" }));

    expect((screen.getByLabelText("Exact output points") as HTMLInputElement).value).toBe("240");
  });

  it("uses an imported .tran card instead of auto-resolution until manually overridden", async () => {
    simulationPreferences.update({ transientDetail: "precision" });
    await renderOpenProject();
    act(() => useSchematic.setState({ directives: [".tran 500µ startup"] }));

    fireEvent.click(screen.getByRole("button", { name: "Simulator" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle advanced settings" }));

    expect((screen.getByLabelText("Circuit duration value") as HTMLInputElement).value).toBe("500");
    const durationUnit = screen.getByRole("combobox", { name: "Circuit duration unit" });
    expect(durationUnit.tagName).toBe("BUTTON");
    expect(durationUnit.getAttribute("data-slot")).toBe("select-trigger");
    expect(durationUnit.textContent).toContain("µs");
    expect(screen.getByText("DOCUMENT")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Use quick waveform detail" }));
    await waitFor(() => expect(screen.getByText("CUSTOM")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Use document settings" }));
    await waitFor(() => expect(screen.getByText("DOCUMENT")).toBeTruthy());
    expect((screen.getByLabelText("Circuit duration value") as HTMLInputElement).value).toBe("500");
  });

  it("explains the simulator is view-only when an edit shortcut is attempted", async () => {
    await renderOpenProject();
    act(() => useSchematic.getState().addComponent("resistor", 120, 120));
    const before = useSchematic.getState().components.length;
    fireEvent.click(screen.getByRole("button", { name: "Simulator" }));

    fireEvent.keyDown(document.body, { key: "Delete" });

    await waitFor(() => {
      expect(screen.getByText("Simulator is view only. Return to Schematic to edit.")).toBeTruthy();
    });
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

    // `New tab`, not the empty state's "New schematic": with P3-04B that card
    // stops offering to create a schematic once one is already open and empty.
    fireEvent.click(screen.getByRole("button", { name: "New tab" }));
    await screen.findByRole("tab", { name: /untitled-2/ });
    expect(screen.getByRole("textbox", { name: "Message the assistant" })).toHaveProperty(
      "value",
      "Continue the two-bit register work",
    );

    // Named exactly, not by prefix. A `.sim` tab's label drops the extension
    // (`EditorChrome`), so both tabs now read `untitled…` and `/^untitled/`
    // matched two elements - the first tab's whole accessible name is the bare
    // word, which distinguishes it from `untitled-2` without a prefix guess.
    fireEvent.click(screen.getByRole("tab", { name: "untitled" }));
    expect(screen.getByRole("textbox", { name: "Message the assistant" })).toHaveProperty(
      "value",
      "Continue the two-bit register work",
    );
  });

  it("shows an unsaved dot after an edit and clears it after Save", async () => {
    await renderOpenProject();

    act(() => useSchematic.getState().addComponent("resistor", 120, 120));
    expect(await screen.findByRole("img", { name: "untitled.sim has unsaved changes" })).toBeTruthy();
    expect(screen.getByText("untitled.sim •")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "s", metaKey: true });
    await waitFor(() => {
      expect(screen.queryByRole("img", { name: "untitled.sim has unsaved changes" })).toBeNull();
      expect(screen.getAllByText("untitled.sim").length).toBeGreaterThan(0);
    });
  });

  it("asks Save / Don’t Save / Cancel before closing a dirty schematic", async () => {
    await renderOpenProject();
    act(() => useSchematic.getState().addComponent("resistor", 120, 120));

    fireEvent.click(screen.getByRole("button", { name: "Close untitled.sim" }));
    let dialog = await screen.findByRole("alertdialog", { name: "Save changes to “untitled.sim”?" });
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Don’t Save" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("img", { name: "untitled.sim has unsaved changes" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close untitled.sim" }));
    dialog = await screen.findByRole("alertdialog", { name: "Save changes to “untitled.sim”?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Don’t Save" }));
    await waitFor(() => expect(useSchematic.getState().components).toEqual([]));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("saves a dirty schematic from the close confirmation before closing", async () => {
    // `.asc` on purpose: the assertion below is about the LTspice writer, and a
    // new sheet is minted as `.sim` now, whose writer emits Tau JSON. This case
    // is the confirmation dialog's Save button reaching the ASC writer at all.
    const path = await openBlankAsc("close-save.asc");
    act(() => useSchematic.getState().addComponent("resistor", 120, 120));

    fireEvent.click(screen.getByRole("button", { name: "Close close-save.asc" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Save changes to “close-save.asc”?" });
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
    // `.asc` on purpose: `WIRE` is an LTspice record, one per segment, and that
    // one-record-per-segment split is the whole subject. A minted `.sim` holds
    // the polyline as JSON and has no `WIRE` line to count.
    const path = await openBlankAsc("run-autosave.asc");
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
    expect(screen.queryByRole("img", { name: "run-autosave.asc has unsaved changes" })).toBeNull();
  });

  it("runs a clean imported ASC without rewriting its source bytes", async () => {
    const path = `${DEFAULT_WORKSPACE_ID}/source.asc`;
    const contents = [
      "Version 4",
      "SHEET 1 880 680",
      // Deliberately non-canonical record order: a save would move the FLAG
      // ahead of the SYMBOL, so byte identity proves Run did not write.
      "SYMBOL res 96 64 R0",
      "SYMATTR InstName R1",
      "SYMATTR Value 1k",
      "FLAG 96 64 out",
      "TEXT 32 128 Left 2 !.tran 1m",
      "",
    ].join("\n");
    const file = { path, name: "source.asc", contents, kind: "asc" as const };
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

    fireEvent.click(await screen.findByRole("button", { name: "source.asc" }));
    await screen.findByRole("tab", { name: /source\.asc/ });
    fireEvent.click(screen.getAllByRole("button", { name: "Run simulation" })[0]);

    await waitFor(() => expect(screen.getByRole("button", { name: "Schematic" })).toBeTruthy());
    expect(useProject.getState().workspaceFiles[path].contents).toBe(contents);
  });

  it("keeps a newer .sim open when an earlier ASC vendor-symbol lookup settles late", async () => {
    const slowPath = `${DEFAULT_WORKSPACE_ID}/slow-vendor.asc`;
    const latestPath = `${DEFAULT_WORKSPACE_ID}/latest.sim`;
    const slowContents = [
      "Version 4",
      "SHEET 1 880 680",
      // An unresolved vendor symbol makes the importer probe project and
      // installed-library candidates asynchronously.  The simple second file
      // completes while that work is still pending.
      "SYMBOL Vendor/SlowPart 96 64 R0",
      "SYMATTR InstName U1",
      "TEXT 32 128 Left 2 !.op",
      "",
    ].join("\n");
    const latestContents = JSON.stringify({
      components: [{ id: "r1", kind: "resistor", x: 96, y: 64, rotation: 0, value: "1k", label: "R1" }],
      wires: [],
      netLabels: [],
      probes: [],
      directives: [".op"],
    });
    const slowFile = { path: slowPath, name: "slow-vendor.asc", contents: slowContents, kind: "asc" as const };
    const latestFile = { path: latestPath, name: "latest.sim", contents: latestContents, kind: "sim" as const };
    useProject.setState({
      rootPath: DEFAULT_WORKSPACE_ID,
      rootName: DEFAULT_WORKSPACE_NAME,
      tree: defaultWorkspaceTree([slowFile, latestFile]),
      expanded: [DEFAULT_WORKSPACE_ID],
      workspaceFiles: { [slowPath]: slowFile, [latestPath]: latestFile },
      error: null,
      capability: "none",
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "slow-vendor.asc" }));
    fireEvent.click(screen.getByRole("button", { name: "latest.sim" }));
    await waitFor(() => expect(useSchematic.getState().components.map((component) => component.label)).toEqual(["R1"]));

    // The old request completes through a bounded chain of promise-only
    // filesystem probes.  Drain that chain rather than introducing a clock
    // delay, then prove it never gets to replace the newer navigation.
    await act(async () => {
      for (let index = 0; index < 64; index += 1) await Promise.resolve();
    });
    expect(document.querySelector(".brand-file")?.textContent).toBe("latest.sim");
    expect(useSchematic.getState().components.map((component) => component.label)).toEqual(["R1"]);
  });

  it("updates one extended LTspice value slot without collapsing the others", async () => {
    const path = `${DEFAULT_WORKSPACE_ID}/opamp.asc`;
    const contents = [
      "Version 4",
      "SHEET 1 880 680",
      "SYMBOL OpAmps/UniversalOpAmp2 160 160 R0",
      "SYMATTR InstName U1",
      "SYMATTR Value2 Avol=1Meg GBW=10Gig Slew=10Gig",
      "SYMATTR SpiceLine ilimit=2 rail=0",
      "TEXT 32 320 Left 2 !.tran 1m",
      "",
    ].join("\n");
    const file = { path, name: "opamp.asc", contents, kind: "asc" as const };
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

    fireEvent.click(await screen.findByRole("button", { name: "opamp.asc" }));
    await screen.findByRole("tab", { name: /opamp\.asc/ });
    const opamp = useSchematic.getState().components.find((component) => component.label === "U1");
    expect(opamp?.ltExtraAttrs)
      .toMatchObject({ extras: { Value2: "Avol=1Meg GBW=10Gig Slew=10Gig", SpiceLine: "ilimit=2 rail=0" } });
    act(() => useSchematic.getState().setValue(
      opamp!.id,
      "Avol=2Meg GBW=10Gig Slew=10Gig ilimit=2 rail=0",
    ));
    fireEvent.keyDown(document.body, { key: "s", metaKey: true });

    await waitFor(() => {
      const saved = useProject.getState().workspaceFiles[path].contents;
      expect(saved).toContain("SYMATTR Value2 Avol=2Meg GBW=10Gig Slew=10Gig");
      expect(saved).toContain("SYMATTR SpiceLine ilimit=2 rail=0");
      expect(saved).not.toContain("SYMATTR Value Avol=2Meg");
    });
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

  it("never leaves the canvas card, the dock and the document disagreeing about a skipped part (DIAG)", async () => {
    // The packaged-QA sheet's last part, verbatim. Its only record is a SYMBOL
    // with no library folder, so nothing editable imports: the canvas card
    // renders (components === 0 && wires === 0) while the dock refuses a run
    // over the retained record. Three surfaces, one document.
    const path = `${DEFAULT_WORKSPACE_ID}/one-dflop.asc`;
    const contents = ["Version 4", "SHEET 1 880 680", "SYMBOL dflop 224 384 R0", "SYMATTR InstName A1"].join("\n");
    const file = { path, name: "one-dflop.asc", contents, kind: "asc" as const };
    // A neighbour every part of which imports, to check nothing leaks across.
    const cleanPath = `${DEFAULT_WORKSPACE_ID}/rc.asc`;
    const cleanFile = {
      path: cleanPath,
      name: "rc.asc",
      contents: [
        "Version 4",
        "SHEET 1 880 680",
        "FLAG 80 192 0",
        "SYMBOL res 240 80 R90",
        "SYMATTR InstName R1",
        "SYMATTR Value 1k",
        "SYMBOL voltage 80 80 R0",
        "SYMATTR InstName V1",
        "SYMATTR Value PULSE(0 5 0 1n 1n 1m 2m)",
      ].join("\n"),
      kind: "asc" as const,
    };
    useProject.setState({
      rootPath: DEFAULT_WORKSPACE_ID,
      rootName: DEFAULT_WORKSPACE_NAME,
      tree: defaultWorkspaceTree([file, cleanFile]),
      expanded: [DEFAULT_WORKSPACE_ID],
      workspaceFiles: { [path]: file, [cleanPath]: cleanFile },
      error: null,
      capability: "none",
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "one-dflop.asc" }));
    await screen.findByRole("tab", { name: /one-dflop\.asc/ });

    // (a) What is really in the document, read from the store.
    await waitFor(() => expect(useSchematic.getState().ascForeignSymbols).toHaveLength(1));
    expect(useSchematic.getState().components).toHaveLength(0);
    expect(useSchematic.getState().wires).toHaveLength(0);

    // The card is the surface that was lying: an empty sheet whose file DID
    // contain a part is not a fresh sheet.
    const card = await screen.findByRole("region", { name: "Empty schematic" });
    expect(card.textContent).not.toContain("Place your first component");
    expect(card.textContent).toContain("A1 (dflop)");

    // The dock's skip notice is still on screen while the record is here...
    expect(screen.getAllByText(/Skipped A1/).length).toBeGreaterThan(0);

    // ...and must not outlive it. Clearing the sheet drops ascForeignSymbols,
    // so a notice about A1 now describes a part nobody can find.
    act(() => useSchematic.getState().clearSheet());
    await waitFor(() => expect(screen.queryByText(/Skipped A1/)).toBeNull());
    expect((await screen.findByRole("region", { name: "Empty schematic" })).textContent)
      .toContain("Place your first component");

    // And a document whose parts all import is left with nothing to explain -
    // no card at all, and no notice inherited from the sheet next door.
    fireEvent.click(await screen.findByRole("button", { name: "rc.asc" }));
    await screen.findByRole("tab", { name: /rc\.asc/ });
    await waitFor(() => expect(
      useSchematic.getState().components.map((component) => component.label).filter(Boolean).sort(),
    ).toEqual(["R1", "V1"]));
    expect(useSchematic.getState().ascForeignSymbols).toEqual([]);
    expect(screen.queryByText(/Skipped/)).toBeNull();
    expect(screen.queryByRole("region", { name: "Empty schematic" })).toBeNull();
  });

  it("saves an AC voltage source without the former vac export blocker", async () => {
    // `.asc` on purpose: `SYMATTR TauKind` is the ASC writer's own round-trip
    // marker for a part LTspice has no distinct symbol for, so the export
    // blocker this case retired only exists on the `.asc` path. The default
    // mint is `.sim`, which stores the kind natively and never needed it.
    const path = await openBlankAsc("ac-source.asc");
    act(() => useSchematic.getState().addComponent("vac", 160, 160));

    fireEvent.keyDown(document.body, { key: "s", metaKey: true });

    await waitFor(() => {
      const contents = useProject.getState().workspaceFiles[path].contents;
      expect(contents).toContain("SYMATTR TauKind vac");
      expect(contents).toContain("SINE(0 1 1k) AC 1");
    });
    expect(screen.queryByText(/Save blocked/)).toBeNull();
    expect(screen.queryByRole("img", { name: "ac-source.asc has unsaved changes" })).toBeNull();
  });

  it("clears an imported lossy ASC in place, preserving its tab identity and undo history", async () => {
    const originalPath = `${DEFAULT_WORKSPACE_ID}/vendor-power-stage.asc`;
    const originalContents = [
      "Version 4",
      "SHEET 1 880 680",
      // A real LTspice record Tau cannot reproduce exactly, so the source stays
      // protected: a WINDOW placement with no SYMBOL to attach to. Drawing
      // primitives no longer qualify, and neither do DATAFLAG readouts - both
      // survive a save now.
      "WINDOW 0 32 32 Left 2",
      // Carried on the document, so clearing has to drop it: it belongs to this
      // file and must not follow the blank replacement onto disk.
      "DATAFLAG 32 96 \"V(out)\"",
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
    // The readout really is carried, so the assertion after the clear below is
    // measuring the reset rather than an import that never captured it.
    expect(useSchematic.getState().ascDataFlags).toEqual([{ x: 32, y: 96, expr: "\"V(out)\"" }]);

    // Run is allowed from the validated in-memory document. Its best-effort
    // autosave must not nag about source records that Tau is deliberately
    // protecting; explicit Cmd+S still surfaces that protection.
    fireEvent.click(screen.getAllByRole("button", { name: "Run simulation" })[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Schematic" })).toBeTruthy());
    expect(screen.queryByText(/Save blocked/)).toBeNull();
    expect(useProject.getState().workspaceFiles[originalPath].contents).toBe(originalContents);
    fireEvent.click(screen.getByRole("button", { name: "Schematic" }));

    fireEvent.click(screen.getByRole("button", { name: "Clear schematic" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Clear schematic?" });
    expect(within(dialog).getByText(/tab, saved file path, and file history stay in place/i)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear schematic" }));

    expect(await screen.findByRole("tab", { name: /vendor-power-stage\.asc/ })).toBeTruthy();
    expect(document.querySelector(".brand-file")?.textContent).toMatch(/^vendor-power-stage\.asc/);
    expect(useSchematic.getState().components).toEqual([]);
    expect(useSchematic.getState().directives).toEqual([]);
    expect(useSchematic.getState().ascDataFlags).toEqual([]);
    expect(useProject.getState().workspaceFiles[originalPath].contents).toBe(originalContents);

    // The file is still disk-backed, so the source is untouched until an
    // explicit save. An in-place clear can be undone before that save.
    act(() => useSchematic.getState().undo());
    expect(useSchematic.getState().directives).toEqual([".tran 10m"]);
    expect(useSchematic.getState().ascDataFlags).toEqual([{ x: 32, y: 96, expr: "\"V(out)\"" }]);
    expect(useProject.getState().workspaceFiles[originalPath].contents).toBe(originalContents);
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
    const originalPath = `${DEFAULT_WORKSPACE_ID}/untitled.sim`;
    const renamedPath = `${DEFAULT_WORKSPACE_ID}/gain-stage.asc`;
    const tab = screen.getByRole("tab", { name: /untitled/ });

    fireEvent.doubleClick(tab);
    const renameInput = await screen.findByRole("textbox", { name: "Rename untitled.sim" });
    // The extension is typed out on purpose. A bare `gain-stage` now keeps the
    // source's `.sim` (`preserveSchematicExtension`), and the `SYMBOL res`
    // assertion below is about the ASC writer - so this case spells the format
    // it is testing rather than inheriting whatever the mint default happens
    // to be. Renaming a sheet across formats is also the real gesture here.
    fireEvent.change(renameInput, { target: { value: "gain-stage.asc" } });
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

describe("The modal editors are fetched only from default routes", () => {
  // Model libraries remains an explicit file-driven capability, but is no
  // longer a default toolbar route. Simulation setup remains a default route.
  it("does not expose Model libraries from the schematic toolbar", async () => {
    await renderOpenProject();

    expect(screen.queryByRole("button", { name: "Model libraries" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Model libraries" })).toBeNull();
  });

  it("opens Simulation setup from the schematic toolbar", async () => {
    await renderOpenProject();

    fireEvent.click(screen.getByRole("button", { name: "Simulation setup" }));

    const dialog = await screen.findByRole("dialog", { name: "Simulation setup" });
    expect(within(dialog).getByText(/Choose a common analysis/)).toBeTruthy();
  });

  it("offers a sheet interface on an .asc sheet, and says what to do next", async () => {
    /*
     * Re-expected twice now, and the second time REVERSES the first, so it is
     * worth saying why rather than quietly flipping an assertion.
     *
     * This used to assert that the dialog REFUSED on a `.asc`, on the grounds
     * that such a document cannot carry a `projectPorts` array. That was true of
     * the array and beside the point about the format: LTspice states a
     * hierarchy port as a `FLAG` plus an adjacent `IOPIN <dir>`, which is
     * precisely what this dialog writes, and the compiler now reads that
     * contract and derives the interface from it. The refusal was therefore
     * blocking an act that works.
     *
     * The fixture opens `untitled.sim`, so this is the interesting case: the
     * sheet must be OFFERED its interface, and - since a brand-new sheet has no
     * named nets - must say what to do first. A dialog that opens onto nothing,
     * with no next step, is the same dead end as a refusal wearing better copy.
     */
    await renderOpenProject();

    fireEvent.click(screen.getByRole("button", { name: "Sheet interface" }));

    const dialog = await screen.findByRole("dialog", { name: "Sheet interface" });
    const group = within(dialog).getByRole("group", { name: "Sheet interface" });

    // No refusal note: nothing about this sheet's format stops it.
    expect(within(group).queryByRole("note")).toBeNull();
    // The live control is present, and it names the act.
    expect(within(group).getByText(/Mark the nets this sheet exposes, in order/i)).toBeTruthy();
    // And because the sheet is empty, it says which step comes first rather than
    // presenting an empty list.
    expect(
      within(dialog).getByText(/no named nets yet\. Label a net first, then mark it/i),
    ).toBeTruthy();
  });
});

describe("Settings is a surface in this window", () => {
  it("opens Settings over the schematic and closes it again, from every entry point", async () => {
    await renderOpenProject();

    // Settings remains a single, keyboard-addressable toolbar affordance after
    // the redundant activity-rail gear is removed.
    const entryPoints = screen.getAllByRole("button", { name: "Settings" }).length;
    expect(entryPoints).toBe(1);

    for (let index = 0; index < entryPoints; index += 1) {
      fireEvent.click(screen.getAllByRole("button", { name: "Settings" })[index]);
      const settings = await screen.findByRole("dialog", { name: "Settings" });
      expect(settings.getAttribute("data-slot")).toBe("sheet-content");
      expect(settings.classList.contains("tau-settings-route")).toBe(true);
      expect(within(settings).getByRole("navigation", { name: "Settings pages" })).toBeTruthy();
      // The schematic window is still the window: the open tab is mounted
      // behind Settings rather than replaced by it. `hidden: true` is
      // required here now that Settings is a real Radix modal: a true
      // aria-modal dialog correctly marks the rest of the document
      // `aria-hidden` while it is open (Radix's `hideOthers`), so the tab
      // is legitimately absent from the default accessible-role query -
      // this assertion is about DOM presence, not AT-visibility.
      expect(screen.getByRole("tab", { name: /untitled/, hidden: true })).toBeTruthy();

      fireEvent.click(within(settings).getByRole("button", { name: "Close settings" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull());
    }
  });

  it("keeps focus inside Settings while it is open", async () => {
    await renderOpenProject();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const settingsDialog = await screen.findByRole("dialog", { name: "Settings" });
    await waitFor(() => expect(settingsDialog.contains(document.activeElement)).toBe(true));
  });

  it("returns focus to the control that opened Settings", async () => {
    await renderOpenProject();

    // The toolbar button is the surviving shell affordance; it stays
    // addressable after the dialog unmounts and can be compared below.
    const openSettingsButton = screen.getByRole("button", { name: "Settings" });
    // `fireEvent.click` (unlike a real click, or `userEvent.click`) does not
    // focus its target, but Radix's FocusScope captures whatever element is
    // focused at mount time as the thing to restore focus to on unmount.
    // Focus the button explicitly so this test exercises the real-world
    // case: a mouse click on a button focuses it before the handler runs.
    openSettingsButton.focus();
    fireEvent.click(openSettingsButton);

    const settingsDialog = await screen.findByRole("dialog", { name: "Settings" });
    const closeSettingsButton = within(settingsDialog).getByRole("button", { name: "Close settings" });
    // Same reasoning as above: a real click would have focused this button
    // first. That focused node is what's about to be removed from the
    // document when Settings unmounts - the exact moment a browser (or
    // jsdom) drops focus to document.body absent explicit restoration.
    closeSettingsButton.focus();
    fireEvent.click(closeSettingsButton);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull());

    // Radix restores focus to the element that had it before the dialog
    // opened, but it does so from a `setTimeout(0)` in FocusScope's unmount
    // cleanup, not synchronously with the state update - hence the waitFor.
    // Without that restoration, focus drops to document.body and the
    // canvas's keyboard shortcuts go dead until the user clicks something;
    // that regression is exactly what this assertion catches.
    await waitFor(() => expect(document.activeElement).toBe(openSettingsButton));
    expect(document.activeElement).not.toBe(document.body);
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

/**
 * P3-05 — closing an untouched untitled schematic takes its file with it.
 *
 * `createSchematicInRoot` writes the file at CREATION, before any edit, and
 * `numberedName` gives each collision the next suffix - which is the
 * `untitled-2.sim / untitled-3.asc / untitled-4.asc` ladder in the report's
 * screenshot. Nothing on the close path ever removed one.
 *
 * The delete is gated on four conditions, and the last three tests here exist
 * to prove each gate is load-bearing rather than to demonstrate the happy
 * path: deleting a file the user wanted is far worse than leaving an empty one.
 */
describe("closing an empty untitled schematic (P3-05)", () => {
  const untitled2 = `${DEFAULT_WORKSPACE_ID}/untitled-2.sim`;

  /**
   * Mint a second untitled file, which is what produces the reported ladder.
   *
   * Through the tab strip's `New tab`, not the empty state's "New schematic".
   * The gesture moved with P3-04B: over an OPEN but empty schematic the card
   * no longer offers to make another schematic (that was the reported wrong
   * copy — it told a reader to do the thing they had just done) and offers
   * "Browse components" instead. `New tab` is the surviving mint route from
   * that state, and it reaches the same `startNewCircuit`.
   */
  async function mintSecondUntitled() {
    fireEvent.click(screen.getByRole("button", { name: "New tab" }));
    await screen.findByRole("tab", { name: /untitled-2/ });
    // The file exists on disk before a single edit - that is the whole defect.
    expect(useProject.getState().workspaceFiles[untitled2].contents).toBe(blankSimJson());
  }

  it("deletes the empty file Tau minted rather than leaving untitled-2.sim behind", async () => {
    await renderOpenProject();
    await mintSecondUntitled();

    fireEvent.click(screen.getByRole("button", { name: "Close untitled-2.sim" }));

    await waitFor(() => expect(useProject.getState().workspaceFiles[untitled2]).toBeUndefined());
    expect(useProject.getState().tree.some((node) => node.path === untitled2)).toBe(false);
    // `/^untitled-2$/`, not `/untitled-2\.sim/`: a `.sim` tab's label drops the
    // extension, so the old pattern could not match a tab that was still there
    // and this assertion had quietly stopped being able to fail.
    expect(screen.queryByRole("tab", { name: /^untitled-2$/ })).toBeNull();
    // The first untitled file is still open and untouched: closing one tab
    // must not reach for its neighbour's file.
    expect(useProject.getState().workspaceFiles[`${DEFAULT_WORKSPACE_ID}/untitled.sim`]).toBeTruthy();
  });

  it("keeps an untitled file whose schematic holds a part when the user chooses Don’t Save", async () => {
    await renderOpenProject();
    await mintSecondUntitled();
    act(() => useSchematic.getState().addComponent("resistor", 120, 120));

    fireEvent.click(screen.getByRole("button", { name: "Close untitled-2.sim" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Save changes to “untitled-2.sim”?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Don’t Save" }));

    // Stripped label, as in the sibling cases: `/untitled-2\.sim/` could not
    // match a `.sim` tab that was still on screen, so it had stopped being able
    // to fail and the "discarded from the editor" half went unmeasured.
    await waitFor(() => expect(screen.queryByRole("tab", { name: /^untitled-2$/ })).toBeNull());
    // Discarded from the editor, kept on disk: the document was not empty at
    // close time, so this is the case where a delete would destroy work.
    expect(useProject.getState().workspaceFiles[untitled2].contents).toBe(blankSimJson());
  });

  it("never deletes a file Tau did not mint, even one named untitled.sim and byte-identical to the template", async () => {
    // The strongest form of the "a file Tau did not create is kept" clause:
    // every OTHER condition passes here - the name matches the mint pattern,
    // the document is empty, and the bytes equal the template exactly - so the
    // only thing standing between this user's file and deletion is the
    // Tau-minted marker.
    const path = `${DEFAULT_WORKSPACE_ID}/untitled.sim`;
    const file = { path, name: "untitled.sim", contents: blankSimJson(), kind: "sim" as const };
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

    fireEvent.click(await screen.findByRole("button", { name: "untitled.sim" }));
    await screen.findByRole("tab", { name: /untitled/ });
    fireEvent.click(screen.getByRole("button", { name: "Close untitled.sim" }));

    // Deliberately left as a pattern that cannot match, unlike the sibling
    // cases above, because here there is nothing honest to tighten it to:
    // closing the last tab mints a fresh blank `untitled.sim`, so a tab whose
    // label reads `untitled` is present either way and `/^untitled$/` would
    // fail on correct behaviour. The file-contents assertion below is what
    // carries this case; this line only says the closed tab is not still open
    // under its full name.
    await waitFor(() => expect(screen.queryByRole("tab", { name: /untitled\.sim/ })).toBeNull());
    expect(useProject.getState().workspaceFiles[path].contents).toBe(blankSimJson());
  });

  it("never deletes an imported .asc, because its name is not one Tau mints", async () => {
    const path = `${DEFAULT_WORKSPACE_ID}/vendor.asc`;
    // Deliberately byte-equal to the template as well, so the name pattern is
    // the only gate doing the work.
    const file = { path, name: "vendor.asc", contents: blankAscText(), kind: "asc" as const };
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

    fireEvent.click(await screen.findByRole("button", { name: "vendor.asc" }));
    await screen.findByRole("tab", { name: /vendor\.asc/ });
    fireEvent.click(screen.getByRole("button", { name: "Close vendor.asc" }));

    await waitFor(() => expect(screen.queryByRole("tab", { name: /vendor\.asc/ })).toBeNull());
    // `blankAscText()`, which is what this file was seeded with. The mint
    // default moving to `.sim` swept `blankSimJson()` in here mechanically, and
    // that could never hold: this test's whole point is a GENUINE `.asc`, whose
    // survival is measured against the ASC template it was written from.
    expect(useProject.getState().workspaceFiles[path].contents).toBe(blankAscText());
  });

  it("never deletes a minted file the user has renamed, even while it is still empty", async () => {
    // The rename gate, which the mint-name condition exists for: a name the
    // user typed is a name they meant. Everything else still points at delete
    // (Tau minted it, the document is empty, the bytes are the template), so
    // the basename is the only thing keeping this file alive.
    await renderOpenProject();
    await mintSecondUntitled();

    const tab = screen.getByRole("tab", { name: /untitled-2/ });
    fireEvent.doubleClick(tab);
    const renameInput = await screen.findByRole("textbox", { name: "Rename untitled-2.sim" });
    fireEvent.change(renameInput, { target: { value: "gain-stage" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });
    // `.sim`, not `.asc`: a name typed without an extension keeps the source
    // file's, and the file Tau minted is `.sim` now. The extension is beside the
    // point here anyway - the BASENAME is the gate under test - but the fixture
    // has to name the path the rename actually produces.
    const renamed = `${DEFAULT_WORKSPACE_ID}/gain-stage.sim`;
    await waitFor(() => expect(useProject.getState().workspaceFiles[renamed]).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Close gain-stage.sim" }));

    // Matched against the stripped label for the reason given above.
    await waitFor(() => expect(screen.queryByRole("tab", { name: /^gain-stage$/ })).toBeNull());
    expect(useProject.getState().workspaceFiles[renamed].contents).toBe(blankSimJson());
  });

  it("keeps the file and says why when the delete does not take", async () => {
    await renderOpenProject();
    await mintSecondUntitled();
    // A removal that reports no error and yet leaves the node behind. This is
    // the shape a real failure takes: `useProject.deleteNode` never throws and
    // does not set `error` on the in-memory branch, so success has to be
    // confirmed by re-reading the tree - never by inspecting `error`.
    // Inside `act` so React has committed the swapped store action before the
    // close click reads it; outside, the click still runs the real delete.
    act(() => {
      useProject.setState({ deleteNode: async () => {} });
    });

    fireEvent.click(screen.getByRole("button", { name: "Close untitled-2.sim" }));

    // Stripped label again; the notice below still spells the full basename,
    // because that is the name the user has to go and find on disk.
    await waitFor(() => expect(screen.queryByRole("tab", { name: /^untitled-2$/ })).toBeNull());
    expect(useProject.getState().workspaceFiles[untitled2].contents).toBe(blankSimJson());
    expect((await screen.findAllByText(/Kept untitled-2\.sim/)).length).toBeGreaterThan(0);
  });
});

/**
 * A real, solvable loop - 5 V across a 1k into ground - so a transient
 * genuinely completes and `componentMeasurements` has rows to offer. Copied
 * rather than shared because the fixture in `App.liveControls.test.tsx` is
 * shaped for the switch band, and a fixture two suites can edit is a fixture
 * that breaks the other one.
 */
const SOLVED_LOOP = [
  { id: "v1", kind: "vsource" as const, x: -128, y: 96, rotation: 0 as const, value: "5", label: "V1" },
  { id: "r1", kind: "resistor" as const, x: 160, y: 0, rotation: 0 as const, value: "1k", label: "R1" },
  { id: "gnd", kind: "ground" as const, x: -128, y: 160, rotation: 0 as const, value: "", label: "" },
];
const SOLVED_LOOP_WIRES = [
  { id: "w1", points: [{ x: -128, y: 128 }, { x: -128, y: 160 }] },
  { id: "w2", points: [{ x: -128, y: 64 }, { x: -128, y: 0 }, { x: 128, y: 0 }] },
  { id: "w3", points: [{ x: 192, y: 0 }, { x: 192, y: 160 }, { x: -128, y: 160 }] },
];

const dockRows = () => [...document.querySelectorAll(".bottom-errors > *")];
const dockText = () => document.querySelector(".bottom-errors")?.textContent ?? "";

describe("the schematic dock is Errors only, and catches problems before Run (P3-14)", () => {
  it("stops offering Measurements in schematic mode after a run, while the simulator keeps it", async () => {
    await renderOpenProject();
    act(() => useSchematic.setState({
      components: SOLVED_LOOP,
      wires: SOLVED_LOOP_WIRES,
      directives: [".tran 1m"],
      past: [],
      future: [],
    }));

    fireEvent.click(screen.getAllByRole("button", { name: "Run simulation" })[0]);
    // The simulator is where measurements belong, so this is the precondition,
    // not the defect: the tab has to be there before its absence next door
    // means anything.
    const measurementsTab = await screen.findByRole("tab", { name: /Measurements/ });
    expect(measurementsTab).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Schematic" }));

    // The reported state exactly: leaving the simulator does not invalidate
    // the analysis, so before the fix the populated Measurements tab followed
    // the user back into the editor.
    expect(screen.queryByRole("tab", { name: /Measurement/i })).toBeNull();
    expect(document.querySelector(".results-drawer-tabs-root")).toBeNull();
    // ... and what is left reads as a section, not as a chooser with one
    // choice.
    expect(screen.getByRole("heading", { name: /Errors/ })).toBeTruthy();

    // The guard that stops the fix being "delete the Measurements tab".
    fireEvent.click(screen.getByRole("button", { name: "Simulator" }));
    expect(await screen.findByRole("tab", { name: /Measurements/ })).toBeTruthy();
  });

  it("lists what is wrong with a lone resistor with no run at all, and the badge equals the row count", async () => {
    await renderOpenProject();
    act(() => useSchematic.getState().addComponent("resistor", 120, 120));

    // No Run, no analysis: this dock used to read "No analysis yet" over a
    // schematic with no ground, no source and two stranded terminals.
    await waitFor(() => expect(dockRows().length).toBeGreaterThan(0));
    expect(dockText()).toContain("No ground symbol found.");
    expect(dockText()).toContain("No source");
    expect(dockText()).toMatch(/R1\.\w+ is only connected to one pin\./);

    // The report's done-when, measured rather than assumed: the count on the
    // collapsed drawer is the number of rows behind it.
    const badge = document.querySelector(".results-drawer-badge")!;
    expect(badge.textContent).toBe(String(dockRows().length));
    // ...and the count the panel's own head shows agrees with both.
    expect(document.querySelector(".bottom-panel-count")?.textContent)
      .toBe(String(dockRows().length));
  });

  it("clears its rows as the circuit is completed, without a run in between", async () => {
    await renderOpenProject();
    act(() => useSchematic.setState({
      components: SOLVED_LOOP,
      wires: SOLVED_LOOP_WIRES,
      directives: [".tran 1m"],
      past: [],
      future: [],
    }));

    // A live linter that only ever accumulates is a linter nobody trusts: the
    // rows have to go away when the problem does.
    await waitFor(() => expect(dockRows().length).toBe(0));
    expect(document.querySelector(".results-drawer-badge")).toBeNull();
  });

  it("selects the offending part when its row is clicked", async () => {
    await renderOpenProject();
    act(() => useSchematic.setState({
      components: [
        { id: "r1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k", label: "R1" },
        // The collider: same designator, so the row names a part and can
        // therefore select one. `R1` twice is an error the deserializer
        // already refuses; this proves the live pass points at the second.
        { id: "r2", kind: "resistor", x: 128, y: 0, rotation: 0, value: "1k", label: "R1" },
      ],
      wires: [],
      directives: [],
      past: [],
      future: [],
    }));

    const row = await waitFor(() => {
      const found = dockRows().find((node) => /Duplicate reference/.test(node.textContent ?? ""));
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    expect(row.tagName).toBe("BUTTON");

    fireEvent.click(row);

    expect(useSchematic.getState().selectedId).toBe("r2");
  });

  it("does not print the same problem twice after a failed run is carried back into the editor", async () => {
    await renderOpenProject();
    // A circuit that FAILS extraction for the same reason the live pass
    // complains about: leaving the simulator does not invalidate the analysis,
    // so the run's own message and the live row are both in scope at once.
    act(() => useSchematic.setState({
      components: [
        { id: "v1", kind: "vsource", x: -128, y: 96, rotation: 0, value: "5", label: "V1" },
        { id: "r1", kind: "resistor", x: 160, y: 0, rotation: 0, value: "1k", label: "R1" },
      ],
      wires: SOLVED_LOOP_WIRES,
      directives: [".tran 1m"],
      past: [],
      future: [],
    }));

    fireEvent.click(screen.getAllByRole("button", { name: "Run simulation" })[0]);
    await waitFor(() => expect(dockText()).toContain("No ground symbol found."));

    fireEvent.click(screen.getByRole("button", { name: "Schematic" }));

    await waitFor(() => expect(dockRows().length).toBeGreaterThan(0));
    const texts = dockRows().map((node) => node.textContent ?? "");
    const grounds = texts.filter((text) => text.includes("No ground symbol found."));
    expect(grounds.length).toBe(1);
    // The badge is only honest if it counts what is actually rendered.
    expect(document.querySelector(".results-drawer-badge")?.textContent)
      .toBe(String(dockRows().length));
    expect(new Set(texts).size).toBe(texts.length);
  });
});

/**
 * Requested by the EXPLORER lane in docs/handoff/EXPLORER.md: P3-02's last
 * unproven clause. `ExplorerPanel.test.tsx` can only prove the panel calls the
 * injected `onMoveNode`, and `project/types.test.ts` only proves
 * `remapMovedProjectPath` computes the right string. Nothing drove the two
 * together through App, which is where the tab list actually lives — and that
 * seam is the one that would silently leave a tab pointing at a path with no
 * file behind it.
 */
describe("an open tab follows its file when the explorer moves it (P3-02, EXPLORER handoff)", () => {
  it("rewrites the open tab's path and keeps it active after the drop", async () => {
    const source = `${DEFAULT_WORKSPACE_ID}/gain.asc`;
    const file = {
      path: source,
      name: "gain.asc",
      contents: blankAscText(),
      kind: "asc" as const,
    };
    // A `.keep` is how `defaultWorkspaceTree` learns about a directory that
    // holds nothing yet; the folder has to exist as a drop target before the
    // file is dragged onto it.
    const keep = {
      path: `${DEFAULT_WORKSPACE_ID}/Filters/.keep`,
      name: ".keep",
      contents: "",
      kind: "asc" as const,
    };
    useProject.setState({
      rootPath: DEFAULT_WORKSPACE_ID,
      rootName: DEFAULT_WORKSPACE_NAME,
      tree: defaultWorkspaceTree([file, keep]),
      expanded: [DEFAULT_WORKSPACE_ID],
      workspaceFiles: { [source]: file, [keep.path]: keep },
      error: null,
      capability: "none",
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "gain.asc" }));
    await screen.findByRole("tab", { name: /gain\.asc/ });

    const fileRow = screen.getByRole("button", { name: "gain.asc" });
    const folderRow = screen.getByRole("button", { name: "Filters" });
    const values = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "uninitialized",
      dropEffect: "none",
      setData: (type: string, value: string) => void values.set(type, value),
      getData: (type: string) => values.get(type) ?? "",
    } as unknown as DataTransfer;

    fireEvent.dragStart(fileRow, { dataTransfer });
    fireEvent.dragOver(folderRow, { dataTransfer });
    fireEvent.drop(folderRow, { dataTransfer });

    const moved = `${DEFAULT_WORKSPACE_ID}/Filters/gain.asc`;
    await waitFor(() => expect(useProject.getState().workspaceFiles[moved]).toBeTruthy());
    // The whole point: the tab is still the same tab, still selected, and it
    // now names the file where it actually is.
    const tab = await screen.findByRole("tab", { name: /gain\.asc/ });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(useProject.getState().workspaceFiles[source]).toBeUndefined();

    // The basename never changed, so a name assertion alone would pass on a
    // tab still pointing at the old directory. Saving is what measures the
    // remap: the bytes have to land at the NEW path, and the old one must not
    // come back.
    act(() => useSchematic.getState().addComponent("resistor", 120, 120));
    fireEvent.keyDown(document.body, { key: "s", metaKey: true });
    await waitFor(() => {
      expect(useProject.getState().workspaceFiles[moved].contents).toContain("SYMBOL res");
    });
    expect(useProject.getState().workspaceFiles[source]).toBeUndefined();
  });
});

