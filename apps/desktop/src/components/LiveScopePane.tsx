import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

import { Button } from "@/components/ui/button";
import { PlotAxes, ScopeClip } from "./PlotAxes";
import { PLOT_PAD, TRACE_EDGE_GUTTER, scopeWidth } from "./plotGeometry";
import { tickCountsFromSize, useMeasuredSize } from "./useMeasuredSize";
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
 * How tall the live scope's face is.
 *
 * The gutters, the edge inset and the 1:1 viewBox fallback that go with it are
 * NOT declared here: they used to be copied from `SimulationPanel`'s private
 * constants, and they now come from the shared `./plotGeometry`, so a live
 * trace and a bounded one in the same drawer cannot drift apart. The height
 * stays local because it is this pane's own editorial call, not a number the
 * two plots have to agree on.
 */
export const LIVE_SCOPE_HEIGHT = 260;

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
  /** Optional role metadata for derived, separately-scaled instruments. */
  componentId?: string;
  powerRole?: "positive" | "negative" | "current";
  hidden?: boolean;
  powerGround?: boolean;
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
  /**
   * Points actually drawn — what the envelope decimator kept, after the window
   * clip. Diagnostic, not decoration: zero here is the pane's own evidence that
   * this window has nothing to show, which is what the empty-window notice is
   * derived from rather than guessed at.
   */
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
 * How far a neighbour probe may double before it concludes there is no
 * neighbour worth drawing. Sixty-four doublings is 1.8e19 times the ring's mean
 * sample spacing: a sample that far outside the window cannot contribute a
 * visible crossing at any timebase, so the search stops rather than dragging the
 * whole retained side into the slice to reach it.
 */
const NEIGHBOUR_PROBE_DOUBLINGS = 64;

/**
 * The circuit time of the retained sample nearest to `t` on `side`, or `t`
 * itself when that side of `t` holds nothing.
 *
 * This exists because the pane may not add a method to `LiveSampleRing` (that
 * file belongs to the transport), and the only slicing the ring exposes is by
 * time — so "give me one more sample past the edge" has to be asked as "give me
 * a small interval past the edge" and then narrowed. The probe starts at twice
 * the ring's MEAN sample spacing, which for a uniformly-sampled buffer means the
 * very first probe copies about two samples and stops, and doubles from there so
 * a variable-timestep run with a long quiet stretch still finds its neighbour in
 * a handful of steps.
 *
 * The cost is the number of samples inside the first non-empty probe, and not
 * the ring's capacity: every earlier probe covered a strictly smaller interval
 * and came back empty, so this one copies exactly the samples within the winning
 * pad of the edge — two of them, for any stream whose spacing is near its own
 * mean. That is what keeps the per-frame copy the render cadence exists to avoid
 * out of this path. The one exception is honest and named below: once the pad
 * would reach past the oldest (or newest) retained sample there is nothing left
 * to bisect, and the slice takes that whole side — the same copy the pane
 * already makes whenever the window covers the buffer.
 */
function neighbourTime(ring: LiveSampleRing, t: number, side: -1 | 1): number {
  const bound = side < 0 ? ring.earliestRetainedTime : ring.latestTime;
  if (bound === null) return t;
  const distance = side < 0 ? t - bound : bound - t;
  // Nothing retained beyond this edge, so there is no segment to complete and
  // the window needs no widening at all.
  if (!(distance > 0)) return t;

  const span = (ring.latestTime ?? 0) - (ring.earliestRetainedTime ?? 0);
  const meanSpacing = ring.length > 1 && span > 0 ? span / (ring.length - 1) : 0;
  // A ring whose samples all share one timestamp has no spacing to extrapolate
  // from; start small enough that the doubling still lands on the far sample in
  // ten steps rather than jumping past a nearer one.
  let pad = meanSpacing > 0 ? meanSpacing * 2 : distance / 1024;

  for (let probe = 0; probe < NEIGHBOUR_PROBE_DOUBLINGS; probe += 1) {
    // Past the end of the retained samples there is no interval left to narrow:
    // the far bound IS a sample, so widening to it is the answer.
    if (!(pad > 0) || pad >= distance) return bound;
    const view = side < 0 ? ring.sliceByTime(t - pad, t) : ring.sliceByTime(t, t + pad);
    const found = view.times.length;
    if (found > 0) return side < 0 ? view.times[found - 1]! : view.times[0]!;
    pad *= 2;
  }
  // Astronomically far from any sample. Widening would cost a full-side copy to
  // reach a point that cannot be seen; leave the window as asked, and let the
  // empty-window sentence explain the blank axis.
  return t;
}

