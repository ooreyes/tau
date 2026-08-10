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
import { useProject } from "./store/useProject";
import { useSchematic } from "./store/useSchematic";

const defaultRenameNode = useProject.getState().renameNode;

void SettingsWindow;
void AssistantPanel;
void SimulationPanel;

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
  await screen.findByRole("complementary", { name: "Assistant" });
}

describe("App schematic workspace tools", () => {
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
    expect(within(dialog).getByText(/starts a new untitled schematic/i)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear schematic" }));

    expect(await screen.findByRole("tab", { name: /untitled\.asc/ })).toBeTruthy();
    expect(useSchematic.getState().components).toEqual([]);
    expect(useSchematic.getState().directives).toEqual([]);
    expect(useSchematic.getState().ascDataFlags).toEqual([]);
    expect(useProject.getState().workspaceFiles[originalPath].contents).toBe(originalContents);

    act(() => useSchematic.getState().addComponent("resistor", 256, 192));
    fireEvent.keyDown(document.body, { key: "s", metaKey: true });

    await waitFor(() => {
      const saved = useProject.getState().workspaceFiles[replacementPath]?.contents;
      expect(saved).toContain("SYMBOL res");
      expect(saved).not.toContain("WINDOW 0 32 32");
      expect(saved).not.toContain(".tran 10m");
      expect(saved).not.toContain("DATAFLAG");
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

describe("The modal editors are fetched the first time they are asked for", () => {
  // Model libraries and Simulation setup are code-split, and a split dialog
  // only earns its keep if App withholds the element until something opens it
  // — a lazy component that is rendered closed on every frame fetches its
  // chunk during first paint and saves nothing. That withholding is the part
  // that can fail silently: a latch that never flips leaves a toolbar button
  // which opens nothing at all, with no error anywhere. Each case therefore
  // presses the real button and waits for the real dialog.
  it("opens Model libraries from the schematic toolbar", async () => {
    await renderOpenProject();

    fireEvent.click(screen.getByRole("button", { name: "Model libraries" }));

    const dialog = await screen.findByRole("dialog", { name: "Model libraries" });
    expect(within(dialog).getByText(/Attached vendor SPICE model files/)).toBeTruthy();
  });

  it("opens Simulation setup from the schematic toolbar", async () => {
    await renderOpenProject();

    fireEvent.click(screen.getByRole("button", { name: "Simulation setup" }));

    const dialog = await screen.findByRole("dialog", { name: "Simulation setup" });
    expect(within(dialog).getByText(/Choose a common analysis/)).toBeTruthy();
  });
});

describe("Settings is a surface in this window", () => {
  it("opens Settings over the schematic and closes it again, from every entry point", async () => {
    await renderOpenProject();

    // The toolbar gear and the rail button are separate affordances; both have
    // to reach the same in-window surface, because there is no longer a second
    // window for either of them to fall back to.
    const entryPoints = screen.getAllByRole("button", { name: "Settings" }).length;
    expect(entryPoints).toBeGreaterThan(1);

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
      expect(screen.getByRole("tab", { name: /untitled\.asc/, hidden: true })).toBeTruthy();

      fireEvent.click(within(settings).getByRole("button", { name: "Close settings" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull());
    }
  });

  it("keeps focus inside Settings while it is open", async () => {
    await renderOpenProject();

    const rail = screen.getByRole("navigation", { name: "Workspace sections" });
    fireEvent.click(within(rail).getByRole("button", { name: "Settings" }));

    const settingsDialog = await screen.findByRole("dialog", { name: "Settings" });
    await waitFor(() => expect(settingsDialog.contains(document.activeElement)).toBe(true));
  });

  it("returns focus to the control that opened Settings", async () => {
    await renderOpenProject();

    // The rail button is the control under test; it is its own affordance
    // (see the entry-point loop above), so it stays addressable after the
    // dialog unmounts and can be compared by reference below.
    const rail = screen.getByRole("navigation", { name: "Workspace sections" });
    const openSettingsButton = within(rail).getByRole("button", { name: "Settings" });
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
