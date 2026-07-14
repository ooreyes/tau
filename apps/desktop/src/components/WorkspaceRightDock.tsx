import type { CSSProperties, ReactNode } from "react";
import { PanelResizeHandle, type PanelWidthConfig, usePanelWidth } from "./panelResize";

export const SHELL_LAYOUT = {
  railWidth: 54,
  handleWidth: 8,
  schematicEditorMin: 260,
  explorerMin: 168,
  simulatorSchematicMin: 250,
  plotterMin: 280,
} as const;

/** Maximum width a shared Assistant/Components dock may consume without
 * starving the rest of the application at Tau's minimum window width. */
export function workspaceRightDockMax(
  shellWidth: number,
  mode: "schematic" | "simulator",
  config: Pick<PanelWidthConfig, "minWidth" | "maxWidth">,
): number {
  if (shellWidth <= 0) return config.maxWidth;
  const reserved = mode === "simulator"
    ? SHELL_LAYOUT.railWidth
      + SHELL_LAYOUT.handleWidth
      + SHELL_LAYOUT.simulatorSchematicMin
      + SHELL_LAYOUT.plotterMin
    : SHELL_LAYOUT.railWidth
      + (SHELL_LAYOUT.handleWidth * 2)
      + SHELL_LAYOUT.explorerMin
      + SHELL_LAYOUT.schematicEditorMin;
  return Math.min(config.maxWidth, Math.max(config.minWidth, shellWidth - reserved));
}
/** Explorer budget after the shared right dock has taken its single column. */
export function workspaceExplorerMax(shellWidth: number, rightDockWidth: number): number | undefined {
  if (shellWidth <= 0) return undefined;
  return Math.max(
    SHELL_LAYOUT.explorerMin,
    shellWidth
      - SHELL_LAYOUT.railWidth
      - (SHELL_LAYOUT.handleWidth * 2)
      - SHELL_LAYOUT.schematicEditorMin
      - rightDockWidth,
  );
}

type ResizeState = ReturnType<typeof usePanelWidth>;

/** One right-side width boundary with vertically stacked independent tools. */
export function WorkspaceRightDock({
  width,
  resize,
  minWidth,
  maxWidth,
  children,
}: {
  width: number;
  resize: ResizeState;
  minWidth: number;
  maxWidth: number;
  children: ReactNode;
}) {
  return (
    <div
      className="workspace-right-dock"
      role="group"
      aria-label="Workspace tools"
      style={{ "--workspace-dock-w": `${width}px` } as CSSProperties}
    >
      <PanelResizeHandle
        edge="left"
        label="Resize workspace tools"
        width={width}
        minWidth={minWidth}
        maxWidth={maxWidth}
        dragging={resize.dragging}
        onPointerDown={resize.onPointerDown}
        onKeyDown={resize.onKeyDown}
      />
      {children}
    </div>
  );
}