/**
 * The window's samples plus the first sample beyond each edge.
 *
 * Slicing the ring by the visible window alone throws away the segment that
 * STRADDLES an edge, and a straddling segment is not an edge case: zoom between
 * two samples — inevitable on a slow-changing trace, and the normal state of
 * affairs a few zoom presses in — and every sample is outside the window while
 * the correct picture is a line crossing the whole view. Pre-clipped, the pane
 * drew nothing at all and said nothing about it, which is the blank-instrument
 * failure this file's header forbids.
 *
 * The widening is by TIME because that is the only slice the ring offers, but it
 * is bounded to one sample per side, so it is the by-index padding in disguise
 * rather than a re-slice of the buffer. `waveformEnvelopeIndices` already knows
 * what to do with those two extra samples — it keeps them as its `leading` and
 * `trailing` points precisely so a caller can draw the crossing.
 */
function windowViewWithNeighbours(ring: LiveSampleRing, t0: number, t1: number): LiveSampleView {
  return ring.sliceByTime(neighbourTime(ring, t0, -1), neighbourTime(ring, t1, 1));
}

/** One point of a drawn trace, in circuit time and signal units. */
interface TracePoint {
  time: number;
  value: number;
}

/**
 * Cut the polyline at the window edges instead of letting the SVG clip do it.
 *
 * The clip rect would produce the same picture, but only after the rasteriser
 * has been handed coordinates that can run to 1e9 px at deep zoom — where
 * renderers stop being reliable, and where "blank pane" would have been traded
 * for "wrong line". Cutting here keeps every emitted coordinate inside the plot
 * box, which also means the Y autoscale below fits exactly what is drawn.
 *
 * The cut point is a linear interpolation between two solved samples, which
 * invents nothing: the straight segment between those samples is already the
 * claim the polyline makes, and this only decides where that segment meets the
 * frame. `ScopeClip` stays as the backstop for the Y direction, where the held
 * axis from {@link steadyYBounds} can legitimately be tighter than the data.
 */
function clipTraceToWindow(points: readonly TracePoint[], t0: number, t1: number): TracePoint[] {
  if (points.length === 0) return [];
  const crossing = (a: TracePoint, b: TracePoint, t: number): TracePoint => {
    const dt = b.time - a.time;
    return { time: t, value: dt === 0 ? b.value : a.value + ((b.value - a.value) * (t - a.time)) / dt };
  };

  let lo = 0;
  while (lo < points.length && points[lo]!.time < t0) lo += 1;
  let hi = points.length - 1;
  while (hi >= 0 && points[hi]!.time > t1) hi -= 1;

  if (lo > hi) {
    // Nothing inside: the only thing this window can honestly show is the
    // segment passing through it, and only if it really does pass through.
    const before = points[lo - 1];
    const after = points[lo];
    if (!before || !after || !(after.time > t1)) return [];
    return [crossing(before, after, t0), crossing(before, after, t1)];
  }

  const clipped = points.slice(lo, hi + 1);
  const before = points[lo - 1];
  if (before && clipped[0]!.time > t0) clipped.unshift(crossing(before, clipped[0]!, t0));
  const after = points[hi + 1];
  if (after && clipped[clipped.length - 1]!.time < t1) {
    clipped.push(crossing(clipped[clipped.length - 1]!, after, t1));
  }
  return clipped;
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
  const view = windowViewWithNeighbours(ring, visible.t0, visible.t1);

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
      // The ring's `Float64Array` slices go straight in: `waveformEnvelopeIndices`
      // is declared over `ArrayLike<number>`, so nothing is copied or cast here.
      ? waveformEnvelopeIndices(view.times, values, visible.t0, visible.t1, columns)
      : [];
    const kept: TracePoint[] = [];
    if (values) {
      for (const index of indices) {
        const time = view.times[index];
        const value = values[index];
        if (time === undefined || value === undefined) continue;
        if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
        kept.push({ time, value });
      }
    }
    return { channel, position, points: clipTraceToWindow(kept, visible.t0, visible.t1) };
  });

  // Y from the DECIMATED, WINDOW-CLIPPED samples, not from the raw slice. The
  // envelope keeps the minimum and the maximum of every column, so the extremes
  // are all still present, and this turns an autoscale over half a million
  // samples into one over a few thousand. Clipped, not padded, is what makes the
  // axis describe the window: the neighbour a screen away that only exists to
  // complete a crossing segment must not stretch the scale, but the point where
  // that segment enters the frame is on screen and must fit.
  const yBounds = waveformBounds(
    picked.map(({ points }) => ({ values: points.map((point) => point.value) })),
  );
  const ySpan = yBounds.max - yBounds.min || 1;
  const xSpan = visible.t1 - visible.t0 || 1;

  const traces = picked.map(({ channel, position, points }) => {
    let path = "";
    for (const { time, value } of points) {
      const x = PLOT_PAD + TRACE_EDGE_GUTTER + ((time - visible.t0) / xSpan) * traceWidth;
      const y = height - PLOT_PAD - ((value - yBounds.min) / ySpan) * innerHeight;
      path += `${path === "" ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)} `;
    }
    return {
      channel,
      color: channel.color ?? LIVE_TRACE_COLORS[position % LIVE_TRACE_COLORS.length]!,
      path,
      pointCount: points.length,
    };
  });

  return { width, height, visible, view, yBounds, traces };
}

