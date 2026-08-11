import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PLOT_PAD, PLOT_WIDTH_FALLBACK, TRACE_EDGE_GUTTER, scopeWidth } from "./plotGeometry";

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe("shared scope geometry", () => {
  /**
   * These three numbers are load-bearing for two panes that stack in one
   * drawer, so a change to any of them is a deliberate visual decision about
   * both. Pinning them here is not a tautology: it is what turns "I nudged the
   * gutter" into a failing test that names the other plot.
   */
  it("pins the frame the bounded plotter and the live scope share", () => {
    expect(PLOT_PAD).toBe(46);
    expect(TRACE_EDGE_GUTTER).toBe(2.5);
    expect(PLOT_WIDTH_FALLBACK).toBe(340);
  });

  /** jsdom has no layout, so an unmeasured pane must still render at 340. */
  it("falls back to the historical width when nothing has been measured", () => {
    expect(scopeWidth({ width: 0, height: 0 })).toBe(PLOT_WIDTH_FALLBACK);
    expect(scopeWidth({ width: -1, height: 0 })).toBe(PLOT_WIDTH_FALLBACK);
    expect(scopeWidth({ width: 1052.4, height: 260 })).toBe(1052);
  });

  /**
   * The failure this guards is silent by nature.
   *
   * `LiveScopePane` used to copy `PLOT_PAD` / `TRACE_EDGE_GUTTER` / the 340
   * fallback out of `SimulationPanel`, with a comment admitting it. Two copies
   * of a geometry constant do not break anything on the day they are written;
   * they break on the day someone tunes one of them, and then the live trace
   * and the bounded trace in the same drawer are simply a couple of pixels out
   * of alignment with no test red anywhere. Importing is the only form of that
   * agreement a later edit cannot silently undo, so re-declaring one of these
   * names in either pane is the thing to fail on.
   */
  it("is the only place either pane declares this geometry", () => {
    for (const file of ["SimulationPanel.tsx", "LiveScopePane.tsx"]) {
      const source = readFileSync(path.join(HERE, file), "utf8");
      for (const name of ["PLOT_PAD", "TRACE_EDGE_GUTTER", "PLOT_WIDTH_FALLBACK"]) {
        expect(
          source,
          `${file} re-declares ${name}; import it from ./plotGeometry instead`,
        ).not.toMatch(new RegExp(`^\\s*(?:export\\s+)?const\\s+${name}\\s*=`, "m"));
      }
      expect(source, `${file} must import the shared geometry`).toContain('from "./plotGeometry"');
    }
  });
});
