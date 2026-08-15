import type { AnalysisResult } from "../simulation/linearTransient";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useRef } from "react";
import { Activity, CircuitBoard, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  createTitlebarGestureMachine,
  handleTitlebarDoubleClick,
  startCurrentWindowDragging,
  toggleCurrentWindowMaximize,
} from "./titlebarWindow";

interface ToolbarProps {
  mode: "schematic" | "simulator";
  result: AnalysisResult | null;
  /**
   * The outcome of the analysis the app most recently ran. `result` remains
   * the transient payload for its sample-count detail, while this small common
   * shape lets header decoration represent OP/AC/DC/TF/noise/step too.
   */
  outcome?: ToolbarRunOutcome | null;
  runState: "idle" | "complete" | "error" | "stopped";
  isRunning: boolean;
  /**
   * A live run is energising the circuit, held by the simulator's own transport.
   *
   * A SEPARATE prop, not folded into `isRunning`, and deliberately so. This
   * control is the simulation health lamp: `isRunning` drives its amber state
   * and `Toolbar.test.tsx` pins that exact styling, so widening `isRunning`
   * would make a live run repaint the lamp as if the header had started
   * something. What a live run really means here is narrower — Tau has one
   * ngspice capability and it is leased, so this Run cannot start anything
   * until that run stops. It blocks the button and says why, and touches
   * nothing else.
   */
  liveRunning?: boolean;
  title: string;
  /**
   * The active document has edits that are not on disk.
   *
   * Optional because App still says this by concatenating a bullet onto
   * `title` (`activeDirty ? `${documentTitle} •` : …`). `describeTitlebarDocument`
   * reads that suffix back off, so the header is correct with or without this
   * prop; passing it explicitly is what lets the concatenation retire.
   */
  dirty?: boolean;
  assistantOpen: boolean;
  projectOpen?: boolean;
  schematicOpen?: boolean;
  onModeChange: (mode: "schematic" | "simulator") => void;
  onRun: () => void;
  onToggleAssistant: () => void;
}

type LampState = "idle" | "running" | "ok" | "error" | "warn";

export interface ToolbarRunOutcome {
  ok: boolean;
  message?: string;
  stats?: { sampleCount: number };
}

const ICON = { size: 13, strokeWidth: 1.6 } as const;
const TITLEBAR_GESTURE_SURFACE = ".titlebar-drag-region";

/** The bullet App appends to a dirty document's title today. */
const LEGACY_DIRTY_MARKER = "•";
/**
 * A real file suffix, so the split does not fire on the last dot of a folder
 * name like `v2.1 revision boards` - the header shows a project root as well
 * as a document.
 */
const FILE_EXTENSION = /\.[A-Za-z0-9]{1,8}$/;

export interface TitlebarDocument {
  /** The document's name with no state decoration: what is on disk. */
  name: string;
  stem: string;
  /** The leading dot included, or empty when the title is not a file. */
  extension: string;
  dirty: boolean;
}

/**
 * What the header's top-left corner is actually about: which document this
 * window is.
 *
 * Two things are separated here that used to be one string. The unsaved state
 * arrives concatenated onto the name, which is why the marker used to be a
 * character sharing the file name's truncating text run - a long name silently
 * ellipsised away the one piece of state a user cannot afford to lose, and no
 * screen reader had a name for it. An explicit `dirty` flag wins over the
 * suffix so the caller can stop concatenating without a second change here.
 *
 * The extension is split off the stem because it is the name's unit: set a step
 * down and dimmer (see `styles/pdf6Titlebar.css`), and held outside the
 * ellipsis, so a truncated `USB-C Cable rev…` still says `.asc`.
 */
