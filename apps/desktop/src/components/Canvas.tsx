import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { moveComponentTo, useSchematic } from "../store/useSchematic";
import { isActuable, NON_ACTUABLE } from "../schematic/actuation";
import { ComponentSymbol, GRID, SYMBOL_BOX } from "../schematic/symbols";
import type { NetLabel, Point, SchematicAscShape, SchematicComponent, SchematicWire } from "../schematic/types";
import { getLocalPins, getComponentPins, transformPoint } from "../schematic/pins";
import {
  isNativeMultiPinSubcircuit,
  localSubcircuitPins,
  nativeSubcircuitBody,
} from "../schematic/subcircuitGeometry";
import type { OperatingPointResult } from "../simulation/operatingPoint";
import { OpCurrentFlowLayer } from "./OpCurrentFlowLayer";
import { LedGlowLayer } from "./LedGlowLayer";
import { extractCircuit, netAtPoint } from "../schematic/netlist";
import { resolveAmmeterTarget } from "../schematic/ammeterAttach";
import type { AnalysisResult } from "../simulation/linearTransient";
import {
  nearestSampleIndex,
  opComponentCurrents,
  opTerminalCurrents,
  tranComponentCurrents,
  tranTerminalCurrents,
  type PinIndex,
} from "../simulation/wireCurrentFlow";
import { InstrumentIconButton } from "@/components/ui/instrument-icon-button";
import { Scan, ZoomIn, ZoomOut } from "lucide-react";
import {
  autoNetLabelOffset,
  autoNetLabelOffsets,
  ascArcPath,
  ascShapeRender,
  buildLabelPlacements,
  circuitBounds,
  circuitBoundsWithLabels,
  collides,
  fitViewTransform,
  componentAt,
  componentVisualPlacement,
  componentWorldRect,
  findFreeSpot,
  isWireEndpoint,
  pathFromPoints,
  pathWithHops,
  pointKey,
  pointInRect,
  pointOnWireSegment,
  pointsEqual,
  rectsOverlap,
  rerouteMovedWires,
  routeWireSmart,
  segmentIntersections,
  snap,
  sourceValueLabel,
  symbolTransform,
  sourceSymbolFitScale,
  translateAttachedWireEndpoints,
  wireIntersectsRect,
  wireSegments,
  wiresTouchingPins,
  worldPinsFor,
  type Rect,
} from "./Canvas.geometry";

interface View {
  x: number;
  y: number;
  zoom: number;
}

const clampZoom = (z: number) => Math.min(5, Math.max(0.25, z));

/** Anything at/right of this X is a flattened hierarchical-block body packed
 *  off-sheet by the ASC importer (placement starts at 1e6); authored circuits
 *  live well left of it (document validation caps |coord| at 1e6). */
const SUBCIRCUIT_PACK_REGION_X = 500_000;

/** Screen-space box used while drawing a rubber-band selection rectangle. */
interface BoxDrag {
  startX: number; // screen coords
  startY: number;
  curX: number;
  curY: number;
}

interface DragState {
  mode: "none" | "pan" | "move" | "group-move" | "box";
  id?: string;
  /** ids being moved together in group-move mode */
  groupIds?: string[];
  lastX: number;
  lastY: number;
  moved: boolean;
  origin?: Point;
  /** Snapped pointer position at drag start (single move keeps grab offset). */
  pointerOrigin?: Point;
  /** For single-component move: the component's pin positions at drag start. */
  sourcePins?: Point[];
  sourceWires?: SchematicWire[];
  /** For group-move: map from component id → pin world positions at drag start. */
  groupSourcePins?: Map<string, Point[]>;
  /** For group-move: per-component world origins at drag start. */
  groupOrigins?: Map<string, Point>;
  /** Selected topology-neutral anchors translated with the group. */
  groupLabelOrigins?: Map<string, Point>;
  groupProbeOrigins?: Map<string, Point>;
}

