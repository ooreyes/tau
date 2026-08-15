import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Square } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
// Co-located rather than listed with App.tsx's stylesheet imports, which is
// where this app's other sheets are pulled in. The deviation is deliberate:
// this sheet is nothing but the geometry of THIS component's drag handle, and
// an entry-point import is a dependency a reader of this file cannot see - the
// first draft shipped without it, which left the handle on the shared 8px rule,
// i.e. under the 24px hit floor. Importing it here makes the handle and its hit
// area arrive together or not at all. (A duplicate import from App.tsx is inert
// - the bundler dedupes by resolved id.)
import "../../styles/resultsDrawerResize.css";
import {
  PanelResizeHandle,
  clearPanelWidth,
  hasStoredPanelWidth,
  usePanelWidth,
} from "@/components/panelResize";

/**
 * The one bottom surface.
 *
 * Tau had three: a diagnostics strip glued under the schematic editor, a
 * telemetry dock glued under the simulator's circuit column, and the analysis
 * plotter as a right-hand column with its own title, its own actions and its
 * own restore-orb when collapsed. Each carried a full set of chrome to say
 * what it was, none of them could use the window's width, and the plotter -
 * the only one an engineer actually reads - got whatever was left after the
 * circuit, the explorer and the assistant had taken theirs.
 *
 * They are one drawer now: one surface, one landmark, one name. That merge is
 * the part worth keeping, and it is untouched by everything below.
 *
 * ## Which edge it docks to
 *
 * `orientation` decides, and it is an EXPLICIT prop rather than something
 * inferred from a measured width. Docked `bottom` it floats over the mode
 * surface at peek/half/full - the schematic's only shape, and the simulator's
 * shape below `SHELL_LAYOUT.splitMinWorkspace`. Docked `right` it is the
 * simulator's analysis pane, a real column beside the circuit with a divider
 * between them.
 *
 * Inferring the dock from a width would have made the schematic's behaviour
 * and the narrow fallback *accidentally* unchanged - true only for as long as
 * nobody moved the threshold. A prop makes them provably unchanged: the split
 * decision is made once, in `chrome/resolveChrome.ts`, and this component is
 * told the answer.
 *
 * The original merge note said the width was the point - a waveform is a wide
 * thing, and 1400px beats 400px. That was written against a drawer that had to
 * cover the schematic to get that width. Beside the circuit, the waveform and
 * the thing it is a waveform OF are legible at the same time, which is the
 * trade the user asked for. The 1:1 plot geometry (see the note at the top of
 * SimulationPanel.tsx) is what makes a 480px pane read correctly rather than
 * as a 3x-scaled miniature, so it is load-bearing for both docks.
 *
 * ## Chrome
 *
 * One header row: run state, tabs, size. That is deliberately less than the
 * plotter used to carry - an "Analysis / Transient scope" kicker-and-title
 * stacked above a tab strip that already says TRAN is ink that stops carrying
 * information after the first read, which is the antipattern the design
 * language exists to prevent. The drawer names itself once, in its landmark.
 *
 * ## Heights, and why they are a bottom-dock idea
 *
 * `peek` is the header alone: still a readout (the lamp, the sample count and
 * the issue count are all there), which is why there is no separate restore
 * affordance to build. `half` is the working size. `full` deliberately stops
 * short of the top so the circuit never disappears entirely - a drawer that
 * covers its own subject is a page, not a drawer.
 *
 * ...and why they are no longer the ONLY heights. The three were the whole
 * height control until a user reported the obvious: "the error window is not
 * resizable, I should be able to drag up or down". A button that cycles three
 * stylesheet-owned percentages cannot express "260px of errors and the rest of
 * the circuit", so the top edge now carries the same `PanelResizeHandle` the
 * explorer and the analysis divider use - pointer plus arrow keys plus a
 * persisted size, one mechanism, not a second one invented here.
 *
 * A drag writes a PIXEL height, so it has to override the class, and the two
 * can disagree. **The discrete height wins whenever anything sets it** - the
 * cycle button, Escape, the run-finished raise, a tab click, a mode change:
 * each drops the drag override and forgets the stored pixels. Last gesture
 * wins, and the alternative is worse than untidy - an override that outlived
 * them would leave Escape and the size button visibly inert, which is exactly
 * the silently-does-nothing defect the rest of this file is written against.
 *
 * All three answer one question: how much of the circuit am I willing to cover
 * to read this? Docked right the drawer covers nothing - it is a column, the
 * circuit is beside it, and the drawer is as tall as the workspace at every
 * size. So the question has no answer there, and the size control is NOT
 * rendered rather than left cycling a class that changes nothing on screen: a
 * control that silently does nothing is the defect the shell contract exists
 * to make impossible. The axis that IS negotiable in that dock is width, and
 * it belongs to the divider between the two panes, which is a `separator` with
 * the WAI-ARIA arrow-key behaviour - so a keyboard user loses nothing.
 *
 * ## Focus and Escape
 *
 * Escape collapses to `peek` ONLY when focus is inside the drawer. Canvas
 * Escape has to keep meaning "cancel the current tool", and a document-level
 * listener that does not check would silently take that over. When it does
 * collapse it hands focus to the size control first, so a keyboard user is
 * never left standing on a control that just went `display: none`.
 *
 * Docked right, Escape does not collapse either - for the same reason the size
 * control is gone, and so that the two cannot disagree about whether this
 * drawer has a collapsed state at all.
 *
 * ## Why every tab stays mounted
 *
 * Only the active panel is shown, but all of them are rendered, hidden with
 * the `hidden` attribute rather than removed. Not a detail: SimulationPanel
 * holds about thirty pieces of state that no store owns - expression traces
 * the user typed, cursor positions, per-trace colour overrides, manual axis
 * limits, and reference `.raw`/`.plt` data imported from disk. Rendering only
 * the active tab threw all of that away on a click to Measurements and back,
 * and on every collapse, including the one Escape performs.
 *
 * `hidden` is the mechanism because the requirement it has to satisfy is an
 * accessibility one, not a visual one: a surface nobody can see must be out
 * of the accessibility tree, or `getByRole` goes ambiguous and a screen-reader
 * user can tab into something that is not on screen. `hidden` computes to
 * `display: none`, which removes the subtree outright - unlike the
 * translate-off-screen trick the note at the top of App.shellContract.test.tsx
 * warns about, which leaves it fully exposed.
 */