export function describeTitlebarDocument(title: string, dirty?: boolean): TitlebarDocument {
  const trimmed = title.trim();
  const marked = trimmed.endsWith(LEGACY_DIRTY_MARKER);
  const name = (marked ? trimmed.slice(0, -LEGACY_DIRTY_MARKER.length) : trimmed).trim();
  const suffix = FILE_EXTENSION.exec(name);
  // `index > 0` keeps a dotfile-shaped name whole: `.asc` is the whole name,
  // not an extension with nothing in front of it.
  const extension = suffix && suffix.index > 0 ? suffix[0] : "";
  return {
    name,
    stem: extension ? name.slice(0, -extension.length) : name,
    extension,
    dirty: dirty ?? marked,
  };
}

export function isTitlebarControlTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  if (element.closest(TITLEBAR_GESTURE_SURFACE)) return false;
  return Boolean(element.closest("button, a, input, select, textarea, [role=button], .mode-toggle"));
}

export function Toolbar({ mode, result, outcome = null, runState, isRunning, liveRunning = false, title, dirty, assistantOpen, projectOpen = true, schematicOpen = true, onModeChange, onRun, onToggleAssistant }: ToolbarProps) {
  const doc = describeTitlebarDocument(title, dirty);
  const titlebarGestureRef = useRef<ReturnType<typeof createTitlebarGestureMachine> | null>(null);
  const titlebarGesture = titlebarGestureRef.current ?? (titlebarGestureRef.current = createTitlebarGestureMachine());
  const isSimulator = mode === "simulator";
  // `analysis` is only the transient result. The active outcome is supplied by
  // App from the last authored run, so an OP/AC/DC/TF/noise/step result cannot
  // accidentally fall back to the idle sheen just because transient is null.
  const activeOutcome = outcome ?? result;
  // `runState` is retained for a stopped/no-result transport, but it is not a
  // competing source once a concrete outcome exists. Otherwise a past transient
  // error could paint a later successful AC/OP/etc. run red.
  const runHasError = !isRunning && (activeOutcome ? !activeOutcome.ok : runState === "error");
  const runIsAcceptable = !isRunning && !runHasError && activeOutcome?.ok === true;
  // The invitation is deliberately quiet and shared: when the primary Run
  // action is truly idle, Ask Bode may make the same gentle pass; once either
  // action has state, the semantic state wins and the sheen disappears.
  // Armed: the circuit can be run and nothing has gone wrong yet. This is a
  // statement about the transport, so - unlike the invitation below - it is
  // deliberately NOT cleared by the assistant being open. Opening Bode changes
  // nothing about run readiness, and a status lamp that goes out for an
  // unrelated reason is a lying lamp.
  const runIsArmed = !isRunning && !liveRunning && !runHasError && !runIsAcceptable
    && schematicOpen
    && projectOpen;
  const shouldInviteAction = runIsArmed && !assistantOpen;

  // The status lamp is the single source of truth for run state - no cancel
  // path exists (nothing in the codebase can interrupt an in-flight ngspice
  // call), so "running" only ever resolves to idle/ok/error on its own; there
  // is deliberately no fake "stop" affordance here.
  const lampState: LampState = isRunning
    ? "running"
    : !isSimulator
      ? "idle"
      : runHasError
          ? "error"
          : runIsAcceptable
            ? "ok"
            : runState === "stopped"
            ? "warn"
            : "idle";

  // Quiet by design : the schematic editor shows NO status
  // chatter - "ready · edit mode" told the user nothing. Only genuinely useful
  // simulator state is surfaced, in sentence case, and idle stays blank.
  const statusText = isRunning
    ? "Running…"
    : !isSimulator
      ? ""
      : runIsAcceptable
        ? activeOutcome?.stats
          ? `${activeOutcome.stats.sampleCount.toLocaleString()} samples`
          : "Complete"
        : runHasError
          ? "Error"
          : runState === "stopped"
            ? "Stopped"
    : "";

  const handleTitlebarMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest(TITLEBAR_GESTURE_SURFACE) && event.currentTarget !== event.target) return;
    if (isTitlebarControlTarget(target)) return;

    const action = titlebarGesture.mouseDown(Date.now(), event.detail, {
      x: event.clientX,
      y: event.clientY,
    });
    if (action === "toggle") {
      void handleTitlebarDoubleClick(event, toggleCurrentWindowMaximize);
      return;
    }
    if (action !== "arm") return;

    /*
     * Armed, not dragging. The native drag only begins once the pointer has
     * actually travelled, so a stationary press remains a click and the second
     * half of a double-click still reaches this window instead of being eaten
     * by the macOS drag loop.
     *
     * The listeners live on `window` because once the drag starts the pointer
     * belongs to the window server, and the element under it stops mattering.
     */
    event.preventDefault();
    const onMove = (move: MouseEvent) => {
      if (titlebarGesture.pointerMove({ x: move.clientX, y: move.clientY }) !== "drag") return;
      release();
      void startCurrentWindowDragging();
    };
    const release = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    function onUp() {
      release();
      titlebarGesture.pointerUp();
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleTitlebarDoubleClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(TITLEBAR_GESTURE_SURFACE) && event.currentTarget !== event.target) return;
    if (isTitlebarControlTarget(target)) return;
    const action = titlebarGesture.doubleClick(Date.now());
    if (action === "ignore") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    void handleTitlebarDoubleClick(event, toggleCurrentWindowMaximize);
  };

  const handleTitlebarClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(TITLEBAR_GESTURE_SURFACE) && event.currentTarget !== event.target) return;
    if (isTitlebarControlTarget(target)) return;
    const action = titlebarGesture.click(Date.now(), event.detail);
    if (action === "ignore") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (action === "toggle") {
      void handleTitlebarDoubleClick(event, toggleCurrentWindowMaximize);
    }
  };

  return (
    /*
     * The dedicated `.titlebar-drag-region` below is the drag surface because
     * the native title bar is gone. `titleBarStyle: "Overlay"` in tauri.conf.json
     * hides the bar and floats the traffic lights over this header. Dragging is
     * started through Tauri's explicit startDragging API so the same surface
     * can deterministically reserve a second mouse-down for zoom/restore.
     *
     * It stays a sibling of the controls: only this surface calls the native
     * window API, so Run and the mode toggle remain ordinary controls.
     */
    <header
      className="toolbar"
      onMouseDownCapture={handleTitlebarMouseDown}
      onDoubleClickCapture={handleTitlebarDoubleClickCapture}
      onClickCapture={handleTitlebarClickCapture}
    >
      {/*
       * Keep this element an empty surface so Run, mode, and Bode
       * remain ordinary interactive controls (including the traffic-light
       * inset). The explicit API call preserves the native drag contract.
       */}
      <button
        type="button"
        className="titlebar-drag-region"
        tabIndex={-1}
        aria-label="Window drag area; double-click to maximize or restore"
        title="Double-click to maximize or restore"
        onMouseDown={handleTitlebarMouseDown}
        onDoubleClick={handleTitlebarDoubleClickCapture}
        onClick={handleTitlebarClickCapture}
      />
      {/*
       * The document, not the app.
       *
       * This corner is the window's document identity. The app said its own
       * name three times here - a τ logomark, a `tau` wordmark, and the Dock
       * icon behind them - while the file that the window is actually about was
       * the smallest, faintest thing in the cluster, with its unsaved state
       * riding along as a bullet inside its own text. The wordmark is gone
       * (main.tsx already deleted the native strip for saying `Tau` twice), one
       * mark stays as the cluster's left anchor because `hiddenTitle` leaves no
       * proxy icon, and the state is one labelled element that cannot be
       * truncated. Type, ink, and spacing all live in styles/pdf6Titlebar.css.
       */}
      <div className="titlebar-left" data-tauri-drag-region="false">
        <div className="brand">
          <span className="pdf6-doc-mark" aria-hidden="true">τ</span>
          {/* `.brand-file` is kept as a hook: App.workspace.test.tsx reads the
              document name off this exact class. `title` is the only way back
              to a name the header had to truncate. */}
          <span
            className="brand-file pdf6-doc-name"
            data-doc={doc.extension ? "file" : "context"}
            title={doc.name}
          >
            <span className="pdf6-doc-stem">{doc.stem}</span>
            {doc.extension ? <span className="pdf6-doc-ext">{doc.extension}</span> : null}
          </span>
          {doc.dirty ? (
            /* The same 6px dot the tab strip uses for the same state
               (`.tab-dirty-indicator`), so one state has one appearance. It is
               an image with a name rather than punctuation, because "there is a
               bullet after the file name" is not something a screen reader can
               be expected to interpret. */
            <span
              className="pdf6-doc-state"
              role="img"
              aria-label="Unsaved changes"
              title="Unsaved changes. Press ⌘S to save."
            />
          ) : null}
        </div>
      </div>

      <div className="mode-toggle" aria-label="Editor mode" data-tauri-drag-region="false">
        <button
          className={`mode-btn${mode === "schematic" ? " active" : ""}`}
          onClick={() => onModeChange("schematic")}
          aria-pressed={mode === "schematic"}
          // Explicit, not inherited from the text node. The redesign drops
          // these labels to icons at the 900px floor, and without an
          // aria-label that would silently delete the accessible name these
          // buttons are found by in thirteen places across three test files.
          aria-label="Schematic"
          disabled={!projectOpen}
        >
          <CircuitBoard {...ICON} aria-hidden="true" />
          Schematic
        </button>
        <button
          className={`mode-btn${mode === "simulator" ? " active" : ""}`}
          onClick={() => onModeChange("simulator")}
          aria-pressed={mode === "simulator"}
          aria-label="Simulator"
          disabled={!schematicOpen}
        >
          <Activity {...ICON} aria-hidden="true" />
          Simulator
        </button>
      </div>

      <div className="titlebar-right" data-tauri-drag-region="false">
        <div className="titlebar-actions" role="group" aria-label="Circuit actions">
          {statusText && (
            <span className={cn("status-lamp", `status-lamp--${lampState}`)}>
              <i className="status-lamp-dot" aria-hidden="true" />
              <span className="status-lamp-text mono-num">{statusText}</span>
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              {/* The Run control is also the simulation health indicator: neutral
                  before validation, amber while running, green after a clean run,
                  and red after a failed run. */}
              <Button
                variant="outline"
                size="sm"
                disabled={isRunning || liveRunning || !schematicOpen}
                className={cn(
                  "gap-1.5 bg-secondary hover:bg-accent",
                  // `--ready` inks Run green: it is the transport's status lamp,
                  // and green is what "armed, nothing wrong" reads as on a
                  // bench. The two conditions are split on purpose - the lamp
                  // follows readiness, the shimmering fill follows the shared
                  // invitation - and `--ready` alone greens only the dot,
                  // because the fill rule needs both classes. It adds no
                  // keyframe of its own, so Run and Ask Bode stay in phase.
                  runIsArmed && "run-button--ready",
                  shouldInviteAction && "pdf4-action-sheen pdf4-action-sheen--run",
                  runHasError && "run-button--error",
                  runIsAcceptable && "run-button--ok",
                  isRunning && "run-button--running",
                )}
                onClick={onRun}
                aria-label="Run simulation"
              >
                <i className={cn("run-lamp-dot", isRunning && "run-lamp-dot--running")} aria-hidden="true" />
                Run
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isRunning
                ? "Simulation running…"
                : liveRunning
                  ? "A live run has this circuit energised. Stop it in the simulator first."
                  : "Run simulation and switch to simulator"}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                className={cn(
                  "assistant-toolbar-button",
                  shouldInviteAction && "pdf4-action-sheen pdf4-action-sheen--bode",
                  assistantOpen && "assistant-toolbar-button--active",
                )}
                aria-label={assistantOpen ? "Close Bode" : "Open Bode"}
                aria-pressed={assistantOpen}
                disabled={!projectOpen}
                onClick={onToggleAssistant}
              >
                <MessageSquare size={14} strokeWidth={1.6} aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{assistantOpen ? "Close Bode" : "Ask Bode"}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </header>
  );
}
