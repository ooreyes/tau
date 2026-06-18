import { useSchematic } from "../store/useSchematic";

interface ToolbarProps {
  onRun: () => void;
}

export function Toolbar({ onRun }: ToolbarProps) {
  const undo = useSchematic((s) => s.undo);
  const redo = useSchematic((s) => s.redo);
  const canUndo = useSchematic((s) => s.past.length > 0);
  const canRedo = useSchematic((s) => s.future.length > 0);

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">τ</span>
        <span className="brand-name">Tau</span>
        <span className="brand-sub">circuit simulator</span>
      </div>

      <div className="toolbar-group">
        <button
          className="tool-btn"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (⌘Z)"
          aria-label="Undo"
        >
          ↶
        </button>
        <button
          className="tool-btn"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (⌘⇧Z)"
          aria-label="Redo"
        >
          ↷
        </button>
      </div>

      <div className="toolbar-spacer" />

      <button className="run-btn" onClick={onRun} title="Run transient analysis">
        ▶&nbsp; Run
      </button>
      <span className="version-tag">v0.2 · pre-alpha</span>
    </header>
  );
}
