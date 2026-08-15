// @vitest-environment jsdom
/**
 * The rail's `!` health light (PDF-6 item 6, and item 2 of the follow-up review).
 *
 * The assertions worth having here are the ones about NOT relying on colour: a
 * test can see a class name, but a colour-blind reader cannot see the class. So
 * what is pinned is the accessible name for each of the three healths, which is
 * the carrier that survives both a monochrome display and a screen reader.
 *
 * The second half of the file pins the count badge's GEOMETRY, because item 2 -
 * "the number icon ... hides the high almost" - was not a taste disagreement: the
 * badge's offsets were tuned against a 44px rail key, the key shrank to 36x32 in
 * a later pass, and nothing recomputed. The overlap is therefore arithmetic, and
 * arithmetic can be asserted. Those tests read the stylesheet that ships (the
 * house pattern from `styles/pdf4Chrome.css.test.ts`) and take the key's size
 * from the rail's own sheet rather than a literal, so the next time somebody
 * resizes the key this fails instead of silently re-covering the glyph.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiagnosticsRailButton } from "./DiagnosticsRailButton";

afterEach(() => cleanup());

describe("DiagnosticsRailButton", () => {
  it("names the clear state without needing the colour", () => {
    render(<DiagnosticsRailButton health="ok" count={0} open={false} onToggle={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Diagnostics: no problems" });
    expect(button.getAttribute("data-health")).toBe("ok");
    // No badge with nothing to read: a permanent "0" trains the eye to ignore
    // the whole button.
    expect(button.querySelector(".rail-diagnostics-count")).toBeNull();
  });

  it("names the warning state and says the circuit still runs", () => {
    render(<DiagnosticsRailButton health="warning" count={3} open={false} onToggle={vi.fn()} />);
    const button = screen.getByRole("button", {
      name: "Diagnostics: 3 warnings, this circuit will still run",
    });
    expect(button.getAttribute("data-health")).toBe("warning");
    expect(button.querySelector(".rail-diagnostics-count")!.textContent).toBe("3");
  });

  it("names the error state and says the circuit will not run", () => {
    render(<DiagnosticsRailButton health="error" count={1} open={false} onToggle={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Diagnostics: 1 problem, this circuit will not run" })
        .getAttribute("data-health"),
    ).toBe("error");
  });

  it("gives the three healths three different names", () => {
    const names = (["ok", "warning", "error"] as const).map((health) => {
      const view = render(
        <DiagnosticsRailButton health={health} count={2} open={false} onToggle={vi.fn()} />,
      );
      const name = screen.getByRole("button").getAttribute("aria-label");
      view.unmount();
      return name;
    });
    expect(new Set(names).size).toBe(3);
  });

  it("toggles on click and reports its open state to assistive tech", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <DiagnosticsRailButton health="error" count={2} open={false} onToggle={onToggle} />,
    );
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);

    // Open is driven from outside - this button holds no state of its own, which
    // is what lets the window and the button share one source of truth.
    rerender(<DiagnosticsRailButton health="error" count={2} open onToggle={onToggle} />);
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button").className).toContain("active");
  });

  it("clamps a large count in the badge but never in the name", () => {
    render(<DiagnosticsRailButton health="warning" count={42} open={false} onToggle={vi.fn()} />);
    const button = screen.getByRole("button", {
      name: "Diagnostics: 42 warnings, this circuit will still run",
    });
    expect(button.querySelector(".rail-diagnostics-count")!.textContent).toBe("9+");
  });

  it("does not fire when disabled", () => {
    const onToggle = vi.fn();
    render(<DiagnosticsRailButton health="ok" count={0} open={false} onToggle={onToggle} disabled />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * The count, at every state the badge itself cannot show
 * ------------------------------------------------------------------ */

