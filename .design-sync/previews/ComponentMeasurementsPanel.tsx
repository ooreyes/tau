import * as React from 'react';
import { ComponentMeasurementsPanel } from '@tau/desktop';

const ramp = (n: number, f: (t: number) => number) =>
  Array.from({ length: n }, (_, i) => f(i / (n - 1)));

const stats = (values: number[]) => {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const average = values.reduce((a, b) => a + b, 0) / values.length;
  const rms = Math.sqrt(values.reduce((a, b) => a + b * b, 0) / values.length);
  return { min, max, average, rms, final: values[values.length - 1] };
};

const series = (id: string, label: string, unit: string, values: number[], kind = 'settled', frequency?: number) => ({
  id,
  label,
  unit,
  values,
  statistics: stats(values),
  classification: frequency ? { kind: 'periodic', frequency } : { kind },
});

const vOut = ramp(64, (t) => 5 * (1 - Math.exp(-t * 6)));
const iR1 = ramp(64, (t) => 0.5e-3 * (1 - Math.exp(-t * 6)));
const vRing = ramp(64, (t) => 2.5 + 1.6 * Math.sin(2 * Math.PI * 4 * t));

const rows = [
  {
    componentId: 'r1',
    ref: 'R1',
    kind: 'resistor',
    voltage: series('r1-v', 'V(R1)', 'V', vOut),
    current: series('r1-i', 'I(R1)', 'A', iR1),
    power: series('r1-p', 'P(R1)', 'W', iR1.map((i, k) => i * vOut[k])),
  },
  {
    componentId: 'c1',
    ref: 'C1',
    kind: 'capacitor',
    voltage: series('c1-v', 'V(C1)', 'V', vRing, 'periodic', 4),
    current: series('c1-i', 'I(C1)', 'A', vRing.map((v) => (v - 2.5) * 1e-4)),
  },
  {
    componentId: 'd1',
    ref: 'D1',
    kind: 'led',
    voltage: series('d1-v', 'V(D1)', 'V', ramp(64, () => 2.1)),
    current: series('d1-i', 'I(D1)', 'A', ramp(64, () => 0.031)),
    advisories: [
      {
        kind: 'direct-led-drive',
        severity: 'warning',
        title: 'LED driven without a series resistor',
        message: 'D1 sits directly across the 5 V rail; 31 mA exceeds its 20 mA rating.',
      },
    ],
  },
] as never;

/** The searchable telemetry grid, standalone. */
export function FullGrid() {
  const [sel, setSel] = React.useState('r1');
  return (
    <div style={{ width: 640 }}>
      <ComponentMeasurementsPanel rows={rows} selectedId={sel} onSelect={(id) => setSel(id ?? '')} maxHeight={320} />
    </div>
  );
}

/** The compact variant used inside the results drawer. */
export function Compact() {
  const [sel, setSel] = React.useState('c1');
  return (
    <div style={{ width: 640 }}>
      <ComponentMeasurementsPanel
        rows={rows}
        selectedId={sel}
        onSelect={(id) => setSel(id ?? '')}
        variant="compact"
        maxHeight={280}
      />
    </div>
  );
}
