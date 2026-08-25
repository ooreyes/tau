import { parsePotentiometerSpec } from "../engine/potentiometerSpec";
import { decodeParams, encodeParams } from "./params";
import { logicConstantVolts } from "./kindGroups";
import { rotatePoint } from "./pins";
import { WIPER_TRAVEL_X } from "./symbols";
import type { ComponentKind, Rotation, SchematicComponent } from "./types";

/**
 * Which parts a reader can operate on the simulator canvas, and what a click
 * does to them.
 *
 * A switch on a schematic is not decoration: the whole point of drawing one is
 * that the circuit behaves differently with it open and closed. Until now the
 * only way to move a contact was a text field in the Properties panel, which is
 * schematic-mode only, so the one gesture every reader tries first - press the
 * button and watch - did nothing at all.
 *
 * This module is the pure part of that: given a component and a press or a
 * release, what should its value become? It knows nothing about the canvas, the
 * store, or re-running, which is what makes the sign conventions testable.
 */

/** How a contact responds to being clicked. */
export type ActuationAction = "momentary" | "latching";

export interface ContactActuation {
  /** Field in the encoded value that carries the contact position. */
  stateKey: string;
  /** The two positions, spelled the way the solver already reads them. */
  positions: readonly [string, string];
  action: ActuationAction;
  /**
   * Where a momentary contact sits when nobody is holding it. Absent for a
   * latching part, which has no rest position - both are equally settled.
   */
  rest?: string;
  /** Present tense, for the accessible name and the status line. */
  verb: string;
}

/**
 * A part that looks operable but is not, with the reason to show instead.
 *
 * A relay is the case that matters. It has a moving contact and it is obviously
 * a switch, so a reader will click it; but it is driven by its coil, and
 * throwing it by hand would contradict the simulation rather than drive it.
 * Saying so is better than a dead click.
 */
export const NON_ACTUABLE: Partial<Record<ComponentKind, string>> = {
  relay: "is thrown by its coil, not by hand. Drive the coil terminals to close it.",
  motor: "turns when it is driven. There is nothing to operate by hand.",
};

const ACTUATION: Partial<Record<ComponentKind, ContactActuation>> = {
  // A toggle switch stays where it is put, so both positions are rest positions.
  switch: {
    stateKey: "state",
    positions: ["open", "closed"],
    action: "latching",
    verb: "toggle",
  },
  // A push button springs back. `form` says which way: a normally-open button
  // rests open and closes while held, a normally-closed one does the reverse.
  pushButton: {
    stateKey: "state",
    positions: ["open", "closed"],
    action: "momentary",
    verb: "press",
  },
  spdt: {
    stateKey: "throw",
    positions: ["no", "nc"],
    action: "latching",
    verb: "throw",
  },
};

export function contactActuation(kind: ComponentKind): ContactActuation | null {
  return ACTUATION[kind] ?? null;
}

/** True when the reader can operate this part on the simulator canvas. */
export function isActuable(kind: ComponentKind): boolean {
  return kind === "logicConstant" || kind in ACTUATION;
}

/** Which of the two positions this value is sitting in. */
function positionOf(actuation: ContactActuation, raw: string): string {
  const [first, second] = actuation.positions;
  const state = raw.trim().toLowerCase();
  // Spellings the solver already accepts for "closed" (see `kindGroups.ts`),
  // so a hand-typed `on` or `1` actuates like the canonical word.
  if (actuation.stateKey === "state") {
    const closed = state.startsWith("closed") || state === "pressed" || state === "on" || state === "1";
    return closed ? second : first;
  }
  return state.startsWith("nc") || state === "2" ? second : first;
}

/**
 * Which of its two positions this part's contact is sitting in right now,
 * spelled the way the solver reads it (`open`/`closed`, `no`/`nc`), or null
 * when the part has no contact to read.
 *
 * Shares `positionOf` with `actuatedValue` on purpose: a readout that decoded
 * the state itself would eventually disagree with the actuator about what
 * `on`, `1` or `pressed` mean, and then the panel would say OPEN about a
 * closed switch.
 */
export function contactPosition(component: Pick<SchematicComponent, "kind" | "value">): string | null {
  const actuation = contactActuation(component.kind);
  if (!actuation) return null;
  const decoded = decodeParams(component.kind, component.value);
  return positionOf(actuation, decoded[actuation.stateKey] ?? "");
}

const other = (actuation: ContactActuation, position: string): string =>
  position === actuation.positions[0] ? actuation.positions[1] : actuation.positions[0];

/**
 * How a momentary part behaves depends on where it rests, and the position it
 * was in before anyone touched it *is* that rest position. So the first
 * actuation records it explicitly; afterwards the stored `form` is the truth
 * and pressing no longer has to guess.
 *
 * Without this a normally-closed button would spring to open after its first
 * press, because by then its live state no longer says what it started as.
 */
function restPosition(
  actuation: ContactActuation,
  decoded: Record<string, string>,
  raw: string,
): string {
  // The decoder fills `form` with its fallback, so a decoded value cannot say
  // whether the form was ever written down. Ask the stored string itself: only
  // an explicit `form=` overrides what the untouched state already tells us.
  if (/\bform\s*=/i.test(raw)) {
    const form = (decoded.form ?? "").trim().toLowerCase();
    if (form === "nc") return actuation.positions[1];
    if (form === "no") return actuation.positions[0];
  }
  return positionOf(actuation, decoded[actuation.stateKey] ?? "");
}

export type ActuationPhase = "press" | "release";

