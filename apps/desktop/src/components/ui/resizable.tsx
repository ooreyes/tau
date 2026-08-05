/**
 * Tau Resizable (shadcn-shaped). Re-exports the pixel-persisted panelResize
 * authority used by Explorer / Components / Assistant / telemetry dock.
 *
 * Deliberate deviation from stock shadcn `react-resizable-panels`: those
 * percentage PanelGroups cannot express Tau's localStorage widths + responsive
 * max clamps without rewriting the shell. Same WAI-ARIA separator role; chrome
 * via `.panel-resize-handle` tokens in App.css.
 */
export {
  PanelResizeHandle,
  PanelResizeHandle as ResizableHandle,
  usePanelWidth,
  clampPanelWidth,
  loadPanelWidth,
  savePanelWidth,
  type PanelWidthConfig,
} from "@/components/panelResize";
