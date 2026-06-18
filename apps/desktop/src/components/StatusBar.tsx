import { useSchematic } from "../store/useSchematic";

export function StatusBar() {
  const componentCount = useSchematic((s) => s.components.length);
  const wireCount = useSchematic((s) => s.wires.length);
  const tool = useSchematic((s) => s.tool);
  const mode =
    tool.mode === "place" ? `Placing ${tool.kind}` : tool.mode === "wire" ? "Wiring" : "Select";

  return (
    <footer className="statusbar">
      <span className="status-mode">{mode}</span>
      <span className="status-hints">
        <kbd>R</kbd>
        <kbd>C</kbd>
        <kbd>L</kbd>
        <kbd>V</kbd>
        <kbd>I</kbd>
        <kbd>A</kbd>
        <kbd>G</kbd> place
        <span className="dot">·</span>
        <kbd>W</kbd> wire
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
        {componentCount} component{componentCount === 1 ? "" : "s"} · {wireCount} wire
        {wireCount === 1 ? "" : "s"}
      </span>
    </footer>
  );
}
