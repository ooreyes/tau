import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useSchematic } from "../store/useSchematic";
import { ComponentSymbol, GRID, SYMBOL_BOX } from "../schematic/symbols";
import { CATALOG_BY_KIND } from "../schematic/catalog";
import type { ComponentKind, Point, SchematicComponent, SchematicWire } from "../schematic/types";
import { getLocalPins, getComponentPins } from "../schematic/pins";
import { decodeParams } from "../schematic/params";
import type { AnalysisResult } from "../simulation/linearTransient";
import { FlowLayer, FLOW_PLAY_MS } from "./FlowLayer";

interface View {
  x: number;
  y: number;
  zoom: number;
}

const snap = (v: number) => Math.round(v / GRID) * GRID;
const clampZoom = (z: number) => Math.min(5, Math.max(0.25, z));
const pointsEqual = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const routeWire = (start: Point, end: Point): Point[] =>
  start.x === end.x || start.y === end.y ? [start, end] : [start, { x: end.x, y: start.y }, end];
const pathFromPoints = (points: Point[]) =>
  points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

const rotateLocalPoint = (point: Point, rotation: number): Point => {
  switch (rotation) {
    case 90:
      return { x: -point.y, y: point.x };
    case 180:
      return { x: -point.x, y: -point.y };
    case 270:
      return { x: point.y, y: -point.x };
    default:
      return point;
  }
};

const explicitUnit = (value: string, unit: string) => {
  if (!unit) return value.trim();
  const v = value.trim();
  if (!v) return "";
  if (unit === "Ω" && /(Ω|ohm|ohms)$/i.test(v)) return v;
  if (unit !== "Ω" && new RegExp(`${unit}$`, "i").test(v)) return v;
  return `${v}${unit}`;
};

const sourceValueLabel = (kind: ComponentKind, value: string) => {
  if (kind !== "vac" && kind !== "iac") {
    const unit = CATALOG_BY_KIND[kind].unit;
    return explicitUnit(value, unit);
  }
  const params = decodeParams(kind, value);
  const ampUnit = kind === "vac" ? "V" : "A";
  return `${explicitUnit(params.amplitude ?? "1", ampUnit)} @ ${explicitUnit(params.frequency ?? "1k", "Hz")}`;
};

const componentBounds = (component: SchematicComponent) => {
  const box = SYMBOL_BOX[component.kind];
  const bodyCorners: Point[] = [
    { x: -box.halfW, y: -box.halfH },
    { x: box.halfW, y: -box.halfH },
    { x: box.halfW, y: box.halfH },
    { x: -box.halfW, y: box.halfH },
  ];
  const pins = getLocalPins(component.kind).map((pin) => ({ x: pin.x, y: pin.y }));
  const points = [...bodyCorners, ...pins].map((point) => rotateLocalPoint(point, component.rotation));
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
};

const labelAxis = (component: SchematicComponent) => {
  const pins = getLocalPins(component.kind).map((pin) => rotateLocalPoint({ x: pin.x, y: pin.y }, component.rotation));
  if (pins.length !== 2) return "center";
  const dx = Math.abs(pins[0].x - pins[1].x);
  const dy = Math.abs(pins[0].y - pins[1].y);
  return dy > dx ? "vertical" : "horizontal";
};

interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface LabelPlacement {
  ref: { x: number; y: number; anchor: "start" | "middle" | "end" };
  val: { x: number; y: number; anchor: "start" | "middle" | "end" };
  box: Rect;
}

const padRect = (rect: Rect, pad: number): Rect => ({
  minX: rect.minX - pad,
  minY: rect.minY - pad,
  maxX: rect.maxX + pad,
  maxY: rect.maxY + pad,
});

const overlapArea = (a: Rect, b: Rect) => {
  const x = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const y = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  return x * y;
};

const estimateTextWidth = (text: string, kind: "ref" | "val") => text.length * (kind === "ref" ? 5.5 : 4.9);

const labelLineRect = (text: string, x: number, y: number, anchor: "start" | "middle" | "end", kind: "ref" | "val") => {
  const w = Math.max(8, estimateTextWidth(text, kind));
  const h = kind === "ref" ? 10 : 9;
  const minX = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
  return padRect({ minX, minY: y - h / 2, maxX: minX + w, maxY: y + h / 2 }, 2);
};

const unionRect = (a: Rect, b: Rect): Rect => ({
  minX: Math.min(a.minX, b.minX),
  minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX),
  maxY: Math.max(a.maxY, b.maxY),
});

