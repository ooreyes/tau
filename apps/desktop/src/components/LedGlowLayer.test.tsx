// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LedGlowLayer } from "./LedGlowLayer";
import { LED_FULL_AMPS } from "../simulation/ledGlow";
import type { SchematicComponent } from "../schematic/types";

/**
 * The glow used to be a flat `--signal-glow` disc with a 1px `--signal` outline
 * at up to r=22 over a 28-unit body. Every property asserted here is one half
 * of why that read as a sticker stuck on the symbol rather than as a lit part:
 * light has no edge, it falls off, and it does not swallow the mark it belongs
 * to. Reverting any single one of them fails exactly one of these tests.
 *
 * The honesty properties (no result -> nothing; reverse bias is dark; the scale
 * is logarithmic) are the older contract and are asserted here too, because a
 * visual rewrite is exactly when they would get lost.
 */

const CSS = readFileSync(join(__dirname, "..", "App.css"), "utf8");

/** The body of one CSS rule, by selector. */
function cssRule(selector: string): string {
  const at = CSS.indexOf(`\n${selector} {`);
  expect(at, `${selector} not found in App.css`).toBeGreaterThan(-1);
  const open = CSS.indexOf("{", at);
  const close = CSS.indexOf("}", open);
  return CSS.slice(open + 1, close);
}

const led = (id: string, x = 0): SchematicComponent => ({
  id,
  kind: "led",
  x,
  y: 0,
  rotation: 0,
  value: "LED",
  label: id.toUpperCase(),
});

const ledWithColor = (id: string, color: string): SchematicComponent => ({
  ...led(id),
  value: `LED color=${color}`,
});

function draw(currents: [string, number][] | null, parts = [led("d1")]) {
  return render(
    <svg>
      <LedGlowLayer components={parts} currents={currents ? new Map(currents) : null} />
    </svg>,
  );
}

const glowCircles = (container: HTMLElement) =>
  [...container.querySelectorAll<SVGCircleElement>("circle.led-glow")];

