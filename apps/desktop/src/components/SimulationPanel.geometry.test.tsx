// @vitest-environment jsdom
/**
 * The scope's coordinate system is 1:1 with its rendered box.
 *
 * This is the only file that proves it, and it exists because the rest of the
 * suite structurally cannot. jsdom has no layout: `getBoundingClientRect` and
 * `ResizeObserver` both report zero, so every other plot test runs on the
 * unmeasured fallback path where the viewBox width is the historical 340. That
 * is a real case worth keeping (it is what a headless render does), but it
 * means the measured path - the one every user actually sees - is invisible to
 * assertions taken at face value. A viewBox of the wrong width does not throw;
 * it draws a plot that still looks like a plot, so a green suite says nothing.
 *
 * So: stub the measurement, then assert the geometry follows it. What is being
 * pinned is not a pixel value but a relationship - one user unit is one device
 * pixel - because that relationship is what makes `PLOT_PAD`'s 46 an actual
 * 46px gutter, an 11px tick label render at 11px, and `PlotAxes`'s "7.2px per
 * glyph" collision estimate mean anything.
 *
 * Reversion-checked: hardcoding the viewBox width back to 340 fails
 * "follows the measured width", and dropping the layout-effect measurement
 * from useMeasuredSize fails "measures before the first paint".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { WaveformPlot } from "./SimulationPanel";
import type { AnalysisResult, Trace } from "../simulation/linearTransient";
import { defaultLayout } from "./plotPanes";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Report a fixed layout box for every element, the way a browser would. */
function stubLayout(width: number, height: number) {
  return vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
}

function tranResult(): Extract<AnalysisResult, { ok: true }> {
  const times = Array.from({ length: 40 }, (_, i) => (i / 39) * 0.004);
  const values = times.map((t) => 5 * (1 - Math.exp(-t / 0.001)));
  const trace: Trace = { id: "n1", label: "V(out)", unit: "V", color: "var(--trace-cyan)", values };
  return {
    ok: true,
    title: "tran",
    times,
    traces: [trace],
    currents: [],
    stats: {
      netCount: 1,
      componentCount: 3,
      sampleCount: times.length,
      stopTime: times[times.length - 1],
      stepSize: times[1],
    },
    warnings: [],
    circuit: { nets: [{ id: "n1", label: "out", isGround: false, points: [] }], components: [], warnings: [] } as never,
  };
}

function renderPlot() {
  const result = tranResult();
  return render(
    <WaveformPlot result={result} baseTraces={result.traces} netLabels={[]} paneLayout={defaultLayout(["n1"])} />,
  );
}

function scope(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector<SVGSVGElement>("svg.scope-svg");
  if (!svg) throw new Error("no scope svg rendered");
  return svg;
}

/** The plot's own pad, mirrored from SimulationPanel's PLOT_PAD. */
const PAD = 46;
/** Mirrors TRACE_EDGE_GUTTER: the fixed inset that keeps round caps inside. */
const GUTTER = 2.5;