export type DrawerHeight = "peek" | "half" | "full";
export type DrawerTab = "waveforms" | "measurements" | "errors";
/** Which edge the drawer docks to. See "Which edge it docks to" above. */
export type DrawerOrientation = "bottom" | "right";

/**
 * How much of the mode surface the drawer is sitting on, per axis.
 *
 * Axis-tagged rather than one scalar, and that is a correctness fix, not
 * tidying. The old scalar was `getBoundingClientRect().height`, which is the
 * right number docked bottom and the FULL COLUMN HEIGHT docked right - fed
 * into `Canvas`'s `fitInsetBottom` it reserved the whole window along the
 * bottom, collapsing the fit box and, through `inspectorViewport`, squashing
 * the inspector's vertical range to nothing. It does not throw, and no test in
 * JSDOM can see it because every rect there measures zero. The type is the
 * only thing that can catch it, so the axes are named.
 *
 * Both numbers are always present: a consumer reads the axis it reserves on
 * and gets an honest zero from the other dock, instead of having to know which
 * dock is up.
 */
export interface DrawerCover {
  /** Pixels covered along the bottom edge. Non-zero only when docked bottom. */
  bottom: number;
  /** Pixels covered along the right edge. Non-zero only when docked right. */
  right: number;
}

const NO_COVER: DrawerCover = { bottom: 0, right: 0 };

/** The accessible name of the drawer landmark. See shellContract.ts. */
export const RESULTS_DRAWER_NAME = "Results";

