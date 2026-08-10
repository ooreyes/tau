import { EngineeringTraceReadout } from '@tau/desktop';

// A decaying 1 kHz ring on a 2.5 V rail — 256 points of a real-looking trace.
const times = Array.from({ length: 256 }, (_, i) => (i * 20e-3) / 255);
const values = times.map((t) => 2.5 + 1.8 * Math.exp(-t * 220) * Math.sin(2 * Math.PI * 1000 * t));

const trace = { id: 'v-out', label: 'V(out)', unit: 'V', values };

/** The compact readout that heads a waveform card. */
export function DecayingRing() {
  return (
    <div style={{ width: 420 }}>
      <EngineeringTraceReadout trace={trace} times={times} />
    </div>
  );
}

/** A settled rail — classification changes, the layout does not. */
export function Steady() {
  const steady = { id: 'v-ref', label: 'V(ref)', unit: 'V', values: times.map(() => 2.5) };
  return (
    <div style={{ width: 420 }}>
      <EngineeringTraceReadout trace={steady} times={times} />
    </div>
  );
}
