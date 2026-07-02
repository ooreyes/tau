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
  NetLabel,
} from "../schematic/types";
import { CATALOG_BY_KIND } from "../schematic/catalog";
import { validateSchematicDocument } from "../schematic/documentValidation";

/** The undoable document slice. Everything else in the store is ephemeral UI. */
interface Doc {
  components: SchematicComponent[];
  wires: SchematicWire[];
  counters: Record<string, number>;
  probes: Probe[];
  netLabels: NetLabel[];
  /** SPICE directives (`.param`/`.tran`/`.ac`/`.meas`/…) carried by the document. */
  directives: string[];
}

export interface SchematicDocument {
  components: SchematicComponent[];
  wires: SchematicWire[];
  /** Optional for compatibility with Tau v1 files. */
  probes?: Probe[];
  /** Optional for compatibility with Tau v1 files. */
  netLabels?: NetLabel[];
  /**
   * Optional SPICE directive lines (leading "." or "!" already stripped to a
   * bare directive, e.g. `param Rload=10k`, `tran 1m`). Set by the LTspice
   * importer from `TEXT !` lines; absent for legacy/v1 files.
   */
  directives?: string[];
}

export interface SchematicHistory {
  past: Doc[];
  future: Doc[];
}

interface SchematicState extends Doc {
  // ephemeral UI state (never recorded in history)
  selectedId: string | null;
  selectedWireId: string | null;
  /** Multi-selection: all selected component ids (superset of selectedId). */
  selectedIds: string[];
  tool: Tool;
  /** Rotation applied to the next placed component (and the placement ghost). */
  placeRotation: Rotation;
  /** Horizontal flip applied to the next placed component (and the placement ghost). */
  placeMirror: boolean;
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
  /** Replace the entire multi-selection (clears single-select and wire select). */
  selectMultiple: (ids: string[]) => void;
  /** Toggle a single component in/out of the multi-selection (Shift+click). */
  toggleSelect: (id: string) => void;
  /**
   * Move a group of components together by (dx, dy) *from their drag-start
   * origins*, rubber-banding any wire endpoints that were pinned to their pins
   * at drag start. Both the origins and the deltas are relative to drag start,
   * so repeated calls during one drag are idempotent for the same (dx, dy) —
   * matching the absolute-position single-component move path.
   * Caller must call `beginChange()` once before the first pointer-move.
   */
  moveGroup: (
    origins: Map<string, { x: number; y: number }>,
    dx: number,
    dy: number,
    sourcePins: Map<string, { x: number; y: number }[]>,
    sourceWires: import("../schematic/types").SchematicWire[],
  ) => void;

  /** Meter probes (ephemeral): each pins to a world point and plots whatever net is there. */
  probes: Probe[];
  startProbing: () => void;
  addProbe: (x: number, y: number) => void;
  removeProbe: (id: string) => void;
  clearProbes: () => void;
  /** Replace all probes (used to restore a tab's saved probes). */
  setProbes: (probes: Probe[]) => void;

  /** User-assigned net names, pinned to world points on the net. */
  netLabels: NetLabel[];
  upsertNetLabel: (x: number, y: number, text: string) => void;
  /**
   * Update a net label without pushing to undo history (caller must call
   * `beginChange()` once before the first keystroke, then use this for
   * subsequent characters so the whole edit is a single undo entry).
   */
  setNetLabelDirect: (x: number, y: number, text: string) => void;

  addComponent: (kind: ComponentKind, x: number, y: number) => void;
  addWire: (points: Point[]) => void;
  moveComponent: (id: string, x: number, y: number) => void;
  /** Rotate the current selection, or the placement ghost when in place mode. */
  rotate: () => void;
  /** Mirror (horizontal flip) the current selection, or the placement ghost in place mode. */
  mirror: () => void;

  /** Clipboard holding a copied component (ephemeral; never recorded in history). */
  clipboard: SchematicComponent | null;
  /** Copy the selected component into the clipboard. */
  copySelected: () => void;
  /** Paste the clipboard component (offset + fresh ref-des), selecting the copy. */
  paste: () => void;
  /** Duplicate the selected component in place (copy + paste in one step, Ctrl+D). */
  duplicateSelected: () => void;
  deleteSelected: () => void;
  /** Clear any active selection (single, multi, or wire). */
  clearSelection: () => void;
  setValue: (id: string, value: string) => void;

  /** SPICE directives carried by the document (built into the param scope at run time). */
  directives: string[];
  /** Replace the document's directive lines (used by the LTspice importer / directive editor). */
  setDirectives: (directives: string[]) => void;