export function Canvas({
  op = null,
  tran = null,
  readoutTime = null,
  interactive = true,
  onActuate,
  fitSignal = 0,
  currentVisualizer = false,
}: {
  /** Last DC operating point; drives the current-flow visualizer. */
  op?: OperatingPointResult | null;
  /** Last successful `.tran`; when present, the flow visualizer prefers a real
   *  waveform sample (default = final) over the DC OP. */
  tran?: AnalysisResult | null;
  /** Optional seconds into the transient for the schematic readout (cursor).
   *  Null → last sample. Ignored when there is no ok transient. */
  readoutTime?: number | null;
  /** When false (simulator view) topology is read-only: pan/zoom, inspection,
   *  probe dots, and topology-neutral node aliases remain available. */
  interactive?: boolean;
  /** A contact was operated, so the shown result no longer describes the circuit. */
  onActuate?: () => void;
  /** Bumped by App on open/new/tab switch so the schematic auto-fits once. */
  fitSignal?: number;
  /** Current Mode: animated flow dots along the wires, from real branch
   *  currents. Defaults OFF and is opted into by the simulator only - it is a
   *  reading of a completed run, and an editor canvas showing moving current
   *  while you are still drawing the circuit is noise, not information. Off
   *  hides the layer entirely rather than freezing it. */
  currentVisualizer?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [wireDraft, setWireDraft] = useState<{ start: Point; cursor: Point } | null>(null);
  const [snapHover, setSnapHover] = useState<{ x: number; y: number; pin: boolean } | null>(null);
  /** Pending net label being typed (label tool): world point + draft text. */
  const [labelDraft, setLabelDraft] = useState<{ x: number; y: number; text: string; error?: string } | null>(null);
  const labelInputRef = useRef<HTMLInputElement | null>(null);
  /** Rubber-band box in screen coords, null when not drawing. */
  const [boxDrag, setBoxDrag] = useState<BoxDrag | null>(null);
  // Pointer move/up can arrive before React has committed the visual state
  // update. Keep the gesture geometry synchronously available as well, and
  // never mutate the Zustand selection store from inside a React state updater.
  const boxDragRef = useRef<BoxDrag | null>(null);
  /** True while a component (or group) is being dragged - drives snap-dot visibility. */
  const [movingParts, setMovingParts] = useState(false);

  const components = useSchematic((s) => s.components);
  const wires = useSchematic((s) => s.wires);
  const ascShapes = useSchematic((s) => s.ascShapes);
  // Keep latest geometry in refs so fitView stays stable and does NOT re-fit
  // the camera on every component/wire edit (only on fitSignal / home / resize).
  const componentsRef = useRef(components);
  const wiresRef = useRef(wires);
  const ascShapesRef = useRef(ascShapes);
  componentsRef.current = components;
  wiresRef.current = wires;
  ascShapesRef.current = ascShapes;
  const selectedId = useSchematic((s) => s.selectedId);
  const selectedWireId = useSchematic((s) => s.selectedWireId);
  const selectedWireIds = useSchematic((s) => s.selectedWireIds);
  const selectedIds = useSchematic((s) => s.selectedIds);
  const tool = useSchematic((s) => s.tool);
  const placeRotation = useSchematic((s) => s.placeRotation);
  const placeMirror = useSchematic((s) => s.placeMirror);
  const addComponent = useSchematic((s) => s.addComponent);
  const addWire = useSchematic((s) => s.addWire);
  const select = useSchematic((s) => s.select);
  const selectWire = useSchematic((s) => s.selectWire);
  const selectMixed = useSchematic((s) => s.selectMixed);
  const selectedLabelIds = useSchematic((s) => s.selectedLabelIds);
  const selectedProbeIds = useSchematic((s) => s.selectedProbeIds);
  const toggleSelect = useSchematic((s) => s.toggleSelect);
  const toggleSelectWire = useSchematic((s) => s.toggleSelectWire);
  const toggleSelectLabel = useSchematic((s) => s.toggleSelectLabel);
  const toggleSelectProbe = useSchematic((s) => s.toggleSelectProbe);
  const moveGroup = useSchematic((s) => s.moveGroup);
  const clearSelection = useSchematic((s) => s.clearSelection);
  const beginChange = useSchematic((s) => s.beginChange);
  const setValue = useSchematic((s) => s.setValue);
  const probes = useSchematic((s) => s.probes);
  const addProbe = useSchematic((s) => s.addProbe);
  const toggleCurrentProbe = useSchematic((s) => s.toggleCurrentProbe);
  const actuateContact = useSchematic((s) => s.actuateContact);
  const removeProbe = useSchematic((s) => s.removeProbe);
  const netLabels = useSchematic((s) => s.netLabels);
  const upsertNetLabel = useSchematic((s) => s.upsertNetLabel);
  const setNetLabelOffsetDirect = useSchematic((s) => s.setNetLabelOffsetDirect);
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Why the last ammeter drop found nothing to measure. Cleared on success. */
  const [ammeterNote, setAmmeterNote] = useState<string | null>(null);

  // Current mode: animate real OP / `.tran` branch currents along the wires.
  // Prefer a real `.tran` sample when available; otherwise DC OP. Never invent
  // currents. The schematic carries no numeric readouts - values belong in the
  // measurement panels, where they can be read without covering the drawing.
  const useTranReadout = Boolean(tran?.ok && tran.times.length > 0);
  const biasCircuit = useMemo(() => {
    if (!currentVisualizer) return null;
    if (useTranReadout || op?.ok) return extractCircuit(components, wires, netLabels);
    return null;
  }, [currentVisualizer, useTranReadout, op, components, wires, netLabels]);

  /**
   * LED brightness runs off the same solved currents as the flow overlay, but
   * on its own memo: a lit LED is not a debugging aid, it is what the part
   * does, so it must not be gated behind the Current Mode toggle. The circuit
   * is only extracted when there is actually an LED to light.
   */
  const ledCurrents = useMemo(() => {
    if (!components.some((component) => component.kind === "led")) return null;
    if (useTranReadout && tran?.ok) {
      const sample =
        readoutTime == null
          ? tran.times.length - 1
          : nearestSampleIndex(tran.times, readoutTime);
      return tranComponentCurrents(tran, sample);
    }
    if (op?.ok) return opComponentCurrents(op, extractCircuit(components, wires, netLabels));
    return null;
  }, [components, wires, netLabels, useTranReadout, tran, readoutTime, op]);

  // Primary AND per-terminal currents. A transistor's base/emitter wires can
  // only be animated from the terminal vectors, which both engines report and
  // the flow model used to discard.
  const flow = useMemo(() => {
    if (!biasCircuit) return null;
    if (useTranReadout && tran?.ok) {
      const sample =
        readoutTime == null
          ? tran.times.length - 1
          : nearestSampleIndex(tran.times, readoutTime);
      return {
        currents: tranComponentCurrents(tran, sample),
        terminals: tranTerminalCurrents(tran, sample),
      };
    }
    if (op?.ok) {
      return { currents: opComponentCurrents(op, biasCircuit), terminals: opTerminalCurrents(op) };
    }
    return null;
  }, [biasCircuit, useTranReadout, tran, readoutTime, op]);
  const flowCurrents = flow?.currents ?? null;

  const editDirty = useRef(false);

  // Map of world "x,y" -> component pins there, for attributing wire current flow.
  const pinIndex = useMemo(() => {
    const m: PinIndex = new Map();
    for (const c of components) {
      for (const p of getComponentPins(c)) {
        const k = `${p.x},${p.y}`;
        const list = m.get(k) ?? [];
        // The kind travels with the pin: a role cannot be resolved from the id
        // alone, since "b" is a resistor's leg, a BJT's base and a MOSFET's bulk.
        list.push({ componentId: c.id, pinId: p.id, kind: c.kind });
        m.set(k, list);
      }
    }
    return m;
  }, [components]);

  // Flat list of pin world points, for snapping wires/probes onto terminals.
  const pinPoints = useMemo(
    () =>
      [...pinIndex.keys()].map((k) => {
        const [x, y] = k.split(",").map(Number);
        return { x, y };
      }),
    [pinIndex],
  );

  // Connection dots use the same explicit-junction semantics as net extraction:
  // a wire end/turn or a component pin makes a connection; two wire interiors
  // that merely cross remain an unmarked overpass.
  const junctions = useMemo(() => {
    const segments = wireSegments(wires);
    const candidates = new Map<string, Point>();
    const addCandidate = (point: Point) => candidates.set(pointKey(point), point);

    for (const wire of wires) {
      for (const point of wire.points) addCandidate(point);
    }
    for (const point of pinPoints) addCandidate(point);
    for (let i = 0; i < segments.length; i += 1) {
      for (let j = i + 1; j < segments.length; j += 1) {
        for (const point of segmentIntersections(segments[i], segments[j])) {
          if (isWireEndpoint(point, segments[i]) || isWireEndpoint(point, segments[j])) addCandidate(point);
        }
      }
    }

    const out: Point[] = [];
    for (const [key, point] of candidates) {
      let degree = pinIndex.get(key)?.length ?? 0;
      for (const segment of segments) {
        if (!pointOnWireSegment(point, segment)) continue;
        degree += isWireEndpoint(point, segment) ? 1 : 2;
      }
      if (degree >= 3) out.push(point);
    }
    return out;
  }, [wires, pinIndex, pinPoints]);

  // Unconnected crossings per wire: a horizontal segment crossing a DIFFERENT
  // wire's vertical segment strictly interior-to-interior, at a point that is
  // not a junction, hops over it. T-touches and 3+-way meets are junctions
  // (dots) and are excluded, so hop vs dot is always unambiguous.
  const wireHops = useMemo(() => {
    const junctionKeys = new Set(junctions.map(pointKey));
    const out = new Map<string, Map<number, number[]>>();
    const verticals: Array<{ owner: string; x: number; minY: number; maxY: number }> = [];
    for (const wire of wires) {
      for (let i = 1; i < wire.points.length; i += 1) {
        const a = wire.points[i - 1];
        const b = wire.points[i];
        if (a.x === b.x && a.y !== b.y) {
          verticals.push({ owner: wire.id, x: a.x, minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) });
        }
      }
    }
    if (verticals.length === 0) return out;
    for (const wire of wires) {
      for (let i = 1; i < wire.points.length; i += 1) {
        const a = wire.points[i - 1];
        const b = wire.points[i];
        if (a.y !== b.y || a.x === b.x) continue;
        const minX = Math.min(a.x, b.x);
        const maxX = Math.max(a.x, b.x);
        for (const v of verticals) {
          if (v.owner === wire.id) continue;
          if (v.x <= minX || v.x >= maxX) continue;
          if (a.y <= v.minY || a.y >= v.maxY) continue;
          if (junctionKeys.has(pointKey({ x: v.x, y: a.y }))) continue;
          let perWire = out.get(wire.id);
          if (!perWire) {
            perWire = new Map();
            out.set(wire.id, perWire);
          }
          const list = perWire.get(i - 1) ?? [];
          list.push(v.x);
          perWire.set(i - 1, list);
        }
      }
    }
    return out;
  }, [wires, junctions]);

  const netLabelOffsets = useMemo(
    () => autoNetLabelOffsets(netLabels, components, wires, probes),
    [netLabels, components, wires, probes],
  );

  // Interaction kept in a ref so dragging/panning doesn't trigger re-renders.
  const drag = useRef<DragState>({
    mode: "none",
    lastX: 0,
    lastY: 0,
    moved: false,
  });
  /** Contact currently held down by the pointer, released on pointer up. */
  const heldContact = useRef<string | null>(null);

  const moveComponentWithAttachedWires = useCallback(
    (id: string, x: number, y: number, sourcePins: Point[], sourceWires: SchematicWire[], dx: number, dy: number) => {
      useSchematic.setState((state) => {
        const stationaryPins = state.components
          .filter((component) => component.id !== id)
          .flatMap((component) => getComponentPins(component).map(({ x: pinX, y: pinY }) => ({ x: pinX, y: pinY })));
        const wiresWithMovedEndpoints = translateAttachedWireEndpoints(sourceWires, sourcePins, dx, dy, stationaryPins);
        const components = state.components.map((component) =>
          component.id === id ? moveComponentTo(component, x, y) : component,
        );
        const moved = components.find((c) => c.id === id);
        const pins = moved ? worldPinsFor([moved]) : [];
        const affected = wiresTouchingPins(wiresWithMovedEndpoints, pins);
        return {
          components,
          wires: rerouteMovedWires(wiresWithMovedEndpoints, components, affected),
        };
      });
    },
    [],
  );

  // Center the world origin on first mount.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setView((v) => ({ ...v, x: r.width / 2, y: r.height / 2 }));
  }, []);

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const el = svgRef.current;
      if (!el || view.zoom === 0) return { x: 0, y: 0 };
      const r = el.getBoundingClientRect();
      return {
        x: (clientX - r.left - view.x) / view.zoom,
        y: (clientY - r.top - view.y) / view.zoom,
      };
    },
    [view],
  );

  // Wheel: ⌘/ctrl (or trackpad pinch) → zoom about cursor; otherwise pan.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const cx = e.clientX - r.left;
        const cy = e.clientY - r.top;
        setView((v) => {
          const zoom = clampZoom(v.zoom * Math.exp(-e.deltaY * 0.01));
          const k = zoom / v.zoom;
          return { zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
        });
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (tool.mode !== "wire") setWireDraft(null);
    if (tool.mode !== "wire" && tool.mode !== "probe" && tool.mode !== "label") setSnapHover(null);
    if (tool.mode !== "label") setLabelDraft(null);
  }, [tool.mode]);

  // Focus the label input on the NEXT frame: it mounts during the opening
  // click's pointerdown, and the browser's default mousedown action would
  // immediately steal focus back (blur → instant close) if we focused at mount.
  const labelDraftPoint = labelDraft ? `${labelDraft.x},${labelDraft.y}` : null;
  useEffect(() => {
    if (!labelDraftPoint) return;
    const id = requestAnimationFrame(() => {
      labelInputRef.current?.focus();
      labelInputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [labelDraftPoint]);

  const placeAtCursor = useCallback(
    (clientX: number, clientY: number) => {
      if (tool.mode !== "place") return;
      const w = screenToWorld(clientX, clientY);
      const spot = findFreeSpot(components, snap(w.x), snap(w.y), tool.kind, placeRotation);
      addComponent(tool.kind, spot.x, spot.y);
      // The store remains in place mode for rapid repeated placement, but the
      // preview at this exact point is now stale: leaving it mounted draws a
      // dashed duplicate over the newly created solid symbol until the pointer
      // moves. The next pointermove will create the next valid preview.
      setGhost(null);
    },
    [tool, screenToWorld, addComponent, components, placeRotation],
  );

  // Snap targets: every component pin plus every wire vertex, so wiring/probing
  // latch onto terminals and existing wires instead of being pixel-finicky.
  const snapTargets = useMemo(() => {
    const seen = new Set<string>();
    const pts: Point[] = [];
    const add = (p: Point) => {
      const key = `${p.x},${p.y}`;
      if (seen.has(key)) return;
      seen.add(key);
      pts.push(p);
    };
    for (const p of pinPoints) add(p);
    for (const wire of wires) for (const p of wire.points) add(p);
    return pts;
  }, [pinPoints, wires]);

  const pinKeySet = useMemo(
    () => new Set(pinPoints.map((p) => `${p.x},${p.y}`)),
    [pinPoints],
  );

  const snappedCursor = useCallback(
    (clientX: number, clientY: number): Point => {
      const w = screenToWorld(clientX, clientY);
      let best: Point | null = null;
      // Keep the target radius constant on screen. A world-space threshold
      // made terminals nearly impossible to hit when zoomed out and swallowed
      // unrelated nodes when zoomed in.
      const snapRadiusWorld = 18 / view.zoom;
      let bestD = snapRadiusWorld * snapRadiusWorld;
      // Prefer pins over wire midpoints so terminals are easy to hit.
      for (const p of pinPoints) {
        const dx = p.x - w.x;
        const dy = p.y - w.y;
        const d = (dx * dx + dy * dy) * 0.82; // ~18% preference for pins
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      for (const p of snapTargets) {
        if (pinKeySet.has(`${p.x},${p.y}`)) continue;
        const dx = p.x - w.x;
        const dy = p.y - w.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      for (const wire of wires) {
        for (let i = 1; i < wire.points.length; i += 1) {
          const a = wire.points[i - 1];
          const b = wire.points[i];
          let candidate: Point | null = null;
          if (a.x === b.x) {
            const minY = Math.min(a.y, b.y);
            const maxY = Math.max(a.y, b.y);
            const y = Math.min(maxY, Math.max(minY, snap(w.y)));
            candidate = { x: a.x, y };
          } else if (a.y === b.y) {
            const minX = Math.min(a.x, b.x);
            const maxX = Math.max(a.x, b.x);
            const x = Math.min(maxX, Math.max(minX, snap(w.x)));
            candidate = { x, y: a.y };
          }
          if (!candidate) continue;
          const dx = candidate.x - w.x;
          const dy = candidate.y - w.y;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = candidate;
          }
        }
      }
      return best ?? { x: snap(w.x), y: snap(w.y) };
    },
    [screenToWorld, snapTargets, pinPoints, pinKeySet, wires, view.zoom],
  );

  const wireAtCursor = useCallback(
    (clientX: number, clientY: number) => {
      if (tool.mode !== "wire") return;
      const end = snappedCursor(clientX, clientY);
      if (!wireDraft) {
        setWireDraft({ start: end, cursor: end });
        return;
      }
      if (pointsEqual(wireDraft.start, end)) {
        setWireDraft(null);
        return;
      }
      addWire(routeWireSmart(wireDraft.start, end, components, wires));
      const landedOnCircuit = pinKeySet.has(`${end.x},${end.y}`)
        || wireSegments(wires).some((segment) => pointOnWireSegment(end, segment));
      // Finishing on a pin/wire closes this run but leaves the Wire tool active
      // for the next wire. Empty-grid clicks are explicit waypoints and keep
      // the current run alive.
      setWireDraft(landedOnCircuit ? null : { start: end, cursor: end });
    },
    [tool, snappedCursor, wireDraft, addWire, components, wires, pinKeySet],
  );

  /** World-coord bounds of a rubber-band box. */
  const boxWorldRect = useCallback(
    (box: BoxDrag): Rect => {
      const a = screenToWorld(box.startX, box.startY);
      const b = screenToWorld(box.curX, box.curY);
      return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
    },
    [screenToWorld],
  );

  // Marquee semantics: anything INSIDE OR INTERSECTING the box selects -
  // components by body overlap, wires when ANY segment crosses the box
  // (selected as complete wires, never fragments), labels/probes by anchor.
  const componentsInRect = useCallback(
    (rect: Rect): string[] =>
      components.filter((c) => rectsOverlap(componentWorldRect(c), rect)).map((c) => c.id),
    [components],
  );

  const wiresInRect = useCallback(
    (rect: Rect): string[] => wires.filter((w) => wireIntersectsRect(w, rect)).map((w) => w.id),
    [wires],
  );

  const labelsInRect = useCallback(
    (rect: Rect): string[] =>
      netLabels.filter((l) => pointInRect({ x: l.x, y: l.y }, rect)).map((l) => l.id),
    [netLabels],
  );

  const probesInRect = useCallback(
    (rect: Rect): string[] =>
      probes
        .filter((p) => {
          const host = p.componentId ? components.find((c) => c.id === p.componentId) : null;
          if (p.componentId && !host) return false;
          return pointInRect({ x: host ? host.x : p.x, y: host ? host.y : p.y }, rect);
        })
        .map((p) => p.id),
    [probes, components],
  );

  // All selection/drag goes through one hit-test on the SVG, so z-order never
  // decides which component a click lands on (components don't intercept).
  // A node has a voltage; a branch has a current. The probe reads the first and
  // the ammeter the second. One tool used to do both - dropping a probe on a
  // component body silently turned it into a clamp meter - which made the tool
  // mean two different things depending on where the pointer happened to land.
  const handleProbeAction = (clientX: number, clientY: number): boolean => {
    const point = snappedCursor(clientX, clientY);
    const physicalNets = extractCircuit(components, wires, []).nets;
    if (!netAtPoint(physicalNets, wires, point)) return false;
    addProbe(point.x, point.y);
    return true;
  };

  const handleAmmeterAction = (clientX: number, clientY: number): boolean => {
    const world = screenToWorld(clientX, clientY);
    const host = componentAt(components, world.x, world.y);
    const target = resolveAmmeterTarget(world, host ?? null, wires, components);
    if (!target.ok) {
      setAmmeterNote(target.reason);
      return true; // consumed: the click got an answer, just not a placement
    }
    setAmmeterNote(null);
    toggleCurrentProbe(target.componentId);
    return true;
  };

  /**
   * Operate a contact the reader clicked on the simulator canvas.
   *
   * This is the one gesture that changes the circuit from a surface that is
   * otherwise strictly read-only, and that is deliberate: a switch exists to be
   * thrown. Everything else on this canvas still refuses to edit.
   *
   * A part that looks operable but is not - a relay, whose contact is driven by
   * its coil - says so rather than swallowing the click.
   */
  const handleActuateAction = (clientX: number, clientY: number): boolean => {
    // The `interactive` half is belt-and-braces: the only call site is already
    // inside the simulator branch, so no test can reach it. It stays because
    // this is a mutation on a surface whose whole contract is that it does not
    // mutate, and that guarantee should not rest on one call site staying put.
    if (interactive || tool.mode !== "select") return false;
    const world = screenToWorld(clientX, clientY);
    const hit = componentAt(components, world.x, world.y);
    if (!hit) return false;
    const refusal = NON_ACTUABLE[hit.kind];
    if (refusal) {
      setAmmeterNote(`${hit.label || "This part"} ${refusal}`);
      return true;
    }
    if (!isActuable(hit.kind)) return false;
    setAmmeterNote(null);
    select(hit.id);
    if (actuateContact(hit.id, "press")) onActuate?.();
    // Remember it so the release lands on the same part even if the pointer
    // slid off it while held.
    heldContact.current = hit.id;
    return true;
  };

  const handleSimulatorNodeAction = (clientX: number, clientY: number): boolean => {
    if (interactive || (tool.mode !== "probe" && tool.mode !== "ammeter" && tool.mode !== "label")) return false;
    if (tool.mode === "probe") return handleProbeAction(clientX, clientY);
    if (tool.mode === "ammeter") return handleAmmeterAction(clientX, clientY);
    const point = snappedCursor(clientX, clientY);
    const physicalNets = extractCircuit(components, wires, []).nets;
    if (!netAtPoint(physicalNets, wires, point)) return false;
    if (!labelDraft) {
      const existing = netLabels.find((label) =>
        netAtPoint(physicalNets, wires, label)?.id === netAtPoint(physicalNets, wires, point)?.id,
      );
      setLabelDraft({ x: point.x, y: point.y, text: existing?.text ?? "" });
    }
    return true;
  };

  const commitLabelDraft = (): boolean => {
    if (!labelDraft) return true;
    const trimmed = labelDraft.text.trim();
    if (!interactive) {
      const physicalNets = extractCircuit(components, wires, []).nets;
      const clickedNet = netAtPoint(physicalNets, wires, labelDraft);
      const nodeOf = (label: NetLabel) => netAtPoint(physicalNets, wires, label)?.id;
      const existing = clickedNet
        ? netLabels.find((label) => nodeOf(label) === clickedNet.id)
        : undefined;
      const normalizedExisting = existing?.text.trim().toLowerCase();
      const existingIsShared = Boolean(existing && netLabels.some((label) => (
        label.id !== existing.id
        && label.text.trim().toLowerCase() === normalizedExisting
        && nodeOf(label) !== clickedNet?.id
      )));
      const targetJoinsAnotherNode = Boolean(trimmed && netLabels.some((label) => (
        label.id !== existing?.id
        && label.text.trim().toLowerCase() === trimmed.toLowerCase()
        && nodeOf(label) !== clickedNet?.id
      )));
      const unchanged = existing?.text === trimmed;
      if ((!unchanged && existingIsShared) || targetJoinsAnotherNode) {
        setLabelDraft({
          ...labelDraft,
          error: "That name would join or split electrical nodes. Change shared net names in Schematic.",
        });
        return false;
      }
    }
    upsertNetLabel(labelDraft.x, labelDraft.y, trimmed);
    setLabelDraft(null);
    return true;
  };

  const beginSelectedGroupDrag = (event: ReactPointerEvent<SVGElement>, anchor: Point, id?: string) => {
    const snapshotComps = components.filter((component) => selectedIds.includes(component.id));
    const groupSourcePins = new Map<string, Point[]>();
    for (const component of snapshotComps) {
      groupSourcePins.set(component.id, getComponentPins(component).map(({ x, y }) => ({ x, y })));
    }
    const groupOrigins = new Map<string, Point>(
      snapshotComps.map((component) => [component.id, { x: component.x, y: component.y }]),
    );
    const groupLabelOrigins = new Map<string, Point>(
      netLabels
        .filter((label) => selectedLabelIds.includes(label.id))
        .map((label) => [label.id, { x: label.x, y: label.y }]),
    );
    const groupProbeOrigins = new Map<string, Point>(
      probes
        .filter((probe) => selectedProbeIds.includes(probe.id))
        .map((probe) => [probe.id, { x: probe.x, y: probe.y }]),
    );
    drag.current = {
      mode: "group-move",
      id,
      groupIds: selectedIds.slice(),
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
      // Anchor at the actual pointer-down grid point, not a component center;
      // otherwise the group jumps on the first move when the user grabbed an edge.
      origin: { x: snap(anchor.x), y: snap(anchor.y) },
      groupSourcePins,
      groupOrigins,
      groupLabelOrigins,
      groupProbeOrigins,
      sourceWires: wires.map((wire) => ({ ...wire, points: wire.points.map((point) => ({ ...point })) })),
    };
    setMovingParts(true);
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const onBackgroundPointerDown = (e: ReactPointerEvent<SVGElement>) => {
    // Middle-mouse button always pans (button === 1).
    if (e.button === 1) {
      drag.current = { mode: "pan", lastX: e.clientX, lastY: e.clientY, moved: false };
      svgRef.current?.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const world = screenToWorld(e.clientX, e.clientY);

    if (!interactive) {
      if (handleSimulatorNodeAction(e.clientX, e.clientY)) return;
      if (handleActuateAction(e.clientX, e.clientY)) return;
      // Selection is inspection rather than editing: focusing a part drives
      // its telemetry row. Empty-space drags remain pan gestures.
      const hit = componentAt(components, world.x, world.y);
      if (hit && tool.mode === "select") {
        select(hit.id);
        drag.current = { mode: "none", lastX: e.clientX, lastY: e.clientY, moved: false };
        return;
      }
      drag.current = { mode: "pan", lastX: e.clientX, lastY: e.clientY, moved: false };
      svgRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    if (tool.mode === "place") {
      placeAtCursor(e.clientX, e.clientY);
      return;
    }
    if (tool.mode === "wire") {
      wireAtCursor(e.clientX, e.clientY);
      return;
    }
    if (tool.mode === "probe") {
      handleProbeAction(e.clientX, e.clientY);
      return;
    }
    if (tool.mode === "label") {
      // A click while an input is open just blurs it (the input's onBlur
      // commits); the next click opens a fresh one.
      if (labelDraft) return;
      const w = snappedCursor(e.clientX, e.clientY);
      const existing = netLabels.find((l) => l.x === w.x && l.y === w.y);
      setLabelDraft({ x: w.x, y: w.y, text: existing?.text ?? "" });
      return;
    }

    const hit = componentAt(components, world.x, world.y);
    if (hit) {
      if (e.shiftKey) {
        // Shift+click: toggle this component in/out of multi-select.
        toggleSelect(hit.id);
        drag.current = { mode: "none", lastX: e.clientX, lastY: e.clientY, moved: false };
        return;
      }
      // If the clicked component is already in the multi-selection, start a
      // group-move of the whole selection. Otherwise, start a single-component move.
      const selectedObjectCount = selectedIds.length + selectedWireIds.length + selectedLabelIds.length + selectedProbeIds.length;
      const isInGroup = selectedIds.includes(hit.id) && selectedObjectCount > 1;
      if (isInGroup) {
        beginSelectedGroupDrag(e, world, hit.id);
      } else {
        select(hit.id);
        drag.current = {
          mode: "move",
          id: hit.id,
          lastX: e.clientX,
          lastY: e.clientY,
          moved: false,
          origin: { x: hit.x, y: hit.y },
          pointerOrigin: { x: snap(world.x), y: snap(world.y) },
          sourcePins: getComponentPins(hit).map(({ x, y }) => ({ x, y })),
          sourceWires: wires.map((wire) => ({ ...wire, points: wire.points.map((point) => ({ ...point })) })),
        };
        setMovingParts(true);
      }
    } else {
      // Empty canvas click: start rubber-band box select (not pan).
      // A plain click (no drag) clears the selection on pointer-up.
      clearSelection();
      drag.current = { mode: "box", lastX: e.clientX, lastY: e.clientY, moved: false };
      const nextBox = { startX: e.clientX, startY: e.clientY, curX: e.clientX, curY: e.clientY };
      boxDragRef.current = nextBox;
      setBoxDrag(nextBox);
    }
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onCanvasDoubleClick = (e: ReactMouseEvent<SVGElement>) => {
    if (!interactive) return;
    const world = screenToWorld(e.clientX, e.clientY);
    const hit = componentAt(components, world.x, world.y);
    if (hit && hit.kind !== "ground") {
      editDirty.current = false;
      setEditingId(hit.id);
    }
  };

  const onWirePointerDown = (e: ReactPointerEvent<SVGElement>, wire: SchematicWire) => {
    if (e.button !== 0) return;
    if (!interactive) {
      e.stopPropagation();
      if (!handleSimulatorNodeAction(e.clientX, e.clientY) && tool.mode === "select") selectWire(wire.id);
      return;
    }
    if (tool.mode === "probe") {
      e.stopPropagation();
      const w = snappedCursor(e.clientX, e.clientY);
      addProbe(w.x, w.y);
      return;
    }
    if (tool.mode !== "select") return; // let place/wire/pan handle via bubbling
    e.stopPropagation();
    if (e.shiftKey) {
      // Shift+click: toggle this wire in/out of the mixed multi-selection.
      toggleSelectWire(wire.id);
      drag.current = { mode: "none", lastX: e.clientX, lastY: e.clientY, moved: false };
      return;
    }
    const world = screenToWorld(e.clientX, e.clientY);
    // Match component semantics: an already-selected wire (alone or in a
    // mixed group) starts a group drag; a fresh click selects then drags in
    // one gesture so rubber-band wire moves don't need a second click.
    if (selectedWireIds.includes(wire.id)) {
      beginSelectedGroupDrag(e, world);
      return;
    }
    selectWire(wire.id);
    beginSelectedGroupDrag(e, world);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGElement>) => {
    if (!interactive) {
      if (tool.mode === "probe" || tool.mode === "label") {
        const cursor = snappedCursor(e.clientX, e.clientY);
        const physicalNets = extractCircuit(components, wires, []).nets;
        setSnapHover({
          x: cursor.x,
          y: cursor.y,
          pin: Boolean(netAtPoint(physicalNets, wires, cursor)),
        });
      }
      const d = drag.current;
      if (d.mode === "pan") {
        setView((v) => ({ ...v, x: v.x + (e.clientX - d.lastX), y: v.y + (e.clientY - d.lastY) }));
        d.lastX = e.clientX;
        d.lastY = e.clientY;
      }
      return;
    }
    if (tool.mode === "place") {
      const w = screenToWorld(e.clientX, e.clientY);
      // Show the ghost where the part will actually land (collision-resolved),
      // so the preview never lies about the drop position.
      setGhost(findFreeSpot(components, snap(w.x), snap(w.y), tool.kind, placeRotation));
    } else if (tool.mode === "wire" || tool.mode === "probe" || tool.mode === "label") {
      const cursor = snappedCursor(e.clientX, e.clientY);
      setSnapHover({ x: cursor.x, y: cursor.y, pin: pinPoints.some((p) => p.x === cursor.x && p.y === cursor.y) });
      if (tool.mode === "wire") setWireDraft((draft) => (draft ? { ...draft, cursor } : draft));
    }
    const d = drag.current;
    if (d.mode === "pan") {
      const dx = e.clientX - d.lastX;
      const dy = e.clientY - d.lastY;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    } else if (d.mode === "box") {
      // Update rubber-band box in screen space.
      const currentBox = boxDragRef.current;
      if (currentBox) {
        const nextBox = { ...currentBox, curX: e.clientX, curY: e.clientY };
        boxDragRef.current = nextBox;
        setBoxDrag(nextBox);
      }
    } else if (d.mode === "move" && d.id && d.origin && d.pointerOrigin && d.sourcePins && d.sourceWires) {
      const w = screenToWorld(e.clientX, e.clientY);
      const tx = d.origin.x + snap(w.x - d.pointerOrigin.x);
      const ty = d.origin.y + snap(w.y - d.pointerOrigin.y);
      // Skip if coordinates are degenerate (can happen if svgRef was null during screenToWorld).
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
      const moving = components.find((c) => c.id === d.id);
      // Never let a body slide into another body (pins may still meet).
      if (moving && collides(components, tx, ty, moving.kind, moving.rotation, d.id)) return;
      if (moving?.x === tx && moving.y === ty) return;
      // Capture one undo snapshot for the whole drag, on the first move only.
      if (!d.moved) {
        beginChange();
        d.moved = true;
      }
      moveComponentWithAttachedWires(d.id, tx, ty, d.sourcePins, d.sourceWires, tx - d.origin.x, ty - d.origin.y);
    } else if (d.mode === "group-move" && d.groupIds && d.groupOrigins && d.groupSourcePins && d.sourceWires && d.origin) {
      const w = screenToWorld(e.clientX, e.clientY);
      // The pointer started over the anchor component (d.origin). Compute the
      // snapped-grid offset from that origin to where the pointer is now.
      const dx = snap(w.x) - d.origin.x;
      const dy = snap(w.y) - d.origin.y;
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      if (dx === 0 && dy === 0) return;
      if (!d.moved) {
        beginChange();
        d.moved = true;
      }
      moveGroup(
        d.groupOrigins,
        dx,
        dy,
        d.groupSourcePins,
        d.sourceWires,
        d.groupLabelOrigins,
        d.groupProbeOrigins,
      );
      // Live re-route so group moves don't leave wires cutting through bodies.
      const state = useSchematic.getState();
      const movedComps = state.components.filter((c) => d.groupIds!.includes(c.id));
      const affected = wiresTouchingPins(state.wires, worldPinsFor(movedComps));
      if (affected.size > 0) {
        useSchematic.setState({
          wires: rerouteMovedWires(state.wires, state.components, affected),
        });
      }
    }
  };

  const resetDrag = useCallback(() => {
    setMovingParts(false);
    boxDragRef.current = null;
    setBoxDrag(null);
    drag.current.mode = "none";
    drag.current.id = undefined;
    drag.current.groupIds = undefined;
    drag.current.moved = false;
    drag.current.origin = undefined;
    drag.current.pointerOrigin = undefined;
    drag.current.sourcePins = undefined;
    drag.current.sourceWires = undefined;
    drag.current.groupSourcePins = undefined;
    drag.current.groupOrigins = undefined;
    drag.current.groupLabelOrigins = undefined;
    drag.current.groupProbeOrigins = undefined;
  }, []);

  const rollbackDrag = useCallback(() => {
    const active = drag.current;
    if (active.moved && (active.mode === "move" || active.mode === "group-move")) {
      useSchematic.getState().undo();
    }
    resetDrag();
  }, [resetDrag]);

  useEffect(() => {
    const cancelOnBlur = () => rollbackDrag();
    window.addEventListener("blur", cancelOnBlur);
    return () => window.removeEventListener("blur", cancelOnBlur);
  }, [rollbackDrag]);

  const endDrag = (e: ReactPointerEvent<SVGElement>) => {
    // A momentary button is held, not clicked: releasing the pointer lets it go
    // even if the pointer wandered off the symbol in between.
    const held = heldContact.current;
    if (held) {
      heldContact.current = null;
      if (actuateContact(held, "release")) onActuate?.();
    }
    const d = drag.current;
    if (d.mode === "box") {
      // On release, commit the box selection.
      const completedBox = boxDragRef.current;
      boxDragRef.current = null;
      setBoxDrag(null);
      if (completedBox) {
        const rect = boxWorldRect(completedBox);
        const sel = {
          componentIds: componentsInRect(rect),
          wireIds: wiresInRect(rect),
          labelIds: labelsInRect(rect),
          probeIds: probesInRect(rect),
        };
        if (sel.componentIds.length || sel.wireIds.length || sel.labelIds.length || sel.probeIds.length) {
          selectMixed(sel);
        } else {
          clearSelection();
        }
      }
    } else if ((d.mode === "move" || d.mode === "group-move") && d.moved) {
      // Final re-route pass (live routing already ran during the drag).
      const state = useSchematic.getState();
      const movedIds = d.groupIds ?? (d.id ? [d.id] : []);
      const movedComps = state.components.filter((c) => movedIds.includes(c.id));
      const affected = wiresTouchingPins(state.wires, worldPinsFor(movedComps));
      if (affected.size > 0) {
        useSchematic.setState({
          wires: rerouteMovedWires(state.wires, state.components, affected),
        });
      }
    }
    resetDrag();
    const el = svgRef.current;
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };

  const cancelDrag = (e: ReactPointerEvent<SVGElement>) => {
    rollbackDrag();
    const el = svgRef.current;
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };

  const zoomBy = (factor: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const cx = r.width / 2;
    const cy = r.height / 2;
    setView((v) => {
      const zoom = clampZoom(v.zoom * factor);
      const k = zoom / v.zoom;
      return { zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  };

  // Frame the whole circuit in the viewport (home / zoom-to-fit).
  const fitView = useCallback(() => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    // Hierarchical imports pack flattened block bodies far right of the sheet
    // (ascImport places them from x = 1e6). Framing those makes a 1M-unit-wide
    // fit where the authored circuit is sub-pixel - the sheet looks EMPTY. Fit
    // only the authored region unless the sheet has nothing else.
    const authored = componentsRef.current.filter((c) => c.x < SUBCIRCUIT_PACK_REGION_X);
    const fitComponents = authored.length > 0 ? authored : componentsRef.current;
    const fitWires = authored.length > 0
      ? wiresRef.current.filter((w) => w.points.every((p) => p.x < SUBCIRCUIT_PACK_REGION_X))
      : wiresRef.current;
    // A flattened block body drops its own artwork on import, so every shape
    // here belongs to the authored sheet. Once the fit has fallen back to the
    // packed region there is none of that region's drawing to frame, and
    // pulling the sheet's own artwork in would rebuild the million-unit fit.
    const fitShapes = componentsRef.current.length > 0 && authored.length === 0
      ? []
      : ascShapesRef.current;
    // Label-aware bounds + 12%/48px viewport padding so long refdes/value
    // text never touches (or clips at) the canvas edge.
    const framingBounds = circuitBoundsWithLabels(fitComponents, fitWires, fitShapes);
    if (!framingBounds) {
      setView({ x: r.width / 2, y: r.height / 2, zoom: 1 });
      return;
    }
    const topologyBounds = circuitBounds(fitComponents, fitWires, undefined, fitShapes);
    const center = topologyBounds
      ? {
          x: (topologyBounds.minX + topologyBounds.maxX) / 2,
          y: (topologyBounds.minY + topologyBounds.maxY) / 2,
        }
      : undefined;
    setView(fitViewTransform(framingBounds, r.width, r.height, {
      minZoom: 0.25,
      maxZoom: 5,
      center,
    }));
  }, []);

  // Auto-fit when the document identity changes (open / new / tab switch).
  // Deliberately does NOT depend on components/wires - user pan is preserved
  // across edits; ⌂ and fitSignal are the only re-fit triggers in schematic mode.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => fitView());
    return () => cancelAnimationFrame(id);
  }, [fitSignal, fitView]);

  // Read-only simulator reflection also re-fits when its column resizes.
  useEffect(() => {
    if (interactive) return;
    const el = svgRef.current;
    if (!el) return;
    let frame = 0;
    const scheduleFit = () => {
      cancelAnimationFrame(frame);
      // ResizeObserver can fire while flexbox is still resolving the telemetry
      // dock and sibling columns. Measure on the next painted layout instead.
      frame = requestAnimationFrame(() => fitView());
    };
    const ro = new ResizeObserver(scheduleFit);
    ro.observe(el);
    // Safari/WebKit has historically been less reliable when observing a
    // sized SVG directly. The wrapper is the actual visible canvas slot and
    // excludes the telemetry dock, so observe it as the authoritative layout.
    if (el.parentElement) ro.observe(el.parentElement);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [interactive, fitView]);

  const placing = tool.mode === "place";
  const wiring = tool.mode === "wire";
  const probing = tool.mode === "probe";
  const labeling = tool.mode === "label";

  // Net label text is draggable (repositions dx/dy from the fixed net
  // anchor) in exactly the two contexts that already have some kind of
  // click interaction on it: the schematic editor's select tool, and the
  // simulator's label tool. Kept separate from the big `drag` state machine
  // above (DragState/onPointerMove/endDrag) because it mutates an offset by
  // id, not (x,y) by drag delta, and needs its own click-vs-drag threshold.
  const labelsInteractive = (!interactive && labeling) || (interactive && tool.mode === "select");
  const netLabelDrag = useRef<{
    id: string;
    startClientX: number;
    startClientY: number;
    startDx: number;
    startDy: number;
    moved: boolean;
  } | null>(null);
  // Screen pixels of movement below which a pointerdown+up is a click
  // (rename/select), not a drag - small enough not to feel laggy, large
  // enough to absorb hand tremor on a trackpad tap.
  const LABEL_DRAG_THRESHOLD = 4;

  const activateNetLabel = (l: NetLabel, shiftKey = false) => {
    if (!interactive && labeling) {
      // Click-without-drag opens the rename draft - unchanged from before
      // labels were draggable.
      setLabelDraft({ x: l.x, y: l.y, text: l.text });
    } else if (interactive && tool.mode === "select") {
      if (shiftKey) toggleSelectLabel(l.id);
      else selectMixed({ componentIds: [], wireIds: [], labelIds: [l.id], probeIds: [] });
    }
  };

  const onNetLabelPointerDown = (l: NetLabel, offset: { dx: number; dy: number }) =>
    (event: ReactPointerEvent<SVGTextElement>) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      if (interactive && tool.mode === "select" && event.shiftKey) {
        // Shift+click toggles without starting a label-offset drag.
        toggleSelectLabel(l.id);
        netLabelDrag.current = null;
        return;
      }
      netLabelDrag.current = {
        id: l.id,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startDx: offset.dx,
        startDy: offset.dy,
        moved: false,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    };

  const onNetLabelPointerMove = (event: ReactPointerEvent<SVGTextElement>) => {
    const drag = netLabelDrag.current;
    if (!drag) return;
    const dxScreen = event.clientX - drag.startClientX;
    const dyScreen = event.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(dxScreen, dyScreen) < LABEL_DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      // One undo snapshot for the whole drag, on the first move only - same
      // convention as component drag (onPointerMove's "move" case above).
      beginChange();
    }
    setNetLabelOffsetDirect(drag.id, drag.startDx + dxScreen / view.zoom, drag.startDy + dyScreen / view.zoom);
  };

  const onNetLabelPointerUp = (l: NetLabel) => (event: ReactPointerEvent<SVGTextElement>) => {
    const drag = netLabelDrag.current;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    netLabelDrag.current = null;
    if (drag?.moved) return; // already committed live via setNetLabelOffsetDirect
    // Shift+toggle already handled on pointerdown; skip the exclusive select.
    if (event.shiftKey) return;
    activateNetLabel(l);
  };

  const previewWire = wireDraft && !pointsEqual(wireDraft.start, wireDraft.cursor)
    ? routeWireSmart(wireDraft.start, wireDraft.cursor, components, wires)
    : null;
  const editingComp = editingId ? components.find((c) => c.id === editingId) ?? null : null;
  const editBox = editingComp ? SYMBOL_BOX[editingComp.kind] : null;
  const editVert =
    editingComp && editBox
      ? editingComp.rotation === 90 || editingComp.rotation === 270
        ? editBox.halfW
        : editBox.halfH
      : 0;
  const editLeft = editingComp ? editingComp.x * view.zoom + view.x : 0;
  const editTop = editingComp ? (editingComp.y + editVert + 15) * view.zoom + view.y : 0;

  return (
    <>
      <svg
        ref={svgRef}
        className="canvas"
        style={{ cursor: (interactive && (placing || wiring)) || probing || labeling ? "crosshair" : "default" }}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={cancelDrag}
        onLostPointerCapture={cancelDrag}
        onDoubleClick={onCanvasDoubleClick}
        onPointerLeave={() => {
          if (placing) setGhost(null);
          setSnapHover(null);
        }}
      >
        <defs>
          {/*
            Circles must be centered in each tile - SVG patterns clip at the
            tile edge, so a dot at (0,0) renders as a quarter-circle (the bug
            visible on the schematic stage).
          */}
          <pattern id="grid-minor" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
            <circle cx={GRID / 2} cy={GRID / 2} r={1.35} className="grid-dot" />
          </pattern>
          <pattern id="grid" width={GRID * 5} height={GRID * 5} patternUnits="userSpaceOnUse">
            <rect width={GRID * 5} height={GRID * 5} fill="url(#grid-minor)" />
            <circle cx={GRID / 2} cy={GRID / 2} r={2.1} className="grid-dot-major" />
          </pattern>
        </defs>

        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          <rect x={-100000} y={-100000} width={200000} height={200000} fill="url(#grid)" />

          {ascShapes.length > 0 && (
            <g className="asc-shapes" data-testid="asc-shapes">
              {ascShapes.map((shape, index) => (
                <AscShapeView key={`shape-${index}`} shape={shape} />
              ))}
            </g>
          )}

          {wires.map((wire) => (
            <WireView
              key={wire.id}
              wire={wire}
              selected={wire.id === selectedWireId || selectedWireIds.includes(wire.id)}
              probeReady={!interactive && (probing || labeling)}
              hops={wireHops.get(wire.id)}
              onPointerDown={(e) => onWirePointerDown(e, wire)}
            />
          ))}

          {previewWire && <WirePolyline points={previewWire} className="wire preview" />}

          {/* Soft snap markers while wiring / placing / moving / probing / labeling */}
          {interactive && (wiring || probing || labeling || placing || movingParts) &&
            snapTargets.map((p) => {
              const isPin = pinKeySet.has(`${p.x},${p.y}`);
              return (
                <circle
                  key={`snap-${p.x}-${p.y}`}
                  className={`snap-dot${isPin ? " pin" : ""}`}
                  cx={p.x}
                  cy={p.y}
                  r={isPin ? 3.2 : 2.2}
                />
              );
            })}

          {(wiring || probing || labeling) && snapHover && (
            <circle
              className={`snap-ring${snapHover.pin ? " on-pin" : ""}`}
              cx={snapHover.x}
              cy={snapHover.y}
              r={snapHover.pin ? 8 : 6.5}
            />
          )}

          {junctions.map((j) => (
            <circle key={`j-${j.x}-${j.y}`} className="junction-dot" cx={j.x} cy={j.y} r={2.6} />
          ))}

          {components.map((c) => (
            <ComponentView
              key={c.id}
              comp={c}
              selected={c.id === selectedId || selectedIds.includes(c.id)}
              showPins={wiring || probing || labeling || placing}
            />
          ))}

          {probes.map((p) => {
            // A clamp-meter probe follows its component; skip it if the part is gone.
            const host = p.componentId ? components.find((c) => c.id === p.componentId) : null;
            if (p.componentId && !host) return null;
            const px = host ? host.x : p.x;
            const py = host ? host.y : p.y;
            const probeSelected = selectedProbeIds.includes(p.id);
            const probeCanSelect = interactive && tool.mode === "select";
            const probeCanRemove = !interactive || (interactive && tool.mode === "probe");
            return (
              <g
                key={p.id}
                className={`probe-marker${p.componentId ? " current" : ""}${probeSelected ? " selected" : ""}${probeCanSelect || probeCanRemove ? " actionable" : ""}`}
                style={{ color: p.color }}
                role={probeCanSelect || probeCanRemove ? "button" : undefined}
                tabIndex={probeCanSelect || probeCanRemove ? 0 : undefined}
                aria-label={probeCanRemove
                  ? `Remove ${p.componentId ? "current" : "voltage"} probe`
                  : probeCanSelect ? `Select ${p.componentId ? "current" : "voltage"} probe` : undefined}
                onPointerDown={probeCanSelect || probeCanRemove ? (event) => {
                  event.stopPropagation();
                  if (probeCanRemove) removeProbe(p.id);
                  else if (event.shiftKey) toggleSelectProbe(p.id);
                  else selectMixed({ componentIds: [], wireIds: [], labelIds: [], probeIds: [p.id] });
                } : undefined}
                onClick={probeCanSelect || probeCanRemove ? (event) => {
                  // Accessibility activation may dispatch click without a
                  // pointerdown. Keep it from falling through to the wire;
                  // pointer activation already completed the same idempotent
                  // selection (or unmounted the removed marker).
                  event.stopPropagation();
                  if (probeCanSelect && !event.shiftKey) {
                    selectMixed({ componentIds: [], wireIds: [], labelIds: [], probeIds: [p.id] });
                  }
                } : undefined}
                onKeyDown={probeCanSelect || probeCanRemove ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (probeCanRemove) removeProbe(p.id);
                    else selectMixed({ componentIds: [], wireIds: [], labelIds: [], probeIds: [p.id] });
                  }
                } : undefined}
              >
                {probeSelected && <circle className="probe-select-ring" cx={px} cy={py} r={11} />}
                {p.componentId ? (
                  // A clamp meter reads a branch, so it draws as a ring AROUND
                  // the conductor rather than a dot ON a node. The two must not
                  // look alike: one is a voltage at a point, the other a
                  // current through a path.
                  <>
                    <circle className="ammeter-clamp" cx={px} cy={py} r={8} />
                    <circle className="ammeter-clamp-inner" cx={px} cy={py} r={4.5} />
                  </>
                ) : (
                  <>
                    <circle className="probe-ring" cx={px} cy={py} r={7} />
                    <circle className="probe-dot" cx={px} cy={py} r={3.5} />
                  </>
                )}
              </g>
            );
          })}

          {/* Net names sit under component ref/value labels so collisions
              (e.g. "Output" vs "Rf") keep the part label readable. Each
              label's screen position is anchor + (dx,dy): dx/dy undefined
              (never dragged, or an old .sim file predating this field) falls
              back to `autoNetLabelOffset`'s collision-avoiding placement;
              once dragged, the explicit offset wins forever so auto-place
              never fights a placement the user chose . */}
          <g className={`net-label-layer${labelsInteractive ? " labels-interactive" : ""}`} aria-hidden={labelsInteractive ? undefined : "true"}>
            {netLabels.map((l) => {
              const offset = netLabelOffsets.get(l.id)
                ?? autoNetLabelOffset({ x: l.x, y: l.y }, l.text, components, wires, probes);
              const tx = l.x + offset.dx;
              const ty = l.y + offset.dy;
              // Anchor and text drift apart once dragged far - a leader line
              // keeps the net connection legible instead of a label reading
              // as floating and unattached.
              const showLeader = Math.hypot(offset.dx, offset.dy) > 24;
              return (
                <g key={l.id}>
                  {showLeader && <line className="net-label-leader" x1={l.x} y1={l.y} x2={tx} y2={ty} />}
                  <text
                    className={`net-label-text${selectedLabelIds.includes(l.id) ? " selected" : ""}`}
                    x={tx}
                    y={ty}
                    role={labelsInteractive ? "button" : undefined}
                    tabIndex={labelsInteractive ? 0 : undefined}
                    aria-label={labelsInteractive ? (labeling ? `Rename node ${l.text}` : `Net label ${l.text}`) : undefined}
                    onPointerDown={labelsInteractive ? onNetLabelPointerDown(l, offset) : undefined}
                    onPointerMove={labelsInteractive ? onNetLabelPointerMove : undefined}
                    onPointerUp={labelsInteractive ? onNetLabelPointerUp(l) : undefined}
                    onKeyDown={labelsInteractive ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        activateNetLabel(l);
                      }
                    } : undefined}
                  >
                    {l.text}
                  </text>
                </g>
              );
            })}
          </g>

          <LedGlowLayer components={components} currents={ledCurrents} />
          <OpCurrentFlowLayer
            currents={flowCurrents}
            terminals={flow?.terminals}
            labelPoints={netLabels}
            wires={wires}
            pinIndex={pinIndex}
            active={Boolean(flowCurrents && flowCurrents.size > 0)}
          />

          <ComponentLabels components={components} wires={wires} />

          {placing && ghost && (
            <g className="ghost" transform={`translate(${ghost.x} ${ghost.y})`}>
              <g className="symbol" transform={symbolTransform(placeRotation, placeMirror)}>
                <ComponentSymbol kind={tool.kind} />
              </g>
            </g>
          )}
        </g>

        {/* Rubber-band selection rectangle - in screen space (no world transform). */}
        {boxDrag && (() => {
          const el = svgRef.current;
          const r = el?.getBoundingClientRect();
          const ox = r ? r.left : 0;
          const oy = r ? r.top : 0;
          const x = Math.min(boxDrag.startX, boxDrag.curX) - ox;
          const y = Math.min(boxDrag.startY, boxDrag.curY) - oy;
          const w = Math.abs(boxDrag.curX - boxDrag.startX);
          const h = Math.abs(boxDrag.curY - boxDrag.startY);
          return <rect className="select-box" x={x} y={y} width={w} height={h} />;
        })()}
      </svg>

      {/* A moving dot means nothing without a scale. This states the direction
          convention and the full-scale current, so a reader can name a number
          rather than only compare two wires. */}
      {currentVisualizer && flowCurrents && flowCurrents.size > 0 && (
        <div className="flow-legend" aria-label="Current flow key">
          <svg className="flow-legend-mark" viewBox="0 0 44 8" aria-hidden="true">
            <circle cx="4" cy="4" r="2" />
            <circle cx="14" cy="4" r="2" />
            <circle cx="24" cy="4" r="2" />
            <path d="M 34 1 L 40 4 L 34 7 Z" />
          </svg>
          <span className="flow-legend-label">CURRENT</span>
          <span className="flow-legend-scale">1 µA — 1 A</span>
        </div>
      )}

      {ammeterNote && (
        <p className="ammeter-note" role="status">{ammeterNote}</p>
      )}

      <div className="view-controls" role="toolbar" aria-label="Schematic view">
        <InstrumentIconButton
          icon={ZoomIn}
          label="Zoom in"
          tooltip="Zoom in"
          tooltipSide="left"
          className="view-btn"
          onClick={() => zoomBy(1.25)}
        />
        <InstrumentIconButton
          icon={ZoomOut}
          label="Zoom out"
          tooltip="Zoom out"
          tooltipSide="left"
          className="view-btn"
          onClick={() => zoomBy(0.8)}
        />
        <InstrumentIconButton
          icon={Scan}
          label="Fit circuit to view"
          tooltip="Fit to view"
          tooltipSide="left"
          className="view-btn"
          onClick={fitView}
        />
      </div>

      {labelDraft && (
        <input
          ref={labelInputRef}
          className="value-edit-input net-label-input"
          value={labelDraft.text}
          spellCheck={false}
          placeholder="net name"
          aria-label="Net label name"
          style={{
            left: labelDraft.x * view.zoom + view.x,
            top: (labelDraft.y + 10) * view.zoom + view.y,
          }}
          aria-invalid={labelDraft.error ? "true" : undefined}
          aria-describedby={labelDraft.error ? "net-label-input-error" : undefined}
          onChange={(e) => setLabelDraft({ ...labelDraft, text: e.currentTarget.value, error: undefined })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitLabelDraft();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setLabelDraft(null);
            }
          }}
          onBlur={() => {
            // Click-away confirms, like Enter (empty text removes the label).
            commitLabelDraft();
          }}
        />
      )}
      {labelDraft?.error && (
        <div
          id="net-label-input-error"
          className="net-label-input-error"
          role="alert"
          style={{
            left: labelDraft.x * view.zoom + view.x,
            top: (labelDraft.y + 28) * view.zoom + view.y,
          }}
        >
          {labelDraft.error}
        </div>
      )}

      {editingComp && (
        <input
          className="value-edit-input"
          autoFocus
          value={editingComp.value}
          spellCheck={false}
          style={{ left: editLeft, top: editTop }}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            if (!editDirty.current) {
              beginChange();
              editDirty.current = true;
            }
            setValue(editingComp.id, e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") {
              e.preventDefault();
              setEditingId(null);
            }
          }}
          onBlur={() => setEditingId(null)}
        />
      )}
    </>
  );
}