const HEIGHT_ORDER: readonly DrawerHeight[] = ["peek", "half", "full"];

/* ── Dragged height (bottom dock only) ──────────────────────────────────
 * The numbers the drag is clamped against, and where each comes from. */

/** localStorage key, same namespace as the other panels' persisted sizes. */
const DRAG_HEIGHT_KEY = "tau.resultsDrawer.height";
/** The head row's own height (`.results-drawer-head { height: 34px }`). The
 *  floor is "the readout stays whole": lamp, tabs and the size control have to
 *  remain reachable, or dragging down produces a drawer with no way back. */
const MIN_DRAG_HEIGHT = 34;
/** The same reserve `.results-drawer--full` keeps - a drawer that covers its
 *  own subject is a page. Kept as one number so the ceiling of a drag and the
 *  ceiling of the `full` class cannot drift apart. */
const CANVAS_RESERVE = 180;
/** Only reached before first layout (and in JSDOM, where every clientHeight is
 *  0). Clamping to `MIN` against an unmeasured host would snap the drawer shut
 *  on mount, so an unknown host means "don't clamp from above yet". */
const UNMEASURED_MAX = 4000;
/** Only used if a stored height exists but the live one cannot be measured. */
const DEFAULT_DRAG_HEIGHT = 240;
/** The handle's accessible name. Distinct from the cycle button's "Resize
 *  results (half)" so the two are separately addressable to a screen reader
 *  and to `getByRole`. */
const DRAG_HANDLE_LABEL = "Resize results drawer height";

/* A tab and its panel point at each other by id. Both derived from the one
 * `useId`, because `aria-controls` must resolve to an element that exists -
 * a single shared id broke that the moment the body it named stopped being
 * rendered. */
const tabId = (base: string, tab: DrawerTab) => `${base}-tab-${tab}`;
const bodyId = (base: string, tab: DrawerTab) => `${base}-panel-${tab}`;

interface TabSpec {
  value: DrawerTab;
  label: string;
  /** Rendered when the tab is active. `null` means the tab is not offered. */
  content: ReactNode;
  /** Small count shown against the label, e.g. an issue count. */
  badge?: { text: string; tone: "error" | "warning" | "neutral" } | null;
}

