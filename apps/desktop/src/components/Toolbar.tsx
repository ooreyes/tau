import type { AnalysisResult } from "../simulation/linearTransient";
import { Sparkles } from "lucide-react";
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
  onModeChange: (mode: "schematic" | "simulator") => void;
  onRun: () => void;
  onToggleAssistant: () => void;
  onOpenSettings: () => void;
}

type LampState = "idle" | "running" | "ok" | "error" | "warn";

export function Toolbar({ mode, result, runState, isRunning, title, assistantOpen, onModeChange, onRun, onToggleAssistant, onOpenSettings }: ToolbarProps) {
  const isSimulator = mode === "simulator";
  const runHasError = runState === "error" || result?.ok === false;
  const runIsAcceptable = !runHasError && runState !== "stopped";

  // The status lamp is the single source of truth for run state — no cancel
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

  // Quiet by design (§UX checklist 5): the schematic editor shows NO status
  // chatter — "ready · edit mode" told the user nothing. Only genuinely useful
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
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="4" cy="4" r="2" />
            <circle cx="12" cy="12" r="2" />
            <path d="M6 4h6v6" />
          </svg>
          Schematic
        </button>
        <button
          className={`mode-btn${mode === "simulator" ? " active" : ""}`}
          onClick={() => onModeChange("simulator")}
          aria-pressed={mode === "simulator"}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M1 12l4-5 3 2 5-6" />
            <path d="M11 3h2v2" />
          </svg>
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
            {/* The Run control is also the schematic health indicator: green
                while the circuit has no known error, red after a failed run. */}
            <Button
              variant="outline"
              size="sm"
              disabled={isRunning}
              className={cn(
                "gap-1.5 bg-secondary hover:bg-accent",
                "[-webkit-app-region:no-drag]",
                runHasError && "run-button--error",
                runIsAcceptable && "run-button--ok",
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
                "assistant-toolbar-button [-webkit-app-region:no-drag]",
                assistantOpen && "assistant-toolbar-button--active",
              )}
              aria-label={assistantOpen ? "Close Tau assistant" : "Open Tau assistant"}
              aria-pressed={assistantOpen}
              onClick={onToggleAssistant}
            >
              <Sparkles size={14} strokeWidth={1.8} aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{assistantOpen ? "Close Tau assistant" : "Ask Tau"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground [-webkit-app-region:no-drag]"
              aria-label="Settings"
              onClick={onOpenSettings}
            >
              <svg
                viewBox="0 0 20 20"
                aria-hidden="true"
                className="size-3.5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.5]"
              >
                <path d="M10 2.5l1.8 1.2 2.1-.5.9 2 1.9.9-.5 2.1 1.2 1.8-1.2 1.8.5 2.1-1.9.9-.9 2-2.1-.5L10 17.5l-1.8-1.2-2.1.5-.9-2-1.9-.9.5-2.1L2.6 10l1.2-1.8-.5-2.1 1.9-.9.9-2 2.1.5z" />
                <circle cx="10" cy="10" r="2.4" />
              </svg>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