const makePlacement = (
  refText: string,
  valText: string,
  ref: LabelPlacement["ref"],
  val: LabelPlacement["val"],
): LabelPlacement => {
  const refBox = labelLineRect(refText, ref.x, ref.y, ref.anchor, "ref");
  const valBox = valText ? labelLineRect(valText, val.x, val.y, val.anchor, "val") : refBox;
  return { ref, val, box: unionRect(refBox, valBox) };
};

const componentWorldRect = (component: SchematicComponent): Rect => {
  const bounds = componentBounds(component);
  return padRect(
    {
      minX: component.x + bounds.minX,
      minY: component.y + bounds.minY,
      maxX: component.x + bounds.maxX,
      maxY: component.y + bounds.maxY,
    },
    5,
  );
};

const labelCandidates = (component: SchematicComponent, refText: string, valText: string) => {
  const b = componentBounds(component);
  const x = component.x;
  const y = component.y;
  const leftX = x + b.minX - 10;
  const rightX = x + b.maxX + 10;
  const topRefY = y + b.minY - 20;
  const belowRefY = y + b.maxY + 10;
  const vertical = labelAxis(component) === "vertical";
  const candidates = [
    makePlacement(refText, valText, { x: leftX, y: y - 7, anchor: "end" }, { x: leftX, y: y + 7, anchor: "end" }),
    makePlacement(refText, valText, { x: rightX, y: y - 7, anchor: "start" }, { x: rightX, y: y + 7, anchor: "start" }),
    makePlacement(refText, valText, { x, y: topRefY, anchor: "middle" }, { x, y: topRefY + 12, anchor: "middle" }),
    makePlacement(refText, valText, { x, y: belowRefY, anchor: "middle" }, { x, y: belowRefY + 12, anchor: "middle" }),
    makePlacement(refText, valText, { x: leftX - 8, y: y + b.minY - 6, anchor: "end" }, { x: leftX - 8, y: y + b.minY + 7, anchor: "end" }),
    makePlacement(refText, valText, { x: rightX + 8, y: y + b.maxY - 8, anchor: "start" }, { x: rightX + 8, y: y + b.maxY + 5, anchor: "start" }),
  ];
  return vertical ? candidates : [candidates[2], candidates[3], candidates[1], candidates[0], candidates[5], candidates[4]];
};

/** Thin rects covering each wire segment, so labels don't settle on top of a
 *  wire and read as if the wire itself carried that value. */
const wireSegmentRects = (wires: SchematicWire[]): Rect[] => {
  const rects: Rect[] = [];
  for (const wire of wires) {
    for (let i = 1; i < wire.points.length; i += 1) {
      const a = wire.points[i - 1];
      const b = wire.points[i];
      rects.push(
        padRect(
          {
            minX: Math.min(a.x, b.x),
            minY: Math.min(a.y, b.y),
            maxX: Math.max(a.x, b.x),
            maxY: Math.max(a.y, b.y),
          },
          3,
        ),
      );
    }
  }
  return rects;
};

const buildLabelPlacements = (components: SchematicComponent[], wires: SchematicWire[] = []) => {
  const componentRects = components.map(componentWorldRect);
  const wireRects = wireSegmentRects(wires);
  const placed: Rect[] = [];
  const placements = new Map<string, LabelPlacement>();

  for (const component of components) {
    const refText = component.label;
    const valText = sourceValueLabel(component.kind, component.value);
    if (!refText && !valText) continue;

    const candidates = labelCandidates(component, refText || valText, valText);
    const scored = candidates.map((candidate) => {
      const obstacles = [...componentRects, ...wireRects, ...placed];
      const score = obstacles.reduce((total, rect) => total + overlapArea(candidate.box, rect), 0);
      return { candidate, score };
    });
    const chosen = scored.find((entry) => entry.score === 0)?.candidate
      ?? scored.sort((a, b) => a.score - b.score)[0].candidate;
    placements.set(component.id, chosen);
    placed.push(padRect(chosen.box, 3));
  }

  return placements;
};

/** Body half-extents (rotation-aware) used to keep component bodies from overlapping. */
const bodyHalf = (kind: ComponentKind, rotation: number) => {
  const b = SYMBOL_BOX[kind];
  return rotation === 90 || rotation === 270 ? { hw: b.halfH, hh: b.halfW } : { hw: b.halfW, hh: b.halfH };
};