  loadCircuit: (doc: SchematicDocument) => void;
  /** Restore a trusted in-memory tab snapshot without leaking history between tabs. */
  restoreCircuit: (doc: SchematicDocument, history: SchematicHistory) => void;
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
const docOf = (s: Doc): Doc => ({
  components: s.components,
  wires: s.wires,
  counters: s.counters,
  probes: s.probes,
  netLabels: s.netLabels,
  directives: s.directives,
});

/** Grid units a pasted/duplicated component is offset by so it never lands exactly
 *  on top of its source (2 grid cells, like LTspice's paste nudge). */
const PASTE_OFFSET = 32;

/**
 * Produce a placed clone of `src`: a fresh id, the next ref-des for its kind, and
 * a small diagonal offset. `pinOverride` (imported, pin-accurate parts) is offset
 * by the same delta so the copy stays connected to wires the same way.
 */
function placeClone(
  counters: Record<string, number>,
  src: SchematicComponent,
): { comp: SchematicComponent; prefix: string; next: number } {
  const entry = CATALOG_BY_KIND[src.kind];
  const next = (counters[entry.prefix] ?? 0) + 1;
  const label = entry.prefix === "GND" ? "" : `${entry.prefix}${next}`;
  const comp: SchematicComponent = {
    ...src,
    id: nanoid(6),
    x: src.x + PASTE_OFFSET,
    y: src.y + PASTE_OFFSET,
    label,
    ...(src.pinOverride
      ? { pinOverride: src.pinOverride.map((p) => ({ ...p, x: p.x + PASTE_OFFSET, y: p.y + PASTE_OFFSET })) }
      : {}),
  };
  return { comp, prefix: entry.prefix, next };
}

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
function copyDocument(doc: SchematicDocument, freshIds: boolean): SchematicDocument {
  return {
    components: doc.components.map((c) => ({ ...c, id: freshIds ? nanoid(6) : c.id })),
    wires: doc.wires.map((w) => ({ id: freshIds ? nanoid(6) : w.id, points: w.points.map((p) => ({ ...p })) })),
    probes: (doc.probes ?? []).map((probe) => ({ ...probe, id: freshIds ? nanoid(6) : probe.id })),
    netLabels: (doc.netLabels ?? []).map((label) => ({ ...label, id: freshIds ? nanoid(6) : label.id })),
    directives: [...(doc.directives ?? [])],
  };
}

/** Clone an imported document with fresh ids so files/examples never alias live state. */
function cloneDocument(doc: SchematicDocument): SchematicDocument {
  return copyDocument(doc, true);
}

function copyHistoryEntry(entry: Doc): Doc {
  const document = copyDocument(entry, false);
  return {
    ...document,
    counters: { ...entry.counters },
    probes: document.probes ?? [],
    netLabels: document.netLabels ?? [],
    directives: document.directives ?? [],
  };
}

function loadPersisted(): SchematicDocument | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    // Validate fully so stale or corrupt autosave data never reaches the renderer.
    return validateSchematicDocument(JSON.parse(raw));
  } catch {
    // Corrupt, stale, or incompatible autosave — discard silently.
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

/** Deduplicate consecutive identical points and collapse collinear runs (mirrors
 *  `cleanRoute` from Canvas.tsx — kept here so the store has no UI import). */
function cleanGroupRoute(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    if (out.length === 0 || out[out.length - 1].x !== p.x || out[out.length - 1].y !== p.y) out.push(p);
  }
  for (let i = 1; i < out.length - 1; i += 1) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) {
      out.splice(i, 1);
      i -= 1;
    }
  }
  return out;
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
    selectedIds: [],
    tool: { mode: "select" },
    placeRotation: 0,
    placeMirror: false,
    clipboard: null,
    probes: initialDoc?.probes ?? [],
    netLabels: initialDoc?.netLabels ?? [],
    directives: initialDoc?.directives ?? [],
    past: [],
    future: [],

    beginChange: () => set((s) => recordInto(s)),

    setDirectives: (directives) => set((s) => ({ ...recordInto(s), directives: [...directives] })),

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
          selectedIds: [],
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
          selectedIds: [],
        };
      }),

    startPlacing: (kind) => set({ tool: { mode: "place", kind }, selectedId: null, selectedWireId: null, selectedIds: [] }),
    startWiring: () => set({ tool: { mode: "wire" }, selectedId: null, selectedWireId: null, selectedIds: [] }),
    cancel: () => set({ tool: { mode: "select" } }),

    select: (id) => set({ selectedId: id, selectedWireId: null, selectedIds: id ? [id] : [] }),
    selectWire: (id) => set({ selectedWireId: id, selectedId: null, selectedIds: [] }),

    selectMultiple: (ids) =>
      set({
        selectedIds: ids,
        selectedId: ids.length === 1 ? ids[0] : null,
        selectedWireId: null,
      }),

    toggleSelect: (id) =>
      set((s) => {
        const already = s.selectedIds.includes(id);
        const next = already ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id];
        return {
          selectedIds: next,
          selectedId: next.length === 1 ? next[0] : null,
          selectedWireId: null,
        };
      }),

    moveGroup: (origins, dx, dy, sourcePins, sourceWires) =>
      set((s) => {
        // Collect all pin world positions for components in the selection
        const allSourcePins: Point[] = [];
        for (const [, pins] of sourcePins) {
          for (const p of pins) allSourcePins.push(p);
        }
        // Absolute placement from the drag-start origin — never from the current
        // position, which would compound the cumulative delta on every event.
        const updatedComponents = s.components.map((c) => {
          const origin = origins.get(c.id);
          if (!origin) return c;
          return { ...c, x: origin.x + dx, y: origin.y + dy };
        });
        // Import translateAttachedWireEndpoints logic inline (avoid circular deps)
        // We use the exported function from Canvas — but store can't import Canvas.
        // Instead replicate the minimal logic here.
        const pinSet = new Set(allSourcePins.map((p) => `${p.x},${p.y}`));
        const isPinPoint = (pt: Point) => pinSet.has(`${pt.x},${pt.y}`);
        const updatedWires = sourceWires.map((wire) => {
          if (wire.points.length < 2) return wire;
          const firstMoved = isPinPoint(wire.points[0]);
          const lastMoved = isPinPoint(wire.points[wire.points.length - 1]);
          if (!firstMoved && !lastMoved) return wire;
          if (firstMoved && lastMoved) {
            return { ...wire, points: wire.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
          }
          const shiftedFirst = firstMoved ? { x: wire.points[0].x + dx, y: wire.points[0].y + dy } : null;
          const shiftedLast = lastMoved ? { x: wire.points[wire.points.length - 1].x + dx, y: wire.points[wire.points.length - 1].y + dy } : null;
          if (shiftedFirst) {
            const pts = wire.points;
            const next = pts[1];
            const target = shiftedFirst;
            const startsAligned = target.x === next.x || target.y === next.y;
            if (startsAligned) {
              return { ...wire, points: cleanGroupRoute([target, ...pts.slice(1)]) };
            }
            const origFirst = pts[0];
            const elbow = origFirst.y === next.y ? { x: next.x, y: target.y } : { x: target.x, y: next.y };
            return { ...wire, points: cleanGroupRoute([target, elbow, ...pts.slice(1)]) };
          }
          // shiftedLast
          {
            const pts = wire.points;
            const previous = pts[pts.length - 2];
            const target = shiftedLast!;
            const startsAligned = previous.x === target.x || previous.y === target.y;
            if (startsAligned) {
              return { ...wire, points: cleanGroupRoute([...pts.slice(0, -1), target]) };
            }
            const origLast = pts[pts.length - 1];
            const elbow = previous.y === origLast.y ? { x: previous.x, y: target.y } : { x: target.x, y: previous.y };
            return { ...wire, points: cleanGroupRoute([...pts.slice(0, -1), elbow, target]) };
          }
        });
        return { components: updatedComponents, wires: updatedWires };
      }),

    startProbing: () => set({ tool: { mode: "probe" }, selectedId: null, selectedWireId: null }),
    addProbe: (x, y) =>
      set((s) => {
        const existing = s.probes.find((p) => p.x === x && p.y === y);
        if (existing) return { ...recordInto(s), probes: s.probes.filter((p) => p.id !== existing.id) };
        const color = PROBE_COLORS[s.probes.length % PROBE_COLORS.length];
        return { ...recordInto(s), probes: [...s.probes, { id: nanoid(6), x, y, color }] };
      }),
    removeProbe: (id) => set((s) => ({ ...recordInto(s), probes: s.probes.filter((p) => p.id !== id) })),
    clearProbes: () => set((s) => ({ ...recordInto(s), probes: [] })),
    setProbes: (probes) => set({ probes }),

    upsertNetLabel: (x, y, text) =>
      set((s) => {
        const trimmed = text.trim();
        const existing = s.netLabels.find((l) => l.x === x && l.y === y);
        if (!trimmed) return { ...recordInto(s), netLabels: s.netLabels.filter((l) => !(l.x === x && l.y === y)) };
        if (existing) return { ...recordInto(s), netLabels: s.netLabels.map((l) => (l.id === existing.id ? { ...l, text: trimmed } : l)) };
        return { ...recordInto(s), netLabels: [...s.netLabels, { id: nanoid(6), x, y, text: trimmed }] };
      }),

    setNetLabelDirect: (x, y, text) =>
      set((s) => {
        const existing = s.netLabels.find((l) => l.x === x && l.y === y);
        if (!text) return { netLabels: s.netLabels.filter((l) => !(l.x === x && l.y === y)) };
        if (existing) return { netLabels: s.netLabels.map((l) => (l.id === existing.id ? { ...l, text } : l)) };
        return { netLabels: [...s.netLabels, { id: nanoid(6), x, y, text }] };
      }),

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
          mirrored: s.placeMirror,
          value: entry.defaultValue,
          label,
        };
        return {
          ...recordInto(s),
          components: [...s.components, comp],
          counters: { ...s.counters, [entry.prefix]: n },
          selectedId: comp.id,
          selectedWireId: null,
          selectedIds: [comp.id],
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

    mirror: () =>
      set((s) => {
        if (s.tool.mode === "place") return { placeMirror: !s.placeMirror };
        if (s.selectedId) {
          return {
            ...recordInto(s),
            components: s.components.map((c) =>
              c.id === s.selectedId ? { ...c, mirrored: !(c.mirrored ?? false) } : c,
            ),
          };
        }
        return {};
      }),

    copySelected: () =>
      set((s) => {
        if (!s.selectedId) return {};
        const src = s.components.find((c) => c.id === s.selectedId);
        return src ? { clipboard: { ...src } } : {};
      }),

    paste: () =>
      set((s) => {
        if (!s.clipboard) return {};
        const { comp, prefix, next } = placeClone(s.counters, s.clipboard);
        return {
          ...recordInto(s),
          components: [...s.components, comp],
          counters: { ...s.counters, [prefix]: next },
          selectedId: comp.id,
          selectedWireId: null,
          selectedIds: [comp.id],
        };
      }),

    duplicateSelected: () =>
      set((s) => {
        if (!s.selectedId) return {};
        const src = s.components.find((c) => c.id === s.selectedId);
        if (!src) return {};
        const { comp, prefix, next } = placeClone(s.counters, src);
        return {
          ...recordInto(s),
          components: [...s.components, comp],
          counters: { ...s.counters, [prefix]: next },
          selectedId: comp.id,
          selectedWireId: null,
          selectedIds: [comp.id],
        };
      }),

    deleteSelected: () =>
      set((s) => {
        // Multi-select takes priority: delete all selected component ids.
        if (s.selectedIds.length > 0) {
          const idSet = new Set(s.selectedIds);
          return {
            ...recordInto(s),
            components: s.components.filter((c) => !idSet.has(c.id)),
            selectedId: null,
            selectedIds: [],
          };
        }
        if (s.selectedId) {
          return {
            ...recordInto(s),
            components: s.components.filter((c) => c.id !== s.selectedId),
            selectedId: null,
            selectedIds: [],
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

    clearSelection: () => set({ selectedId: null, selectedWireId: null, selectedIds: [] }),

    // History for a value edit is captured once by the caller via beginChange() on first keystroke.
    setValue: (id, value) =>
      set((s) => ({
        components: s.components.map((c) => (c.id === id ? { ...c, value } : c)),
      })),

    loadCircuit: (doc) =>
      set(() => {
        const cloned = cloneDocument(doc);
        return {
          components: cloned.components,
          wires: cloned.wires,
          counters: deriveCounters(cloned.components),
          probes: cloned.probes ?? [],
          netLabels: cloned.netLabels ?? [],
          directives: cloned.directives ?? [],
          past: [],
          future: [],
          selectedId: null,
          selectedWireId: null,
          selectedIds: [],
          tool: { mode: "select" },
        };
      }),

    restoreCircuit: (doc, history) =>
      set(() => {
        const restored = copyDocument(doc, false);
        return {
          components: restored.components,
          wires: restored.wires,
          counters: deriveCounters(restored.components),
          probes: restored.probes ?? [],
          netLabels: restored.netLabels ?? [],
          directives: restored.directives ?? [],
          past: history.past.map(copyHistoryEntry).slice(-HISTORY_LIMIT),
          future: history.future.map(copyHistoryEntry).slice(0, HISTORY_LIMIT),
          selectedId: null,
          selectedWireId: null,
          selectedIds: [],
          tool: { mode: "select" },
        };
      }),

    newCircuit: () =>
      set(() => ({
        components: [],
        wires: [],
        counters: {},
        probes: [],
        netLabels: [],
        directives: [],
        past: [],
        future: [],
        selectedId: null,
        selectedWireId: null,
        selectedIds: [],
        tool: { mode: "select" },
      })),
  };
});

// Autosave the document to localStorage so work survives an app restart.
useSchematic.subscribe((state, prev) => {
  if (
    state.components !== prev.components
    || state.wires !== prev.wires
    || state.probes !== prev.probes
    || state.netLabels !== prev.netLabels
    || state.directives !== prev.directives
  ) {
    persist({
      components: state.components,
      wires: state.wires,
      probes: state.probes,
      netLabels: state.netLabels,
      directives: state.directives,
    });
  }
});
