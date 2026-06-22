import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { useSchematic, type SchematicDocument } from "./useSchematic";

const sourceDocument = (): SchematicDocument => ({
  components: [
    { id: "source-r1", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" },
  ],
  wires: [
    { id: "source-w1", points: [{ x: 64, y: 0 }, { x: 128, y: 0 }] },
  ],
});

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
  localStorageValues.clear();
  resetStore();
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
});
