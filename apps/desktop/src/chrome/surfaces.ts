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
  /**
   * The circuit pane's floor in the simulator - and, verified against the
   * current App.css, the ONLY floor it has. `App.css:7282-7285` declares
   *
   *     .workspace-column > .editor-shell,
   *     .workspace-column > .sim-schematic-pane { min-width: 0; }
   *
   * at specificity 0-2-0, which beats the `min-width: 280px` on
   * `.sim-schematic-pane` at `App.css:7519` (0-1-0); and the pane really is a
   * direct child of `.workspace-column` (`App.tsx:2734` opens the column,
   * `App.tsx:2841` is the `<section className="sim-schematic-pane">` inside
   * it), so the descendant rule is not hypothetical. The CSS floor therefore
   * does not apply: the circuit pane's real floor today is ZERO.
   *
   * That changes what this constant is FOR. It used to be a reservation -
   * arithmetic for budgeting a sibling column, with CSS assumed to be holding
   * the actual line. Once the divider lands it becomes the enforced floor,
   * the only thing standing between a drag and a collapsed circuit. So it is
   * raised 250 -> 280 to agree with the number the stylesheet states, and with
   * `.workspace-column`'s own `min-width: 280px` (`App.css:7276`), whose
   * comment already calls 280 "the wider of the two floors its children
   * declare". A floor that disagrees with the CSS by 30px is a floor nobody
   * can reason about.
   */
  simulatorSchematicMin: 280,
  plotterMin: 280,
  /**
   * Below this workspace width the simulator stacks (today's results drawer
   * under the circuit) instead of splitting into circuit | analysis.
   *
   * 620 is not a new opinion about narrowness; it is the one this module's
   * own stylesheet already holds. `App.css:7488` declares
   * `@container workspace (max-width: 620px)` and drops the run-facts strip
   * there, and that container is `.workspace-column` measured on `inline-size`
   * (`App.css:7267-7272`) - precisely the number `workspaceWidth()` returns.
   * At 620 the layout already considers itself too cramped to state the run
   * facts in ONE column; asking it for two columns there is strictly worse.
   *
   * The arithmetic floor is lower: a split needs `simulatorSchematicMin +
   * handleWidth + plotterMin` = 568. The 52px between 568 and 620 is the band
   * where a split is legal but both panes sit exactly on their floors, which
   * is a worse circuit AND a worse plot than the stacked drawer that already
   * works there. Splitting is only worth doing when it buys somebody room.
   */
  splitMinWorkspace: 620,
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

/**
 * The analysis pane's remembered width.
 *
 * Deliberately not a `SurfaceSpec`: the analysis is not a chrome surface the
 * user opens and closes from the rail. In the simulator it is always on -
 * either as the right half of the split or as the stacked drawer - so it has
 * no `intent` to preserve and no `yieldRank`, and giving it a `SurfaceId`
 * would let `resolveChrome` try to hide it. What it does share with the
 * surfaces is the one thing this config expresses: a width the user drags and
 * Tau remembers. Reusing `PanelWidthConfig` is the point - the divider gets
 * `usePanelWidth`'s clamp, pointer capture and persistence rather than a
 * second implementation of drag.
 *
 * `edge: "left"`: the pane docks right, so the divider lives on its left edge
 * and dragging left widens it - the same convention Assistant and Components
 * already use.
 *
 * The bounds are the layout's own constants, not new numbers. Min is the
 * plotter's floor. The ceiling is both pane floors together (560): past that
 * the analysis pane alone is as wide as the narrowest legal split, and
 * `App.css:7518` gives `.sim-schematic-pane` `flex: 1`, i.e. the circuit is
 * the pane meant to absorb a wide window. In any case this static ceiling
 * only guards a stale or hand-edited localStorage value - the limit that
 * actually binds during a drag is the dynamic one `resolveAnalysisPane()`
 * derives from the current workspace width.
 */
export const ANALYSIS_PANE_WIDTH: PanelWidthConfig = {
  storageKey: "tau.ui.analysisPaneWidth",
  defaultWidth: 480,
  minWidth: SHELL_LAYOUT.plotterMin,
  maxWidth: SHELL_LAYOUT.plotterMin + SHELL_LAYOUT.simulatorSchematicMin,
  edge: "left",
};
