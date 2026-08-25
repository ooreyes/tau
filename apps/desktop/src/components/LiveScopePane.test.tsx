// @vitest-environment jsdom
/**
 * The contract for the live scope.
 *
 * Two kinds of assertion live here and they fail for different reasons. The
 * geometry cases pin a RELATIONSHIP — the newest sample sits at the right edge
 * of whatever box the pane was given — because a scope whose x mapping is wrong
 * does not throw, it draws a complete-looking curve across the wrong fraction
 * of its own axis. The honesty cases pin SENTENCES, because the ring wrapping,
 * the engine decimating and the solver falling behind are three different
 * losses that AGENTS.md forbids presenting as a finished picture, and the only
 * machine-checkable form of "say so" is the exact words.
 *
 * jsdom has no layout, so every rect and every ResizeObserver reports zero
 * unless stubbed. That is a real case (it is what a headless render does, and
 * it is what a pane mounted hidden under `hidden` gets on its first frame), so
 * some cases keep it deliberately; the ones that care about pixels stub it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import {
  DEFAULT_LIVE_SPAN_SECONDS,
  LIVE_SCOPE_HEIGHT,
  LIVE_SCOPE_NAMES,
  LiveScopePane,
  liveScopeGeometry,
  steadyYBounds,
} from "./LiveScopePane";
import {
  LiveSampleRing,
  followingWindow,
  rateReport,
  type LiveRunStatus,
  type TimeWindow,
} from "../simulation/liveRun";
import type { LiveRetention } from "../engine/nativeLive";

/** Mirrors the pane's PLOT_PAD / TRACE_EDGE_GUTTER, which are private to it. */
const PAD = 46;
const GUTTER = 2.5;
const FALLBACK_WIDTH = 340;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Report a fixed layout box for every element, the way a browser would. */
function stubLayout(width: number, height = LIVE_SCOPE_HEIGHT) {
  return vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
}

/** A ring holding one ramp channel over `[0, span]`. */
function rampRing(samples: number, span = DEFAULT_LIVE_SPAN_SECONDS, capacity = 1024): LiveSampleRing {
  const ring = new LiveSampleRing({ channelCount: 1, capacity });
  for (let i = 0; i < samples; i += 1) {
    const t = samples === 1 ? 0 : (i / (samples - 1)) * span;
    ring.push(t, [Math.sin((i / Math.max(1, samples - 1)) * Math.PI * 4)]);
  }
  return ring;
}

const CHANNELS = [{ index: 0, label: "V(out)", unit: "V" }];

function running(solvedCircuitTime: number, achieved: number | null = null, target: number | null = null): LiveRunStatus {
  return { phase: "running", solvedCircuitTime, rate: rateReport(target, achieved) };
}

const stopped = (at: number): LiveRunStatus => ({
  phase: "stopped",
  solvedCircuitTime: at,
  reason: { kind: "user-stopped" },
});

/** The pane with the window it owns held in state, as its owner will hold it. */
function Harness({
  ring,
  status,
  retention = null,
  initialWindow = followingWindow(DEFAULT_LIVE_SPAN_SECONDS),
  onWindow,
}: {
  ring: LiveSampleRing;
  status: LiveRunStatus;
  retention?: LiveRetention | null;
  initialWindow?: TimeWindow;
  onWindow?: (next: TimeWindow) => void;
}) {
  const [timeWindow, setTimeWindow] = useState(initialWindow);
  return (
    <LiveScopePane
      ring={ring}
      channels={CHANNELS}
      timeWindow={timeWindow}
      onWindowChange={(next) => {
        onWindow?.(next);
        setTimeWindow(next);
      }}
      status={status}
      retention={retention}
    />
  );
}

/** Every x the trace path draws to, in viewBox units. */
function traceXs(container: HTMLElement): number[] {
  const d = container.querySelector(".scope-trace")?.getAttribute("d") ?? "";
  return [...d.matchAll(/[ML] (-?[\d.]+) /g)].map((m) => Number(m[1]));
}

