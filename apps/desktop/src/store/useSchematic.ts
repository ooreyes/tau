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

interface SchematicState {
  components: SchematicComponent[];
  wires: SchematicWire[];
  selectedId: string | null;
  tool: Tool;
  /** Rotation applied to the next placed component (and the placement ghost). */
  placeRotation: Rotation;
  /** Per-prefix counters for reference designators (R1, R2, ...). */
  counters: Record<string, number>;

  startPlacing: (kind: ComponentKind) => void;
  startWiring: () => void;
  cancel: () => void;
  addComponent: (kind: ComponentKind, x: number, y: number) => void;
  addWire: (points: Point[]) => void;
  select: (id: string | null) => void;
  moveComponent: (id: string, x: number, y: number) => void;
  /** Rotate the current selection, or the placement ghost when in place mode. */
  rotate: () => void;
  deleteSelected: () => void;
  setValue: (id: string, value: string) => void;
}

const nextRotation = (r: Rotation): Rotation => (((r + 90) % 360) as Rotation);

export const useSchematic = create<SchematicState>()((set) => ({
  components: [],
  wires: [],
  selectedId: null,
  tool: { mode: "select" },
  placeRotation: 0,
  counters: {},

  startPlacing: (kind) => set({ tool: { mode: "place", kind }, selectedId: null }),

  startWiring: () => set({ tool: { mode: "wire" }, selectedId: null }),

  cancel: () => set({ tool: { mode: "select" } }),

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
        components: [...s.components, comp],
        counters: { ...s.counters, [entry.prefix]: n },
      };
    }),

  addWire: (points) =>
    set((s) => {
      const uniquePoints = points.filter(
        (p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y,
      );
      if (uniquePoints.length < 2) return {};
      return {
        wires: [...s.wires, { id: nanoid(6), points: uniquePoints }],
      };
    }),

  select: (id) => set({ selectedId: id }),

  moveComponent: (id, x, y) =>
    set((s) => ({
      components: s.components.map((c) => (c.id === id ? { ...c, x, y } : c)),
    })),

  rotate: () =>
    set((s) => {
      if (s.tool.mode === "place") {
        return { placeRotation: nextRotation(s.placeRotation) };
      }
      if (s.selectedId) {
        return {
          components: s.components.map((c) =>
            c.id === s.selectedId ? { ...c, rotation: nextRotation(c.rotation) } : c,
          ),
        };
      }
      return {};
    }),

  deleteSelected: () =>
    set((s) => ({
      components: s.components.filter((c) => c.id !== s.selectedId),
      selectedId: null,
    })),

  setValue: (id, value) =>
    set((s) => ({
      components: s.components.map((c) => (c.id === id ? { ...c, value } : c)),
    })),
}));
