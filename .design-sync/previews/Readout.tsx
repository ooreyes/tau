import { Readout } from '@tau/desktop';

/** A number the user reads as data: mono, tabular, unit attached and dimmer. */
export function Values() {
  return (
    <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>
      <Readout value="41.8" unit="s" label="solver time" />
      <Readout value="1,284" label="analyses run" />
      <Readout value="2.4815" unit="V" label="V(out)" />
      <Readout value="1.59155" unit="kHz" label="−3 dB" />
    </div>
  );
}
