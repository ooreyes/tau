import { useSchematic } from "../store/useSchematic";

export function StatusBar() {
  const count = useSchematic((s) => s.components.length);
  const tool = useSchematic((s) => s.tool);
  const mode = tool.mode === "place" ? `Placing ${tool.kind}` : "Select";

  return (
    <footer className="statusbar">
      <span className="status-mode">{mode}</span>
      <span className="status-hints">
        <kbd>R</kbd>
        <kbd>C</kbd>
        <kbd>L</kbd>
        <kbd>V</kbd>
        <kbd>G</kbd> place
        <span className="dot">·</span>
        <kbd>Space</kbd> rotate
        <span className="dot">·</span>
        <kbd>⌫</kbd> delete
        <span className="dot">·</span>
        <kbd>Esc</kbd> cancel
        <span className="dot">·</span>
        <kbd>⌘</kbd>+scroll zoom · two-finger pan
      </span>
      <span className="status-count">
        {count} component{count === 1 ? "" : "s"}
      </span>
    </footer>
  );
}
