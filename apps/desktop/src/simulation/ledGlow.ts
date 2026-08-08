/**
 * How brightly a simulated LED should read on the schematic.
 *
 * The point of drawing an LED is that it tells you something at a glance, and a
 * line drawing that looks identical whether it is passing 20 mA or nothing at
 * all throws that away. This maps solved forward current onto a 0..1 brightness
 * the canvas can render.
 *
 * Three commitments, in order of importance:
 *
 * 1. **Never glow without a result.** Brightness is only ever computed from a
 *    solved current. There is no idle shimmer, no "probably on" state.
 * 2. **Reverse bias is dark**, because a real LED is. The sign convention is the
 *    one both engines already report: positive is anode -> cathode.
 * 3. **The scale is logarithmic**, because perceived brightness is. A linear
 *    ramp would make everything below a few mA look off, which is wrong for the
 *    indicator LEDs most circuits actually use.
 */

/**
 * Below this the part reads as dark. A real indicator LED is barely visible at
 * tens of microamps in a lit room, and the floor also keeps solver noise around
 * zero from lighting up a part that is genuinely off.
 */
export const LED_DARK_AMPS = 50e-6;

/**
 * Full brightness. 20 mA is the classic indicator-LED rating and what almost
 * every textbook series resistor is sized for, so a correctly designed circuit
 * lands at the top of the scale rather than halfway up it.
 */
export const LED_FULL_AMPS = 20e-3;

const DECADES = Math.log10(LED_FULL_AMPS / LED_DARK_AMPS);

/**
 * 0 when dark, 1 at the rated current, logarithmic in between. Current beyond
 * the rating clamps: a part driven at 200 mA is not ten times brighter, it is
 * on fire, and that is a job for the measurement advisory rather than the glow.
 */
export function ledBrightness(amps: number): number {
  if (!Number.isFinite(amps) || amps <= LED_DARK_AMPS) return 0;
  if (amps >= LED_FULL_AMPS) return 1;
  return Math.log10(amps / LED_DARK_AMPS) / DECADES;
}

/**
 * Brightness for every LED that carries a solved current, keyed by component
 * id. Parts with no entry are absent rather than zero, so a caller can tell
 * "solved and dark" from "not solved at all".
 */
export function ledGlowField(
  components: readonly { id: string; kind: string }[],
  currents: ReadonlyMap<string, number> | null,
): Map<string, number> {
  const glow = new Map<string, number>();
  if (!currents) return glow;
  for (const component of components) {
    if (component.kind !== "led") continue;
    const amps = currents.get(component.id);
    if (amps === undefined || !Number.isFinite(amps)) continue;
    glow.set(component.id, ledBrightness(amps));
  }
  return glow;
}
