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
import {
  ANALYSIS_PANE_WIDTH,
  SHELL_LAYOUT,
  SURFACES,
  type SurfaceId,
  type VisibilityReason,
} from "./surfaces";

export { SHELL_LAYOUT, ANALYSIS_PANE_WIDTH };

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

/**
 * Inner width of `.workspace-column`: what is left of the shell once the rail
 * and every visible side column - each of which carries its own resize handle
 * - has been paid for. The caller passes the widths it decided to show, so
 * this works for either mode (simulator: the Assistant alone; schematic:
 * Explorer, Components, Assistant).
 *
 * Worth having as a named function rather than a subtraction at the call site
 * because it is the number App.css measures: `.workspace-column` is the
 * `@container workspace` (`App.css:7267-7272`). Stating the split threshold in
 * these units is what lets `SHELL_LAYOUT.splitMinWorkspace` and the 620px
 * container query be the same fact rather than two numbers that happen to be
 * near each other.
 *
 * A zero shell width is the pre-measurement frame and yields a zero workspace,
 * which is honest: nothing is known yet. See `resolveAnalysisPane` for why
 * that answer is safe here even though `canFitIndependentColumns` takes the
 * opposite view of the same frame.
 */
export function workspaceWidth(
  shellWidth: number,
  sideColumnWidths: readonly number[] = [],
): number {
  if (shellWidth <= 0) return 0;
  return Math.max(
    0,
    shellWidth -
      SHELL_LAYOUT.railWidth -
      SHELL_LAYOUT.handleWidth * sideColumnWidths.length -
      sideColumnWidths.reduce((sum, width) => sum + width, 0),
  );
}

export interface AnalysisPaneInput {
  /** Inner width of the workspace column, from `workspaceWidth()`. */
  workspace: number;
  /**
   * The user's width as loaded from storage. `resolveAnalysisPane` never
   * writes it back: a window that got narrower is not the user changing their
   * mind, so the clamp below is for rendering only and widening the window
   * hands the original width back.
   */
  persisted: number;
}

export interface ResolvedAnalysisPane {
  /** `split` = circuit | analysis side by side; `stacked` = today's drawer. */
  layout: "split" | "stacked";
  /** Width to render the pane at now - `persisted`, clamped to the bounds. */
  width: number;
  /** Clamp bounds the divider must respect right now. */
  minWidth: number;
  maxWidth: number;
}

/**
 * The split/stack decision and the divider's clamp, as one answer.
 *
 * The bounds are always defined, even when stacked, because the consuming
 * component has to call `usePanelWidth` unconditionally; handing it an
 * `undefined` max would push it into inventing the arithmetic this function
 * exists to own.
 *
 * `maxWidth` is what leaves the circuit its floor, and it is `simulatorSchematicMin`
 * that enforces that floor - see the finding recorded on that constant: the
 * CSS `min-width` on `.sim-schematic-pane` is overridden, so nothing else is
 * holding the line.
 *
 * The pre-measurement frame (`workspace === 0`) stacks, and it does so out of
 * the ordinary comparison rather than a special case. That is the opposite
 * polarity to `canFitIndependentColumns`, which calls zero "fitting" - and
 * deliberately so. There, the pessimistic answer would flash a panel closed
 * and destroy nothing; here, the optimistic answer would mount a divider whose
 * clamp was computed from a width of zero. Stacked is the shape that is
 * correct at every width, so it is the honest thing to show before the first
 * measurement.
 */
export function resolveAnalysisPane(input: AnalysisPaneInput): ResolvedAnalysisPane {
  const { workspace, persisted } = input;
  const minWidth = ANALYSIS_PANE_WIDTH.minWidth;
  const maxWidth = Math.min(
    ANALYSIS_PANE_WIDTH.maxWidth,
    Math.max(
      minWidth,
      workspace - SHELL_LAYOUT.handleWidth - SHELL_LAYOUT.simulatorSchematicMin,
    ),
  );
  return {
    layout: workspace >= SHELL_LAYOUT.splitMinWorkspace ? "split" : "stacked",
    width: clamp(persisted, minWidth, maxWidth),
    minWidth,
    maxWidth,
  };
}

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