/** True if a body at (x,y) would overlap another component's body. Pins may still touch. */
const collides = (
  components: SchematicComponent[],
  x: number,
  y: number,
  kind: ComponentKind,
  rotation: number,
  excludeId: string | null,
): boolean => {
  const a = bodyHalf(kind, rotation);
  for (const c of components) {
    if (c.id === excludeId) continue;
    const b = bodyHalf(c.kind, c.rotation);
    if (Math.abs(x - c.x) < a.hw + b.hw && Math.abs(y - c.y) < a.hh + b.hh) return true;
  }
  return false;
};

/** Nearest grid spot (spiralling out) where a new body won't overlap an existing one. */
const findFreeSpot = (
  components: SchematicComponent[],
  x: number,
  y: number,
  kind: ComponentKind,
  rotation: number,
): Point => {
  if (!collides(components, x, y, kind, rotation, null)) return { x, y };
  for (let r = 1; r <= 16; r += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx * GRID;
        const ny = y + dy * GRID;
        if (!collides(components, nx, ny, kind, rotation, null)) return { x: nx, y: ny };
      }
    }
  }
  return { x, y };
};

export function Canvas({
  analysis,
  interactive = true,
}: {
  analysis: AnalysisResult | null;
  /** When false (simulator view) the canvas is a read-only reflection: pan/zoom
   *  and selecting-to-inspect only — no placing, wiring, probing, or editing. */
  interactive?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [wireDraft, setWireDraft] = useState<{ start: Point; cursor: Point } | null>(null);
  const [snapHover, setSnapHover] = useState<{ x: number; y: number; pin: boolean } | null>(null);
  const [flowOn, setFlowOn] = useState(true);

  const components = useSchematic((s) => s.components);
  const wires = useSchematic((s) => s.wires);
  const selectedId = useSchematic((s) => s.selectedId);
  const selectedWireId = useSchematic((s) => s.selectedWireId);
  const tool = useSchematic((s) => s.tool);
  const placeRotation = useSchematic((s) => s.placeRotation);
  const addComponent = useSchematic((s) => s.addComponent);
  const addWire = useSchematic((s) => s.addWire);
  const select = useSchematic((s) => s.select);
  const selectWire = useSchematic((s) => s.selectWire);
  const moveComponent = useSchematic((s) => s.moveComponent);
  const beginChange = useSchematic((s) => s.beginChange);
  const setValue = useSchematic((s) => s.setValue);
  const probes = useSchematic((s) => s.probes);
  const addProbe = useSchematic((s) => s.addProbe);
  const netLabels = useSchematic((s) => s.netLabels);
  const [editingId, setEditingId] = useState<string | null>(null);
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

  // World pin endpoints of two-terminal R/C/L parts, so charge also flows through the body.
  const legs = useMemo(() => {
    const out: { id: string; a: Point; b: Point }[] = [];
    for (const c of components) {
      if (c.kind !== "resistor" && c.kind !== "capacitor" && c.kind !== "inductor") continue;
      const pins = getComponentPins(c);
      const a = pins.find((p) => p.id === "a");
      const b = pins.find((p) => p.id === "b");
      if (a && b) out.push({ id: c.id, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } });
    }
    return out;
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

  // Interaction kept in a ref so dragging/panning doesn't trigger re-renders.
  const drag = useRef<{ mode: "none" | "pan" | "move"; id?: string; lastX: number; lastY: number; moved: boolean }>({
    mode: "none",
    lastX: 0,
    lastY: 0,
    moved: false,
  });

  // Center the world origin on first mount.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setView((v) => ({ ...v, x: r.width / 2, y: r.height / 2 }));
  }, []);

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const r = svgRef.current!.getBoundingClientRect();
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
    if (tool.mode !== "wire" && tool.mode !== "probe") setSnapHover(null);
  }, [tool.mode]);

  const placeAtCursor = useCallback(
    (clientX: number, clientY: number) => {
      if (tool.mode !== "place") return;
      const w = screenToWorld(clientX, clientY);
      const spot = findFreeSpot(components, snap(w.x), snap(w.y), tool.kind, placeRotation);
      addComponent(tool.kind, spot.x, spot.y);
    },
    [tool, screenToWorld, addComponent, components, placeRotation],
  );

  // Snap to the nearest pin within a small radius, otherwise to the grid — so
  // wiring and probing latch onto terminals instead of being pixel-finicky.
  const snappedCursor = useCallback(
    (clientX: number, clientY: number): Point => {
      const w = screenToWorld(clientX, clientY);
      let best: Point | null = null;
      let bestD = 14 * 14;
      for (const p of pinPoints) {
        const dx = p.x - w.x;
        const dy = p.y - w.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      return best ?? { x: snap(w.x), y: snap(w.y) };
    },
    [screenToWorld, pinPoints],
  );

  const wireAtCursor = useCallback(
    (clientX: number, clientY: number) => {
      if (tool.mode !== "wire") return;
      const end = snappedCursor(clientX, clientY);
      if (wireDraft && !pointsEqual(wireDraft.start, end)) {
        addWire(routeWire(wireDraft.start, end));
      }
      setWireDraft({ start: end, cursor: end });
    },
    [tool, snappedCursor, wireDraft, addWire],
  );

  const onBackgroundPointerDown = (e: ReactPointerEvent<SVGElement>) => {
    if (e.button !== 0) return;
    if (!interactive) {
      // Read-only: clear selection and allow panning to look around.
      select(null);
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
    select(null);
    drag.current = { mode: "pan", lastX: e.clientX, lastY: e.clientY, moved: false };
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onComponentPointerDown = (e: ReactPointerEvent<SVGElement>, comp: SchematicComponent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (!interactive) {
      // Read-only: select to inspect in the results panel, but never move it.
      select(comp.id);
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
    select(comp.id);
    drag.current = { mode: "move", id: comp.id, lastX: e.clientX, lastY: e.clientY, moved: false };
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onWirePointerDown = (e: ReactPointerEvent<SVGElement>, wire: SchematicWire) => {
    if (e.button !== 0) return;
    if (!interactive) return;
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
    } else if (tool.mode === "wire" || tool.mode === "probe") {
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
    } else if (d.mode === "move" && d.id) {
      const w = screenToWorld(e.clientX, e.clientY);
      const tx = snap(w.x);
      const ty = snap(w.y);
      const moving = components.find((c) => c.id === d.id);
      // Never let a body slide into another body (pins may still meet).
      if (moving && collides(components, tx, ty, moving.kind, moving.rotation, d.id)) return;
      // Capture one undo snapshot for the whole drag, on the first move only.
      if (!d.moved) {
        beginChange();
        d.moved = true;
      }
      moveComponent(d.id, tx, ty);
    }
  };

  const endDrag = (e: ReactPointerEvent<SVGElement>) => {
    drag.current.mode = "none";
    drag.current.id = undefined;
    drag.current.moved = false;
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
  const fitView = () => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (components.length === 0 && wires.length === 0) {
      setView({ x: r.width / 2, y: r.height / 2, zoom: 1 });
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of components) {
      minX = Math.min(minX, c.x - 40);
      minY = Math.min(minY, c.y - 40);
      maxX = Math.max(maxX, c.x + 40);
      maxY = Math.max(maxY, c.y + 40);
    }
    for (const w of wires) {
      for (const p of w.points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    const pad = 80;
    const zoom = clampZoom(
      Math.min((r.width - pad * 2) / Math.max(maxX - minX, 1), (r.height - pad * 2) / Math.max(maxY - minY, 1)),
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setView({ zoom, x: r.width / 2 - cx * zoom, y: r.height / 2 - cy * zoom });
  };

  const placing = tool.mode === "place";
  const wiring = tool.mode === "wire";
  const probing = tool.mode === "probe";
  const previewWire = wireDraft ? routeWire(wireDraft.start, wireDraft.cursor) : null;
  const flowActive = analysis?.ok === true;
  const flowEndTime = analysis?.ok ? analysis.times[analysis.times.length - 1] ?? 0 : 0;
  const flowSlowdown = flowEndTime > 0 ? FLOW_PLAY_MS / 1000 / flowEndTime : 0;

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
        style={{ cursor: interactive && (placing || wiring || probing) ? "crosshair" : "default" }}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={() => {
          if (placing) setGhost(null);
          setSnapHover(null);
        }}
      >
        <defs>
          <pattern id="grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
            <circle cx={0} cy={0} r={0.9} className="grid-dot" />
          </pattern>
        </defs>

        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          <rect x={-100000} y={-100000} width={200000} height={200000} fill="url(#grid)" />

          {wires.map((wire) => (
            <WireView
              key={wire.id}
              wire={wire}
              selected={wire.id === selectedWireId}
              onPointerDown={(e) => onWirePointerDown(e, wire)}
            />
          ))}

          {previewWire && <WirePolyline points={previewWire} className="wire preview" />}

          {(wiring || probing) && snapHover && (
            <circle
              className={`snap-ring${snapHover.pin ? " on-pin" : ""}`}
              cx={snapHover.x}
              cy={snapHover.y}
              r={6}
            />
          )}

          {components.map((c) => (
            <ComponentView
              key={c.id}
              comp={c}
              selected={c.id === selectedId}
              showPins={wiring || probing}
              onPointerDown={(e) => onComponentPointerDown(e, c)}
              onEdit={() => {
                if (interactive && c.kind !== "ground") {
                  editDirty.current = false;
                  setEditingId(c.id);
                }
              }}
            />
          ))}

          {probes.map((p) => (
            <g key={p.id} className="probe-marker" style={{ color: p.color }}>
              <circle className="probe-ring" cx={p.x} cy={p.y} r={7} />
              <circle className="probe-dot" cx={p.x} cy={p.y} r={3.5} />
            </g>
          ))}

          {netLabels.map((l) => (
            <text key={l.id} className="net-label-text" x={l.x + 6} y={l.y - 6}>
              {l.text}
            </text>
          ))}

          {flowActive && flowOn && analysis?.ok && (
            <FlowLayer wires={wires} legs={legs} pinIndex={pinIndex} result={analysis} playing={flowOn} />
          )}

          <ComponentLabels components={components} wires={wires} />

          {placing && ghost && (
            <g className="ghost" transform={`translate(${ghost.x} ${ghost.y})`}>
              <g className="symbol" transform={`rotate(${placeRotation})`}>
                <ComponentSymbol kind={tool.kind} />
              </g>
            </g>
          )}
        </g>
      </svg>

      {flowActive && (
        <div className="flow-controls">
          <button
            className={`flow-toggle${flowOn ? " on" : ""}`}
            onClick={() => setFlowOn((v) => !v)}
            title="Animate conventional current along wires and through components"
          >
            <span className="flow-bolt">⚡</span>
            {flowOn ? "Current flow" : "Flow paused"}
          </button>
          {flowOn && flowSlowdown > 0 && (
            <span className="flow-rate">slowed ≈{Math.round(flowSlowdown).toLocaleString()}× vs real time</span>
          )}
        </div>
      )}

      <div className="view-controls">
        <button className="view-btn" onClick={() => zoomBy(1.25)} title="Zoom in" aria-label="Zoom in">
          +
        </button>
        <button className="view-btn" onClick={() => zoomBy(0.8)} title="Zoom out" aria-label="Zoom out">
          −
        </button>
        <button className="view-btn fit" onClick={fitView} title="Fit circuit to view (home)" aria-label="Fit circuit to view">
          ⤢ Fit
        </button>
      </div>

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
  onPointerDown,
  onEdit,
}: {
  comp: SchematicComponent;
  selected: boolean;
  showPins: boolean;
  onPointerDown: (e: ReactPointerEvent<SVGElement>) => void;
  onEdit: () => void;
}) {
  // Hit area sized to this part's own footprint (body + pins) so a small part
  // like ground gets a small target — not a fixed 72×72 box that swallows
  // clicks meant for neighbouring components.
  const bounds = componentBounds(comp);
  const HIT_PAD = 8;
  return (
    <g
      className={`component${selected ? " selected" : ""}`}
      transform={`translate(${comp.x} ${comp.y})`}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onEdit();
      }}
    >
      <rect
        x={bounds.minX - HIT_PAD}
        y={bounds.minY - HIT_PAD}
        width={bounds.maxX - bounds.minX + HIT_PAD * 2}
        height={bounds.maxY - bounds.minY + HIT_PAD * 2}
        fill="transparent"
      />
      <g className="symbol" transform={`rotate(${comp.rotation})`}>
        <ComponentSymbol kind={comp.kind} />
      </g>
      {showPins && (
        <g className="pin-layer" transform={`rotate(${comp.rotation})`}>
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
  onPointerDown,
}: {
  wire: SchematicWire;
  selected: boolean;
  onPointerDown: (e: ReactPointerEvent<SVGElement>) => void;
}) {
  const d = pathFromPoints(wire.points);
  return (
    <g className={`wire-group${selected ? " selected" : ""}`} onPointerDown={onPointerDown}>
      {/* Wide invisible stroke makes the thin wire easy to click. */}
      <path className="wire-hit" d={d} />
      <path className="wire" d={d} />
    </g>
  );
}

function WirePolyline({ points, className }: { points: Point[]; className: string }) {
  return <path className={className} d={pathFromPoints(points)} />;
}
