import {
  contactActuation,
  contactPosition,
  isActuable,
  isDraggableWiper,
  wiperFraction,
} from "./actuation";
import { logicConstantVolts } from "./kindGroups";
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
export type LiveControlForm = "contact" | "wiper" | "binary";

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
  if (component.kind === "logicConstant") {
    try {
      return logicConstantVolts(component.value) === 1 ? "1 · HIGH" : "0 · LOW";
    } catch {
      return "UNKNOWN";
    }
  }
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
    const binary = component.kind === "logicConstant";
    controls.push({
      id: component.id,
      name: component.label?.trim() || UNNAMED,
      kind: component.kind,
      form: wiper ? "wiper" : binary ? "binary" : "contact",
      gesture: wiper ? "drag" : binary ? "toggle" : contactActuation(component.kind)?.verb ?? "operate",
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
 * What operating a control does while a circuit is energised.
 *
 * A live run does not re-run anything: `simulation/liveActuation.ts` halts the
 * solver, alters the one device the emitter wrote for this part, and resumes
 * the SAME transient, so the trace already on screen acquires a corner. Saying
 * "the transient re-runs" there would describe a restart from t = 0 that does
 * not happen, and would tell the reader to expect the plot to blank.
 */
const LIVE_RERUN = "the running trace bends";

/**
 * What operating a control does to an IDLE circuit that the live engine can
 * energise.
 *
 * Neither of the other two sentences is true there. "The transient re-runs"
 * describes the re-solve from t = 0 that this replaced, and that re-solve is
 * precisely what could never show the edge the reader had just made — closing a
 * switch swapped a flat 0 V trace for a flat 5 V one and the step between them
 * existed in no run. "The running trace bends" is not true either, because
 * nothing is running yet. Naming both halves is the point: the click starts the
 * circuit AND lands on it.
 */
const LIVE_ENERGISE = "the circuit starts running and the trace bends";

/** What a control's consequence depends on: the run, not the selected mode. */
export type LiveControlConsequence =
  /** A solve is genuinely in flight; the alter lands on it. */
  | "running"
  /** Nothing is running, but this click will energise the circuit and then land. */
  | "energises"
  /** Nothing is running and nothing will be; the bounded analysis re-solves. */
  | "re-runs";

/**
 * One sentence naming the control and the consequence, or null when the
 * schematic has nothing to operate.
 *
 * With a single control it names that control and its gesture, because that is
 * the specific thing the reader has to find on the drawing. With several it
 * stops naming them - the readouts beside it already do - and states the
 * consequence once.
 *
 * The consequence is the RUN's real state and capability, never the transport's
 * selected mode. A solve in flight bends; an idle circuit the live engine can
 * energise starts and then bends; and an idle circuit it cannot - an AC sweep, a
 * project-hierarchy deck, a build with no desktop bridge - re-solves, which is
 * the carve-out `App.liveControls.test.tsx`'s "operating a control keeps the
 * result on screen" case pins.
 *
 * The boolean spelling is kept for callers that only know whether a run is in
 * flight, because "is something running" is the question most of them have.
 */
export function liveControlHint(
  controls: readonly LiveControl[],
  analysis: LiveAnalysis,
  consequence: LiveControlConsequence | boolean = "re-runs",
): string | null {
  if (controls.length === 0) return null;
  const resolved: LiveControlConsequence =
    consequence === true ? "running"
    : consequence === false ? "re-runs"
    : consequence;
  const rerun =
    resolved === "running" ? LIVE_RERUN
    : resolved === "energises" ? LIVE_ENERGISE
    : RERUN[analysis];
  if (controls.length === 1) {
    const only = controls[0];
    return `${capitalize(only.gesture)} ${only.name} on the circuit and ${rerun}.`;
  }
  return `Operate a control on the circuit and ${rerun}.`;
}
