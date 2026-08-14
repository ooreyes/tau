// @vitest-environment jsdom
/**
 * What counts as "the app already holds this answer".
 *
 * Selecting a tab in the analysis rail IS the run gesture, and `hasFreshResult`
 * is the one thing allowed to turn that gesture into a no-op. It compares the
 * document signature, the installed model libraries and the mode's own setup
 * against what the stored result was run against — a good rule, with one hole
 * in it: it never asked whether the stored result was a RESULT. A run that
 * never reached the solver was filed under the same key as one that did, so a
 * refusal became this circuit's cached answer and stayed that way until the
 * sheet was touched or Run was pressed. That is the shape of the engine-lease
 * bug (`App.runTransport.test.tsx`), but it is not limited to it: any failure
 * outside the document signature — a busy engine, a library not yet installed —
 * lands the same way.
 *
 * This file owns the case because it needs a solver that answers differently on
 * two identical requests, which is exactly what the other App-level suites must
 * not have.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/**
 * A solver that refuses once and then works, standing in for every reason an
 * `.op` can fail that the document signature cannot see. The real solver runs
 * from the second call on, so the success half is a genuine operating point and
 * not a fixture.
 */
let opAttempts = 0;
const OP_REFUSAL = "A live simulation is running. Stop it before starting another analysis.";
vi.mock("./simulation/operatingPoint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./simulation/operatingPoint")>();
  return {
    ...actual,
    runOperatingPoint: (...args: Parameters<typeof actual.runOperatingPoint>) => {
      opAttempts += 1;
      if (opAttempts === 1) return { ok: false as const, message: OP_REFUSAL, warnings: [], nets: [] };
      return actual.runOperatingPoint(...args);
    },
  };
});

import App from "./App";
import { DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME } from "./project/defaultWorkspace";
import { useProject } from "./store/useProject";
import { useSchematic } from "./store/useSchematic";
import type { SchematicComponent } from "./schematic/types";

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
    this.callback(
      [{ target, contentRect: { width: 1440, height: 600 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: TestResizeObserver });

beforeEach(() => {
  opAttempts = 0;
  storage.clear();
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
});
afterEach(() => cleanup());

/** A divider with a ground: something `.op` can genuinely answer. */
const DIVIDER: SchematicComponent[] = [
  { id: "v1", kind: "vsource", x: -128, y: 0, rotation: 0, value: "5", label: "V1" },
  { id: "r1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k", label: "R1" },
  { id: "r2", kind: "resistor", x: 128, y: 0, rotation: 0, value: "2k", label: "R2" },
  { id: "gnd", kind: "ground", x: -128, y: 96, rotation: 0, value: "", label: "" },
];
const DIVIDER_WIRES = [
  { id: "w1", points: [{ x: -128, y: -32 }, { x: -128, y: -64 }, { x: -32, y: -64 }, { x: -32, y: 0 }] },
  { id: "w2", points: [{ x: 32, y: 0 }, { x: 96, y: 0 }] },
  { id: "w3", points: [{ x: 160, y: 0 }, { x: 192, y: 0 }, { x: 192, y: 96 }, { x: -128, y: 96 }] },
  { id: "w4", points: [{ x: -128, y: 32 }, { x: -128, y: 96 }] },
];

/** Radix activates a tab on the pointer going down, and only when the value
 *  actually changes — hence the detour through another mode below. */
const selectAnalysisTab = async (name: string) =>
  fireEvent.mouseDown(await screen.findByRole("tab", { name }), { button: 0 });

async function openSimulator() {
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
  useSchematic.setState({
    components: DIVIDER,
    wires: DIVIDER_WIRES,
    directives: [],
    past: [],
    future: [],
  });
  fireEvent.click(screen.getByRole("button", { name: "Simulator" }));
  await screen.findByRole("group", { name: "Run transport" });
}

describe("App - a run that never reached the solver is not a cached answer", () => {
  it("tries the .op again after a failure instead of serving it back", async () => {
    await openSimulator();

    await selectAnalysisTab("Operating point (.op)");
    await waitFor(() => expect(screen.getAllByText(OP_REFUSAL).length).toBeGreaterThan(0));
    expect(opAttempts).toBe(1);

    // Away and back, because the rail only fires on a change of value. Nothing
    // about the document has changed between the two visits — which is exactly
    // why the stale key matched and the second visit used to show the refusal
    // again without asking the solver anything.
    await selectAnalysisTab("AC sweep (.ac)");
    await selectAnalysisTab("Operating point (.op)");

    await waitFor(() => expect(document.querySelector(".op-table")).not.toBeNull(), { timeout: 6000 });
    expect(opAttempts).toBe(2);
    expect(screen.queryAllByText(OP_REFUSAL)).toEqual([]);
  });

  /**
   * The half that must not regress: a result that DID reach the solver still
   * short-circuits the re-run, which is the whole reason `hasFreshResult`
   * exists — TRAN, AC, back to TRAN must not re-solve an unchanged circuit.
   */
  it("still skips the re-run when the stored result succeeded", async () => {
    await openSimulator();

    // Burn the one scripted failure, then get a real answer on the second try.
    await selectAnalysisTab("Operating point (.op)");
    await waitFor(() => expect(screen.getAllByText(OP_REFUSAL).length).toBeGreaterThan(0));
    await selectAnalysisTab("AC sweep (.ac)");
    await selectAnalysisTab("Operating point (.op)");
    await waitFor(() => expect(document.querySelector(".op-table")).not.toBeNull(), { timeout: 6000 });
    expect(opAttempts).toBe(2);

    await selectAnalysisTab("AC sweep (.ac)");
    await selectAnalysisTab("Operating point (.op)");
    await waitFor(() => expect(document.querySelector(".op-table")).not.toBeNull());
    expect(opAttempts).toBe(2);
  });
});
