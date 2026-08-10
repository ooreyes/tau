import { InstrumentIconButton } from '@tau/desktop';
import { Crosshair, Grid3x3, Magnet, Play, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4 };

/** The dense action row this button exists for — plot and schematic chrome. */
export function ActionRow() {
  return (
    <div style={row}>
      <InstrumentIconButton label="Zoom in" icon={ZoomIn} />
      <InstrumentIconButton label="Zoom out" icon={ZoomOut} />
      <InstrumentIconButton label="Fit to data" icon={Crosshair} />
      <InstrumentIconButton label="Rotate" icon={RotateCw} />
      <InstrumentIconButton label="Run" icon={Play} />
    </div>
  );
}

/** Toggles carry `pressed`; momentary actions leave it undefined. */
export function ToggleStates() {
  return (
    <div style={row}>
      <InstrumentIconButton label="Snap to grid" icon={Magnet} pressed />
      <InstrumentIconButton label="Show grid" icon={Grid3x3} pressed={false} />
    </div>
  );
}

export function Disabled() {
  return (
    <div style={row}>
      <InstrumentIconButton label="Zoom in" icon={ZoomIn} disabled />
      <InstrumentIconButton label="Run" icon={Play} disabled />
    </div>
  );
}