describe("the exact count is reachable without reading the badge", () => {
  it.each([1, 2, 9, 10, 42, 137])("keeps %i in the accessible name, clamped or not", (count) => {
    render(<DiagnosticsRailButton health="warning" count={count} open={false} onToggle={vi.fn()} />);
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-label")).toContain(String(count));

    const badge = button.querySelector(".rail-diagnostics-count")!;
    expect(badge.textContent).toBe(count > 9 ? "9+" : String(count));
    // The badge is a second rendering of the name, not a second reading of it:
    // announced, it would make every lamp say its number twice.
    expect(badge.getAttribute("aria-hidden")).toBe("true");
  });

  it("puts the exact count in the tooltip once the badge has clamped", async () => {
    render(<DiagnosticsRailButton health="error" count={42} open={false} onToggle={vi.fn()} />);
    const button = screen.getByRole("button");
    expect(button.querySelector(".rail-diagnostics-count")!.textContent).toBe("9+");

    // The pointer-free route to the same string, which is what makes clamping
    // a display decision rather than a loss of information.
    fireEvent.focus(button);
    expect((await screen.findByRole("tooltip")).textContent).toContain("42 problems");
  });

  it("still reads its count while disabled", () => {
    render(<DiagnosticsRailButton health="error" count={3} open={false} onToggle={vi.fn()} disabled />);
    const button = screen.getByRole("button", {
      name: "Diagnostics: 3 problems, this circuit will not run",
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    // Dimming a lamp is not the same as deleting its reading: the count is still
    // in the name and still on the key, it just stops shouting.
    expect(button.querySelector(".rail-diagnostics-count")!.textContent).toBe("3");
  });
});

/* ------------------------------------------------------------------ *
 * Item 2: the badge's geometry, read from the stylesheet that ships it
 * ------------------------------------------------------------------ */

const SRC = join(__dirname, "..", "..");
const DIAGNOSTICS_CSS = readFileSync(join(SRC, "styles", "pdf6Diagnostics.css"), "utf8");
/**
 * The same sheet with its prose stripped. Its comments quote the old numbers
 * verbatim ("`top: 5px; right: 4px`") so a reader can see what changed, which
 * means every scan below has to look at declarations only.
 */
const DIAGNOSTICS_DECLS = DIAGNOSTICS_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
/** The rail lane's sheet: it owns the key the badge has to fit inside. */
const RAIL_DECLS = readFileSync(join(SRC, "styles", "pdf6Rail.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);
const APP_CSS = readFileSync(join(SRC, "App.css"), "utf8");
const COMPONENT = readFileSync(join(__dirname, "DiagnosticsRailButton.tsx"), "utf8");

interface CssRule {
  selector: string;
  body: string;
  /** Character offset, which is cascade order for two rules of equal weight. */
  at: number;
}

/** Every top-level rule in a flat stylesheet, in source order. */
function rules(css: string): CssRule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    body: match[2],
    at: match.index ?? 0,
  }));
}

function ruleBody(selector: string, css: string = DIAGNOSTICS_DECLS): string {
  const rule = rules(css).find((candidate) =>
    candidate.selector.split(",").some((one) => one.trim() === selector),
  );
  expect(rule, `${selector} is missing`).toBeTruthy();
  return rule!.body;
}

/** A declared length, in px. Anchored so `min-width` cannot answer for `width`. */
function px(body: string, property: string): number {
  const match = new RegExp(`(?:^|[;\\s])${property}:\\s*(-?[\\d.]+)px`).exec(body);
  expect(match, `${property} is not declared in px`).toBeTruthy();
  return Number(match![1]);
}

/** A length token, resolved from App.css so a retuned token retunes the proof. */
function token(name: string): number {
  const match = new RegExp(`${name}:\\s*([\\d.]+)px`).exec(APP_CSS);
  expect(match, `${name} is not defined in App.css`).toBeTruthy();
  return Number(match![1]);
}

/** The badge as it is actually painted: the declared box grown by its ring. */
interface Painted {
  left: number;
  right: number;
  top: number;
  bottom: number;
  radius: number;
}

interface BadgeBox {
  top: number;
  right: number;
  width: number;
  height: number;
  radius: number;
  ring: number;
}

