export function Toolbar() {
  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">τ</span>
        <span className="brand-name">Tau</span>
        <span className="brand-sub">circuit simulator</span>
      </div>
      <div className="toolbar-spacer" />
      <button className="run-btn" disabled title="The simulation engine arrives in the next phase">
        ▶&nbsp; Run
      </button>
      <span className="version-tag">v0.1 · pre-alpha</span>
    </header>
  );
}
