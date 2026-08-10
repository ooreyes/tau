import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

import { Button } from "@/components/ui/button";
import { PlotAxes, ScopeClip } from "./PlotAxes";
import { tickCountsFromSize, useMeasuredSize, type MeasuredSize } from "./useMeasuredSize";
import {
  MAX_WAVEFORM_RENDER_POINTS,
  waveformBounds,
  waveformEnvelopeIndices,
  type WaveformBounds,
} from "../simulation/waveform";
import {
  describeDiscardedHistory,
  displayRate,
  formatSeconds,
  isFollowing,
  isRunning,
  panWindow,
  resumeFollow,
  runStatusLabel,
  shouldWarnRateShortfall,
  visibleWindow,
  zoomWindow,
  type LiveRunStatus,
  type LiveSampleRing,
  type LiveSampleView,
  type TimeWindow,
  type VisibleWindow,
} from "../simulation/liveRun";
import { describeEngineDecimation, type LiveRetention } from "../engine/nativeLive";

/**
 * The scrolling live scope: the surface the engineer actually watches while a
 * circuit is energised.
 *
 * Omar's words are the spec: "it should be like if the circuit was just built
 * and they plugged it in … we need the live viewer to be the default. This will
 * allow us to actively see the plot change when the user clicks a button." So
 * this is an instrument on a bench, not a report: the trace advances as the
 * solver produces samples, the time axis scrolls under it, and the engineer can
 * drag back through whatever history is still retained and then step back into
 * the present.
 *
 * ## What this file is NOT allowed to do
 *
 * A live scope's failure mode is not a crash, it is a confident picture of
 * something that never happened, and there are four ways to draw one. Each has
 * a named model function that already knows the truth, and this pane's job is
 * to render that answer rather than to have an opinion:
 *
 * - the ring wrapped and the start of the run is gone → {@link describeDiscardedHistory};
 * - the engine never handed some solved points over → {@link describeEngineDecimation},
 *   which is a DIFFERENT loss with a different cause and gets its own sentence
 *   next to the first, never merged into one vague "some data missing";
 * - the solver is slower than the requested timebase → {@link displayRate} plus
 *   {@link shouldWarnRateShortfall}; the requested rate is never drawn as if it
 *   had been achieved;
 * - the run has stopped → {@link runStatusLabel}, so a frozen trace always says
 *   why it is frozen instead of impersonating a live one.
 *
 * All four are AGENTS.md's "no silent substitution" rule applied to a picture.
 *
 * ## Nothing here is wired in
 *
 * Props in, callbacks out: no store, no Tauri, no engine. The ring is owned by
 * whoever is polling the engine; the window is owned by whoever owns the
 * transport. A later unit drops this pane into the simulator.
 */

/**
 * The accessible names this pane owns.
 *
 * Every one was checked against the names already in use, because the words
 * "Live", "Run" and "Stop" are all overloaded in this app and a duplicate
 * accessible name is a bug for anyone driving the UI by name:
 *
 * - `SHELL.liveControls` = `"Live controls"` — the hand-operable switches on
 *   the canvas, an unrelated feature. Nothing here is named "Live" alone.
 * - `RUN_TRANSPORT_NAMES` owns `"Run this circuit"`, `"Stop this run"`,
 *   `"Run mode"`, `"Live: run continuously"` and the window bound fields;
 *   `"Run simulation"` / `"Stop simulation"` / `"Stop"` belong to the toolbar,
 *   the editor toolbar and the results drawer. This pane deliberately renders
 *   NO transport control, so it collides with none of them.
 * - `"Analysis plotter"`, `"Step family plot"`, `"AC step family plot"` and
 *   `"Waveform detail"` are the bounded plotter's surfaces; this one is the
 *   live one and says so.
 *
 * The plot's name carries its own instructions because panning is the one
 * action here with no button of its own: a name that says "drag or use arrow
 * keys" is how a keyboard user finds out the gesture exists at all.
 */
export const LIVE_SCOPE_NAMES = {
  pane: "Live scope",
  plot: "Live scope trace — drag or use arrow keys to pan through history",
  resumeFollow: "Resume live follow",
  zoomIn: "Zoom in the live timebase",
  zoomOut: "Zoom out the live timebase",
  channels: "Live scope channels",
} as const;

