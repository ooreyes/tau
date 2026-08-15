// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { diagnosticsHealthLabel, type DiagnosticsHealth } from "@/lib/diagnosticsHealth";
import { ActivityRail } from "./NavRail";

afterEach(() => cleanup());

const CSS = readFileSync(join(__dirname, "..", "..", "App.css"), "utf8");
/**
 * The rail's own lane stylesheet. It is imported after App.css (asserted
 * below), so an equal-specificity rule in it is what the running app uses -
 * which is why the appearance contracts in this file are read from here and
 * not from App.css.
 */
const RAIL_CSS = readFileSync(join(__dirname, "..", "..", "styles", "pdf6Rail.css"), "utf8");
/**
 * The same file with its prose stripped. Several of its comments quote the old
 * App.css rules verbatim ("`left: -4px`"), so a whole-file scan for a negative
 * offset or a raw colour has to look at declarations only. Newlines survive, so
 * the rule lookups below still work against it.
 */
const RAIL_DECLS = RAIL_CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Declarations of the first rule whose selector is exactly `selector`.
 * Anchored to the line start because App.css quotes selectors inside comments
 * ("search `.statusbar {`") and a plain indexOf finds the prose first.
 */
function ruleBody(selector: string, css: string = CSS): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `${selector} is missing`).toBeGreaterThan(-1);
  const bodyStart = css.indexOf("{", start) + 1;
  return css.slice(bodyStart, css.indexOf("}", bodyStart));
}

/** Same, against the rail's lane stylesheet, prose removed. */
function railRule(selector: string): string {
  return ruleBody(selector, RAIL_DECLS);
}

/**
 * Every stylesheet App.tsx imports, concatenated in load order with the prose
 * stripped - so a rule's position here is its position in the real cascade.
 *
 * Needed because the rail's classes are styled by more than one lane sheet: the
 * PDF-6 remediation gave each surface its own file layered over App.css, and
 * `.rail-diagnostics` is claimed by two of them.
 */
