// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// Same two mocks the other App-level suites take: keep the project store off
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
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});
afterEach(() => cleanup());

/**
 * 5 V source, switch, 1k, ground - a real, solvable loop, because one of these
 * tests runs it. `S1` sits at the origin so a pointer event at (0, 0) lands on
 * its body: jsdom reports a zero-size SVG, so client and world coordinates
 * coincide.
 */
const SWITCHED_DIVIDER: SchematicComponent[] = [
  { id: "s1", kind: "switch", x: 0, y: 0, rotation: 0, value: "open", label: "S1" },
  { id: "v1", kind: "vsource", x: -128, y: 96, rotation: 0, value: "5", label: "V1" },
  { id: "r1", kind: "resistor", x: 160, y: 0, rotation: 0, value: "1k", label: "R1" },
  { id: "gnd", kind: "ground", x: -128, y: 160, rotation: 0, value: "", label: "" },
];
const SWITCHED_DIVIDER_WIRES = [
  { id: "w1", points: [{ x: -128, y: 128 }, { x: -128, y: 160 }] },
  { id: "w2", points: [{ x: -128, y: 64 }, { x: -128, y: 0 }, { x: -32, y: 0 }] },
  { id: "w3", points: [{ x: 32, y: 0 }, { x: 128, y: 0 }] },
  { id: "w4", points: [{ x: 192, y: 0 }, { x: 192, y: 160 }, { x: -128, y: 160 }] },
];

const PASSIVE_DIVIDER: SchematicComponent[] = [
  { id: "v1", kind: "vsource", x: -128, y: 0, rotation: 0, value: "5", label: "V1" },
  { id: "r1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k", label: "R1" },
  { id: "c1", kind: "capacitor", x: 128, y: 0, rotation: 0, value: "100n", label: "C1" },
  { id: "gnd", kind: "ground", x: 128, y: 96, rotation: 0, value: "", label: "" },
];

async function openSimulator(
  components: SchematicComponent[],
  { directives = [".op"], wires = [] as { id: string; points: { x: number; y: number }[] }[] } = {},
) {
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
  act(() => useSchematic.setState({ components, wires, directives, past: [], future: [] }));
  fireEvent.click(screen.getByRole("button", { name: "Simulator" }));
}

const liveBand = () => screen.queryByRole("group", { name: "Live controls" });
const bandText = () => liveBand()?.textContent ?? "";

/**
 * A reader who never hovers the exact symbol has no way to learn that the
 * switch on the drawing is clickable - the simulator's own padlock says the
 * circuit is view-only. These cover the detection that decides whether to say
 * so, and the readout that makes the answer live.
 */
describe("App - live controls band in the simulator", () => {
  it("names the control, its position, and what operating it costs", async () => {
    await openSimulator(SWITCHED_DIVIDER);

    expect(bandText()).toContain("S1");
    expect(bandText()).toContain("OPEN");
    expect(bandText()).toContain(
      "Toggle S1 on the circuit and the operating point re-solves.",
    );
  });

  /**
   * This case used to assert the transient sentence flat, as though the
   * authored directive alone decided it. It no longer does, and the reason is
   * the live run: while a solve is in flight `liveActuation.ts` halts, alters
   * one device and resumes the SAME transient, so the trace bends instead of
   * re-running and "the transient re-runs" would be describing a restart from
   * t = 0 that does not happen. The sentence is therefore a function of the run
   * state, and this case is now scoped to the state it is true in — idle, with
   * an authored `.tran`, which the transport shows as an editable Window rather
   * than energising continuously. `liveControls.test.ts` covers the energised
   * sentence, which cannot be reached here (jsdom has no ngspice bridge).
   */
  it("follows the authored analysis while nothing is energised", async () => {
    await openSimulator(SWITCHED_DIVIDER, { directives: [".tran 1m"] });
    // The document's `.tran` pre-selects Window rather than being applied
    // invisibly, so the run this sentence promises is one the user can see the
    // bounds of and edit.
    expect(
      (screen.getByRole("radio", { name: "Window: run a fixed time span" }) as HTMLElement)
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByRole("button", { name: "Run this circuit" })).toBeTruthy();
    expect(bandText()).toContain(
      "Toggle S1 on the circuit and the transient re-runs.",
    );
  });

  it("says nothing at all about a circuit with no operable part", async () => {
    await openSimulator(PASSIVE_DIVIDER);
    expect(liveBand()).toBeNull();
    // ...and the rest of the simulator is still there, so this is an absent
    // band rather than an absent pane.
    expect(screen.getByRole("region", { name: "Circuit overview" })).toBeTruthy();
  });

  /**
   * A relay has a contact and looks every bit as clickable as a switch, but it
   * is thrown by its coil. Announcing it as a control would advertise a click
   * the simulator then refuses.
   */
  it("does not announce a relay, which is thrown by its coil", async () => {
    await openSimulator([
      { id: "v1", kind: "vsource", x: -128, y: 0, rotation: 0, value: "5", label: "V1" },
      { id: "k1", kind: "relay", x: 0, y: 0, rotation: 0, value: "", label: "K1" },
      { id: "gnd", kind: "ground", x: 128, y: 96, rotation: 0, value: "", label: "" },
    ]);
    expect(liveBand()).toBeNull();
    expect(screen.getByRole("region", { name: "Circuit overview" })).toBeTruthy();
  });

  it("moves the readout the moment the contact moves", async () => {
    await openSimulator(SWITCHED_DIVIDER);
    expect(bandText()).toContain("OPEN");

    act(() => void useSchematic.getState().actuateContact("s1", "press"));

    await waitFor(() => expect(bandText()).toContain("CLOSED"));
    expect(bandText()).not.toContain("OPEN");
  });

  it("lists every control and stops naming one of them", async () => {
    await openSimulator([
      ...SWITCHED_DIVIDER,
      { id: "rv1", kind: "potentiometer", x: 256, y: 0, rotation: 0, value: "10k Wiper=0.25", label: "RV1" },
    ]);
    expect(bandText()).toContain("S1");
    expect(bandText()).toContain("RV1");
    expect(bandText()).toContain("25%");
    expect(bandText()).toContain(
      "Operate a control on the circuit and the operating point re-solves.",
    );
  });
});

