/**
 * Operating the circuit while it is being solved.
 *
 * This is the payoff the live run exists for: with a solve in flight, throwing
 * a switch or dragging a pot wiper changes the waveform the engine is
 * *currently integrating*. Not a re-run from t=0 with the new value, not a
 * cosmetic redraw, not a change deferred until Stop — the same experiment,
 * continued, with a different circuit in it from that instant on.
 *
 * ## What the engine actually does with an alter
 *
 * `live_spice.rs::LiveRun::alter` is `bg_halt` → `alter …` → `bg_resume`, and
 * those three are one operation because ngspice will not accept an `alter`
 * against a plot its background thread is appending to. Two consequences run
 * through everything below.
 *
 * **The run stays continuous.** `bg_resume` continues the same transient from
 * the same accepted timestep: node voltages, capacitor charges and inductor
 * fluxes all survive the halt untouched, and no operating point is re-solved.
 * The matrix is re-loaded from the device list on every Newton iteration, so
 * the new conductance is stamped from the next timestep onward — for a contact
 * that is a jump from 1e12 Ω to 1 mΩ, twelve orders of magnitude of
 * conductance appearing in one entry of the matrix. The solver meets that the
 * same way it meets a PWL edge: the first step after the change fails its
 * local-truncation-error test, is rejected, and `h` shrinks until it converges.
 * So the waveform gets a genuine corner — which is what a real switch closing
 * does — and not a discontinuity in any state variable. Nothing is lost from
 * the time axis: circuit time simply does not advance during the 10-13 ms the
 * halt takes, so the only casualty is the wall-clock pacing, which is exactly
 * what `RateReport` in `liveRun.ts` is there to report.
 *
 * **Where the edge lands is not exact.** No breakpoint is set for an actuation
 * (`ngSpice_SetBkpt` is spent on the run's stop horizon), so the change takes
 * effect at whatever timestep the integrator had reached — the edge is
 * accurate to one timestep, not to the instant of the click. That is a
 * property worth knowing and not worth hiding; it is why nothing here claims
 * an actuation happened "at" a particular circuit time.
 *
 * A caveat inherited from the spike, recorded here so nobody "fixes" it away:
 * on the ngspice C source's own reading a RESISTOR alter should not take
 * effect at all — `if_setparam` skips the `CKTtemp` that recomputes
 * `RESconduct`, and `RESload` stamps the cached conductance. It demonstrably
 * does take effect, because `bg_resume` refreshes it, and the Rust real-engine
 * test asserts the exact settled voltage rather than "something moved" so that
 * a future ngspice losing that refresh is a red test. Every alter this module
 * emits is a resistor alter, which means this module is downstream of that
 * proof. Do not paper over it: never pair a resistance alter with a
 * temperature nudge to force `CKTtemp`, and never fall back to restarting the
 * run when a value looks unchanged. Either would turn a regression into a
 * feature that quietly still works.
 *
 * ## Names come from the deck, never from a string built here
 *
 * An `alter` against an instance the deck does not contain fails SILENTLY:
 * ngspice accepts the command, the run carries on, the value never changes,
 * and nothing reports an error. `LiveInstanceName` exists to make that
 * unreachable — the only way to obtain one is
 * {@link resolveLiveInstance}, which reads the deck the run was started from.
 * The candidate spellings below are lookup keys, not names: a key that misses
 * produces a named refusal, never a command.
 *
 * ## Vocabulary
 *
 * Failures are `LiveFailure` / `LiveResult` from `engine/nativeLive.ts`;
 * "contact" and "wiper" are `LiveControlForm` from
 * `schematic/liveControls.ts`; what a click does to a part's value is
 * `schematic/actuation.ts`'s job and this module takes its answer as input.
 * Nothing here is a second word for any of those.
 *
 * Pure apart from {@link applyLiveActuation} and {@link LiveActuationQueue},
 * which are handed the engine call rather than reaching for it. No React, no
 * store, no timers.
 */

import {
  resolveLiveInstance,
  type LiveAlterOptions,
  type LiveFailure,
  type LiveInstanceName,
  type LiveResult,
  type LiveTelemetry,
} from "../engine/nativeLive";
import { parsePotentiometerSpec, potentiometerLegs } from "../engine/potentiometerSpec";
import { NON_ACTUABLE, isActuable, isDraggableWiper } from "../schematic/actuation";
import { isSpdtThrowToNo, isStaticContactClosed } from "../schematic/kindGroups";
import type { LiveControlForm } from "../schematic/liveControls";
import type { SchematicComponent } from "../schematic/types";
import { formatEngineering, parseQuantity } from "./quantity";

/** Just enough of a component to plan an actuation: what it is, what the deck
 *  called it, and what its value is about to become. */
export type ActuableComponent = Pick<SchematicComponent, "id" | "kind" | "label" | "value">;

/** The deck the live run was started from — the only authority on instance
 *  names. `buildSpiceDeck(...)` satisfies this. */