const lastTraceX = (container: HTMLElement) => traceXs(container)[traceXs(container).length - 1];

const plot = () => screen.getByRole("img", { name: LIVE_SCOPE_NAMES.plot });
const pane = () => screen.getByRole("group", { name: LIVE_SCOPE_NAMES.pane });

/**
 * A controllable animation-frame clock. The pane reads the ring once per frame
 * and never per sample, so a test that cannot decide when a frame happens
 * cannot tell those two apart.
 */
function frameClock() {
  // Real cancel semantics, not a no-op: "the pane stopped asking for frames"
  // is one of the things under test, and a queue that never forgets a
  // cancelled callback cannot tell that from a pane still animating.
  const queue = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    const id = nextId++;
    queue.set(id, cb);
    return id;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => {
    queue.delete(id);
  }) as typeof cancelAnimationFrame;
  return {
    get pending() {
      return queue.size;
    },
    flush() {
      const due = [...queue.values()];
      queue.clear();
      act(() => {
        for (const cb of due) cb(0);
      });
    },
    restore() {
      globalThis.requestAnimationFrame = originalRequest;
      globalThis.cancelAnimationFrame = originalCancel;
    },
  };
}

describe("live scope geometry", () => {
  it("pins the newest sample to the right edge while following", () => {
    stubLayout(940);
    const { container } = render(<Harness ring={rampRing(200)} status={running(DEFAULT_LIVE_SPAN_SECONDS)} />);

    // Follow mode means the right edge IS the newest sample: the whole point of
    // a live scope is that "now" does not drift away from the frame.
    expect(lastTraceX(container)).toBeCloseTo(940 - PAD - GUTTER, 1);
    expect(traceXs(container)[0]).toBeCloseTo(PAD + GUTTER, 1);
    expect(pane().getAttribute("data-following")).toBe("true");
  });

  it("re-draws the trace when the width arrives from the ResizeObserver alone", () => {
    // The defect this case exists for shipped once already in SimulationPanel: a
    // trace memo that read the measured width but did not list it, so a path
    // built at the 340 fallback stayed inside a 940 viewBox and drew a complete
    // curve across the first quarter of the axis. It is reachable because a
    // pane mounts hidden, the pre-paint layout effect measures a zero box and
    // bails, and the real width then arrives from the observer ALONE — nothing
    // else in the render changes on that path.
    const observers: { cb: ResizeObserverCallback; targets: Element[] }[] = [];
    const original = Reflect.get(globalThis, "ResizeObserver");
    Reflect.set(globalThis, "ResizeObserver", class {
      #entry: { cb: ResizeObserverCallback; targets: Element[] };
      constructor(cb: ResizeObserverCallback) {
        this.#entry = { cb, targets: [] };
        observers.push(this.#entry);
      }
      observe(el: Element) { this.#entry.targets.push(el); }
      unobserve() {}
      disconnect() {}
    });

    try {
      const { container } = render(<Harness ring={rampRing(200)} status={running(DEFAULT_LIVE_SPAN_SECONDS)} />);
      const svg = container.querySelector("svg.scope-svg")!;
      expect(svg.getAttribute("viewBox")).toBe(`0 0 ${FALLBACK_WIDTH} ${LIVE_SCOPE_HEIGHT}`);
      expect(lastTraceX(container)).toBeCloseTo(FALLBACK_WIDTH - PAD - GUTTER, 1);

      const observer = observers.find((o) => o.targets.includes(svg));
      if (!observer) throw new Error("scope svg was never observed");
      act(() => {
        observer.cb(
          [{ target: svg, contentRect: { width: 940, height: LIVE_SCOPE_HEIGHT } } as unknown as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      });

      // Pinned at 891.5 rather than "bigger than before": the stale-width bug
      // leaves it at exactly 291.5, and a loose bound passes on a partial fix.
      expect(svg.getAttribute("viewBox")).toBe(`0 0 940 ${LIVE_SCOPE_HEIGHT}`);
      expect(lastTraceX(container)).toBeCloseTo(940 - PAD - GUTTER, 1);
    } finally {
      if (original) Reflect.set(globalThis, "ResizeObserver", original);
      else Reflect.deleteProperty(globalThis, "ResizeObserver");
    }
  });

  it("renders zero samples, one sample and an unmeasured box without throwing", () => {
    // The real first frame in this app: a pane mounts hidden, so the box is
    // zero and there is nothing in the ring yet. Both are divisions waiting to
    // happen — by the span, by the trace width, by the Y range.
    const empty = render(<Harness ring={new LiveSampleRing({ channelCount: 1 })} status={{ phase: "idle" }} />);
    expect(empty.container.querySelector("svg.scope-svg")?.getAttribute("viewBox"))
      .toBe(`0 0 ${FALLBACK_WIDTH} ${LIVE_SCOPE_HEIGHT}`);
    expect(empty.container.querySelector(".scope-trace")?.getAttribute("d")).toBe("");
    expect(screen.getByText(/No samples yet/)).toBeTruthy();
    cleanup();

    const one = render(<Harness ring={rampRing(1)} status={running(0)} />);
    const d = one.container.querySelector(".scope-trace")?.getAttribute("d") ?? "";
    expect(d.startsWith("M ")).toBe(true);
    expect([...d.matchAll(/[ML] /g)]).toHaveLength(1);
    expect(traceXs(one.container).every(Number.isFinite)).toBe(true);
  });

  it("survives a degenerate zero span instead of dividing by it", () => {
    // Not reachable through `followingWindow` (it throws), but a persisted or
    // hand-built window can carry one, and a NaN axis is a blank pane with no
    // explanation.
    const geometry = liveScopeGeometry({
      ring: rampRing(50),
      channels: CHANNELS,
      timeWindow: { spanSeconds: 0, anchorEndTime: null },
      width: 940,
      height: LIVE_SCOPE_HEIGHT,
    });
    expect(Number.isFinite(geometry.visible.t0)).toBe(true);
    expect(geometry.visible.t1 - geometry.visible.t0).toBeCloseTo(DEFAULT_LIVE_SPAN_SECONDS, 12);
  });

  it("keeps a steady Y axis until the signal leaves it", () => {
    // A live autoscale that re-fits every frame makes a steady trace look like
    // it is breathing. Idempotence is what makes it safe to carry across
    // frames in a ref.
    const wide = { min: -1, max: 1 };
    expect(steadyYBounds(null, wide)).toBe(wide);
    expect(steadyYBounds(wide, { min: -0.9, max: 0.9 })).toBe(wide);
    expect(steadyYBounds(wide, { min: -4, max: 4 })).toEqual({ min: -4, max: 4 });
    expect(steadyYBounds(wide, { min: -0.1, max: 0.1 })).toEqual({ min: -0.1, max: 0.1 });
    expect(steadyYBounds(wide, wide)).toBe(wide);
  });
});

describe("live scope at tight zoom", () => {
  /**
   * Two samples a millisecond apart. Any window narrower than that gap — which
   * is where the timebase knob lands after a few presses, and where a
   * slow-changing trace lives all the time — contains no sample at all, and the
   * only true picture is the segment passing through it.
   */
  const straddled = () => {
    const ring = new LiveSampleRing({ channelCount: 1, capacity: 1024 });
    ring.push(0, [0]);
    ring.push(1e-3, [1]);
    return ring;
  };

  it("draws the segment that crosses a window holding no sample of its own", () => {
    const geometry = liveScopeGeometry({
      ring: straddled(),
      channels: CHANNELS,
      timeWindow: { spanSeconds: 2e-4, anchorEndTime: 6e-4 },
      width: 940,
      height: LIVE_SCOPE_HEIGHT,
    });

    // Pre-clipping the ring by TIME deleted both endpoints of this segment and
    // left an empty path: a line across the whole view, drawn as nothing.
    const [trace] = geometry.traces;
    expect(trace!.pointCount).toBe(2);
    const xs = [...trace!.path.matchAll(/[ML] (-?[\d.]+) /g)].map((m) => Number(m[1]));
    // Cut at the frame, not thrown at the rasteriser: the line spans the full
    // trace band and every coordinate stays inside the plot box.
    expect(xs[0]).toBeCloseTo(PAD + GUTTER, 1);
    expect(xs[1]).toBeCloseTo(940 - PAD - GUTTER, 1);

    const ys = [...trace!.path.matchAll(/[ML] -?[\d.]+ (-?[\d.]+)/g)].map((m) => Number(m[1]));
    // A rising ramp still rises: SVG y grows downward, so the right end is higher
    // up the box. This is what catches a "line" that is really a flat artefact.
    expect(ys[0]).toBeGreaterThan(ys[1]!);
    expect(ys.every((y) => y >= PAD - 1e-9 && y <= LIVE_SCOPE_HEIGHT - PAD + 1e-9)).toBe(true);
  });

  it("renders that crossing in the pane, and says nothing about missing data", () => {
    stubLayout(940);
    const { container } = render(
      <Harness
        ring={straddled()}
        status={running(1e-3)}
        initialWindow={{ spanSeconds: 2e-4, anchorEndTime: 6e-4 }}
      />,
    );
    expect(container.querySelector(".scope-trace")?.getAttribute("d")).not.toBe("");
    expect(traceXs(container)).toHaveLength(2);
    // The window is full of signal, so nothing here may suggest otherwise.
    expect(container.querySelector('[data-notice="window-empty"]')).toBeNull();
  });

  it("draws nothing, and says why, past the newest sample", () => {
    stubLayout(940);
    const { container } = render(
      <Harness
        ring={straddled()}
        status={running(1e-3)}
        initialWindow={{ spanSeconds: 1e-3, anchorEndTime: 5e-3 }}
      />,
    );
    // Nothing has been solved out here yet. Drawing a line into it would be the
    // straddle fix overreaching into invention.
    expect(container.querySelector(".scope-trace")?.getAttribute("d")).toBe("");
    expect(container.querySelector('[data-notice="window-empty"]')?.textContent).toBe(
      "Nothing solved in this window yet — the newest sample is at 1 ms, off the left edge.",
    );
  });

  it("draws nothing, and says why, before the oldest sample still retained", () => {
    stubLayout(940);
    const ring = new LiveSampleRing({ channelCount: 1, capacity: 8 });
    for (let i = 0; i < 40; i += 1) ring.push(i * 1e-4, [i]);
    const { container } = render(
      <Harness
        ring={ring}
        status={running(3.9e-3)}
        initialWindow={{ spanSeconds: 5e-4, anchorEndTime: 1e-3 }}
      />,
    );
    expect(container.querySelector(".scope-trace")?.getAttribute("d")).toBe("");
    // The two facts are separate sentences: this window is empty, AND the ring
    // has thrown away what used to be in it.
    expect(container.querySelector('[data-notice="window-empty"]')?.textContent).toBe(
      "No samples in this window — the oldest one still retained is at 3.2 ms, off the right edge.",
    );
    expect(container.querySelector('[data-notice="window-clipped"]')).toBeTruthy();
  });

  it("finds the neighbouring samples without copying the ring", () => {
    // The cadence design's whole premise: the ring is not React state, and no
    // frame may copy it. Widening the slice by one sample either side is only
    // affordable if it stays a widening — a naive "grab a span either side"
    // would sail past this at any zoom level the user actually reaches.
    const ring = new LiveSampleRing({ channelCount: 1, capacity: 1 << 15 });
    const sampleCount = 20_000;
    for (let i = 0; i < sampleCount; i += 1) ring.push(i * 5e-5, [Math.sin(i / 50)]);

    let copied = 0;
    const realSlice = ring.sliceByTime.bind(ring);
    ring.sliceByTime = (t0: number, t1: number) => {
      const view = realSlice(t0, t1);
      copied += view.times.length;
      return view;
    };

    // A 1 µs window wedged between two samples 50 µs apart: the case that used
    // to blank the pane, and the case with the most to gain from over-slicing.
    const geometry = liveScopeGeometry({
      ring,
      channels: CHANNELS,
      timeWindow: { spanSeconds: 1e-6, anchorEndTime: 0.5 + 2.5e-5 },
      width: 940,
      height: LIVE_SCOPE_HEIGHT,
    });

    expect(geometry.traces[0]!.pointCount).toBe(2);
    expect(copied).toBeLessThanOrEqual(16);
    expect(copied).toBeLessThan(sampleCount / 100);
  });
});

describe("live scope follow, pan and zoom", () => {
  it("leaves follow when the trace is dragged, and offers a visible way back", () => {
    stubLayout(940);
    const seen = vi.fn();
    const { container } = render(
      <Harness ring={rampRing(200)} status={running(DEFAULT_LIVE_SPAN_SECONDS)} onWindow={seen} />,
    );
    // Following: no "go live" control, because there is nowhere to go back to.
    expect(screen.queryByRole("button", { name: LIVE_SCOPE_NAMES.resumeFollow })).toBeNull();

    fireEvent.pointerDown(plot(), { button: 0, pointerId: 3, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(plot(), { pointerId: 3, clientX: 120, clientY: 0 });
    fireEvent.pointerUp(plot(), { pointerId: 3, clientX: 120, clientY: 0 });

    const panned = seen.mock.calls[seen.mock.calls.length - 1]![0] as TimeWindow;
    // Dragging right pulls older samples in, so the pinned right edge is BEFORE
    // the newest sample, and the window is pinned at all — a live scope that
    // yanks the view back to now while you are reading it is unusable.
    expect(panned.anchorEndTime).not.toBeNull();
    expect(panned.anchorEndTime!).toBeLessThan(DEFAULT_LIVE_SPAN_SECONDS);
    expect(pane().getAttribute("data-following")).toBe("false");
    // The trace scrolled by exactly the 120 px dragged: the run starts at t = 0,
    // so its first sample used to sit on the left gutter and now sits 120 px in.
    // The RIGHT end is no longer a "did it scroll" witness, and deliberately so —
    // samples continue past the pinned edge, so the trace runs into the edge and
    // is cut there rather than stopping one sample short of it.
    expect(traceXs(container)[0]).toBeCloseTo(PAD + GUTTER + 120, 0);
    expect(lastTraceX(container)).toBeCloseTo(940 - PAD - GUTTER, 1);

    fireEvent.click(screen.getByRole("button", { name: LIVE_SCOPE_NAMES.resumeFollow }));
    expect((seen.mock.calls[seen.mock.calls.length - 1]![0] as TimeWindow).anchorEndTime).toBeNull();
    expect(pane().getAttribute("data-following")).toBe("true");
    expect(traceXs(container)[0]).toBeCloseTo(PAD + GUTTER, 1);
    expect(lastTraceX(container)).toBeCloseTo(940 - PAD - GUTTER, 1);
  });

  it("pans with the arrow keys, so panning is not a pointer-only gesture", () => {
    stubLayout(940);
    const seen = vi.fn();
    render(<Harness ring={rampRing(200)} status={running(DEFAULT_LIVE_SPAN_SECONDS)} onWindow={seen} />);

    fireEvent.keyDown(plot(), { key: "ArrowLeft" });
    const panned = seen.mock.calls[0]![0] as TimeWindow;
    expect(panned.anchorEndTime).toBeCloseTo(DEFAULT_LIVE_SPAN_SECONDS * 0.9, 12);

    // Right past the newest sample means "take me back to live": there is
    // nothing beyond now to look at.
    fireEvent.keyDown(plot(), { key: "ArrowRight" });
    fireEvent.keyDown(plot(), { key: "ArrowRight" });
    expect((seen.mock.calls[seen.mock.calls.length - 1]![0] as TimeWindow).anchorEndTime).toBeNull();
  });

  it("changes the timebase without changing what is being followed", () => {
    stubLayout(940);
    const seen = vi.fn();
    render(<Harness ring={rampRing(200)} status={running(DEFAULT_LIVE_SPAN_SECONDS)} onWindow={seen} />);

    fireEvent.click(screen.getByRole("button", { name: LIVE_SCOPE_NAMES.zoomOut }));
    const zoomed = seen.mock.calls[0]![0] as TimeWindow;
    expect(zoomed.spanSeconds).toBeCloseTo(DEFAULT_LIVE_SPAN_SECONDS * 2, 12);
    // Deliberate, and it is `zoomWindow`'s documented spec rather than this
    // pane's opinion: "changing the timebase is a knob, not a gesture on the
    // trace, so it preserves follow state". Zooming out on a live run shows
    // more history and stays live.
    expect(zoomed.anchorEndTime).toBeNull();
    expect(pane().getAttribute("data-following")).toBe("true");
    expect(screen.getByText("2 ms")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: LIVE_SCOPE_NAMES.zoomIn }));
    expect((seen.mock.calls[seen.mock.calls.length - 1]![0] as TimeWindow).spanSeconds)
      .toBeCloseTo(DEFAULT_LIVE_SPAN_SECONDS, 12);
  });

  it("zooms a pinned window about what the user is looking at", () => {
    stubLayout(940);
    const seen = vi.fn();
    render(
      <Harness
        ring={rampRing(200, 0.01)}
        status={running(0.01)}
        initialWindow={{ spanSeconds: 1e-3, anchorEndTime: 5e-3 }}
        onWindow={seen}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: LIVE_SCOPE_NAMES.zoomOut }));
    const zoomed = seen.mock.calls[0]![0] as TimeWindow;
    // Centre 4.5 ms stays put: the window grows either side of it, rather than
    // the pinned edge dragging the view off what was being inspected.
    expect(zoomed.anchorEndTime).toBeCloseTo(5.5e-3, 12);
    expect(zoomed.spanSeconds).toBeCloseTo(2e-3, 12);
  });
});

describe("live scope honesty", () => {
  it("says so when the ring has discarded the start of the run, and not before", () => {
    const clock = frameClock();
    try {
      const ring = new LiveSampleRing({ channelCount: 1, capacity: 8 });
      for (let i = 0; i < 8; i += 1) ring.push(i * 1e-4, [i]);
      const { container } = render(
        <Harness ring={ring} status={running(7e-4)} initialWindow={followingWindow(1e-2)} />,
      );
      // Nothing dropped yet: no notice at all, rather than a reassuring
      // "complete" badge that would later become a lie.
      expect(container.querySelector('[data-notice="ring-discard"]')).toBeNull();

      // The buffer wraps mid-run, which the model documents as the NORMAL case
      // at the measured sample rate, not an exotic one.
      for (let i = 8; i < 20; i += 1) ring.push(i * 1e-4, [i]);
      clock.flush();

      const notice = container.querySelector('[data-notice="ring-discard"]');
      expect(notice?.textContent).toMatch(/12 samples before that were discarded/);
      expect(notice?.textContent).toMatch(/^Showing /);
    } finally {
      clock.restore();
    }
  });

  it("reports engine decimation as its own loss, beside the ring's", () => {
    const ring = new LiveSampleRing({ channelCount: 1, capacity: 8 });
    for (let i = 0; i < 20; i += 1) ring.push(i * 1e-4, [i]);
    const retention: LiveRetention = {
      deliveredSamples: 1_000,
      decimatedSamples: 9_000,
      stride: 10,
      skew: 0,
      isWholeRun: false,
    };
    const { container } = render(
      <Harness ring={ring} status={running(1.9e-3)} retention={retention} initialWindow={followingWindow(1e-2)} />,
    );

    const engine = container.querySelector('[data-notice="engine-decimation"]');
    const discard = container.querySelector('[data-notice="ring-discard"]');
    // Two losses, two sentences. They have different causes and different
    // fixes, so merging them into one vague "data missing" would leave the
    // engineer unable to act on either.
    // The words are `describeEngineDecimation`'s, quoted rather than paraphrased
    // so the pane cannot rewrite the model's sentence. Two cumulative counts and
    // no ratio: `stride` describes only the last frame read, so pairing it with
    // a whole-run total used to produce "1 in 1 solved points — 4,102,208 …".
    expect(engine?.textContent).toBe(
      "Showing 1,000 of 10,000 solved points — 9,000 samples the engine solved were never sent to the plot.",
    );
    expect(discard?.textContent).toMatch(/discarded/);
    expect(engine?.textContent).not.toBe(discard?.textContent);
  });

  it("shows no engine notice while the engine has delivered everything", () => {
    const retention: LiveRetention = {
      deliveredSamples: 200,
      decimatedSamples: 0,
      stride: 1,
      skew: 0,
      isWholeRun: true,
    };
    const { container } = render(
      <Harness ring={rampRing(200)} status={running(DEFAULT_LIVE_SPAN_SECONDS)} retention={retention} />,
    );
    expect(container.querySelector('[data-notice="engine-decimation"]')).toBeNull();
  });

  it("renders the achieved rate only, and names the requested one only as a shortfall", () => {
    // Measuring: the honest answer before the estimator has seen enough. The
    // requested 2 must not appear anywhere — printing the target as though it
    // were the timebase is the substitution this pane exists to refuse.
    const { rerender, container } = render(<Harness ring={rampRing(200)} status={running(1e-3, null, 2)} />);
    expect(screen.getByRole("status").textContent).toBe("Running — t = 1 ms, measuring rate…");
    expect(container.textContent).not.toMatch(/2×/);

    rerender(<Harness ring={rampRing(200)} status={running(1e-3, 0.5, 2)} />);
    expect(screen.getByRole("status").textContent)
      .toBe("Running — t = 1 ms, 0.5× circuit s per s (slower than requested)");
    const warning = screen.getByRole("alert");
    expect(warning.textContent).toMatch(/Solver cannot keep up — 0.5× against the 2× requested/);
    expect(warning.textContent).toMatch(/shows what was solved, not the requested timebase/);
  });

  it("does not warn when the solver is keeping up", () => {
    render(<Harness ring={rampRing(200)} status={running(1e-3, 2, 2)} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("never lets a stopped run look like a running one", () => {
    const ring = rampRing(200);
    const { rerender } = render(<Harness ring={ring} status={running(1e-3, 1)} />);
    expect(pane().getAttribute("data-run-phase")).toBe("running");
    expect(screen.getByRole("status").textContent).toBe("Running — t = 1 ms, 1× circuit s per s");

    rerender(<Harness ring={ring} status={stopped(1e-3)} />);
    expect(pane().getAttribute("data-run-phase")).toBe("stopped");
    expect(screen.getByRole("status").textContent).toBe("Stopped.");
    // The rate goes with the run: a measured rate next to a frozen trace reads
    // as a rate the circuit is still achieving.
    expect(screen.queryByText(/circuit s per s/)).toBeNull();
    expect(screen.queryByText(/Live|still being solved|continue solving/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Go live" })).toBeNull();
  });

  it("keeps pinned stopped history explicitly historical", () => {
    const ring = rampRing(200);
    render(<Harness ring={ring} status={stopped(1e-3)} initialWindow={{ spanSeconds: 1e-3, anchorEndTime: 5e-4 }} />);
    expect(screen.getByText(/Stopped — showing retained history/)).toBeTruthy();
    expect(screen.queryByText(/Live|still being solved|continue solving/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Go live" })).toBeNull();
  });

  it("distinguishes each way a run can end", () => {
    const ring = rampRing(200);
    const { rerender } = render(
      <Harness
        ring={ring}
        status={{ phase: "stopped", solvedCircuitTime: 1e-3, reason: { kind: "diverged", atCircuitTime: 1e-3, detail: "timestep too small" } }}
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/solution diverged: timestep too small/);

    rerender(<Harness ring={ring} status={{ phase: "idle" }} />);
    expect(screen.getByRole("status").textContent).toBe("Ready.");
  });

  it("marks a window whose left edge is older than anything retained", () => {
    const ring = new LiveSampleRing({ channelCount: 1, capacity: 8 });
    for (let i = 0; i < 40; i += 1) ring.push(i * 1e-4, [i]);
    const { container } = render(
      // Span far wider than the eight samples still held, pinned so the
      // requested left edge sits inside discarded history.
      <Harness ring={ring} status={running(3.9e-3)} initialWindow={{ spanSeconds: 3e-3, anchorEndTime: 3.9e-3 }} />,
    );
    expect(container.querySelector('[data-notice="window-clipped"]')?.textContent)
      .toMatch(/empty axis, not a flat signal/);
  });
});

describe("live scope update cadence", () => {
  it("redraws once per animation frame, not once per sample", () => {
    stubLayout(940);
    const clock = frameClock();
    try {
      const ring = new LiveSampleRing({ channelCount: 1, capacity: 4096 });
      ring.push(0, [0]);
      const { container } = render(
        <Harness ring={ring} status={running(0)} initialWindow={followingWindow(1)} />,
      );
      clock.flush();
      const before = container.querySelector(".scope-trace")?.getAttribute("d");

      // Five hundred samples land between two frames — the real cadence, where
      // the solver produces ~500k points/s and the display refreshes 60 times
      // a second. Not one of them may cause a render on its own.
      for (let i = 1; i <= 500; i += 1) ring.push(i * 1e-3, [Math.sin(i / 10)]);
      expect(container.querySelector(".scope-trace")?.getAttribute("d")).toBe(before);

      clock.flush();
      const after = container.querySelector(".scope-trace")?.getAttribute("d");
      expect(after).not.toBe(before);
      // One frame caught up with all five hundred: the newest is at the edge.
      expect(lastTraceX(container)).toBeCloseTo(940 - PAD - GUTTER, 1);

      // Exactly one frame is ever outstanding. Frames are dropped, not queued:
      // the next is requested only after the current one has been read.
      expect(clock.pending).toBe(1);
    } finally {
      clock.restore();
    }
  });

  it("stops asking for frames once the run has stopped, after one final read", () => {
    const clock = frameClock();
    try {
      const ring = new LiveSampleRing({ channelCount: 1, capacity: 4096 });
      ring.push(0, [0]);
      const { container, rerender } = render(
        <Harness ring={ring} status={running(0)} initialWindow={followingWindow(1)} />,
      );
      clock.flush();

      // The last samples of a run arrive in the same breath as the stop. A
      // scope that stops reading first shows a trace one frame short of the
      // truth, which is a picture of a run that never happened.
      for (let i = 1; i <= 50; i += 1) ring.push(i * 1e-3, [i]);
      const stale = container.querySelector(".scope-trace")?.getAttribute("d");
      rerender(<Harness ring={ring} status={stopped(0.05)} initialWindow={followingWindow(1)} />);

      expect(container.querySelector(".scope-trace")?.getAttribute("d")).not.toBe(stale);
      expect(clock.pending).toBe(0);
    } finally {
      clock.restore();
    }
  });
});
