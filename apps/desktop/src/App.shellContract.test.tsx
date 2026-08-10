// @vitest-environment jsdom
/**
 * The shell's shape, asserted as a whole, one app state at a time.
 *
 * Every other App-level test asks "is this one thing here?". This one asks
 * "what is the complete set of shell surfaces right now, and what is
 * deliberately absent?", because the canvas-first redesign (REDESIGN.md) moves
 * nearly all of them and the dangerous change is the silent one: a surface that
 * quietly stops rendering, or two that end up mounted at once under the same
 * accessible name.
 *
 * Asserting absence is the half that earns its keep. "Chrome collapses when
 * unused" invites implementing a hidden panel as `translateX(100%)`, which
 * leaves it in the accessibility tree and makes `getByRole` ambiguous. A
 * surface that is collapsed must be gone from the tree, and the only way to
 * hold a redesign to that is to check for its absence rather than just not
 * checking for it.
 *
 * This file is a review instrument. A stage that changes it is changing the
 * shell contract, which is allowed, but must be deliberate and called out in
 * the commit. A stage that changes it incidentally is the signal to stop.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The same two mocks every App-level suite takes: keep the project store off
// its in-memory workspace seeding, and keep the assistant's local-AI polling
// out of a layout test.
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
import { SHELL, SHELL_CONTROLS, type ShellSurface } from "./components/shellContract";
import { simulationPreferences } from "./lib/simulationPreferences";
import { DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME } from "./project/defaultWorkspace";
// The shell assertion begins once Settings is visible.  Keep that assertion
// independent of another worker's lazy-module transform/load backlog; this
// still renders the production `React.lazy` boundary, with its real module.
import { SettingsWindow } from "./settings/SettingsWindow";
import { AssistantPanel } from "./components/AssistantPanel";
import { SimulationPanel } from "./components/SimulationPanel";
import { useProject } from "./store/useProject";
import { useSchematic } from "./store/useSchematic";

const defaultRenameNode = useProject.getState().renameNode;

void SettingsWindow;
void AssistantPanel;
void SimulationPanel;

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

let shellWidth = 1440;
class TestResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ target, contentRect: { width: shellWidth, height: 800 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: TestResizeObserver,
});

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

/** Present in the accessibility tree, by role and name together. */
function isPresent(surface: ShellSurface): boolean {
  return screen.queryAllByRole(surface.role, { name: surface.name }).length > 0;
}

/**
 * Assert the complete inventory: everything in `expected` is present, and
 * every other surface in the contract is absent. Reported as two sorted lists
 * rather than one failing lookup, so a reviewer sees the whole delta at once
 * instead of fixing them one run at a time.
 */
function expectExactly(expected: readonly (keyof typeof SHELL)[]) {
  const want = new Set<string>(expected);
  const missing: string[] = [];
  const unexpected: string[] = [];
  for (const [key, surface] of Object.entries(SHELL)) {
    const here = isPresent(surface);
    if (want.has(key) && !here) missing.push(`${key} (${surface.role} "${surface.name}")`);
    if (!want.has(key) && here) unexpected.push(`${key} (${surface.role} "${surface.name}")`);
  }
  expect({ missing: missing.sort(), unexpected: unexpected.sort() }).toEqual({
    missing: [],
    unexpected: [],
  });
}