export interface ActuationDeck {
  netlist: string;
}

// ---------------------------------------------------------------------------
// The two resistances a Tau contact is emitted as
// ---------------------------------------------------------------------------

/**
 * What `spiceNetlist.ts` writes for a closed contact, and what an alter must
 * therefore write to close one.
 *
 * These are string literals rather than numbers because the deck's own text is
 * the contract: a live run altered to `1m` and a restarted run emitted as `1m`
 * have to be the same circuit, down to the token. `liveActuation.test.ts`
 * builds a real deck and asserts these against the line the emitter produced,
 * so a change in `spiceNetlist.ts` shows up as a failing test naming the value
 * rather than as a switch that quietly stops closing.
 */
export const CONTACT_CLOSED_OHMS = "1m";
export const CONTACT_OPEN_OHMS = "1e12";

// ---------------------------------------------------------------------------
// A plan: the exact alters, in the exact order
// ---------------------------------------------------------------------------

/**
 * What one alter in a sequence is for.
 *
 * `break`/`make` are the mechanical words on purpose: an SPDT is emitted as two
 * resistors, and the order Tau sends them in is the order the real part moves
 * in. See {@link planLiveActuation} for why that is not a stylistic choice.
 */
export type LiveAlterStepRole = "contact" | "break" | "make" | "track";

export interface LiveAlterStep {
  /** Branded, so it can only have come out of the deck. */
  instance: LiveInstanceName;
  /** SPICE notation, byte-identical to what the emitter would have written. */
  value: string;
  role: LiveAlterStepRole;
  /** What this step moves, in the engineer's words: "S1 NO throw". */
  subject: string;
}

export interface LiveActuationPlan {
  /** The component id, and the key a burst coalesces on. */
  controlId: string;
  /** Reference designator, for anything the UI says about this change. */
  name: string;
  form: LiveControlForm;
  /** The component value the schematic will hold once every step has landed. */
  nextValue: string;
  /** In order. Order is load-bearing — see {@link planLiveActuation}. */
  steps: readonly LiveAlterStep[];
  /**
   * `null` when one alter does the whole change, so the engine's halt →
   * alter → resume is atomic with respect to the circuit and there is nothing
   * to disclose.
   *
   * Otherwise the sentence naming the circuit the solver genuinely integrates
   * BETWEEN the steps. Tau's engine bridge alters one instance per command, so
   * a part the emitter spells as two resistors cannot be changed atomically:
   * the run resumes after the first alter and solves an intermediate circuit
   * for a few milliseconds of wall clock before the second one halts it again.
   * That interval is real, it is in the data, and per AGENTS.md it is labelled
   * rather than hidden.
   */
  intermediate: string | null;
}

// ---------------------------------------------------------------------------
// Refusals — named, never silent
// ---------------------------------------------------------------------------

/**
 * Why a part the UI offers as a control cannot be altered on THIS running deck.
 *
 * The distinction the UI needs is `needsRestart`: "this one needs a Run to take
 * effect" is a completely different instruction from "this one is never yours
 * to operate", and a single "couldn't do that" would collapse them.
 */
export type LiveActuationRefusal =
  /** Not a hand control at all — a relay is thrown by its coil, a motor by its
   *  drive. Restarting changes nothing. */
  | "not-operable"
  /** The deck this run started from has no instance for this part: the sheet
   *  was edited after Run, or the part carries no reference designator for the
   *  emitter to name it with. A restart rebuilds the deck and picks it up. */
  | "not-in-deck"
  /** The deck emits a CONTROLLED device here (ngspice `S`/`W`), whose state
   *  comes from its control pins and not from a value. Setting the part's
   *  state by hand emits a different device entirely, and `alter` cannot swap
   *  one device for another — only a rebuild can. */
  | "controlled-device"
  /** The new value cannot be read as a number, so there is nothing honest to
   *  send. A `{param}` track resistance lands here: braces are baked at deck
   *  build time and this module will not re-guess the expression. */
  | "unreadable-value";

/** Every reason, so exhaustiveness is a test rather than a hope. */
export const LIVE_ACTUATION_REFUSALS: readonly LiveActuationRefusal[] = [
  "not-operable",
  "not-in-deck",
  "controlled-device",
  "unreadable-value",
];

/** True when running the circuit again would make this control work. */
export function refusalNeedsRestart(reason: LiveActuationRefusal): boolean {
  return reason === "not-in-deck" || reason === "controlled-device";
}

/**
 * What planning an actuation produced.
 *
 * `unchanged` is a real answer and not a failure: a wiper drag quantised to
 * 1 % emits the same fraction many times over, and sending an alter that sets
 * a resistor to the value it already holds would spend a 10-13 ms halt to
 * change nothing.
 */
