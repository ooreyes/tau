/**
 * The accessible name of every shell surface, in one place, imported by both
 * the components that render them and the tests that look for them.
 *
 * Why this exists: the canvas-first redesign (see REDESIGN.md) moves nearly
 * every piece of chrome, and roughly 35 assertions across five test files
 * currently hardcode these strings. Without a shared source of truth, each
 * stage of the redesign is free to invent a new name, and the only signal that
 * something was renamed rather than removed is a test failing somewhere else.
 * With one, a rename is a one-line diff in a reviewed file, and a stage that
 * invents a name gets a typecheck error instead.
 *
 * The rule for the migration: **a surface keeps its name unless the thing it
 * names genuinely changes.** Renaming is not free. `design-shot.mjs` and the
 * screenshot archive join on these too, so a gratuitous rename costs
 * comparability with every capture taken before it.
 *
 * Each entry carries its `role` as well as its `name`, because that pair is
 * what a `getByRole` query needs and keeping them together stops the two
 * drifting apart in different files.
 */

export interface ShellSurface {
  /** ARIA role, implicit or explicit, that the surface presents. */
  role: string;
  /** Accessible name. This is the string a component sets and a test queries. */
  name: string;
}

/**
 * Surfaces that exist today. The redesign may move, merge or delete these; it
 * may not rename one without changing this file in the same commit.
 */
export const SHELL = {
  /**
   * The schematic canvas. Named as part of freezing this contract; it was an
   * anonymous `<main className="stage">`, which gave Escape nothing to return
   * focus to. Only the editing stage carries this name, not the empty-state
   * stage that replaces it when no file is open.
   */
  canvas: { role: "main", name: "Schematic canvas" },
  /** Left icon rail. Never collapses, at any viewport. */
  navRail: { role: "navigation", name: "Workspace sections" },
  /** Project file tree. */
  explorer: { role: "complementary", name: "Project explorer" },
  /**
   * The parts library. It used to hold the inspector too, behind a
   * "Properties | Library" segmented control - two unrelated things sharing
   * one column to justify the column. The inspector moved to the selection
   * (see `inspectorName`), and the rail keeps its name because the thing it
   * names, the place parts come from, did not change. Stage 5 makes it
   * summoned rather than docked; the name survives that too.
   */
  componentsRail: { role: "complementary", name: "Components" },
  /**
   * The properties panel, floating at the selection.
   *
   * `dialog` with no `aria-modal`, deliberately: it names a surface assistive
   * tech can jump to without the "everything else is inert" claim, which
   * would be false and would make the canvas unreachable for as long as
   * anything is selected. Its name comes from `inspectorName`, and the
   * property-group `<section>` inside it now goes unnamed when there is only
   * one part, because the two were colliding under one accessible name.
   */
  selectionInspector: { role: "dialog", name: "properties" },
  /** Bode, the circuit assistant. */
  assistant: { role: "complementary", name: "Assistant" },
  /** Full-surface Settings, a real modal since it moved to ui/dialog. */
  settings: { role: "dialog", name: "Settings" },
  /** Shown when no project folder is open. */
  projectStart: { role: "region", name: "Project start" },
  /** Shown when a project is open but no schematic is. */
  emptySchematic: { role: "region", name: "Empty schematic" },
  /** The simulator's read-only view of the circuit. */
  circuitOverview: { role: "region", name: "Circuit overview" },
  /**
   * The one results surface: waveforms, per-component measurements and
   * diagnostics behind three tabs.
   *
   * Named "Results" rather than the "Waveforms" this was planned under. The
   * landmark names the drawer, not whichever tab happens to be up, and a
   * landmark whose name changes under the reader is worse than a generic one.
   * "Waveforms" survives as the tab and as the rail control.
   *
   * It replaces three entries that used to be here. `analysisPlotter` is gone
   * because the plotter is no longer a landmark - it is this drawer's
   * Waveforms body, and two nested complementary regions is noise.
   * `minimizedPanels` is gone with the restore orb it named: peek is a
   * readout, so there is nothing left to restore from.
   *
   * It docks to two edges now and the name is the same at both, deliberately.
   * In the schematic, and in a simulator too narrow to split, it is the bottom
   * drawer at peek/half/full. In a wide simulator it is the right-hand
   * analysis pane beside the circuit, resized by `SHELL_SEPARATORS.analysisPane`.
   * ONE surface, ONE landmark, ONE name: a reader who learns "Results" must
   * not have to learn a second word because the window got wider, and the
   * screenshot archive joins on these strings.
   */
  resultsDrawer: { role: "complementary", name: "Results" },
  /** Interactive-circuit controls, shown only when the schematic has any. */
  liveControls: { role: "group", name: "Live controls" },
  /**
   * The command palette, which is already titled "Add component" and is
   * already a summoned overlay that places parts.
   *
   * Recorded here rather than under PLANNED because the redesign's "floating
   * parts palette" turns out to be mostly this, not a new surface. Stage 5 is
   * therefore smaller than planned: it moves the Library half of the
   * components rail into a surface that exists, instead of building one.
   */
  commandPalette: { role: "dialog", name: "Add component" },
  /** First-success coach. */
  learningPath: { role: "complementary", name: "Learning path" },
} as const satisfies Record<string, ShellSurface>;

