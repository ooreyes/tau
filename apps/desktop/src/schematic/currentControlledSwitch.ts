import type { SchematicComponent } from "./types";

/** True only for LTspice's two-terminal `csw.asy` current-controlled switch.
 * Tau's native/`sw.asy` switch shares the `switch` kind but has four terminals
 * and is voltage controlled, so kind alone is intentionally insufficient. */
export function isLtspiceCurrentControlledSwitch(component: SchematicComponent): boolean {
  if (component.kind !== "switch") return false;
  const segments = (component.ltSymbolType ?? "").trim().split(/[\\/]/);
  return segments[segments.length - 1]?.toLowerCase() === "csw";
}

/** Browser-preview solvers have no branch-current-controlled switch stamp.
 * Refusing explicitly is safer than their ordinary switch fallback, which
 * would turn this part into a confident but permanently open/closed circuit. */
export function previewCurrentControlledSwitchMessage(
  components: readonly SchematicComponent[],
): string | null {
  const component = components.find(isLtspiceCurrentControlledSwitch);
  if (!component) return null;
  const ref = component.label.trim() || "The imported csw";
  return `${ref} is an LTspice current-controlled switch. It requires the native ngspice engine; this preview solver will not approximate it as a fixed open or closed switch.`;
}
