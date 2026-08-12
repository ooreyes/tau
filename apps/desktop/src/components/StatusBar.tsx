import { cn } from "@/lib/utils";
import { useSchematic } from "../store/useSchematic";
import type { AnalysisResult } from "../simulation/linearTransient";

type LampState = "idle" | "ok" | "error";

/**
 * The bottom strip, reduced to what only it can say.
 *
 * The review asked for the settings gear in the lower-left and "the text
 * underneath it" to go. The gear went; the text stayed, and reading it back
 * explains why that was wrong: `Ready` never said anything else while editing,
 * `my.asc` is already in the title bar AND on the document tab, and `Select`
 * is the resting tool. Three slots of permanent chrome, zero information.
 *
 * What survives is the two things that genuinely change and are not written
 * anywhere else: the tool you are part-way through using, and simulator run
 * state. When neither applies the strip renders nothing at all - it is
 * `position: absolute`, so an empty schematic editor simply gets the space
 * back rather than a reserved empty band.
 */
export function StatusBar({
  mode,
  result,
}: {
  mode: "schematic" | "simulator";
  result: AnalysisResult | null;
}) {
  const tool = useSchematic((s) => s.tool);
  // `select` is the resting state, so it is deliberately absent: a permanent
  // label reading "Select" is the thing this strip was criticised for.
  const toolLabel =
    tool.mode === "place"
      ? `Placing ${tool.kind}`
      : tool.mode === "wire"
        ? "Wiring"
        : tool.mode === "probe"
          ? "Probing - click a node"
          : tool.mode === "label"
            ? "Net label - click a point, type a name"
            : "";
  const simulatorHint = tool.mode === "probe"
    ? "Probe - wire/pin plots voltage · component body plots current · click a probe to remove"
    : tool.mode === "label"
      ? "Node name - click a node or existing name; empty text removes it"
      : "Inspect - select a component to focus telemetry";

  // Same lamp semantics as the toolbar's transport indicator (Toolbar.tsx):
  // color is entirely state-driven, not tied to which mode you're in.
  const lampState: LampState = result?.ok ? "ok" : result ? "error" : "idle";
  const state = result?.ok ? "Sim complete" : result ? "Sim error" : "Sim ready";

  const hint = mode === "simulator" ? simulatorHint : toolLabel;
  if (mode !== "simulator" && !hint) return null;

  return (
    <footer className="statusbar">
      {mode === "simulator" && (
        <span className={cn("status-lamp", `status-lamp--${lampState}`)}>
          <i className="status-lamp-dot" aria-hidden="true" />
          <span className="status-lamp-text mono-num">{state}</span>
        </span>
      )}
      {hint && (
        <span className="status-hints">
          <span>{hint}</span>
        </span>
      )}
    </footer>
  );
}