function painted(box: BadgeBox, keyWidth: number): Painted {
  return {
    left: keyWidth - box.right - box.width - box.ring,
    right: keyWidth - box.right + box.ring,
    top: box.top - box.ring,
    bottom: box.top + box.height + box.ring,
    // A radius larger than half the box is clamped by the browser, which is how
    // the old --r-lg on a 14px box was already drawing a capsule.
    radius: Math.min(box.radius, box.width / 2, box.height / 2) + box.ring,
  };
}

/** Signed distance from a point to a rounded rectangle; negative means inside. */
function distanceTo(shape: Painted, x: number, y: number): number {
  const halfX = Math.max((shape.right - shape.left) / 2 - shape.radius, 0);
  const halfY = Math.max((shape.bottom - shape.top) / 2 - shape.radius, 0);
  const dx = Math.abs(x - (shape.left + shape.right) / 2) - halfX;
  const dy = Math.abs(y - (shape.top + shape.bottom) / 2) - halfY;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - shape.radius;
}

/**
 * lucide's `triangle-alert`, as the endpoints of its strokes in its own 24-unit
 * viewBox - the rounded apex split into its two halves at the tip, which is the
 * only curve near enough to the badge to matter.
 *
 * This is what makes the test about the GLYPH rather than about a bounding box.
 * A triangle's box is empty at the top corners by construction, so "the badge
 * overlaps the glyph's box" and "the badge covers the mark" are different
 * claims, and only the second one is the defect the review reported.
 */
const GLYPH_STROKES: ReadonlyArray<readonly [number, number, number, number]> = [
  [13.73, 4, 21.73, 18], // right leg
  [21.73, 18, 20, 21], // bottom-right corner
  [20, 21, 4, 21], // base
  [4, 21, 2.25, 18], // bottom-left corner
  [2.25, 18, 10.25, 4], // left leg
  [10.25, 4, 11.99, 2.98], // apex, rising
  [11.99, 2.98, 13.73, 4], // apex, falling
  [12, 9, 12, 13], // the exclamation bar
  [12, 17, 12, 17], // and its dot
];

/** How near the badge's painted edge comes to the glyph's painted ink, in px. */
function inkClearance(
  shape: Painted,
  key: { width: number; height: number },
  glyph: number,
  stroke: number,
): number {
  const scale = glyph / 24;
  const originX = (key.width - glyph) / 2;
  const originY = (key.height - glyph) / 2;
  let nearest = Number.POSITIVE_INFINITY;
  for (const [x1, y1, x2, y2] of GLYPH_STROKES) {
    for (let t = 0; t <= 1; t += 1 / 64) {
      const x = originX + (x1 + (x2 - x1) * t) * scale;
      const y = originY + (y1 + (y2 - y1) * t) * scale;
      nearest = Math.min(nearest, distanceTo(shape, x, y));
    }
  }
  // The path is a centreline; the ink is half a stroke either side of it.
  return nearest - (stroke * scale) / 2;
}