/**
 * Mirrors `SimulationPanel`'s private `PLOT_WIDTH_FALLBACK` / `PLOT_PAD` /
 * `TRACE_EDGE_GUTTER` / `PLOT_HEIGHT`, because they are private to that file
 * and this pane must not fork the geometry.
 *
 * They are copied rather than reinvented: a live trace and a bounded one appear
 * one above the other in the same drawer, so their gutters, their tick bands
 * and their edge insets have to line up to the pixel. The wiring unit's job is
 * to promote these to a shared module and delete this block — see the followUps
 * for this unit.
 */
const PLOT_WIDTH_FALLBACK = 340;
const PLOT_PAD = 46;
const TRACE_EDGE_GUTTER = 2.5;
export const LIVE_SCOPE_HEIGHT = 260;

/** viewBox width for the pane, in CSS pixels once its `<svg>` has been measured. */
function scopeWidth(size: MeasuredSize): number {
  return size.width > 0 ? Math.round(size.width) : PLOT_WIDTH_FALLBACK;
}

/**
 * The visible span a live scope opens at, and the fallback for a degenerate
 * one. A millisecond, for the same reason `RunTransport.DEFAULT_WINDOW_SECONDS`
 * is a millisecond: at the measured ~500k points/s that is roughly five hundred
 * samples, so the very first screen has a shape on it instead of one dot
 * crawling across an empty axis.
 */
export const DEFAULT_LIVE_SPAN_SECONDS = 1e-3;

/** One zoom press. A factor of two is the timebase knob every scope has. */
export const LIVE_ZOOM_FACTOR = 2;

/** Arrow-key pan, as a fraction of the visible span. */
const KEY_PAN_FRACTION = 0.1;

/**
 * Trace colours, in `SimulationPanel`'s `TRACE_SWATCHES` order.
 *
 * Same order on purpose: the live pane and the bounded plotter show the same
 * nets minutes apart, and a net that is green while it runs and red once it
 * stops teaches the engineer to distrust the colour. Tokens, never literals —
 * `scripts/design-system-drift.sh` allows hex only inside App.css's token zone.
 */
const LIVE_TRACE_COLORS: readonly string[] = [
  "var(--trace-green)",
  "var(--trace-red)",
  "var(--trace-cyan)",
  "var(--trace-cream)",
  "var(--trace-purple)",
  "var(--trace-amber)",
];

/** One plotted signal, mapped onto a channel of the ring by index. */
export interface LiveScopeChannel {
  /** Index into `LiveSampleRing`'s channels. */
  index: number;
  label: string;
  /** Axis unit, e.g. `V` or `A`. Only the first channel's unit labels the axis. */
  unit?: string;
  /** Defaults to {@link LIVE_TRACE_COLORS} by position. */
  color?: string;
}

export interface LiveScopePaneProps {
  /** The live buffer. Mutated from outside React by whoever polls the engine. */
  ring: LiveSampleRing;
  channels: readonly LiveScopeChannel[];
  /** The visible timebase. `anchorEndTime === null` is follow mode. */
  timeWindow: TimeWindow;
  onWindowChange: (next: TimeWindow) => void;
  status: LiveRunStatus;
  /**
   * What the engine itself threw away on the way here, when the bridge has
   * reported any. Distinct from the ring's own discard, and reported
   * separately — see {@link describeEngineDecimation}.
   */
  retention?: LiveRetention | null;
  height?: number;
}

// ---------------------------------------------------------------------------
// Geometry — pure, so the mapping is testable without a DOM
// ---------------------------------------------------------------------------

export interface LiveScopeTrace {
  channel: LiveScopeChannel;
  color: string;
  path: string;
  /** Points the envelope decimator kept. Diagnostic, not decoration. */
  pointCount: number;
}

export interface LiveScopeGeometry {
  width: number;
  height: number;
  visible: VisibleWindow;
  /** The retained slice behind the picture, with the truth about it attached. */
  view: LiveSampleView;
  yBounds: WaveformBounds;
  traces: LiveScopeTrace[];
}

