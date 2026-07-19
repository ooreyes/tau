import { Scan, ScanLine, ZoomIn, ZoomOut } from "lucide-react";

import { InstrumentIconButton } from "@/components/ui/instrument-icon-button";

/**
 * Small hairline zoom cluster overlaid on a scope plot. Its Lucide zoom/scan
 * actions follow the same SF Symbol semantics as Tau's other instrument
 * controls. The fit button's tooltip documents the full interaction set
 * (⌘/pinch-wheel, shift/alt locks, drag) since there's no other persistent UI
 * real estate for it. Plain wheel is deliberately absent from that list - it
 * scrolls the analysis panel, not the plot (usePlotViewport.ts).
 */
export function ScopeZoomCluster({
  onZoomIn,
  onZoomOut,
  onFit,
  onAutoFrame,
  fitLabel = "Fit plot to data",
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  /** Optional periodic-aware engineering frame; distinct from full-data Home. */
  onAutoFrame?: () => void;
  fitLabel?: string;
}) {
  return (
    <div className="scope-zoom-controls">
      <InstrumentIconButton
        icon={ZoomIn}
        label="Zoom in"
        tooltip="Zoom in (⌘+scroll or pinch)"
        tooltipSide="left"
        onClick={onZoomIn}
      />
      <InstrumentIconButton
        icon={ZoomOut}
        label="Zoom out"
        tooltip="Zoom out (⌘+scroll or pinch)"
        tooltipSide="left"
        onClick={onZoomOut}
      />
      <InstrumentIconButton
        icon={Scan}
        label={fitLabel}
        tooltip={
          <>
            Fit to data (double-click) · ⌘/pinch-scroll to zoom about cursor · Shift+⌘-scroll = X only ·
            Option+⌘-scroll = Y only · Drag to pan
          </>
        }
        tooltipSide="left"
        onClick={onFit}
      />
      {onAutoFrame && (
        <InstrumentIconButton
          icon={ScanLine}
          label="Auto frame signal"
          tooltip="Auto frame: show the final four cycles of a periodic signal and scale Y to that window"
          tooltipSide="left"
          onClick={onAutoFrame}
        />
      )}
    </div>
  );
}
