import type { PinOverride, Point, Rotation, SchematicComponent, SchematicPortDirection } from "./types";
import { rotatePoint, transformPoint } from "./pins";

/** Narrowest a block body may be. Also the legacy constant width, so a block
 *  with short captions is drawn exactly as it was before Item 14. */
export const SUBCIRCUIT_BODY_HALF_WIDTH = 28;
/** Widest a block body may grow. Past this the captions ellipsise instead:
 *  a block that keeps growing with its port names stops reading as a block. */
export const SUBCIRCUIT_BODY_MAX_HALF_WIDTH = 40;
export const SUBCIRCUIT_PIN_X = 48;
/** Inset of a pin caption from the body edge it hangs off (Canvas draws the
 *  caption at minX + 4 / maxX - 4, and the width rule must agree with it). */
export const SUBCIRCUIT_CAPTION_INSET = 4;
/**
 * Horizontal advance of one caption glyph, in schematic units.
 *
 * `.subckt-pin-label` is `500 7px var(--font-mono)` and only its `fill` is
 * re-declared per theme, so this constant is theme-independent by
 * construction - which is what lets a body width computed here be trusted in
 * light and dark alike. 0.6em is the advance ratio every mono face in the
 * stack shares; it is an upper bound for SF Mono / Menlo / Consolas.
 */
export const SUBCIRCUIT_CAPTION_ADVANCE = 4.2;
/** Clear channel kept down the middle of the body for the model/sheet name. */
export const SUBCIRCUIT_MODEL_GUTTER = 8;

const inverseRotation = (rotation: Rotation): Rotation => (((360 - rotation) % 360) as Rotation);

function verticalOffsets(count: number): number[] {
  if (count <= 0) return [];
  // Keep every terminal on Tau's 16-unit connection grid. Even banks straddle
  // the centre; odd banks include it.
  const step = 32;
  return Array.from({ length: count }, (_, index) => (index - (count - 1) / 2) * step);
}

export interface SubcircuitPortSlot {
  side: "left" | "right";
  /** 0-based row within that column, top to bottom. */
  index: number;
}

/**
 * THE ONE SIDE RULE. Which column each port lands in, and in which row.
 *
 * With `directions`: In -> left, Out -> right, BiDir -> whichever column
 * currently has fewer pins, ties going LEFT. That tie rule is what puts a
 * GND/BiDir at the bottom-left of a 3-port block, the way an EE draws one.
 * Without `directions`: the historical ceil(n/2) half-split, byte-for-byte, so
 * no document saved before Item 14 moves a terminal.
 *
 * WHY SIDE IS ELECTRICALLY FREE - the proof, because the whole drawing-first
 * design rests on it. `buildSubcircuitPinOverride` keeps pin `id` at
 * `p{i+1}` and pin `label` at `ports[i]` in PORTS ORDER whichever side the pin
 * lands on. `exactLinkForComponent` (projectHierarchy.ts:162-173) sorts the
 * bank by the numeric part of the id and then asserts only id and label;
 * documentValidation likewise asserts only id and label. Neither reads x or y.
 * So the emitted `X` card is byte-identical whatever this function decides.
 * Order is a property of the array; side is a property of direction.
 *
 * There must never be a second rule about which side a pin is on: the bank
 * builder, the renderer and the inspector's side reporting all come here.
 */
export function subcircuitPortSlots(
  ports: readonly string[],
  directions?: readonly SchematicPortDirection[],
): readonly SubcircuitPortSlot[] {
  const count = ports.length;
  if (!directions) {
    const leftCount = count <= 1 ? count : Math.ceil(count / 2);
    return ports.map((_, index) => (index < leftCount
      ? { side: "left" as const, index }
      : { side: "right" as const, index: index - leftCount }));
  }
  let left = 0;
  let right = 0;
  return ports.map((_, index) => {
    // A direction we were not given is treated as BiDir: it balances rather
    // than guessing an intent the child never declared.
    const direction = directions[index] ?? "BiDir";
    const side = direction === "In" ? "left"
      : direction === "Out" ? "right"
        : left <= right ? "left" : "right";
    if (side === "left") return { side, index: left++ };
    return { side, index: right++ };
  });
}

