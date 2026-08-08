import {
  contactActuation,
  contactPosition,
  isActuable,
  isDraggableWiper,
  wiperFraction,
} from "./actuation";
import type { ComponentKind, SchematicComponent } from "./types";

/**
 * Which parts of a schematic a reader can operate, and how to say so.
 *
 * `actuation.ts` answers "what does a click do to *this* part". This module
 * answers the document-level question that the simulator needs before the
 * reader has clicked anything: **is this circuit interactive at all, and which
 * parts are the controls?**
 *
 * That distinction matters because the simulator's whole contract is that it
 * does not edit the circuit - it even shows a padlock saying so. A switch is
 * the one exception, and until the reader happens to hover exactly over it
 * there is nothing on screen that says the exception exists. Detecting the
 * controls up front is what lets the simulator name them.
 *
 * Pure by construction: components in, plain data and strings out. It knows
 * nothing about React, the store, or the solver, so the copy and the sign
 * conventions are testable without rendering anything.
 */

/** How the control is worked: a contact you click, or a tap you drag. */
export type LiveControlForm = "contact" | "wiper";

export interface LiveControl {
  id: string;
  /** Reference designator, e.g. `S1`. */
  name: string;
  kind: ComponentKind;
  form: LiveControlForm;
  /** Present tense, what the reader's gesture does: toggle / press / throw / drag. */
  gesture: string;
  /**
   * Where the control is sitting right now, ready to print: `OPEN`, `NC`,
   * `62%`. This is the live part of the live viewer - it is read straight off
   * the component value, so it tracks every actuation with no extra plumbing.
   */
  position: string;
}

/**
 * The one membership rule, so the predicate below and the readouts further
 * down can never disagree about what counts as a control.
 */
const isOperable = (kind: ComponentKind): boolean => isActuable(kind) || isDraggableWiper(kind);

/**
 * True when at least one part on the sheet can be operated by hand.
 *
 * Deliberately narrower than "has a moving part". A relay has a contact and
 * looks every bit as operable as a switch, but it is thrown by its coil
 * (`NON_ACTUABLE`), so a relay on its own does not make a circuit interactive -
 * announcing controls the reader cannot work would be worse than saying
 * nothing.
 */
export function isInteractiveSchematic(components: readonly Pick<SchematicComponent, "kind">[]): boolean {
  return components.some((component) => isOperable(component.kind));
}

/** Fallback when a part carries no reference designator, so a readout row and
 *  the hint sentence both still have something to name. */
const UNNAMED = "This control";

function positionText(component: Pick<SchematicComponent, "kind" | "value">): string {
  if (isDraggableWiper(component.kind)) {
    return `${Math.round(wiperFraction(component) * 100)}%`;
  }
  // `open` / `closed` / `no` / `nc` - the solver's own spellings, which read
  // correctly as instrument capitals without a per-kind lookup table.
  return (contactPosition(component) ?? "").toUpperCase();
}

/**
 * Every operable part, in document order, with the state it is in.
 *
 * Document order rather than sorted: the reader is matching these rows against
 * symbols on a drawing, and a stable order that does not reshuffle when a
 * switch closes is worth more than alphabetisation.
 */
export function liveControls(
  components: readonly SchematicComponent[],
): LiveControl[] {
  const controls: LiveControl[] = [];
  for (const component of components) {
    if (!isOperable(component.kind)) continue;
    const wiper = isDraggableWiper(component.kind);
    controls.push({
      id: component.id,
      name: component.label?.trim() || UNNAMED,
      kind: component.kind,
      form: wiper ? "wiper" : "contact",
      gesture: wiper ? "drag" : contactActuation(component.kind)?.verb ?? "operate",
      position: positionText(component),
    });
  }
  return controls;
}

/** The analyses an actuation can re-run, matching `pickAutoRunAnalysis`. */
export type LiveAnalysis = "tran" | "op" | "ac" | "dc" | "tf" | "noise";

/**
 * What actually happens after the reader operates a control.
 *
 * Named per analysis rather than a generic "the result updates" because the
 * consequence genuinely differs: an operating point is instant, a transient
 * re-runs its whole window. Telling the reader which one is about to happen is
 * the difference between a wait they expected and a UI that looks stuck.
 */
const RERUN: Record<LiveAnalysis, string> = {
  op: "the operating point re-solves",
  tran: "the transient re-runs",
  ac: "the AC sweep re-runs",
  dc: "the DC sweep re-runs",
  tf: "the transfer function re-runs",
  noise: "the noise analysis re-runs",
};

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * One sentence naming the control and the consequence, or null when the
 * schematic has nothing to operate.
 *
 * With a single control it names that control and its gesture, because that is
 * the specific thing the reader has to find on the drawing. With several it
 * stops naming them - the readouts beside it already do - and states the
 * consequence once.
 */
export function liveControlHint(
  controls: readonly LiveControl[],
  analysis: LiveAnalysis,
): string | null {
  if (controls.length === 0) return null;
  const rerun = RERUN[analysis];
  if (controls.length === 1) {
    const only = controls[0];
    return `${capitalize(only.gesture)} ${only.name} on the circuit and ${rerun}.`;
  }
  return `Operate a control on the circuit and ${rerun}.`;
}
