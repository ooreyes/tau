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
  SchematicTextAnnotation,
  SchematicAscDataFlag,
  SchematicAscShape,
  SchematicForeignSymbol,
  SchematicSheet,
} from "../schematic/types";
import { CATALOG_BY_KIND } from "../schematic/catalog";
import { canCurrentProbe } from "../simulation/analysisSetup";
import { validateSchematicDocument } from "../schematic/documentValidation";
import { extractCircuit, netAtPoint } from "../schematic/netlist";
import { getComponentPins, rotatePoint, transformPoint } from "../schematic/pins";

/** Move a component while preserving the invariant that imported LTspice pin
 * overrides are absolute world coordinates attached to that component. */
export function moveComponentTo(component: SchematicComponent, x: number, y: number): SchematicComponent {
  const dx = x - component.x;
  const dy = y - component.y;
  return {
    ...component,
    x,
    y,
    ...(component.pinOverride
      ? { pinOverride: component.pinOverride.map((pin) => ({ ...pin, x: pin.x + dx, y: pin.y + dy })) }
      : {}),
  };
}

/**
 * A vendor SPICE model file the user attached to the document (a `.lib`,
 * `.subckt`, or `.mod`). Its text is inlined into the native deck when a placed
 * component references one of the models/subckts it defines - the safe stand-in
 * for LTspice's `.include`/`.lib`, which Tau's deck sanitizer rejects because it
 * would read arbitrary files. Attachments are immutable: they are added or
 * removed whole, never edited in place, so history snapshots can share them.
 */
export interface SchematicModelLibrary {
  /** Display name, usually the attached file's name (e.g. "opamps.lib"). */
  name: string;
  /** Raw file text, inlined verbatim (minus LTspice-only cleanup) when referenced. */
  text: string;
}

/** The undoable document slice. Everything else in the store is ephemeral UI. */
interface Doc {
  components: SchematicComponent[];
  wires: SchematicWire[];
  counters: Record<string, number>;
  probes: Probe[];
  netLabels: NetLabel[];
  /** SPICE directives (`.param`/`.tran`/`.ac`/`.meas`/…) carried by the document. */
  directives: string[];
  /** Positioned LTspice TEXT records retained for lossless `.asc` rewrites. */
  textAnnotations: SchematicTextAnnotation[];
  /** Original LTspice drawing primitives retained for lossless `.asc` rewrites. */
  ascShapes: SchematicAscShape[];
  /** Original LTspice `DATAFLAG` readouts retained for lossless `.asc` rewrites. */
  ascDataFlags: SchematicAscDataFlag[];
  /** Original SYMBOL records with no Tau equivalent, retained for lossless `.asc` rewrites. */
  ascForeignSymbols: SchematicForeignSymbol[];
  /** Original SYMBOL records that resolved to a hierarchical block and flattened. */
  ascHierarchicalBlocks: SchematicForeignSymbol[];
  /** Original LTspice SHEET record, null for Tau-native/legacy documents. */
  ascSheet: SchematicSheet | null;
  /** Vendor model files attached to the document (see {@link SchematicModelLibrary}). */
  userModelLibraries: SchematicModelLibrary[];
}

interface SchematicClipboard {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels: NetLabel[];
  probes: Probe[];
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
  /** Positioned LTspice comments/directives retained for lossless `.asc` rewrites. */
  textAnnotations?: SchematicTextAnnotation[];
  /** Drawing primitives retained for lossless `.asc` rewrites. */
  ascShapes?: SchematicAscShape[];
  /** `DATAFLAG` readouts retained for lossless `.asc` rewrites. */
  ascDataFlags?: SchematicAscDataFlag[];
  /** Source SYMBOL records with no Tau equivalent, retained for lossless `.asc` rewrites. */
  ascForeignSymbols?: SchematicForeignSymbol[];
  /**
   * Source SYMBOL records that resolved to a hierarchical block and were
   * flattened into `components`. These simulate - unlike `ascForeignSymbols` -
   * and are retained so a save can report the hierarchy it would flatten.
   */
  ascHierarchicalBlocks?: SchematicForeignSymbol[];
  /** Original LTspice SHEET record retained for lossless `.asc` rewrites. */
  ascSheet?: SchematicSheet | null;
  /**
   * Attached vendor model files (`.lib`/`.subckt`/`.mod`). Optional and additive:
   * absent for legacy/v1 files and for documents with no attachments.
   */
  userModelLibraries?: SchematicModelLibrary[];
}

export interface SchematicHistory {
  past: Doc[];
  future: Doc[];
}

interface SchematicState extends Doc {
  // ephemeral UI state (never recorded in history)
  selectedId: string | null;
  selectedWireId: string | null;
  /** Multi-wire selection (box-select); selectedWireId is the primary / first. */
  selectedWireIds: string[];
  /** Net labels included in a marquee (mixed) selection. */
  selectedLabelIds: string[];
  /** Probes included in a marquee (mixed) selection. */
  selectedProbeIds: string[];
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
  /** Replace the wire multi-selection (clears component selection). */
  selectWires: (ids: string[]) => void;
  /** Replace the entire multi-selection (clears single-select and wire select). */
  selectMultiple: (ids: string[]) => void;
  /** Marquee selection: everything the box touched, all object kinds at once. */
  selectMixed: (sel: { componentIds: string[]; wireIds: string[]; labelIds: string[]; probeIds: string[] }) => void;
  /** Toggle a single component in/out of the multi-selection (Shift+click). */
  toggleSelect: (id: string) => void;
  /**
   * Move a group of components together by (dx, dy) *from their drag-start
   * origins*, rubber-banding any wire endpoints that were pinned to their pins
   * at drag start. Both the origins and the deltas are relative to drag start,
   * so repeated calls during one drag are idempotent for the same (dx, dy) -
   * matching the absolute-position single-component move path.
   * Caller must call `beginChange()` once before the first pointer-move.
   */
  moveGroup: (
    origins: Map<string, { x: number; y: number }>,
    dx: number,
    dy: number,
    sourcePins: Map<string, { x: number; y: number }[]>,
    sourceWires: import("../schematic/types").SchematicWire[],
    labelOrigins?: Map<string, { x: number; y: number }>,
    probeOrigins?: Map<string, { x: number; y: number }>,
  ) => void;

