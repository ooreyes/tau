/**
 * Every chrome surface, declared once, with the facts the layout needs to
 * reason about it.
 *
 * Today App.tsx asserts visibility in a dozen places: a boolean per panel, two
 * clamping effects, and a responsive rule smeared across three derived values.
 * That is why the shell is hard to change and why resizing "forgets" what the
 * user asked for. The redesign (REDESIGN.md) replaces asserted visibility with
 * DERIVED visibility, and this file is the data it derives from.
 *
 * The one invariant that makes it work: **`intent` is written only by the
 * user; the responsive logic never touches it.** Today the 900px floor calls
 * `setPartsOpen(false)`, which destroys the preference rather than overriding
 * it for as long as the window is narrow, so widening the window does not put
 * the panel back. A surface that yields space is `visible: false` with a
 * reason, and its intent is untouched.
 */
import { ASSISTANT_PANEL_WIDTH } from "@/components/assistantPanelState";
import { COMPONENTS_RAIL_WIDTH } from "@/components/ShellPanels";
import type { PanelWidthConfig } from "@/components/ui/resizable";

/** Fixed costs the layout has to reserve before any panel gets width. */
export const SHELL_LAYOUT = {
  railWidth: 54,
  handleWidth: 8,
  schematicEditorMin: 260,
  explorerMin: 168,
  simulatorSchematicMin: 250,
  plotterMin: 280,
} as const;

export type SurfaceId = "explorer" | "components" | "assistant";

/** Why a surface is or is not on screen. Not decoration: a rail button that
 *  silently does nothing is the defect this exists to make impossible. */
export type VisibilityReason =
  | "intent"
  | "yielded-space"
  | "wrong-mode"
  | "closed";

export interface SurfaceSpec {
  id: SurfaceId;
  /** Modes this surface can appear in at all. */
  modes: readonly ("schematic" | "simulator")[];
  width: PanelWidthConfig;
  /**
   * Lower yields first when the row will not fit. Explorer is the passive
   * column; Components and Assistant are the active creation tools, so the
   * Explorer is the one that steps aside at the floor. This ordering was
   * previously implicit in a boolean expression.
   */
  yieldRank: number;
}

export const SURFACES: Record<SurfaceId, SurfaceSpec> = {
  explorer: {
    id: "explorer",
    modes: ["schematic"],
    width: {
      storageKey: "tau.ui.explorerWidth",
      defaultWidth: 226,
      minWidth: SHELL_LAYOUT.explorerMin,
      maxWidth: 420,
      edge: "right",
    },
    yieldRank: 0,
  },
  components: {
    id: "components",
    modes: ["schematic"],
    width: COMPONENTS_RAIL_WIDTH,
    yieldRank: 1,
  },
  assistant: {
    id: "assistant",
    modes: ["schematic", "simulator"],
    width: ASSISTANT_PANEL_WIDTH,
    yieldRank: 2,
  },
};
