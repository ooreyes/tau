// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  activeSevenSegmentSegments,
  decodeSevenSegmentPattern,
  deriveSevenSegmentDisplayState,
  sevenSegmentPolarityFromValue,
  SEVEN_SEGMENT_DIGIT_PATTERNS,
  SEVEN_SEGMENT_SEGMENTS,
  SevenSegmentDisplay,
  type SevenSegmentNodeVoltages,
  type SevenSegmentSegment,
} from "./SevenSegmentDisplay";

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
});

function voltagesFor(
  activeSegments: readonly SevenSegmentSegment[],
  commonVoltage: number,
  activeVoltage: number,
): SevenSegmentNodeVoltages {
  const active = new Set(activeSegments);
  return Object.fromEntries(
    SEVEN_SEGMENT_SEGMENTS.map((segment) => [segment, active.has(segment) ? activeVoltage : commonVoltage]),
  ) as SevenSegmentNodeVoltages;
}

describe("seven-segment node decoding", () => {
  it.each(Object.entries(SEVEN_SEGMENT_DIGIT_PATTERNS))("recognizes the complete digit %s pattern", (digit, pattern) => {
    const state = deriveSevenSegmentDisplayState(voltagesFor(pattern, 0, 5), 0);
    expect(state.kind).toBe("digit");
    expect(state.digit).toBe(Number(digit));
    expect(state.activeSegments).toEqual(pattern);
  });

  it("supports common-cathode and common-anode voltage polarity", () => {
    const pattern = SEVEN_SEGMENT_DIGIT_PATTERNS[6];
    const cathode = deriveSevenSegmentDisplayState(voltagesFor(pattern, 0, 5), 0);
    const anode = deriveSevenSegmentDisplayState(voltagesFor(pattern, 5, 0), 5, { polarity: "anode" });

    expect(cathode).toMatchObject({ kind: "digit", digit: 6 });
    expect(anode).toMatchObject({ kind: "digit", digit: 6 });
    expect(activeSevenSegmentSegments(voltagesFor(pattern, 0, 5), 0, { polarity: "cathode" })).toEqual(pattern);
    expect(activeSevenSegmentSegments(voltagesFor(pattern, 5, 0), 5, { polarity: "anode" })).toEqual(pattern);
  });

  it("does not illuminate a common-cathode display from reverse drive", () => {
    const pattern = SEVEN_SEGMENT_DIGIT_PATTERNS[8];
    expect(deriveSevenSegmentDisplayState(voltagesFor(pattern, 5, 0), 5)).toMatchObject({
      kind: "blank",
      activeSegments: [],
    });
    expect(sevenSegmentPolarityFromValue("")).toBe("cathode");
    expect(sevenSegmentPolarityFromValue("polarity=anode")).toBe("anode");
    expect(sevenSegmentPolarityFromValue("common anode")).toBe("anode");
    expect(sevenSegmentPolarityFromValue("common cathode")).toBe("cathode");
  });

  it("treats polarity as a direction, not the absolute segment/common delta", () => {
    const pattern = SEVEN_SEGMENT_DIGIT_PATTERNS[4];
    const activeLow = voltagesFor(pattern, 5, 0);
    expect(activeSevenSegmentSegments(activeLow, 5, { polarity: "cathode" })).toEqual([]);
    expect(activeSevenSegmentSegments(activeLow, 5, { polarity: "anode" })).toEqual(pattern);
  });

  it("keeps a blank display distinct from an unavailable result", () => {
    const blank = deriveSevenSegmentDisplayState(voltagesFor([], 0, 5), 0);
    const unavailable = deriveSevenSegmentDisplayState(undefined, undefined);

    expect(blank).toMatchObject({ kind: "blank", digit: null, activeSegments: [] });
    expect(unavailable).toMatchObject({ kind: "no-result", digit: null, activeSegments: [] });
  });

  it.each([
    ["a,b,c,d", ["a", "b", "c", "d"]],
    ["a,g,dp", ["a", "g", "dp"]],
  ] as const)("shows driven segments without inventing a digit for %s", (_name, pattern) => {
    const state = deriveSevenSegmentDisplayState(voltagesFor(pattern, 0, 5), 0);
    expect(state.kind).toBe("invalid");
    expect(state.digit).toBeNull();
    expect(state.activeSegments).toEqual(pattern);
    expect(state.matchingDigits).toEqual([]);
  });

  it("does not call a decimal point a digit by itself", () => {
    expect(decodeSevenSegmentPattern(["dp"])).toMatchObject({
      kind: "invalid",
      digit: null,
      activeSegments: ["dp"],
    });
  });
});

describe("SevenSegmentDisplay rendering", () => {
  it("marks only the solved active segments and exposes the decoded digit", () => {
    const state = deriveSevenSegmentDisplayState(voltagesFor(["a", "b", "d", "e", "g"], 0, 5), 0);
    render(<svg><SevenSegmentDisplay state={state} label="U1" /></svg>);

    const display = screen.getByTestId("seven-segment-display");
    expect(display.getAttribute("data-display-status")).toBe("digit");
    expect(display.getAttribute("data-digit")).toBe("2");
    expect(display.getAttribute("aria-label")).toBe("U1: digit 2");
    expect(display.querySelector('[data-segment="a"]')?.classList.contains("is-active")).toBe(true);
    expect(display.querySelector('[data-segment="c"]')?.classList.contains("is-active")).toBe(false);
  });

  it("keeps the same semantic red lamp classes in light and dark themes", () => {
    const state = deriveSevenSegmentDisplayState(voltagesFor(["b", "c"], 0, 5), 0);
    for (const theme of ["light", "dark"] as const) {
      document.documentElement.dataset.theme = theme;
      const view = render(<svg><SevenSegmentDisplay state={state} /></svg>);
      const display = view.getByTestId("seven-segment-display");
      expect(display.classList.contains("seven-segment-display--digit")).toBe(true);
      expect(display.querySelector('[data-segment="b"]')?.classList.contains("is-active")).toBe(true);
      view.unmount();
    }
  });

  it("labels a stopped/no-result display without showing a number", () => {
    render(<svg><SevenSegmentDisplay state={deriveSevenSegmentDisplayState(undefined, undefined)} /></svg>);
    const display = screen.getByTestId("seven-segment-display");
    expect(display.getAttribute("data-display-status")).toBe("no-result");
    expect(display.hasAttribute("data-digit")).toBe(false);
    expect(display.getAttribute("aria-label")).toBe("7-segment display: no simulation result");
  });
});
