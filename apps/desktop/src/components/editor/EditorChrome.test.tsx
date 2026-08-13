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
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { EditorToolbar } from "./EditorChrome";
import { probeCursor, tagCursor } from "./ToolIcons";
import { useSchematic } from "../../store/useSchematic";

function renderToolbar(
  mode: "schematic" | "simulator" = "schematic",
  overrides: Partial<ComponentProps<typeof EditorToolbar>> = {},
) {
  return render(
    <EditorToolbar
      mode={mode}
      isRunning={false}
      onRun={vi.fn()}
      onStop={vi.fn()}
      onClearScratchpad={vi.fn()}
      onOpenSimulationSetup={vi.fn()}
      {...overrides}
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
  "Erase selection (Delete)",
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
    expect(screen.queryByRole("button", { name: "Stop simulation" })).toBeNull();
  });
});

describe("EditorToolbar truthful transport (P4-19)", () => {
  it("shows an enabled Run while idle and never a dead Stop beside it", () => {
    const onRun = vi.fn();
    renderToolbar("schematic", { onRun });

    const run = screen.getByRole("button", { name: "Run simulation" });
    expect((run as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Stop simulation" })).toBeNull();
    fireEvent.click(run);
    expect(onRun).toHaveBeenCalledOnce();
    expect(document.querySelector(".transport")?.getAttribute("data-state")).toBe("idle");
  });

  it("replaces Run with Stop only while the current run has a cancellation path", () => {
    const onRun = vi.fn();
    const onStop = vi.fn();
    renderToolbar("schematic", { isRunning: true, canStop: true, onRun, onStop });

    expect(screen.queryByRole("button", { name: "Run simulation" })).toBeNull();
    const stop = screen.getByRole("button", { name: "Stop simulation" });
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledOnce();
    expect(onRun).not.toHaveBeenCalled();
    expect(document.querySelector(".transport")?.getAttribute("data-state")).toBe("cancellable");
  });

  it("does not promise Stop for an in-flight analysis without cancellation", () => {
    renderToolbar("schematic", { isRunning: true });
    const run = screen.getByRole("button", { name: "Run simulation" }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Stop simulation" })).toBeNull();
    expect(document.querySelector(".transport")?.getAttribute("data-state")).toBe("running");
  });
});

/**
 * Which control does which job. Pinned because it was WRONG and swapping it back
 * would be an easy accident: the bin used to delete the selection and the eraser
 * used to wipe the sheet, which is backwards against the objects the glyphs
 * depict. You do not put one resistor in the bin, and you cannot rub out a whole
 * schematic. The scope also now grows left-to-right - selection, then document.
 */
describe("EditorToolbar destructive scope (review swap)", () => {
  it("gives the eraser the SELECTION and the bin the WHOLE schematic", () => {
    const onClearScratchpad = vi.fn();
    render(
      <EditorToolbar
        mode="schematic" isRunning={false}
        onRun={vi.fn()} onStop={vi.fn()}
        onClearScratchpad={onClearScratchpad}
        onOpenSimulationSetup={vi.fn()}
      />,
    );
    // One component, selected, so the eraser is live. Inside act() because the
    // eraser's disabled state is derived from the store at render time - without
    // the flush the click lands on a still-disabled button and does nothing,
    // which reads as "the swap did not work".
    act(() => {
      useSchematic.setState({
        components: [{ id: "r1", kind: "resistor", x: 96, y: 96, rotation: 0, value: "1k", label: "R1" }],
        selectedId: "r1", selectedIds: ["r1"],
      });
    });

    const eraser = screen.getByRole("button", { name: "Erase selection (Delete)" });
    const bin = screen.getByRole("button", { name: "Clear schematic" });
    expect(eraser.getAttribute("data-tone")).toBe("eraser");
    expect(bin.getAttribute("data-tone")).toBe("trash");

    // The eraser removes the selected part and does NOT reach for the document.
    act(() => { fireEvent.click(eraser); });
    expect(useSchematic.getState().components).toHaveLength(0);
    expect(onClearScratchpad).not.toHaveBeenCalled();

    // The bin asks App to clear the sheet - it never deletes a part directly.
    act(() => { fireEvent.click(bin); });
    expect(onClearScratchpad).toHaveBeenCalledTimes(1);
  });

  it("disables the eraser with nothing selected, and leaves the bin live", () => {
    useSchematic.setState({ components: [], selectedId: null, selectedIds: [] });
    renderToolbar();
    expect((screen.getByRole("button", { name: "Erase selection (Delete)" }) as HTMLButtonElement).disabled).toBe(true);
    // An empty sheet is still a sheet you may want to reset, so the bin stays on.
    expect((screen.getByRole("button", { name: "Clear schematic" }) as HTMLButtonElement).disabled).toBe(false);
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

describe("tagCursor (P4-05, label affordance)", () => {
  it("degrades to the existing crosshair when tag tokens are unavailable", () => {
    expect(tagCursor()).toBe("crosshair");
  });

  it("puts the hotspot on the tag's short attachment point in an unscaled box", () => {
    document.documentElement.style.setProperty("--tool-tag-ink", "#e0b955");
    document.documentElement.style.setProperty("--tool-steel-ink", "#9aa3ae");
    const cursor = tagCursor();
    expect(cursor).toMatch(/^url\("data:image\/svg\+xml,/);
    const svg = decodeURIComponent(cursor);

    const hotspot = /\)\s+([\d.]+)\s+([\d.]+),\s*crosshair$/.exec(cursor);
    const attachmentPoint = /<path d="M([\d.]+) ([\d.]+) L/.exec(svg);
    expect(hotspot).not.toBeNull();
    expect(attachmentPoint).not.toBeNull();
    expect(Number(hotspot![1])).toBeCloseTo(Number(attachmentPoint![1]), 5);
    expect(Number(hotspot![2])).toBeCloseTo(Number(attachmentPoint![2]), 5);

    // The CSS cursor stays in device pixels while the canvas zooms world
    // geometry. Matching width/height/viewBox keeps its hotspot 1:1 at every
    // canvas zoom rather than scaling it with the schematic.
    const box = /width="(\d+)" height="(\d+)" viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    expect(box).not.toBeNull();
    expect(box![1]).toBe(box![3]);
    expect(box![2]).toBe(box![4]);
    expect(svg).toContain('fill="#e0b955"');
    expect(svg).toContain('fill="#9aa3ae"');
    document.documentElement.style.removeProperty("--tool-tag-ink");
    document.documentElement.style.removeProperty("--tool-steel-ink");
  });
});
