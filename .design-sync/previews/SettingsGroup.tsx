import { SettingsGroup, SettingsRow, SettingsToggle, Input } from '@tau/desktop';
import * as React from 'react';

/** A titled band of rows. The note is for the whole band, not one row. */
export function Group() {
  const [on, setOn] = React.useState(true);
  return (
    <div style={{ width: 460 }}>
      <SettingsGroup title="Engine" note="Applies to transient, AC, and DC sweeps alike.">
        <SettingsRow label="Relative tolerance" htmlFor="r">
          <Input id="r" variant="mono" defaultValue="1e-3" style={{ width: 96 }} />
        </SettingsRow>
        <SettingsToggle id="g1" label="Re-run on edit" checked={on} onChange={setOn} />
      </SettingsGroup>
      <SettingsGroup title="Advanced">
        <SettingsRow label="Max Newton iterations" htmlFor="i">
          <Input id="i" variant="mono" defaultValue="100" style={{ width: 96 }} />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
