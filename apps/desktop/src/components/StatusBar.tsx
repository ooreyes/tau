import { cn } from "@/lib/utils";
import { useSchematic } from "../store/useSchematic";
import type { AnalysisResult } from "../simulation/linearTransient";

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
  const simulatorHint = tool.mode === "probe"
    ? "Probe — click a wire to add; click a probe dot to remove"
    : tool.mode === "label"
      ? "Node name — click a node or existing name; empty text removes it"
      : "Inspect — select a component to focus telemetry";
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
      <span className="status-hints">
        {mode === "simulator" ? (
          <>
            <span>{simulatorHint}</span>
            <span className="dot">·</span>
            <kbd>⌘</kbd>+scroll zoom · two-finger pan
          </>
        ) : (
          <>
            <span>{toolLabel}</span>
            <span className="dot">·</span>
            <kbd>R</kbd><kbd>C</kbd><kbd>L</kbd><kbd>V</kbd><kbd>I</kbd><kbd>A</kbd><kbd>G</kbd> place
            <span className="dot">·</span><kbd>W</kbd> wire
            <span className="dot">·</span><kbd>F4</kbd> label
            <span className="dot">·</span><kbd>Space</kbd> rotate
            <span className="dot">·</span><kbd>⌘</kbd>+<kbd>E</kbd> mirror
            <span className="dot">·</span><kbd>⌘</kbd>+<kbd>D</kbd> duplicate
            <span className="dot">·</span><kbd>⌫</kbd> delete
            <span className="dot">·</span><kbd>Esc</kbd> cancel
            <span className="dot">·</span><kbd>⌘</kbd>+scroll zoom · two-finger pan
          </>
        )}
      </span>
    </footer>
  );
}