  /** Meter probes (ephemeral): each pins to a world point and plots whatever net is there. */
  probes: Probe[];
  startProbing: () => void;
  addProbe: (x: number, y: number) => void;
  /** Toggle a clamp-meter current probe on a component (plots `I(ref)`). */
  toggleCurrentProbe: (componentId: string) => void;
  removeProbe: (id: string) => void;
  clearProbes: () => void;
  /** Replace all probes (used to restore a tab's saved probes). */
  setProbes: (probes: Probe[]) => void;
  /** Change a probe's trace color (token CSS var). */
  setProbeColor: (id: string, color: string) => void;

  /** User-assigned net names, pinned to world points on the net. */
  netLabels: NetLabel[];
  /** Enter the net-label tool (LTspice F4): click a point, type a net name. */
  startLabeling: () => void;
  upsertNetLabel: (x: number, y: number, text: string) => void;
  /**
   * Update a net label without pushing to undo history (caller must call
   * `beginChange()` once before the first keystroke, then use this for
   * subsequent characters so the whole edit is a single undo entry).
   */
  setNetLabelDirect: (x: number, y: number, text: string) => void;
  /**
   * Reposition a net label's text relative to its net anchor (drag-to-move,
   * by id - distinct from `setNetLabelDirect`'s anchor-lookup-by-point,
   * which is for the rename-draft flow). No undo entry: caller calls
   * `beginChange()` once before the first pointermove of a drag, then this
   * for every subsequent move, so the whole drag collapses into one undo
   * entry (same convention as `moveComponent`).
   */
  setNetLabelOffsetDirect: (id: string, dx: number, dy: number) => void;

  addComponent: (kind: ComponentKind, x: number, y: number) => void;
  addWire: (points: Point[]) => void;
  moveComponent: (id: string, x: number, y: number) => void;
  /** Rotate the current selection, or the placement ghost when in place mode. */
  rotate: () => void;
  /** Mirror (horizontal flip) the current selection, or the placement ghost in place mode. */
  mirror: () => void;

  /** Clipboard holding a copied mixed selection (ephemeral; never in history). */
  clipboard: SchematicClipboard | null;
  /** Copy every marquee-selected component/wire/label/probe. */
  copySelected: () => void;
  /** Paste the clipboard component (offset + fresh ref-des), selecting the copy. */
  paste: () => void;
  /** Duplicate the selected component in place (copy + paste in one step, Ctrl+D). */
  duplicateSelected: () => void;
  deleteSelected: () => void;
  /** Clear any active selection (single, multi, or wire). */
  clearSelection: () => void;
  setValue: (id: string, value: string) => void;
  /** Rename a component's reference designator (canvas label). */
  setLabel: (id: string, label: string) => void;
  /** Set optional series resistance on a wire (empty / "0" = ideal). */
  setWireResistance: (id: string, resistance: string) => void;

  /** SPICE directives carried by the document (built into the param scope at run time). */
  directives: string[];
  /** Replace the document's directive lines (used by the LTspice importer / directive editor). */
  setDirectives: (directives: string[]) => void;
  /** Positioned source TEXT records; changed only by import/document replacement. */
  textAnnotations: SchematicTextAnnotation[];
  /** Original drawing primitives; changed only by import/document replacement. */
  ascShapes: SchematicAscShape[];
  /** Original `DATAFLAG` readouts; changed only by import/document replacement. */
  ascDataFlags: SchematicAscDataFlag[];
  /** Original SYMBOL records with no Tau equivalent; changed only by import/document replacement. */
  ascForeignSymbols: SchematicForeignSymbol[];
  /** Original SYMBOL records that flattened as hierarchical blocks; same lifetime as above. */
  ascHierarchicalBlocks: SchematicForeignSymbol[];
  ascSheet: SchematicSheet | null;

  /** Vendor model files attached to the document, inlined into the native deck when referenced. */
  userModelLibraries: SchematicModelLibrary[];
  /** Attach a model file; a same-named attachment is replaced so re-attaching updates in place. */
  attachModelLibrary: (library: SchematicModelLibrary) => void;
  /** Remove the attachment with the given name (no-op if absent). */
  removeModelLibrary: (name: string) => void;

  loadCircuit: (doc: SchematicDocument) => void;
  /** Replace the active document as one undoable edit (assistant/import transforms). */
  replaceCircuit: (doc: SchematicDocument) => void;
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
  textAnnotations: s.textAnnotations,
  ascShapes: s.ascShapes,
  ascDataFlags: s.ascDataFlags,
  ascForeignSymbols: s.ascForeignSymbols,
  ascHierarchicalBlocks: s.ascHierarchicalBlocks,
  ascSheet: s.ascSheet,
  userModelLibraries: s.userModelLibraries,
});

/**
 * The document half of a blank schematic. Return-typed as `Doc` on purpose: a
 * new carried `.asc` field added to `Doc` then fails to compile here until it is
 * cleared too. Listing the fields by hand instead let `ascDataFlags` survive a
 * New circuit, so a blank document held the previous file's readouts and saving
 * it wrote them into a file they never belonged to.
 */
