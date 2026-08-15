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
import { FolderOpen, Search, Settings, Toolbox } from "lucide-react";
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
      {/* `Toolbox` replaces `Waypoints`, which has not been discarded - it has
          moved to the mode toggle, where the reasoning that was written for it
          here actually belongs (see the block above `.mode-toggle` in
          components/Toolbar.tsx).

          The rail's five keys are five PLACES: a folder of files, a lens, a box
          of parts, the signals you captured, a gear. None of them should be a
          picture of the circuit, because the mode toggle at the top of the
          window is already that, and `Waypoints` drew a net - so "Components"
          and the toggle's "Schematic" were two controls claiming one subject.
          `CircuitBoard` had caused exactly that collision on this same key one
          glyph earlier, which is the tell that the mistake was the category and
          not the drawing. A toolbox is a container you open, which is what the
          parts palette is, and it rhymes with `FolderOpen` two keys up instead
          of competing with the header.

          It also survives 18px, which is the bar `CircuitBoard` failed here.
          The body is 20x15 units, so it is not a square and is not read as one;
          the handle arch breaks the top edge and carries the silhouette by
          itself; and the interior is three straight strokes - a lid seam and
          two latches - rather than the pads-and-traces detail that landed
          sub-pixel. Checked rasterised at 18 device pixels as well as 36, so it
          still reads unaided on a non-Retina display. And it is Omar's own
          image of this key: "Im imaginging Components bring a toolbox". */}
      <RailButton active={partsOpen && schematicOpen} label="Components" onClick={onFocusComponents} disabled={!schematicOpen}>
        <Toolbox size={18} data-icon="toolbox" />
      </RailButton>
      {/* `AudioWaveform` is retired and nothing in lucide replaces it, so this
          one is drawn by hand - `SineGlyph` at the foot of this file records
          what was searched and the measurement that settled it. The short
          version: the glyph being replaced is a square wave, and "waveforms
          beign something more sinosodiula" is the correction. */}
      <RailButton active={mode === "simulator"} label="Waveforms" onClick={() => onModeChange("simulator")} disabled={!schematicOpen}>
        <SineGlyph />
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

/**
 * A sine, drawn here, because lucide does not have one.
 *
 * The set was searched before this was written, and every near miss fails on
 * what it depicts, on legibility, or on both:
 *
 *   `Waves`       - three ripples, and it is water rather than a signal. It also
 *                   does not survive the size, and that part is measurable: each
 *                   ripple is `q2.5 2 5 0`, and a quadratic's extremum is its
 *                   midpoint (P0 + 2C + P1)/4, so a control offset of 2 units
 *                   produces exactly 1 unit of crest. At the rail's 18px that is
 *                   0.75px of amplitude under a 1.125px stroke - the wave is
 *                   thinner than the line drawing it - and rasterised at 18
 *                   device pixels the three ripples flatten into rules.
 *   `AudioLines`  - six bars of differing height: a level meter, not a trace.
 *   `Activity`    - one spike. A one-shot event, and the generic dashboard mark.
 *   `AudioWaveform` - what this replaces. Read its path: vertical runs joined by
 *                   2-unit fillets, which is a SQUARE wave wearing rounded
 *                   corners, and at 18px the fillet radius is 1.5px so the
 *                   corners read square anyway. It is the thing the review was
 *                   pointing at.
 *
 * So: two full cycles across x=2..22, +-5 units about the centre line at y=12.
 * Ten units peak to peak is 7.5px at the rail's 18px, about 6.7x the resting
 * stroke, against the 1.33x `Waves` manages. Two cycles is the fewest that reads
 * as periodic rather than as one squiggle, and the ink stops at y=7 and y=17, so
 * nothing touches the edge of the 24-unit box on any side - a mark that cannot
 * collapse into a block the way an enclosing rectangle does.
 *
 * Only the geometry is stated here. `.rail-btn svg` in App.css already supplies
 * the fill, the stroke source and the round caps to any svg inside a rail key,
 * and pdf6Rail.css sets `stroke-width` from --rail-glyph / --rail-glyph-active,
 * so this glyph gains the selected state's heavier weight for free and by the
 * same mechanism as the lucide ones. The attributes below restate everything
 * except that weight, so the mark is still correct if it is ever rendered
 * outside a rail key; `stroke-width` is deliberately absent, because a second
 * copy of that number in JSX is exactly how the old 1.6 went stale against
 * App.css.
 */
function SineGlyph() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-icon="sine"
    >
      <path d="M2 12q2.5 -10 5 0t5 0 5 0 5 0" />
    </svg>
  );
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