export type LiveActuationTarget =
  | { kind: "alter"; plan: LiveActuationPlan }
  | { kind: "unchanged"; controlId: string }
  | {
      kind: "refused";
      controlId: string;
      reason: LiveActuationRefusal;
      needsRestart: boolean;
      /** The same `LiveFailure` vocabulary the engine bridge uses, so a caller
       *  can hand every live problem to `describeLiveFailure` regardless of
       *  whether Tau or ngspice refused it. */
      failure: LiveFailure;
    };

function refuse(
  controlId: string,
  reason: LiveActuationRefusal,
  message: string,
): LiveActuationTarget {
  return {
    kind: "refused",
    controlId,
    reason,
    needsRestart: refusalNeedsRestart(reason),
    // `alter-refused` is the honest kind: no alter was performed, and Tau is
    // the one that would not perform it. Inventing a second failure union for
    // "Tau said no" instead of "ngspice said no" would give the UI two error
    // shapes for one situation.
    failure: { kind: "alter-refused", message },
  };
}

// ---------------------------------------------------------------------------
// Instance-name candidates
// ---------------------------------------------------------------------------

/**
 * `safeName` from `engine/spiceNetlist.ts`, which is not exported.
 *
 * Copied rather than approximated, and copied rather than skipped: the
 * emitter's derived names (`R_<label>`, `R_<label>_no`) are built from the
 * sanitised label, so a part called `SW-1` is `R_SW_m1` in the deck and a
 * planner that did not sanitise would look up a name that is not there and
 * refuse a switch that works perfectly. `liveActuation.test.ts` builds a real
 * deck from a label that needs sanitising and asserts the two agree, so this
 * copy cannot drift silently.
 */
function safeName(value: string): string {
  return value
    .replace(/\+/g, "_p")
    .replace(/-/g, "_m")
    .replace(/[^a-zA-Z0-9_]/g, "_") || "X";
}

/**
 * The deck's name for one of the emitter's derived resistors, or `null`.
 *
 * `suffix` is `""` for a part emitted as a single resistor and `"_no"` /
 * `"_a"` for the multi-device kinds. The returned value is branded, i.e. it
 * came out of the netlist, not out of this function's template literal.
 */
function derivedResistor(
  deck: ActuationDeck,
  label: string,
  suffix: string,
): LiveInstanceName | null {
  return resolveLiveInstance(deck, `R_${safeName(label)}${suffix}`);
}

/**
 * True when the deck emitted a controlled device for this part rather than
 * Tau's static resistor pair.
 *
 * A switch whose value names a `.model … SW(…)` and whose NC+/NC- pair is
 * wired goes out as ngspice's `S` device (or `W` for the current-controlled
 * LTspice form); its state is then a function of its control voltage, and the
 * open/closed word on the schematic is not in the deck at all. The candidates
 * mirror `resolveInstanceNames`: a label that already carries its kind's
 * prefix owns that name, otherwise the prefix is prepended. Every candidate is
 * resolved against the deck, so a candidate that guesses wrong costs a less
 * specific refusal and never a wrong command.
 */