export interface ResultsDrawerProps {
  /** Run lamp state, shared with the toolbar's transport indicator. */
  status: "idle" | "running" | "complete" | "error";
  /** One line of run facts, e.g. "30 ms · 3001 samples". Peek reads this. */
  statusLine?: string;
  /** Shown while a run is in flight, so Stop is reachable from the results. */
  onStop?: () => void;
  waveforms?: ReactNode;
  measurements?: ReactNode;
  errors?: ReactNode;
  errorBadge?: TabSpec["badge"];
  /**
   * What the current mode wants the drawer to be showing, and how big.
   *
   * Not `initial*`: the drawer keeps its own tab and height, but entering the
   * simulator has to put the waveforms in front of you. Treating these as
   * mount-only defaults left the drawer collapsed on Errors after a mode
   * switch, because the state had already been initialised by the schematic.
   * They only change when the mode does, so they never fight a user who has
   * resized or switched tabs within a mode.
   */
  preferredTab?: DrawerTab;
  preferredHeight?: DrawerHeight;
  /**
   * Which badge changes are worth interrupting the reader for (P3-14).
   *
   * The auto-raise below was written for import warnings, which arrive once.
   * Since the Errors surface also counts LIVE document diagnostics, the badge
   * now changes on almost every edit — placing a part makes floating-pin rows
   * appear and wiring it makes them go — and raising a peeked drawer each time
   * would fight anyone who deliberately collapsed it.
   *
   * So the raise is keyed on this instead: the caller passes the part of the
   * count that came from a run or an import. Omitting it falls back to the
   * whole badge, which is exactly today's behaviour for every other caller.
   */
  badgeRaiseKey?: string | null;
  /**
   * Which edge to dock to. `bottom` is the default deliberately: it is the
   * only shape the schematic ever uses and the fallback the simulator falls
   * back to, so a caller that says nothing gets today's drawer exactly.
   */
  orientation?: DrawerOrientation;
  /** Bumping this raises a collapsed drawer, e.g. when a run finishes. */
  raiseSignal?: unknown;
  /**
   * Bumping this collapses an open drawer back to its peek strip.
   *
   * The mirror of `raiseSignal`, added for the rail's `!` diagnostics toggle
   * (PDF-6 item 6): "if clicked again it should hide it" needs a way to put the
   * drawer away, and the same signal-not-state shape is what lets the drawer go
   * on owning its own height while the user drags it.
   *
   * It collapses rather than unmounting, and it does not care whether the
   * reader had dragged the drawer to a size of their own - an explicit "hide
   * this" is an instruction, not a heuristic, which is why it does not consult
   * `draggedRef` the way the raise does.
   */
  collapseSignal?: unknown;
  /**
   * Reports how many pixels of canvas the drawer is covering, per axis.
   *
   * Docked bottom the drawer floats rather than squeezing, so nothing in the
   * layout knows its height - and the canvas's zoom-to-fit measured the whole
   * element and centred in it, which put half the circuit behind the drawer
   * the moment the simulator opened. Measured rather than derived from the
   * height token, because "46%" is only a number the stylesheet knows.
   *
   * Docked right the drawer squeezes: the browser's own layout shrinks the
   * canvas element, so the fit needs no reservation at all and `right` exists
   * for the surfaces that are NOT in that flex row - the `position: fixed`
   * selection inspector, which would otherwise place itself under the pane.
   *
   * **This callback's identity is load-bearing.** The measuring effect is
   * keyed on it and its cleanup reports zero, so a fresh function per render
   * republishes a zero cover on every single commit. Pass a stable
   * `useCallback`, and have it compare by value before setting state.
   */
  onCoverChange?: (cover: DrawerCover) => void;
}

const STATUS_TEXT: Record<ResultsDrawerProps["status"], string> = {
  idle: "No analysis yet",
  running: "Running",
  complete: "Complete",
  error: "Error",
};

