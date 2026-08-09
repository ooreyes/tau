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
          ? "Probing - click a node"
          : tool.mode === "label"
            ? "Net label - click a point, type a name"
            : "Select";
  const simulatorHint = tool.mode === "probe"
    ? "Probe - wire/pin plots voltage · component body plots current · click a probe to remove"
    : tool.mode === "label"
      ? "Node name - click a node or existing name; empty text removes it"
      : "Inspect - select a component to focus telemetry";
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
      {/*
        * One contextual hint, not a wall of keycaps.
        *
        * This used to end with twenty `kbd` chips listing every placement key,
        * wire, label, rotate, mirror, duplicate, delete and cancel, on screen
        * permanently. It is the antipattern the design language exists to
        * prevent: ink that carries no information after the first read. An
        * expert has long since learned it, and a student cannot parse a
        * twenty-item legend anyway, so it was costing every user a strip of
        * the window to help nobody.
        *
        * Nothing is lost. Every one of those keys is still discoverable in
        * three places that are better at it: the command palette lists each
        * command beside its own hotkey, the parts palette shows each part's
        * key on its row, and Settings has a Keyboard shortcuts page that
        * derives the list from the real bindings rather than restating them.
        * What stays here is the one line that changes as you work, which is
        * the only part that was ever worth a permanent slot.
        */}
      <span className="status-hints">
        <span>{mode === "simulator" ? simulatorHint : toolLabel}</span>
      </span>
    </footer>
  );
}
