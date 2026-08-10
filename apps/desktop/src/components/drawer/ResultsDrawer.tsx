import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Square } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
 * They are one drawer now: full width, over the canvas rather than beside it,
 * three heights, three tabs. The width is the point. A waveform is a wide
 * thing; giving it 1400px instead of 400px is the difference an engineer sees
 * first, and it is what the 1:1 plot geometry (see the note at the top of
 * SimulationPanel.tsx) was a prerequisite for.
 *
 * ## Chrome
 *
 * One header row: run state, tabs, size. That is deliberately less than the
 * plotter used to carry - an "Analysis / Transient scope" kicker-and-title
 * stacked above a tab strip that already says TRAN is ink that stops carrying
 * information after the first read, which is the antipattern the design
 * language exists to prevent. The drawer names itself once, in its landmark.
 *
 * ## Heights
 *
 * `peek` is the header alone: still a readout (the lamp, the sample count and
 * the issue count are all there), which is why there is no separate restore
 * affordance to build. `half` is the working size. `full` deliberately stops
 * short of the top so the circuit never disappears entirely - a drawer that
 * covers its own subject is a page, not a drawer.
 *
 * ## Focus and Escape
 *
 * Escape collapses to `peek` ONLY when focus is inside the drawer. Canvas
 * Escape has to keep meaning "cancel the current tool", and a document-level
 * listener that does not check would silently take that over. When it does
 * collapse it hands focus to the size control first, so a keyboard user is
 * never left standing on a control that just went `display: none`.
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

/** The accessible name of the drawer landmark. See shellContract.ts. */
export const RESULTS_DRAWER_NAME = "Results";

const HEIGHT_ORDER: readonly DrawerHeight[] = ["peek", "half", "full"];

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
  /** Bumping this raises a collapsed drawer, e.g. when a run finishes. */
  raiseSignal?: unknown;
  /**
   * Reports how many pixels of canvas the drawer is covering.
   *
   * The drawer floats rather than squeezing, so nothing in the layout knows
   * its height - and the canvas's zoom-to-fit measured the whole element and
   * centred in it, which put half the circuit behind the drawer the moment
   * the simulator opened. Measured rather than derived from the height token,
   * because "46%" is only a number the stylesheet knows.
   */
  onCoverChange?: (pixels: number) => void;
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
  raiseSignal,
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
  // Never leave the drawer pointing at a tab that is not offered any more -
  // switching to the schematic drops Waveforms, and a stale `tab` would render
  // an empty body under a tab strip that no longer contains it.
  const active = offered.find((spec) => spec.value === tab) ?? offered[0] ?? null;

  // The mode changed: adopt what it wants.
  useEffect(() => {
    setTab(preferredTab);
    setHeight(preferredHeight);
  }, [preferredTab, preferredHeight]);

  // A finished run raises a collapsed drawer, because the result is the answer
  // to the thing the user just asked for. It does not force a height on
  // someone who has deliberately gone `full`.
  //
  // The first firing is skipped on purpose. An effect keyed on a value runs
  // once at mount, which would have raised the drawer the moment the app
  // opened - before anything had run - and quietly overridden the `peek` the
  // schematic asks for.
  const seenRaiseRef = useRef(raiseSignal);
  useEffect(() => {
    if (Object.is(seenRaiseRef.current, raiseSignal)) return;
    seenRaiseRef.current = raiseSignal;
    setHeight((current) => (current === "peek" ? "half" : current));
  }, [raiseSignal]);

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
  const badgeKey = errorBadge ? `${errorBadge.tone}:${errorBadge.text}` : null;
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
  useEffect(() => {
    heightRef.current = height;
  }, [height]);
  useEffect(() => {
    if (badgeKey === seenBadgeRef.current) return;
    seenBadgeRef.current = badgeKey;
    if (!badgeKey || heightRef.current !== "peek") return;
    setTab("errors");
    setHeight("half");
  }, [badgeKey]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !onCoverChange) return;
    const report = () => onCoverChange(el.getBoundingClientRect().height);
    report();
    // The observer is optional; the cleanup is not. Returning early when
    // ResizeObserver is missing skipped the `onCoverChange(0)` below, so an
    // unmounted drawer left the canvas reserving a band for a surface that is
    // no longer on screen.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(report);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      onCoverChange(0);
    };
  }, [onCoverChange]);

  const containsFocus = useCallback(
    () => Boolean(rootRef.current && rootRef.current.contains(document.activeElement)),
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Escape belongs to whatever holds focus. Outside the drawer it still
      // means "cancel the current tool" on the canvas.
      if (!containsFocus() || height === "peek") return;
      event.preventDefault();
      setHeight("peek");
      // Peek hides the body, so focus has to leave first or it sits on a
      // `display: none` node and the browser drops it to <body>.
      rootRef.current?.querySelector<HTMLElement>(".results-drawer-size")?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [containsFocus, height]);

  const cycleHeight = () => {
    setHeight((current) => {
      const next = HEIGHT_ORDER[(HEIGHT_ORDER.indexOf(current) + 1) % HEIGHT_ORDER.length];
      return next;
    });
  };

  const collapsed = height === "peek";

  return (
    <aside
      ref={rootRef}
      className={`results-drawer results-drawer--${height}`}
      aria-label={RESULTS_DRAWER_NAME}
      aria-busy={status === "running"}
    >
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

        {offered.length > 0 && (
          <Tabs
            className="results-drawer-tabs-root"
            value={active?.value}
            onValueChange={(next) => {
              setTab(next as DrawerTab);
              // Picking a tab is a request to read it. The strip is legible at
              // peek - that is the point of peek - so it was possible to click
              // Errors on the strength of its badge and have nothing happen
              // but the underline move.
              setHeight((current) => (current === "peek" ? "half" : current));
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
          role="tabpanel"
          aria-labelledby={tabId(panelId, spec.value)}
          hidden={collapsed || spec.value !== active?.value}
        >
          {spec.content}
        </div>
      ))}
    </aside>
  );
}

export default ResultsDrawer;
