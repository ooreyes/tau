import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Small hairline zoom cluster (+, −, ⌂) overlaid on a scope plot — the same
 * visual language as the schematic canvas's `.view-controls`/`.view-btn`
 * (Canvas.tsx), scaled down to fit inside a scope pane instead of the whole
 * viewport. The ⌂ button's tooltip documents the full interaction set
 * (wheel/shift-wheel/alt-wheel/drag) since there's no other persistent UI
 * real estate for it.
 */
export function ScopeZoomCluster({
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  return (
    <div className="scope-zoom-controls">
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="scope-zoom-btn" onClick={onZoomIn} aria-label="Zoom in">
            +
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">Zoom in (scroll up)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="scope-zoom-btn" onClick={onZoomOut} aria-label="Zoom out">
            −
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">Zoom out (scroll down)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="scope-zoom-btn" onClick={onFit} aria-label="Fit plot to data">
            ⌂
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">
          Fit to data (double-click) · Scroll to zoom about cursor · Shift/⇧-scroll = X only ·
          Option/Alt-scroll = Y only · Drag to pan
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
