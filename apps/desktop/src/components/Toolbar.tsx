import type { AnalysisResult } from "../simulation/linearTransient";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ToolbarProps {
  mode: "schematic" | "simulator";
  result: AnalysisResult | null;
  runState: "idle" | "complete" | "error" | "stopped";
  isRunning: boolean;
  title: string;
  onModeChange: (mode: "schematic" | "simulator") => void;
  onRun: () => void;
  onOpenSettings: () => void;
}

type LampState = "idle" | "running" | "ok" | "error" | "warn";

export function Toolbar({ mode, result, runState, isRunning, title, onModeChange, onRun, onOpenSettings }: ToolbarProps) {
  const isSimulator = mode === "simulator";

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

  const statusText = isRunning
    ? "running…"
    : !isSimulator
      ? "ready · edit mode"
      : result?.ok
        ? `sim complete · ${result.stats.sampleCount} samples`
        : runState === "error"
          ? "sim error"
          : runState === "stopped"
            ? "sim stopped"
            : "simulator ready";

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
          schematic
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
          simulator
        </button>
      </div>

      <div className="titlebar-right">
        <span className={cn("status-lamp", `status-lamp--${lampState}`)}>
          <i className="status-lamp-dot" aria-hidden="true" />
          <span className="status-lamp-text mono-num">{statusText}</span>
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={isRunning}
              className={cn(
                "gap-1.5 border-success/35 bg-success/10 text-success",
                "hover:bg-success/15 hover:border-success/55",
                "disabled:border-success/15 disabled:bg-success/5 disabled:text-success/40",
                "[-webkit-app-region:no-drag]",
              )}
              onClick={onRun}
              aria-label="Run simulation"
            >
              <svg viewBox="0 0 12 12" aria-hidden="true" className="size-2.5 fill-current">
                <path d="M2.5 1.4v9.2c0 .5.55.8.98.55l7.4-4.6a.64.64 0 0 0 0-1.1l-7.4-4.6a.64.64 0 0 0-.98.55Z" />
              </svg>
              run
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isRunning ? "Simulation running…" : "Run simulation and switch to simulator"}</TooltipContent>
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