/** Deterministic p1..pN terminal bank for a native menu-selected X device. */
export function buildSubcircuitPinOverride(
  component: Pick<SchematicComponent, "x" | "y" | "rotation" | "mirrored">,
  ports: readonly string[],
  directions?: readonly SchematicPortDirection[],
): PinOverride[] {
  const safePorts = ports.slice(0, 64);
  const slots = subcircuitPortSlots(safePorts, directions?.slice(0, 64));
  const rows = { left: 0, right: 0 };
  for (const slot of slots) rows[slot.side] += 1;
  const columnY = { left: verticalOffsets(rows.left), right: verticalOffsets(rows.right) };
  return safePorts.map((label, index) => {
    const slot = slots[index];
    const local: Point = {
      x: slot.side === "left" ? -SUBCIRCUIT_PIN_X : SUBCIRCUIT_PIN_X,
      y: columnY[slot.side][slot.index],
    };
    const oriented = transformPoint(local, component.rotation, component.mirrored ?? false);
    return {
      // id and label are ORDER, never side - see subcircuitPortSlots' proof.
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

/**
 * Which physical side each persisted terminal sits on, in ports order.
 *
 * This is the read-back half of the side rule, and it is why direction drift
 * needs ZERO new storage: the bank IS the persisted record of the directions
 * used at link time, because side is losslessly recoverable from it. A pin at
 * local x = 0 (only reachable through a hand-edited or imported bank) reports
 * null rather than being forced onto a side it was never on.
 */
export function subcircuitBankSides(
  component: SchematicComponent,
): readonly ("left" | "right" | null)[] {
  return localSubcircuitPins(component).map((pin) => (pin.x < 0 ? "left" : pin.x > 0 ? "right" : null));
}

/** Advance of `text` as a caption, in schematic units. */
export function subcircuitCaptionWidth(text: string): number {
  return text.length * SUBCIRCUIT_CAPTION_ADVANCE;
}

/** How many caption characters fit on one side of a body of this half-width. */
export function subcircuitCaptionBudget(halfWidth: number): number {
  const available = halfWidth - SUBCIRCUIT_CAPTION_INSET - SUBCIRCUIT_MODEL_GUTTER / 2;
  return Math.max(1, Math.floor(available / SUBCIRCUIT_CAPTION_ADVANCE));
}

/**
 * Middle-ellipsis, the pattern `PinLabel` already uses: the head and tail of a
 * name carry more identity than its middle ("VOUT_SENSE_A" -> "VOU…E_A"), and
 * the full string is still available through a <title>.
 */
export function middleEllipsisCaption(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return "…";
  const head = Math.ceil((maxChars - 1) / 2);
  const tail = maxChars - 1 - head;
  return `${text.slice(0, head)}…${tail > 0 ? text.slice(text.length - tail) : ""}`;
}

/**
 * The body box, still a PURE function of the persisted bank.
 *
 * That purity is the whole reason hit-testing, marquee selection, label
 * attachment and placement collision (Canvas.geometry.ts:59, 100, 372, 1278)
 * follow a widened body for free - so this one function is extended rather
 * than a second layout rule being introduced next to it.
 *
 * Height is unchanged. Width now fits the widest caption per side plus a
 * centre gutter for the model name, clamped to [28, 40] and rounded up to a
 * multiple of 4 so hairlines stay on crisp coordinates. Pins stay at
 * SUBCIRCUIT_PIN_X = 48, so even at the widest body the shortest lead is 8
 * units and still reads as a lead rather than a pin buried in the outline.
 */
export function nativeSubcircuitBody(component: SchematicComponent) {
  const pins = localSubcircuitPins(component);
  const maxPinY = Math.max(0, ...pins.map((pin) => Math.abs(pin.y)));
  /**
   * Room for the model caption ABOVE the topmost pin caption, not merely above
   * the topmost pin.
   *
   * Canvas draws the model name with its BASELINE at `minY + 8`, and a 7px
   * glyph box hangs ~1.5 units below its own baseline, so it actually occupies
   * `minY + 1.5 .. minY + 9.5`. The old `+ 12` reserved only 8 units, which is
   * why the two collided the moment a pin sat off-centre: a rectifier with pins
   * at y = +/-16 drew "Rectifier" through "SEC1".
   *
   * Solving `minY + 9.5 + 4 <= -maxPinY - 3.5` for a 4-unit gap gives
   * `halfHeight >= maxPinY + 17`; 18 keeps a unit spare. A 2-port bank
   * (maxPinY = 0, and anything up to 2) still floors at 20, so no existing
   * block changes size.
   */
  const halfHeight = Math.max(20, maxPinY + 18);
  const widest = (side: "left" | "right") => Math.max(
    0,
    ...pins
      .filter((pin) => (side === "left" ? pin.x < 0 : pin.x > 0))
      .map((pin) => subcircuitCaptionWidth(pin.label ?? "")),
  );
  const needed = (
    SUBCIRCUIT_CAPTION_INSET * 2 + widest("left") + widest("right") + SUBCIRCUIT_MODEL_GUTTER
  ) / 2;
  const halfWidth = Math.min(
    SUBCIRCUIT_BODY_MAX_HALF_WIDTH,
    Math.max(SUBCIRCUIT_BODY_HALF_WIDTH, Math.ceil(needed / 4) * 4),
  );
  return {
    minX: -halfWidth,
    minY: -halfHeight,
    maxX: halfWidth,
    maxY: halfHeight,
  };
}

export function isNativeMultiPinSubcircuit(component: SchematicComponent): boolean {
  return component.kind === "subckt" && !!component.pinOverride?.length && !component.ltSymbolType;
}
