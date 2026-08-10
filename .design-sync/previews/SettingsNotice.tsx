import { SettingsNotice } from '@tau/desktop';

/** The statement a user must not skim past. Two tones, lamp on the left. */
export function Tones() {
  return (
    <div style={{ width: 460, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SettingsNotice tone="info" title="Local runs are free">
        The bundled ngspice engine runs on this machine. Nothing leaves your computer unless
        you dispatch a run to the cloud solver.
      </SettingsNotice>
      <SettingsNotice tone="warning" title="You are billed for cloud solver minutes">
        Runs dispatched to the cloud solver are charged to the API key on the Model
        Configuration page.
      </SettingsNotice>
    </div>
  );
}