/**
 * `waveformEnvelopeIndices` and `waveformBounds` are declared over
 * `ReadonlyArray<number>`, and a `Float64Array` — which is what the ring hands
 * out — is not one: it is missing `concat`, `flat` and `flatMap`, none of which
 * either function calls. Both read only `.length` and `[i]`.
 *
 * The alternative to this cast is `Array.from` on every frame, which at the
 * ring's 2^19 capacity is a half-million-element copy sixty times a second, on
 * top of the copy `sliceByTime` already makes. Requirement 3 of this unit is
 * that the pane not do that. The real fix is one character wider than a cast
 * and lives in `simulation/waveform.ts`, which this unit does not own: widen
 * those parameters to `ArrayLike<number>` and delete this. It is in the
 * followUps.
 */
function indexed(samples: Float64Array): readonly number[] {
  return samples as unknown as readonly number[];
}

/**
 * Resolve the window, take the slice, decimate it to the pixel columns that
 * exist, and map it to a path.
 *
 * Pure and exported because the x mapping is the part of a scope that can be
 * silently wrong: a path that draws a complete-looking curve across the wrong
 * fraction of its own axis still looks like a plot. A test can call this with
 * an explicit width and check where the newest sample landed.
 */
export function liveScopeGeometry(input: {
  ring: LiveSampleRing;
  channels: readonly LiveScopeChannel[];
  timeWindow: TimeWindow;
  width: number;
  height: number;
}): LiveScopeGeometry {
  const { ring, channels, width, height } = input;
  // A span of zero (or NaN) has no timebase to divide by. Substituting the
  // default is safe here and only here: nothing is drawn from the substituted
  // number that could be mistaken for data — an empty axis is an empty axis.
  const spanSeconds =
    Number.isFinite(input.timeWindow.spanSeconds) && input.timeWindow.spanSeconds > 0
      ? input.timeWindow.spanSeconds
      : DEFAULT_LIVE_SPAN_SECONDS;
  const timeWindow: TimeWindow = { spanSeconds, anchorEndTime: input.timeWindow.anchorEndTime };

  const visible = visibleWindow(timeWindow, {
    latestTime: ring.latestTime,
    earliestRetainedTime: ring.earliestRetainedTime,
    hasDiscardedHistory: ring.hasDiscardedHistory(),
  });
  const view = ring.sliceByTime(visible.t0, visible.t1);

  const innerWidth = Math.max(0, width - PLOT_PAD * 2);
  const innerHeight = Math.max(0, height - PLOT_PAD * 2);
  const traceWidth = Math.max(0, innerWidth - TRACE_EDGE_GUTTER * 2);
  // The pixel column count IS the decimation budget: one min/max pair per
  // column is exactly what the display can resolve, and asking for more is work
  // nobody can see. The absolute cap is the same one the bounded plotter uses.
  const columns = Math.max(1, Math.min(MAX_WAVEFORM_RENDER_POINTS, Math.floor(innerWidth)));

  const picked = channels.map((channel, position) => {
    const values = view.channels[channel.index];
    const indices = values
      ? waveformEnvelopeIndices(indexed(view.times), indexed(values), visible.t0, visible.t1, columns)
      : [];
    return { channel, position, values, indices };
  });

  // Y from the DECIMATED samples, not from the raw slice. The envelope keeps
  // the minimum and the maximum of every column, so the extremes are all still
  // present, and this turns an autoscale over half a million samples into one
  // over a few thousand.
  const yBounds = waveformBounds(
    picked.map(({ values, indices }) => ({
      values: values ? indices.map((index) => values[index]!) : [],
    })),
  );
  const ySpan = yBounds.max - yBounds.min || 1;
  const xSpan = visible.t1 - visible.t0 || 1;

  const traces = picked.map(({ channel, position, values, indices }) => {
    let path = "";
    if (values) {
      for (const index of indices) {
        const time = view.times[index];
        const value = values[index];
        if (time === undefined || value === undefined) continue;
        if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
        const x = PLOT_PAD + TRACE_EDGE_GUTTER + ((time - visible.t0) / xSpan) * traceWidth;
        const y = height - PLOT_PAD - ((value - yBounds.min) / ySpan) * innerHeight;
        path += `${path === "" ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)} `;
      }
    }
    return {
      channel,
      color: channel.color ?? LIVE_TRACE_COLORS[position % LIVE_TRACE_COLORS.length]!,
      path,
      pointCount: indices.length,
    };
  });

  return { width, height, visible, view, yBounds, traces };
}

