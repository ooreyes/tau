import * as React from 'react';
import { AxisLimitFields } from '@tau/desktop';

/** Autorange in effect — the picked bounds show as placeholders. */
export function Autorange() {
  const [limits, setLimits] = React.useState<{ yMin: number; yMax: number } | null>(null);
  return (
    <div style={{ width: 340 }}>
      <AxisLimitFields
        label="transient"
        value={limits}
        autoBounds={{ min: -0.25, max: 5.25 }}
        onChange={setLimits}
      />
    </div>
  );
}

/** Manual limits pinned by the user. */
export function ManualLimits() {
  const [limits, setLimits] = React.useState<{ yMin: number; yMax: number } | null>({
    yMin: 0,
    yMax: 5,
  });
  return (
    <div style={{ width: 340 }}>
      <AxisLimitFields
        label="Bode magnitude"
        value={limits}
        autoBounds={{ min: -40, max: 6 }}
        onChange={setLimits}
      />
    </div>
  );
}

export function Disabled() {
  return (
    <div style={{ width: 340 }}>
      <AxisLimitFields label="transient" value={null} autoBounds={null} disabled onChange={() => {}} />
    </div>
  );
}