/**
 * Names the redesign introduces. Declared here before they exist so that
 * REDESIGN.md and the code cannot disagree about them, and so the stage that
 * builds each surface has no reason to invent its own wording.
 *
 * Empty right now: the results drawer shipped and moved up into SHELL. The
 * next entries land with stage 5's summoned side surfaces and stage 6's
 * selection inspector, which is a template rather than a constant because the
 * inspector is named for what it inspects (`R1 properties`) - "Properties"
 * alone tells a screen-reader user nothing about which part they are editing.
 */
export const PLANNED = {} as const satisfies Record<string, ShellSurface>;

/**
 * Inspector name for a given designator, e.g. `R1 properties`.
 *
 * Named for what it inspects, not "Properties": the latter tells a
 * screen-reader user nothing about which part they are about to edit, and
 * with the panel now appearing next to the part, the name is the only thing
 * carrying that association for someone who cannot see the adjacency.
 */
export function inspectorName(designator: string): string {
  return `${designator} properties`;
}

/**
 * Controls that open or close a shell surface. Named separately from the
 * surfaces because a button and the thing it reveals are different objects,
 * and the redesign changes which button reveals what.
 */
export const SHELL_CONTROLS = {
  railExplorer: "Explorer",
  railSearch: "Search",
  railComponents: "Components",
  railWaveforms: "Waveforms",
  railSettings: "Settings",
  transportRun: "Run simulation",
  transportSettings: "Settings",
  openAssistant: "Open Bode",
  closeAssistant: "Close assistant",
  closeSettings: "Close settings",
} as const;

/**
 * Resize handles. Each is a `separator`. A surface that stops being resizable
 * loses its entry; a surface that stays resizable keeps its name even if it
 * changes from a docked column to a floating sheet, because the handle still
 * does the same job.
 */
export const SHELL_SEPARATORS = {
  explorer: "Resize project explorer",
  properties: "Resize properties panel",
  assistant: "Resize assistant panel",
  /**
   * The simulator's circuit | analysis divider.
   *
   * It takes the slot `measurements` held. That entry named the telemetry
   * dock's top edge, and the dock was one of the three surfaces stage 4a
   * merged into the results drawer - so it had been naming nothing for some
   * time. Replaced rather than added beside, because a contract that
   * accumulates names for deleted surfaces stops being a contract: the next
   * reader cannot tell which entries are load-bearing.
   *
   * Present only when the workspace is wide enough for the split
   * (`resolveAnalysisPane`). Below that the analysis is the bottom drawer,
   * which has no width to drag, and a separator for it would be a control
   * that does nothing.
   */
  analysisPane: "Resize analysis pane",
} as const;
