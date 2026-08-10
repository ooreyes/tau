import { Input } from '@tau/desktop';

const col: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, width: 260 };
const cap: React.CSSProperties = { fontSize: 11, color: 'var(--muted)' };

export function Variants() {
  return (
    <div style={col}>
      <div style={cap}>default — labels, names, expressions</div>
      <Input defaultValue="Low-pass filter" />
      <div style={cap}>mono — component values and measured numbers</div>
      <Input variant="mono" defaultValue="10k" />
      <Input variant="mono" defaultValue="1.59155e3" />
    </div>
  );
}

export function Sizes() {
  return (
    <div style={col}>
      <Input size="sm" defaultValue="sm — 28 px row" />
      <Input size="default" defaultValue="default — 32 px row" />
    </div>
  );
}

export function States() {
  return (
    <div style={col}>
      <Input placeholder="Node name…" />
      <Input defaultValue="R1" />
      <Input variant="mono" defaultValue="47u" aria-invalid />
      <Input defaultValue="Locked by simulation" disabled />
    </div>
  );
}