describe("the count badge annotates the warning triangle instead of hiding it", () => {
  // Everything the badge has to fit inside, taken from its owners rather than
  // restated - the key from the rail's sheet, the glyph from the component, the
  // stroke from the heaviest weight the lamp can draw (the active one).
  const railVars = ruleBody(".activity-rail", RAIL_DECLS);
  const key = {
    width: px(railVars, "--rail-key-w"),
    height: px(railVars, "--rail-key-h"),
  };
  const glyph = Number(/size=\{(\d+)\}/.exec(COMPONENT)?.[1]);
  const stroke = Number(/--rail-glyph-active:\s*([\d.]+)/.exec(RAIL_DECLS)?.[1]);

  const badge = ruleBody(".rail-diagnostics-count");
  const box: BadgeBox = {
    top: px(badge, "top"),
    right: px(badge, "right"),
    width: px(badge, "min-width"),
    height: px(badge, "height"),
    radius: token("--r-sm"),
    ring: Number(/box-shadow:\s*0 0 0 ([\d.]+)px/.exec(badge)?.[1]),
  };

  it("reads its inputs from the files that own them", () => {
    // The premise of every scan here: one flat sheet, no nested at-rules, so a
    // brace-counting parse is unnecessary and a naive one is not wrong.
    expect(DIAGNOSTICS_DECLS, "this file's flat parse cannot see inside an at-rule").not.toContain(
      "@media",
    );
    expect(key.width, "the rail declares no key width").toBeGreaterThan(0);
    expect(key.height, "the rail declares no key height").toBeGreaterThan(0);
    expect(glyph, "the component no longer sizes its glyph").toBeGreaterThan(0);
    expect(stroke, "the rail declares no active glyph weight").toBeGreaterThan(0);
  });

  it("is seated in the corner the triangle leaves empty, and clears the mark", () => {
    // The numbers this pass chose, stated outright so a re-tune has to argue
    // with them rather than drift past them.
    expect([box.top, box.right, box.width, box.height, box.ring]).toEqual([1, 1, 12, 12, 1]);
    // DESIGN_SYSTEM 3: --r-sm is the small-control radius, and at half the
    // badge's height it makes a true capsule instead of a clamped dialog radius.
    expect(badge).toContain("border-radius: var(--r-sm)");
    expect(box.radius).toBe(box.height / 2);

    const clearance = inkClearance(painted(box, key.width), key, glyph, stroke);
    expect(clearance, "the badge is back on the glyph's strokes").toBeGreaterThan(1.5);
  });

  it("still clears the mark when the clamped label widens the capsule", () => {
    // "9+" is two tabular --fs-micro characters, ~10.3px, so min-width holds it;
    // this asserts the headroom anyway, because the pill grows leftward - toward
    // the glyph - and a font fallback is the one thing CSS cannot pin.
    const widened = painted({ ...box, width: box.width + 2 }, key.width);
    expect(inkClearance(widened, key, glyph, stroke)).toBeGreaterThan(0);
  });

  it("keeps its whole footprint inside the key, ring included", () => {
    // Item 4 of the previous report was an indicator that escaped its key and
    // landed on the window frame. The badge does not get to repeat it, and the
    // rail's 8px gutter is the focus ring's room, not spare space.
    const shape = painted(box, key.width);
    expect(shape.left).toBeGreaterThanOrEqual(0);
    expect(shape.top).toBeGreaterThanOrEqual(0);
    expect(shape.right).toBeLessThanOrEqual(key.width);
    expect(shape.bottom).toBeLessThanOrEqual(key.height);
  });

  it("stays visibly smaller than the glyph it annotates", () => {
    // The other half of the report - "too big" - is a proportion, not an
    // overlap: at 17px of painted width on an 18px glyph the old badge was the
    // same object's size, so it read as the icon rather than as a mark on it.
    expect(box.height + 2 * box.ring).toBeLessThanOrEqual(0.8 * glyph);
  });

  /**
   * The defect, named. Every number here is the one that shipped before this
   * pass; running the same arithmetic over them has to come out negative, or
   * the arithmetic above is not measuring what it claims to measure.
   */
  it("fails on the geometry it replaces, which was tuned for a 44px key", () => {
    const stale: BadgeBox = { top: 5, right: 4, width: 14, height: 14, radius: token("--r-lg"), ring: 1.5 };
    const clearance = inkClearance(painted(stale, key.width), key, glyph, stroke);
    expect(clearance, "the old badge is supposed to be the thing that covers the glyph").toBeLessThan(0);
    // It did not merely grave the edge: it swallowed the apex outright.
    const apex = {
      x: (key.width - glyph) / 2 + 11.99 * (glyph / 24),
      y: (key.height - glyph) / 2 + 2.98 * (glyph / 24),
    };
    expect(distanceTo(painted(stale, key.width), apex.x, apex.y)).toBeLessThan(0);
    expect(distanceTo(painted(box, key.width), apex.x, apex.y)).toBeGreaterThan(0);

    // ...and the shipped sheet no longer declares any of it.
    expect(DIAGNOSTICS_DECLS).not.toMatch(/(?:^|[;\s])top:\s*5px/);
    expect(DIAGNOSTICS_DECLS).not.toMatch(/(?:^|[;\s])right:\s*4px/);
    expect(DIAGNOSTICS_DECLS).not.toMatch(/(?:^|[;\s])height:\s*14px/);
  });

  it("adds no colour and no type size of its own", () => {
    expect(DIAGNOSTICS_DECLS, "a raw hex in the diagnostics stylesheet").not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(DIAGNOSTICS_DECLS, "a raw rgb()/rgba()").not.toMatch(/\brgba?\(/);
    expect(DIAGNOSTICS_DECLS, "a literal font-size outside the type scale").not.toMatch(/font-size:\s*\d/);
  });
});

/**
 * A disabled lamp has to look disabled.
 *
 * This sheet's `.rail-btn.rail-diagnostics--<health>:hover` rules are (0,3,0),
 * the same weight as pdf6Rail.css's `.rail-btn:disabled:hover`, and this sheet
 * loads second - so until now a switched-off lamp still took the health tint
 * under the pointer. jsdom cannot be made to hover, so the contract is asserted
 * where it is decided: in the cascade.
 */
describe("a disabled lamp takes no hover tint", () => {
  /** These selectors are classes and pseudo-classes only, so specificity is
   *  (0,n,0) and n is just how many of them the compound has. */
  const weight = (selector: string) => (selector.match(/[.:]/g) ?? []).length;
  const heaviest = (selector: string) =>
    Math.max(...selector.split(",").map((one) => weight(one.trim())));

  const disabledRules = rules(DIAGNOSTICS_DECLS).filter((rule) => rule.selector.includes(":disabled"));

  it("neutralises the lamp instead of letting the health tint win", () => {
    expect(disabledRules.length, "the diagnostics sheet has no disabled rule").toBe(1);
    const [rule] = disabledRules;
    expect(rule.body).toContain("background: transparent");
    // DESIGN_SYSTEM 0.1: disabled desaturates, because dimming a saturated glyph
    // is not enough. The ink cannot be restated here - NavRail.test.tsx requires
    // every `color` on a health to be that health's own token - so the drop to
    // neutral is made on the rendered result.
    expect(rule.body).toMatch(/filter:\s*grayscale\(1\)/);
    expect(rule.body).toMatch(/opacity:\s*0?\.\d+/);
    // Both states the tint can arrive through, spelled out: a disabled lamp can
    // be hovered, and it can also be the open one.
    expect(rule.selector).toContain(".rail-btn.rail-diagnostics:disabled:hover");
    expect(rule.selector).toContain(".rail-btn.rail-diagnostics:disabled.active");
  });

  it("beats every rule in the sheet that could tint the lamp", () => {
    const [rule] = disabledRules;
    const mine = heaviest(rule.selector);
    for (const other of rules(DIAGNOSTICS_DECLS)) {
      if (other.at === rule.at) continue;
      if (!other.selector.includes(".rail-diagnostics")) continue;
      // The badge is inside the button, so it fades with it rather than needing
      // a rule of its own.
      if (other.selector.includes(".rail-diagnostics-count")) continue;
      if (!/(?:^|[;\s])background:/.test(other.body)) continue;
      const theirs = heaviest(other.selector);
      expect(
        theirs < mine || (theirs === mine && other.at < rule.at),
        `${other.selector.replace(/\s+/g, " ")} can still tint a disabled lamp`,
      ).toBe(true);
    }
  });

  it("does not steal the rail's own disabled cursor", () => {
    // pdf6Rail.css's `.rail-btn:disabled` already sets `not-allowed`, and nothing
    // in this sheet sets `cursor` at all, so the two lanes cannot disagree.
    expect(RAIL_DECLS).toMatch(/\.rail-btn:disabled[^{]*\{[^}]*cursor:\s*not-allowed/);
    expect(DIAGNOSTICS_DECLS).not.toMatch(/cursor:/);
  });
});
