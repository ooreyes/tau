// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hierarchyMocks = vi.hoisted(() => ({
  nativeAc: vi.fn(),
  nativeSteppedAc: vi.fn(),
  nativeDc: vi.fn(),
  nativeSteppedDc: vi.fn(),
  nativeOp: vi.fn(),
  previewAc: vi.fn(),
  previewDc: vi.fn(),
  nativeDecks: [] as string[],
}));

// This is an App-host test, so the native runtime is deliberately present even
// in jsdom. The native calls still stop at an injected boundary: the test
// proves which production callback App chooses and inspects the recursive deck
// builder it hands to that callback, without pretending to be ngspice.
vi.mock("./engine/nativeSpice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./engine/nativeSpice")>()),
  isNativeSpiceRuntime: () => true,
  runNativeAcSweep: hierarchyMocks.nativeAc,
  runNativeSteppedAcSweep: hierarchyMocks.nativeSteppedAc,
  runNativeDcSweep: hierarchyMocks.nativeDc,
  runNativeSteppedDcSweep: hierarchyMocks.nativeSteppedDc,
  runNativeOperatingPoint: hierarchyMocks.nativeOp,
}));

// A project-linked sheet must never reach either preview solver, even when the
// native family path refuses a shape. Throwing here makes an accidental
// fallback fail the test instead of merely producing a second plausible result.
vi.mock("./simulation/acSweep", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./simulation/acSweep")>()),
  runAcSweep: hierarchyMocks.previewAc,
}));
vi.mock("./simulation/dcSweep", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./simulation/dcSweep")>()),
  runDcSweep: hierarchyMocks.previewDc,
}));

vi.mock("./project/fsBridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./project/fsBridge")>()),
  detectFsCapability: async () => "tauri" as const,
}));
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
import { buildSubcircuitPinOverride } from "./schematic/subcircuitGeometry";
import { DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME, defaultWorkspaceTree } from "./project/defaultWorkspace";
import { simulationPreferences } from "./lib/simulationPreferences";
import { useProject } from "./store/useProject";
import { useSchematic } from "./store/useSchematic";

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
Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};

const childDocument = {
  components: [{ id: "r-child", kind: "resistor" as const, x: 0, y: 0, rotation: 0 as const, value: "1k", label: "RCHILD" }],
  wires: [],
  netLabels: [
    { id: "child-in", x: -32, y: 0, text: "IN", port: "In" as const },
    { id: "child-out", x: 32, y: 0, text: "OUT", port: "Out" as const },
  ],
  projectPorts: [
    { name: "IN", labelId: "child-in", direction: "In" as const },
    { name: "OUT", labelId: "child-out", direction: "Out" as const },
  ],
  directives: [],
};

function rootDocument(domain: "ac" | "dc") {
  const linked = {
    id: "x1",
    kind: "subckt" as const,
    x: 0,
    y: 0,
    rotation: 0 as const,
    value: "ChildModel",
    label: "X1",
    pinOverride: buildSubcircuitPinOverride({ x: 0, y: 0, rotation: 0 }, ["IN", "OUT"]),
    projectSubcircuit: { sheetPath: "child.sim", model: "ChildModel", ports: ["IN", "OUT"] },
  };
  return {
    components: [
      linked,
      { id: "v1", kind: "vsource" as const, x: -80, y: 32, rotation: 0 as const, value: domain === "ac" ? "5 AC {amp}" : "5", label: "V1" },
      { id: "r1", kind: "resistor" as const, x: 80, y: 0, rotation: 0 as const, value: domain === "dc" ? "{load}" : "1k", label: "R1" },
      { id: "g1", kind: "ground" as const, x: -80, y: 64, rotation: 0 as const, value: "", label: "" },
      { id: "g2", kind: "ground" as const, x: 112, y: 0, rotation: 0 as const, value: "", label: "" },
    ],
    wires: [
      { id: "wire-v", points: [{ x: -80, y: 0 }, { x: -48, y: 0 }] },
    ],
    netLabels: [],
    directives: domain === "ac"
      ? [".ac dec 1 10 100", ".step param amp list 1 2"]
      : [".dc V1 0 1 1", ".step param load list 1k 2k"],
  };
}

function openHierarchy(domain: "ac" | "dc") {
  const rootPath = `${DEFAULT_WORKSPACE_ID}/root.sim`;
  const childPath = `${DEFAULT_WORKSPACE_ID}/child.sim`;
  const rootFile = { path: rootPath, name: "root.sim", contents: JSON.stringify(rootDocument(domain)), kind: "sim" as const };
  const childFile = { path: childPath, name: "child.sim", contents: JSON.stringify(childDocument), kind: "sim" as const };
  useProject.setState({
    rootPath: DEFAULT_WORKSPACE_ID,
    rootName: DEFAULT_WORKSPACE_NAME,
    tree: defaultWorkspaceTree([rootFile, childFile]),
    expanded: [DEFAULT_WORKSPACE_ID],
    workspaceFiles: { [rootPath]: rootFile, [childPath]: childFile },
    error: null,
    capability: "none",
  });
  render(<App />);
  return screen.findByRole("button", { name: "root.sim" }).then((root) => {
    fireEvent.click(root);
    // EditorTabs intentionally omits the `.sim` suffix from the visible tab
    // label; the brand/file title above still shows the complete filename.
    return screen.findByRole("tab", { name: "root" });
  });
}

