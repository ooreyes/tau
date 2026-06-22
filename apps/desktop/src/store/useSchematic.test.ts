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
    tool: { mode: "select" },
    placeRotation: 0,
    probes: [],
    netLabels: [],
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
});
