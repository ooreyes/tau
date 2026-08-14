// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ActivityRail } from "./NavRail";

afterEach(() => cleanup());

const CSS = readFileSync(join(__dirname, "..", "..", "App.css"), "utf8");

/**
 * Declarations of the first rule whose selector is exactly `selector`.
 * Anchored to the line start because App.css quotes selectors inside comments
 * ("search `.statusbar {`") and a plain indexOf finds the prose first.
 */
function ruleBody(selector: string): string {
  const start = CSS.indexOf(`\n${selector} {`);
  expect(start, `${selector} is missing from App.css`).toBeGreaterThan(-1);
  const bodyStart = CSS.indexOf("{", start) + 1;
  return CSS.slice(bodyStart, CSS.indexOf("}", bodyStart));
}

const railProps = {
  mode: "schematic" as const,
  explorerOpen: true,
  partsOpen: false,
  projectOpen: true,
  schematicOpen: true,
  onFocusExplorer: vi.fn(),
  onModeChange: vi.fn(),
  onSearch: vi.fn(),
  onFocusComponents: vi.fn(),
};

describe("ActivityRail shell contract", () => {
  it("keeps four workspace destinations and shows no Settings gear unless the shell supplies one", () => {
    render(<ActivityRail {...railProps} />);

    const rail = screen.getByRole("navigation", { name: "Workspace sections" });
    expect(rail.querySelectorAll(".rail-btn")).toHaveLength(4);
    expect(rail.querySelector(".rail-separator")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
    expect(screen.getByRole("button", { name: "Explorer" }).getAttribute("aria-current")).toBe("page");
  });

  it("keeps every rail destination keyboard-focusable with a tooltip label", () => {
    render(<ActivityRail {...railProps} mode="simulator" explorerOpen={false} partsOpen />);

    for (const label of ["Explorer", "Search", "Components", "Waveforms"]) {
      const button = screen.getByRole("button", { name: label });
      expect(button.getAttribute("type")).toBe("button");
      expect(button.classList.contains("rail-btn")).toBe(true);
    }
  });
});

/**
 * CHROME-2/3: Settings moved out of the status strip's lower-right utility and
 * into the foot of the rail, and that foot is now a designed block rather than
 * the leftover the screenshot showed.
 */
describe("ActivityRail foot", () => {
  it("puts Settings at the bottom of the rail, above the foot rule, and still calls the shell", () => {
    const onOpenSettings = vi.fn();
    render(<ActivityRail {...railProps} onOpenSettings={onOpenSettings} />);

    const rail = screen.getByRole("navigation", { name: "Workspace sections" });
    const settings = screen.getByRole("button", { name: "Settings" });
    const foot = settings.closest(".rail-foot");
    expect(foot, "Settings is not inside a rail foot group").toBeTruthy();
    // Pinned to the bottom: the foot is the rail's last child, so nothing can
    // render below it, and Settings is the last thing in the tab order.
    expect(rail.lastElementChild).toBe(foot);
    const buttons = [...rail.querySelectorAll("button")];
    expect(buttons[buttons.length - 1]).toBe(settings);

    // ...and it sits ABOVE the foot's hairline, which terminates the rail.
    const rule = foot?.querySelector(".rail-separator");
    expect(rule, "the foot has no terminating rule").toBeTruthy();
    expect(
      settings.compareDocumentPosition(rule as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(settings);
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("keeps the foot control at or above the 24px hit floor", () => {
    render(<ActivityRail {...railProps} onOpenSettings={vi.fn()} />);
    // Not asserted against a literal: the size comes from the shared .rail-btn
    // rule, so this fails if that rule ever drops under the WCAG 2.2 floor.
    const railBtn = ruleBody(".rail-btn");
    const width = Number(/width:\s*(\d+)px/.exec(railBtn)?.[1]);
    const height = Number(/height:\s*(\d+)px/.exec(railBtn)?.[1]);
    expect(screen.getByRole("button", { name: "Settings" }).classList.contains("rail-btn")).toBe(true);
    expect(Math.min(width, height)).toBeGreaterThanOrEqual(24);
  });

  it("resolves the bottom-left corner: the rail runs to the window edge and rounds with it", () => {
    const rail = ruleBody(".activity-rail");
    // The rail reaches through the strip the shell reserves for the status bar,
    // so the corner belongs to the rail's foot instead of being an empty gap.
    expect(rail).toMatch(/margin-bottom:\s*calc\(-1 \* var\(--status-bar-height\)\)/);
    expect(rail).toMatch(/padding:[^;]*var\(--status-bar-height\)/);

    // The foot is pinned, and its hairline spans the rail rather than being the
    // inset 28px stub used between destination groups.
    expect(ruleBody(".rail-foot")).toMatch(/margin-top:\s*auto/);
    const footRule = ruleBody(".rail-foot .rail-separator");
    expect(footRule).toMatch(/width:\s*100%/);
    expect(ruleBody(".rail-separator")).not.toMatch(/width:\s*100%/);

    // And the status strip starts where the rail ends, so two translucent veils
    // never stack into a darker patch in that corner.
    const statusbar = ruleBody(".statusbar");
    expect(statusbar).toMatch(/left:\s*var\(--rail-width\)/);

    // The foot rule and the strip's border-top are one line, so they must be
    // one weight - taken from the strip rather than restated.
    const strokeWeight = /border-top:\s*([\d.]+)px/.exec(statusbar)?.[1];
    expect(strokeWeight, "the status strip has no border-top to match").toBeTruthy();
    expect(footRule).toContain(`height: ${strokeWeight}px`);
    // Same ink, too.
    const ink = /background:\s*(var\(--[a-z-]+\))/.exec(ruleBody(".rail-separator"))?.[1];
    expect(statusbar).toContain(`border-top: ${strokeWeight}px solid ${ink}`);
  });

  /**
   * VERIFY/CHROME-3: the corner is masked by macOS, not by us.
   *
   * `src-tauri/tauri.conf.json` keeps the native frame - no `decorations: false`
   * and no `transparent: true`, only `titleBarStyle: "Overlay"` - so AppKit
   * clips the webview to the window's own corner curve. Drawing a second curve
   * in CSS cannot match it (macOS 11+ is ~10-12px and follows the display), and
   * a radius that is even 1px tighter pulls the rail's veil off the mask and
   * leaves a crescent of canvas hugging the corner. Squaring the rail lets the
   * OS mask be the only curve. The assertion is derived from the config rather
   * than from a literal, so it stops holding the moment Tau takes over its own
   * frame and genuinely has to draw the corner itself.
   */
  it("leaves the window's corner curve to the native frame", () => {
    const tauri = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "..", "src-tauri", "tauri.conf.json"), "utf8"),
    );
    const window = tauri.app.windows[0];
    const framelessOwnsItsCorners = window.decorations === false || window.transparent === true;
    expect(
      framelessOwnsItsCorners,
      "Tau now draws its own frame, so this test's premise - and the rail's squared corner - need revisiting",
    ).toBe(false);

    // No surface that meets a window edge may round it while AppKit is masking.
    for (const selector of [".activity-rail", ".statusbar", ".app", ".shell-body"]) {
      expect(ruleBody(selector), `${selector} rounds a natively masked corner`).not.toMatch(
        /border(-[a-z]+)*-radius/,
      );
    }
  });
});

/**
 * VERIFY/CHROME-2: the rail's foot is optional by design, which means the shell
 * failing to pass `onOpenSettings` is silent - the rail just grows no foot and
 * every unit test in this file still passes, because they all inject the prop
 * themselves. That is exactly what happened: the gear was removed from the
 * status strip before App.tsx was rewired, so the running app had no Settings
 * control anywhere in its chrome. Read the real call site, the way
 * `uiux/Wave2Regression.test.tsx` reads App.tsx for shell-ownership seams.
 */
describe("the shell actually mounts the rail's foot", () => {
  it("passes onOpenSettings to ActivityRail, so Settings exists in the running window", () => {
    const app = readFileSync(join(__dirname, "..", "..", "App.tsx"), "utf8");
    const start = app.indexOf("<ActivityRail");
    expect(start, "App.tsx no longer mounts ActivityRail").toBeGreaterThan(-1);
    // The element's own attribute list, so a handler passed to some other
    // component further down the file cannot satisfy this.
    const element = app.slice(start, app.indexOf("/>", start));
    expect(element, "ActivityRail is mounted without onOpenSettings: the app has no Settings gear").toMatch(
      /onOpenSettings=/,
    );

    // ...and the strip it moved out of must not have grown it back.
    expect(app).not.toMatch(/<StatusBar[^/]*onOpenSettings/);
  });
});
