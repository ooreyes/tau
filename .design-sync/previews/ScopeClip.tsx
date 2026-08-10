import { PlotAxes, ScopeClip } from '@tau/desktop';

const W = 420;
const H = 200;
const PAD = 36;

// A decaying ring, drawn as a real polyline so the clip has something to cut.
const pts = Array.from({ length: 400 }, (_, i) => {
  const t = i / 399;
  const v = 2.5 + 3.4 * Math.exp(-t * 4) * Math.sin(2 * Math.PI * 6 * t);
  const x = PAD + t * (W - 2 * PAD);
  const y = H - PAD - ((v + 0.25) / 5.5) * (H - 2 * PAD);
  return `${x.toFixed(1)},${y.toFixed(1)}`;
}).join(' ');

/**
 * ScopeClip is the SVG clip path that keeps trace ink inside the plot frame.
 * It only means anything with a trace running past the axes — here the ring
 * overshoots the y range and is cut at the frame instead of painting over the
 * labels.
 */
export function ClippedTrace() {
  return (
    <svg width={W} height={H} role="img" aria-label="Clipped transient trace">
      <PlotAxes
        width={W}
        height={H}
        pad={PAD}
        xMin={0}
        xMax={0.02}
        yMin={-0.25}
        yMax={5.25}
        xUnit="s"
        yUnit="V"
        xAxisTitle="Time"
        yAxisTitle="Voltage"
      />
      <ScopeClip id="scope-clip-demo" width={W} height={H} pad={PAD}>
        <polyline points={pts} fill="none" stroke="var(--trace-cyan)" strokeWidth={1.5} />
      </ScopeClip>
    </svg>
  );
}
