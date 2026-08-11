// @vitest-environment jsdom
/**
 * The four focus rules, which are the whole risk in moving the inspector to
 * the selection.
 *
 * This file exists because the reconnaissance pass found that stage 6 breaks
 * zero existing tests, and said so as a finding rather than a reassurance: the
 * shell inventory never selects a component, and the inspector was not in the
 * contract at all, so a green suite proved nothing about any of this. Every
 * assertion below is new coverage, and each one corresponds to a specific way
 * the panel can be wrong while looking completely correct on screen.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SelectionInspector } from "./SelectionInspector";

afterEach(() => cleanup());

const VIEWPORT = { minX: 52, minY: 44, maxX: 1440, maxY: 872 };
const ANCHOR = { minX: 400, minY: 300, maxX: 460, maxY: 340 };

function renderInspector(overrides: Partial<Parameters<typeof SelectionInspector>[0]> = {}) {
  const onDismiss = overrides.onDismiss ?? vi.fn();
  const result = render(
    <SelectionInspector
      anchor={ANCHOR}
      viewport={VIEWPORT}
      title="R1 properties"
      onDismiss={onDismiss}
      {...overrides}
    >
      <label>
        Value
        <input aria-label="Value" defaultValue="1k" />
      </label>
    </SelectionInspector>,
  );
  return { ...result, onDismiss };
}

const panel = () => screen.getByRole("dialog", { name: "R1 properties" });

describe("selection inspector - it is not a modal", () => {
  it("names itself without claiming the rest of the document is inert", () => {
    renderInspector();
    // A Radix Dialog would `aria-hidden` the document for as long as anything
    // is selected, i.e. the entire time you are working, which would make the
    // canvas unreachable to assistive tech. `dialog` with no `aria-modal` is
    // a named surface a screen reader can jump to and nothing more.
    expect(panel().getAttribute("aria-modal")).toBeNull();
  });

  it("leaves the rest of the page reachable", () => {
    const outside = document.createElement("button");
    outside.textContent = "Canvas control";
    document.body.appendChild(outside);
    try {
      renderInspector();
      expect(screen.getByText("Canvas control")).toBeTruthy();
      expect(document.body.getAttribute("aria-hidden")).toBeNull();
    } finally {
      outside.remove();
    }
  });
});

describe("selection inspector - focus", () => {
  it("does not steal focus when a part is selected", () => {
    // The single most likely bug in the whole redesign. If selecting a part
    // moved focus into the panel, pressing `r` next would type the letter r
    // into the value field instead of rotating the part - and every other
    // single-key schematic gesture would break the same way.
    const before = document.activeElement;
    renderInspector();
    expect(document.activeElement).toBe(before);
    expect(panel().contains(document.activeElement)).toBe(false);
  });

  it("does not steal focus when the selection changes to another part", () => {
    const { rerender } = renderInspector();
    rerender(
      <SelectionInspector
        anchor={{ minX: 600, minY: 300, maxX: 660, maxY: 340 }}
        viewport={VIEWPORT}
        title="R2 properties"
        onDismiss={() => {}}
      >
        <input aria-label="Value" defaultValue="2k" />
      </SelectionInspector>,
    );
    expect(document.body.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole("dialog", { name: "R2 properties" }).contains(document.activeElement)).toBe(false);
  });

  it("moves focus to the first field on the explicit keyboard command", () => {
    // The other half of the rule, and it has to be tested in both directions:
    // wrong the first way and single-key gestures break, wrong this way and
    // the inspector is unreachable without a pointer, because rule one means
    // tabbing to it is not enough.
    const { rerender } = renderInspector({ focusSignal: 0 });
    expect(panel().contains(document.activeElement)).toBe(false);

    rerender(
      <SelectionInspector
        anchor={ANCHOR}
        viewport={VIEWPORT}
        title="R1 properties"
        focusSignal={1}
        onDismiss={() => {}}
      >
        <input aria-label="Value" defaultValue="1k" />
      </SelectionInspector>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Value"));
  });

  it("does not put focus on its own close button", () => {
    const { rerender } = renderInspector({ focusSignal: 0 });
    rerender(
      <SelectionInspector
        anchor={ANCHOR}
        viewport={VIEWPORT}
        title="R1 properties"
        focusSignal={1}
        onDismiss={() => {}}
      >
        <input aria-label="Value" defaultValue="1k" />
      </SelectionInspector>,
    );
    // "First focusable" would be the close button, which is a useless place to
    // land: the command was "let me edit this", not "let me dismiss this".
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Close R1 properties" }));
  });
});

describe("selection inspector - Escape", () => {
  it("dismisses when Escape arrives with focus inside", () => {
    const { onDismiss } = renderInspector();
    screen.getByLabelText("Value").focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape when focus is outside, so the canvas keeps it", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    try {
      const { onDismiss } = renderInspector();
      outside.focus();
      fireEvent.keyDown(document, { key: "Escape" });
      // On the canvas, Escape cancels the current tool. A panel that swallowed
      // it document-wide would take that away from every schematic gesture,
      // and the panel is on screen for as long as anything is selected.
      expect(onDismiss).not.toHaveBeenCalled();
    } finally {
      outside.remove();
    }
  });

  it("dismisses the panel without touching the selection", () => {
    // `onDismiss` is a request to hide a readout, not to deselect a part.
    // Conflating them means you cannot get the panel out of the way without
    // losing your place, which is why App keys "closed" by selection rather
    // than clearing the selection here.
    const onDismiss = vi.fn();
    renderInspector({ onDismiss });
    fireEvent.click(screen.getByRole("button", { name: "Close R1 properties" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss.mock.calls[0]).toHaveLength(0);
  });
});

describe("selection inspector - placement", () => {
  it("places itself beside the part, not over it", () => {
    renderInspector();
    const style = panel().style;
    // jsdom reports zero for a measured element, so the panel falls back to
    // its declared size and the placement still resolves - the numbers are
    // exercised properly in anchorPlacement.test.ts. What matters here is
    // that a position was applied at all rather than left at the origin.
    expect(style.left).not.toBe("");
    expect(style.top).not.toBe("");
    expect(Number.parseFloat(style.left)).toBeGreaterThan(ANCHOR.maxX);
  });

  it("draws a leader back to the part when it has to dock", () => {
    renderInspector({ viewport: { minX: 52, minY: 44, maxX: 1440, maxY: 300 } });
    const leader = document.querySelector(".selection-inspector-leader line");
    // A detached panel with no leader is just a panel that happens to be
    // nearby; the line is the only thing saying which part it describes.
    expect(leader).not.toBeNull();
    expect(panel().className).toContain("selection-inspector--dock");
  });

  it("renders nothing at all when there is no selection", () => {
    renderInspector({ anchor: null });
    expect(screen.queryByRole("dialog", { name: "R1 properties" })).toBeNull();
  });

  it("moves from the header with a pointer and clamps to a narrow viewport", () => {
    renderInspector();
    const inspector = panel();
    const header = inspector.querySelector(".selection-inspector-head") as HTMLElement;
    const initialLeft = Number.parseFloat(inspector.style.left);

    fireEvent.pointerDown(header, { button: 0, pointerId: 7, clientX: 500, clientY: 320 });
    expect(header.getAttribute("data-dragging")).toBe("true");
    fireEvent.pointerMove(header, { pointerId: 7, clientX: 620, clientY: 380 });
    expect(Number.parseFloat(inspector.style.left)).toBeGreaterThan(initialLeft);
    fireEvent.pointerUp(header, { pointerId: 7, clientX: 620, clientY: 380 });
    expect(header.getAttribute("data-dragging")).toBeNull();

    fireEvent.pointerDown(header, { button: 0, pointerId: 8, clientX: 620, clientY: 380 });
    fireEvent.pointerMove(header, { pointerId: 8, clientX: -10000, clientY: -10000 });
    expect(Number.parseFloat(inspector.style.left)).toBeGreaterThanOrEqual(VIEWPORT.minX);
    expect(Number.parseFloat(inspector.style.top)).toBeGreaterThanOrEqual(VIEWPORT.minY);
  });

  it("offers keyboard movement without stealing the first-field focus command", () => {
    const { rerender } = renderInspector({ focusSignal: 0 });
    const moveHandle = screen.getByRole("button", { name: "Move R1 properties" });
    moveHandle.focus();
    const initialLeft = Number.parseFloat(panel().style.left);

    fireEvent.keyDown(moveHandle, { key: "ArrowLeft" });
    expect(Number.parseFloat(panel().style.left)).toBe(initialLeft - 16);

    rerender(
      <SelectionInspector
        anchor={ANCHOR}
        viewport={VIEWPORT}
        title="R1 properties"
        focusSignal={1}
        onDismiss={() => {}}
      >
        <input aria-label="Value" defaultValue="1k" />
      </SelectionInspector>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Value"));
  });

  it("keeps a moved panel reachable when the viewport shrinks", () => {
    const { rerender } = renderInspector();
    const inspector = panel();
    const header = inspector.querySelector(".selection-inspector-head") as HTMLElement;
    fireEvent.pointerDown(header, { button: 0, pointerId: 9, clientX: 500, clientY: 320 });
    fireEvent.pointerMove(header, { pointerId: 9, clientX: 1200, clientY: 700 });
    fireEvent.pointerUp(header, { pointerId: 9, clientX: 1200, clientY: 700 });

    rerender(
      <SelectionInspector
        anchor={ANCHOR}
        viewport={{ minX: 52, minY: 44, maxX: 600, maxY: 500 }}
        title="R1 properties"
        onDismiss={() => {}}
      >
        <input aria-label="Value" defaultValue="1k" />
      </SelectionInspector>,
    );
    expect(Number.parseFloat(panel().style.left)).toBeLessThanOrEqual(300);
    expect(Number.parseFloat(panel().style.top)).toBeLessThanOrEqual(160);
  });
});
