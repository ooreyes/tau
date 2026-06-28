import { useSchematic } from "../store/useSchematic";
import type { AnalysisResult } from "../simulation/linearTransient";
import { isNativeSpiceRuntime } from "../engine/nativeSpice";

export function StatusBar({
  mode,
  result,
  title,
}: {
  mode: "schematic" | "simulator";
  result: AnalysisResult | null;
  title: string;
}) {
  const componentCount = useSchematic((s) => s.components.length);
  const wireCount = useSchematic((s) => s.wires.length);
  const tool = useSchematic((s) => s.tool);
  const toolLabel =
    tool.mode === "place"
      ? `Placing ${tool.kind}`
      : tool.mode === "wire"
        ? "Wiring"
        : tool.mode === "probe"
          ? "Probing — click a node"
          : "Select";
  // ngspice runs only inside the native desktop build; the browser preview uses
  // the built-in TypeScript solver. Surface which one is active to avoid the
  // "ngspice isn't working" confusion when running in a browser.
  const engineLabel = isNativeSpiceRuntime() ? "ngspice" : "built-in solver";
  const state = mode === "simulator"
    ? result?.ok
      ? "sim complete"
      : result
        ? "sim error"
        : "sim ready"
    : "ready · edit mode";

  return (
    <footer className="statusbar">
      <span className={`status-mode ${mode}`}>
        <i />
        {state}
      </span>
      <span className="status-file">{title}</span>
      <span className="status-codec" title={isNativeSpiceRuntime() ? "Native ngspice engine" : "Built-in TypeScript solver — ngspice runs in the desktop app"}>
        engine: {engineLabel}
      </span>
      <span className="status-hints">
        <span>{mode === "simulator" ? "probe nodes in the analysis panel" : toolLabel}</span>
        <span className="dot">·</span>
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
        <kbd>⌘</kbd>+<kbd>E</kbd> mirror
        <span className="dot">·</span>
        <kbd>⌫</kbd> delete
        <span className="dot">·</span>
        <kbd>Esc</kbd> cancel
        <span className="dot">·</span>
        <kbd>⌘</kbd>+scroll zoom · two-finger pan
      </span>
      <span className="status-count">
        grid 0.1 in · {componentCount} component{componentCount === 1 ? "" : "s"} · {wireCount} wire
        {wireCount === 1 ? "" : "s"} · zoom 100%
      </span>
    </footer>
  );
}