function controlledDevice(deck: ActuationDeck, label: string): LiveInstanceName | null {
  const sanitised = safeName(label);
  for (const candidate of [label, `S${sanitised}`, `W${sanitised}`]) {
    const resolved = resolveLiveInstance(deck, candidate);
    if (resolved !== null) return resolved;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

const NOT_A_CONTROL = "is not a control Tau can operate while the circuit is running.";

/**
 * The exact alters that turn `component` into `nextValue` on the deck this run
 * is solving — or a named reason there are none.
 *
 * `nextValue` is a whole encoded component value, i.e. what
 * `actuatedValue()` / `wiperValue()` in `schematic/actuation.ts` returned. Both
 * the current and the target state are then read with the SAME readers the
 * netlist emitter uses (`isStaticContactClosed`, `isSpdtThrowToNo`,
 * `parsePotentiometerSpec`), which is the only way the live circuit and a
 * restarted deck are guaranteed to agree about what "closed" means.
 *
 * Per-kind, what the emitter really requires:
 *
 * - **switch / push button** — one resistor, `R_<label>`, holding
 *   {@link CONTACT_CLOSED_OHMS} or {@link CONTACT_OPEN_OHMS}. One alter, and
 *   therefore the only kind whose change is atomic.
 * - **SPDT** — two resistors, `R_<label>_no` and `R_<label>_nc`, one of each.
 *   Sent BREAK BEFORE MAKE, which is both what the real part does and the only
 *   safe order: making first would put two 1 mΩ paths between NO and NC
 *   through COM, and if those poles sit on different rails that is a dead
 *   short the engineer never drew — a current spike, very likely a
 *   non-convergence stop. Breaking first leaves COM on two 1e12 Ω resistors,
 *   which is a floating node but not a singular matrix.
 * - **potentiometer** — two resistors, `R_<label>_a` and `R_<label>_b`, whose
 *   values come from `potentiometerLegs`, the same split the emitter uses.
 *   Sent GROW BEFORE SHRINK, which is the whole of what the order buys: the
 *   intermediate track total is then above the real track and never below, so
 *   a pot wired as a rheostat across a supply never takes a current surge the
 *   real part could not make. (The tap itself stays between where it was and
 *   where it is going either way round — that is arithmetic, not a property of
 *   the ordering, and it is not the reason.)
 *
 * A relay or a motor is refused rather than planned: `NON_ACTUABLE` already
 * says why, in the words the schematic layer chose.
 */
export function planLiveActuation(
  deck: ActuationDeck,
  component: ActuableComponent,
  nextValue: string,
): LiveActuationTarget {
  const id = component.id;
  const name = component.label.trim();
  const wiper = isDraggableWiper(component.kind);

  if (!wiper && !isActuable(component.kind)) {
    const because = NON_ACTUABLE[component.kind];
    return refuse(
      id,
      "not-operable",
      `${name || "This part"} ${because ?? NOT_A_CONTROL}`,
    );
  }

  // Without a designator the emitter names the part after its position in the
  // deck (`R_S3`), which is not recoverable from the component alone. Guessing
  // an index would eventually alter a different switch, so this is a refusal
  // with the fix in it.
  if (name === "") {
    return refuse(
      id,
      "not-in-deck",
      `This ${component.kind} has no reference designator, so Tau cannot tell which device in the running deck is its contact. Give it a name and run again.`,
    );
  }

  return wiper
    ? planWiper(deck, component, name, nextValue)
    : planContact(deck, component, name, nextValue);
}

function planContact(
  deck: ActuationDeck,
  component: ActuableComponent,
  name: string,
  nextValue: string,
): LiveActuationTarget {
  return component.kind === "spdt"
    ? planSpdt(deck, component, name, nextValue)
    : planStaticContact(deck, component, name, nextValue);
}

function planStaticContact(
  deck: ActuationDeck,
  component: ActuableComponent,
  name: string,
  nextValue: string,
): LiveActuationTarget {
  const closed = isStaticContactClosed(nextValue);
  if (closed === isStaticContactClosed(component.value)) {
    return { kind: "unchanged", controlId: component.id };
  }

  const instance = derivedResistor(deck, name, "");
  if (instance === null) return missingContact(deck, component, name, `R_${safeName(name)}`);

  return {
    kind: "alter",
    plan: {
      controlId: component.id,
      name,
      form: "contact",
      nextValue,
      steps: [
        {
          instance,
          value: closed ? CONTACT_CLOSED_OHMS : CONTACT_OPEN_OHMS,
          role: "contact",
          subject: `${name} contact`,
        },
      ],
      // One alter, so the engine's halt/alter/resume is atomic with respect to
      // the circuit: there is no state in between to disclose.
      intermediate: null,
    },
  };
}

function planSpdt(
  deck: ActuationDeck,
  component: ActuableComponent,
  name: string,
  nextValue: string,
): LiveActuationTarget {
  const toNo = isSpdtThrowToNo(nextValue);
  if (toNo === isSpdtThrowToNo(component.value)) {
    return { kind: "unchanged", controlId: component.id };
  }

  const no = derivedResistor(deck, name, "_no");
  const nc = derivedResistor(deck, name, "_nc");
  if (no === null || nc === null) {
    return missingContact(deck, component, name, `R_${safeName(name)}_no`);
  }

  // Break before make. See `planLiveActuation` for why this order is a safety
  // property and not a preference.
  const breaking: LiveAlterStep = toNo
    ? { instance: nc, value: CONTACT_OPEN_OHMS, role: "break", subject: `${name} NC throw` }
    : { instance: no, value: CONTACT_OPEN_OHMS, role: "break", subject: `${name} NO throw` };
  const making: LiveAlterStep = toNo
    ? { instance: no, value: CONTACT_CLOSED_OHMS, role: "make", subject: `${name} NO throw` }
    : { instance: nc, value: CONTACT_CLOSED_OHMS, role: "make", subject: `${name} NC throw` };

  return {
    kind: "alter",
    plan: {
      controlId: component.id,
      name,
      form: "contact",
      nextValue,
      steps: [breaking, making],
      intermediate: `${name} breaks before it makes, like the real part: for a few milliseconds of the run both throws are open and COM is floating.`,
    },
  };
}

function planWiper(
  deck: ActuationDeck,
  component: ActuableComponent,
  name: string,
  nextValue: string,
): LiveActuationTarget {
  // Both halves of the value matter and they are read the same way for the old
  // state and the new one: `10k Wiper=0.8` is a track AND a tap, and comparing
  // the new tap against legs computed from the new track would make a change
  // of track with an unmoved tap look like no change at all — a silent no-op,
  // which is the one outcome this module may not have.
  const legsAfter = trackLegs(nextValue);
  if (legsAfter === null) {
    return refuse(
      component.id,
      "unreadable-value",
      `Tau cannot read ${name}'s track resistance ("${parsePotentiometerSpec(nextValue).resistanceText}") as a number, so it will not guess what to send the running circuit. A {parameter} track is baked into the deck when the run starts and cannot be re-evaluated mid-run.`,
    );
  }
  // A track Tau cannot read is not a reason to refuse the NEW one — it only
  // means there is nothing to compare against, so every leg is sent.
  const legsBefore = trackLegs(component.value);

  const aInstance = derivedResistor(deck, name, "_a");
  const bInstance = derivedResistor(deck, name, "_b");
  if (aInstance === null || bInstance === null) {
    return missingContact(deck, component, name, `R_${safeName(name)}_a`);
  }

  // Compared as the emitted TEXT, not as numbers: the deck holds a string, so
  // "did this leg change" has to mean "would the emitter write something
  // different", or a 1e-15 rounding wobble would spend a 10-13 ms halt.
  const legs: { leg: "a" | "b"; instance: LiveInstanceName; subject: string }[] = [
    { leg: "a", instance: aInstance, subject: `${name} A-to-wiper leg` },
    { leg: "b", instance: bInstance, subject: `${name} wiper-to-B leg` },
  ];
  const candidates = legs
    .map(({ leg, instance, subject }) => ({
      step: { instance, value: String(legsAfter[leg]), role: "track" as const, subject },
      from: legsBefore?.[leg] ?? null,
      to: legsAfter[leg],
    }))
    .filter((entry) => entry.from === null || String(entry.from) !== entry.step.value);
  if (candidates.length === 0) return { kind: "unchanged", controlId: component.id };

  // Grow before shrink. Stable sort, so a pair with nothing to order — or a
  // pair with no old value to order it by — keeps the emitter's own A-then-B
  // reading. When the track resistance itself shrank, both legs shrink and no
  // order can keep the intermediate total above the new track; the sentence
  // below still names the total the run really solves.
  const grows = (entry: { from: number | null; to: number }): number =>
    entry.from !== null && entry.to > entry.from ? 0 : 1;
  const ordered = [...candidates].sort((left, right) => grows(left) - grows(right));

  return {
    kind: "alter",
    plan: {
      controlId: component.id,
      name,
      form: "wiper",
      nextValue,
      steps: ordered.map((entry) => entry.step),
      intermediate:
        ordered.length < 2
          ? null
          : intermediateTrackSentence(
              name,
              ordered[1]!.from === null ? null : ordered[0]!.to + ordered[1]!.from,
              legsAfter.a + legsAfter.b,
            ),
    },
  };
}

/**
 * The two resistors the emitter would write for this whole potentiometer
 * value, or `null` when the track resistance is not a number.
 *
 * Goes through `parsePotentiometerSpec` + `potentiometerLegs` — the same two
 * functions `spiceNetlist.ts` calls — so the split, the floor at the end stops
 * and the 12-digit trim are the emitter's, not a second implementation of
 * them.
 */
function trackLegs(value: string): { a: number; b: number } | null {
  const { resistanceText, wiper } = parsePotentiometerSpec(value);
  let ohms: number;
  try {
    ohms = parseQuantity(resistanceText, "Ohm");
  } catch {
    return null;
  }
  if (!Number.isFinite(ohms) || ohms <= 0) return null;
  return potentiometerLegs(ohms, wiper);
}

/** The disclosure for a two-step wiper move: what the track really reads while
 *  the run is between the two alters. `intermediateOhms` is `null` when the
 *  old track could not be read, in which case the interval is still declared —
 *  the run does solve it — but no number is invented for it. */
function intermediateTrackSentence(
  name: string,
  intermediateOhms: number | null,
  trackOhms: number,
): string {
  const opening = `${name}'s track is two resistors in the deck, so the wiper moves in two steps:`;
  return intermediateOhms === null
    ? `${opening} for a few milliseconds of the run the track is neither the one it was nor the ${formatEngineering(trackOhms, "Ω")} it is becoming.`
    : `${opening} for a few milliseconds of the run the track totals ${formatEngineering(intermediateOhms, "Ω")} instead of ${formatEngineering(trackOhms, "Ω")}, with the tap between where it was and where it is going.`;
}

/**
 * The refusal for a part whose emitted device is not in this deck.
 *
 * Split from the plan bodies because the useful distinction is made here: if
 * the deck instead contains a CONTROLLED device for this part, the reader is
 * not looking at a stale deck, they are looking at a switch whose state is not
 * a value at all, and telling them to wire the coil differently is a different
 * instruction from telling them to run again.
 *
 * Only a `switch` is ever emitted that way, so only a switch is probed for it.
 * A push button, an SPDT and a pot have no controlled form, and asking the
 * deck about a name they could never own risks landing on some unrelated
 * instance that happens to be spelled like the part's designator.
 */
function missingContact(
  deck: ActuationDeck,
  component: ActuableComponent,
  name: string,
  searched: string,
): LiveActuationTarget {
  const controlled = component.kind === "switch" ? controlledDevice(deck, name) : null;
  if (controlled !== null) {
    return refuse(
      component.id,
      "controlled-device",
      `${name} is running as a voltage-controlled switch (${controlled}), so its position comes from its control pins rather than from you. Drive those pins, or set its value to open/closed and run again.`,
    );
  }
  return refuse(
    component.id,
    "not-in-deck",
    `The running circuit has no ${searched} for ${name} — this run started from a different version of the sheet. Run again to operate it.`,
  );
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/** The engine call, injected. `LiveSpiceSession.alter` and `alterLiveSpice`
 *  both match it, which is what keeps this module free of `invoke`. */
export type LiveAlterSender = (options: LiveAlterOptions) => Promise<LiveResult<LiveTelemetry>>;

/**
 * What happened to a whole plan.
 *
 * `partial` is the variant that earns its keep. A two-step change whose second
 * alter is refused leaves the running circuit in the intermediate state — an
 * SPDT with both throws open, a pot with a wrong track total — and the sheet
 * showing the state the user asked for. The UI has to be able to say that;
 * a bare failure would let it show an error beside a schematic that is lying.
 *
 * Every failure here IS a `LiveFailure`. These variants say what landed, not
 * what went wrong.
 */
export type LiveActuationOutcome =
  | { kind: "applied"; plan: LiveActuationPlan; applied: readonly LiveAlterStep[]; telemetry: LiveTelemetry }
  | {
      kind: "partial";
      plan: LiveActuationPlan;
      applied: readonly LiveAlterStep[];
      pending: readonly LiveAlterStep[];
      failure: LiveFailure;
    }
  | { kind: "failed"; plan: LiveActuationPlan; failure: LiveFailure }
  /** The run stopped part-way through the sequence — a divergence provoked by
   *  the change itself is the obvious case. Not a failure: the engine did
   *  exactly what it was asked, and then the run ended. */
  | {
      kind: "ended";
      plan: LiveActuationPlan;
      applied: readonly LiveAlterStep[];
      pending: readonly LiveAlterStep[];
      telemetry: LiveTelemetry;
    };

/** A plan with no steps cannot be produced by {@link planLiveActuation}, which
 *  answers `unchanged` instead. Stated as a refusal rather than asserted away
 *  so a hand-built empty plan reports honestly instead of claiming an engine
 *  round trip that never happened. */
const EMPTY_PLAN_MESSAGE = "There was nothing to change on the running circuit.";

/**
 * Send a plan, in order, stopping at the first step the engine will not take.
 *
 * Each `send` is one `bg_halt` → `alter` → `bg_resume` inside the engine host.
 * That is why a plan is a short ordered list and not a set: every extra step
 * costs the run another halt, and the 10-13 ms a halt takes is structural.
 */
export async function applyLiveActuation(
  plan: LiveActuationPlan,
  send: LiveAlterSender,
): Promise<LiveActuationOutcome> {
  const applied: LiveAlterStep[] = [];
  let telemetry: LiveTelemetry | null = null;

  for (let index = 0; index < plan.steps.length; index += 1) {
    const step = plan.steps[index]!;
    const result = await send({ instance: step.instance, value: step.value });
    if (!result.ok) {
      return applied.length === 0
        ? { kind: "failed", plan, failure: result.failure }
        : { kind: "partial", plan, applied, pending: plan.steps.slice(index), failure: result.failure };
    }
    applied.push(step);
    telemetry = result.value;
    // A run that stopped will refuse every remaining alter with the same
    // sentence, so stop asking and report the stop once.
    const stopped = !telemetry.running || telemetry.stopReason !== null;
    const pending = plan.steps.slice(index + 1);
    if (stopped && pending.length > 0) {
      return { kind: "ended", plan, applied, pending, telemetry };
    }
  }

  if (telemetry === null) {
    return { kind: "failed", plan, failure: { kind: "alter-refused", message: EMPTY_PLAN_MESSAGE } };
  }
  return { kind: "applied", plan, applied, telemetry };
}

/**
 * The sentence this outcome needs that no existing vocabulary already covers,
 * or `null` when one does.
 *
 * A clean apply needs no sentence — the waveform is the feedback. A whole-plan
 * failure needs `describeLiveFailure(outcome.failure)`, which speaks the
 * engine's own words about the circuit-specific cause and which this must not
 * paraphrase. What is left is the two states only a multi-step plan can reach,
 * and those are the ones nothing else can say.
 */
export function describeLiveActuationOutcome(outcome: LiveActuationOutcome): string | null {
  switch (outcome.kind) {
    case "applied":
      return null;
    case "failed":
      return null;
    case "partial": {
      const landed = outcome.applied.map((step) => step.subject).join(", ");
      return `Only part of that change reached the running circuit: ${landed} moved, ${outcome.pending
        .map((step) => step.subject)
        .join(", ")} did not. The circuit being solved is not the one on the sheet — run again to resynchronise.`;
    }
    case "ended": {
      return `The run stopped after ${outcome.applied
        .map((step) => step.subject)
        .join(", ")} changed, so the rest of that change never reached the circuit.`;
    }
  }
}

// ---------------------------------------------------------------------------
// Coalescing a burst
// ---------------------------------------------------------------------------

/** Failures that mean there is no longer a run to talk to, so everything still
 *  queued would only produce the same message again. */
function runIsGone(failure: LiveFailure): boolean {
  return failure.kind === "not-running" || failure.kind === "worker-died" || failure.kind === "not-available";
}

/** One control's newest requested position, kept as the request the user made
 *  rather than as a plan, because what that request means depends on where the
 *  engine is when it finally goes out. */
interface PendingActuation {
  component: ActuableComponent;
  nextValue: string;
}

export interface LiveActuationQueueOptions {
  /** The deck this run was started from. Fixed for the life of the queue,
   *  because a plan is only meaningful against the deck it was resolved from. */
  deck: ActuationDeck;
  send: LiveAlterSender;
  onOutcome?: (outcome: LiveActuationOutcome) => void;
}

/**
 * One halt/alter/resume per user-visible change, however fast the user moves.
 *
 * A wiper drag emits a value per pointer move — dozens per second, all of them
 * superseded within milliseconds. Sending each one would spend a 10-13 ms halt
 * per pixel and stall the very run the user is watching, so the queue collapses
 * a burst twice over:
 *
 * - **Within a tick.** A push does not send; it records the control's newest
 *   plan and schedules the pump on a microtask. Every push in the same task
 *   therefore lands before anything goes out, and a synchronous burst of forty
 *   wiper values costs exactly one cycle — the last one.
 * - **Across ticks.** While a cycle is in flight, further pushes keep replacing
 *   the pending plan for that control. A drag spanning many event loop turns
 *   costs one cycle in flight plus one final cycle, not one per event.
 *
 * Keyed by control id, so operating a switch while dragging a pot does not
 * discard either: they are separate entries and both are sent, in the order
 * they were first touched.
 *
 * The irreducible floor is one alter per DEVICE the emitter produced — two for
 * a pot, two for an SPDT. That is a property of the netlist, not of this
 * queue, and {@link LiveActuationPlan.intermediate} is where it is disclosed.
 *
 * ## Why the queue has to remember what the engine holds
 *
 * Coalescing is what makes a plan RELATIVE rather than absolute, and that is
 * the whole difficulty. {@link planLiveActuation} reads the component's current
 * value to decide which legs actually moved, in which order to move them
 * (grow before shrink, so the track is never momentarily smaller than the real
 * one), and what the intermediate total really is. Its caller — `App`'s live
 * actuation diff — supplies the previous SHEET value, which after a coalesced
 * burst is a position the engine never reached: a drag that overshoots to 0.9
 * and settles back to 0.6 arrives here as "0.9 → 0.6" while the running deck
 * still holds 0.5. Planned against 0.9 that is a shrink-then-grow and the
 * running track dips to 9 kΩ under a 10 kΩ pot — exactly the surge the ordering
 * exists to prevent — and the disclosure sentence names a total the run never
 * solves.
 *
 * So the queue keeps its own record of the value the engine's copy of each
 * control holds, and every plan is computed against THAT: seeded from the
 * caller's before-value on first touch (the sheet and the deck were in step at
 * Run), advanced when a change is dispatched, put back when the engine refused
 * it outright, and forgotten when a half-applied change leaves the engine in a
 * state no single component value names. A plan is also re-derived at dispatch
 * rather than trusted from `push`, because between the two the engine may have
 * moved: a position the running circuit already holds then costs no halt at
 * all, instead of a round trip that changes nothing.
 */
export class LiveActuationQueue {
  private readonly options: LiveActuationQueueOptions;
  /**
   * Insertion-ordered by control, holding the REQUEST rather than a plan.
   * Re-setting an existing key keeps its original position, so a control does
   * not jump the queue by being dragged, and storing the request is what lets
   * the plan be derived against the engine's state at the moment it goes out.
   */
  private readonly pending = new Map<string, PendingActuation>();
  /**
   * What the engine's copy of each control currently holds, in the component
   * value vocabulary `planLiveActuation` reads. Absent means "not known", which
   * is either "never touched on this run" or "a partial change left it
   * somewhere no value names"; both fall back to the caller's before-value,
   * which is the only other evidence there is.
   */
  private readonly engineValues = new Map<string, string>();
  private pumping = false;
  private waiters: (() => void)[] = [];
  private cycles = 0;

  constructor(options: LiveActuationQueueOptions) {
    this.options = options;
  }

  /**
   * Queue this control's newest position, replacing any position of its own
   * that has not gone out yet.
   *
   * Returns the planned target synchronously so a refusal is on screen at the
   * instant of the click, rather than one round trip later. The plan in that
   * answer is what would go out right now; the one actually sent is re-derived
   * at dispatch, and can only differ by the engine having moved in between.
   */
  push(component: ActuableComponent, nextValue: string): LiveActuationTarget {
    const target = planLiveActuation(this.options.deck, this.asEngineHoldsIt(component), nextValue);
    if (target.kind !== "alter") {
      // A position the ENGINE already holds is not a change, whatever route the
      // sheet took to get back to it. Anything still queued for this control is
      // a superseded position that would now drive the running circuit AWAY
      // from where the user left it, so it goes too.
      if (target.kind === "unchanged") this.pending.delete(target.controlId);
      return target;
    }
    this.pending.set(target.plan.controlId, { component, nextValue });
    this.schedule();
    return target;
  }

  /**
   * The same control, carrying the value the running deck holds for it.
   *
   * First touch seeds the record from the caller's own before-value: the deck
   * was built from the sheet at Run, so at that moment they agree, and there is
   * no other evidence available. Everything after that comes from what this
   * queue actually dispatched.
   */
  private asEngineHoldsIt(component: ActuableComponent): ActuableComponent {
    const known = this.engineValues.get(component.id);
    if (known === undefined) {
      this.engineValues.set(component.id, component.value);
      return component;
    }
    return { ...component, value: known };
  }

  /** Alter commands actually spent — one `bg_halt`/`alter`/`bg_resume` each.
   *  Exposed because "did coalescing work" is otherwise unobservable. */
  get haltResumeCycles(): number {
    return this.cycles;
  }

  get isIdle(): boolean {
    return !this.pumping && this.pending.size === 0;
  }

  /** Positions queued and not yet sent. */
  get queuedControls(): number {
    return this.pending.size;
  }

  /** Drop everything still queued — the caller stopped the run, or left. What
   *  the engine is known to hold survives: dropping a position that was never
   *  sent does not move the running circuit back. */
  cancelPending(): void {
    this.pending.clear();
  }

  /** Resolves once nothing is queued and nothing is in flight. */
  settled(): Promise<void> {
    if (this.isIdle) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private schedule(): void {
    if (this.pumping) return;
    this.pumping = true;
    // A microtask and not a timer: it is the shortest delay that still lets
    // every push in the current task coalesce, and it costs the run nothing.
    queueMicrotask(() => {
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    try {
      for (;;) {
        const next = this.pending.entries().next();
        if (next.done === true) break;
        const [id, request] = next.value;
        this.pending.delete(id);
        const held = this.asEngineHoldsIt(request.component);
        const target = planLiveActuation(this.options.deck, held, request.nextValue);
        // Only `unchanged` can appear here: a refusal depends on the kind, the
        // designator, the deck and the NEW value, none of which have moved
        // since `push` answered `alter`. `unchanged` means the engine reached
        // this position by another route, and the honest response to that is to
        // spend nothing.
        if (target.kind !== "alter") continue;
        const plan = target.plan;
        // Recorded before the first alter goes out, so a position pushed while
        // this cycle is in flight is planned against where this one leaves the
        // engine rather than against where it started.
        this.engineValues.set(id, plan.nextValue);
        // Counted around the sender rather than off the outcome, so the number
        // is what the engine was actually asked to do — a refused alter still
        // cost the run a halt and a resume, and must still show up here.
        const outcome = await applyLiveActuation(plan, (options) => {
          this.cycles += 1;
          return this.options.send(options);
        });
        this.reconcile(id, outcome, held.value);
        this.options.onOutcome?.(outcome);
        if (this.shouldAbandon(outcome)) {
          this.pending.clear();
          break;
        }
      }
    } finally {
      this.pumping = false;
      const waiters = this.waiters;
      this.waiters = [];
      for (const waiter of waiters) waiter();
    }
  }

  /**
   * Correct the optimistic record against what the engine really took.
   *
   * `failed` is the only outcome that applied nothing — `applyLiveActuation`
   * reports a first-step refusal that way and everything later as `partial` —
   * so it is the only one that can be put back exactly. A half-applied change
   * leaves the running circuit at a track total or a throw pair that no single
   * component value spells, so the record is dropped rather than guessed at:
   * the next push then falls back to the sheet, and
   * {@link describeLiveActuationOutcome} has already told the user that the
   * circuit and the sheet disagree and that a re-run is what resynchronises
   * them.
   */
  private reconcile(id: string, outcome: LiveActuationOutcome, heldBefore: string): void {
    switch (outcome.kind) {
      case "applied":
        return;
      case "failed":
        this.engineValues.set(id, heldBefore);
        return;
      case "partial":
      case "ended":
        this.engineValues.delete(id);
        return;
    }
  }

  private shouldAbandon(outcome: LiveActuationOutcome): boolean {
    if (outcome.kind === "ended") return true;
    if (outcome.kind === "failed" || outcome.kind === "partial") return runIsGone(outcome.failure);
    return false;
  }
}
