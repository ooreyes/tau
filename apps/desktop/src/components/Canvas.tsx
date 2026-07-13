import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useSchematic } from "../store/useSchematic";
import { ComponentSymbol, GRID, SYMBOL_BOX } from "../schematic/symbols";
import type { NetLabel, Point, SchematicComponent, SchematicWire } from "../schematic/types";
import { getLocalPins, getComponentPins } from "../schematic/pins";
import type { OperatingPointResult } from "../simulation/operatingPoint";
import { opAnnotations } from "../simulation/opAnnotations";
import { extractCircuit, netAtPoint } from "../schematic/netlist";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  autoNetLabelOffset,
  autoNetLabelOffsets,
  buildLabelPlacements,
  circuitBoundsWithLabels,
  collides,
  fitViewTransform,
  componentAt,
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
  /** For single-component move: the component's pin positions at drag start. */
  sourcePins?: Point[];
  sourceWires?: SchematicWire[];
  /** For group-move: map from component id → pin world positions at drag start. */
  groupSourcePins?: Map<string, Point[]>;
  /** For group-move: per-component world origins at drag start. */
  groupOrigins?: Map<string, Point>;
}

export function Canvas({
  op = null,
  interactive = true,
  fitSignal = 0,
}: {
  /** Last DC operating point; in simulator mode its node voltages / branch
   *  currents are annotated in place on the schematic (§6). */
  op?: OperatingPointResult | null;
  /** When false (simulator view) the canvas is a read-only reflection: pan/zoom
   *  and selecting-to-inspect only — no placing, wiring, probing, or editing. */
  interactive?: boolean;
  /** Bumped by App on open/new/tab switch so the schematic auto-fits once. */
  fitSignal?: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [wireDraft, setWireDraft] = useState<{ start: Point; cursor: Point } | null>(null);
  const [snapHover, setSnapHover] = useState<{ x: number; y: number; pin: boolean } | null>(null);
  /** Pending net label being typed (label tool): world point + draft text. */
  const [labelDraft, setLabelDraft] = useState<{ x: number; y: number; text: string } | null>(null);
  const labelInputRef = useRef<HTMLInputElement | null>(null);
  /** Rubber-band box in screen coords, null when not drawing. */
  const [boxDrag, setBoxDrag] = useState<BoxDrag | null>(null);
  /** True while a component (or group) is being dragged — drives snap-dot visibility. */
  const [movingParts, setMovingParts] = useState(false);

  const components = useSchematic((s) => s.components);
  const wires = useSchematic((s) => s.wires);
  // Keep latest geometry in refs so fitView stays stable and does NOT re-fit
  // the camera on every component/wire edit (only on fitSignal / home / resize).
  const componentsRef = useRef(components);
  const wiresRef = useRef(wires);
  componentsRef.current = components;
  wiresRef.current = wires;
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
  const moveGroup = useSchematic((s) => s.moveGroup);
  const clearSelection = useSchematic((s) => s.clearSelection);
  const beginChange = useSchematic((s) => s.beginChange);
  const deleteSelected = useSchematic((s) => s.deleteSelected);
  const setValue = useSchematic((s) => s.setValue);
  const probes = useSchematic((s) => s.probes);
  const addProbe = useSchematic((s) => s.addProbe);
  const removeProbe = useSchematic((s) => s.removeProbe);
  const netLabels = useSchematic((s) => s.netLabels);
  const upsertNetLabel = useSchematic((s) => s.upsertNetLabel);
  const setNetLabelOffsetDirect = useSchematic((s) => s.setNetLabelOffsetDirect);
  const [editingId, setEditingId] = useState<string | null>(null);

  // In-place OP annotations (simulator mode only): re-extract geometry only
  // when an ok OP result is actually on screen — never during schematic edits.
  const opLabels = useMemo(() => {
    if (interactive || !op?.ok) return [];
    return opAnnotations(op, extractCircuit(components, wires, netLabels));
  }, [interactive, op, components, wires, netLabels]);
  const editDirty = useRef(false);

  // Map of world "x,y" -> component pins there, for attributing wire current flow.
  const pinIndex = useMemo(() => {
    const m = new Map<string, { componentId: string; pinId: string }[]>();
    for (const c of components) {
      for (const p of getComponentPins(c)) {
        const k = `${p.x},${p.y}`;
        const list = m.get(k) ?? [];
        list.push({ componentId: c.id, pinId: p.id });
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

  // World-space bbox of everything selected — anchors the floating delete
  // pill. Mirrors deleteSelected's own single-vs-multi selection fallbacks so
  // the pill appears exactly when a delete would do something.
  const selectionBounds = useMemo(() => {
    if (!interactive) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let any = false;
    const include = (x1: number, y1: number, x2: number, y2: number) => {
      any = true;
      minX = Math.min(minX, x1);
      minY = Math.min(minY, y1);
      maxX = Math.max(maxX, x2);
      maxY = Math.max(maxY, y2);
    };
    const compIds = new Set(selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : []);
    for (const component of components) {
      if (!compIds.has(component.id)) continue;
      const rect = componentWorldRect(component);
      include(rect.minX, rect.minY, rect.maxX, rect.maxY);
    }
    const wireIds = new Set(selectedWireIds.length > 0 ? selectedWireIds : selectedWireId ? [selectedWireId] : []);
    for (const wire of wires) {
      if (!wireIds.has(wire.id)) continue;
      for (const point of wire.points) include(point.x, point.y, point.x, point.y);
    }
    for (const label of netLabels) {
      if (!selectedLabelIds.includes(label.id)) continue;
      include(label.x, label.y - 12, label.x + 36, label.y + 4);
    }
    for (const probe of probes) {
      if (!selectedProbeIds.includes(probe.id)) continue;
      include(probe.x - 8, probe.y - 8, probe.x + 8, probe.y + 8);
    }
    return any ? { minX, minY, maxX, maxY } : null;
  }, [interactive, components, wires, netLabels, probes, selectedId, selectedIds, selectedWireId, selectedWireIds, selectedLabelIds, selectedProbeIds]);

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

  const moveComponentWithAttachedWires = useCallback(
    (id: string, x: number, y: number, sourcePins: Point[], sourceWires: SchematicWire[], dx: number, dy: number) => {
      const wiresWithMovedEndpoints = translateAttachedWireEndpoints(sourceWires, sourcePins, dx, dy);
      useSchematic.setState((state) => {
        const components = state.components.map((component) =>
          component.id === id ? { ...component, x, y } : component,
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
      let bestD = 22 * 22; // ~1.4 grid cells of forgiveness
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
    [screenToWorld, snapTargets, pinPoints, pinKeySet, wires],
  );

  const wireAtCursor = useCallback(
    (clientX: number, clientY: number) => {
      if (tool.mode !== "wire") return;
      const end = snappedCursor(clientX, clientY);
      if (wireDraft && !pointsEqual(wireDraft.start, end)) {
        addWire(routeWireSmart(wireDraft.start, end, components, wires));
      }
      setWireDraft({ start: end, cursor: end });
    },
    [tool, snappedCursor, wireDraft, addWire, components, wires],
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

  // Marquee semantics: anything INSIDE OR INTERSECTING the box selects —
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
  const handleSimulatorNodeAction = (clientX: number, clientY: number): boolean => {
    if (interactive || (tool.mode !== "probe" && tool.mode !== "label")) return false;
    const point = snappedCursor(clientX, clientY);
    const physicalNets = extractCircuit(components, wires, []).nets;
    if (!netAtPoint(physicalNets, wires, point)) return false;
    if (tool.mode === "probe") {
      addProbe(point.x, point.y);
    } else if (!labelDraft) {
      const existing = netLabels.find((label) =>
        netAtPoint(physicalNets, wires, label)?.id === netAtPoint(physicalNets, wires, point)?.id,
      );
      setLabelDraft({ x: point.x, y: point.y, text: existing?.text ?? "" });
    }
    return true;
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
      const w = snappedCursor(e.clientX, e.clientY);
      addProbe(w.x, w.y);
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
      const isInGroup = selectedIds.includes(hit.id) && selectedIds.length > 1;
      if (isInGroup) {
        // Group move: snapshot pin positions for all components in the selection.
        const snapshotComps = components.filter((c) => selectedIds.includes(c.id));
        const groupSourcePins = new Map<string, Point[]>();
        for (const c of snapshotComps) {
          groupSourcePins.set(c.id, getComponentPins(c).map(({ x, y }) => ({ x, y })));
        }
        const groupOrigins = new Map<string, Point>(snapshotComps.map((c) => [c.id, { x: c.x, y: c.y }]));
        const frozenWires = wires.map((w) => ({ ...w, points: w.points.map((p) => ({ ...p })) }));
        drag.current = {
          mode: "group-move",
          id: hit.id,
          groupIds: selectedIds.slice(),
          lastX: e.clientX,
          lastY: e.clientY,
          moved: false,
          origin: { x: hit.x, y: hit.y },
          groupSourcePins,
          groupOrigins,
          sourceWires: frozenWires,
        };
        setMovingParts(true);
      } else {
        select(hit.id);
        drag.current = {
          mode: "move",
          id: hit.id,
          lastX: e.clientX,
          lastY: e.clientY,
          moved: false,
          origin: { x: hit.x, y: hit.y },
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
      setBoxDrag({ startX: e.clientX, startY: e.clientY, curX: e.clientX, curY: e.clientY });
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
    selectWire(wire.id);
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
      setBoxDrag((prev) => prev ? { ...prev, curX: e.clientX, curY: e.clientY } : prev);
    } else if (d.mode === "move" && d.id && d.origin && d.sourcePins && d.sourceWires) {
      const w = screenToWorld(e.clientX, e.clientY);
      const tx = snap(w.x);
      const ty = snap(w.y);
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
      const anchorOrigin = d.groupOrigins.get(d.id ?? "") ?? d.origin;
      const dx = snap(w.x) - anchorOrigin.x;
      const dy = snap(w.y) - anchorOrigin.y;
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      if (dx === 0 && dy === 0) return;
      if (!d.moved) {
        beginChange();
        d.moved = true;
      }
      moveGroup(d.groupOrigins, dx, dy, d.groupSourcePins, d.sourceWires);
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

  const endDrag = (e: ReactPointerEvent<SVGElement>) => {
    const d = drag.current;
    if (d.mode === "box") {
      // On release, commit the box selection.
      setBoxDrag((prev) => {
        if (prev) {
          const rect = boxWorldRect(prev);
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
        return null;
      });
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
    setMovingParts(false);
    drag.current.mode = "none";
    drag.current.id = undefined;
    drag.current.groupIds = undefined;
    drag.current.moved = false;
    drag.current.origin = undefined;
    drag.current.sourcePins = undefined;
    drag.current.sourceWires = undefined;
    drag.current.groupSourcePins = undefined;
    drag.current.groupOrigins = undefined;
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
    // Label-aware bounds + 12%/48px viewport padding so long refdes/value
    // text never touches (or clips at) the canvas edge (§11 Unit A2).
    const b = circuitBoundsWithLabels(componentsRef.current, wiresRef.current);
    if (!b) {
      setView({ x: r.width / 2, y: r.height / 2, zoom: 1 });
      return;
    }
    setView(fitViewTransform(b, r.width, r.height, { minZoom: 0.25, maxZoom: 5 }));
  }, []);

  // Auto-fit when the document identity changes (open / new / tab switch).
  // Deliberately does NOT depend on components/wires — user pan is preserved
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
    const ro = new ResizeObserver(() => fitView());
    ro.observe(el);
    return () => ro.disconnect();
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
  // (rename/select), not a drag — small enough not to feel laggy, large
  // enough to absorb hand tremor on a trackpad tap.
  const LABEL_DRAG_THRESHOLD = 4;

  const activateNetLabel = (l: NetLabel) => {
    if (!interactive && labeling) {
      // Click-without-drag opens the rename draft — unchanged from before
      // labels were draggable.
      setLabelDraft({ x: l.x, y: l.y, text: l.text });
    } else if (interactive && tool.mode === "select") {
      selectMixed({ componentIds: [], wireIds: [], labelIds: [l.id], probeIds: [] });
    }
  };

  const onNetLabelPointerDown = (l: NetLabel, offset: { dx: number; dy: number }) =>
    (event: ReactPointerEvent<SVGTextElement>) => {
      if (event.button !== 0) return;
      event.stopPropagation();
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
      // One undo snapshot for the whole drag, on the first move only — same
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
        onDoubleClick={onCanvasDoubleClick}
        onPointerLeave={() => {
          if (placing) setGhost(null);
          setSnapHover(null);
        }}
      >
        <defs>
          {/*
            Circles must be centered in each tile — SVG patterns clip at the
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
            return (
              <g
                key={p.id}
                className={`probe-marker${p.componentId ? " current" : ""}${probeSelected ? " selected" : ""}${!interactive ? " simulator-removable" : ""}`}
                style={{ color: p.color }}
                role={!interactive ? "button" : undefined}
                tabIndex={!interactive ? 0 : undefined}
                aria-label={!interactive ? `Remove ${p.componentId ? "current" : "voltage"} probe` : undefined}
                onPointerDown={!interactive ? (event) => {
                  event.stopPropagation();
                  removeProbe(p.id);
                } : undefined}
                onKeyDown={!interactive ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    removeProbe(p.id);
                  }
                } : undefined}
              >
                {probeSelected && <circle className="probe-select-ring" cx={px} cy={py} r={11} />}
                <circle className="probe-ring" cx={px} cy={py} r={7} />
                <circle className="probe-dot" cx={px} cy={py} r={3.5} />
              </g>
            );
          })}

          {/* Net names sit under component ref/value labels so collisions
              (e.g. "Output" vs "Rf") keep the part label readable. Each
              label's screen position is anchor + (dx,dy): dx/dy undefined
              (never dragged, or an old .sim file predating this field) falls
              back to `autoNetLabelOffset`'s collision-avoiding placement;
              once dragged, the explicit offset wins forever so auto-place
              never fights a placement the user chose (§Fix2). */}
          <g className={`net-label-layer${labelsInteractive ? " labels-interactive" : ""}`} aria-hidden={labelsInteractive ? undefined : "true"}>
            {netLabels.map((l) => {
              const offset = netLabelOffsets.get(l.id)
                ?? autoNetLabelOffset({ x: l.x, y: l.y }, l.text, components, wires, probes);
              const tx = l.x + offset.dx;
              const ty = l.y + offset.dy;
              // Anchor and text drift apart once dragged far — a leader line
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

          {opLabels.map((a) =>
            a.kind === "voltage" ? (
              <text key={a.key} className="op-annotation voltage" x={a.x + 5} y={a.y - 8}>
                {a.text}
              </text>
            ) : (
              // Centered under the component body — clear of the ref/value
              // labels, which sit beside the body.
              <text key={a.key} className="op-annotation current" x={a.x} y={a.y + 30} textAnchor="middle">
                {a.text}
              </text>
            ),
          )}

          <ComponentLabels components={components} wires={wires} />

          {placing && ghost && (
            <g className="ghost" transform={`translate(${ghost.x} ${ghost.y})`}>
              <g className="symbol" transform={symbolTransform(placeRotation, placeMirror)}>
                <ComponentSymbol kind={tool.kind} />
              </g>
            </g>
          )}
        </g>

        {/* Rubber-band selection rectangle — in screen space (no world transform). */}
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

      <div className="view-controls">
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="view-btn" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
              +
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Zoom in</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="view-btn" onClick={() => zoomBy(0.8)} aria-label="Zoom out">
              −
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Zoom out</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="view-btn" onClick={fitView} aria-label="Fit circuit to view">
              ⌂
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Fit to view</TooltipContent>
        </Tooltip>
      </div>

      {interactive && selectionBounds && !labelDraft && (
        // Floating delete affordance: the Delete key already works, but a
        // visible ✕ beside the selection makes removal a one-click action.
        // pointerdown stops here so the click can't start a canvas pan/drag.
        <button
          type="button"
          className="selection-delete-pill"
          style={{
            left: selectionBounds.maxX * view.zoom + view.x + 10,
            top: selectionBounds.minY * view.zoom + view.y - 12,
          }}
          aria-label="Delete selection"
          title="Delete selection (Del)"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            deleteSelected();
          }}
        >
          ✕
        </button>
      )}

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
          onChange={(e) => setLabelDraft({ ...labelDraft, text: e.currentTarget.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              upsertNetLabel(labelDraft.x, labelDraft.y, labelDraft.text);
              setLabelDraft(null);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setLabelDraft(null);
            }
          }}
          onBlur={() => {
            // Click-away confirms, like Enter (empty text removes the label).
            upsertNetLabel(labelDraft.x, labelDraft.y, labelDraft.text);
            setLabelDraft(null);
          }}
        />
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
  // Presentational only — selection/drag/edit are resolved centrally by
  // geometry in the SVG handlers, so render order never decides hit results.
  // Mirror-before-rotate (matches transformPoint / LTspice M*): SVG applies
  // transforms right-to-left, so `rotate(R) scale(-1 1)` flips then rotates.
  const orient = symbolTransform(comp.rotation, comp.mirrored ?? false);
  return (
    <g className={`component${selected ? " selected" : ""}`} transform={`translate(${comp.x} ${comp.y})`}>
      <g className="symbol" transform={orient}>
        <ComponentSymbol kind={comp.kind} />
      </g>
      {showPins && (
        <g className="pin-layer" transform={orient}>
          {getLocalPins(comp.kind).map((pin) => (
            <circle key={pin.id} className="pin-target" cx={pin.x} cy={pin.y} r={4.5} />
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
  /** Unconnected-crossing x positions per horizontal segment index — drawn
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
