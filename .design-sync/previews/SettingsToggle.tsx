import * as React from 'react';
import { SettingsToggle } from '@tau/desktop';

/** Native checkbox row — checked, unchecked, and with a hint. */
export function States() {
  const [a, setA] = React.useState(true);
  const [b, setB] = React.useState(false);
  const [c, setC] = React.useState(true);
  return (
    <div style={{ width: 460 }}>
      <SettingsToggle id="t1" label="Re-run on edit" hint="Re-simulate whenever the schematic changes." checked={a} onChange={setA} />
      <SettingsToggle id="t2" label="Warn on unconnected pins" checked={b} onChange={setB} />
      <SettingsToggle id="t3" label="Show current arrows" hint="Overlay operating-point current direction on the canvas." checked={c} onChange={setC} />
    </div>
  );
}
