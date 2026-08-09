import type { AnalysisResult } from "../simulation/linearTransient";
import { Activity, CircuitBoard, MessageSquare, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ToolbarProps {
  mode: "schematic" | "simulator";
  result: AnalysisResult | null;
  runState: "idle" | "complete" | "error" | "stopped";
  isRunning: boolean;
  title: string;
  assistantOpen: boolean;
  projectOpen?: boolean;
  schematicOpen?: boolean;
  onModeChange: (mode: "schematic" | "simulator") => void;
  onRun: () => void;
  onToggleAssistant: () => void;
  onOpenSettings: () => void;
}

type LampState = "idle" | "running" | "ok" | "error" | "warn";

const ICON = { size: 13, strokeWidth: 1.6 } as const;

export function Toolbar({ mode, result, runState, isRunning, title, assistantOpen, projectOpen = true, schematicOpen = true, onModeChange, onRun, onToggleAssistant, onOpenSettings }: ToolbarProps) {
  const isSimulator = mode === "simulator";
  const runHasError = !isRunning && (runState === "error" || result?.ok === false);
  const runIsAcceptable = !isRunning && runState === "complete" && result?.ok === true;

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

  return (
    <header className="toolbar">
      <div className="titlebar-left">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">τ</span>
          <span className="brand-name">tau</span>
          <span className="brand-file mono-num">{title}</span>
        </div>
      </div>

      <div className="mode-toggle" aria-label="Editor mode">
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

      <div className="titlebar-right">
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
              disabled={isRunning || !schematicOpen}
              className={cn(
                "gap-1.5 bg-secondary hover:bg-accent",
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
          <TooltipContent>{isRunning ? "Simulation running…" : "Run simulation and switch to simulator"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              className={cn(
                "assistant-toolbar-button",
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              aria-label="Settings"
              onClick={onOpenSettings}
            >
              <Settings size={14} strokeWidth={1.6} aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