describe("App project hierarchy execution", () => {
  beforeEach(() => {
    storage.clear();
    simulationPreferences.reset();
    useSchematic.getState().newCircuit();
    useProject.setState({
      rootPath: null,
      rootName: null,
      tree: [],
      expanded: [],
      workspaceFiles: {},
      error: null,
      capability: "tauri",
    });
    hierarchyMocks.nativeAc.mockReset();
    hierarchyMocks.nativeSteppedAc.mockReset();
    hierarchyMocks.nativeDc.mockReset();
    hierarchyMocks.nativeSteppedDc.mockReset();
    hierarchyMocks.nativeOp.mockReset();
    hierarchyMocks.previewAc.mockReset();
    hierarchyMocks.previewDc.mockReset();
    hierarchyMocks.nativeDecks.length = 0;

    hierarchyMocks.nativeAc.mockImplementation(async (schematic: { buildDeck?: (analysis: { kind: "ac"; startHz: number; stopHz: number; pointsPerDecade: number }) => { netlist: string } }) => {
      try {
        hierarchyMocks.nativeDecks.push(schematic.buildDeck?.({ kind: "ac", startHz: 10, stopHz: 100, pointsPerDecade: 1 }).netlist ?? "");
      } catch (error) {
        hierarchyMocks.nativeDecks.push(`ERROR:${error instanceof Error ? error.message : String(error)}`);
      }
      return { ok: true, freqs: [10, 100], traces: [], warnings: [] };
    });
    hierarchyMocks.nativeSteppedAc.mockResolvedValue(null);
    hierarchyMocks.nativeDc.mockImplementation(async (schematic: { buildDeck?: (analysis: { kind: "dc"; source: string; start: number; stop: number; step: number }) => { netlist: string } }) => {
      try {
        hierarchyMocks.nativeDecks.push(schematic.buildDeck?.({ kind: "dc", source: "V1", start: 0, stop: 1, step: 1 }).netlist ?? "");
      } catch (error) {
        hierarchyMocks.nativeDecks.push(`ERROR:${error instanceof Error ? error.message : String(error)}`);
      }
      return { ok: true, source: "V1", sweep: [0, 1], nets: [], warnings: [] };
    });
    hierarchyMocks.nativeSteppedDc.mockImplementation(async (schematic: { buildDeck?: (analysis: { kind: "dc"; source: string; start: number; stop: number; step: number }) => { netlist: string } }) => {
      try {
        hierarchyMocks.nativeDecks.push(schematic.buildDeck?.({ kind: "dc", source: "V1", start: 0, stop: 1, step: 1 }).netlist ?? "");
      } catch (error) {
        hierarchyMocks.nativeDecks.push(`ERROR:${error instanceof Error ? error.message : String(error)}`);
      }
      return null;
    });
    hierarchyMocks.nativeOp.mockResolvedValue({ ok: true, nets: [], warnings: [] });
    hierarchyMocks.previewAc.mockImplementation(() => { throw new Error("preview AC fallback invoked"); });
    hierarchyMocks.previewDc.mockImplementation(() => { throw new Error("preview DC fallback invoked"); });
  });

  afterEach(() => cleanup());

  it("uses the recursive deck for AC and refuses an unsupported stepped AC stimulus without preview", async () => {
    await openHierarchy("ac");
    fireEvent.click(screen.getByRole("button", { name: "Simulator" }));
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Operating point (.op)" }), { button: 0 });
    await waitFor(() => expect(hierarchyMocks.nativeOp).toHaveBeenCalled());
    await waitFor(() => expect((screen.getByRole("tab", { name: "AC sweep (.ac)" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "AC sweep (.ac)" }), { button: 0 });

    await waitFor(() => expect(hierarchyMocks.nativeAc).toHaveBeenCalled());
    expect(hierarchyMocks.nativeSteppedAc).not.toHaveBeenCalled();
    expect(hierarchyMocks.previewAc).not.toHaveBeenCalled();
    expect(hierarchyMocks.nativeDecks.some((netlist) => netlist.includes(".subckt ChildModel IN OUT"))).toBe(true);
    expect(screen.getByRole("tab", { name: "AC sweep (.ac)" }).getAttribute("aria-selected")).toBe("true");
  });

  it("uses the recursive deck for DC and refuses a missing native family instead of rerunning preview", async () => {
    await openHierarchy("dc");
    fireEvent.click(screen.getByRole("button", { name: "Simulator" }));
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Operating point (.op)" }), { button: 0 });
    await waitFor(() => expect(hierarchyMocks.nativeOp).toHaveBeenCalled());
    await waitFor(() => expect((screen.getByRole("tab", { name: "DC sweep (.dc)" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "DC sweep (.dc)" }), { button: 0 });

    await waitFor(() => expect(hierarchyMocks.nativeSteppedDc).toHaveBeenCalled());
    expect(hierarchyMocks.previewDc).not.toHaveBeenCalled();
    expect(hierarchyMocks.nativeDecks.some((netlist) => netlist.includes(".subckt ChildModel IN OUT"))).toBe(true);
    expect(screen.getByRole("tab", { name: "DC sweep (.dc)" }).getAttribute("aria-selected")).toBe("true");
    expect((await screen.findAllByText(/did not return a family|native single-deck/i)).length).toBeGreaterThan(0);
  });
});
