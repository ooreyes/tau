import * as React from 'react';
import { EngineeringInput } from '@tau/desktop';

/** Value + SI-prefix picker. The mantissa and the prefix are separate controls. */
export function ComponentValues() {
  const [r, setR] = React.useState('10k');
  const [c, setC] = React.useState('100n');
  const [l, setL] = React.useState('4.7m');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 280 }}>
      <EngineeringInput label="Resistance" unit="Ω" value={r} onValueChange={setR} />
      <EngineeringInput label="Capacitance" unit="F" value={c} onValueChange={setC} />
      <EngineeringInput label="Inductance" unit="H" value={l} onValueChange={setL} />
    </div>
  );
}

/** A bounded field — stop time must be positive. */
export function Bounded() {
  const [t, setT] = React.useState('20m');
  return (
    <div style={{ width: 280 }}>
      <EngineeringInput
        label="Stop time"
        unit="s"
        value={t}
        onValueChange={setT}
        min={0}
        minExclusive
      />
    </div>
  );
}

/** Optional command field that may sit empty at rest. */
export function AllowEmpty() {
  const [v, setV] = React.useState('');
  return (
    <div style={{ width: 280 }}>
      <EngineeringInput label="At value" unit="V" value={v} onValueChange={setV} allowEmpty />
    </div>
  );
}
