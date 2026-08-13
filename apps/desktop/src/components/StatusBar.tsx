import { cn } from "@/lib/utils";
import { Settings } from "lucide-react";
import { InstrumentIconButton } from "@/components/ui/instrument-icon-button";
import { useSchematic } from "../store/useSchematic";
import type { AnalysisResult } from "../simulation/linearTransient";

type LampState = "idle" | "ok" | "error";

/**
 * The bottom strip, reduced to what only it can say.
 *
 * The lower-right Settings utility stays available without inventing a second
 * status or a filler card. The rest of the strip says only what changes:
 * `Ready` never said anything else while editing, `my.asc` is already in the
 * title bar AND on the document tab, and `Select` is the resting tool.
 *
 * What survives is the two things that genuinely change and are not written
 * anywhere else: the tool you are part-way through using, and simulator run
 * state. Without either context or the parent-supplied Settings utility, the
 * strip renders nothing at all; with Settings, it remains only that isolated
 * lower-right action rather than a reserved status band full of filler.
 */
export function StatusBar({
  mode,
  result,
  onOpenSettings,
}: {
  mode: "schematic" | "simulator";
  result: AnalysisResult | null;
  /** Existing app utility, placed at the lower-right when the shell supplies it. */
  onOpenSettings?: () => void;
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
  if (mode !== "simulator" && !hint && !onOpenSettings) return null;

  return (
    <footer className="statusbar">
      <div className="statusbar-context">
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
      </div>
      {onOpenSettings && (
        <div className="statusbar-utility">
          <InstrumentIconButton
            icon={Settings}
            label="Settings"
            tooltip="Settings"
            tooltipSide="top"
            onClick={onOpenSettings}
          />
        </div>
      )}
    </footer>
  );
}
