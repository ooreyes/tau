import type { PinOverride, Point, Rotation, SchematicComponent } from "./types";
import { rotatePoint, transformPoint } from "./pins";

export const SUBCIRCUIT_BODY_HALF_WIDTH = 28;
export const SUBCIRCUIT_PIN_X = 48;

const inverseRotation = (rotation: Rotation): Rotation => (((360 - rotation) % 360) as Rotation);

function verticalOffsets(count: number): number[] {
  if (count <= 0) return [];
  // Keep every terminal on Tau's 16-unit connection grid. Even banks straddle
  // the centre; odd banks include it.
  const step = 32;
  return Array.from({ length: count }, (_, index) => (index - (count - 1) / 2) * step);
}

/** Deterministic p1..pN terminal bank for a native menu-selected X device. */
export function buildSubcircuitPinOverride(
  component: Pick<SchematicComponent, "x" | "y" | "rotation" | "mirrored">,
  ports: readonly string[],
): PinOverride[] {
  const safePorts = ports.slice(0, 64);
  const leftCount = safePorts.length <= 1 ? safePorts.length : Math.ceil(safePorts.length / 2);
  const rightCount = safePorts.length - leftCount;
  const leftY = verticalOffsets(leftCount);
  const rightY = verticalOffsets(rightCount);
  return safePorts.map((label, index) => {
    const left = index < leftCount;
    const local: Point = {
      x: left ? -SUBCIRCUIT_PIN_X : SUBCIRCUIT_PIN_X,
      y: left ? leftY[index] : rightY[index - leftCount],
    };
    const oriented = transformPoint(local, component.rotation, component.mirrored ?? false);
    return {
      id: `p${index + 1}`,
      label: label.slice(0, 80),
      x: component.x + oriented.x,
      y: component.y + oriented.y,
    };
  });
}

/** Recover authored local geometry after rotate/mirror changed world pins. */
export function localSubcircuitPins(component: SchematicComponent): PinOverride[] {
  return (component.pinOverride ?? []).map((pin) => {
    const relative = { x: pin.x - component.x, y: pin.y - component.y };
    const unrotated = rotatePoint(relative, inverseRotation(component.rotation));
    const local = component.mirrored ? { x: -unrotated.x, y: unrotated.y } : unrotated;
    return {
      ...pin,
      x: Object.is(local.x, -0) ? 0 : local.x,
      y: Object.is(local.y, -0) ? 0 : local.y,
    };
  });
}

export function nativeSubcircuitBody(component: SchematicComponent) {
  const maxPinY = Math.max(0, ...localSubcircuitPins(component).map((pin) => Math.abs(pin.y)));
  const halfHeight = Math.max(20, maxPinY + 12);
  return {
    minX: -SUBCIRCUIT_BODY_HALF_WIDTH,
    minY: -halfHeight,
    maxX: SUBCIRCUIT_BODY_HALF_WIDTH,
    maxY: halfHeight,
  };
}

export function isNativeMultiPinSubcircuit(component: SchematicComponent): boolean {
  return component.kind === "subckt" && !!component.pinOverride?.length && !component.ltSymbolType;
}
