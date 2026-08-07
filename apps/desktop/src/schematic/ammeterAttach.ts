/**
 * Where an ammeter attaches.
 *
 * A clamp meter reads the current through a BRANCH. Dropping it on a part is
 * unambiguous. Dropping it on a wire is the useful gesture — that is how you
 * think about it on a bench — but a wire is not itself a branch, so the drop
 * has to resolve to the part whose current that wire carries.
 *
 * That resolution is only honest when it is unique. A wire hanging off a
 * junction where three branches meet carries no single current, and quietly
 * picking one of them would put a confident number on the screen that belongs
 * to a different part. Those drops are refused instead.
 */
import type { SchematicComponent, SchematicWire } from "./types";
import { getComponentPins } from "./pins";
import { terminalRole } from "../simulation/terminalRoles";
import { canCurrentProbe } from "../simulation/analysisSetup";

const keyOf = (x: number, y: number) => `${x},${y}`;

/** Squared distance from `p` to segment `a`–`b`, for nearest-wire hit tests. */
function distanceToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return (p.x - cx) ** 2 + (p.y - cy) ** 2;
}

/** The wire nearest `point` within `tolerance`, or null. */
export function wireAtPoint(
  wires: readonly SchematicWire[],
  point: { x: number; y: number },
  tolerance = 8,
): SchematicWire | null {
  let best: SchematicWire | null = null;
  let bestDist = tolerance * tolerance;
  for (const wire of wires) {
    for (let i = 1; i < wire.points.length; i += 1) {
      const d = distanceToSegment(point, wire.points[i - 1]!, wire.points[i]!);
      if (d <= bestDist) {
        bestDist = d;
        best = wire;
      }
    }
  }
  return best;
}

export type AmmeterAttachment =
  | { ok: true; componentId: string }
  /** The drop landed somewhere no single branch current exists. */
  | { ok: false; reason: string };

/**
 * Resolve a wire to the one part whose current it carries.
 *
 * A wire is in series with a part when exactly one series-carrying pin touches
 * it. Two or more and the wire is a junction: the current splits, and there is
 * no single answer to report.
 */
export function branchForWire(
  wire: SchematicWire,
  components: readonly SchematicComponent[],
): AmmeterAttachment {
  const onWire = new Set<string>();
  for (const p of wire.points) onWire.add(keyOf(p.x, p.y));

  const touching: string[] = [];
  for (const component of components) {
    for (const pin of getComponentPins(component)) {
      if (!onWire.has(keyOf(pin.x, pin.y))) continue;
      // Only a pin that carries the part's OWN current identifies a branch. A
      // gate, a bulk, an op-amp input tells us nothing about what this wire
      // carries.
      if (terminalRole(component.kind, String(pin.id)).role !== "series") continue;
      if (!component.label) continue;
      if (!touching.includes(component.id)) touching.push(component.id);
    }
  }

  if (touching.length === 1) return { ok: true, componentId: touching[0]! };
  if (touching.length === 0) {
    return { ok: false, reason: "No part in series with this wire — drop the ammeter on a component instead." };
  }
  return {
    ok: false,
    reason: "This wire is a junction: the current splits here, so there is no single branch to measure.",
  };
}

/**
 * What an ammeter dropped at `point` should measure: the part under the
 * pointer, else the branch the wire under the pointer carries.
 */
export function resolveAmmeterTarget(
  point: { x: number; y: number },
  componentUnderPointer: SchematicComponent | null,
  wires: readonly SchematicWire[],
  components: readonly SchematicComponent[],
): AmmeterAttachment {
  if (componentUnderPointer) {
    if (!componentUnderPointer.label) {
      return { ok: false, reason: "Give this part a reference designator before measuring its current." };
    }
    // A part with no series pin (an op-amp, a logic gate) reports no single
    // branch current, so clamping round it would measure nothing.
    const hasSeries = getComponentPins(componentUnderPointer)
      .some((pin) => terminalRole(componentUnderPointer.kind, String(pin.id)).role === "series");
    if (!hasSeries) {
      return { ok: false, reason: `${componentUnderPointer.label} has no single branch current to measure.` };
    }
    // The store applies this same rule and silently drops the placement when it
    // fails. Checking it here means the user is told why instead of clicking a
    // part and watching nothing happen.
    if (!canCurrentProbe(componentUnderPointer.kind)) {
      return {
        ok: false,
        reason: `The engine does not report a branch current for ${componentUnderPointer.label} (${componentUnderPointer.kind}).`,
      };
    }
    return { ok: true, componentId: componentUnderPointer.id };
  }
  const wire = wireAtPoint(wires, point);
  if (!wire) return { ok: false, reason: "Drop the ammeter on a component or a wire." };
  return branchForWire(wire, components);
}
