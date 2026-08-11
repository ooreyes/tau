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
 */
import type { ReactNode } from "react";
import { Activity, CircuitBoard, FolderOpen, Search } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
}: ModeProps) {
  return (
    <nav className="activity-rail" aria-label="Workspace sections">
      <RailButton active={mode === "schematic" && explorerOpen} label="Explorer" onClick={onFocusExplorer}>
        <FolderOpen size={18} strokeWidth={1.6} />
      </RailButton>
      <RailButton label="Search" shortcut="⌘K" onClick={onSearch} disabled={!projectOpen}>
        <Search size={18} strokeWidth={1.6} />
      </RailButton>
      <RailSeparator />
      <RailButton active={partsOpen && schematicOpen} label="Components" onClick={onFocusComponents} disabled={!schematicOpen}>
        <CircuitBoard size={18} strokeWidth={1.6} />
      </RailButton>
      <RailButton active={mode === "simulator"} label="Waveforms" onClick={() => onModeChange("simulator")} disabled={!schematicOpen}>
        <Activity size={18} strokeWidth={1.6} />
      </RailButton>
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
          {active && <span className="rail-active" />}
          <span className="rail-lucide" aria-hidden="true">
            {children}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{shortcut ? `${label} - ${shortcut}` : label}</TooltipContent>
    </Tooltip>
  );
}