/**
 * The wiper is the awkward control: a drag fires a hundred pointer events, and
 * `Canvas.endWiperDrag` deliberately commits once, on release, so the store
 * takes one history entry and the solver runs once. The readout follows that
 * decision rather than the pointer - mid-drag the arrow has moved but the
 * circuit and the result on screen have not, and a readout that led them would
 * be quoting a tap position nothing was solved at.
 */
describe("App - the live readout follows the committed circuit, not the pointer", () => {
  it("holds the wiper percentage until the drag is released", async () => {
    await openSimulator([
      { id: "rv1", kind: "potentiometer", x: 0, y: 0, rotation: 0, value: "10k", label: "RV1" },
      { id: "v1", kind: "vsource", x: -128, y: 96, rotation: 0, value: "5", label: "V1" },
    ]);
    expect(bandText()).toContain("50%");

    // Canvas is fetched only after a circuit opens. Wait for the real
    // interactive SVG, not the decorative Suspense surface, before exercising
    // the drag contract.
    await waitFor(() => expect(document.querySelector(".sim-schematic-canvas svg.canvas")).toBeTruthy());
    const svg = document.querySelector(".sim-schematic-canvas svg.canvas")!;
    fireEvent.pointerDown(svg, { button: 0, clientX: 0, clientY: 0, pointerId: 7 });
    fireEvent.pointerMove(svg, { clientX: 10, clientY: 0, pointerId: 7 });

    // WIPER_TRAVEL_X is 20, so +10 world units is a quarter of the track.
    expect(bandText()).toContain("50%");

    fireEvent.pointerUp(svg, { button: 0, clientX: 10, clientY: 0, pointerId: 7 });
    await waitFor(() => expect(bandText()).toContain("75%"));
  });
});

/**
 * The band claims the result keeps up with the controls. That claim rests on
 * the actuation carve-out in App.tsx: every other edit nulls the results, an
 * actuation re-solves instead. If that ever reverts to `invalidateAnalysis`,
 * the band would be advertising something the app no longer does.
 */
describe("App - operating a control keeps the result on screen", () => {
  it("re-solves on a canvas click instead of blanking what is on screen", async () => {
    await openSimulator(SWITCHED_DIVIDER, { wires: SWITCHED_DIVIDER_WIRES });
    fireEvent.click(screen.getAllByRole("button", { name: "Run simulation" })[0]);

    // The Current Mode toggle exists only while an operating point or a
    // transient has a result, so it stands in for "the screen is not blank".
    const runResultShown = await screen.findByRole("button", { name: /Current Mode/ });
    expect(runResultShown).toBeTruthy();

    await waitFor(() => expect(document.querySelector("svg.canvas")).toBeTruthy());
    const svg = document.querySelector("svg.canvas")!;
    fireEvent.pointerDown(svg, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(svg, { button: 0, clientX: 0, clientY: 0 });

    await waitFor(() => expect(liveBand()!.textContent).toContain("CLOSED"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Current Mode/ })).toBeTruthy();
    });
    // Settled, not merely not-yet-invalidated: the effect that would have
    // blanked this runs synchronously after the same commit that moved the
    // contact, so a result still present here was re-solved, not stale.
    expect(useSchematic.getState().components.find((c) => c.id === "s1")?.value).toContain("closed");
  });
});