/**
 * The sentence for a window that draws nothing, and `null` when something is on
 * screen.
 *
 * A blank plot is the one state a scope must never leave unexplained, because a
 * flat empty axis and "you have scrolled somewhere there is no data" look
 * identical. Now that a straddling segment renders, an empty picture means the
 * window really is outside the retained samples, and which side it is outside on
 * is the difference between "wait" and "scroll back" — so the two get different
 * sentences. `null` for an empty ring: "No samples yet" already says that, and
 * two notices for one condition is how a pane starts crying wolf.
 */
export function describeEmptyWindow(
  visible: VisibleWindow,
  data: { latestTime: number | null; earliestRetainedTime: number | null },
  drawnPoints: number,
  formatTime = formatSeconds,
): string | null {
  if (drawnPoints > 0) return null;
  const latest = data.latestTime;
  const earliest = data.earliestRetainedTime;
  if (latest === null || earliest === null) return null;
  if (visible.t0 > latest) {
    return `Nothing solved in this window yet — the newest sample is at ${formatTime(latest)}, off the left edge.`;
  }
  if (visible.t1 < earliest) {
    return `No samples in this window — the oldest one still retained is at ${formatTime(earliest)}, off the right edge.`;
  }
  return "No samples in this window.";
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
  const drawnPoints = geometry.traces.reduce((total, trace) => total + trace.pointCount, 0);
  const emptyWindow =
    channels.length > 0
      ? describeEmptyWindow(
          geometry.visible,
          { latestTime: ring.latestTime, earliestRetainedTime: ring.earliestRetainedTime },
          drawnPoints,
        )
      : null;
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
            // Native live values often carry tiny numerical residue. Keep the
            // instrument labels at human precision instead of printing a
            // solver artifact such as 4.999998 V at the left edge.
            yTickSignificantDigits={4}
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
        {!running ? (
          <span className="text-[11px] leading-4 text-muted-foreground">
            Stopped — showing retained history; no new samples are being solved.
          </span>
        ) : following ? (
          <span className="text-[11px] leading-4 text-muted-foreground">
            Live — newest sample at the right edge.
          </span>
        ) : (
          <>
            <span className="text-[11px] leading-4 text-muted-foreground">
              {`Paused at t = ${formatSeconds(geometry.visible.t1)} — new samples continue solving off-screen.`}
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
      {/*
        No `role="status"` on the sentence below: like the clipped-window one
        after it this is a standing explanation of what the axis is showing, not
        an event, and `runStatusLabel` already owns the one live region here.
      */}
      {emptyWindow && (
        <p data-notice="window-empty" className="m-0 text-[11px] leading-4 text-muted-foreground">
          {emptyWindow}
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
