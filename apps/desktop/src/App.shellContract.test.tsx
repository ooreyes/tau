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
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
import { ASSISTANT_PANEL_WIDTH } from "./components/assistantPanelState";
import { ANALYSIS_PANE_WIDTH, SHELL_LAYOUT } from "./chrome/resolveChrome";
import { SHELL, SHELL_CONTROLS, SHELL_SEPARATORS, type ShellSurface } from "./components/shellContract";
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
/**
 * Observers are remembered so a test can re-fire them, which is the only way to
 * model a window resize: App learns its width from a ResizeObserver, not from
 * the `resize` event, so dispatching one proves nothing.
 */
const liveObservers: { callback: ResizeObserverCallback; targets: Element[]; self: ResizeObserver }[] = [];
class TestResizeObserver {
  private readonly entry: { callback: ResizeObserverCallback; targets: Element[]; self: ResizeObserver };
  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, targets: [], self: this as unknown as ResizeObserver };
    liveObservers.push(this.entry);
  }
  observe(target: Element) {
    this.entry.targets.push(target);
    this.entry.callback(
      [{ target, contentRect: { width: shellWidth, height: 800 } } as ResizeObserverEntry],
      this.entry.self,
    );
  }
  unobserve() {}
  disconnect() {
    const at = liveObservers.indexOf(this.entry);
    if (at >= 0) liveObservers.splice(at, 1);
  }
}

/** Resize the window the way the browser would: same observers, new width. */
function resizeShellTo(width: number) {
  shellWidth = width;
  act(() => {
    for (const observer of liveObservers) {
      for (const target of observer.targets) {
        observer.callback(
          [{ target, contentRect: { width, height: 800 } } as ResizeObserverEntry],
          observer.self,
        );
      }
    }
  });
}
Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: TestResizeObserver,
});

beforeEach(() => {
  shellWidth = 1440;
  liveObservers.length = 0;
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
  await screen.findByRole("tab", { name: /untitled/ });
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
    //
    // This inventory is UNCHANGED by the circuit | analysis split, and that is
    // the assertion, not an incidental pass. The split moves the drawer from
    // the bottom edge to the right edge of the same workspace; it does not
    // hand the analysis its own landmark. One surface, one landmark, one name
    // was what stage 4a bought by merging three surfaces, and re-earning a
    // second entry here for a change of AXIS would spend it for nothing.
    expectExactly(["navRail", "circuitOverview", "assistant", "resultsDrawer"]);
    // The divider is a control, not a surface, so it is named in
    // SHELL_SEPARATORS rather than SHELL - and it has to be findable by that
    // name, because it is now the only way to change the analysis pane's size
    // (the drawer's height control is withheld in this dock, deliberately).
    expect(screen.getByRole("separator", { name: SHELL_SEPARATORS.analysisPane })).toBeTruthy();
  });

  it("at the 900px floor the simulator stacks, and the divider is absent", async () => {
    // A promise, not an accident. Below `SHELL_LAYOUT.splitMinWorkspace` the
    // simulator falls back to exactly today's stacked drawer, and the way that
    // fallback fails silently is a divider that renders anyway: `usePanelWidth`
    // would happily clamp a pane into a workspace that has no room for one, and
    // the circuit would be squeezed under its own floor with nothing on screen
    // saying why. Asserting the absence is what makes the fallback checkable.
    //
    // 900 is the app's stated minimum window (tauri.conf.json). With Bode open
    // - which `beforeEach` arranges - the workspace is 900 less the rail, the
    // assistant and its handle, which is under the split threshold.
    shellWidth = 900;
    await openProject();
    fireEvent.click(screen.getByRole("button", { name: "Simulator" }));

    expect(screen.queryByRole("separator", { name: SHELL_SEPARATORS.analysisPane })).toBeNull();
    // Same inventory at both widths: the drawer is the same landmark whichever
    // edge it is on, so narrowing the window must not add or drop a surface.
    expectExactly(["navRail", "circuitOverview", "assistant", "resultsDrawer"]);
  });

  it("with Settings open, the shell behind it leaves the accessibility tree", async () => {
    await openProject();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await screen.findByRole("dialog", { name: SHELL.settings.name });

    // A real modal takes the rest of the document out of the accessibility
    // tree, which is what the old hand-rolled `aria-modal` claimed without
    // enforcing. The canvas, the rail and the explorer all go, as they should.
    for (const key of ["canvas", "navRail", "explorer", "componentsRail"] as const) {
      expect(isPresent(SHELL[key]), `${key} is still exposed behind a modal`).toBe(false);
    }
    expect(isPresent(SHELL.settings)).toBe(true);

    // The Assistant stays mounted to preserve its transcript and panel width,
    // but a modal must make it inert and hide it from assistive technology.
    // A translucent sheet is not enough: otherwise a screen reader can reach
    // controls that a sighted user cannot interact with until Settings closes.
    expect(isPresent(SHELL.assistant)).toBe(false);
  });
});

