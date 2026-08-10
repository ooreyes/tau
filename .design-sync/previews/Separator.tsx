import { Separator } from '@tau/desktop';

const label: React.CSSProperties = { fontSize: 12, color: 'var(--text)' };
const meta: React.CSSProperties = { fontSize: 11, color: 'var(--muted)' };

/** Horizontal hairline between stacked blocks — the common case. */
export function Horizontal() {
  return (
    <div style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={label}>Transient</div>
        <div style={meta}>0 → 20 ms, 10 µs step</div>
      </div>
      <Separator />
      <div>
        <div style={label}>AC sweep</div>
        <div style={meta}>10 Hz → 1 MHz, 20 pts/decade</div>
      </div>
      <Separator />
      <div>
        <div style={label}>DC sweep</div>
        <div style={meta}>V1 0 → 5 V, 50 mV step</div>
      </div>
    </div>
  );
}

/** Vertical rule inside a toolbar row — needs a height from its parent. */
export function Vertical() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 28 }}>
      <span style={label}>V(out)</span>
      <Separator orientation="vertical" />
      <span style={label}>2.48 V</span>
      <Separator orientation="vertical" />
      <span style={meta}>Converged</span>
    </div>
  );
}
