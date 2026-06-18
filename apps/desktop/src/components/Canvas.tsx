import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useSchematic } from "../store/useSchematic";
import { ComponentSymbol, GRID } from "../schematic/symbols";
import { CATALOG_BY_KIND } from "../schematic/catalog";
import type { Point, SchematicComponent, SchematicWire } from "../schematic/types";
import { getLocalPins } from "../schematic/pins";

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

export function Canvas() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [wireDraft, setWireDraft] = useState<{ start: Point; cursor: Point } | null>(null);

  const components = useSchematic((s) => s.components);
  const wires = useSchematic((s) => s.wires);
  const selectedId = useSchematic((s) => s.selectedId);
  const tool = useSchematic((s) => s.tool);
  const placeRotation = useSchematic((s) => s.placeRotation);
  const addComponent = useSchematic((s) => s.addComponent);
  const addWire = useSchematic((s) => s.addWire);
  const select = useSchematic((s) => s.select);
  const moveComponent = useSchematic((s) => s.moveComponent);

  // Interaction kept in a ref so dragging/panning doesn't trigger re-renders.
  const drag = useRef<{ mode: "none" | "pan" | "move"; id?: string; lastX: number; lastY: number }>({
    mode: "none",
    lastX: 0,
    lastY: 0,
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
  }, [tool.mode]);

  const placeAtCursor = useCallback(
    (clientX: number, clientY: number) => {
      if (tool.mode !== "place") return;
      const w = screenToWorld(clientX, clientY);
      addComponent(tool.kind, snap(w.x), snap(w.y));
    },
    [tool, screenToWorld, addComponent],
  );

  const snappedCursor = useCallback(
    (clientX: number, clientY: number): Point => {
      const w = screenToWorld(clientX, clientY);
      return { x: snap(w.x), y: snap(w.y) };
    },
    [screenToWorld],
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
    if (tool.mode === "place") {
      placeAtCursor(e.clientX, e.clientY);
      return;
    }
    if (tool.mode === "wire") {
      wireAtCursor(e.clientX, e.clientY);
      return;
    }
    select(null);
    drag.current = { mode: "pan", lastX: e.clientX, lastY: e.clientY };
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onComponentPointerDown = (e: ReactPointerEvent<SVGElement>, comp: SchematicComponent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (tool.mode === "place") {
      placeAtCursor(e.clientX, e.clientY);
      return;
    }
    if (tool.mode === "wire") {
      wireAtCursor(e.clientX, e.clientY);
      return;
    }
    select(comp.id);
    drag.current = { mode: "move", id: comp.id, lastX: e.clientX, lastY: e.clientY };
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGElement>) => {
    if (tool.mode === "place") {
      const w = screenToWorld(e.clientX, e.clientY);
      setGhost({ x: snap(w.x), y: snap(w.y) });
    } else if (tool.mode === "wire") {
      const cursor = snappedCursor(e.clientX, e.clientY);
      setWireDraft((draft) => (draft ? { ...draft, cursor } : draft));
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
      moveComponent(d.id, snap(w.x), snap(w.y));
    }
  };

  const endDrag = (e: ReactPointerEvent<SVGElement>) => {
    drag.current.mode = "none";
    drag.current.id = undefined;
    const el = svgRef.current;
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };

  const placing = tool.mode === "place";
  const wiring = tool.mode === "wire";
  const previewWire = wireDraft ? routeWire(wireDraft.start, wireDraft.cursor) : null;

  return (
    <svg
      ref={svgRef}
      className="canvas"
      style={{ cursor: placing || wiring ? "crosshair" : "default" }}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={() => placing && setGhost(null)}
    >
      <defs>
        <pattern id="grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
          <circle cx={0} cy={0} r={0.9} className="grid-dot" />
        </pattern>
      </defs>

      <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
        <rect x={-100000} y={-100000} width={200000} height={200000} fill="url(#grid)" />

        {wires.map((wire) => (
          <WireView key={wire.id} wire={wire} />
        ))}

        {previewWire && <WirePolyline points={previewWire} className="wire preview" />}

        {components.map((c) => (
          <ComponentView
            key={c.id}
            comp={c}
            selected={c.id === selectedId}
            showPins={wiring}
            onPointerDown={(e) => onComponentPointerDown(e, c)}
          />
        ))}

        {placing && ghost && (
          <g className="ghost" transform={`translate(${ghost.x} ${ghost.y})`}>
            <g className="symbol" transform={`rotate(${placeRotation})`}>
              <ComponentSymbol kind={tool.kind} />
            </g>
          </g>
        )}
      </g>
    </svg>
  );
}

function ComponentView({
  comp,
  selected,
  showPins,
  onPointerDown,
}: {
  comp: SchematicComponent;
  selected: boolean;
  showPins: boolean;
  onPointerDown: (e: ReactPointerEvent<SVGElement>) => void;
}) {
  const entry = CATALOG_BY_KIND[comp.kind];
  return (
    <g
      className={`component${selected ? " selected" : ""}`}
      transform={`translate(${comp.x} ${comp.y})`}
      onPointerDown={onPointerDown}
    >
      {/* Generous transparent hit area so thin symbols are easy to grab. */}
      <rect x={-36} y={-36} width={72} height={72} fill="transparent" />
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
      {comp.label && (
        <text className="ref" x={0} y={-24} textAnchor="middle">
          {comp.label}
        </text>
      )}
      {comp.value && (
        <text className="val" x={0} y={33} textAnchor="middle">
          {comp.value}
          {entry.unit}
        </text>
      )}
    </g>
  );
}

function WireView({ wire }: { wire: SchematicWire }) {
  return <WirePolyline points={wire.points} className="wire" />;
}

function WirePolyline({ points, className }: { points: Point[]; className: string }) {
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  return <path className={className} d={d} />;
}
