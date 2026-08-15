/**
 * The workspace nav rail, moved out of ShellPanels.tsx.
 *
 * It is the one surface REDESIGN.md says never collapses at any viewport, so
 * every other piece of chrome that can be summoned has a guaranteed way back.
 * Stage 3 changes what it is made of (a veiled float over the canvas rather
 * than a docked column); this move is deliberately separate from that change,
 * so the diff that alters appearance contains only the alteration.
 *
 * `ModeProps` travels with it: every field is something the rail needs.
 *
 * Appearance lives in `styles/pdf6Rail.css`, which is imported after App.css
 * and therefore wins at equal specificity. Read it alongside this file: the
 * key geometry, the four ink tiers and the active index mark are all stated
 * there, and the reasoning for each is in that file's comments.
 */
import type { ReactNode } from "react";
import { AudioWaveform, FolderOpen, Search, Settings, Waypoints } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DiagnosticsHealth } from "@/lib/diagnosticsHealth";
import { DiagnosticsRailButton } from "./DiagnosticsRailButton";

interface ModeProps {
  mode: "schematic" | "simulator";
  explorerOpen: boolean;
  partsOpen: boolean;
  projectOpen?: boolean;
  schematicOpen?: boolean;
  onFocusExplorer: () => void;
  onModeChange: (mode: "schematic" | "simulator") => void;
  onSearch: () => void;
  onFocusComponents: () => void;
  /**
   * App-level settings, moved here from the status strip's lower-right utility.
   * Optional so the rail can be rendered without a shell (tests, storybook-ish
   * harnesses) and simply grows no foot.
   */
  onOpenSettings?: () => void;
  /**
   * The diagnostics health lamp, when a shell has diagnostics to report. Also
   * optional, and for the same reason as `onOpenSettings`: a harness that
   * renders the rail on its own has no severity state to hand it, and a rail
   * that demanded one could not be rendered in isolation at all.
   *
   * The shape is `DiagnosticsRailButtonProps` verbatim rather than a set of
   * loose props, because the four fields are only meaningful together - a
   * health with no count and no toggle is not a lamp, it is a decoration.
   */
  diagnostics?: {
    health: DiagnosticsHealth;
    count: number;
    open: boolean;
    onToggle: () => void;
    disabled?: boolean;
  };
}

export function ActivityRail({
  mode,
  explorerOpen,
  partsOpen,
  projectOpen = true,
  schematicOpen = true,
  onFocusExplorer,
  onModeChange,
  onSearch,
  onFocusComponents,
  onOpenSettings,
  diagnostics,
}: ModeProps) {
  return (
    <nav className="activity-rail" aria-label="Workspace sections">
      <RailButton active={mode === "schematic" && explorerOpen} label="Explorer" onClick={onFocusExplorer}>
        <FolderOpen size={18} />
      </RailButton>
      <RailButton label="Search" shortcut="⌘K" onClick={onSearch} disabled={!projectOpen}>
        <Search size={18} />
      </RailButton>
      <RailSeparator />
      {/* `Waypoints` replaces `CircuitBoard`. The old glyph was a populated
          board - a bounding rectangle with two pads and two right-angle traces
          inside it - which is a photograph of the wrong artefact: Tau edits a
          schematic, not a PCB. It also failed on legibility, because at 18px
          the rectangle spends the outer 2px of the cell and the interior detail
          lands sub-pixel, so it read as a filled square. `Waypoints` is four
          terminals joined by an orthogonal spine with two 45-degree runs, which
          is the drawing vocabulary of a net: junction dots and wires. Thin
          strokes with air between them, so it survives the size. */}
      <RailButton active={partsOpen && schematicOpen} label="Components" onClick={onFocusComponents} disabled={!schematicOpen}>
        <Waypoints size={18} />
      </RailButton>
      {/* `AudioWaveform` replaces `Activity`. `Activity` is the single-spike ECG
          line that ships as the default "analytics" mark in every dashboard
          template, which is precisely the generic read the review objected to,
          and what it depicts is a one-shot event rather than a signal. This
          glyph is one continuous stroke that crosses the mid-line four times -
          a bounded, repeating waveform, which is what the simulator shows. Its
          lucide name is about audio; its shape is a scope trace. */}
      <RailButton active={mode === "simulator"} label="Waveforms" onClick={() => onModeChange("simulator")} disabled={!schematicOpen}>
        <AudioWaveform size={18} />
      </RailButton>
      {/* Directly under Waveforms, at Omar's direction (PDF-6 item 6 review:
          "i imagined this button being under waveforms button").

          It was first built into the foot, on the reasoning that a health lamp
          wants a constant screen position. Sitting here instead it moves with the
          destination stack - but the stack above it is fixed in length, entries
          are disabled rather than removed, so in practice the position is stable
          and it is now the fourth thing in the column rather than the last. It
          also reads as part of the same group as the surfaces it reports on,
          which is the argument for this placement over the tidier one. */}
      {diagnostics && <DiagnosticsRailButton {...diagnostics} />}
      {onOpenSettings && (
        /* The foot: the rail's fixed register. Settings is a utility rather than
           a destination, so it is pinned to the bottom with `margin-top: auto`
           and comes last in the tab order, which App.shellContract asserts.

           The hairline BELOW it is the rail's terminating rule: it lands on the
           same line as the status strip's `border-top`, so the two read as one
           line across the window and the rounded bottom-left corner beneath
           belongs to this block instead of being the empty gap the review
           screenshotted. */
        <div className="rail-foot">
          <RailButton label="Settings" onClick={onOpenSettings}>
            <Settings size={18} />
          </RailButton>
          <RailSeparator />
        </div>
      )}
    </nav>
  );
}

function RailSeparator() {
  return <span className="rail-separator" aria-hidden="true" />;
}

function RailButton({
  active = false,
  label,
  shortcut,
  disabled = false,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={`rail-btn${active ? " active" : ""}`}
          aria-label={label}
          aria-current={active ? "page" : undefined}
          onClick={onClick}
          disabled={disabled}
        >
          {/* The active index mark. It is inside the button on purpose - see
              `.rail-active` in styles/pdf6Rail.css, where the whole point is
              that it can no longer escape the key it belongs to. */}
          {active && <span className="rail-active" />}
          {/* No `strokeWidth` on the icons above: the stylesheet owns glyph
              weight because it varies between the resting and active states,
              and a second copy of the number in JSX is how the old 1.6 went
              stale against App.css. */}
          <span className="rail-lucide" aria-hidden="true">
            {children}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{shortcut ? `${label} - ${shortcut}` : label}</TooltipContent>
    </Tooltip>
  );
}
