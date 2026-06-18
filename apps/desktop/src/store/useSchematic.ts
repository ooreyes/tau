import { create } from "zustand";
import { nanoid } from "nanoid";
import type {
  ComponentKind,
  Point,
  Rotation,
  SchematicComponent,
  SchematicWire,
  Tool,
} from "../schematic/types";
import { CATALOG_BY_KIND } from "../schematic/catalog";

/** The undoable document slice. Everything else in the store is ephemeral UI. */
interface Doc {
  components: SchematicComponent[];
  wires: SchematicWire[];
  counters: Record<string, number>;
}

export interface SchematicDocument {
  components: SchematicComponent[];
  wires: SchematicWire[];
}

interface SchematicState extends Doc {
  // ephemeral UI state (never recorded in history)
  selectedId: string | null;
  selectedWireId: string | null;
  tool: Tool;
  /** Rotation applied to the next placed component (and the placement ghost). */
  placeRotation: Rotation;
  // history
  past: Doc[];
  future: Doc[];

  /** Snapshot the current document before a gesture (drag) or continuous edit (typing). */
  beginChange: () => void;
  undo: () => void;
  redo: () => void;

  startPlacing: (kind: ComponentKind) => void;
  startWiring: () => void;
  cancel: () => void;
  select: (id: string | null) => void;
  selectWire: (id: string | null) => void;

  addComponent: (kind: ComponentKind, x: number, y: number) => void;
  addWire: (points: Point[]) => void;
  moveComponent: (id: string, x: number, y: number) => void;
  /** Rotate the current selection, or the placement ghost when in place mode. */
  rotate: () => void;
  deleteSelected: () => void;
  setValue: (id: string, value: string) => void;

  loadCircuit: (doc: SchematicDocument) => void;
  newCircuit: () => void;
}

const HISTORY_LIMIT = 100;
const nextRotation = (r: Rotation): Rotation => (((r + 90) % 360) as Rotation);
const docOf = (s: Doc): Doc => ({ components: s.components, wires: s.wires, counters: s.counters });

/** Rebuild designator counters from labels so loaded circuits keep numbering correct. */
function deriveCounters(components: SchematicComponent[]): Record<string, number> {
  const counters: Record<string, number> = {};
  for (const c of components) {
    const m = c.label.match(/^([A-Za-z]+)(\d+)$/);
    if (m) counters[m[1]] = Math.max(counters[m[1]] ?? 0, Number(m[2]));
  }
  return counters;
}

export const useSchematic = create<SchematicState>()((set) => {
  /** Push the current document onto the undo stack and clear redo. */
  const recordInto = (s: SchematicState) => ({
    past: [...s.past, docOf(s)].slice(-HISTORY_LIMIT),
    future: [] as Doc[],
  });

  return {
    components: [],
    wires: [],
    counters: {},
    selectedId: null,
    selectedWireId: null,
    tool: { mode: "select" },
    placeRotation: 0,
    past: [],
    future: [],

    beginChange: () => set((s) => recordInto(s)),

    undo: () =>
      set((s) => {
        if (s.past.length === 0) return {};
        const previous = s.past[s.past.length - 1];
        return {
          ...previous,
          past: s.past.slice(0, -1),
          future: [docOf(s), ...s.future].slice(0, HISTORY_LIMIT),
          selectedId: null,
          selectedWireId: null,
        };
      }),

    redo: () =>
      set((s) => {
        if (s.future.length === 0) return {};
        const next = s.future[0];
        return {
          ...next,
          past: [...s.past, docOf(s)].slice(-HISTORY_LIMIT),
          future: s.future.slice(1),
          selectedId: null,
          selectedWireId: null,
        };
      }),

    startPlacing: (kind) => set({ tool: { mode: "place", kind }, selectedId: null, selectedWireId: null }),
    startWiring: () => set({ tool: { mode: "wire" }, selectedId: null, selectedWireId: null }),
    cancel: () => set({ tool: { mode: "select" } }),

    select: (id) => set({ selectedId: id, selectedWireId: null }),
    selectWire: (id) => set({ selectedWireId: id, selectedId: null }),

    addComponent: (kind, x, y) =>
      set((s) => {
        const entry = CATALOG_BY_KIND[kind];
        const n = (s.counters[entry.prefix] ?? 0) + 1;
        const label = entry.prefix === "GND" ? "" : `${entry.prefix}${n}`;
        const comp: SchematicComponent = {
          id: nanoid(6),
          kind,
          x,
          y,
          rotation: s.placeRotation,
          value: entry.defaultValue,
          label,
        };
        return {
          ...recordInto(s),
          components: [...s.components, comp],
          counters: { ...s.counters, [entry.prefix]: n },
          selectedId: comp.id,
          selectedWireId: null,
        };
      }),

    addWire: (points) =>
      set((s) => {
        const uniquePoints = points.filter(
          (p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y,
        );
        if (uniquePoints.length < 2) return {};
        return {
          ...recordInto(s),
          wires: [...s.wires, { id: nanoid(6), points: uniquePoints }],
        };
      }),

    // History for a drag is captured once by the caller via beginChange() on the first move.
    moveComponent: (id, x, y) =>
      set((s) => ({
        components: s.components.map((c) => (c.id === id ? { ...c, x, y } : c)),
      })),

    rotate: () =>
      set((s) => {
        if (s.tool.mode === "place") return { placeRotation: nextRotation(s.placeRotation) };
        if (s.selectedId) {
          return {
            ...recordInto(s),
            components: s.components.map((c) =>
              c.id === s.selectedId ? { ...c, rotation: nextRotation(c.rotation) } : c,
            ),
          };
        }
        return {};
      }),

    deleteSelected: () =>
      set((s) => {
        if (s.selectedId) {
          return {
            ...recordInto(s),
            components: s.components.filter((c) => c.id !== s.selectedId),
            selectedId: null,
          };
        }
        if (s.selectedWireId) {
          return {
            ...recordInto(s),
            wires: s.wires.filter((w) => w.id !== s.selectedWireId),
            selectedWireId: null,
          };
        }
        return {};
      }),

    // History for a value edit is captured once by the caller via beginChange() on first keystroke.
    setValue: (id, value) =>
      set((s) => ({
        components: s.components.map((c) => (c.id === id ? { ...c, value } : c)),
      })),

    loadCircuit: (doc) =>
      set((s) => ({
        ...recordInto(s),
        components: doc.components,
        wires: doc.wires,
        counters: deriveCounters(doc.components),
        selectedId: null,
        selectedWireId: null,
        tool: { mode: "select" },
      })),

    newCircuit: () =>
      set((s) => ({
        ...recordInto(s),
        components: [],
        wires: [],
        counters: {},
        selectedId: null,
        selectedWireId: null,
        tool: { mode: "select" },
      })),
  };
});
