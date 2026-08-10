import { ComponentSymbol } from '@tau/desktop';

/**
 * ComponentSymbol returns bare SVG children (`<line>`, `<path>`, …) with no
 * `<svg>` wrapper and no stroke of its own — it is drawn by the canvas, which
 * supplies both. Rendering it in an HTML container produces nothing, so every
 * cell here mounts it inside an `<svg>` with the canvas's own paint.
 */
function Symbol({ kind, value, ...rest }: { kind: string; value?: string; rotation?: 0 | 90 | 180 | 270; mirrored?: boolean }) {
  return (
    <figure style={{ margin: 0, display: 'grid', justifyItems: 'center', gap: 4 }}>
      <svg
        viewBox="-44 -44 88 88"
        width={80}
        height={80}
        stroke="var(--text)"
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <ComponentSymbol kind={kind as never} value={value} {...rest} />
      </svg>
      <figcaption style={{ fontSize: 10, color: 'var(--muted)' }}>{value ? `${kind} · ${value}` : kind}</figcaption>
    </figure>
  );
}

const grid: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 16 };

export function Passives() {
  return (
    <div style={grid}>
      <Symbol kind="resistor" value="10k" />
      <Symbol kind="capacitor" value="100n" />
      <Symbol kind="polarizedCapacitor" value="47u" />
      <Symbol kind="inductor" value="4.7m" />
    </div>
  );
}

export function Sources() {
  return (
    <div style={grid}>
      <Symbol kind="vsource" value="5" />
      <Symbol kind="isource" value="1m" />
      <Symbol kind="vac" value="1" />
      <Symbol kind="vpulse" value="PULSE(0 5 0 1n 1n 1u 2u)" />
    </div>
  );
}

export function Semiconductors() {
  return (
    <div style={grid}>
      <Symbol kind="diode" value="1N4148" />
      <Symbol kind="led" value="RED" />
      <Symbol kind="zener" value="BZX84C5V1" />
      <Symbol kind="opamp" value="LT1001" />
    </div>
  );
}

/** Rotation and mirroring are how a symbol meets the wires around it. */
export function Orientations() {
  return (
    <div style={grid}>
      <Symbol kind="resistor" value="1k" rotation={0} />
      <Symbol kind="resistor" value="1k" rotation={90} />
      <Symbol kind="diode" value="1N4148" rotation={180} />
      <Symbol kind="diode" value="1N4148" mirrored />
    </div>
  );
}
