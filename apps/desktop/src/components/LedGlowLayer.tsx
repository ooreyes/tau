import type { SchematicComponent } from "../schematic/types";
import { ledColorFromValue, type LedColor } from "../engine/idealModels";
import { ledGlowField } from "../simulation/ledGlow";
import { componentVisualPlacement } from "./Canvas.geometry";

/**
 * Lights the LEDs on the schematic from their solved forward current.
 *
 * This is an overlay rather than a change to the LED symbol, for the same
 * reason `OpCurrentFlowLayer` is: `ComponentSymbol` is a pure function of kind
 * and value, and threading a simulation result into it would make every symbol
 * a consumer of solver state. Overlays keep the drawing static and the
 * measurement on top of it.
 *
 * Tau does not model an LED's wavelength, so every part glows in the amber
 * `--signal` lamp rather than in a colour the simulation did not compute.
 * Inventing red and green here would be a confident guess about a property the
 * solver has no opinion on.
 */

/**
 * Alpha profile of the halo, centre to rim.
 *
 * The first version of this was a flat `--signal-glow` disc with a 1px
 * `--signal` outline, and that is the whole reason it read as a sticker rather
 * than as light: emission has no edge. These stops approximate the inverse-
 * square falloff of a point emitter - steep through the first third, a long
 * shallow tail - and the last one is opaque-zero, so the disc has no rim to
 * find. Anything else here (a linear ramp, a stop that lands above zero) puts
 * a visible boundary back on the canvas.
 */
const GLOW_STOPS: readonly { offset: number; alpha: number; core?: boolean }[] = [
  { offset: 0, alpha: 1, core: true },
  { offset: 0.16, alpha: 0.78, core: true },
  { offset: 0.34, alpha: 0.45 },
  { offset: 0.56, alpha: 0.18 },
  { offset: 0.78, alpha: 0.05 },
  { offset: 1, alpha: 0 },
];

/** The gradient is identical for every LED, so it is defined once per layer. */
const GLOW_GRADIENT_ID = "tau-led-glow";
const gradientId = (color: LedColor) => color === "red" ? GLOW_GRADIENT_ID : `${GLOW_GRADIENT_ID}-${color}`;

/**
 * Halo extent in schematic units. The LED body is ~28 units across, and the
 * gradient above is already down to 4% alpha at 72% of this radius, so the
 * perceptible disc at full drive is roughly 24 units - inside the part it
 * belongs to. The geometric radius runs further only to give the tail
 * somewhere to fade.
 */
const GLOW_MIN_R = 9;
const GLOW_MAX_R = 21;

/**
 * How hard the lamp is driven.
 *
 * The floor is high because a real die is bright as soon as it conducts at all
 * - what a milliamp buys you is a bigger, stronger bloom, not a dimmer dot, and
 * the radius above already carries that. A floor near zero made a conducting
 * LED read as a brown smudge, which is not what "on" looks like. The ceiling
 * stops short of 1 so the symbol survives being lit.
 */
const GLOW_MIN_OPACITY = 0.5;
const GLOW_MAX_OPACITY = 0.96;

const lerp = (min: number, max: number, t: number) => min + (max - min) * t;

export function LedGlowLayer({
  components,
  currents,
}: {
  components: readonly SchematicComponent[];
  /** Solved per-component current, anode to cathode positive. Null when there
   *  is no result, in which case nothing is drawn at all. */
  currents: ReadonlyMap<string, number> | null;
}) {
  const glow = ledGlowField(components, currents);
  if (glow.size === 0) return null;
  const byId = new Map(components.map((component) => [component.id, component]));
  const colors = new Set(
    [...glow.keys()]
      .map((id) => byId.get(id))
      .filter((component): component is SchematicComponent => Boolean(component))
      .map((component) => ledColorFromValue(component.value)),
  );

  return (
    <g className="led-glow-layer" aria-hidden="true">
      <defs>
        {[...colors].map((color) => (
          <radialGradient key={color} id={gradientId(color)} className={`led-color-${color}`} cx="50%" cy="50%" r="50%">
            {GLOW_STOPS.map((stop) => (
              <stop
                key={`${color}-${stop.offset}`}
                className={stop.core ? "led-glow-core" : "led-glow-halo"}
                offset={`${stop.offset * 100}%`}
                stopOpacity={stop.alpha}
              />
            ))}
          </radialGradient>
        ))}
      </defs>
      {[...glow].map(([id, brightness]) => {
        const component = byId.get(id);
        // A dark LED draws nothing: an always-present faint disc would read as
        // a permanently half-lit part.
        if (!component || brightness <= 0) return null;
        // The stored anchor is NOT where the body is drawn. An LED imported
        // from an LTspice `.asc` keeps that file's anchor (the anode pin) and
        // `Canvas` renders the symbol at the placement fitted to its pin bank,
        // so centring on `component.x/y` hung the halo off the top corner of
        // the part. The same call the canvas uses is the only way these two
        // cannot disagree.
        const placement = componentVisualPlacement(component);
        const color = ledColorFromValue(component.value);
        return (
          <circle
            key={`led-glow-${id}`}
            className={`led-glow led-color-${color}`}
            cx={placement.x}
            cy={placement.y}
            fill={`url(#${gradientId(color)})`}
            // The halo grows with brightness as well as brightening; a disc
            // that only changes opacity reads as a rendering artifact rather
            // than as a lamp.
            r={lerp(GLOW_MIN_R, GLOW_MAX_R, brightness)}
            style={{ opacity: lerp(GLOW_MIN_OPACITY, GLOW_MAX_OPACITY, brightness) }}
          />
        );
      })}
    </g>
  );
}
