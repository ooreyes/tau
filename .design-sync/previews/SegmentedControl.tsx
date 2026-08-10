import * as React from 'react';
import { SegmentedControl } from '@tau/desktop';

/** Segmented radio group — the toolbar's own control, reused in Settings. */
export function ThemeAndUnits() {
  const [theme, setTheme] = React.useState<'light' | 'dark' | 'system'>('light');
  const [axis, setAxis] = React.useState<'lin' | 'log'>('log');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'flex-start' }}>
      <SegmentedControl
        label="Theme"
        value={theme}
        options={[
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
          { value: 'system', label: 'System' },
        ]}
        onChange={setTheme}
      />
      <SegmentedControl
        label="Frequency axis"
        value={axis}
        options={[
          { value: 'lin', label: 'Linear' },
          { value: 'log', label: 'Log' },
        ]}
        onChange={setAxis}
      />
    </div>
  );
}
