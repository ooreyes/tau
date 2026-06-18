interface ToolbarProps {
  onRun: () => void;
}

export function Toolbar({ onRun }: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">τ</span>
        <span className="brand-name">Tau</span>
        <span className="brand-sub">circuit simulator</span>
      </div>
      <div className="toolbar-spacer" />
      <button className="run-btn" onClick={onRun} title="Run transient analysis">
        ▶&nbsp; Run
      </button>
      <span className="version-tag">v0.1 · pre-alpha</span>
    </header>
  );
}