describe("scope viewBox is 1:1 with the rendered box", () => {
  it("follows the measured width, so one user unit is one device pixel", () => {
    stubLayout(1052, 260);
    const { container } = renderPlot();

    // 1052 is the widest the plotter gets today (.scope-shell max-width 1080
    // less its padding). Under the old fixed 340-unit viewBox this same box
    // applied a 3.1x uniform scale to the entire drawing.
    expect(scope(container).getAttribute("viewBox")).toBe("0 0 1052 260");
  });

  it("puts the axis gutter at PLOT_PAD real pixels on both sides", () => {
    stubLayout(1052, 260);
    const { container } = renderPlot();

    const frame = container.querySelector(".scope-frame");
    expect(frame?.getAttribute("x")).toBe(String(PAD));
    // The frame spans the full width less one gutter a side. Stretched, this
    // 46 became 143px and the two gutters ate 27% of the plotter.
    expect(frame?.getAttribute("width")).toBe(String(1052 - PAD * 2));
  });

  it("keeps the box height fixed as the width grows, instead of scaling it", () => {
    stubLayout(1052, 260);
    const { container } = renderPlot();
    const svg = scope(container);

    // No aspect-ratio anywhere: an aspect-ratio would tie height to width and
    // reintroduce the stretch this whole change removes.
    expect(svg.style.aspectRatio).toBe("");
    expect(svg.style.height).toBe("260px");
  });

  it("re-maps the geometry when the same plot is given a narrower box", () => {
    stubLayout(420, 260);
    const { container } = renderPlot();

    expect(scope(container).getAttribute("viewBox")).toBe("0 0 420 260");
    // The gutter does NOT shrink with the pane: it holds real text, so it
    // stays 46px and simply takes a larger share of a narrow pane.
    expect(container.querySelector(".scope-frame")?.getAttribute("width")).toBe(String(420 - PAD * 2));
  });

  it("measures before the first paint, so no frame renders at the fallback width", () => {
    stubLayout(1052, 260);
    // No ResizeObserver at all: in a browser its first callback lands after
    // the initial paint, so a consumer that feeds the measurement back into
    // its own geometry would flash one frame at 340 and then snap. The
    // synchronous layout-effect measurement is what closes that gap, and
    // removing it makes this assertion fall back to 340.
    const observer = Reflect.get(globalThis, "ResizeObserver");
    Reflect.deleteProperty(globalThis, "ResizeObserver");
    try {
      const { container } = renderPlot();
      expect(scope(container).getAttribute("viewBox")).toBe("0 0 1052 260");
    } finally {
      if (observer) Reflect.set(globalThis, "ResizeObserver", observer);
    }
  });

  it("puts a waveform feature at the same fraction of the frame at any width", () => {
    // Widening a pane must give the same curve more pixels, not a different
    // curve. The trace path is the one place where the width feeds two things
    // at once - the x mapping AND the envelope decimator's column count - so
    // a mistake here reads as a plot that is subtly the wrong shape rather
    // than one that is obviously broken.
    const at = (width: number) => {
      stubLayout(width, 260);
      const { container, unmount } = renderPlot();
      const d = container.querySelector(".scope-trace")?.getAttribute("d") ?? "";
      const xs = [...d.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({
        x: Number(m[1]),
        y: Number(m[2]),
      }));
      unmount();
      vi.restoreAllMocks();
      // Time fraction, not frame fraction. TRACE_EDGE_GUTTER insets the curve
      // by a fixed 2.5px at each end so round line caps stay inside the frame,
      // and a fixed pixel inset is deliberately a different *fraction* of a
      // wide pane than of a narrow one. Dividing by the frame instead of by
      // the trace band would make that correct behaviour look like drift.
      const band = width - PAD * 2 - GUTTER * 2;
      const origin = PAD + GUTTER;
      const first = (xs[0].x - origin) / band;
      const last = (xs[xs.length - 1].x - origin) / band;
      // Half-rise: where the curve first reaches the midpoint of its own
      // vertical extent. A feature of the data rather than of the sampling,
      // so it survives the decimator picking different samples per width.
      const yLo = Math.max(...xs.map((p) => p.y));
      const yHi = Math.min(...xs.map((p) => p.y));
      const halfRise = xs.find((p) => p.y <= yLo - (yLo - yHi) / 2)!;
      return { first, last, halfRise: (halfRise.x - origin) / band };
    };

    const narrow = at(420);
    const wide = at(1052);
    expect(wide.first).toBeCloseTo(narrow.first, 2);
    expect(wide.last).toBeCloseTo(narrow.last, 2);
    expect(wide.halfRise).toBeCloseTo(narrow.halfRise, 2);
  });

  it("falls back to the historical width when there is no layout to measure", () => {
    // Plain jsdom: every rect is zero. A zero-width viewBox is a degenerate
    // plot that still renders rather than throwing, which is exactly the
    // failure this fallback exists to prevent.
    const { container } = renderPlot();
    expect(scope(container).getAttribute("viewBox")).toBe("0 0 340 260");
  });
});
