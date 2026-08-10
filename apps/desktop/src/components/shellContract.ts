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
   * Right dock holding the inspector and the parts library behind a segmented
   * control. Stage 5 splits it, and this entry goes away with it: the two
   * halves become `partsPalette` and `selectionInspector` below.
   */
  componentsRail: { role: "complementary", name: "Components" },
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
   * The one bottom surface: waveforms, per-component measurements and
   * diagnostics behind three tabs, at peek/half/full.
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

/** Inspector name for a given designator, e.g. `R1 properties`. */
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
  measurements: "Resize component measurements dock",
} as const;
