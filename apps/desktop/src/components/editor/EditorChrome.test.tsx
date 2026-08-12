// @vitest-environment jsdom
/**
 * TOOLBAR lane - P3-12 (red multimeter probe) and P3-13 (object-like tool strip).
 *
 * Deliberately a new file rather than an addition to components/ShellPanels.test.tsx:
 * that file belongs to the EXPLORER lane and already covers this component's
 * aria-label/disabled contract (:72-175). Case 1 below duplicates the label
 * assertions on purpose - it is the guard that says "swapping nine glyphs did
 * not rename a single control", and it has to live next to the swap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EditorToolbar } from "./EditorChrome";
import { probeCursor } from "./ToolIcons";
import { useSchematic } from "../../store/useSchematic";

function renderToolbar(mode: "schematic" | "simulator" = "schematic") {
  return render(
    <EditorToolbar
      mode={mode}
      isRunning={false}
      onRun={vi.fn()}
      onStop={vi.fn()}
      onClearScratchpad={vi.fn()}
      onOpenSimulationSetup={vi.fn()}
    />,
  );
}

beforeEach(() => {
  // past/future drive Undo/Redo's disabled state, which decides whether the
  // strip's coloured-tool count is measurable at all.
  useSchematic.setState({ past: [], future: [] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const TOOL_LABELS = [
  "Select",
  "Wire",
  "Net label (F4)",
  "Probe",
  "Undo",
  "Redo",
  "Delete selection (Delete)",
  "Clear schematic",
  "Simulation setup",
];

describe("EditorToolbar accessible-name contract", () => {
  it("keeps every tool's accessible name after the P3-13 icon swap", () => {
    renderToolbar();
    for (const label of TOOL_LABELS) {
      expect(screen.getByRole("button", { name: label }), `missing ${label}`).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Run simulation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop simulation" })).toBeTruthy();
  });
});

describe("EditorToolbar tool-object ink (P3-13)", () => {
  it("gives every tool with a real-world counterpart its own tone class", () => {
    renderToolbar();
    // Select and Simulation setup depict no object, so DESIGN_SYSTEM 0.1
    // requires they stay neutral - they carry no tone at all.
    const toned = TOOL_LABELS.filter((l) => l !== "Select" && l !== "Simulation setup");
    for (const label of toned) {
      const btn = screen.getByRole("button", { name: label });
      const tones = [...btn.classList].filter((c) => c.startsWith("tool-"));
      expect(tones, `${label} carries no tone class`).toHaveLength(1);
      expect(btn.getAttribute("data-tone")).toBe(tones[0].slice("tool-".length));
    }
    for (const label of ["Select", "Simulation setup"]) {
      const btn = screen.getByRole("button", { name: label });
      expect([...btn.classList].filter((c) => c.startsWith("tool-"))).toHaveLength(0);
      expect(btn.getAttribute("data-tone")).toBeNull();
    }
  });

  it("spends at least four distinct tones across the strip, so it is not one accent", () => {
    renderToolbar();
    const tones = new Set(
      TOOL_LABELS.map((l) => screen.getByRole("button", { name: l }).getAttribute("data-tone"))
        .filter((t): t is string => Boolean(t)),
    );
    expect(tones.size).toBeGreaterThanOrEqual(4);
  });

  it("paints every tool glyph from a --tool-*-ink token and never a raw colour", () => {
    const { container } = renderToolbar();
    const paints = [...container.querySelectorAll(".editor-icon-btn svg *")]
      .flatMap((el) => [el.getAttribute("fill"), el.getAttribute("stroke")])
      .filter((v): v is string => Boolean(v) && v !== "none");
    expect(paints.length).toBeGreaterThan(0);
    for (const paint of paints) {
      // Every paint slot is either inherited ink, one of the two indirection
      // variables the stylesheet feeds from --tool-*-ink, or another token
      // (the bin's flutes are cut in the toolbar underlay). A literal colour
      // here would escape the token system and design-system-dod-grep.mjs.
      expect(paint, `unexpected paint value ${paint}`).toMatch(/^(currentColor|var\(--[a-z0-9-]+(, currentColor)?\))$/);
    }
  });
});

/**
 * The button draws the METER; the cursor draws the red LEAD.
 *
 * These two used to share a probe glyph, and the review's verdict on it was
 * "looks terrible": at 18 px a lone lead is a coloured tick with no silhouette.
 * The instrument is what identifies the tool in a strip of nine, and the lead is
 * what you touch to a node - so they are two objects, and the tests say so
 * separately.
 */