describe("LedGlowLayer - emission, not a decal", () => {
  it.each(["yellow", "blue", "white", "custom"] as const)("keeps the %s color in the live glow", (color) => {
    const { container } = draw([["d1", LED_FULL_AMPS]], [ledWithColor("d1", color)]);
    expect(container.querySelector("circle.led-glow")?.getAttribute("class"))
      .toContain(`led-color-${color}`);
    expect(container.querySelector(`[id="tau-led-glow-${color}"]`)).toBeTruthy();
  });

  it("carries no stroke, because light has no outline", () => {
    const { container } = draw([["d1", LED_FULL_AMPS]]);
    const circle = glowCircles(container)[0];
    expect(circle).toBeTruthy();
    // Nothing in the markup, and nothing the stylesheet could put back.
    expect(circle.getAttribute("stroke")).toBeNull();
    expect(circle.getAttribute("stroke-width")).toBeNull();
    const rule = cssRule(".led-glow");
    expect(rule).toMatch(/stroke:\s*none/);
    expect(rule).not.toMatch(/stroke-width/);
  });

  it("fills from a radial gradient whose alpha reaches zero at the rim", () => {
    const { container } = draw([["d1", LED_FULL_AMPS]]);
    const circle = glowCircles(container)[0];
    const fill = circle.getAttribute("fill") ?? cssRule(".led-glow");
    const id = /url\(#([^)]+)\)/.exec(fill)?.[1]
      ?? /fill:\s*url\(#([^)]+)\)/.exec(cssRule(".led-glow"))?.[1];
    expect(id, "the glow is not filled from a gradient").toBeTruthy();

    // A type selector cannot be used here: in an HTML document jsdom lowercases
    // it and `radialGradient` is a case-sensitive SVG name.
    const gradient = container.querySelector(`[id="${id}"]`);
    expect(gradient, `no gradient #${id} in the layer`).toBeTruthy();
    expect(gradient!.tagName).toBe("radialGradient");
    const stops = [...gradient!.querySelectorAll("stop")];
    expect(stops.length).toBeGreaterThan(2);

    const rim = stops[stops.length - 1];
    expect(rim.getAttribute("offset")).toBe("100%");
    // A rim above zero is a visible boundary, which is the whole defect.
    expect(Number(rim.getAttribute("stop-opacity"))).toBe(0);
  });

  it("decays monotonically from a fully opaque core", () => {
    const { container } = draw([["d1", LED_FULL_AMPS]]);
    const alphas = [...container.querySelectorAll("stop")]
      .map((stop) => Number(stop.getAttribute("stop-opacity")));
    expect(alphas[0]).toBe(1);
    for (let i = 1; i < alphas.length; i += 1) {
      expect(alphas[i], `stop ${i} is not below stop ${i - 1}`).toBeLessThan(alphas[i - 1]);
    }
    // Half way out the halo is already faint: the falloff is steep near the
    // die and long in the tail, not a linear ramp.
    const midway = alphas[Math.floor(alphas.length / 2)];
    expect(midway).toBeLessThan(0.5);
  });

  it("takes its colour from tokens on both sides of the gradient", () => {
    const { container } = draw([["d1", LED_FULL_AMPS]]);
    const classes = [...container.querySelectorAll("stop")]
      .map((stop) => stop.getAttribute("class"));
    expect(new Set(classes)).toEqual(new Set(["led-glow-core", "led-glow-halo"]));
    expect(cssRule(".led-glow-core")).toMatch(/stop-color:\s*var\(--led-glow-core\)/);
    expect(cssRule(".led-glow-halo")).toMatch(/stop-color:\s*var\(--signal\)/);
  });

  it("defines every glow token in both themes", () => {
    // A glow tuned on black is the one most likely to be wrong on paper, so
    // neither theme is allowed to fall through to the other's value.
    for (const token of ["--led-glow-core", "--led-glow-blend"]) {
      const zones = [...CSS.matchAll(new RegExp(`${token}:\\s*([^;]+);`, "g"))];
      // :root, prefers-color-scheme light, data-theme light, data-theme dark.
      expect(zones.length, `${token} is not defined in all four token zones`).toBe(4);
    }
    const dark = CSS.slice(0, CSS.indexOf("@media (prefers-color-scheme: light)"));
    const light = CSS.slice(CSS.indexOf("@media (prefers-color-scheme: light)"));
    expect(/--led-glow-blend:\s*screen/.exec(dark), "dark must add light").toBeTruthy();
    expect(/--led-glow-blend:\s*multiply/.exec(light), "paper must not add light").toBeTruthy();
  });
});

describe("LedGlowLayer - the halo stays subordinate to the part", () => {
  /** Half the LED symbol's drawn body (symbols.tsx: -13..16 x, -15..15 y). */
  const BODY_HALF_WIDTH = 15;

  it("keeps the perceptible disc inside the LED body at full drive", () => {
    const { container } = draw([["d1", LED_FULL_AMPS]]);
    const circle = glowCircles(container)[0];
    const r = Number(circle.getAttribute("r"));
    const alphas = [...container.querySelectorAll("stop")]
      .map((stop) => ({
        offset: Number((stop.getAttribute("offset") ?? "0").replace("%", "")) / 100,
        alpha: Number(stop.getAttribute("stop-opacity")),
      }));
    // Where the gradient drops to 5% alpha is where the glow stops being
    // visible; that radius, not the geometric one, is what a reader sees. The
    // tail runs on past it to fade, which is why `r` alone says nothing.
    const faint = alphas.find((stop) => stop.alpha <= 0.05);
    expect(faint, "the gradient never becomes faint").toBeTruthy();
    const perceptible = r * faint!.offset;
    // Bounded on both sides: much bigger and it is the decal again (the disc
    // this replaced was a hard-edged r=22 over the same body), much smaller
    // and the part is not visibly lit at all.
    expect(perceptible).toBeLessThanOrEqual(BODY_HALF_WIDTH * 1.2);
    expect(perceptible).toBeGreaterThanOrEqual(BODY_HALF_WIDTH * 0.6);
  });

  it("never paints the symbol out from under itself", () => {
    const { container } = draw([["d1", LED_FULL_AMPS]]);
    const opacity = Number(glowCircles(container)[0].style.opacity);
    expect(opacity).toBeGreaterThan(0.5);
    expect(opacity).toBeLessThan(1);
  });

  it("sits on the drawn body, not on the stored anchor", () => {
    // An LED imported from an LTspice `.asc` keeps that file's anchor, and the
    // canvas draws the symbol wherever its pin bank puts it - here 16 right and
    // 32 down of `x/y`. Centring on the anchor hung the halo off the corner of
    // the part, which the flat disc was just big enough to hide.
    const imported: SchematicComponent = {
      ...led("d1"),
      x: 288,
      y: 144,
      pinOverride: [
        { id: "a", label: "A", x: 304, y: 144 },
        { id: "k", label: "K", x: 304, y: 208 },
      ],
    };
    const { container } = draw([["d1", LED_FULL_AMPS]], [imported]);
    const circle = glowCircles(container)[0];
    expect(Number(circle.getAttribute("cx"))).toBe(304);
    expect(Number(circle.getAttribute("cy"))).toBe(176);
  });

  it("grows and brightens together, so two drives read apart", () => {
    const { container } = draw(
      [["d1", LED_FULL_AMPS], ["d2", 3e-4]],
      [led("d1"), led("d2", 96)],
    );
    const [bright, dim] = glowCircles(container);
    expect(Number(bright.getAttribute("r"))).toBeGreaterThan(Number(dim.getAttribute("r")));
    expect(Number(bright.style.opacity)).toBeGreaterThan(Number(dim.style.opacity));
  });
});

describe("LedGlowLayer - honesty properties", () => {
  it("draws nothing at all without a result", () => {
    const { container } = draw(null);
    expect(container.querySelector(".led-glow-layer")).toBeNull();
  });

  it("draws nothing for a reverse-biased LED", () => {
    const { container } = draw([["d1", -LED_FULL_AMPS]]);
    expect(glowCircles(container)).toHaveLength(0);
  });

  it("draws nothing below the visible floor", () => {
    const { container } = draw([["d1", 1e-9]]);
    expect(glowCircles(container)).toHaveLength(0);
  });

  it("is logarithmic: a decade of current is not a decade of glow", () => {
    const { container } = draw(
      [["d1", 20e-3], ["d2", 2e-3], ["d3", 0.2e-3]],
      [led("d1"), led("d2", 96), led("d3", 192)],
    );
    const [a, b, c] = glowCircles(container).map((e) => Number(e.getAttribute("r")));
    const upper = a - b;
    const lower = b - c;
    // Equal decades of current give near-equal steps of radius; a linear map
    // would put almost the whole range in the top decade.
    expect(Math.abs(upper - lower)).toBeLessThan(0.5);
  });
});
