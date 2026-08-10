import { PlotAxes, ScopeClip } from '@tau/desktop';

const W = 420;
const H = 200;
const PAD = 36;

/** A linear time axis — the transient scope's frame. */
export function TimeVoltage() {
  return (
    <svg width={W} height={H} role="img" aria-label="Transient axes">
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
    </svg>
  );
}

/** Log frequency, dB magnitude — the Bode frame. */
export function LogFrequency() {
  return (
    <svg width={W} height={H} role="img" aria-label="Bode magnitude axes">
      <PlotAxes
        width={W}
        height={H}
        pad={PAD}
        xMin={10}
        xMax={1e6}
        yMin={-40}
        yMax={6}
        xScale="log"
        xUnit="Hz"
        yUnit="dB"
        xAxisTitle="Frequency"
        yAxisTitle="Magnitude"
      />
    </svg>
  );
}

/** A stacked pane that shares the x-axis with the pane below it. */
export function SharedXAxis() {
  return (
    <svg width={W} height={140} role="img" aria-label="Stacked pane axes">
      <PlotAxes
        width={W}
        height={140}
        pad={PAD}
        xMin={0}
        xMax={0.02}
        yMin={-1}
        yMax={1}
        xUnit="s"
        yUnit="A"
        yAxisTitle="Current"
        showXTicks={false}
      />
    </svg>
  );
}
