import type { PanelWidthConfig } from "@/components/ui/resizable";

export const SHELL_LAYOUT = {
  railWidth: 54,
  handleWidth: 8,
  schematicEditorMin: 260,
  explorerMin: 168,
  simulatorSchematicMin: 250,
  plotterMin: 280,
} as const;

/**
 * Whether independent right-side columns fit beside the Explorer and editor
 * at their usable floors. A zero shell width is the pre-measurement frame and
 * is treated as fitting so panels do not flash closed during mount.
 */
export function workspaceCanFitIndependentColumns(shellWidth: number, columnMinWidths: readonly number[]): boolean {
  if (shellWidth <= 0) return true;
  const handleCount = 1 + columnMinWidths.length; // Explorer + each right column.
  const reserved = SHELL_LAYOUT.railWidth
    + SHELL_LAYOUT.explorerMin
    + SHELL_LAYOUT.schematicEditorMin
    + SHELL_LAYOUT.handleWidth * handleCount
    + columnMinWidths.reduce((sum, width) => sum + width, 0);
  return reserved <= shellWidth;
}

/** Maximum width for one independent right-side column after reserving any
 * sibling columns plus the editor/analysis floors. */
export function workspaceRightColumnMax(
  shellWidth: number,
  mode: "schematic" | "simulator",
  config: Pick<PanelWidthConfig, "minWidth" | "maxWidth">,
  siblingWidths: readonly number[] = [],
): number {
  if (shellWidth <= 0) return config.maxWidth;
  const reserved = mode === "simulator"
    ? SHELL_LAYOUT.railWidth
      + SHELL_LAYOUT.handleWidth
      + SHELL_LAYOUT.simulatorSchematicMin
      + SHELL_LAYOUT.plotterMin
    : SHELL_LAYOUT.railWidth
      + (SHELL_LAYOUT.handleWidth * (2 + siblingWidths.length))
      + SHELL_LAYOUT.explorerMin
      + SHELL_LAYOUT.schematicEditorMin
      + siblingWidths.reduce((sum, width) => sum + width, 0);
  return Math.min(config.maxWidth, Math.max(config.minWidth, shellWidth - reserved));
}

/** Explorer budget after all independently sized right columns are reserved. */
export function workspaceExplorerMax(shellWidth: number, rightColumnWidths: readonly number[]): number | undefined {
  if (shellWidth <= 0) return undefined;
  return Math.max(
    SHELL_LAYOUT.explorerMin,
    shellWidth
      - SHELL_LAYOUT.railWidth
      - (SHELL_LAYOUT.handleWidth * (1 + rightColumnWidths.length))
      - SHELL_LAYOUT.schematicEditorMin
      - rightColumnWidths.reduce((sum, width) => sum + width, 0),
  );
}