const blankDoc = (): Doc => ({
  components: [],
  wires: [],
  counters: {},
  probes: [],
  netLabels: [],
  directives: [],
  textAnnotations: [],
  ascShapes: [],
  ascDataFlags: [],
  ascForeignSymbols: [],
  ascHierarchicalBlocks: [],
  ascSheet: null,
  userModelLibraries: [],
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

function clipboardFromSelection(state: SchematicState): SchematicClipboard | null {
  const componentIds = new Set(state.selectedIds.length > 0
    ? state.selectedIds
    : state.selectedId ? [state.selectedId] : []);
  const wireIds = new Set(state.selectedWireIds.length > 0
    ? state.selectedWireIds
    : state.selectedWireId ? [state.selectedWireId] : []);
  const labelIds = new Set(state.selectedLabelIds);
  const probeIds = new Set(state.selectedProbeIds);
  const clipboard: SchematicClipboard = {
    components: state.components.filter((component) => componentIds.has(component.id)).map((component) => ({ ...component })),
    wires: state.wires.filter((wire) => wireIds.has(wire.id)).map((wire) => ({ ...wire, points: wire.points.map((point) => ({ ...point })) })),
    netLabels: state.netLabels.filter((label) => labelIds.has(label.id)).map((label) => ({ ...label })),
    probes: state.probes.filter((probe) => probeIds.has(probe.id)).map((probe) => ({ ...probe })),
  };
  return clipboard.components.length + clipboard.wires.length + clipboard.netLabels.length + clipboard.probes.length > 0
    ? clipboard
    : null;
}

function pasteClipboard(state: SchematicState, clipboard: SchematicClipboard): Partial<SchematicState> {
  const counters = { ...state.counters };
  const componentIdMap = new Map<string, string>();
  const components = clipboard.components.map((source) => {
    const { comp, prefix, next } = placeClone(counters, source);
    counters[prefix] = next;
    componentIdMap.set(source.id, comp.id);
    return comp;
  });
  const wires = clipboard.wires.map((wire) => ({
    ...wire,
    id: nanoid(6),
    points: wire.points.map((point) => ({ x: point.x + PASTE_OFFSET, y: point.y + PASTE_OFFSET })),
  }));
  const netLabels = clipboard.netLabels.map((label) => ({
    ...label,
    id: nanoid(6),
    x: label.x + PASTE_OFFSET,
    y: label.y + PASTE_OFFSET,
  }));
  const probes = clipboard.probes.map(({ netId: _netId, componentId, ...probe }) => ({
    ...probe,
    id: nanoid(6),
    x: probe.x + PASTE_OFFSET,
    y: probe.y + PASTE_OFFSET,
    ...(componentId && componentIdMap.has(componentId)
      ? { componentId: componentIdMap.get(componentId) }
      : {}),
  }));
  return {
    components: [...state.components, ...components],
    wires: [...state.wires, ...wires],
    netLabels: [...state.netLabels, ...netLabels],
    probes: [...state.probes, ...probes],
    counters,
    selectedId: components[0]?.id ?? null,
    selectedIds: components.map((component) => component.id),
    selectedWireId: wires[0]?.id ?? null,
    selectedWireIds: wires.map((wire) => wire.id),
    selectedLabelIds: netLabels.map((label) => label.id),
    selectedProbeIds: probes.map((probe) => probe.id),
  };
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
  const componentIds = new Map<string, string>();
  const components = doc.components.map((component) => {
    const id = freshIds ? nanoid(6) : component.id;
    componentIds.set(component.id, id);
    return {
      ...component,
      id,
      ...(component.pinOverride
        ? { pinOverride: component.pinOverride.map((pin) => ({ ...pin })) }
        : {}),
    };
  });
  return {
    components,
    wires: doc.wires.map((w) => ({ id: freshIds ? nanoid(6) : w.id, points: w.points.map((p) => ({ ...p })) })),
    probes: (doc.probes ?? []).map((probe) => ({
      ...probe,
      id: freshIds ? nanoid(6) : probe.id,
      ...(probe.componentId && componentIds.has(probe.componentId)
        ? { componentId: componentIds.get(probe.componentId) }
        : {}),
    })),
    netLabels: (doc.netLabels ?? []).map((label) => ({ ...label, id: freshIds ? nanoid(6) : label.id })),
    directives: [...(doc.directives ?? [])],
    textAnnotations: (doc.textAnnotations ?? []).map((annotation) => ({ ...annotation })),
    ascShapes: (doc.ascShapes ?? []).map((shape) => ({ ...shape, coords: [...shape.coords] })),
    ascDataFlags: (doc.ascDataFlags ?? []).map((dataFlag) => ({ ...dataFlag })),
    ascForeignSymbols: (doc.ascForeignSymbols ?? []).map((symbol) => ({
      ...symbol,
      attrs: { ...symbol.attrs },
      ...(symbol.windows ? { windows: symbol.windows.map((w) => ({ ...w })) } : {}),
    })),
    ascHierarchicalBlocks: (doc.ascHierarchicalBlocks ?? []).map((symbol) => ({
      ...symbol,
      attrs: { ...symbol.attrs },
      ...(symbol.windows ? { windows: symbol.windows.map((w) => ({ ...w })) } : {}),
    })),
    ...(doc.ascSheet ? { ascSheet: { ...doc.ascSheet } } : {}),
    // Attachments are immutable, so a shallow copy shares the (possibly large)
    // text without duplicating it - fresh ids never apply to library files.
    userModelLibraries: [...(doc.userModelLibraries ?? [])],
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
    textAnnotations: document.textAnnotations ?? [],
    ascShapes: document.ascShapes ?? [],
    ascDataFlags: document.ascDataFlags ?? [],
    ascForeignSymbols: document.ascForeignSymbols ?? [],
    ascHierarchicalBlocks: document.ascHierarchicalBlocks ?? [],
    ascSheet: document.ascSheet ?? null,
    userModelLibraries: document.userModelLibraries ?? [],
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
    // Corrupt, stale, or incompatible autosave - discard silently.
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
 *  `cleanRoute` from Canvas.tsx - kept here so the store has no UI import). */
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

const inverseRotation = (rotation: Rotation): Rotation => (((360 - rotation) % 360) as Rotation);

/** Reorient absolute imported pin geometry through component-local space. */
function reorientComponent(
  component: SchematicComponent,
  rotation: Rotation,
  mirrored: boolean,
): SchematicComponent {
  if (!component.pinOverride?.length) return { ...component, rotation, mirrored };
  const pinOverride = component.pinOverride.map((pin) => {
    const relative = { x: pin.x - component.x, y: pin.y - component.y };
    const unrotated = rotatePoint(relative, inverseRotation(component.rotation));
    const local = component.mirrored ? { x: -unrotated.x, y: unrotated.y } : unrotated;
    const next = transformPoint(local, rotation, mirrored);
    return { ...pin, x: component.x + next.x, y: component.y + next.y };
  });
  return { ...component, rotation, mirrored, pinOverride };
}

function endpointRelocations(before: readonly SchematicComponent[], after: readonly SchematicComponent[]): Map<string, Point> {
  const afterById = new Map(after.map((component) => [component.id, component]));
  const relocations = new Map<string, Point>();
  for (const component of before) {
    const next = afterById.get(component.id);
    if (!next) continue;
    const nextPins = new Map(getComponentPins(next).map((pin) => [pin.id, pin]));
    for (const pin of getComponentPins(component)) {
      const target = nextPins.get(pin.id);
      if (target && (pin.x !== target.x || pin.y !== target.y)) {
        relocations.set(`${pin.x},${pin.y}`, { x: target.x, y: target.y });
      }
    }
  }
  return relocations;
}

function relocateWireEnd(points: Point[], atStart: boolean, target: Point): Point[] {
  const ordered = atStart ? points : [...points].reverse();
  if (ordered.length < 2) return points;
  const old = ordered[0];
  const neighbor = ordered[1];
  const next = target.x === neighbor.x || target.y === neighbor.y
    ? [target, ...ordered.slice(1)]
    : [
        target,
        old.y === neighbor.y ? { x: neighbor.x, y: target.y } : { x: target.x, y: neighbor.y },
        ...ordered.slice(1),
      ];
  const cleaned = cleanGroupRoute(next);
  return atStart ? cleaned : cleaned.reverse();
}

const pointKey = (point: Point) => `${point.x},${point.y}`;

const pointOnWire = (point: Point, wire: SchematicWire) => wire.points.slice(1).some((end, index) =>
  pointOnOrthogonalSegment(point, wire.points[index], end));

function orthogonalLead(from: Point, to: Point): Point[] {
  return cleanGroupRoute([
    from,
    ...(from.x === to.x || from.y === to.y ? [] : [{ x: to.x, y: from.y }]),
    to,
  ]);
}

/** Keep conductors attached to moving/reoriented pins. A pin may terminate at
 *  a wire endpoint, share that endpoint with a stationary part, or land on the
 *  middle of a longer conductor. Shared junctions stay put and gain a lead;
 *  otherwise the owned endpoint follows the pin. */
function relocateAttachedEndpoints(
  wires: readonly SchematicWire[],
  relocations: ReadonlyMap<string, Point>,
  stationaryPinKeys: ReadonlySet<string> = new Set(),
  translatedWireIds: ReadonlySet<string> = new Set(),
  translation: Point = { x: 0, y: 0 },
): SchematicWire[] {
  return wires.flatMap((wire) => {
    if (wire.points.length < 2) return wire;
    if (translatedWireIds.has(wire.id)) {
      return { ...wire, points: wire.points.map((point) => ({
        x: point.x + translation.x,
        y: point.y + translation.y,
      })) };
    }

    const firstPoint = wire.points[0];
    const firstKey = pointKey(firstPoint);
    const first = relocations.get(firstKey);
    const lastPoint = wire.points[wire.points.length - 1];
    const lastKey = pointKey(lastPoint);
    const last = relocations.get(lastKey);
    const firstShared = !!first && stationaryPinKeys.has(firstKey);
    const lastShared = !!last && stationaryPinKeys.has(lastKey);

    const leads = [...relocations.entries()]
      .filter(([key, target]) => {
        const [x, y] = key.split(",").map(Number);
        const source = { x, y };
        const sharedEnd = (key === firstKey && firstShared) || (key === lastKey && lastShared);
        const interior = key !== firstKey && key !== lastKey && pointOnWire(source, wire);
        return (sharedEnd || interior) && (source.x !== target.x || source.y !== target.y);
      })
      .map(([key, target], index) => {
        const [x, y] = key.split(",").map(Number);
        return {
          id: `${wire.id}~lead~${key}~${index}`,
          points: orthogonalLead({ x, y }, target),
        };
      });

    const movableFirst = first && !firstShared ? first : undefined;
    const movableLast = last && !lastShared ? last : undefined;
    if (!movableFirst && !movableLast) return [wire, ...leads];

    if (movableFirst && movableLast) {
      const firstDelta = { x: movableFirst.x - firstPoint.x, y: movableFirst.y - firstPoint.y };
      const lastDelta = { x: movableLast.x - lastPoint.x, y: movableLast.y - lastPoint.y };
      if (firstDelta.x === lastDelta.x && firstDelta.y === lastDelta.y) {
        return [{
          ...wire,
          points: wire.points.map((point) => ({ x: point.x + firstDelta.x, y: point.y + firstDelta.y })),
        }, ...leads];
      }
    }
    let points = wire.points.map((point) => ({ ...point }));
    if (movableFirst) points = relocateWireEnd(points, true, movableFirst);
    if (movableLast) points = relocateWireEnd(points, false, movableLast);
    return [{ ...wire, points }, ...leads];
  });
}

function relocateAnchoredPoint<T extends Point>(
  item: T,
  relocations: ReadonlyMap<string, Point>,
  stationaryPinKeys: ReadonlySet<string> = new Set(),
): T {
  if (stationaryPinKeys.has(pointKey(item))) return item;
  const target = relocations.get(pointKey(item));
  return target ? { ...item, x: target.x, y: target.y } : item;
}

const pointOnOrthogonalSegment = (point: Point, a: Point, b: Point) =>
  a.x === b.x
    ? point.x === a.x && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)
    : a.y === b.y
      ? point.y === a.y && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x)
      : false;

/**
 * Placing a two-terminal component directly on a collinear wire inserts it
 * electrically: the covered conductor is removed and the remaining wire ends
 * terminate at the component pins. Leaving the original segment in place
 * would short/bypass the new part even though the drawing looked connected.
 */
function wiresWithInsertedComponent(wires: SchematicWire[], component: SchematicComponent): SchematicWire[] {
  const pins = getComponentPins(component);
  if (pins.length !== 2 || (pins[0].x === pins[1].x && pins[0].y === pins[1].y)) return wires;

  let inserted = false;
  const result: SchematicWire[] = [];
  for (const sourceWire of wires) {
    const wire = { ...sourceWire, points: cleanGroupRoute(sourceWire.points) };
    // A wire-level resistance models the entire original polyline. Copying it
    // onto both pieces would silently double that impedance, while assigning
    // it to one side would invent a location. Leave non-ideal wires untouched
    // until the model carries segment-level resistance.
    if (wire.resistance?.trim()) {
      result.push(sourceWire);
      continue;
    }
    let replacement: SchematicWire[] | null = null;
    for (let segmentIndex = 0; segmentIndex < wire.points.length - 1; segmentIndex += 1) {
      const a = wire.points[segmentIndex];
      const b = wire.points[segmentIndex + 1];
      if (!pointOnOrthogonalSegment(pins[0], a, b) || !pointOnOrthogonalSegment(pins[1], a, b)) continue;

      const distanceFromA = (point: Point) => Math.abs(point.x - a.x) + Math.abs(point.y - a.y);
      const [firstPin, secondPin] = distanceFromA(pins[0]) <= distanceFromA(pins[1])
        ? [pins[0], pins[1]]
        : [pins[1], pins[0]];
      // ComponentPin carries identity metadata; wire vertices are deliberately
      // plain geometry and must not persist componentId/label/kind fields.
      const firstPoint = { x: firstPin.x, y: firstPin.y };
      const secondPoint = { x: secondPin.x, y: secondPin.y };
      const before = cleanGroupRoute([...wire.points.slice(0, segmentIndex + 1), firstPoint]);
      const after = cleanGroupRoute([secondPoint, ...wire.points.slice(segmentIndex + 1)]);
      const pieces = [before, after].filter((points) => points.length >= 2);
      replacement = pieces.map((points, index) => ({
        ...wire,
        id: index === 0 ? wire.id : nanoid(6),
        points,
      }));
      inserted = true;
      break;
    }
    result.push(...(replacement ?? [sourceWire]));
  }
  return inserted ? result : wires;
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
    selectedWireIds: [], selectedLabelIds: [], selectedProbeIds: [],
    selectedIds: [],
    tool: { mode: "select" },
    placeRotation: 0,
    placeMirror: false,
    clipboard: null,
    probes: initialDoc?.probes ?? [],
    netLabels: initialDoc?.netLabels ?? [],
    directives: initialDoc?.directives ?? [],
    textAnnotations: initialDoc?.textAnnotations ?? [],
    ascShapes: initialDoc?.ascShapes ?? [],
    ascDataFlags: initialDoc?.ascDataFlags ?? [],
    ascForeignSymbols: initialDoc?.ascForeignSymbols ?? [],
    ascHierarchicalBlocks: initialDoc?.ascHierarchicalBlocks ?? [],
    ascSheet: initialDoc?.ascSheet ?? null,
    userModelLibraries: initialDoc?.userModelLibraries ?? [],
    past: [],
    future: [],

    beginChange: () => set((s) => recordInto(s)),

    setDirectives: (directives) => set((s) => ({ ...recordInto(s), directives: [...directives] })),

    attachModelLibrary: (library) =>
      set((s) => ({
        ...recordInto(s),
        // Replace a same-named attachment in place so re-attaching an edited file
        // updates it rather than accumulating duplicate definitions in the deck.
        userModelLibraries: [
          ...s.userModelLibraries.filter((existing) => existing.name !== library.name),
          library,
        ],
      })),

    removeModelLibrary: (name) =>
      set((s) => {
        const next = s.userModelLibraries.filter((existing) => existing.name !== name);
        if (next.length === s.userModelLibraries.length) return {};
        return { ...recordInto(s), userModelLibraries: next };
      }),

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
          selectedWireIds: [], selectedLabelIds: [], selectedProbeIds: [],
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
          selectedWireIds: [], selectedLabelIds: [], selectedProbeIds: [],
          selectedIds: [],
        };
      }),

    startPlacing: (kind) => set({ tool: { mode: "place", kind }, selectedId: null, selectedWireId: null, selectedWireIds: [], selectedLabelIds: [], selectedProbeIds: [], selectedIds: [] }),
    startWiring: () => set({ tool: { mode: "wire" }, selectedId: null, selectedWireId: null, selectedWireIds: [], selectedLabelIds: [], selectedProbeIds: [], selectedIds: [] }),
    cancel: () => set({ tool: { mode: "select" } }),

    select: (id) => set({ selectedId: id, selectedWireId: null, selectedWireIds: [], selectedLabelIds: [], selectedProbeIds: [], selectedIds: id ? [id] : [] }),
    selectWire: (id) => set({ selectedWireId: id, selectedWireIds: id ? [id] : [], selectedId: null, selectedIds: [] }),
    selectWires: (ids) =>
      set({
        selectedWireIds: ids,
        selectedWireId: ids[0] ?? null,
        selectedId: null,
        selectedIds: [],
      }),

    selectMultiple: (ids) =>
      set({
        selectedIds: ids,
        selectedId: ids.length === 1 ? ids[0] : null,
        selectedWireId: null,
        selectedWireIds: [], selectedLabelIds: [], selectedProbeIds: [],
      }),

    selectMixed: ({ componentIds, wireIds, labelIds, probeIds }) =>
      set({
        selectedIds: componentIds,
        selectedId: componentIds.length === 1 && wireIds.length === 0 ? componentIds[0] : null,
        selectedWireIds: wireIds,
        selectedWireId: wireIds.length === 1 && componentIds.length === 0 ? wireIds[0] : null,
        selectedLabelIds: labelIds,
        selectedProbeIds: probeIds,
      }),

    toggleSelect: (id) =>
      set((s) => {
        const already = s.selectedIds.includes(id);
        const next = already ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id];
        return {
          selectedIds: next,
          selectedId: next.length === 1 ? next[0] : null,
          selectedWireId: null,
          selectedWireIds: [], selectedLabelIds: [], selectedProbeIds: [],
        };
      }),

    moveGroup: (origins, dx, dy, sourcePins, sourceWires, labelOrigins = new Map(), probeOrigins = new Map()) =>
      set((s) => {
        // Collect all pin world positions for components in the selection
        const allSourcePins: Point[] = [];
        for (const [, pins] of sourcePins) {
          for (const p of pins) allSourcePins.push(p);
        }
        // Absolute placement from the drag-start origin - never from the current
        // position, which would compound the cumulative delta on every event.
        const updatedComponents = s.components.map((c) => {
          const origin = origins.get(c.id);
          if (!origin) return c;
          return moveComponentTo(c, origin.x + dx, origin.y + dy);
        });
        const relocations = new Map(allSourcePins.map((pin) => [
          pointKey(pin),
          { x: pin.x + dx, y: pin.y + dy },
        ]));
        const stationaryPinKeys = new Set(s.components
          .filter((component) => !origins.has(component.id))
          .flatMap((component) => getComponentPins(component))
          .map(pointKey));
        const selectedWireIds = new Set(s.selectedWireIds);
        const updatedWires = relocateAttachedEndpoints(
          sourceWires,
          relocations,
          stationaryPinKeys,
          selectedWireIds,
          { x: dx, y: dy },
        );
        const updatedLabels = s.netLabels.map((label) => {
          const origin = labelOrigins.get(label.id);
          return origin ? { ...label, x: origin.x + dx, y: origin.y + dy } : label;
        });
        const updatedProbes = s.probes.map((probe) => {
          const origin = probeOrigins.get(probe.id);
          return origin ? { ...probe, x: origin.x + dx, y: origin.y + dy } : probe;
        });
        return {
          components: updatedComponents,
          wires: updatedWires,
          netLabels: updatedLabels,
          probes: updatedProbes,
        };
      }),

    startProbing: () => set({ tool: { mode: "probe" }, selectedId: null, selectedWireId: null, selectedWireIds: [], selectedLabelIds: [], selectedProbeIds: [], selectedIds: [] }),
    // A net carries AT MOST ONE voltage probe (current/clamp probes dedup
    // separately, per component, in toggleCurrentProbe below). Resolve the
    // click through the same net-identity authority the netlist extractor
    // and the waveform viewer use (`netAtPoint`) rather than exact-position
    // matching - wire clicks snap to varying midpoints, so two clicks on the
    // same net rarely land on the same pixel. Semantics: clicking a net with
    // no probe adds one; clicking the SAME point again removes it (toggle
    // off); clicking a DIFFERENT point on a net that already has a probe
    // MOVES the probe there instead of stacking a second ring on one net.
    // Clicking off any net (empty canvas, a component body with no pin/wire
    // under the cursor) is a no-op - probes only attach to nets/wires/pins,
    // so "probing an opamp" body does nothing.
    addProbe: (x, y) =>
      set((s) => {
        const nets = extractCircuit(s.components, s.wires, s.netLabels).nets;
        const clickedNet = netAtPoint(nets, s.wires, { x, y });
        if (!clickedNet) return s;
        const netOfProbe = (p: Probe) =>
          p.netId ?? netAtPoint(nets, s.wires, { x: p.x, y: p.y })?.id;
        const existing = s.probes.find(
          (p) => !p.componentId && netOfProbe(p) === clickedNet.id,
        );
        if (existing) {
          if (existing.x === x && existing.y === y) {
            return { ...recordInto(s), probes: s.probes.filter((p) => p.id !== existing.id) };
          }
          return {
            ...recordInto(s),
            probes: s.probes.map((p) =>
              p.id === existing.id ? { ...p, x, y, netId: clickedNet.id } : p,
            ),
          };
        }
        const color = PROBE_COLORS[s.probes.length % PROBE_COLORS.length];
        const withoutDupes = s.probes.filter(
          (p) => p.componentId || netOfProbe(p) !== clickedNet.id,
        );
        return {
          ...recordInto(s),
          probes: [...withoutDupes, { id: nanoid(6), x, y, color, netId: clickedNet.id }],
        };
      }),
    toggleCurrentProbe: (componentId) =>
      set((s) => {
        const existing = s.probes.find((p) => p.componentId === componentId);
        if (existing) return { ...recordInto(s), probes: s.probes.filter((p) => p.id !== existing.id) };
        const target = s.components.find((c) => c.id === componentId);
        if (!target || target.kind === "ground" || !canCurrentProbe(target.kind)) return s;
        const color = PROBE_COLORS[s.probes.length % PROBE_COLORS.length];
        return {
          ...recordInto(s),
          probes: [...s.probes, { id: nanoid(6), x: target.x, y: target.y, color, componentId }],
        };
      }),
    removeProbe: (id) => set((s) => ({ ...recordInto(s), probes: s.probes.filter((p) => p.id !== id) })),
    clearProbes: () => set((s) => ({ ...recordInto(s), probes: [] })),
    setProbes: (probes) => set({ probes }),
    setProbeColor: (id, color) =>
      set((s) => ({
        probes: s.probes.map((p) => (p.id === id ? { ...p, color } : p)),
      })),

    startLabeling: () => set({ tool: { mode: "label" }, selectedId: null, selectedWireId: null, selectedWireIds: [], selectedLabelIds: [], selectedProbeIds: [], selectedIds: [] }),

    // A physically-connected node carries AT MOST ONE net label (mirrors the
    // one-probe-per-net rule). Node identity comes from extraction with the
    // labels EXCLUDED - labels merge nets by name, so including them would
    // wrongly dedup a same-name label placed on a separate, disconnected node
    // (the legitimate "connect nets by name" workflow). Semantics: labeling a
    // bare node adds; re-labeling the same node edits/MOVES the existing label
    // to the new anchor instead of stacking a duplicate; an empty commit
    // removes the node's label. Off-net points keep exact-position matching
    // (a floating label is harmless and self-evident).
    upsertNetLabel: (x, y, text) =>
      set((s) => {
        const trimmed = text.trim();
        const physicalNets = extractCircuit(s.components, s.wires, []).nets;
        const clickedNet = netAtPoint(physicalNets, s.wires, { x, y });
        const nodeOf = (l: NetLabel) => netAtPoint(physicalNets, s.wires, { x: l.x, y: l.y })?.id;
        const existing = clickedNet
          ? s.netLabels.find((l) => nodeOf(l) === clickedNet.id)
          : s.netLabels.find((l) => l.x === x && l.y === y);
        if (!trimmed && !existing) return s; // nothing to add or remove - no history entry
        if (!trimmed) return { ...recordInto(s), netLabels: s.netLabels.filter((l) => l.id !== existing!.id) };
        if (existing?.text === trimmed && existing.x === x && existing.y === y) return s; // unchanged
        if (existing) {
          return {
            ...recordInto(s),
            netLabels: s.netLabels.map((l) => (l.id === existing.id ? { ...l, x, y, text: trimmed } : l)),
          };
        }
        return { ...recordInto(s), netLabels: [...s.netLabels, { id: nanoid(6), x, y, text: trimmed }] };
      }),

    setNetLabelDirect: (x, y, text) =>
      set((s) => {
        const physicalNets = extractCircuit(s.components, s.wires, []).nets;
        const clickedNet = netAtPoint(physicalNets, s.wires, { x, y });
        const nodeOf = (l: NetLabel) => netAtPoint(physicalNets, s.wires, { x: l.x, y: l.y })?.id;
        const existing = clickedNet
          ? s.netLabels.find((l) => nodeOf(l) === clickedNet.id)
          : s.netLabels.find((l) => l.x === x && l.y === y);
        if (!text) return existing ? { netLabels: s.netLabels.filter((l) => l.id !== existing.id) } : {};
        if (existing) return { netLabels: s.netLabels.map((l) => (l.id === existing.id ? { ...l, x, y, text } : l)) };
        return { netLabels: [...s.netLabels, { id: nanoid(6), x, y, text }] };
      }),

    setNetLabelOffsetDirect: (id, dx, dy) =>
      set((s) => ({
        netLabels: s.netLabels.map((l) => (l.id === id ? { ...l, dx, dy } : l)),
      })),

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
          wires: wiresWithInsertedComponent(s.wires, comp),
          counters: { ...s.counters, [entry.prefix]: n },
          selectedId: comp.id,
          selectedWireId: null,
          selectedWireIds: [], selectedLabelIds: [], selectedProbeIds: [],
          selectedIds: [comp.id],
        };
      }),

    addWire: (points) =>
      set((s) => {
        const cleanPoints = cleanGroupRoute(points);
        if (cleanPoints.length < 2) return {};
        return {
          ...recordInto(s),
          wires: [...s.wires, { id: nanoid(6), points: cleanPoints }],
        };
      }),

    // History for a drag is captured once by the caller via beginChange() on the first move.
    moveComponent: (id, x, y) =>
      set((s) => ({
        components: s.components.map((c) => (c.id === id ? moveComponentTo(c, x, y) : c)),
      })),

    rotate: () =>
      set((s) => {
        if (s.tool.mode === "place") return { placeRotation: nextRotation(s.placeRotation) };
        const ids = new Set(s.selectedIds.length > 0 ? s.selectedIds : s.selectedId ? [s.selectedId] : []);
        if (ids.size === 0) return {};
        const before = s.components.filter((component) => ids.has(component.id));
        const components = s.components.map((component) => ids.has(component.id)
          ? reorientComponent(component, nextRotation(component.rotation), component.mirrored ?? false)
          : component);
        const after = components.filter((component) => ids.has(component.id));
        const relocations = endpointRelocations(before, after);
        const stationaryPinKeys = new Set(s.components
          .filter((component) => !ids.has(component.id))
          .flatMap((component) => getComponentPins(component))
          .map(pointKey));
        return {
          ...recordInto(s),
          components,
          wires: relocateAttachedEndpoints(s.wires, relocations, stationaryPinKeys),
          netLabels: s.netLabels.map((label) => relocateAnchoredPoint(label, relocations, stationaryPinKeys)),
          probes: s.probes.map((probe) => probe.componentId ? probe : relocateAnchoredPoint(probe, relocations, stationaryPinKeys)),
        };
      }),

    mirror: () =>
      set((s) => {
        if (s.tool.mode === "place") return { placeMirror: !s.placeMirror };
        const ids = new Set(s.selectedIds.length > 0 ? s.selectedIds : s.selectedId ? [s.selectedId] : []);
        if (ids.size === 0) return {};
        const before = s.components.filter((component) => ids.has(component.id));
        const components = s.components.map((component) => ids.has(component.id)
          ? reorientComponent(component, component.rotation, !(component.mirrored ?? false))
          : component);
        const after = components.filter((component) => ids.has(component.id));
        const relocations = endpointRelocations(before, after);
        const stationaryPinKeys = new Set(s.components
          .filter((component) => !ids.has(component.id))
          .flatMap((component) => getComponentPins(component))
          .map(pointKey));
        return {
          ...recordInto(s),
          components,
          wires: relocateAttachedEndpoints(s.wires, relocations, stationaryPinKeys),
          netLabels: s.netLabels.map((label) => relocateAnchoredPoint(label, relocations, stationaryPinKeys)),
          probes: s.probes.map((probe) => probe.componentId ? probe : relocateAnchoredPoint(probe, relocations, stationaryPinKeys)),
        };
      }),

    copySelected: () =>
      set((s) => ({ clipboard: clipboardFromSelection(s) ?? s.clipboard })),

    paste: () =>
      set((s) => {
        if (!s.clipboard) return {};
        return { ...recordInto(s), ...pasteClipboard(s, s.clipboard) };
      }),

    duplicateSelected: () =>
      set((s) => {
        const clipboard = clipboardFromSelection(s);
        if (!clipboard) return {};
        return { ...recordInto(s), ...pasteClipboard(s, clipboard), clipboard };
      }),

    // Delete EVERYTHING in the current selection - components, wires, net
    // labels, and probes together (a marquee selects mixed object kinds), as a
    // single undoable step.
    deleteSelected: () =>
      set((s) => {
        const compIds = new Set(s.selectedIds.length > 0 ? s.selectedIds : s.selectedId ? [s.selectedId] : []);
        const wireIds = new Set(s.selectedWireIds.length > 0 ? s.selectedWireIds : s.selectedWireId ? [s.selectedWireId] : []);
        const labelIds = new Set(s.selectedLabelIds);
        const probeIds = new Set(s.selectedProbeIds);
        if (compIds.size === 0 && wireIds.size === 0 && labelIds.size === 0 && probeIds.size === 0) return {};
        return {
          ...recordInto(s),
          components: compIds.size > 0 ? s.components.filter((c) => !compIds.has(c.id)) : s.components,
          wires: wireIds.size > 0 ? s.wires.filter((w) => !wireIds.has(w.id)) : s.wires,
          netLabels: labelIds.size > 0 ? s.netLabels.filter((l) => !labelIds.has(l.id)) : s.netLabels,
          probes: (probeIds.size > 0 || compIds.size > 0)
            ? s.probes.filter((p) => !probeIds.has(p.id) && (!p.componentId || !compIds.has(p.componentId)))
            : s.probes,
          selectedId: null,
          selectedIds: [],
          selectedWireId: null,
          selectedWireIds: [], selectedLabelIds: [], selectedProbeIds: [],
        };
      }),

    clearSelection: () => set({ selectedId: null, selectedWireId: null, selectedWireIds: [], selectedLabelIds: [], selectedProbeIds: [], selectedIds: [] }),

    // History for a value edit is captured once by the caller via beginChange() on first keystroke.
    setValue: (id, value) =>
      set((s) => ({
        components: s.components.map((c) => (c.id === id ? { ...c, value } : c)),
      })),
    setLabel: (id, label) =>
      set((s) => ({
        components: s.components.map((c) => (c.id === id ? { ...c, label } : c)),
      })),
    setWireResistance: (id, resistance) =>
      set((s) => ({
        wires: s.wires.map((w) => {
          if (w.id !== id) return w;
          const trimmed = resistance.trim();
          if (!trimmed || trimmed === "0") {
            const { resistance: _drop, ...rest } = w;
            return rest;
          }
          return { ...w, resistance: trimmed };
        }),
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
          textAnnotations: cloned.textAnnotations ?? [],
          ascShapes: cloned.ascShapes ?? [],
          ascDataFlags: cloned.ascDataFlags ?? [],
          ascForeignSymbols: cloned.ascForeignSymbols ?? [],
    ascHierarchicalBlocks: cloned.ascHierarchicalBlocks ?? [],
          ascSheet: cloned.ascSheet ?? null,
          userModelLibraries: cloned.userModelLibraries ?? [],
          past: [],
          future: [],
          selectedId: null,
          selectedWireId: null,
          selectedWireIds: [], selectedLabelIds: [], selectedProbeIds: [],
          selectedIds: [],
          tool: { mode: "select" },
        };
      }),

    replaceCircuit: (doc) =>
      set((s) => {
        const replacement = cloneDocument(doc);
        return {
          ...recordInto(s),
          components: replacement.components,
          wires: replacement.wires,
          counters: deriveCounters(replacement.components),
          probes: replacement.probes ?? [],
          netLabels: replacement.netLabels ?? [],
          directives: replacement.directives ?? [],
          textAnnotations: replacement.textAnnotations ?? [],
          ascShapes: replacement.ascShapes ?? [],
          ascDataFlags: replacement.ascDataFlags ?? [],
          ascForeignSymbols: replacement.ascForeignSymbols ?? [],
    ascHierarchicalBlocks: replacement.ascHierarchicalBlocks ?? [],
          ascSheet: replacement.ascSheet ?? null,
          userModelLibraries: replacement.userModelLibraries ?? [],
          selectedId: null,
          selectedWireId: null,
          selectedWireIds: [], selectedLabelIds: [], selectedProbeIds: [],
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
          textAnnotations: restored.textAnnotations ?? [],
          ascShapes: restored.ascShapes ?? [],
          ascDataFlags: restored.ascDataFlags ?? [],
          ascForeignSymbols: restored.ascForeignSymbols ?? [],
    ascHierarchicalBlocks: restored.ascHierarchicalBlocks ?? [],
          ascSheet: restored.ascSheet ?? null,
          userModelLibraries: restored.userModelLibraries ?? [],
          past: history.past.map(copyHistoryEntry).slice(-HISTORY_LIMIT),
          future: history.future.map(copyHistoryEntry).slice(0, HISTORY_LIMIT),
          selectedId: null,
          selectedWireId: null,
          selectedWireIds: [], selectedLabelIds: [], selectedProbeIds: [],
          selectedIds: [],
          tool: { mode: "select" },
        };
      }),

    newCircuit: () =>
      set(() => ({
        ...blankDoc(),
        past: [],
        future: [],
        selectedId: null,
        selectedWireId: null,
        selectedWireIds: [], selectedLabelIds: [], selectedProbeIds: [],
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
    || state.textAnnotations !== prev.textAnnotations
    || state.ascShapes !== prev.ascShapes
    || state.ascForeignSymbols !== prev.ascForeignSymbols
    || state.ascHierarchicalBlocks !== prev.ascHierarchicalBlocks
    || state.ascSheet !== prev.ascSheet
    || state.userModelLibraries !== prev.userModelLibraries
  ) {
    persist({
      components: state.components,
      wires: state.wires,
      probes: state.probes,
      netLabels: state.netLabels,
      directives: state.directives,
      textAnnotations: state.textAnnotations,
      ascShapes: state.ascShapes,
      ascForeignSymbols: state.ascForeignSymbols,
      ascHierarchicalBlocks: state.ascHierarchicalBlocks,
      ...(state.ascSheet ? { ascSheet: state.ascSheet } : {}),
      ...(state.userModelLibraries.length > 0 ? { userModelLibraries: state.userModelLibraries } : {}),
    });
  }
});
