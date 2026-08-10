import * as React from 'react';
import {
  SettingsPage,
  SettingsGroup,
  SettingsRow,
  SettingsNotice,
  SettingsToggle,
  SegmentedControl,
  Readout,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@tau/desktop';

/** The canonical page → group → row composition every Settings surface uses. */
export function SimulationSettings() {
  const [theme, setTheme] = React.useState<'light' | 'dark' | 'system'>('light');
  const [autoRun, setAutoRun] = React.useState(true);
  const [warnUnconnected, setWarnUnconnected] = React.useState(false);
  return (
    <SettingsPage
      title="Simulation"
      summary="Solver defaults applied to every new analysis in this project."
    >
      <SettingsGroup title="Engine" note="Applies to transient, AC, and DC sweeps alike.">
        <SettingsRow label="Integration method" hint="Gear is stiffer; trapezoidal rings less.">
          <Select defaultValue="trap">
            <SelectTrigger>
              <SelectValue placeholder="Method" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="trap">Trapezoidal</SelectItem>
              <SelectItem value="gear">Gear</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow label="Relative tolerance" hint="RELTOL" htmlFor="reltol">
          <Input id="reltol" variant="mono" defaultValue="1e-3" style={{ width: 96 }} />
        </SettingsRow>
        <SettingsToggle
          id="autorun"
          label="Re-run on edit"
          hint="Re-simulate whenever the schematic changes."
          checked={autoRun}
          onChange={setAutoRun}
        />
        <SettingsToggle
          id="warn-unconnected"
          label="Warn on unconnected pins"
          checked={warnUnconnected}
          onChange={setWarnUnconnected}
        />
      </SettingsGroup>

      <SettingsGroup title="Appearance">
        <SettingsRow label="Theme" hint="Light is the product default.">
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
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="This month">
        <SettingsRow label="Solver time">
          <Readout value="41.8" unit="s" label="total" />
        </SettingsRow>
        <SettingsRow label="Analyses run">
          <Readout value="1,284" label="since Jul 1" />
        </SettingsRow>
        <SettingsNotice tone="warning" title="You are billed for cloud solver minutes">
          Runs dispatched to the cloud solver are charged to the API key on the Model
          Configuration page. Local runs are always free.
        </SettingsNotice>
      </SettingsGroup>
    </SettingsPage>
  );
}
