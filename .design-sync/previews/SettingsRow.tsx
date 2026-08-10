import { SettingsRow, Input, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@tau/desktop';

/** Label + optional hint on the left, one control on the right. */
export function WithControls() {
  return (
    <div style={{ width: 460 }}>
      <SettingsRow label="Relative tolerance" hint="RELTOL — Newton convergence bound" htmlFor="reltol">
        <Input id="reltol" variant="mono" defaultValue="1e-3" style={{ width: 96 }} />
      </SettingsRow>
      <SettingsRow label="Integration method">
        <Select defaultValue="trap">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="trap">Trapezoidal</SelectItem>
            <SelectItem value="gear">Gear</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow label="Netlist directory" hint="Written next to the .asc file." />
    </div>
  );
}
