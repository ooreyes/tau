import type { AnalysisResult } from "../simulation/linearTransient";

interface ToolbarProps {
  mode: "schematic" | "simulator";
  result: AnalysisResult | null;
  runState: "idle" | "complete" | "error" | "stopped" | "paused";
  title: string;
  onModeChange: (mode: "schematic" | "simulator") => void;
  onRun: () => void;
  onOpenSettings: () => void;
}

export function Toolbar({ mode, result, runState, title, onModeChange, onRun, onOpenSettings }: ToolbarProps) {
  const isSimulator = mode === "simulator";
  const statusText = !isSimulator
    ? "ready · edit mode"
    : runState === "paused"
      ? "sim paused"
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
        <div className="traffic-lights" aria-hidden="true">
          <span className="traffic red" />
          <span className="traffic amber" />
          <span className="traffic green" />
        </div>
        <div className="brand">
          <span className="brand-name">tau</span>
          <span className="brand-file">{title}</span>
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
        <button
          className="title-run"
          onClick={onRun}
          title="Run simulation and switch to simulator"
          aria-label="Run simulation"
        >
          ▶
        </button>
        <span className={`live-pill ${isSimulator ? "sim" : "schem"}`}>
          <i />
          {statusText}
        </span>
        <button className="settings-btn" title="Settings" aria-label="Settings" onClick={onOpenSettings}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 2.5l1.8 1.2 2.1-.5.9 2 1.9.9-.5 2.1 1.2 1.8-1.2 1.8.5 2.1-1.9.9-.9 2-2.1-.5L10 17.5l-1.8-1.2-2.1.5-.9-2-1.9-.9.5-2.1L2.6 10l1.2-1.8-.5-2.1 1.9-.9.9-2 2.1.5z" />
            <circle cx="10" cy="10" r="2.4" />
          </svg>
        </button>
      </div>
    </header>
  );
}