export function ResultsDrawer({
  status,
  statusLine,
  onStop,
  waveforms = null,
  measurements = null,
  errors = null,
  errorBadge = null,
  preferredTab = "waveforms",
  preferredHeight = "half",
  badgeRaiseKey,
  orientation = "bottom",
  raiseSignal,
  collapseSignal,
  onCoverChange,
}: ResultsDrawerProps) {
  const panelId = useId();
  const rootRef = useRef<HTMLElement | null>(null);
  const [height, setHeight] = useState<DrawerHeight>(preferredHeight);
  const [tab, setTab] = useState<DrawerTab>(preferredTab);

  const specs: TabSpec[] = [
    { value: "waveforms", label: "Waveforms", content: waveforms },
    { value: "measurements", label: "Measurements", content: measurements },
    { value: "errors", label: "Errors", content: errors, badge: errorBadge },
  ];
  const offered = specs.filter((spec) => spec.content !== null);
  /**
   * One surface is a section, not a chooser (P3-14).
   *
   * A tab strip whose only tab is already selected asks a question with one
   * answer: it reads as a broken feature, and a `role="tabpanel"` with no
   * sibling tab to switch to is invalid ARIA anyway. The schematic's dock is
   * exactly this case now that Measurements is simulator-only, and the report's
   * ask is "just having an errors section". The badge stays on the heading —
   * it is the whole readout at peek, so it has to survive the demotion.
   */
  const single = offered.length === 1 ? offered[0] : null;
  // Never leave the drawer pointing at a tab that is not offered any more -
  // switching to the schematic drops Waveforms, and a stale `tab` would render
  // an empty body under a tab strip that no longer contains it.
  const active = offered.find((spec) => spec.value === tab) ?? offered[0] ?? null;

  const dockedRight = orientation === "right";

  /* ── The dragged height ───────────────────────────────────────────────
   * `dragged` is what decides whether the pixel height is on screen at all:
   * false means the peek/half/full class owns the height, which is the resting
   * state and the only state the stylesheet's percentages work in. It starts
   * true only when a previous session left a size behind. */
  const [dragged, setDragged] = useState(() => hasStoredPanelWidth(DRAG_HEIGHT_KEY));
  // How tall the host is, so the ceiling can leave CANVAS_RESERVE of circuit.
  // Docked bottom the drawer is `position: absolute; inset: 0 0 0`, so its
  // offsetParent IS the box the percentages resolve against; `parentElement`
  // is the fallback for engines (JSDOM) that never compute an offsetParent.
  const [hostHeight, setHostHeight] = useState(0);
  useEffect(() => {
    if (dockedRight) return;
    const measure = () => {
      const el = rootRef.current;
      const host = (el?.offsetParent as HTMLElement | null) ?? el?.parentElement ?? null;
      setHostHeight(host?.clientHeight ?? 0);
    };
    measure();
    // A window resize can shrink the host under a persisted height; the hook's
    // own re-clamp effect fixes the value once the new maximum arrives here.
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [dockedRight]);
  const maxDragHeight = hostHeight > 0
    ? Math.max(MIN_DRAG_HEIGHT, hostHeight - CANVAS_RESERVE)
    : UNMEASURED_MAX;
  const resize = usePanelWidth({
    storageKey: DRAG_HEIGHT_KEY,
    defaultWidth: DEFAULT_DRAG_HEIGHT,
    minWidth: MIN_DRAG_HEIGHT,
    maxWidth: maxDragHeight,
    edge: "top",
  });

  /**
   * Hand the axis back to the three discrete heights.
   *
   * Every discrete setter goes through this, which is the "last gesture wins"
   * rule from the note at the top of the file. The stored pixels go too:
   * leaving them would have the next reload contradict what the user just did.
   */
  const applyDiscreteHeight = useCallback(
    (next: DrawerHeight | ((current: DrawerHeight) => DrawerHeight)) => {
      setHeight(next);
      setDragged(false);
      clearPanelWidth(DRAG_HEIGHT_KEY);
    },
    [],
  );

  /**
   * A drag starts from the height that is ON SCREEN, not from the hook's
   * remembered one: at rest that height is a percentage only the layout knows,
   * so it has to be measured, and it has to be written before the pointer
   * handler reads it (`usePanelWidth.setWidth` updates its ref synchronously,
   * which is why this ordering works inside one handler).
   */
  /** The drawer's height as laid out, for the handle's `aria-valuenow` while
   *  the class still owns the height. Separate from the cover observer above
   *  because that one only exists when a caller asked to be told. */
  const [liveHeight, setLiveHeight] = useState(0);
  useEffect(() => {
    const el = rootRef.current;
    if (dockedRight || !el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setLiveHeight(el.getBoundingClientRect().height));
    observer.observe(el);
    return () => observer.disconnect();
  }, [dockedRight]);

  /** The pixel height is on screen only in the bottom dock: docked right the
   *  drawer is a full-height column and an inline height would fight it. */
  const showDragHeight = dragged && !dockedRight;
  const draggingHeight = resize.dragging && !dockedRight;

  const seedFromScreen = useCallback(() => {
    if (dragged) return;
    const measured = rootRef.current?.getBoundingClientRect().height ?? 0;
    if (measured > 0) resize.setWidth(measured);
    setDragged(true);
  }, [dragged, resize]);

  // The mode changed: adopt what it wants. The mount run is deliberately NOT
  // treated as a mode change - it fires once for every drawer, and routing it
  // through `applyDiscreteHeight` would erase the persisted drag height of
  // every user who ever dragged, on every launch.
  const modeChangedRef = useRef(false);
  useEffect(() => {
    setTab(preferredTab);
    if (!modeChangedRef.current) {
      modeChangedRef.current = true;
      setHeight(preferredHeight);
      return;
    }
    applyDiscreteHeight(preferredHeight);
  }, [preferredTab, preferredHeight, applyDiscreteHeight]);

  // A finished run raises a collapsed drawer, because the result is the answer
  // to the thing the user just asked for. It does not force a height on
  // someone who has deliberately gone `full`.
  //
  // The first firing is skipped on purpose. An effect keyed on a value runs
  // once at mount, which would have raised the drawer the moment the app
  // opened - before anything had run - and quietly overridden the `peek` the
  // schematic asks for.
  //
  // A drawer the user has DRAGGED is never touched by this: it is open at a
  // size they chose, so there is nothing to raise, and snapping it to `half`
  // would be the raise deciding it knows better.
  const seenRaiseRef = useRef(raiseSignal);
  useEffect(() => {
    if (Object.is(seenRaiseRef.current, raiseSignal)) return;
    seenRaiseRef.current = raiseSignal;
    if (heightRef.current !== "peek" || draggedRef.current) return;
    applyDiscreteHeight("half");
  }, [raiseSignal, applyDiscreteHeight]);

  // The hide half of the same contract. Skips its first firing for the reason
  // the raise does: an effect keyed on a value runs at mount, and collapsing
  // there would override the height the caller asked for.
  const seenCollapseRef = useRef(collapseSignal);
  useEffect(() => {
    if (Object.is(seenCollapseRef.current, collapseSignal)) return;
    seenCollapseRef.current = collapseSignal;
    if (heightRef.current === "peek") return;
    applyDiscreteHeight("peek");
  }, [collapseSignal, applyDiscreteHeight]);

  /**
   * A new issue never stays hidden behind a collapsed drawer.
   *
   * This was BottomPanel's own rule and it has to survive the merge: an ASC or
   * netlist import can produce per-part warnings that are the only signal
   * anything was dropped, and "Opened with 2 warnings" with no way to read
   * them is a dead end. A collapsed drawer opens onto Errors; an already-open
   * one only rises, because yanking someone off their waveforms mid-run to
   * show a warning they can already see counted on the tab is worse than the
   * warning.
   */
  const badgeKey = badgeRaiseKey !== undefined
    ? badgeRaiseKey
    : errorBadge ? `${errorBadge.tone}:${errorBadge.text}` : null;
  // Seeded null, not with the current badge, so a drawer that MOUNTS with
  // issues counts them as new. The case is real: dropping a netlist into an
  // empty workspace opens the first schematic and produces the warnings in
  // the same commit, so the drawer's very first render already has them.
  const seenBadgeRef = useRef<string | null>(null);
  // Synced in an effect, not assigned in the render body. A render React
  // discards - StrictMode's double invoke, or a concurrent render that is
  // interrupted - must not be able to write the value the badge effect below
  // reads. Declared first so it is already current when that effect runs on
  // the same commit.
  const heightRef = useRef(height);
  // Same rule for the dragged flag, and for the same reason: both auto-raises
  // read it out of an effect on a later commit, so it must be the committed
  // value and not one a discarded render wrote.
  const draggedRef = useRef(dragged);
  useEffect(() => {
    heightRef.current = height;
    draggedRef.current = dragged;
  }, [height, dragged]);
  useEffect(() => {
    if (badgeKey === seenBadgeRef.current) return;
    seenBadgeRef.current = badgeKey;
    // A dragged drawer is already open, so the issue is not hidden - which is
    // the only thing this raise exists to prevent.
    if (!badgeKey || heightRef.current !== "peek" || draggedRef.current) return;
    setTab("errors");
    applyDiscreteHeight("half");
  }, [badgeKey, applyDiscreteHeight]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !onCoverChange) return;
    const report = () => {
      const rect = el.getBoundingClientRect();
      // Only the axis this dock actually eats into. See `DrawerCover`.
      onCoverChange(
        orientation === "right"
          ? { bottom: 0, right: rect.width }
          : { bottom: rect.height, right: 0 },
      );
    };
    report();
    // The observer is optional; the cleanup is not. Returning early when
    // ResizeObserver is missing skipped the `onCoverChange(0)` below, so an
    // unmounted drawer left the canvas reserving a band for a surface that is
    // no longer on screen.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(report);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      onCoverChange(NO_COVER);
    };
    // `orientation` belongs here: changing dock changes which axis is being
    // reported, and the cleanup's zero is what retracts the stale axis.
  }, [onCoverChange, orientation]);

  const containsFocus = useCallback(
    () => Boolean(rootRef.current && rootRef.current.contains(document.activeElement)),
    [],
  );

  /** Docked right there is no collapsed state; see the heights note above.
   *  A dragged height beats the word: dragging a peeked drawer open is the
   *  gesture, and keying `collapsed` off the stale `peek` would have grown a
   *  200px box with its body still out of the accessibility tree. */
  const collapsed = !dockedRight && height === "peek" && !dragged;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Escape belongs to whatever holds focus. Outside the drawer it still
      // means "cancel the current tool" on the canvas.
      if (!containsFocus() || dockedRight || collapsed) return;
      event.preventDefault();
      applyDiscreteHeight("peek");
      // Peek hides the body, so focus has to leave first or it sits on a
      // `display: none` node and the browser drops it to <body>.
      rootRef.current?.querySelector<HTMLElement>(".results-drawer-size")?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [applyDiscreteHeight, containsFocus, dockedRight, collapsed]);

  const cycleHeight = () => {
    applyDiscreteHeight((current) => {
      const next = HEIGHT_ORDER[(HEIGHT_ORDER.indexOf(current) + 1) % HEIGHT_ORDER.length];
      return next;
    });
  };

  return (
    <aside
      ref={rootRef}
      // The height modifier is withheld docked right on purpose: those classes
      // ARE the three heights (`height: 46%`, `calc(100% - 180px)`), and the
      // right dock is a full-height column. Emitting one would have the
      // stylesheet quietly contradict the "no collapsed state" rule above.
      className={`results-drawer results-drawer--dock-${orientation}${
        dockedRight ? "" : ` results-drawer--${height}`
      }${draggingHeight ? " results-drawer--dragging-height" : ""}`}
      // The inline height is what makes the drag continuous: it beats the
      // percentage class by specificity, and the class is still emitted so
      // everything else keyed on peek/half/full keeps reading the same word.
      // The `--dragging-height` modifier drops the height transition, or the
      // animation would make the edge lag the pointer.
      style={showDragHeight ? { height: `${resize.width}px` } : undefined}
      aria-label={RESULTS_DRAWER_NAME}
      aria-busy={status === "running"}
    >
      {/* Docked right the height is not negotiable (the column is as tall as
          the workspace) and the width divider App renders owns the axis that
          is - so no handle here, for the same reason the size button is gone. */}
      {!dockedRight && (
        <PanelResizeHandle
          edge="top"
          label={DRAG_HANDLE_LABEL}
          // At rest the height is a percentage, so `aria-valuenow` reports the
          // MEASURED height rather than the hook's unused default - a splitter
          // that announces a number the panel does not have is a lie a screen
          // reader has no way to check.
          width={showDragHeight ? resize.width : Math.round(liveHeight) || resize.width}
          minWidth={MIN_DRAG_HEIGHT}
          maxWidth={maxDragHeight}
          dragging={resize.dragging}
          onPointerDown={(event) => {
            // Seed only for the button that actually starts a drag. The hook
            // bails on any other, and seeding first regardless made a
            // right-click on the edge switch the drawer to a pixel height with
            // no gesture behind it - visible on a peeked drawer, whose body
            // then opened, because the pixel height suppresses `collapsed`.
            if (event.button !== 0) return;
            seedFromScreen();
            resize.onPointerDown(event);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") seedFromScreen();
            resize.onKeyDown(event);
          }}
        />
      )}

      <div className="results-drawer-head">
        <span
          className={`results-drawer-status results-drawer-status--${status}`}
          role="status"
          aria-live="polite"
        >
          <span className="results-drawer-lamp" aria-hidden="true" />
          <span className="results-drawer-state">{STATUS_TEXT[status]}</span>
          {statusLine && <span className="results-drawer-info mono-num">{statusLine}</span>}
        </span>

        {single && (
          <h2 className="results-drawer-section">
            {single.label}
            {single.badge && (
              <span className={`results-drawer-badge results-drawer-badge--${single.badge.tone}`}>
                {single.badge.text}
              </span>
            )}
          </h2>
        )}

        {offered.length > 1 && (
          <Tabs
            className="results-drawer-tabs-root"
            value={active?.value}
            onValueChange={(next) => {
              setTab(next as DrawerTab);
              // Picking a tab is a request to read it. The strip is legible at
              // peek - that is the point of peek - so it was possible to click
              // Errors on the strength of its badge and have nothing happen
              // but the underline move. A dragged drawer is already open, so
              // there is nothing to raise and its size is left alone.
              if (height === "peek" && !dragged) applyDiscreteHeight("half");
            }}
          >
            <TabsList aria-label="Results" className="results-drawer-tabs">
              {offered.map((spec) => (
                <TabsTrigger
                  key={spec.value}
                  className="results-drawer-tab"
                  value={spec.value}
                  id={tabId(panelId, spec.value)}
                  aria-controls={bodyId(panelId, spec.value)}
                >
                  {spec.label}
                  {spec.badge && (
                    <span className={`results-drawer-badge results-drawer-badge--${spec.badge.tone}`}>
                      {spec.badge.text}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        <div className="results-drawer-actions">
          {onStop && status === "running" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={onStop}
                  aria-label="Stop simulation"
                >
                  <Square size={13} strokeWidth={1.8} aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop the running analysis</TooltipContent>
            </Tooltip>
          )}
          {/* Withheld docked right. The three heights are a bottom-dock idea
              and the divider owns the axis that is still negotiable there;
              see the heights note at the top of this file. */}
          {!dockedRight && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                className="results-drawer-size text-muted-foreground hover:text-foreground"
                onClick={cycleHeight}
                aria-expanded={!collapsed}
                aria-controls={active ? bodyId(panelId, active.value) : undefined}
                aria-label={`Resize results (${height})`}
              >
                {collapsed
                  ? <ChevronUp size={13} strokeWidth={1.8} aria-hidden="true" />
                  : <ChevronDown size={13} strokeWidth={1.8} aria-hidden="true" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {collapsed ? "Open results" : height === "half" ? "Fill the window" : "Collapse results"}
            </TooltipContent>
          </Tooltip>
          )}
        </div>
      </div>

      {/* Every offered tab renders; `hidden` decides which one is on screen.
          `hidden` computes to `display: none`, which takes the subtree out of
          the accessibility tree outright - so a collapsed drawer is still
          invisible to `getByRole` and untabbable, which is the actual rule the
          note at the top of App.shellContract.test.tsx sets. What it does NOT
          do is destroy the panel's state; see "Why every tab stays mounted"
          above for why that difference is the whole reason. */}
      {offered.map((spec) => (
        <div
          key={spec.value}
          className="results-drawer-body"
          id={bodyId(panelId, spec.value)}
          // A lone surface has no tab, so it must not claim to be a tabpanel:
          // `role="tabpanel"` with no `tablist` is invalid ARIA, and its
          // `aria-labelledby` would name an element that is not rendered. The
          // class stays either way - it is what every reader of this surface
          // keys off, in tests and in the acceptance harness alike.
          {...(single
            ? {}
            : { role: "tabpanel", "aria-labelledby": tabId(panelId, spec.value) })}
          hidden={collapsed || spec.value !== active?.value}
        >
          {spec.content}
        </div>
      ))}
    </aside>
  );
}

export default ResultsDrawer;