describe("EditorToolbar probe glyph (P3-12)", () => {
  it("draws the multimeter itself, not a lone lead and not lucide's crosshair", () => {
    renderToolbar();
    const probe = screen.getByRole("button", { name: "Probe" });
    expect(probe.querySelector(".lucide-crosshair")).toBeNull();
    expect(probe.querySelector('[data-tool-icon="multimeter"]')).not.toBeNull();
    // The lead belongs on the cursor; it must not also be on the button.
    expect(probe.querySelector('[data-tool-icon="probe"]')).toBeNull();
    expect(probe.getAttribute("data-tone")).toBe("probe");
  });

  it("keeps the probe enabled in the read-only simulator view, still as the meter", () => {
    renderToolbar("simulator");
    const probe = screen.getByRole("button", { name: "Probe" });
    expect((probe as HTMLButtonElement).disabled).toBe(false);
    expect(probe.querySelector('[data-tool-icon="multimeter"]')).not.toBeNull();
  });
});

/**
 * probeCursor() is consumed from Canvas.tsx (a file this lane does not own), so
 * its contract is pinned here: it must never throw, and it must degrade to the
 * exact string probe mode uses today rather than to an empty cursor.
 */
describe("probeCursor (P3-12, canvas affordance)", () => {
  it("degrades to today's plain crosshair when the tokens are unreadable", () => {
    // jsdom's getComputedStyle returns "" for an unset custom property, which
    // is the same shape as a browser that has not applied the theme yet.
    expect(probeCursor()).toBe("crosshair");
  });

  it("puts the hotspot exactly on the needle tip, read out of the art itself", () => {
    document.documentElement.style.setProperty("--tool-probe-ink", "#ea4f42");
    document.documentElement.style.setProperty("--tool-steel-ink", "#9aa3ae");
    const cursor = probeCursor();
    expect(cursor).toMatch(/^url\("data:image\/svg\+xml,/);
    const svg = decodeURIComponent(cursor);

    /*
     * The alignment is DERIVED from the artwork, not restated from the source.
     *
     * The previous assertion hardcoded `4 4` and explained it as the tip scaled
     * 16 -> 24 - but the tip was at 2.9, so it actually landed at 4.35 and the
     * cursor was a third of a pixel off the point it claimed to mark. An
     * assertion that repeats the implementation's own number cannot catch that.
     * So: parse the needle's first coordinate out of the emitted SVG, parse the
     * declared hotspot, and require them to be equal.
     */
    const hotspot = /\)\s+([\d.]+)\s+([\d.]+),\s*crosshair$/.exec(cursor);
    expect(hotspot).not.toBeNull();
    const needleStart = /<path d="M([\d.]+) ([\d.]+) L/.exec(svg);
    expect(needleStart).not.toBeNull();
    expect(Number(hotspot![1])).toBeCloseTo(Number(needleStart![1]), 5);
    expect(Number(hotspot![2])).toBeCloseTo(Number(needleStart![2]), 5);

    // 1:1 authoring is what keeps that equality true at any size: a viewBox that
    // disagreed with width/height would reintroduce the scaling error.
    const box = /width="(\d+)" height="(\d+)" viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    expect(box).not.toBeNull();
    expect(box![1]).toBe(box![3]);
    expect(box![2]).toBe(box![4]);

    // The tip is steel, the barrel is red - the review asked for a grey tip.
    expect(needleStart).not.toBeNull();
    expect(svg).toMatch(/<path d="M3 3 [^"]*" fill="#9aa3ae"\/>/);
    expect(svg).toContain('fill="#ea4f42"');
    expect(cursor).toMatch(/, crosshair$/);
    document.documentElement.style.removeProperty("--tool-probe-ink");
    document.documentElement.style.removeProperty("--tool-steel-ink");
  });
});