async function openProject() {
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

describe("shell inventory by app state", () => {
  it("with no project open, offers only the way in", () => {
    render(<App />);
    expectExactly(["navRail", "explorer", "projectStart", "emptySchematic"]);
  });

  it("with a schematic open, shows the editing shell and no simulator surfaces", async () => {
    await openProject();
    await screen.findByRole(SHELL.assistant.role, { name: SHELL.assistant.name });
    // `emptySchematic` is here because the new circuit genuinely is empty: it
    // is the canvas's own placeholder, not a leftover from the no-project
    // state. It should disappear once the schematic has parts, and a stage
    // that leaves it mounted over a populated canvas will fail this.
    expectExactly([
      "navRail",
      "explorer",
      "canvas",
      "componentsRail",
      "assistant",
      "emptySchematic",
      // The results drawer is present in the schematic too, collapsed to its
      // peek strip. That is the merge: diagnostics used to be a strip welded
      // under the editor and the plotter a column only the simulator had, so
      // "where do I read what just happened" had two different answers.
      "resultsDrawer",
    ]);
  });

  it("does not mount Bode until it is opened, then renders the real assistant surface", async () => {
    storage.set("tau.assistant.open", "0");
    await openProject();

    expect(screen.queryByRole(SHELL.assistant.role, { name: SHELL.assistant.name })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Bode" }));

    expect(await screen.findByRole(SHELL.assistant.role, { name: SHELL.assistant.name })).toBeTruthy();
  });

  it("does not mount waveform controls until entering Simulator", async () => {
    await openProject();

    expect(screen.queryByRole("button", { name: "Toggle advanced settings" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Simulator" }));

    expect(await screen.findByRole("button", { name: "Toggle advanced settings" })).toBeTruthy();
  });

  it("in the simulator, replaces the canvas with the read-only overview", async () => {
    await openProject();
    fireEvent.click(screen.getByRole("button", { name: "Simulator" }));
    // Explorer and the components rail are not rendered in simulator mode.
    //
    // The drawer is here from the moment the simulator opens, holding the
    // waveforms. It used to be `analysisPlotter`, declared in the contract as
    // role "region" while it rendered as an <aside>, which maps to
    // complementary - so `isPresent` returned false for it in every state and
    // the inventory could neither require nor forbid it. Two wrongs reading
    // as one right is the exact failure this file exists to prevent, and it
    // was sitting on the surface stage 4 replaces.
    expectExactly(["navRail", "circuitOverview", "assistant", "resultsDrawer"]);
  });

  it("with Settings open, the shell behind it leaves the accessibility tree", async () => {
    await openProject();
    fireEvent.click(
      screen.getByRole("navigation", { name: SHELL.navRail.name }).querySelector("button[aria-label='Settings']")!,
    );
    await screen.findByRole("dialog", { name: SHELL.settings.name });

    // A real modal takes the rest of the document out of the accessibility
    // tree, which is what the old hand-rolled `aria-modal` claimed without
    // enforcing. The canvas, the rail and the explorer all go, as they should.
    for (const key of ["canvas", "navRail", "explorer", "componentsRail"] as const) {
      expect(isPresent(SHELL[key]), `${key} is still exposed behind a modal`).toBe(false);
    }
    expect(isPresent(SHELL.settings)).toBe(true);

    // KNOWN GAP, deliberately asserted as it currently is rather than as it
    // should be. The assistant column stays in the tree while Settings is
    // modal over it, even though its whole ancestor chain is unhidden and
    // every sibling surface disappears. I could not account for the mechanism,
    // and pinning behaviour I do not understand as "correct" is how a bug gets
    // blessed. Pinned as-is so it cannot change silently; REDESIGN.md stage 3
    // owns resolving it, and this assertion should flip to `false` there.
    expect(
      isPresent(SHELL.assistant),
      "assistant modality gap resolved: flip this to false and delete the note",
    ).toBe(true);
  });
});

describe("surfaces that must not appear twice", () => {
  it("mounts each shell surface at most once", async () => {
    await openProject();
    const duplicated = Object.entries(SHELL)
      .map(([key, surface]) => ({
        key,
        count: screen.queryAllByRole(surface.role, { name: surface.name }).length,
      }))
      .filter((entry) => entry.count > 1);
    // Two live surfaces sharing a name means an old and a new implementation
    // are both mounted, which is the in-place migration going wrong.
    expect(duplicated).toEqual([]);
  });
});

describe("placement assertions a grep cannot make", () => {
  /**
   * Moved here from `scripts/design-system-drift.sh`, which used to prove this
   * by grepping App.tsx for an import of `ui/sonner`. That encoded the file
   * layout into the gate, and the redesign moves the shell composition out of
   * App.tsx. What the check actually cared about was that the toaster is
   * mounted once at the app root, which is a rendering fact, so it is asserted
   * by rendering.
   */
  it("mounts exactly one toaster at the app root", async () => {
    await openProject();
    const toasters = document.querySelectorAll("[data-sonner-toaster]");
    expect(toasters).toHaveLength(1);
    expect(toasters[0].closest(".app")).not.toBeNull();
  });

  it("keeps the nav rail present in every state, including with no project", () => {
    render(<App />);
    expect(isPresent(SHELL.navRail)).toBe(true);
    // The rail is the one surface REDESIGN.md says never collapses, so its
    // controls are the fallback way back to anything that does.
    const rail = screen.getByRole("navigation", { name: SHELL.navRail.name });
    for (const label of [SHELL_CONTROLS.railExplorer, SHELL_CONTROLS.railSettings]) {
      expect(rail.querySelector(`button[aria-label="${label}"]`)).not.toBeNull();
    }
  });
});