/**
 * The value this component should take for a press or a release, or null when
 * nothing should change - a latching part ignores the release, and a part that
 * does not actuate ignores both.
 *
 * Every other field is preserved: the encode round-trip carries a push button's
 * `action` and a switch's hand-typed spelling through untouched.
 */
export function actuatedValue(
  component: Pick<SchematicComponent, "kind" | "value">,
  phase: ActuationPhase,
): string | null {
  if (component.kind === "logicConstant") {
    if (phase === "release") return null;
    try {
      return logicConstantVolts(component.value) === 1 ? "0" : "1";
    } catch {
      return null;
    }
  }
  const actuation = contactActuation(component.kind);
  if (!actuation) return null;

  const decoded = decodeParams(component.kind, component.value);
  const current = positionOf(actuation, decoded[actuation.stateKey] ?? "");
  const action = ((decoded.action ?? "").trim().toLowerCase() === "latching"
    || (decoded.action ?? "").trim().toLowerCase() === "momentary")
    ? (decoded.action.trim().toLowerCase() as ActuationAction)
    : actuation.action;

  if (action === "latching") {
    if (phase === "release") return null;
    return encodeParams(component.kind, { ...decoded, [actuation.stateKey]: other(actuation, current) });
  }

  const rest = restPosition(actuation, decoded, component.value);
  const next = phase === "press" ? other(actuation, rest) : rest;
  if (next === current && phase === "release") return null;
  return encodeParams(component.kind, {
    ...decoded,
    [actuation.stateKey]: next,
    // Pin the rest position on the way in, before the live state stops being
    // able to tell us what it was.
    ...(actuation.action === "momentary"
      ? { form: rest === actuation.positions[1] ? "nc" : "no" }
      : {}),
  });
}

/** Accessible name for the actuator, e.g. "Press S1" / "Toggle SW2". */
export function actuationLabel(component: Pick<SchematicComponent, "kind" | "label">): string | null {
  if (component.kind === "logicConstant") return `Toggle ${component.label || "logic constant"}`;
  if (isDraggableWiper(component.kind)) return `Drag the ${component.label || "potentiometer"} wiper`;
  const actuation = contactActuation(component.kind);
  if (!actuation) return null;
  const verb = actuation.verb.charAt(0).toUpperCase() + actuation.verb.slice(1);
  return `${verb} ${component.label || "contact"}`;
}

/* ── The other operable part: a wiper you drag rather than a contact you press ──
 *
 * A potentiometer already had a real `Wiper=` parameter splitting its track
 * (`engine/potentiometerSpec.ts`), but the only way to move it was a number box
 * in a panel the simulator does not show. Everything below is the pure half of
 * making it a control: pointer displacement in, tap fraction out. It knows
 * nothing about the canvas, the store, or re-solving.
 */

/** Steps the wiper is quantised to. 1 % is finer than the drawing can show and
 *  keeps the value string short enough to read on the sheet. */
export const WIPER_STEP = 0.01;

/** True when the reader can drag this part's tap on the simulator canvas. */
export function isDraggableWiper(kind: ComponentKind): boolean {
  return kind === "potentiometer";
}

/** The tap fraction this part's value is currently sitting at. */
export function wiperFraction(component: Pick<SchematicComponent, "kind" | "value">): number {
  return parsePotentiometerSpec(component.value).wiper;
}

const INVERSE_ROTATION: Record<Rotation, Rotation> = { 0: 0, 90: 270, 180: 180, 270: 90 };

/**
 * The tap fraction after dragging `dx`/`dy` world units from where the pointer
 * was pressed, given the fraction it was pressed at.
 *
 * Two decisions worth keeping:
 *
 * - **Relative, not absolute.** Mapping the pointer straight onto the track
 *   would jerk the wiper to wherever the reader happened to click, and on the
 *   simulator canvas clicking a part is also how you select it to read its
 *   telemetry. Grabbing anywhere on the body and dragging is unambiguous.
 * - **Returned unclamped.** The caller keeps accumulating past an end stop and
 *   the value clamps on the way out, so dragging 200 units past the end and
 *   back leaves the wiper where the pointer is rather than 200 units of
 *   hysteresis away from it.
 *
 * `dx`/`dy` are world units, so the part's rotation and mirror are undone here
 * (mirror-then-rotate, inverted) - dragging right on a part rotated 90° has to
 * move the tap the way the arrow points, not the way the screen does.
 */
export function draggedWiper(
  component: Pick<SchematicComponent, "rotation" | "mirrored">,
  pressedAt: number,
  dx: number,
  dy: number,
): number {
  const unrotated = rotatePoint({ x: dx, y: dy }, INVERSE_ROTATION[component.rotation]);
  const localX = component.mirrored ? -unrotated.x : unrotated.x;
  return pressedAt + localX / (2 * WIPER_TRAVEL_X);
}

/**
 * The value this part should take for a tap fraction, or null when nothing
 * should change - the part is not a potentiometer, or the drag has not yet
 * moved the tap by a whole step.
 *
 * Encoding goes through the same codec the Properties panel uses, so a centred
 * wiper still re-encodes to the bare `10k` every saved schematic has on disk
 * (`omitWhenFallback`), and every other token in the value survives the edit.
 */
export function wiperValue(
  component: Pick<SchematicComponent, "kind" | "value">,
  fraction: number,
): string | null {
  if (!isDraggableWiper(component.kind)) return null;
  const clamped = Math.min(1, Math.max(0, fraction));
  const stepped = (Math.round(clamped / WIPER_STEP) * WIPER_STEP).toFixed(2);
  const decoded = decodeParams(component.kind, component.value);
  const next = encodeParams(component.kind, { ...decoded, wiper: String(Number(stepped)) });
  return next === component.value ? null : next;
}
