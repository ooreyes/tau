/**
 * The layout rule, tested as a pure function instead of through a full app
 * render driving a fake ResizeObserver.
 *
 * The first two cases are carried over verbatim from
 * `components/WorkspaceRightDock.test.tsx`, numbers and all, because this
 * module replaces that one and the numbers are the evidence that the
 * extraction changed nothing. The rest cover what the old shape could not
 * express: that yielding is temporary and never edits what the user asked for.
 */
import { describe, expect, it } from "vitest";
import {
  SHELL_LAYOUT,
  canFitIndependentColumns,
  explorerMax,
  resolveChrome,
  rightColumnMax,
  type ChromeInput,
} from "./resolveChrome";
import { SURFACES } from "./surfaces";

const COMPONENTS = SURFACES.components.width;
const ASSISTANT = SURFACES.assistant.width;

function input(over: Partial<ChromeInput> = {}): ChromeInput {
  return {
    mode: "schematic",
    shellWidth: 1440,
    intent: { explorer: true, components: true, assistant: true },
    widths: {
      explorer: SURFACES.explorer.width.defaultWidth,
      components: COMPONENTS.defaultWidth,
      assistant: ASSISTANT.defaultWidth,
    },
    ...over,
  };
}

describe("independent workspace columns (carried over from WorkspaceRightDock)", () => {
  it("admits both independent columns only when all schematic floors fit", () => {
    expect(canFitIndependentColumns(993, [COMPONENTS.minWidth, ASSISTANT.minWidth])).toBe(false);
    expect(canFitIndependentColumns(994, [COMPONENTS.minWidth, ASSISTANT.minWidth])).toBe(true);

    const assistantWidth = rightColumnMax(1000, "schematic", ASSISTANT, [COMPONENTS.minWidth]);
    const componentsWidth = rightColumnMax(1000, "schematic", COMPONENTS, [assistantWidth]);
    const explorerWidth = explorerMax(1000, [componentsWidth, assistantWidth]);

    expect(assistantWidth).toBe(286);
    expect(componentsWidth).toBe(208);
    expect(explorerWidth).toBe(SHELL_LAYOUT.explorerMin);
  });

  it("keeps the 900px budget exact by showing one independent right column", () => {
    const shellWidth = 900;
    const assistantWidth = Math.min(
      ASSISTANT.defaultWidth,
      rightColumnMax(shellWidth, "schematic", ASSISTANT),
    );
    const explorerWidth = explorerMax(shellWidth, [assistantWidth]);

    expect(assistantWidth).toBe(340);
    expect(explorerWidth).toBe(230);
    expect(
      SHELL_LAYOUT.railWidth +
        SHELL_LAYOUT.handleWidth * 2 +
        SHELL_LAYOUT.schematicEditorMin +
        explorerWidth! +
        assistantWidth,
    ).toBe(shellWidth);
  });
});

describe("resolveChrome", () => {
  it("shows all three columns when there is room", () => {
    const chrome = resolveChrome(input({ shellWidth: 1440 }));
    expect(chrome.explorer.visible).toBe(true);
    expect(chrome.components.visible).toBe(true);
    expect(chrome.assistant.visible).toBe(true);
  });

  it("yields the passive Explorer at the floor, keeping the creation tools", () => {
    const chrome = resolveChrome(input({ shellWidth: 900 }));
    expect(chrome.components.visible).toBe(true);
    expect(chrome.assistant.visible).toBe(true);
    expect(chrome.explorer.visible).toBe(false);
    // The reason is the point. A hidden column that cannot say why is a rail
    // button that silently does nothing.
    expect(chrome.explorer.reason).toBe("yielded-space");
  });

  /**
   * The behaviour the old shape could not have: the floor overrides the user's
   * request for as long as it applies, and stops overriding it the moment it
   * does not. App.tsx used to call `setPartsOpen(false)` at the floor, which
   * destroyed the preference instead of suspending it.
   */
  it("restores a yielded column when the window widens, without being re-asked", () => {
    const narrow = resolveChrome(input({ shellWidth: 900 }));
    expect(narrow.explorer.visible).toBe(false);

    const wide = resolveChrome(input({ shellWidth: 1440 }));
    expect(wide.explorer.visible).toBe(true);
    expect(wide.explorer.reason).toBe("intent");
  });

  it("never reports a column that the current mode does not have", () => {
    const chrome = resolveChrome(input({ mode: "simulator" }));
    expect(chrome.explorer.visible).toBe(false);
    expect(chrome.explorer.reason).toBe("wrong-mode");
    expect(chrome.components.visible).toBe(false);
    expect(chrome.components.reason).toBe("wrong-mode");
    // The assistant is the one column that survives the mode switch.
    expect(chrome.assistant.visible).toBe(true);
  });

  it("distinguishes a column the user closed from one that yielded", () => {
    const chrome = resolveChrome(
      input({ intent: { explorer: true, components: false, assistant: true } }),
    );
    expect(chrome.components.visible).toBe(false);
    expect(chrome.components.reason).toBe("closed");
  });

  it("clamps a persisted width that no longer fits, without losing it", () => {
    const chrome = resolveChrome(
      input({ shellWidth: 900, widths: { explorer: 400, components: 480, assistant: 520 } }),
    );
    expect(chrome.assistant.width).toBeLessThanOrEqual(chrome.assistant.maxWidth!);
    expect(chrome.assistant.width).toBeGreaterThanOrEqual(ASSISTANT.minWidth);
    // Clamping is a view concern: the input width is untouched, so widening
    // the window gives the user their own size back.
  });

  it("treats the pre-measurement frame as fitting so nothing flashes closed", () => {
    const chrome = resolveChrome(input({ shellWidth: 0 }));
    expect(chrome.explorer.visible).toBe(true);
    expect(chrome.components.visible).toBe(true);
    expect(chrome.assistant.visible).toBe(true);
  });
});