function ComponentView({
  comp,
  selected,
  showPins,
}: {
  comp: SchematicComponent;
  selected: boolean;
  showPins: boolean;
}) {
  // Presentational only - selection/drag/edit are resolved centrally by
  // geometry in the SVG handlers, so render order never decides hit results.
  // Mirror-before-rotate (matches transformPoint / LTspice M*): SVG applies
  // transforms right-to-left, so `rotate(R) scale(-1 1)` flips then rotates.
  const placement = componentVisualPlacement(comp);
  const orient = symbolTransform(placement.rotation, placement.mirrored);
  const fitScale = sourceSymbolFitScale(comp);
  const fit = fitScale === 1 ? "" : ` scale(${fitScale})`;
  const visualOffset = { x: placement.x - comp.x, y: placement.y - comp.y };
  const overridePins = comp.pinOverride?.length ? getComponentPins(comp) : null;
  const nativePins = new Map(getLocalPins(comp.kind).map((pin) => [pin.id, pin]));
  const nativeSubcircuit = isNativeMultiPinSubcircuit(comp);
  const subcircuitPins = nativeSubcircuit ? localSubcircuitPins(comp) : [];
  const subcircuitBody = nativeSubcircuit ? nativeSubcircuitBody(comp) : null;
  return (
    <g className={`component${selected ? " selected" : ""}`} transform={`translate(${comp.x} ${comp.y})`}>
      {!nativeSubcircuit && overridePins?.map((pin) => {
        const native = nativePins.get(pin.id);
        if (!native) return null;
        const scaledNative = { x: native.x * fitScale, y: native.y * fitScale };
        const local = transformPoint(scaledNative, placement.rotation, placement.mirrored);
        const start = { x: visualOffset.x + local.x, y: visualOffset.y + local.y };
        const end = { x: pin.x - comp.x, y: pin.y - comp.y };
        if (Math.hypot(start.x - end.x, start.y - end.y) < 0.5) return null;
        return <line key={`lead-${pin.id}`} className="import-pin-lead" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />;
      })}
      <g className="symbol" transform={`translate(${visualOffset.x} ${visualOffset.y}) ${orient}${fit}`}>
        {nativeSubcircuit && subcircuitBody ? (
          <>
            <rect
              x={subcircuitBody.minX}
              y={subcircuitBody.minY}
              width={subcircuitBody.maxX - subcircuitBody.minX}
              height={subcircuitBody.maxY - subcircuitBody.minY}
              rx={3}
            />
            {subcircuitPins.map((pin) => (
              <line
                key={`subckt-lead-${pin.id}`}
                x1={pin.x < 0 ? subcircuitBody.minX : subcircuitBody.maxX}
                y1={pin.y}
                x2={pin.x}
                y2={pin.y}
              />
            ))}
            <path d="M -7 -7 L 7 7 M -7 7 L 7 -7" />
          </>
        ) : (
          <ComponentSymbol
            kind={comp.kind}
            value={comp.value}
            // Pin captions are corrected against the body's own orientation, so
            // the symbol has to be told what that is. Without this a part
            // rotated 180 degrees draws every caption upside-down.
            rotation={placement.rotation}
            mirrored={placement.mirrored}
          />
        )}
      </g>
      {nativeSubcircuit && subcircuitBody && subcircuitPins.map((pin) => {
        const labelPoint = transformPoint({
          x: pin.x < 0 ? subcircuitBody.minX + 4 : subcircuitBody.maxX - 4,
          y: pin.y,
        }, placement.rotation, placement.mirrored);
        return (
          <text
            key={`subckt-label-${pin.id}`}
            className="subckt-pin-label"
            x={labelPoint.x}
            y={labelPoint.y + 3}
            textAnchor={labelPoint.x < -8 ? "start" : labelPoint.x > 8 ? "end" : "middle"}
          >
            {pin.label}
          </text>
        );
      })}
      {showPins && (
        <g className="pin-layer" transform={overridePins ? undefined : orient}>
          {/* The instance's own bank, so the pin dots match the gate that is
              actually drawn rather than always showing five inputs. */}
          {(overridePins ?? getLocalPins(comp.kind, comp.value)).map((pin) => (
            <circle
              key={pin.id}
              className="pin-target"
              cx={overridePins ? pin.x - comp.x : pin.x}
              cy={overridePins ? pin.y - comp.y : pin.y}
              r={4.5}
            />
          ))}
        </g>
      )}
    </g>
  );
}

