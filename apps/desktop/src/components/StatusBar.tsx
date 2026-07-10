import { cn } from "@/lib/utils";
import { useSchematic } from "../store/useSchematic";
import type { AnalysisResult } from "../simulation/linearTransient";
import { isNativeSpiceRuntime } from "../engine/nativeSpice";

type LampState = "idle" | "ok" | "error";

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
          : tool.mode === "label"
            ? "Net label — click a point, type a name"
            : "Select";
  // ngspice runs only inside the native desktop build; the browser preview uses
  // the built-in TypeScript solver. Surface which one is active to avoid the
  // "ngspice isn't working" confusion when running in a browser.
  const engineLabel = isNativeSpiceRuntime() ? "ngspice" : "built-in solver";
  // Same lamp semantics as the toolbar's transport indicator (Toolbar.tsx):
  // color is entirely state-driven, not tied to which mode you're in.
  const lampState: LampState = mode === "simulator"
    ? result?.ok
      ? "ok"
      : result
        ? "error"
        : "idle"
    : "idle";
  const state = mode === "simulator"
    ? result?.ok
      ? "Sim complete"
      : result
        ? "Sim error"
        : "Sim ready"
    : "Ready";

  return (
    <footer className="statusbar">
      <span className={cn("status-lamp", `status-lamp--${lampState}`)}>
        <i className="status-lamp-dot" aria-hidden="true" />
        <span className="status-lamp-text mono-num">{state}</span>
      </span>
      <span className="status-file mono-num">{title}</span>
      <span
        className="status-codec mono-num"
        title={isNativeSpiceRuntime() ? "Native ngspice engine" : "Built-in TypeScript solver — ngspice runs in the desktop app"}
      >
        engine: {engineLabel}
      </span>
      <span className="status-hints">
        <span>{mode === "simulator" ? "click a wire to probe voltage · a part to probe current" : toolLabel}</span>
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
        <kbd>F4</kbd> label
        <span className="dot">·</span>
        <kbd>Space</kbd> rotate
        <span className="dot">·</span>
        <kbd>⌘</kbd>+<kbd>E</kbd> mirror
        <span className="dot">·</span>
        <kbd>⌘</kbd>+<kbd>D</kbd> duplicate
        <span className="dot">·</span>
        <kbd>⌫</kbd> delete
        <span className="dot">·</span>
        <kbd>Esc</kbd> cancel
        <span className="dot">·</span>
        <kbd>⌘</kbd>+scroll zoom · two-finger pan
      </span>
      <span className="status-count mono-num">
        grid 0.1 in · {componentCount} component{componentCount === 1 ? "" : "s"} · {wireCount} wire
        {wireCount === 1 ? "" : "s"} · zoom 100%
      </span>
    </footer>
  );
}
