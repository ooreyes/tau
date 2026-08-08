import type { SchematicComponent } from "../schematic/types";
import { ledGlowField } from "../simulation/ledGlow";

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

  return (
    <g className="led-glow-layer" aria-hidden="true">
      {[...glow].map(([id, brightness]) => {
        const component = byId.get(id);
        // A dark LED draws nothing: an always-present faint disc would read as
        // a permanently half-lit part.
        if (!component || brightness <= 0) return null;
        return (
          <circle
            key={`led-glow-${id}`}
            className="led-glow"
            cx={component.x}
            cy={component.y}
            // The halo grows with brightness as well as fading in; a disc that
            // only changes opacity reads as a rendering artifact rather than as
            // a lamp.
            r={10 + brightness * 12}
            style={{ opacity: 0.18 + brightness * 0.62 }}
          />
        );
      })}
    </g>
  );
}
