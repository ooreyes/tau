import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const localStorageValues = vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
  return values;
});

import {
  useSchematic,
  type SchematicDocument,
  type SchematicHistory,
} from "./useSchematic";
import { dispatchShortcutAction, resolveShortcut, type ShortcutHandlers } from "../schematic/shortcuts";

const sourceDocument = (): SchematicDocument => ({
  components: [
    { id: "source-r1", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" },
  ],
  wires: [
    { id: "source-w1", points: [{ x: 64, y: 0 }, { x: 128, y: 0 }] },
  ],
});

const documentWithMetadata = (): SchematicDocument => ({
  ...sourceDocument(),
  probes: [{ id: "source-probe", x: 64, y: 0, color: "var(--trace-cyan)" }],
  netLabels: [{ id: "source-label", x: 64, y: 0, text: "OUT" }],
});

const currentDocument = (): SchematicDocument => {
  const state = useSchematic.getState();
  return {
    components: state.components,
    wires: state.wires,
    probes: state.probes,
    netLabels: state.netLabels,
  };
};

const currentHistory = (): SchematicHistory => {
  const state = useSchematic.getState();
  return { past: state.past, future: state.future };
};

function resetStore() {
  useSchematic.setState({
    components: [],
    wires: [],
    counters: {},
    selectedId: null,
    selectedWireId: null,
    selectedWireIds: [],
    selectedIds: [],
    tool: { mode: "select" },
    placeRotation: 0,
    placeMirror: false,
    clipboard: null,
    probes: [],
    netLabels: [],
    directives: [],
    past: [],
    future: [],
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorageValues.clear();
  resetStore();
  vi.clearAllTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("schematic document store", () => {
  it("does not persist redundant collinear routing vertices", () => {
    useSchematic.getState().addWire([
      { x: 0, y: 0 },
      { x: 16, y: 0 },
      { x: 32, y: 0 },
      { x: 32, y: 0 },
    ]);

    expect(useSchematic.getState().wires[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 32, y: 0 },
    ]);
  });

  it("inserts a vertical two-terminal part into a collinear wire and undo restores the bypass", () => {
    useSchematic.setState({
      wires: [{ id: "vertical", points: [{ x: 0, y: -96 }, { x: 0, y: 96 }] }],
      tool: { mode: "place", kind: "resistor" },
      placeRotation: 90,
    });

    useSchematic.getState().addComponent("resistor", 0, 0);

    const state = useSchematic.getState();
    expect(state.components[0]).toMatchObject({ kind: "resistor", x: 0, y: 0, rotation: 90 });
    expect(state.wires).toHaveLength(2);
    expect(state.wires.map((wire) => wire.points)).toEqual([
      [{ x: 0, y: -96 }, expect.objectContaining({ x: 0, y: -32 })],
      [expect.objectContaining({ x: 0, y: 32 }), { x: 0, y: 96 }],
    ]);
    expect(state.wires.some((wire) => wire.points.some((point) => point.x === 0 && point.y === 0))).toBe(false);

    state.undo();
    expect(useSchematic.getState().components).toEqual([]);
    expect(useSchematic.getState().wires).toEqual([
      { id: "vertical", points: [{ x: 0, y: -96 }, { x: 0, y: 96 }] },
    ]);
  });

  it("inserts a horizontal two-terminal part into a collinear wire", () => {
    useSchematic.setState({
      wires: [{ id: "horizontal", points: [{ x: -96, y: 0 }, { x: 96, y: 0 }] }],
      tool: { mode: "place", kind: "resistor" },
      placeRotation: 0,
    });

    useSchematic.getState().addComponent("resistor", 0, 0);

    expect(useSchematic.getState().wires.map((wire) => wire.points)).toEqual([
      [{ x: -96, y: 0 }, expect.objectContaining({ x: -32, y: 0 })],
      [expect.objectContaining({ x: 32, y: 0 }), { x: 96, y: 0 }],
    ]);
  });

  it("does not duplicate a non-ideal wire's resistance across inserted pieces", () => {
    const original = {
      id: "lossy",
      points: [{ x: -96, y: 0 }, { x: 96, y: 0 }],
      resistance: "10m",
    };
    useSchematic.setState({
      wires: [original],
      tool: { mode: "place", kind: "resistor" },
      placeRotation: 0,
    });

    useSchematic.getState().addComponent("resistor", 0, 0);

    expect(useSchematic.getState().components).toHaveLength(1);
    expect(useSchematic.getState().wires).toEqual([original]);
  });

  it("leaves a crossing wire intact when the placed part is not collinear", () => {
    useSchematic.setState({
      wires: [{ id: "vertical", points: [{ x: 0, y: -96 }, { x: 0, y: 96 }] }],
      tool: { mode: "place", kind: "resistor" },
      placeRotation: 0,
    });

    useSchematic.getState().addComponent("resistor", 0, 0);
    expect(useSchematic.getState().wires).toEqual([
      { id: "vertical", points: [{ x: 0, y: -96 }, { x: 0, y: 96 }] },
    ]);
  });

  it("clears circuit-scoped probes and labels when another document loads", () => {
    useSchematic.setState({
      probes: [{ id: "probe-1", x: 64, y: 0, color: "var(--trace-red)" }],
      netLabels: [{ id: "label-1", x: 64, y: 0, text: "OUT" }],
    });

    useSchematic.getState().loadCircuit(sourceDocument());

    const state = useSchematic.getState();
    expect(state.probes).toEqual([]);
    expect(state.netLabels).toEqual([]);
    expect(state.components).toHaveLength(1);
    expect(state.wires).toHaveLength(1);
  });

  it("clones loaded documents so later caller mutations cannot corrupt the active schematic", () => {
    const incoming = sourceDocument();
    useSchematic.getState().loadCircuit(incoming);

    const loaded = useSchematic.getState();
    expect(loaded.components[0].id).not.toBe(incoming.components[0].id);
    expect(loaded.wires[0].id).not.toBe(incoming.wires[0].id);

    incoming.components[0].value = "9k";
    incoming.wires[0].points[0].x = 999;

    expect(useSchematic.getState().components[0].value).toBe("1k");
    expect(useSchematic.getState().wires[0].points[0].x).toBe(64);
  });

  it("loads imported probes and net labels as part of the document", () => {
    const incoming = documentWithMetadata();

    useSchematic.getState().loadCircuit(incoming);

    const loaded = useSchematic.getState();
    expect(loaded.probes).toEqual([
      expect.objectContaining({ x: 64, y: 0, color: "var(--trace-cyan)" }),
    ]);
    expect(loaded.netLabels).toEqual([
      expect.objectContaining({ x: 64, y: 0, text: "OUT" }),
    ]);
    expect(loaded.probes[0].id).not.toBe(incoming.probes?.[0].id);
    expect(loaded.netLabels[0].id).not.toBe(incoming.netLabels?.[0].id);

    incoming.probes![0].x = 999;
    incoming.netLabels![0].text = "MUTATED";
    expect(useSchematic.getState().probes[0].x).toBe(64);
    expect(useSchematic.getState().netLabels[0].text).toBe("OUT");
  });

  it("carries imported SPICE directives onto the document", () => {
    const incoming: SchematicDocument = {
      ...sourceDocument(),
      directives: [".param Rload=10k", ".tran 1m"],
    };

    useSchematic.getState().loadCircuit(incoming);

    const loaded = useSchematic.getState();
    expect(loaded.directives).toEqual([".param Rload=10k", ".tran 1m"]);

    // The store keeps its own copy — caller mutations cannot corrupt it.
    incoming.directives![0] = ".param Rload=999";
    expect(useSchematic.getState().directives[0]).toBe(".param Rload=10k");
  });

  it("setDirectives replaces directives and is undoable", () => {
    useSchematic.getState().loadCircuit({ ...sourceDocument(), directives: [".param a=1"] });

    useSchematic.getState().setDirectives([".param a=2", ".func f(x)=x*2"]);
    expect(useSchematic.getState().directives).toEqual([".param a=2", ".func f(x)=x*2"]);

    useSchematic.getState().undo();
    expect(useSchematic.getState().directives).toEqual([".param a=1"]);

    useSchematic.getState().redo();
    expect(useSchematic.getState().directives).toEqual([".param a=2", ".func f(x)=x*2"]);
  });

  it("replaces the current document as one undoable assistant-style edit", () => {
    useSchematic.getState().loadCircuit({ ...sourceDocument(), directives: [".tran 1m"] });
    const replacement: SchematicDocument = {
      components: [{ id: "replacement-r1", kind: "resistor", x: 96, y: 32, rotation: 0, value: "4.7k", label: "R1" }],
      wires: [],
      probes: [],
      netLabels: [{ id: "replacement-label", x: 96, y: 32, text: "OUT" }],
      directives: [".tran 5m"],
    };

    useSchematic.getState().replaceCircuit(replacement);
    expect(useSchematic.getState().components[0].value).toBe("4.7k");
    expect(useSchematic.getState().netLabels[0].text).toBe("OUT");
    expect(useSchematic.getState().directives).toEqual([".tran 5m"]);
    expect(useSchematic.getState().past).toHaveLength(1);

    useSchematic.getState().undo();
    expect(useSchematic.getState().components[0].value).toBe("1k");
    expect(useSchematic.getState().directives).toEqual([".tran 1m"]);

    useSchematic.getState().redo();
    expect(useSchematic.getState().components[0].value).toBe("4.7k");
    expect(useSchematic.getState().directives).toEqual([".tran 5m"]);
  });

  it("starts each fresh document without residual directives", () => {
    useSchematic.getState().loadCircuit({ ...sourceDocument(), directives: [".param a=1"] });
    useSchematic.getState().newCircuit();
    expect(useSchematic.getState().directives).toEqual([]);
  });

  it("restores a focused parameter edit through undo and redo", () => {
    useSchematic.getState().loadCircuit(sourceDocument());
    const resistorId = useSchematic.getState().components[0].id;

    useSchematic.getState().beginChange();
    useSchematic.getState().setValue(resistorId, "2.2k");
    expect(useSchematic.getState().components[0].value).toBe("2.2k");

    useSchematic.getState().undo();
    expect(useSchematic.getState().components[0].value).toBe("1k");
    expect(useSchematic.getState().selectedId).toBeNull();

    useSchematic.getState().redo();
    expect(useSchematic.getState().components[0].value).toBe("2.2k");
  });

  it("starts each fresh document without residual probes or labels", () => {
    useSchematic.setState({
      probes: [{ id: "probe-1", x: 64, y: 0, color: "var(--trace-red)" }],
      netLabels: [{ id: "label-1", x: 64, y: 0, text: "OUT" }],
    });

    useSchematic.getState().newCircuit();

    const state = useSchematic.getState();
    expect(state.components).toEqual([]);
    expect(state.wires).toEqual([]);
    expect(state.probes).toEqual([]);
    expect(state.netLabels).toEqual([]);
  });

  it("restores each tab with its own undo history", () => {
    useSchematic.getState().loadCircuit(sourceDocument());
    const tabAId = useSchematic.getState().components[0].id;
    useSchematic.getState().beginChange();
    useSchematic.getState().setValue(tabAId, "2k");
    const tabADocument = currentDocument();
    const tabAHistory = currentHistory();

    const tabBDocument: SchematicDocument = {
      components: [{ id: "tab-b-r1", kind: "resistor", x: 96, y: 0, rotation: 0, value: "5k", label: "R1" }],
      wires: [],
      probes: [{ id: "tab-b-probe", x: 96, y: 0, color: "var(--trace-green)" }],
      netLabels: [{ id: "tab-b-label", x: 96, y: 0, text: "BIAS" }],
    };
    useSchematic.getState().loadCircuit(tabBDocument);
    const tabBId = useSchematic.getState().components[0].id;
    useSchematic.getState().beginChange();
    useSchematic.getState().setValue(tabBId, "8k");
    const tabBState = currentDocument();
    const tabBHistory = currentHistory();

    useSchematic.getState().restoreCircuit(tabADocument, tabAHistory);
    useSchematic.getState().undo();
    expect(useSchematic.getState().components[0].value).toBe("1k");
    useSchematic.getState().redo();
    expect(useSchematic.getState().components[0].value).toBe("2k");
    expect(useSchematic.getState().netLabels).toEqual([]);

    useSchematic.getState().restoreCircuit(tabBState, tabBHistory);
    useSchematic.getState().undo();
    expect(useSchematic.getState().components[0].value).toBe("5k");
    useSchematic.getState().redo();
    expect(useSchematic.getState().components[0].value).toBe("8k");
    expect(useSchematic.getState().probes).toEqual([
      expect.objectContaining({ x: 96, y: 0, color: "var(--trace-green)" }),
    ]);
    expect(useSchematic.getState().netLabels).toEqual([
      expect.objectContaining({ x: 96, y: 0, text: "BIAS" }),
    ]);
  });

  it("autosaves probes and net labels after the debounce interval", () => {
    useSchematic.getState().loadCircuit(documentWithMetadata());

    expect(localStorageValues.get("tau.schematic.v1")).toBeUndefined();
    vi.advanceTimersByTime(249);
    expect(localStorageValues.get("tau.schematic.v1")).toBeUndefined();
    vi.advanceTimersByTime(1);

    const saved = JSON.parse(localStorageValues.get("tau.schematic.v1") ?? "{}") as SchematicDocument;
    expect(saved.probes).toEqual(useSchematic.getState().probes);
    expect(saved.netLabels).toEqual(useSchematic.getState().netLabels);
  });

  it("setNetLabelDirect updates the label without adding an undo entry", () => {
    useSchematic.getState().loadCircuit(sourceDocument());
    const historyBefore = useSchematic.getState().past.length;

    useSchematic.getState().setNetLabelDirect(64, 0, "Vout");

    const state = useSchematic.getState();
    expect(state.netLabels).toEqual([expect.objectContaining({ x: 64, y: 0, text: "Vout" })]);
    // No undo entry should be pushed by setNetLabelDirect.
    expect(state.past.length).toBe(historyBefore);
  });

  it("setNetLabelDirect creates a label when none exists and updates in-place", () => {
    useSchematic.getState().setNetLabelDirect(32, 16, "GND_REF");
    expect(useSchematic.getState().netLabels).toHaveLength(1);
    expect(useSchematic.getState().netLabels[0].text).toBe("GND_REF");

    // Updating same point should mutate in-place, not duplicate.
    useSchematic.getState().setNetLabelDirect(32, 16, "AGND");
    expect(useSchematic.getState().netLabels).toHaveLength(1);
    expect(useSchematic.getState().netLabels[0].text).toBe("AGND");
  });

  it("setNetLabelDirect removes the label when given empty text", () => {
    useSchematic.getState().setNetLabelDirect(0, 0, "Temp");
    expect(useSchematic.getState().netLabels).toHaveLength(1);

    useSchematic.getState().setNetLabelDirect(0, 0, "");
    expect(useSchematic.getState().netLabels).toHaveLength(0);
  });

  it("setNetLabelOffsetDirect updates dx/dy without adding an undo entry (drag, mid-gesture)", () => {
    useSchematic.setState({ netLabels: [{ id: "label-1", x: 64, y: 0, text: "OUT" }] });
    const historyBefore = useSchematic.getState().past.length;

    useSchematic.getState().setNetLabelOffsetDirect("label-1", 18, -4);

    const state = useSchematic.getState();
    expect(state.netLabels).toEqual([{ id: "label-1", x: 64, y: 0, text: "OUT", dx: 18, dy: -4 }]);
    expect(state.past.length).toBe(historyBefore);
  });

  it("a net label drag (beginChange once + repeated setNetLabelOffsetDirect) collapses into one undo entry", () => {
    // Mirrors the drag convention documented on setNetLabelDirect/moveComponent:
    // beginChange() once before the first move, then the no-undo setter for
    // every subsequent move — Canvas.tsx's net label drag handler (Fix 2)
    // follows this exact sequence.
    useSchematic.setState({ netLabels: [{ id: "label-1", x: 64, y: 0, text: "OUT", dx: 6, dy: -6 }] });
    const historyBefore = useSchematic.getState().past.length;

    useSchematic.getState().beginChange();
    useSchematic.getState().setNetLabelOffsetDirect("label-1", 10, -2);
    useSchematic.getState().setNetLabelOffsetDirect("label-1", 14, 3);
    useSchematic.getState().setNetLabelOffsetDirect("label-1", 20, 9);

    const state = useSchematic.getState();
    expect(state.netLabels[0]).toEqual({ id: "label-1", x: 64, y: 0, text: "OUT", dx: 20, dy: 9 });
    // One undo entry for the whole drag, not one per pointermove.
    expect(state.past.length).toBe(historyBefore + 1);

    useSchematic.getState().undo();
    expect(useSchematic.getState().netLabels[0]).toEqual({ id: "label-1", x: 64, y: 0, text: "OUT", dx: 6, dy: -6 });
  });

  it("round-trips a net label's dx/dy offset through loadCircuit (Fix 2 persistence)", () => {
    const withOffset: SchematicDocument = {
      ...sourceDocument(),
      netLabels: [{ id: "source-label", x: 64, y: 0, text: "OUT", dx: 12, dy: -30 }],
    };

    useSchematic.getState().loadCircuit(withOffset);

    expect(useSchematic.getState().netLabels).toEqual([
      expect.objectContaining({ x: 64, y: 0, text: "OUT", dx: 12, dy: -30 }),
    ]);
  });

  it("upsertNetLabel always records an undo entry so full-label operations can be undone", () => {
    useSchematic.getState().loadCircuit(sourceDocument());
    const historyBefore = useSchematic.getState().past.length;

    useSchematic.getState().upsertNetLabel(64, 0, "Vout");

    expect(useSchematic.getState().past.length).toBe(historyBefore + 1);
    expect(useSchematic.getState().netLabels).toEqual([expect.objectContaining({ text: "Vout" })]);
  });

  it("upsertNetLabel is a no-op (no undo entry) for empty text on an empty point or an unchanged label", () => {
    useSchematic.getState().loadCircuit(sourceDocument());
    const historyBefore = useSchematic.getState().past.length;

    // Committing an empty label draft where nothing exists changes nothing.
    useSchematic.getState().upsertNetLabel(64, 0, "   ");
    expect(useSchematic.getState().past.length).toBe(historyBefore);
    expect(useSchematic.getState().netLabels).toHaveLength(0);

    // Re-committing the same text over an existing label changes nothing.
    useSchematic.getState().upsertNetLabel(64, 0, "Vout");
    useSchematic.getState().upsertNetLabel(64, 0, "Vout");
    expect(useSchematic.getState().past.length).toBe(historyBefore + 1);
    expect(useSchematic.getState().netLabels).toHaveLength(1);
  });

  it("startLabeling enters the label tool and clears any selection", () => {
    useSchematic.getState().loadCircuit(sourceDocument());
    const id = useSchematic.getState().components[0].id;
    useSchematic.getState().select(id);

    useSchematic.getState().startLabeling();

    const state = useSchematic.getState();
    expect(state.tool).toEqual({ mode: "label" });
    expect(state.selectedId).toBeNull();
    expect(state.selectedWireId).toBeNull();
    expect(state.selectedIds).toEqual([]);
  });

  it("cancel (Escape) leaves the label tool back to select", () => {
    useSchematic.getState().startLabeling();
    useSchematic.getState().cancel();
    expect(useSchematic.getState().tool).toEqual({ mode: "select" });
  });

  it("undo history is capped at HISTORY_LIMIT (100) entries", () => {
    for (let n = 0; n < 110; n += 1) {
      useSchematic.getState().beginChange();
    }
    expect(useSchematic.getState().past.length).toBeLessThanOrEqual(100);
  });

  it("undo reverts after multiple beginChange calls, redo re-applies", () => {
    useSchematic.getState().loadCircuit(sourceDocument());
    const id = useSchematic.getState().components[0].id;

    useSchematic.getState().beginChange();
    useSchematic.getState().setValue(id, "4.7k");
    useSchematic.getState().beginChange();
    useSchematic.getState().setValue(id, "10k");

    useSchematic.getState().undo();
    expect(useSchematic.getState().components[0].value).toBe("4.7k");
    useSchematic.getState().undo();
    expect(useSchematic.getState().components[0].value).toBe("1k");

    useSchematic.getState().redo();
    expect(useSchematic.getState().components[0].value).toBe("4.7k");
    useSchematic.getState().redo();
    expect(useSchematic.getState().components[0].value).toBe("10k");
  });

  it("undo does nothing when history is empty", () => {
    useSchematic.getState().undo();
    const state = useSchematic.getState();
    expect(state.components).toEqual([]);
    expect(state.past.length).toBe(0);
  });

  it("redo does nothing when future is empty", () => {
    useSchematic.getState().redo();
    const state = useSchematic.getState();
    expect(state.future.length).toBe(0);
  });

  it("loadCircuit fails gracefully when data is valid but clones ids", () => {
    const doc = sourceDocument();
    useSchematic.getState().loadCircuit(doc);
    const loaded = useSchematic.getState();
    // Fresh ids are assigned on load.
    expect(loaded.components[0].id).not.toBe("source-r1");
    // But coordinates and values are preserved.
    expect(loaded.components[0].x).toBe(96);
    expect(loaded.components[0].value).toBe("1k");
  });

  it("mirror toggles the selected component's mirrored flag and is undoable", () => {
    useSchematic.getState().loadCircuit(sourceDocument());
    const id = useSchematic.getState().components[0].id;
    useSchematic.getState().select(id);

    useSchematic.getState().mirror();
    expect(useSchematic.getState().components[0].mirrored).toBe(true);

    // Toggling again clears it.
    useSchematic.getState().mirror();
    expect(useSchematic.getState().components[0].mirrored).toBe(false);

    // Each toggle is its own undo entry.
    useSchematic.getState().undo();
    expect(useSchematic.getState().components[0].mirrored).toBe(true);
  });

  it("mirror toggles placeMirror (not the document) while placing", () => {
    useSchematic.getState().startPlacing("opamp");
    expect(useSchematic.getState().placeMirror).toBe(false);

    useSchematic.getState().mirror();
    expect(useSchematic.getState().placeMirror).toBe(true);

    // A part placed now inherits the place-mirror flag.
    useSchematic.getState().addComponent("opamp", 0, 0);
    const placed = useSchematic.getState().components.find((c) => c.kind === "opamp");
    expect(placed?.mirrored).toBe(true);
  });

  it("mirror does nothing with no selection in select mode", () => {
    useSchematic.getState().loadCircuit(sourceDocument());
    const historyBefore = useSchematic.getState().past.length;
    useSchematic.getState().select(null);
    useSchematic.getState().mirror();
    expect(useSchematic.getState().past.length).toBe(historyBefore);
    expect(useSchematic.getState().components[0].mirrored ?? false).toBe(false);
  });

  it("duplicateSelected clones the selection with a fresh id, ref-des, and offset", () => {
    useSchematic.getState().loadCircuit(sourceDocument());
    const id = useSchematic.getState().components[0].id;
    useSchematic.getState().select(id);

    useSchematic.getState().duplicateSelected();

    const state = useSchematic.getState();
    expect(state.components).toHaveLength(2);
    const src = state.components[0];
    const copy = state.components[1];
    expect(copy.id).not.toBe(src.id);
    expect(copy.label).toBe("R2"); // next ref-des after R1
    expect(copy.value).toBe(src.value);
    expect(copy.x).toBe(src.x + 32);
    expect(copy.y).toBe(src.y + 32);
    // The copy becomes the selection and the duplicate is undoable.
    expect(state.selectedId).toBe(copy.id);
    useSchematic.getState().undo();
    expect(useSchematic.getState().components).toHaveLength(1);
  });

  it("copy then paste places an offset copy; a second paste keeps numbering", () => {
    useSchematic.getState().loadCircuit(sourceDocument());
    const id = useSchematic.getState().components[0].id;
    useSchematic.getState().select(id);

    useSchematic.getState().copySelected();
    useSchematic.getState().paste();
    expect(useSchematic.getState().components.map((c) => c.label)).toEqual(["R1", "R2"]);

    useSchematic.getState().paste();
    expect(useSchematic.getState().components.map((c) => c.label)).toEqual(["R1", "R2", "R3"]);
    // Each paste lands one offset further from the clipboard source.
    const [, r2, r3] = useSchematic.getState().components;
    expect(r3.x).toBe(r2.x); // both offset from the same clipboard component
  });

  it("paste offsets pinOverride positions so imported parts stay wired", () => {
    useSchematic.getState().loadCircuit({
      components: [
        {
          id: "imp1", kind: "resistor", x: 100, y: 100, rotation: 0, value: "1k", label: "R1",
          pinOverride: [
            { id: "a", label: "A", x: 68, y: 100 },
            { id: "b", label: "B", x: 132, y: 100 },
          ],
        },
      ],
      wires: [],
    });
    useSchematic.getState().select(useSchematic.getState().components[0].id);
    useSchematic.getState().copySelected();
    useSchematic.getState().paste();

    const copy = useSchematic.getState().components[1];
    expect(copy.pinOverride).toEqual([
      { id: "a", label: "A", x: 100, y: 132 },
      { id: "b", label: "B", x: 164, y: 132 },
    ]);
  });

  it("copy/paste/duplicate are no-ops without a selection or clipboard", () => {
    useSchematic.getState().loadCircuit(sourceDocument());
    useSchematic.getState().select(null);
    useSchematic.getState().copySelected();
    useSchematic.getState().paste(); // empty clipboard
    useSchematic.getState().duplicateSelected();
    expect(useSchematic.getState().components).toHaveLength(1);
  });

  it("deleteSelected removes the component and clears selection", () => {
    useSchematic.getState().loadCircuit(sourceDocument());
    const id = useSchematic.getState().components[0].id;
    useSchematic.getState().select(id);
    useSchematic.getState().beginChange();
    useSchematic.getState().deleteSelected();

    const state = useSchematic.getState();
    expect(state.components).toHaveLength(0);
    expect(state.selectedId).toBeNull();
    // Wire is untouched.
    expect(state.wires).toHaveLength(1);
  });

  it("deleteSelected removes all wires in selectedWireIds", () => {
    useSchematic.setState({
      components: [],
      wires: [
        { id: "w1", points: [{ x: 0, y: 0 }, { x: 32, y: 0 }] },
        { id: "w2", points: [{ x: 0, y: 32 }, { x: 32, y: 32 }] },
        { id: "w3", points: [{ x: 0, y: 64 }, { x: 32, y: 64 }] },
      ],
      selectedWireIds: ["w1", "w2"],
      selectedWireId: "w1",
      selectedId: null,
      selectedIds: [],
    });
    useSchematic.getState().deleteSelected();
    const state = useSchematic.getState();
    expect(state.wires.map((w) => w.id)).toEqual(["w3"]);
    expect(state.selectedWireIds).toEqual([]);
    expect(state.selectedWireId).toBeNull();
  });
});

// --------------------------------------------------------------------------
// Multi-select and group-move
// --------------------------------------------------------------------------

const twoResistorDocument = (): SchematicDocument => ({
  components: [
    { id: "r1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k", label: "R1" },
    { id: "r2", kind: "resistor", x: 128, y: 0, rotation: 0, value: "2k", label: "R2" },
  ],
  wires: [],
});

describe("multi-select", () => {
  it("selectMultiple sets selectedIds and derives selectedId for single-item lists", () => {
    useSchematic.getState().loadCircuit(twoResistorDocument());
    const [id1, id2] = useSchematic.getState().components.map((c) => c.id);

    useSchematic.getState().selectMultiple([id1, id2]);
    expect(useSchematic.getState().selectedIds).toEqual([id1, id2]);
    // selectedId is null when more than one item is selected.
    expect(useSchematic.getState().selectedId).toBeNull();
    expect(useSchematic.getState().selectedWireId).toBeNull();

    useSchematic.getState().selectMultiple([id1]);
    expect(useSchematic.getState().selectedId).toBe(id1);
    expect(useSchematic.getState().selectedIds).toEqual([id1]);
  });

  it("toggleSelect adds and removes a component from the selection", () => {
    useSchematic.getState().loadCircuit(twoResistorDocument());
    const [id1, id2] = useSchematic.getState().components.map((c) => c.id);

    useSchematic.getState().toggleSelect(id1);
    expect(useSchematic.getState().selectedIds).toEqual([id1]);

    useSchematic.getState().toggleSelect(id2);
    expect(useSchematic.getState().selectedIds).toEqual([id1, id2]);
    expect(useSchematic.getState().selectedId).toBeNull();

    useSchematic.getState().toggleSelect(id1);
    expect(useSchematic.getState().selectedIds).toEqual([id2]);
    expect(useSchematic.getState().selectedId).toBe(id2);
  });

  it("clearSelection clears all selection kinds", () => {
    useSchematic.getState().loadCircuit(twoResistorDocument());
    const [id1, id2] = useSchematic.getState().components.map((c) => c.id);

    useSchematic.getState().selectMultiple([id1, id2]);
    useSchematic.getState().clearSelection();

    const s = useSchematic.getState();
    expect(s.selectedIds).toEqual([]);
    expect(s.selectedId).toBeNull();
    expect(s.selectedWireId).toBeNull();
  });

  it("deleteSelected removes all components in selectedIds and is undoable", () => {
    useSchematic.getState().loadCircuit(twoResistorDocument());
    const ids = useSchematic.getState().components.map((c) => c.id);

    useSchematic.getState().selectMultiple(ids);
    useSchematic.getState().deleteSelected();

    expect(useSchematic.getState().components).toHaveLength(0);
    expect(useSchematic.getState().selectedIds).toEqual([]);

    useSchematic.getState().undo();
    expect(useSchematic.getState().components).toHaveLength(2);
  });

  it("select() keeps single-select API working: sets selectedId and selectedIds=[id]", () => {
    useSchematic.getState().loadCircuit(twoResistorDocument());
    const id = useSchematic.getState().components[0].id;

    useSchematic.getState().select(id);
    expect(useSchematic.getState().selectedId).toBe(id);
    expect(useSchematic.getState().selectedIds).toEqual([id]);

    useSchematic.getState().select(null);
    expect(useSchematic.getState().selectedId).toBeNull();
    expect(useSchematic.getState().selectedIds).toEqual([]);
  });
});

describe("moveGroup (group move with wire rubber-banding)", () => {
  it("moves multiple components by (dx, dy) in one step", () => {
    useSchematic.getState().loadCircuit(twoResistorDocument());
    const ids = useSchematic.getState().components.map((c) => c.id);

    useSchematic.getState().beginChange();
    useSchematic.getState().moveGroup(
      new Map(useSchematic.getState().components.map((c) => [c.id, { x: c.x, y: c.y }])),
      64, 32,
      new Map(useSchematic.getState().components.map((c) => [c.id, []])),
      [],
    );

    const comps = useSchematic.getState().components;
    expect(comps.find((c) => c.id === ids[0])).toMatchObject({ x: 64, y: 32 });
    expect(comps.find((c) => c.id === ids[1])).toMatchObject({ x: 192, y: 32 });
  });

  it("single undo reverts the whole group move", () => {
    useSchematic.getState().loadCircuit(twoResistorDocument());
    const ids = useSchematic.getState().components.map((c) => c.id);

    useSchematic.getState().beginChange();
    useSchematic.getState().moveGroup(
      new Map(useSchematic.getState().components.map((c) => [c.id, { x: c.x, y: c.y }])),
      64, 0,
      new Map(ids.map((id) => [id, []])),
      [],
    );

    useSchematic.getState().undo();
    const comps = useSchematic.getState().components;
    expect(comps.find((c) => c.id === ids[0])).toMatchObject({ x: 0, y: 0 });
    expect(comps.find((c) => c.id === ids[1])).toMatchObject({ x: 128, y: 0 });
  });

  it("rubber-bands wire endpoints that were pinned to moved component pins", () => {
    // R1 at x=0 has right pin at (32,0). A wire from (32,0) to (96,0).
    // Moving R1 by dx=64 should shift the wire start to (96,0) and keep the end.
    const doc: SchematicDocument = {
      components: [
        { id: "r1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k", label: "R1" },
      ],
      wires: [
        { id: "w1", points: [{ x: 32, y: 0 }, { x: 96, y: 0 }] },
      ],
    };
    useSchematic.getState().loadCircuit(doc);
    const r1Id = useSchematic.getState().components[0].id;
    // Pin "b" of a horizontal resistor is at local (32,0) → world (32,0).
    const sourcePins = new Map([[r1Id, [{ x: 32, y: 0 }]]]);
    const sourceWires = useSchematic.getState().wires.map((w) => ({
      ...w,
      points: w.points.map((p) => ({ ...p })),
    }));

    useSchematic.getState().beginChange();
    useSchematic.getState().moveGroup(new Map([[r1Id, { x: 0, y: 0 }]]), 64, 0, sourcePins, sourceWires);

    const wires = useSchematic.getState().wires;
    expect(wires[0].points[0]).toEqual({ x: 96, y: 0 });
    // The far end is not pinned and stays put.
    expect(wires[0].points[wires[0].points.length - 1]).toEqual({ x: 96, y: 0 });
  });

  it("rubber-bands wire with an elbow when axis alignment is lost after move", () => {
    // R1 at y=0, wire start at pin (32, 0), wire goes to (32, 64) — vertical.
    // Moving R1 up by dy=-32: pin moves to (32, -32). Wire end stays at (32, 64).
    // Wire stays axis-aligned: new points [{ x:32, y:-32 }, { x:32, y:64 }].
    const doc: SchematicDocument = {
      components: [
        { id: "r1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k", label: "R1" },
      ],
      wires: [
        { id: "w1", points: [{ x: 32, y: 0 }, { x: 32, y: 64 }] },
      ],
    };
    useSchematic.getState().loadCircuit(doc);
    const r1Id = useSchematic.getState().components[0].id;
    const sourcePins = new Map([[r1Id, [{ x: 32, y: 0 }]]]);
    const sourceWires = useSchematic.getState().wires.map((w) => ({
      ...w,
      points: w.points.map((p) => ({ ...p })),
    }));

    useSchematic.getState().beginChange();
    useSchematic.getState().moveGroup(new Map([[r1Id, { x: 0, y: 0 }]]), 0, -32, sourcePins, sourceWires);

    const pts = useSchematic.getState().wires[0].points;
    // First point moved with pin.
    expect(pts[0]).toEqual({ x: 32, y: -32 });
    // Last point unchanged.
    expect(pts[pts.length - 1]).toEqual({ x: 32, y: 64 });
  });

  it("moves the whole wire when both endpoints are pinned", () => {
    // Wire between pin of R1 (32,0) and pin of R2 (96,0).
    // Both pins move by dx=64 → wire shifts entirely.
    const doc: SchematicDocument = {
      components: [
        { id: "r1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k", label: "R1" },
        { id: "r2", kind: "resistor", x: 128, y: 0, rotation: 0, value: "2k", label: "R2" },
      ],
      wires: [
        { id: "w1", points: [{ x: 32, y: 0 }, { x: 96, y: 0 }] },
      ],
    };
    useSchematic.getState().loadCircuit(doc);
    const [r1Id, r2Id] = useSchematic.getState().components.map((c) => c.id);
    const sourcePins = new Map([
      [r1Id, [{ x: 32, y: 0 }]],
      [r2Id, [{ x: 96, y: 0 }]],
    ]);
    const sourceWires = useSchematic.getState().wires.map((w) => ({
      ...w,
      points: w.points.map((p) => ({ ...p })),
    }));

    useSchematic.getState().beginChange();
    useSchematic.getState().moveGroup(new Map([[r1Id, { x: 0, y: 0 }], [r2Id, { x: 128, y: 0 }]]), 64, 0, sourcePins, sourceWires);

    const pts = useSchematic.getState().wires[0].points;
    expect(pts[0]).toEqual({ x: 96, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 160, y: 0 });
  });

  it("does not compound cumulative deltas across successive pointer-moves", () => {
    // During a drag, the canvas calls moveGroup once per pointer-move with the
    // TOTAL delta from drag start. Positions must come from the drag-start
    // origins, not the current state — otherwise the group runs away from the
    // cursor (regression: components moved by dx each call on top of the last).
    useSchematic.getState().loadCircuit(twoResistorDocument());
    const comps = useSchematic.getState().components;
    const origins = new Map(comps.map((c) => [c.id, { x: c.x, y: c.y }]));
    const pins = new Map(comps.map((c) => [c.id, []] as [string, { x: number; y: number }[]]));

    useSchematic.getState().beginChange();
    useSchematic.getState().moveGroup(origins, 32, 0, pins, []);
    useSchematic.getState().moveGroup(origins, 64, 0, pins, []);
    useSchematic.getState().moveGroup(origins, 96, 16, pins, []);

    const after = useSchematic.getState().components;
    expect(after.find((c) => c.id === comps[0].id)).toMatchObject({ x: 96, y: 16 });
    expect(after.find((c) => c.id === comps[1].id)).toMatchObject({ x: 224, y: 16 });
  });

  it("translates marquee-selected wires, labels, and probes with the component group", () => {
    useSchematic.setState({
      components: [{ id: "r1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k", label: "R1" }],
      wires: [{ id: "w1", points: [{ x: 32, y: 0 }, { x: 96, y: 0 }] }],
      netLabels: [{ id: "l1", x: 64, y: 0, text: "OUT" }],
      probes: [{ id: "p1", x: 80, y: 0, color: "var(--trace-red)" }],
    });
    useSchematic.getState().selectMixed({
      componentIds: ["r1"],
      wireIds: ["w1"],
      labelIds: ["l1"],
      probeIds: ["p1"],
    });
    const sourceWires = structuredClone(useSchematic.getState().wires);

    useSchematic.getState().beginChange();
    useSchematic.getState().moveGroup(
      new Map([["r1", { x: 0, y: 0 }]]),
      64,
      32,
      new Map([["r1", [{ x: 32, y: 0 }]]]),
      sourceWires,
      new Map([["l1", { x: 64, y: 0 }]]),
      new Map([["p1", { x: 80, y: 0 }]]),
    );

    const moved = useSchematic.getState();
    expect(moved.components[0]).toMatchObject({ x: 64, y: 32 });
    expect(moved.wires[0].points).toEqual([{ x: 96, y: 32 }, { x: 160, y: 32 }]);
    expect(moved.netLabels[0]).toMatchObject({ x: 128, y: 32 });
    expect(moved.probes[0]).toMatchObject({ x: 144, y: 32 });

    useSchematic.getState().undo();
    expect(useSchematic.getState().wires[0].points).toEqual([{ x: 32, y: 0 }, { x: 96, y: 0 }]);
  });
});

describe("addProbe — one probe per net, net-identity dedup (§UX)", () => {
  it("adds a probe when a net has none", () => {
    useSchematic.setState({ wires: [{ id: "w1", points: [{ x: 0, y: 0 }, { x: 64, y: 0 }] }] });
    useSchematic.getState().addProbe(32, 0);
    expect(useSchematic.getState().probes).toHaveLength(1);
    expect(useSchematic.getState().probes[0]).toMatchObject({ x: 32, y: 0 });
  });

  it("removes the probe when the SAME point is clicked again (toggle off)", () => {
    useSchematic.setState({ wires: [{ id: "w1", points: [{ x: 0, y: 0 }, { x: 64, y: 0 }] }] });
    useSchematic.getState().addProbe(32, 0);
    useSchematic.getState().addProbe(32, 0);
    expect(useSchematic.getState().probes).toHaveLength(0);
  });

  it("moves (does not duplicate) the probe when a DIFFERENT point on the same net is clicked", () => {
    // An L-shaped wire: (32, 0) and (64, 32) are two different points on the
    // one net. Clicking a net that already has a probe relocates the marker
    // instead of stacking a second ring — a net carries at most one probe.
    useSchematic.setState({
      wires: [{ id: "w1", points: [{ x: 0, y: 0 }, { x: 64, y: 0 }, { x: 64, y: 64 }] }],
    });
    useSchematic.getState().addProbe(32, 0);
    const firstId = useSchematic.getState().probes[0].id;
    useSchematic.getState().addProbe(64, 32);
    const probes = useSchematic.getState().probes;
    expect(probes).toHaveLength(1);
    expect(probes[0].id).toBe(firstId); // same probe, relocated — not a new one
    expect(probes[0]).toMatchObject({ x: 64, y: 32 });
  });

  it("does nothing when clicking a component BODY (no pin/wire under the cursor)", () => {
    // Owner feedback: "probing an opamp makes no sense". The opamp's own
    // (x, y) is its body center — none of its pins sit there — so a probe
    // click must not attach a probe at a point that isn't on any net.
    useSchematic.setState({
      components: [{ id: "u1", kind: "opamp", x: 0, y: 0, rotation: 0, value: "ideal", label: "U1" }],
    });
    useSchematic.getState().addProbe(0, 0);
    expect(useSchematic.getState().probes).toHaveLength(0);
  });

  it("still probes an isolated pin with no wire attached (a valid, if unconnected, net)", () => {
    useSchematic.setState({
      components: [{ id: "u1", kind: "opamp", x: 0, y: 0, rotation: 0, value: "ideal", label: "U1" }],
    });
    useSchematic.getState().addProbe(-32, 16); // opamp's "in+" pin
    expect(useSchematic.getState().probes).toHaveLength(1);
  });

  it("does nothing when clicking empty canvas (no net at all)", () => {
    useSchematic.getState().addProbe(500, 500);
    expect(useSchematic.getState().probes).toHaveLength(0);
  });

  it("keeps current-probe (component) dedup independent of net-probe dedup", () => {
    useSchematic.setState({
      components: [{ id: "r-1", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" }],
    });
    useSchematic.getState().toggleCurrentProbe("r-1");
    useSchematic.getState().toggleCurrentProbe("r-1");
    expect(useSchematic.getState().probes).toHaveLength(0); // still toggles independently
  });
});

describe("selectMixed + deleteSelected — marquee selects and deletes ALL object kinds (§UX)", () => {
  const populate = () => {
    useSchematic.setState({
      components: [{ id: "r1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k", label: "R1" }],
      wires: [{ id: "w1", points: [{ x: 64, y: 0 }, { x: 128, y: 0 }] }],
      netLabels: [{ id: "l1", x: 96, y: 0, text: "vout" }],
      probes: [{ id: "p1", x: 96, y: 0, color: "red" }],
    });
  };

  it("selectMixed marks every object kind at once", () => {
    populate();
    useSchematic.getState().selectMixed({ componentIds: ["r1"], wireIds: ["w1"], labelIds: ["l1"], probeIds: ["p1"] });
    const s = useSchematic.getState();
    expect(s.selectedIds).toEqual(["r1"]);
    expect(s.selectedWireIds).toEqual(["w1"]);
    expect(s.selectedLabelIds).toEqual(["l1"]);
    expect(s.selectedProbeIds).toEqual(["p1"]);
  });

  it("deleteSelected removes components, wires, labels, and probes together in ONE undo step", () => {
    populate();
    useSchematic.getState().selectMixed({ componentIds: ["r1"], wireIds: ["w1"], labelIds: ["l1"], probeIds: ["p1"] });
    useSchematic.getState().deleteSelected();
    const s = useSchematic.getState();
    expect(s.components).toHaveLength(0);
    expect(s.wires).toHaveLength(0);
    expect(s.netLabels).toHaveLength(0);
    expect(s.probes).toHaveLength(0);
    useSchematic.getState().undo();
    const restored = useSchematic.getState();
    expect(restored.components).toHaveLength(1);
    expect(restored.wires).toHaveLength(1);
    expect(restored.netLabels).toHaveLength(1);
    expect(restored.probes).toHaveLength(1);
  });

  it("component-only and wire-only selections still delete (no regression)", () => {
    populate();
    useSchematic.getState().selectMixed({ componentIds: ["r1"], wireIds: [], labelIds: [], probeIds: [] });
    useSchematic.getState().deleteSelected();
    expect(useSchematic.getState().components).toHaveLength(0);
    expect(useSchematic.getState().wires).toHaveLength(1); // untouched
  });

  it("single-select paths clear stale mixed selection", () => {
    populate();
    useSchematic.getState().selectMixed({ componentIds: [], wireIds: [], labelIds: ["l1"], probeIds: ["p1"] });
    useSchematic.getState().select("r1");
    const s = useSchematic.getState();
    expect(s.selectedLabelIds).toEqual([]);
    expect(s.selectedProbeIds).toEqual([]);
  });
});

describe("upsertNetLabel — one label per physically-connected node (§UX)", () => {
  const lWire = () => {
    // One L-shaped wire: (32, 0) and (64, 32) are two points on the same node.
    useSchematic.setState({
      wires: [{ id: "w1", points: [{ x: 0, y: 0 }, { x: 64, y: 0 }, { x: 64, y: 64 }] }],
    });
  };

  it("labeling a DIFFERENT point on the same node MOVES the existing label (no duplicate)", () => {
    lWire();
    useSchematic.getState().upsertNetLabel(32, 0, "vout");
    const firstId = useSchematic.getState().netLabels[0].id;
    useSchematic.getState().upsertNetLabel(64, 32, "vout");
    const labels = useSchematic.getState().netLabels;
    expect(labels).toHaveLength(1); // never stacked
    expect(labels[0].id).toBe(firstId); // same label object, relocated
    expect(labels[0]).toMatchObject({ x: 64, y: 32, text: "vout" });
  });

  it("re-labeling the same node with a new name replaces the text in place", () => {
    lWire();
    useSchematic.getState().upsertNetLabel(32, 0, "vout");
    useSchematic.getState().upsertNetLabel(64, 32, "vmid");
    const labels = useSchematic.getState().netLabels;
    expect(labels).toHaveLength(1);
    expect(labels[0].text).toBe("vmid");
  });

  it("the SAME net name may still label two physically DISCONNECTED nodes (named-net connect)", () => {
    useSchematic.setState({
      wires: [
        { id: "w1", points: [{ x: 0, y: 0 }, { x: 64, y: 0 }] },
        { id: "w2", points: [{ x: 0, y: 128 }, { x: 64, y: 128 }] },
      ],
    });
    useSchematic.getState().upsertNetLabel(32, 0, "vcc");
    useSchematic.getState().upsertNetLabel(32, 128, "vcc");
    expect(useSchematic.getState().netLabels).toHaveLength(2); // this is the by-name connection feature
  });

  it("an empty commit anywhere on the node removes its label", () => {
    lWire();
    useSchematic.getState().upsertNetLabel(32, 0, "vout");
    useSchematic.getState().upsertNetLabel(64, 32, "   "); // different point, same node
    expect(useSchematic.getState().netLabels).toHaveLength(0);
  });

  it("a label move is undoable back to the original anchor", () => {
    lWire();
    useSchematic.getState().upsertNetLabel(32, 0, "vout");
    useSchematic.getState().upsertNetLabel(64, 32, "vout");
    useSchematic.getState().undo();
    const labels = useSchematic.getState().netLabels;
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ x: 32, y: 0 });
  });

  it("setNetLabelDirect edits the node's existing label instead of duplicating", () => {
    lWire();
    useSchematic.getState().upsertNetLabel(32, 0, "v");
    useSchematic.getState().setNetLabelDirect(64, 32, "vo");
    const labels = useSchematic.getState().netLabels;
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ x: 64, y: 32, text: "vo" });
  });
});

describe("toggleCurrentProbe (clamp-meter)", () => {
  const withParts = () => {
    useSchematic.setState({
      components: [
        { id: "r-1", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" },
        { id: "gnd-1", kind: "ground", x: 0, y: 64, rotation: 0, value: "", label: "" },
      ],
      // Wire across R1's pins so (96, 0) — R1's own body position, where its
      // current probe sits — also resolves to a net (mid-segment) for the
      // "coincident net probe" test below; addProbe now requires a net.
      wires: [{ id: "w-1", points: [{ x: 64, y: 0 }, { x: 128, y: 0 }] }],
    });
  };

  it("adds a probe carrying the componentId at the component's position", () => {
    withParts();
    useSchematic.getState().toggleCurrentProbe("r-1");
    const probes = useSchematic.getState().probes;
    expect(probes).toHaveLength(1);
    expect(probes[0]).toMatchObject({ componentId: "r-1", x: 96, y: 0 });
  });

  it("toggles the probe off on a second call for the same component", () => {
    withParts();
    useSchematic.getState().toggleCurrentProbe("r-1");
    useSchematic.getState().toggleCurrentProbe("r-1");
    expect(useSchematic.getState().probes).toHaveLength(0);
  });

  it("cycles probe colors together with net probes", () => {
    withParts();
    useSchematic.getState().addProbe(64, 0); // first color
    useSchematic.getState().toggleCurrentProbe("r-1"); // second color
    const probes = useSchematic.getState().probes;
    expect(probes[0].color).toBe("var(--trace-red)");
    expect(probes[1].color).toBe("var(--trace-purple)");
  });

  it("refuses grounds and unknown component ids", () => {
    withParts();
    useSchematic.getState().toggleCurrentProbe("gnd-1");
    useSchematic.getState().toggleCurrentProbe("no-such-id");
    expect(useSchematic.getState().probes).toHaveLength(0);
  });

  it("does not toggle a coincident net probe off via addProbe", () => {
    withParts();
    useSchematic.getState().toggleCurrentProbe("r-1"); // sits at (96, 0)
    useSchematic.getState().addProbe(96, 0); // net probe at the same point
    const probes = useSchematic.getState().probes;
    expect(probes).toHaveLength(2);
    expect(probes.filter((p) => p.componentId)).toHaveLength(1);
  });
});

describe("keyboard shortcuts are read-only outside the schematic view (§UX)", () => {
  // Wired the same way App.tsx wires dispatchShortcutAction to the store, so
  // this exercises the exact production callback graph against the real
  // store — not mocks — and proves the store genuinely doesn't change.
  const realHandlers = (): ShortcutHandlers => ({
    undo: () => useSchematic.getState().undo(),
    redo: () => useSchematic.getState().redo(),
    openPalette: () => {},
    rotate: () => useSchematic.getState().rotate(),
    mirror: () => useSchematic.getState().mirror(),
    copy: () => useSchematic.getState().copySelected(),
    paste: () => useSchematic.getState().paste(),
    duplicate: () => useSchematic.getState().duplicateSelected(),
    cancel: () => useSchematic.getState().cancel(),
    remove: () => useSchematic.getState().deleteSelected(),
    wire: () => useSchematic.getState().startWiring(),
    label: () => useSchematic.getState().startLabeling(),
  });

  const withSelectedResistor = () => {
    useSchematic.setState({
      components: [{ id: "r-1", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" }],
      selectedId: "r-1",
    });
  };

  it("does not delete the selected component on Delete/Backspace in simulator mode", () => {
    withSelectedResistor();
    const action = resolveShortcut({ key: "Delete", ctrlOrMeta: false, shift: false })!;
    dispatchShortcutAction(action, "simulator", realHandlers());
    expect(useSchematic.getState().components).toHaveLength(1);
  });

  it("does not undo/redo the document from the simulator view", () => {
    withSelectedResistor();
    useSchematic.getState().rotate(); // schematic-mode edit, produces its own history entry
    const rotatedComponents = useSchematic.getState().components;
    const undoAction = resolveShortcut({ key: "z", ctrlOrMeta: true, shift: false })!;
    dispatchShortcutAction(undoAction, "simulator", realHandlers());
    expect(useSchematic.getState().components).toEqual(rotatedComponents);
    expect(useSchematic.getState().past.length).toBeGreaterThan(0); // history untouched
  });

  it("does not rotate/mirror/duplicate/paste from the simulator view", () => {
    withSelectedResistor();
    const before = useSchematic.getState().components;
    const handlers = realHandlers();
    for (const key of [
      { key: "r", ctrlOrMeta: true, shift: false },
      { key: "e", ctrlOrMeta: true, shift: false },
      { key: "d", ctrlOrMeta: true, shift: false },
      { key: "v", ctrlOrMeta: true, shift: false },
      { key: " ", ctrlOrMeta: false, shift: false },
    ]) {
      const action = resolveShortcut(key);
      if (action) dispatchShortcutAction(action, "simulator", handlers);
    }
    expect(useSchematic.getState().components).toEqual(before);
  });

  it("does not arm the wire/label tool from the simulator view", () => {
    withSelectedResistor();
    const handlers = realHandlers();
    dispatchShortcutAction(resolveShortcut({ key: "w", ctrlOrMeta: false, shift: false })!, "simulator", handlers);
    expect(useSchematic.getState().tool).toEqual({ mode: "select" });
    dispatchShortcutAction(resolveShortcut({ key: "F4", ctrlOrMeta: false, shift: false })!, "simulator", handlers);
    expect(useSchematic.getState().tool).toEqual({ mode: "select" });
  });

  it("still allows the same actions from the schematic view (positive control)", () => {
    withSelectedResistor();
    const action = resolveShortcut({ key: "Delete", ctrlOrMeta: false, shift: false })!;
    dispatchShortcutAction(action, "schematic", realHandlers());
    expect(useSchematic.getState().components).toHaveLength(0);
  });

  it("still allows cancel (Escape) from the simulator view", () => {
    useSchematic.setState({ tool: { mode: "wire" }, selectedId: "r-1" });
    const action = resolveShortcut({ key: "Escape", ctrlOrMeta: false, shift: false })!;
    dispatchShortcutAction(action, "simulator", realHandlers());
    expect(useSchematic.getState().tool).toEqual({ mode: "select" });
  });
});
