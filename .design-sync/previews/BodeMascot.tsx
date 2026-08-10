import { BodeMascot } from '@tau/desktop';

/**
 * Tau's assistant mark. It paints with `currentColor` and the optional
 * `--bode-body` / `--bode-band` custom properties, so it takes the colour of
 * whatever chrome hosts it.
 */
export function Sizes() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24, color: 'var(--text)' }}>
      <BodeMascot style={{ width: 32 }} />
      <BodeMascot style={{ width: 64 }} />
      <BodeMascot style={{ width: 128 }} />
    </div>
  );
}

/** Tinted by its host — accent chrome, then a muted rail. */
export function Tinted() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
      <BodeMascot style={{ width: 72, color: 'var(--accent)' }} />
      <BodeMascot style={{ width: 72, color: 'var(--muted)' }} />
      <div
        style={{
          ['--bode-body' as string]: 'var(--accent)',
          ['--bode-band' as string]: 'var(--bg)',
          color: 'var(--accent)',
        }}
      >
        <BodeMascot style={{ width: 72 }} />
      </div>
    </div>
  );
}
