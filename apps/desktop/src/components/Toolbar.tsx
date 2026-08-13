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
  assistantOpen: boolean;
  projectOpen?: boolean;
  schematicOpen?: boolean;
  onModeChange: (mode: "schematic" | "simulator") => void;
  onRun: () => void;
  onToggleAssistant: () => void;
}

type LampState = "idle" | "running" | "ok" | "error" | "warn";

const ICON = { size: 13, strokeWidth: 1.6 } as const;
const TITLEBAR_GESTURE_SURFACE = ".titlebar-drag-region";

export function isTitlebarControlTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  if (element.closest(TITLEBAR_GESTURE_SURFACE)) return false;
  return Boolean(element.closest("button, a, input, select, textarea, [role=button], .mode-toggle"));
}

export function Toolbar({ mode, result, runState, isRunning, liveRunning = false, title, assistantOpen, projectOpen = true, schematicOpen = true, onModeChange, onRun, onToggleAssistant }: ToolbarProps) {
  const titlebarGestureRef = useRef<ReturnType<typeof createTitlebarGestureMachine> | null>(null);
  const titlebarGesture = titlebarGestureRef.current ?? (titlebarGestureRef.current = createTitlebarGestureMachine());
  const isSimulator = mode === "simulator";
  const runHasError = !isRunning && (runState === "error" || result?.ok === false);
  const runIsAcceptable = !isRunning && runState === "complete" && result?.ok === true;
  // The invitation is deliberately quiet and shared: when the primary Run
  // action is truly idle, Ask Bode may make the same gentle pass; once either
  // action has state, the semantic state wins and the sheen disappears.
  const shouldInviteAction = !isRunning
    && !liveRunning
    && !runHasError
    && !runIsAcceptable
    && schematicOpen
    && projectOpen
    && !assistantOpen;

  // The status lamp is the single source of truth for run state - no cancel
  // path exists (nothing in the codebase can interrupt an in-flight ngspice
  // call), so "running" only ever resolves to idle/ok/error on its own; there
  // is deliberately no fake "stop" affordance here.
  const lampState: LampState = isRunning
    ? "running"
    : !isSimulator
      ? "idle"
      : result?.ok
        ? "ok"
        : runState === "error"
          ? "error"
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
      : result?.ok
        ? `${result.stats.sampleCount.toLocaleString()} samples`
        : runState === "error"
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
      <div className="titlebar-left" data-tauri-drag-region="false">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">τ</span>
          <span className="brand-name">tau</span>
          <span className="brand-file mono-num">{title}</span>
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
