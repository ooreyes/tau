import { computeAxisTicks, type AxisScale } from "../simulation/axisTicks";

/**
 * Shared scope chrome: gridlines AT the actual tick positions (not a fixed
 * 6×5 grid), tick-value labels along both edges (SI-prefixed, unit-bearing —
 * "2ms 4ms 6ms", "1V 2V 3V"), a stronger zero-line when zero is in range, and
 * the instrument frame rect. Used by every plot context (TRAN, AC mag/phase,
 * DC sweep, FFT, noise, step families) so they all read from one tick
 * authority ({@link computeAxisTicks}) instead of eight copy-pasted grids.
 *
 * Pure presentation: callers own the domain math (autorange / zoom viewport)
 * and pass the resulting `[min,max]` per axis; this component never touches
 * trace data.
 */
export interface PlotAxesProps {
  width: number;
  height: number;
  pad: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  xScale?: AxisScale;
  yScale?: AxisScale;
  xUnit?: string;
  yUnit?: string;
  /** Target tick counts — lower this as the rendered plot shrinks (see
   *  `axisTicks.pickTickCount`) so labels don't collide at small sizes. */
  targetXTicks?: number;
  targetYTicks?: number;
  /** Suppress the bottom x-axis tick row (e.g. a stacked pane that isn't the
   *  bottom-most one shares its x-axis with the pane below it). */
  showXTicks?: boolean;
}

export function PlotAxes({
  width,
  height,
  pad,
  xMin,
  xMax,
  yMin,
  yMax,
  xScale = "linear",
  yScale = "linear",
  xUnit = "",
  yUnit = "",
  targetXTicks = 5,
  targetYTicks = 5,
  showXTicks = true,
}: PlotAxesProps) {
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const xTicks = computeAxisTicks(xMin, xMax, { scale: xScale, unit: xUnit, targetCount: targetXTicks });
  const yTicks = computeAxisTicks(yMin, yMax, { scale: yScale, unit: yUnit, targetCount: targetYTicks });

  const xPixel = (frac: number) => pad + frac * innerW;
  // Y is inverted: frac 0 (yMin) sits at the bottom of the plot box.
  const yPixel = (frac: number) => height - pad - frac * innerH;

  return (
    <>
      <g className="scope-grid">
        {xTicks.map((t, i) => (
          <line key={`gx${i}`} x1={xPixel(t.frac)} y1={pad} x2={xPixel(t.frac)} y2={height - pad} />
        ))}
        {yTicks.map((t, i) => (
          <line key={`gy${i}`} x1={pad} y1={yPixel(t.frac)} x2={width - pad} y2={yPixel(t.frac)} />
        ))}
      </g>
      {xTicks
        .filter((t) => t.isZero)
        .map((t, i) => (
          <line
            key={`zx${i}`}
            className="scope-axis-zero"
            x1={xPixel(t.frac)}
            y1={pad}
            x2={xPixel(t.frac)}
            y2={height - pad}
          />
        ))}
      {yTicks
        .filter((t) => t.isZero)
        .map((t, i) => (
          <line
            key={`zy${i}`}
            className="scope-axis-zero"
            x1={pad}
            y1={yPixel(t.frac)}
            x2={width - pad}
            y2={yPixel(t.frac)}
          />
        ))}
      <rect className="scope-frame" x={pad} y={pad} width={innerW} height={innerH} />
      <g className="scope-ticks">
        {showXTicks &&
          xTicks.map((t, i) => {
            const px = xPixel(t.frac);
            const anchor = t.frac < 0.06 ? "start" : t.frac > 0.94 ? "end" : "middle";
            const tx = anchor === "start" ? Math.max(px, pad) : anchor === "end" ? Math.min(px, width - pad) : px;
            return (
              <text key={`tx${i}`} className="scope-tick mono-num" textAnchor={anchor} x={tx} y={height - pad + 11}>
                {t.label}
              </text>
            );
          })}
        {yTicks.map((t, i) => {
          const py = yPixel(t.frac);
          const clampedY = Math.min(height - pad - 1, Math.max(pad + 6, py));
          return (
            <text key={`ty${i}`} className="scope-tick mono-num" textAnchor="end" x={pad - 4} y={clampedY + 3}>
              {t.label}
            </text>
          );
        })}
      </g>
    </>
  );
}