/**
 * How much the Y axis has to change before it is allowed to move.
 *
 * A live autoscale that re-fits every frame makes a steady signal look like it
 * is breathing and makes the tick labels unreadable, so the axis is kept until
 * the data either leaves it or shrinks to less than half of it. Pure, and
 * idempotent by construction — feeding a range back in returns it unchanged —
 * so it is safe to drive from a ref across renders.
 */
export const LIVE_Y_RESCALE_FRACTION = 0.5;

export function steadyYBounds(previous: WaveformBounds | null, next: WaveformBounds): WaveformBounds {
  if (!previous) return next;
  const previousSpan = previous.max - previous.min;
  if (!(previousSpan > 0)) return next;
  const fits = next.min >= previous.min && next.max <= previous.max;
  const fills = next.max - next.min >= previousSpan * LIVE_Y_RESCALE_FRACTION;
  return fits && fills ? previous : next;
}

// ---------------------------------------------------------------------------
// Update cadence
// ---------------------------------------------------------------------------

/**
 * Redraw at most once per animation frame, and only when samples actually
 * arrived.
 *
 * The cadence, and why it is this one: the engine produces up to ~500k
 * points/s and is polled every ~20 ms, so a render per sample is five orders of
 * magnitude more React than the display can show, and even a render per poll is
 * work nobody sees on a 60 Hz screen. The ring is therefore NOT React state at
 * all — it is mutated outside React by whoever polls the engine, and this hook
 * samples it from a `requestAnimationFrame` loop, bumping a counter only when
 * `totalSamples` has moved since the last committed frame. Everything that
 * reads the buffer keys off that counter.
 *
 * Frames are dropped, never queued: the next frame is requested only after the
 * current one has been read, so a slow frame delays the next read instead of
 * building a backlog of renders describing a past the plot has already scrolled
 * past. `requestAnimationFrame` and not `setInterval` for the same reason —
 * the browser stops calling it when the pane is not being painted, which is the
 * back-pressure a hidden tab should get for free.
 *
 * The loop runs only while the run is running. A stopped run still gets one
 * final read (the effect body commits before deciding whether to schedule), so
 * the last samples of a run are on screen rather than one frame short.
 */
function useRingFrames(ring: LiveSampleRing, running: boolean): number {
  const [frame, setFrame] = useState(0);
  const seenRef = useRef(-1);

  useEffect(() => {
    // A different ring, or a run that just started or stopped, always earns a
    // read: two rings can hold the same number of samples and different data.
    seenRef.current = -1;
    let cancelled = false;
    let handle: number | null = null;

    const commit = () => {
      const total = ring.totalSamples;
      if (total === seenRef.current) return;
      seenRef.current = total;
      setFrame((n) => n + 1);
    };

    commit();
    if (!running) return;
    // No frame clock (node, or a jsdom without one): the committed frame still
    // renders, it just does not animate. Nothing here throws for want of it.
    if (typeof requestAnimationFrame !== "function") return;

    const step = () => {
      if (cancelled) return;
      commit();
      handle = requestAnimationFrame(step);
    };
    handle = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      if (handle !== null) cancelAnimationFrame(handle);
    };
  }, [ring, running]);

  return frame;
}

// ---------------------------------------------------------------------------
// The pane
// ---------------------------------------------------------------------------

