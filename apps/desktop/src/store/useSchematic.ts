import { create } from "zustand";
import { nanoid } from "nanoid";
import type {
  ComponentKind,
  Point,
  Rotation,
  SchematicComponent,
  SchematicWire,
  Tool,
  Probe,
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

  /** Meter probes (ephemeral): each pins to a world point and plots whatever net is there. */
  probes: Probe[];
  startProbing: () => void;
  addProbe: (x: number, y: number) => void;
  removeProbe: (id: string) => void;
  clearProbes: () => void;

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
/** Multimeter-lead colors, cycled as probes are added. */
const PROBE_COLORS = [
  "var(--trace-red)",
  "var(--trace-purple)",
  "var(--trace-cyan)",
  "var(--trace-green)",
  "var(--trace-amber)",
  "var(--trace-cream)",
];
const STORAGE_KEY = "tau.schematic.v1";
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

/** Clone an incoming document with fresh ids so examples/files never alias live state. */
function cloneDocument(doc: SchematicDocument): SchematicDocument {
  return {
    components: doc.components.map((c) => ({ ...c, id: nanoid(6) })),
    wires: doc.wires.map((w) => ({ id: nanoid(6), points: w.points.map((p) => ({ ...p })) })),
  };
}

function loadPersisted(): SchematicDocument | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.components) && Array.isArray(parsed.wires)) {
      return { components: parsed.components, wires: parsed.wires };
    }
  } catch {
    // ignore corrupt/unavailable storage
  }
  return null;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist(doc: SchematicDocument) {
  if (typeof localStorage === "undefined") return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    } catch {
      // ignore quota/unavailable
    }
  }, 250);
}

const initialDoc = loadPersisted();

export const useSchematic = create<SchematicState>()((set) => {
  /** Push the current document onto the undo stack and clear redo. */
  const recordInto = (s: SchematicState) => ({
    past: [...s.past, docOf(s)].slice(-HISTORY_LIMIT),
    future: [] as Doc[],
  });

  return {
    components: initialDoc?.components ?? [],
    wires: initialDoc?.wires ?? [],
    counters: initialDoc ? deriveCounters(initialDoc.components) : {},
    selectedId: null,
    selectedWireId: null,
    tool: { mode: "select" },
    placeRotation: 0,
    probes: [],
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

    startProbing: () => set({ tool: { mode: "probe" }, selectedId: null, selectedWireId: null }),
    addProbe: (x, y) =>
      set((s) => {
        const existing = s.probes.find((p) => p.x === x && p.y === y);
        if (existing) return { probes: s.probes.filter((p) => p.id !== existing.id) };
        const color = PROBE_COLORS[s.probes.length % PROBE_COLORS.length];
        return { probes: [...s.probes, { id: nanoid(6), x, y, color }] };
      }),
    removeProbe: (id) => set((s) => ({ probes: s.probes.filter((p) => p.id !== id) })),
    clearProbes: () => set({ probes: [] }),

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
      set((s) => {
        const cloned = cloneDocument(doc);
        return {
          ...recordInto(s),
          components: cloned.components,
          wires: cloned.wires,
          counters: deriveCounters(cloned.components),
          selectedId: null,
          selectedWireId: null,
          tool: { mode: "select" },
        };
      }),

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

// Autosave the document to localStorage so work survives an app restart.
useSchematic.subscribe((state, prev) => {
  if (state.components !== prev.components || state.wires !== prev.wires) {
    persist({ components: state.components, wires: state.wires });
  }
});
