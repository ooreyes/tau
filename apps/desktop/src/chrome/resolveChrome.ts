/**
 * The shell layout, as one pure function.
 *
 * This is a behaviour-preserving extraction, not a redesign. It reproduces
 * exactly what App.tsx computes today across `independentColumnsFit`,
 * `componentsColumnOpen`, `explorerColumnOpen`, three `workspaceRightColumnMax`
 * calls and two clamping effects. The proof it is faithful is that
 * `App.workspace.test.tsx`, which drives the real shell through a ResizeObserver
 * at 1440 and 900, passes unchanged.
 *
 * Why bother: the same rule was previously stated in four places that had to
 * agree, and the responsive floor mutated the user's preference to enforce
 * itself. Once visibility is derived rather than asserted, a rail button can
 * explain why it did nothing, and widening the window restores what the user
 * originally asked for because nothing overwrote it.
 */
import { SHELL_LAYOUT, SURFACES, type SurfaceId, type VisibilityReason } from "./surfaces";

export { SHELL_LAYOUT };

/** What the user has asked for, independent of whether it currently fits. */
export interface ChromeIntent {
  explorer: boolean;
  components: boolean;
  assistant: boolean;
}

export interface ChromeInput {
  mode: "schematic" | "simulator";
  shellWidth: number;
  intent: ChromeIntent;
  /** Persisted widths, before any responsive clamping. */
  widths: { explorer: number; components: number; assistant: number };
}

export interface ResolvedSurface {
  visible: boolean;
  reason: VisibilityReason;
  /** Clamped to what actually fits. Undefined when the surface is hidden. */
  width?: number;
  /** Upper bound the resize handle must respect right now. */
  maxWidth?: number;
}

export type ResolvedChrome = Record<SurfaceId, ResolvedSurface>;

/**
 * Whether both independent right columns fit beside the Explorer and editor at
 * their usable floors. A zero shell width is the pre-measurement frame and is
 * treated as fitting, so panels do not flash closed during mount.
 */
export function canFitIndependentColumns(
  shellWidth: number,
  columnMinWidths: readonly number[],
): boolean {
  if (shellWidth <= 0) return true;
  const handleCount = 1 + columnMinWidths.length; // Explorer plus each right column.
  const reserved =
    SHELL_LAYOUT.railWidth +
    SHELL_LAYOUT.explorerMin +
    SHELL_LAYOUT.schematicEditorMin +
    SHELL_LAYOUT.handleWidth * handleCount +
    columnMinWidths.reduce((sum, width) => sum + width, 0);
  return reserved <= shellWidth;
}

/** Maximum width for one right column after reserving its siblings and the
 *  editor or analysis floors. */
export function rightColumnMax(
  shellWidth: number,
  mode: "schematic" | "simulator",
  config: { minWidth: number; maxWidth: number },
  siblingWidths: readonly number[] = [],
): number {
  if (shellWidth <= 0) return config.maxWidth;
  const reserved =
    mode === "simulator"
      ? SHELL_LAYOUT.railWidth +
        SHELL_LAYOUT.handleWidth +
        SHELL_LAYOUT.simulatorSchematicMin +
        SHELL_LAYOUT.plotterMin
      : SHELL_LAYOUT.railWidth +
        SHELL_LAYOUT.handleWidth * (2 + siblingWidths.length) +
        SHELL_LAYOUT.explorerMin +
        SHELL_LAYOUT.schematicEditorMin +
        siblingWidths.reduce((sum, width) => sum + width, 0);
  return Math.min(config.maxWidth, Math.max(config.minWidth, shellWidth - reserved));
}

/** Explorer budget once every right column has been reserved. */
export function explorerMax(
  shellWidth: number,
  rightColumnWidths: readonly number[],
): number | undefined {
  if (shellWidth <= 0) return undefined;
  return Math.max(
    SHELL_LAYOUT.explorerMin,
    shellWidth -
      SHELL_LAYOUT.railWidth -
      SHELL_LAYOUT.handleWidth * (1 + rightColumnWidths.length) -
      SHELL_LAYOUT.schematicEditorMin -
      rightColumnWidths.reduce((sum, width) => sum + width, 0),
  );
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function resolveChrome(input: ChromeInput): ResolvedChrome {
  const { mode, shellWidth, intent, widths } = input;

  const independentColumnsFit = canFitIndependentColumns(shellWidth, [
    SURFACES.components.width.minWidth,
    SURFACES.assistant.width.minWidth,
  ]);

  const componentsVisible = mode === "schematic" && intent.components;

  // At the 900px floor Explorer, Components and Assistant cannot all coexist.
  // Components and Assistant are the active creation tools, so they stay and
  // the passive Explorer yields. `yieldRank` in surfaces.ts is where that
  // ordering is stated; this is the one place it is applied.
  const explorerVisible =
    mode === "schematic" && (!intent.assistant || !componentsVisible || independentColumnsFit);

  const assistantMax = rightColumnMax(
    shellWidth,
    mode,
    SURFACES.assistant.width,
    mode === "schematic" && intent.assistant && componentsVisible
      ? [SURFACES.components.width.minWidth]
      : [],
  );
  const assistantWidth = clamp(widths.assistant, SURFACES.assistant.width.minWidth, assistantMax);

  const componentsMax = rightColumnMax(shellWidth, "schematic", SURFACES.components.width,
    intent.assistant ? [assistantWidth] : []);
  const componentsWidth = clamp(
    widths.components,
    SURFACES.components.width.minWidth,
    componentsMax,
  );

  const explorerBudget = explorerVisible
    ? explorerMax(shellWidth, [
        ...(componentsVisible ? [componentsWidth] : []),
        ...(intent.assistant ? [assistantWidth] : []),
      ])
    : undefined;

  /** A hidden surface says which of the three reasons applies. */
  const reasonFor = (
    id: SurfaceId,
    visible: boolean,
    wanted: boolean,
    yieldedSpace: boolean,
  ): VisibilityReason => {
    if (visible) return "intent";
    if (!SURFACES[id].modes.includes(mode)) return "wrong-mode";
    if (!wanted) return "closed";
    return yieldedSpace ? "yielded-space" : "closed";
  };

  return {
    explorer: {
      visible: explorerVisible,
      // Explorer is never "closed" by its own toggle today; it is present in
      // schematic mode unless it has to yield, so the only two reasons it can
      // be absent are the mode and the floor.
      reason: reasonFor("explorer", explorerVisible, true, true),
      width: explorerVisible ? widths.explorer : undefined,
      maxWidth: explorerBudget,
    },
    components: {
      visible: componentsVisible,
      reason: reasonFor("components", componentsVisible, intent.components, false),
      width: componentsVisible ? componentsWidth : undefined,
      maxWidth: componentsMax,
    },
    assistant: {
      visible: intent.assistant,
      reason: reasonFor("assistant", intent.assistant, intent.assistant, false),
      width: intent.assistant ? assistantWidth : undefined,
      maxWidth: assistantMax,
    },
  };
}