export function LiveScopePane({
  ring,
  channels,
  timeWindow,
  onWindowChange,
  status,
  retention = null,
  height = LIVE_SCOPE_HEIGHT,
}: LiveScopePaneProps) {
  const clipId = useId();
  const [measureRef, size] = useMeasuredSize<SVGSVGElement>();
  const { targetXTicks, targetYTicks } = tickCountsFromSize(size);
  const plotWidth = scopeWidth(size);
  const running = isRunning(status);
  const frame = useRingFrames(ring, running);
  const following = isFollowing(timeWindow);

  /**
   * `plotWidth` is a dependency because for this memo the width IS the x
   * mapping, not layout: it sets the time→pixel scale and the envelope
   * decimator's column count, while the `<svg viewBox>` and `PlotAxes` below
   * read it directly on every render. Leave it out and the two silently
   * disagree — the axis relabels to the new width while the cached path keeps
   * the old one, which is the defect that shipped in `SimulationPanel` (a
   * complete-looking trace across the first quarter of the axis, last x 291.5
   * inside a 940-wide box). That path is reachable here for the same reason it
   * was there: a pane mounts hidden, `useMeasuredSize`'s pre-paint layout
   * effect sees a zero box and bails, and the real width then arrives from the
   * ResizeObserver ALONE, re-rendering this component and nothing else.
   *
   * `frame` is the data clock: the ring is mutable and deliberately not state,
   * so the frame counter is the only thing that can tell this memo new samples
   * exist. Every other dependency is an ordinary value.
   */
  const geometry = useMemo(
    () => liveScopeGeometry({ ring, channels, timeWindow, width: plotWidth, height }),
    [ring, channels, timeWindow, plotWidth, height, frame],
  );

  // Held across frames so a steady trace keeps a steady axis. Written during
  // render, which is safe because `steadyYBounds` returns its own output
  // unchanged when fed back in.
  const yBoundsRef = useRef<WaveformBounds | null>(null);
  const yBounds = steadyYBounds(yBoundsRef.current, geometry.yBounds);
  yBoundsRef.current = yBounds;

  const latestTime = ring.latestTime ?? 0;
  const panBy = useCallback(
    (deltaSeconds: number) => {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds === 0) return;
      onWindowChange(panWindow(timeWindow, deltaSeconds, latestTime));
    },
    [onWindowChange, timeWindow, latestTime],
  );

  /**
   * Seconds per pixel of the trace band — the inverse of the mapping
   * `liveScopeGeometry` just used, so a drag of N pixels moves the trace by
   * exactly N pixels. Zero-width and zero-span boxes answer 0, which makes
   * dragging a no-op rather than a division by zero.
   */
  const traceWidth = Math.max(0, plotWidth - PLOT_PAD * 2 - TRACE_EDGE_GUTTER * 2);
  const secondsPerPixel =
    traceWidth > 0 ? (geometry.visible.t1 - geometry.visible.t0) / traceWidth : 0;

  const dragRef = useRef<{ pointerId: number; clientX: number } | null>(null);
  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.clientX;
    if (dx === 0) return;
    drag.clientX = event.clientX;
    // Dragging the trace to the right pulls OLDER samples into view, which is
    // how every scope and every map behaves: the content follows the finger.
    panBy(-dx * secondsPerPixel);
  };
  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };
  const onKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = geometry.visible.t1 - geometry.visible.t0;
    panBy((event.key === "ArrowLeft" ? -1 : 1) * step * KEY_PAN_FRACTION);
  };

  const discarded = describeDiscardedHistory(geometry.view);
  const decimated = retention ? describeEngineDecimation(retention) : null;
  const achievedRate = status.phase === "running" ? displayRate(status.rate) : null;
  const requestedRate = status.phase === "running" ? status.rate.targetRate : null;
  const rateShortfall = status.phase === "running" && shouldWarnRateShortfall(status.rate);
  const axisUnit = channels[0]?.unit ?? "V";

  return (
    <section
      role="group"
      aria-label={LIVE_SCOPE_NAMES.pane}
      // A stopped run must never render identically to a running one. The
      // sentence below is the primary signal; this attribute is how the shell
      // (and a test) can tell the two apart without parsing prose.
      data-run-phase={status.phase}
      data-following={following ? "true" : "false"}
      className="scope-shell flex flex-col gap-1.5"
    >
      {/*
        One status line, and it is the model's own sentence. `runStatusLabel`
        already spends `displayRate` on the rate it prints, so a run whose rate
        is not yet measured says "measuring rate…" rather than borrowing the
        target — and a second, separately-worded rate readout beside it would
        be two sources of truth for one number.
      */}
      <p role="status" className="m-0 text-[11px] leading-4 text-muted-foreground">
        {runStatusLabel(status)}
      </p>

      {/*
        The requested rate appears in exactly one place in this pane: inside the
        warning that names it as the thing NOT being achieved. Anywhere else it
        would read as a measurement.
      */}
      {rateShortfall && achievedRate !== null && requestedRate !== null && (
        <p role="alert" className="m-0 text-[11px] leading-4 text-warning">
          {`Solver cannot keep up — ${Number(achievedRate.toPrecision(3))}× against the ${Number(requestedRate.toPrecision(3))}× requested. The trace shows what was solved, not the requested timebase.`}
        </p>
      )}

      <div className="scope-plot-wrap">
        <svg
          ref={measureRef}
          className="scope-svg"
          viewBox={`0 0 ${plotWidth} ${height}`}
          style={{ height }}
          role="img"
          aria-label={LIVE_SCOPE_NAMES.plot}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
        >
          <PlotAxes
            width={plotWidth}
            height={height}
            pad={PLOT_PAD}
            xMin={geometry.visible.t0}
            xMax={geometry.visible.t1}
            yMin={yBounds.min}
            yMax={yBounds.max}
            xUnit="s"
            yUnit={axisUnit}
            xAxisTitle="Time"
            yAxisTitle={axisUnit === "A" ? "Current" : axisUnit === "W" ? "Power" : "Voltage"}
            targetXTicks={targetXTicks}
            targetYTicks={targetYTicks}
          />
          <ScopeClip id={clipId} width={plotWidth} height={height} pad={PLOT_PAD}>
            {geometry.traces.map((trace) => (
              <path
                key={trace.channel.index}
                className="scope-trace"
                stroke={trace.color}
                fill="none"
                d={trace.path}
              />
            ))}
          </ScopeClip>
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {following ? (
          <span className="text-[11px] leading-4 text-muted-foreground">
            Live — newest sample at the right edge.
          </span>
        ) : (
          <>
            <span className="text-[11px] leading-4 text-muted-foreground">
              {`Paused at t = ${formatSeconds(geometry.visible.t1)} — new samples are still being solved off-screen.`}
            </span>
            {/*
              The way back is a visible, labelled button, not a keyboard secret.
              A scope you can scroll off the present and cannot obviously
              scroll back to it is a scope that looks broken.
            */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={LIVE_SCOPE_NAMES.resumeFollow}
              onClick={() => onWindowChange(resumeFollow(timeWindow))}
            >
              Go live
            </Button>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={LIVE_SCOPE_NAMES.zoomOut}
            onClick={() => onWindowChange(zoomWindow(timeWindow, LIVE_ZOOM_FACTOR))}
          >
            −
          </Button>
          <span className="mono-num text-[11px] leading-4 text-muted-foreground">
            {formatSeconds(geometry.visible.t1 - geometry.visible.t0)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={LIVE_SCOPE_NAMES.zoomIn}
            onClick={() => onWindowChange(zoomWindow(timeWindow, 1 / LIVE_ZOOM_FACTOR))}
          >
            +
          </Button>
        </div>
      </div>

      {/*
        Two losses, two sentences, never merged. The ring wrapping and the
        engine decimating have different causes and different fixes (a longer
        buffer versus a slower run or fewer traces), and an engineer who is told
        only "some samples are missing" cannot act on either.
      */}
      {discarded && (
        <p data-notice="ring-discard" role="status" className="m-0 text-[11px] leading-4 text-warning">
          {discarded}
        </p>
      )}
      {decimated && (
        <p data-notice="engine-decimation" role="status" className="m-0 text-[11px] leading-4 text-warning">
          {decimated}
        </p>
      )}
      {geometry.visible.clippedByDiscard && (
        <p data-notice="window-clipped" className="m-0 text-[11px] leading-4 text-muted-foreground">
          The left of this window is older than anything still retained, so it is empty axis, not a flat signal.
        </p>
      )}

      {ring.length === 0 && (
        <p className="m-0 text-[11px] leading-4 text-muted-foreground">
          No samples yet — the trace starts as soon as the circuit is energised.
        </p>
      )}

      {channels.length > 0 && (
        <div className="scope-legend flex flex-wrap gap-3" aria-label={LIVE_SCOPE_NAMES.channels}>
          {geometry.traces.map((trace) => (
            <span
              key={trace.channel.index}
              className="text-[11px] leading-4"
              style={{ color: trace.color }}
            >
              {trace.channel.label}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