/**
 * The divider, driven — not merely counted.
 *
 * The two cases above prove the separator is present at 1440 and absent at 900,
 * which is the split/stack decision and nothing else. What neither of them
 * touches is the thing the divider is FOR, and that is where the defect was:
 * `usePanelWidth` clamps every drag and arrow-key step against the static
 * `ANALYSIS_PANE_WIDTH` (max 560 = plotter floor + circuit floor), while
 * `resolveAnalysisPane` computes the real, workspace-dependent ceiling and
 * clamps only the RENDERED width to it. Between those two numbers the divider
 * banked a width the layout would never show, and the reader paid for it on the
 * NEXT gesture: the first stretch of it moved nothing at all.
 *
 * 1100px with Bode open is not a corner: workspace is 1100 − rail − handle −
 * assistant = 698px, comfortably above the 620px split threshold, and the real
 * ceiling there is 698 − 8 − 280 = 410px against the static 560px. A 150px
 * dead zone in an ordinary window.
 */
describe("the analysis divider is bounded by the layout, not by its config", () => {
  const workspaceAt = (width: number) =>
    width - SHELL_LAYOUT.railWidth - SHELL_LAYOUT.handleWidth - ASSISTANT_PANEL_WIDTH.defaultWidth;
  /** What `resolveAnalysisPane` allows here, recomputed from the same
   *  constants rather than copied as a number that can go stale. */
  const resolvedMax = (width: number) => Math.min(
    ANALYSIS_PANE_WIDTH.maxWidth,
    Math.max(
      ANALYSIS_PANE_WIDTH.minWidth,
      workspaceAt(width) - SHELL_LAYOUT.handleWidth - SHELL_LAYOUT.simulatorSchematicMin,
    ),
  );
  const paneWidth = () => {
    const column = document.querySelector(".workspace-column--split") as HTMLElement | null;
    const raw = column?.style.getPropertyValue("--analysis-pane-w") ?? "";
    return Number.parseInt(raw, 10);
  };
  /** One gesture: press on the handle, move, release. Widening is leftward,
   *  which is the "edge: left" convention the handle is configured with. */
  const dragDivider = (dx: number) => {
    const handle = screen.getByRole("separator", { name: SHELL_SEPARATORS.analysisPane });
    fireEvent.pointerDown(handle, { button: 0, clientX: 600, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 600 + dx, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 600 + dx, clientY: 300, pointerId: 1 });
  };

  async function openSimulatorAt(width: number) {
    shellWidth = width;
    await openProject();
    fireEvent.click(screen.getByRole("button", { name: "Simulator" }));
    await screen.findByRole("separator", { name: SHELL_SEPARATORS.analysisPane });
  }

  it("never lets a drag squeeze the circuit pane past its floor", async () => {
    await openSimulatorAt(1100);
    const ceiling = resolvedMax(1100);
    expect(ceiling).toBeLessThan(ANALYSIS_PANE_WIDTH.maxWidth); // the band under test

    dragDivider(-400); // hard left: ask for far more than the layout can give
    expect(paneWidth()).toBe(ceiling);
    // The floor this protects. `.workspace-column > .sim-schematic-pane` is
    // `min-width: 0` in App.css, so the stylesheet is NOT holding this line -
    // the arithmetic is.
    expect(workspaceAt(1100) - SHELL_LAYOUT.handleWidth - paneWidth())
      .toBeGreaterThanOrEqual(SHELL_LAYOUT.simulatorSchematicMin);
  });

  it("responds to the very next drag after one that hit the stop", async () => {
    await openSimulatorAt(1100);
    const ceiling = resolvedMax(1100);

    dragDivider(-400);
    expect(paneWidth()).toBe(ceiling);

    // A separate gesture, narrowing by 60px. This is the assertion the whole
    // case exists for: before the divider was clamped to the layout's ceiling,
    // it started this drag believing it sat at 560, so 60px of travel landed at
    // 500 - still above the 410 the screen was showing - and the divider did
    // not move. Two more gestures like it would still not have moved it.
    dragDivider(60);
    expect(paneWidth()).toBe(ceiling - 60);
  });

  it("reports its own live bounds to assistive technology", async () => {
    await openSimulatorAt(1100);
    dragDivider(-400);

    const handle = screen.getByRole("separator", { name: SHELL_SEPARATORS.analysisPane });
    expect(handle.getAttribute("aria-valuemax")).toBe(String(resolvedMax(1100)));
    // valuenow tracked the rendered pane even while the hook held 560, so the
    // number was right and the control was still dead. Both must agree now.
    expect(handle.getAttribute("aria-valuenow")).toBe(String(paneWidth()));
  });

  /**
   * The half that must NOT change. A window that got narrower is not the user
   * changing their mind: the remembered width is clamped for display and handed
   * back when there is room for it again. Clamping the divider's own value on a
   * resize would silently shrink a pane the reader had chosen.
   */
  it("hands a wide pane back when the window has room for it again", async () => {
    await openSimulatorAt(1600);
    dragDivider(-400);
    const wide = paneWidth();
    expect(wide).toBe(ANALYSIS_PANE_WIDTH.maxWidth);

    // Narrow, then widen, without touching the divider.
    resizeShellTo(1100);
    expect(paneWidth()).toBe(resolvedMax(1100));
    resizeShellTo(1600);

    expect(paneWidth()).toBe(wide);
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
    for (const label of [SHELL_CONTROLS.railExplorer]) {
      expect(rail.querySelector(`button[aria-label="${label}"]`)).not.toBeNull();
    }
    /*
     * Settings now lives HERE, and this assertion is inverted from what it used
     * to say. It previously required the rail to have no Settings button,
     * because the gear sat in the status strip's lower-right utility cluster.
     * That turned out to be a hiding place: `StatusBar` returns null in a
     * resting schematic, which is precisely the state the review screenshot was
     * taken in - so the control was not in the wrong corner, it was absent from
     * the window entirely.
     *
     * Checked by POSITION, not presence: the ask was specifically "bottom left
     * in the section above the horizontal line", so presence alone would pass a
     * gear dropped at the top of the rail.
     */
    const settings = rail.querySelector<HTMLElement>('button[aria-label="Settings"]');
    expect(settings, "Settings must be reachable from the rail").not.toBeNull();
    const foot = rail.querySelector(".rail-foot");
    expect(foot, "the rail needs a foot group to hold it").not.toBeNull();
    expect(foot!.contains(settings!)).toBe(true);
    // Last in the tab order, and after every destination button.
    const railButtons = [...rail.querySelectorAll("button")];
    expect(railButtons[railButtons.length - 1]).toBe(settings);
    /*
     * The "horizontal line" from the request is the FOOT's terminating rule, not
     * the rail's first separator - the rail has two, and querySelector returns
     * the one between Search and Components, which of course precedes Settings.
     * Scope to the foot and require the line to come after the gear, which is
     * what "in the section above the horizontal line" means.
     */
    const footRule = foot!.querySelector(".rail-separator");
    expect(footRule, "the foot needs its terminating rule").not.toBeNull();
    expect(settings!.compareDocumentPosition(footRule!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
