import { useState } from "react";
import type { ComponentMeasurement } from "../simulation/measurementModel";
import { ComponentMeasurementsPanel } from "./ComponentMeasurementsPanel";
import { PanelResizeHandle, usePanelWidth, type PanelWidthConfig } from "./panelResize";

/**
 * Collapsible per-component V/I/P dock anchored to the bottom of the
 * simulator's circuit column . Reuses panelResize.tsx's
 * clamp/pointer/localStorage machinery for the height drag (edge="top" - see
 * PanelWidthConfig) and ComponentMeasurementsPanel's "compact" variant for
 * the card strip itself, so the dock owns layout chrome only, never the
 * measurement model or card markup.
 */
const DOCK_HEIGHT_CONFIG: PanelWidthConfig = {
  storageKey: "tau.telemetryDock.height",
  defaultWidth: 200,
  minWidth: 120,
  // Preserve at least ~180px of circuit canvas at Tau's 600px window floor.
  maxWidth: 300,
  edge: "top",
};

const COLLAPSE_KEY = "tau.telemetryDock.collapsed";

function loadCollapsed(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveCollapsed(collapsed: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  } catch {
    // Quota exceeded / private mode - the session keeps its in-memory state.
  }
}

export function TelemetryDock({
  rows,
  selectedId,
  onSelect,
}: {
  rows: readonly ComponentMeasurement[];
  selectedId: string | null;
  onSelect: (componentId: string | null) => void;
}) {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const resize = usePanelWidth(DOCK_HEIGHT_CONFIG);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      saveCollapsed(next);
      return next;
    });
  };

  return (
    <section
      className={`telemetry-dock${collapsed ? " telemetry-dock--collapsed" : ""}`}
      aria-label="Component measurements"
      style={collapsed ? undefined : { height: resize.width }}
    >
      {!collapsed && (
        <PanelResizeHandle
          edge="top"
          label="Resize component measurements dock"
          width={resize.width}
          minWidth={DOCK_HEIGHT_CONFIG.minWidth}
          maxWidth={DOCK_HEIGHT_CONFIG.maxWidth}
          dragging={resize.dragging}
          onPointerDown={resize.onPointerDown}
          onKeyDown={resize.onKeyDown}
        />
      )}
      <button
        type="button"
        className="disclosure-header telemetry-dock-header"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        aria-label="Toggle component measurements"
      >
        <span className="disclosure-label">Measurements</span>
        <span className="telemetry-dock-count">{rows.length} components</span>
        <span className="disclosure-rule" aria-hidden="true" />
        <span className={`disclosure-chevron${!collapsed ? " open" : ""}`}>›</span>
      </button>
      {!collapsed && (
        <div className="telemetry-dock-body">
          <ComponentMeasurementsPanel rows={rows} selectedId={selectedId} onSelect={onSelect} variant="compact" />
        </div>
      )}
    </section>
  );
}

export default TelemetryDock;
