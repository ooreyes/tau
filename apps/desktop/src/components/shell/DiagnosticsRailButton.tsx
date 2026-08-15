/**
 * The rail's `!` diagnostics toggle (PDF-6 items 6 and 7).
 *
 * Lives in the nav rail beside the other destinations because the report puts
 * it there ("the exclamation amrk for warning" is listed with the rail's
 * icons), and because a health light is only useful if it is always visible -
 * a badge inside the drawer it opens cannot tell you to open the drawer.
 *
 * Rendered by `shell/NavRail.tsx`; the colour comes from `lib/diagnosticsHealth`
 * so this component holds no severity policy of its own.
 *
 * The glyph does NOT change with health, and that is deliberate. The report asks
 * for "a '!' button" whose COLOUR changes - one button the user learns the
 * position of - so swapping in a tick for the clear state would mean the thing
 * they are hunting for has moved or vanished exactly when they want to check
 * that nothing is wrong. Severity therefore rides on three carriers that are not
 * colour: the count badge (present only when there is something to read), the
 * accessible name, and the tooltip, all of which come from
 * `diagnosticsHealthLabel` and say "will not run" in words.
 */
import { TriangleAlert } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  diagnosticsHealthLabel,
  type DiagnosticsHealth,
} from "@/lib/diagnosticsHealth";

export interface DiagnosticsRailButtonProps {
  health: DiagnosticsHealth;
  /** Rows the panel would show under the active policy. Drives the badge. */
  count: number;
  /** Whether the diagnostics window is currently shown. */
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

export function DiagnosticsRailButton({
  health,
  count,
  open,
  onToggle,
  disabled = false,
}: DiagnosticsRailButtonProps) {
  const label = diagnosticsHealthLabel(health, count);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={`rail-btn rail-diagnostics rail-diagnostics--${health}${open ? " active" : ""}`}
          aria-label={label}
          aria-pressed={open}
          aria-expanded={open}
          disabled={disabled}
          onClick={onToggle}
          data-health={health}
        >
          {open && <span className="rail-active" />}
          <span className="rail-lucide" aria-hidden="true">
            <TriangleAlert size={18} strokeWidth={1.6} />
          </span>
          {/* Clamped to "9+" because the rail is 44px wide and a three-digit
              badge would cover the glyph it annotates. The exact number stays
              reachable: it is in the accessible name and in the tooltip, and the
              window itself prints the untruncated count. */}
          {count > 0 && (
            <span className="rail-diagnostics-count mono-num" aria-hidden="true">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