const SHIPPED_CSS = (() => {
  const app = readFileSync(join(__dirname, "..", "..", "App.tsx"), "utf8");
  const sheets = [...app.matchAll(/^import "\.\/([^"]+\.css)";$/gm)].map((match) => match[1]);
  return sheets
    .map((sheet) => readFileSync(join(__dirname, "..", "..", sheet), "utf8"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
})();

/**
 * Every `color` a shipped rule sets on the given health, in cascade order.
 *
 * The rule regex is deliberately narrow: a selector that mentions
 * `.rail-diagnostics` and a body with no nested braces. That cannot stray into
 * an `@media` prelude (which contains a brace the selector class excludes) and
 * cannot swallow a following rule, so it needs no CSS parser.
 */
function shippedHealthInks(health: DiagnosticsHealth): string[] {
  const scoped = health === "ok" ? ".rail-diagnostics" : `.rail-diagnostics--${health}`;
  return [...SHIPPED_CSS.matchAll(/([^{};]*\.rail-diagnostics[^{};]*)\{([^{}]*)\}/g)]
    .filter(([, selector]) => {
      if (!selector.includes(scoped)) return false;
      // The badge is not the lamp, and for `ok` - which is the bare class, since
      // that is how the diagnostics sheet spells the default - the two louder
      // healths must not be counted twice.
      if (selector.includes(".rail-diagnostics-count")) return false;
      return health !== "ok" || !/--(?:warning|error)\b/.test(selector);
    })
    .flatMap(([, , body]) => [...body.matchAll(/(?:^|[;\s])color:\s*([^;]+)/g)].map((match) => match[1].trim()));
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
    // This is App.css's fallback size; the size the running app actually uses
    // is the lane stylesheet's, checked in "the rail reads as an instrument
    // column" below.
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

/**
 * PDF-6 item 4: "Remove any of these vibecoded tell tale signs", cropped on the
 * rail's active button and the light bar hanging off its left edge.
 *
 * The bar was `.rail-active` at App.css's `left: -4px`, on a key that itself sat
 * 4px inside a 52px rail: measured x in the running app was 0, so the indicator
 * was not near the window frame, it was ON it. These assertions read the lane
 * stylesheet rather than the DOM because the defect is entirely a matter of
 * declared geometry - jsdom computes no layout, and a screenshot of the fix is
 * not a test.
 */
describe("the rail's active index mark stays inside its key", () => {
  it("is decided by the lane stylesheet, which App.tsx loads after App.css", () => {
    const app = readFileSync(join(__dirname, "..", "..", "App.tsx"), "utf8");
    const appCss = app.indexOf('import "./App.css"');
    const laneCss = app.indexOf('import "./styles/pdf6Rail.css"');
    expect(appCss, "App.tsx no longer imports App.css").toBeGreaterThan(-1);
    expect(laneCss, "App.tsx no longer imports the rail's lane stylesheet").toBeGreaterThan(-1);
    // The rules are equal-specificity, so import order is the entire mechanism
    // by which the rail is restyled without editing App.css.
    expect(laneCss, "pdf6Rail.css must come after App.css or none of it applies").toBeGreaterThan(appCss);
  });

  it("declares no negative inline-start on .rail-active, or anywhere else", () => {
    // Quoted from App.css so this test names the defect it is protecting
    // against instead of asserting into the void. It is what fails today.
    expect(ruleBody(".rail-active"), "App.css's negative offset is the bug under test").toMatch(/left:\s*-\d/);

    const mark = railRule(".rail-active");
    const offset = /inset-inline-start:\s*(-?[\d.]+)px/.exec(mark);
    expect(offset, ".rail-active has no inline-start offset in pdf6Rail.css").toBeTruthy();
    expect(Number(offset![1]), "the index mark still hangs outside its key").toBeGreaterThanOrEqual(0);

    // ...and nothing else in the rail is pulled outward either, in any spelling.
    expect(RAIL_DECLS).not.toMatch(/(?:inset-inline-(?:start|end)|left|right):\s*-/);
  });

  it("fits inside the key it marks, so it cannot overflow it", () => {
    const mark = railRule(".rail-active");
    const height = Number(/height:\s*(\d+)px/.exec(mark)?.[1]);
    const keyHeight = Number(/--rail-key-h:\s*(\d+)px/.exec(railRule(".activity-rail"))?.[1]);
    expect(keyHeight, "the rail declares no key height").toBeTruthy();
    expect(height, "the mark is taller than the key it sits in").toBeLessThan(keyHeight);

    // Centred rather than pinned with a literal top, so it tracks the key's
    // height instead of restating it - App.css's `top: 10px; height: 24px` was
    // sized for the old 44px key and overflows a 32px one on its own.
    expect(mark).toContain("top: 50%");
    expect(mark).toContain("translateY(-50%)");

    // Closed on both ends. `border-radius: 0 2px 2px 0` is literally the shape
    // of something sliced off by an edge, which is how the old bar read.
    expect(mark).not.toMatch(/border-radius:\s*0\s/);
  });
});

/**
 * PDF-6 item 7: "Redesign this tab make it look less vibecoded". The column's
 * geometry, ink tiers and states, asserted from the stylesheet that ships them.
 */
describe("the rail reads as an instrument column, not a stack of cards", () => {
  it("keeps every key at or above the 24px target floor at its new size", () => {
    const rail = railRule(".activity-rail");
    const width = Number(/--rail-key-w:\s*(\d+)px/.exec(rail)?.[1]);
    const height = Number(/--rail-key-h:\s*(\d+)px/.exec(rail)?.[1]);
    expect(Math.min(width, height), "a rail key dropped under WCAG 2.2's target floor").toBeGreaterThanOrEqual(24);
    // Consumed, not restated, so the key and the group rule cannot disagree.
    const key = railRule(".rail-btn");
    expect(key).toContain("width: var(--rail-key-w)");
    expect(key).toContain("height: var(--rail-key-h)");
  });

  it("leaves the focus ring room inside the rail instead of running into the veil", () => {
    const railWidth = Number(/--rail-width:\s*(\d+)px/.exec(CSS)?.[1]);
    const keyWidth = Number(/--rail-key-w:\s*(\d+)px/.exec(railRule(".activity-rail"))?.[1]);
    const focus = railRule(".rail-btn:focus-visible");
    const ring = Number(/box-shadow:\s*0 0 0 (\d+)px/.exec(focus)?.[1]);
    expect(ring, "focus-visible draws no ring").toBeGreaterThan(0);
    expect(keyWidth + 2 * ring, "the focus ring does not fit inside the rail").toBeLessThanOrEqual(railWidth);
    // DESIGN_SYSTEM section 4: an --accent ring at ~50%, which --accent-line is.
    expect(focus).toContain("var(--accent-line)");
  });

  it("gives the rail four ink tiers, so a dead control cannot look live", () => {
    // Resting ink is --muted; --faint is now free to mean disabled.
    expect(railRule(".rail-btn")).toContain("color: var(--muted)");
    const disabled = /\.rail-btn:disabled[^{]*\{([^}]*)\}/.exec(RAIL_DECLS)?.[1] ?? "";
    expect(disabled, "the rail still has no disabled rule").toContain("color: var(--faint)");
    expect(disabled).toContain("background: transparent");
    expect(disabled).toContain("cursor: not-allowed");
    // The other two tiers still come from App.css and must stay distinct.
    expect(ruleBody(".rail-btn:hover")).toContain("color: var(--text)");
    expect(ruleBody(".rail-btn.active")).toContain("color: var(--accent)");
  });

  it("rounds keys as keycaps and scales the group rule to them", () => {
    // DESIGN_SYSTEM section 3: --r-sm for small controls, --r-md for cards.
    expect(railRule(".rail-btn")).toContain("border-radius: var(--r-sm)");
    expect(railRule(".rail-separator")).toContain("width: var(--rail-key-w)");
    // The foot's copy is more specific, so it keeps spanning the rail and can
    // still continue the status strip's border-top.
    expect(ruleBody(".rail-foot .rail-separator")).toMatch(/width:\s*100%/);
    // ...and the shared ink is deliberately not restated here, because those
    // two hairlines have to be the same line.
    expect(railRule(".rail-separator")).not.toContain("background");
  });

  it("carries selection in glyph weight as well as hue, so it survives greyscale", () => {
    const rail = railRule(".activity-rail");
    const resting = Number(/--rail-glyph:\s*([\d.]+)/.exec(rail)?.[1]);
    const active = Number(/--rail-glyph-active:\s*([\d.]+)/.exec(rail)?.[1]);
    expect(active).toBeGreaterThan(resting);
    expect(railRule(".rail-btn svg")).toContain("stroke-width: var(--rail-glyph)");
    expect(railRule(".rail-btn.active svg")).toContain("stroke-width: var(--rail-glyph-active)");
  });

  it("adds no colour, no drop shadow and no type size of its own", () => {
    expect(RAIL_DECLS, "a raw hex in the rail stylesheet").not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(RAIL_DECLS, "a raw rgb()/rgba() in the rail stylesheet").not.toMatch(/\brgba?\(/);
    expect(RAIL_DECLS, "a literal font-size outside the type scale").not.toMatch(/font-size:\s*\d/);
    // Persistent chrome gets a veil and no shadow (DESIGN_SYSTEM 1.8), so every
    // box-shadow here must be a focus ring or an inset hairline.
    for (const shadow of RAIL_DECLS.match(/box-shadow:[^;]+/g) ?? []) {
      expect(shadow, `${shadow} is a drop shadow on persistent chrome`).toMatch(/\b(?:inset|none)\b|0 0 0/);
    }
  });
});

/**
 * PDF-6 items 5/7: the diagnostics "!" lamp. The rail renders it only when a
 * shell supplies the state, so every harness that renders the rail on its own -
 * including the two suites above - keeps working untouched.
 */
describe("the rail's diagnostics lamp", () => {
  const healths: Array<{ health: DiagnosticsHealth; count: number }> = [
    { health: "ok", count: 0 },
    { health: "warning", count: 2 },
    { health: "error", count: 3 },
  ];

  function lampOf(health: DiagnosticsHealth, count: number): HTMLElement {
    return screen.getByRole("button", { name: diagnosticsHealthLabel(health, count) });
  }

  it("shows no lamp at all when the shell passes no diagnostics", () => {
    const { container } = render(<ActivityRail {...railProps} onOpenSettings={vi.fn()} />);
    expect(container.querySelector(".rail-diagnostics")).toBeNull();
    // The rail is still a rail: four destinations plus the gear, nothing else.
    const rail = screen.getByRole("navigation", { name: "Workspace sections" });
    expect(rail.querySelectorAll(".rail-btn")).toHaveLength(5);
  });

  it.each(healths)("names the $health lamp for a screen reader and marks its health", ({ health, count }) => {
    render(<ActivityRail {...railProps} diagnostics={{ health, count, open: false, onToggle: vi.fn() }} />);
    const lamp = lampOf(health, count);
    expect(lamp.classList.contains("rail-diagnostics")).toBe(true);
    expect(lamp.classList.contains(`rail-diagnostics--${health}`)).toBe(true);
    expect(lamp.getAttribute("data-health")).toBe(health);
    expect(lamp.getAttribute("aria-pressed")).toBe("false");
  });

  it("says in words that the circuit will not run, so red is never the only signal", () => {
    render(<ActivityRail {...railProps} diagnostics={{ health: "error", count: 3, open: false, onToggle: vi.fn() }} />);
    const lamp = screen.getByRole("button", { name: /will not run/ });
    expect(lamp.getAttribute("aria-label")).toContain("3");
  });

  it("toggles the diagnostics window when clicked, and reports that it is open", () => {
    const onToggle = vi.fn();
    render(<ActivityRail {...railProps} diagnostics={{ health: "warning", count: 1, open: true, onToggle }} />);
    const lamp = lampOf("warning", 1);
    expect(lamp.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(lamp);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("does not call the shell back while disabled", () => {
    const onToggle = vi.fn();
    render(
      <ActivityRail
        {...railProps}
        diagnostics={{ health: "ok", count: 0, open: false, onToggle, disabled: true }}
      />,
    );
    const lamp = lampOf("ok", 0);
    expect((lamp as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(lamp);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("lives in the rail's pinned foot, above Settings, which stays last in the tab order", () => {
    render(
      <ActivityRail
        {...railProps}
        onOpenSettings={vi.fn()}
        diagnostics={{ health: "error", count: 1, open: false, onToggle: vi.fn() }}
      />,
    );
    const rail = screen.getByRole("navigation", { name: "Workspace sections" });
    const lamp = rail.querySelector<HTMLElement>(".rail-diagnostics");
    const settings = screen.getByRole("button", { name: "Settings" });
    // The foot is the only part of the rail at a constant screen position, which
    // is what a health light nobody goes looking for needs.
    expect(lamp?.closest(".rail-foot"), "the lamp is not in the rail's pinned register").toBeTruthy();
    expect(lamp!.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const buttons = [...rail.querySelectorAll("button")];
    expect(buttons[buttons.length - 1]).toBe(settings);
  });

  it("grows the foot for the lamp alone, so the lamp and the gear are independent", () => {
    render(<ActivityRail {...railProps} diagnostics={{ health: "ok", count: 0, open: false, onToggle: vi.fn() }} />);
    expect(lampOf("ok", 0).closest(".rail-foot")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
  });
});

/** Item 5: the three health states, in the repo's own semantic tokens. */
describe("the diagnostics lamp's health states", () => {
  it("uses the semantic diagnostic tokens rather than inventing status colours", () => {
    expect(railRule(".rail-btn.rail-diagnostics--ok")).toContain("color: var(--diagnostic-ok)");
    expect(railRule(".rail-btn.rail-diagnostics--warning")).toContain("color: var(--diagnostic-warning)");
    expect(railRule(".rail-btn.rail-diagnostics--error")).toContain("color: var(--diagnostic-error)");
  });

  it("outranks the shared hover rule, so pointing at the lamp does not blank it", () => {
    // App.css's `.rail-btn:hover` swaps ink for --text at (0,2,0); each health
    // rule carries `.rail-btn` too, so it matches that weight and wins on order.
    for (const health of ["ok", "warning", "error"]) {
      expect(RAIL_DECLS, `.rail-diagnostics--${health} is not scoped to .rail-btn`).toContain(
        `.rail-btn.rail-diagnostics--${health} {`,
      );
    }
  });

  /**
   * The rail is not the only stylesheet that inks this lamp - the diagnostics
   * lane's own sheet does too, and it loads later, so it is the one that ships.
   * Two lists of the same colours is precisely the drift DESIGN_SYSTEM 1.5
   * records about the trace rotation, and the fix recorded there is to enumerate
   * every source and assert they agree rather than to trust one of them. So this
   * reads every stylesheet App.tsx loads, in load order.
   */
  it("never lets any shipped stylesheet ink a health with another severity's token", () => {
    for (const health of ["ok", "warning", "error"] as const) {
      const inks = shippedHealthInks(health);
      expect(inks.length, `no shipped rule inks the ${health} lamp at all`).toBeGreaterThan(0);
      for (const ink of inks) {
        expect(ink, `the ${health} lamp is inked with ${ink}`).toBe(`var(--diagnostic-${health})`);
      }
    }
  });

  it("ships a count badge, which is the non-colour half of the signal", () => {
    // Geometry belongs to whichever lane sheet owns it; what matters here is
    // that the count is drawn on the key at all, at a size from the type scale,
    // because "how many" is what tells warning and error apart in greyscale.
    const badge = /\.rail-diagnostics-count[^{}]*\{([^{}]*)\}/.exec(SHIPPED_CSS)?.[1];
    expect(badge, "nothing styles the diagnostics count badge").toBeTruthy();
    expect(badge).toContain("position: absolute");
    expect(badge).toContain("font-size: var(--fs-micro)");
  });
});
