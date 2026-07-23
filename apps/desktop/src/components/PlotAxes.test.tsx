// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PlotAxes, type PlotAxesProps } from "./PlotAxes";

afterEach(cleanup);

const WIDTH = 340;
const HEIGHT = 230;
const PAD = 46;

function renderAxes(props: Partial<PlotAxesProps> = {}) {
  return render(
    <svg width={WIDTH} height={HEIGHT}>
      <PlotAxes
        width={WIDTH}
        height={HEIGHT}
        pad={PAD}
        xMin={0}
        xMax={1}
        yMin={-5}
        yMax={5}
        yAxisTitle="Voltage"
        yUnit="V"
        {...props}
      />
    </svg>,
  );
}

// X tick labels all sit on this fixed baseline (bottom row); Y tick labels
// don't, including the rightmost X labels which happen to share the same
// text-anchor="end" as every Y label - so filtering on y, not anchor, is what
// actually isolates the X row.
const xTickY = (height: number, pad: number) => String(height - pad + 14);
function selectXTickTexts(container: HTMLElement, height = HEIGHT, pad = PAD): SVGTextElement[] {
  const y = xTickY(height, pad);
  return Array.from(container.querySelectorAll(".scope-tick")).filter(
    (el) => el.getAttribute("y") === y,
  ) as SVGTextElement[];
}

describe("PlotAxes - Y-axis title stays inside the viewBox", () => {
  // The Y title renders as a horizontal caption above the tick-label column -
  // a rotated title cannot fit this chrome (wide tick labels like "150 fV"
  // reach back to x~0, so any vertical title clips or collides).
  it("renders the title as an unrotated caption fully inside the viewBox", () => {
    const { container } = renderAxes();
    const titles = container.querySelectorAll(".scope-axis-title.mono-num");
    const yTitle = Array.from(titles).find((el) => !el.getAttribute("transform") && Number(el.getAttribute("x")) < 46);
    expect(yTitle).toBeTruthy();
    expect(Number(yTitle?.getAttribute("x"))).toBeGreaterThanOrEqual(0);
  });

  it("keeps the caption above the frame, clear of the tick-label rows, at a small pane size too", () => {
    const { container } = renderAxes({ width: 260, height: 160 });
    const titles = container.querySelectorAll(".scope-axis-title.mono-num");
    const yTitle = Array.from(titles).find((el) => !el.getAttribute("transform") && Number(el.getAttribute("x")) < 46);
    const yTick = container.querySelector<SVGTextElement>('.scope-tick[text-anchor="end"]');
    expect(yTitle).toBeTruthy();
    // Caption baseline sits above the frame top (pad), every tick label below it.
    expect(Number(yTitle?.getAttribute("y"))).toBeLessThan(46);
    expect(Number(yTick?.getAttribute("y"))).toBeGreaterThan(Number(yTitle?.getAttribute("y")));
  });
});

describe("PlotAxes - X tick label collision thinning", () => {
  it("thins crowded tick labels so none overlap, while keeping the first and last", () => {
    // A zoomed-in microsecond window: 12 ticks packed into a narrow x range,
    // each with a wide label ("3.121 µs") - exactly the crowding the user saw.
    const { container } = renderAxes({
      xMin: 3.11e-6,
      xMax: 3.14e-6,
      xUnit: "s",
      targetXTicks: 12,
    });
    const allXTicks = selectXTickTexts(container);
    expect(allXTicks.length).toBeGreaterThan(1);

    // Grid lines are drawn for every computed tick regardless of label thinning.
    const gridLines = container.querySelectorAll(".scope-grid line");
    expect(gridLines.length).toBeGreaterThanOrEqual(allXTicks.length);

    const spans = allXTicks.map((el) => {
      const x = Number(el.getAttribute("x"));
      const w = (el.textContent ?? "").length * 7.2;
      const anchor = el.getAttribute("text-anchor");
      if (anchor === "start") return { x0: x, x1: x + w };
      if (anchor === "end") return { x0: x - w, x1: x };
      return { x0: x - w / 2, x1: x + w / 2 };
    });
    spans.sort((a, b) => a.x0 - b.x0);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].x0).toBeGreaterThanOrEqual(spans[i - 1].x1 - 0.01);
    }
  });

  it("always keeps the first and last x tick label even when thinning the rest", () => {
    const { container } = renderAxes({
      xMin: 0,
      xMax: 0.00003,
      xUnit: "s",
      targetXTicks: 12,
    });
    const xTicks = selectXTickTexts(container);
    const xs = xTicks.map((el) => Number(el.getAttribute("x")));
    const gridXs = Array.from(container.querySelectorAll(".scope-grid line")).map((l) =>
      Number(l.getAttribute("x1")),
    );
    expect(Math.min(...xs)).toBeCloseTo(Math.min(...gridXs), 0);
    expect(Math.max(...xs)).toBeCloseTo(Math.max(...gridXs), 0);
  });
});
