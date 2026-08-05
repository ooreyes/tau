import type { ReactNode } from "react";
import { computeAxisTicks, type AxisScale } from "../simulation/axisTicks";

/**
 * Shared scope chrome: gridlines AT the actual tick positions (not a fixed
 * 6×5 grid), tick-value labels along both edges (SI-prefixed, unit-bearing -
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
  /** Persistent axis title (e.g. "Time", "Voltage") - LTspice/Desmos-style. */
  xAxisTitle?: string;
  yAxisTitle?: string;
  /** Target tick counts - lower this as the rendered plot shrinks (see
   *  `axisTicks.pickTickCount`) so labels don't collide at small sizes. */
  targetXTicks?: number;
  targetYTicks?: number;
  /** Suppress the bottom x-axis tick row (e.g. a stacked pane that isn't the
   *  bottom-most one shares its x-axis with the pane below it). */
  showXTicks?: boolean;
  /**
   * Optional right-hand Y axis for mixed V+A panes. When set with a finite
   * `[y2Min,y2Max]` span, tick labels and a unit caption render on the right;
   * gridlines stay on the left axis only (one shared horizontal grid).
   */
  y2Min?: number;
  y2Max?: number;
  y2Unit?: string;
  y2AxisTitle?: string;
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
  xAxisTitle = "Time",
  yAxisTitle = "Value",
  targetXTicks = 5,
  targetYTicks = 5,
  showXTicks = true,
  y2Min,
  y2Max,
  y2Unit = "",
  y2AxisTitle = "Value",
}: PlotAxesProps) {
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const xTicks = computeAxisTicks(xMin, xMax, { scale: xScale, unit: xUnit, targetCount: targetXTicks });
  const yTicks = computeAxisTicks(yMin, yMax, { scale: yScale, unit: yUnit, targetCount: targetYTicks });
  const dualY =
    y2Min !== undefined
    && y2Max !== undefined
    && Number.isFinite(y2Min)
    && Number.isFinite(y2Max)
    && y2Max !== y2Min;
  const y2Ticks = dualY
    ? computeAxisTicks(y2Min, y2Max, { scale: yScale, unit: y2Unit, targetCount: targetYTicks })
    : [];

  const xPixel = (frac: number) => pad + frac * innerW;
  // Y is inverted: frac 0 (yMin) sits at the bottom of the plot box.
  const yPixel = (frac: number) => height - pad - frac * innerH;
  const xLabelGeometry = xTicks.map((tick, index) => {
    const px = xPixel(tick.frac);
    const anchor: "start" | "end" | "middle" =
      tick.frac < 0.06 ? "start" : tick.frac > 0.94 ? "end" : "middle";
    const x = anchor === "start" ? Math.max(px, pad) : anchor === "end" ? Math.min(px, width - pad) : px;
    // The plot's technical font is 11px. 7.2px per glyph is intentionally
    // conservative so a narrow pane thins labels before they visibly collide.
    const estimatedWidth = tick.label.length * 7.2;
    const left = anchor === "start" ? x : anchor === "end" ? x - estimatedWidth : x - estimatedWidth / 2;
    const right = anchor === "start" ? x + estimatedWidth : anchor === "end" ? x : x + estimatedWidth / 2;
    return { tick, index, anchor, x, left, right };
  });
  const visibleXLabelIndices = (() => {
    if (xLabelGeometry.length <= 2) return new Set(xLabelGeometry.map((entry) => entry.index));
    const visible = new Set<number>([xLabelGeometry[0].index]);
    let rightEdge = xLabelGeometry[0].right;
    const final = xLabelGeometry[xLabelGeometry.length - 1];
    for (const entry of xLabelGeometry.slice(1, -1)) {
      if (entry.left >= rightEdge + 4 && entry.right <= final.left - 4) {
        visible.add(entry.index);
        rightEdge = entry.right;
      }
    }
    visible.add(final.index);
    return visible;
  })();

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
          xLabelGeometry.map(({ tick, index, anchor, x }) => {
            if (!visibleXLabelIndices.has(index)) return null;
            return (
              <text key={`tx${index}`} className="scope-tick mono-num" textAnchor={anchor} x={x} y={height - pad + 14}>
                {tick.label}
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
        {y2Ticks.map((t, i) => {
          const py = yPixel(t.frac);
          const clampedY = Math.min(height - pad - 1, Math.max(pad + 6, py));
          return (
            <text
              key={`ty2${i}`}
              className="scope-tick scope-tick-y2 mono-num"
              textAnchor="start"
              x={width - pad + 4}
              y={clampedY + 3}
            >
              {t.label}
            </text>
          );
        })}
      </g>
      {xAxisTitle && (
        <text className="scope-axis-title mono-num" x={pad + innerW / 2} y={height - 6} textAnchor="middle">
          {xUnit ? `${xAxisTitle} (${xUnit})` : xAxisTitle}
        </text>
      )}
      {yAxisTitle && (
        <text
          className="scope-axis-title mono-num"
          x={5}
          y={Math.max(10, pad - 8)}
          textAnchor="start"
        >
          {yUnit ? `${yAxisTitle} (${yUnit})` : yAxisTitle}
        </text>
      )}
      {dualY && y2AxisTitle && (
        <text
          className="scope-axis-title scope-axis-title-y2 mono-num"
          x={width - 5}
          y={Math.max(10, pad - 8)}
          textAnchor="end"
        >
          {y2Unit ? `${y2AxisTitle} (${y2Unit})` : y2AxisTitle}
        </text>
      )}
    </>
  );
}

/**
 * Clips its children (trace `<path>`s) to the plot's inner box. Needed once
 * zoom/pan can put data outside the visible window - without it, an SVG
 * path just keeps drawing past the frame into the tick-label margins
 * (`.scope-svg` uses `overflow: visible` for the zoom-cluster overlay, so
 * nothing else would stop it). `id` must be unique per rendered `<svg>`
 * (pass a `useId()` value) since multiple scope panes can be on screen at once.
 */
export function ScopeClip({
  id,
  width,
  height,
  pad,
  children,
}: {
  id: string;
  width: number;
  height: number;
  pad: number;
  children: ReactNode;
}) {
  return (
    <>
      <defs>
        <clipPath id={id}>
          <rect x={pad} y={pad} width={width - pad * 2} height={height - pad * 2} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id})`}>{children}</g>
    </>
  );
}