/** All component ref/value labels, drawn in a top layer so nothing can obscure them. */
function ComponentLabels({ components, wires }: { components: SchematicComponent[]; wires: SchematicWire[] }) {
  const placements = useMemo(() => buildLabelPlacements(components, wires), [components, wires]);

  return (
    <g className="label-layer" aria-hidden="true">
      {components.map((c) => {
        const value = sourceValueLabel(c.kind, c.value);
        const placement = placements.get(c.id);
        if (!placement) return null;
        return (
          <g key={c.id}>
            {c.label && (
              <text className="ref" x={placement.ref.x} y={placement.ref.y} textAnchor={placement.ref.anchor}>
                {c.label}
              </text>
            )}
            {value && (
              <text className="val" x={placement.val.x} y={placement.val.y} textAnchor={placement.val.anchor}>
                {value}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** A preserved LTspice drawing primitive. Pure annotation with no electrical
 *  meaning, so it draws behind the circuit and takes no pointer events - it
 *  must never swallow a click meant for a wire underneath it. */
function AscShapeView({ shape }: { shape: SchematicAscShape }) {
  const render = ascShapeRender(shape);
  if (!render) return null;
  // An unrecognised style index falls through to no dash rule, i.e. solid.
  const className = `asc-shape${render.wide ? " wide" : ""}${
    render.style > 0 ? ` dash-${render.style}` : ""
  }`;
  switch (render.kind) {
    case "LINE":
      return (
        <line className={className} x1={render.x1} y1={render.y1} x2={render.x2} y2={render.y2} />
      );
    case "RECTANGLE":
      return (
        <rect
          className={className}
          x={render.x}
          y={render.y}
          width={render.width}
          height={render.height}
        />
      );
    case "CIRCLE":
      return (
        <ellipse className={className} cx={render.cx} cy={render.cy} rx={render.rx} ry={render.ry} />
      );
    case "ARC":
      return <path className={className} d={ascArcPath(render)} />;
  }
}

function WireView({
  wire,
  selected,
  probeReady,
  hops,
  onPointerDown,
}: {
  wire: SchematicWire;
  selected: boolean;
  /** Simulator mode: clicking probes the net, so advertise it with the probe cursor. */
  probeReady: boolean;
  /** Unconnected-crossing x positions per horizontal segment index - drawn
   *  as hop-over arcs so a crossing never reads as a connection. */
  hops?: ReadonlyMap<number, readonly number[]>;
  onPointerDown: (e: ReactPointerEvent<SVGElement>) => void;
}) {
  const d = hops && hops.size > 0 ? pathWithHops(wire.points, hops) : pathFromPoints(wire.points);
  const resistive = Boolean(wire.resistance?.trim() && wire.resistance.trim() !== "0");
  return (
    <g
      className={`wire-group${selected ? " selected" : ""}${probeReady ? " probe-ready" : ""}`}
      onPointerDown={onPointerDown}
    >
      {/* Wide invisible stroke makes the thin wire easy to click. */}
      <path className="wire-hit" d={d} />
      <path className={`wire${resistive ? " resistive" : ""}`} d={d} />
    </g>
  );
}

function WirePolyline({ points, className }: { points: Point[]; className: string }) {
  return <path className={className} d={pathFromPoints(points)} />;
}
