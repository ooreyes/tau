import { describe, expect, it } from "vitest";

import {
  CONTACT_CLOSED_OHMS,
  CONTACT_OPEN_OHMS,
  LIVE_ACTUATION_REFUSALS,
  LiveActuationQueue,
  applyLiveActuation,
  describeLiveActuationOutcome,
  planLiveActuation,
  refusalNeedsRestart,
  type ActuableComponent,
  type LiveActuationPlan,
  type LiveAlterSender,
} from "./liveActuation";
import { actuatedValue, wiperValue } from "../schematic/actuation";
import { buildSpiceDeck } from "../engine/spiceNetlist";
import { describeLiveFailure, type LiveFailure, type LiveTelemetry } from "../engine/nativeLive";
import type { SchematicComponent } from "../schematic/types";

// ── fixtures ────────────────────────────────────────────────────────────────

/**
 * Pin positions are absolute world coordinates, so two parts sharing a
 * coordinate share a net and the fixture needs no wires. Every control below
 * hangs off the same 5 V rail and returns to ground through its own load,
 * which is the smallest circuit in which all four operable kinds are emitted
 * at once.
 */
const part = (
  kind: SchematicComponent["kind"],
  label: string,
  value: string,
  pins: { id: string; x: number; y: number }[],
): SchematicComponent => ({
  id: (label || kind).toLowerCase(),
  kind,
  label,
  value,
  x: 0,
  y: 0,
  rotation: 0,
  pinOverride: pins.map((pin) => ({ id: pin.id, label: pin.id.toUpperCase(), x: pin.x, y: pin.y })),
});

const RAIL = { x: 0, y: 0 };
const GND = { x: 0, y: 100 };

interface ControlStates {
  switchState?: string;
  buttonState?: string;
  spdtThrow?: string;
  pot?: string;
}

const controlsSchematic = (states: ControlStates = {}) => ({
  components: [
    part("vsource", "V1", "5", [{ id: "p", ...RAIL }, { id: "n", ...GND }]),
    part("ground", "", "", [{ id: "g", ...GND }]),
    part("switch", "S1", states.switchState ?? "open", [
      { id: "a", ...RAIL },
      { id: "b", x: 100, y: 0 },
    ]),
    part("resistor", "R1", "1k", [{ id: "a", x: 100, y: 0 }, { id: "b", ...GND }]),
    // A label that has to be sanitised before it can be a SPICE token. The
    // emitter writes `R_SW_m1`; a planner that skipped `safeName` would look up
    // `R_SW-1`, find nothing, and refuse a button that works perfectly.
    part("pushButton", "SW-1", states.buttonState ?? "open", [
      { id: "a", ...RAIL },
      { id: "b", x: 200, y: 0 },
    ]),
    part("resistor", "R2", "1k", [{ id: "a", x: 200, y: 0 }, { id: "b", ...GND }]),
    part("spdt", "S3", states.spdtThrow ?? "no", [
      { id: "com", ...RAIL },
      { id: "no", x: 300, y: 0 },
      { id: "nc", x: 310, y: 0 },
    ]),
    part("resistor", "Rno", "1k", [{ id: "a", x: 300, y: 0 }, { id: "b", ...GND }]),
    part("resistor", "Rnc", "1k", [{ id: "a", x: 310, y: 0 }, { id: "b", ...GND }]),
    part("potentiometer", "RV1", states.pot ?? "10k Wiper=0.5", [
      { id: "a", ...RAIL },
      { id: "b", ...GND },
      { id: "w", x: 400, y: 0 },
    ]),
    part("resistor", "Rw", "1k", [{ id: "a", x: 400, y: 0 }, { id: "b", ...GND }]),
  ],
  wires: [],
});

const deckOf = (states: ControlStates = {}) =>
  buildSpiceDeck(controlsSchematic(states), { kind: "tran", stopTime: 0.002, steps: 200 });

const DECK = deckOf();

/** The value the emitter put on one of its own device lines, so a test can ask
 *  "is this the same circuit the deck describes" instead of restating a
 *  literal that could drift. */
const emittedValue = (netlist: string, instance: string): string | null => {
  const line = netlist.split("\n").find((candidate) => candidate.split(/\s+/)[0] === instance);
  const tokens = line?.trim().split(/\s+/) ?? [];
  return tokens.length >= 4 ? tokens[3]! : null;
};

const control = (label: string): ActuableComponent => {
  const found = controlsSchematic().components.find((candidate) => candidate.label === label);
  if (!found) throw new Error(`no fixture part labelled ${label}`);
  return found;
};

/** A control carrying a value other than the fixture default, for the "the
 *  sheet has already moved on" cases. */
const at = (label: string, value: string): ActuableComponent => ({ ...control(label), value });

const telemetry = (over: Partial<LiveTelemetry> = {}): LiveTelemetry => ({
  running: true,
  wallSeconds: 0.5,
  solvedSamples: 4096,
  vectorCount: 3,
  scalars: 12_288,
  scalarBudget: 32_000_000,
  pointsPerSecond: 480_000,
  deliveredSamples: 4096,
  decimatedSamples: 0,
  stride: 1,
  stopReason: null,
  stopDetail: null,
  engineLog: [],
  ...over,
});

interface Recorder {
  send: LiveAlterSender;
  sent: { instance: string; value: string }[];
}

/** Records every alter the plan asks for. `answers` supplies the result for
 *  the nth call; anything past the end succeeds. */
const recorder = (answers: ReturnType<LiveAlterSender>[] = []): Recorder => {
  const sent: { instance: string; value: string }[] = [];
  return {
    sent,
    send: (options) => {
      sent.push({ instance: options.instance, value: options.value });
      return answers[sent.length - 1] ?? Promise.resolve({ ok: true, value: telemetry() });
    },
  };
};

const failWith = (failure: LiveFailure) => Promise.resolve({ ok: false as const, failure });

const planOf = (component: ActuableComponent, nextValue: string, deck = DECK): LiveActuationPlan => {
  const target = planLiveActuation(deck, component, nextValue);
  if (target.kind !== "alter") throw new Error(`expected a plan, got ${target.kind}`);
  return target.plan;
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

// ── each kind maps to the instance and value the emitter really produced ────

describe("live actuation — what each operable kind needs from the deck", () => {
  it("closes a switch by altering the one resistor the emitter wrote for it", () => {
    const next = actuatedValue(control("S1"), "press");
    expect(next).toBe("closed");

    const plan = planOf(control("S1"), next!);
    expect(plan.form).toBe("contact");
    expect(plan.steps).toEqual([
      { instance: "R_S1", value: CONTACT_CLOSED_OHMS, role: "contact", subject: "S1 contact" },
    ]);
    // One alter, so the engine's halt/alter/resume is atomic with respect to
    // the circuit and there is no intermediate state to disclose.
    expect(plan.intermediate).toBeNull();
  });

  it("opens a push button through its sanitised deck name, not its label", () => {
    const pressed = at("SW-1", "closed pressed=1");
    const plan = planOf(pressed, "open");
    expect(plan.steps).toEqual([
      { instance: "R_SW_m1", value: CONTACT_OPEN_OHMS, role: "contact", subject: "SW-1 contact" },
    ]);
  });

  it("throws an SPDT break-before-make, because making first would short the poles", () => {
    const next = actuatedValue(control("S3"), "press");
    expect(next).toBe("nc");

    const plan = planOf(control("S3"), next!);
    expect(plan.steps).toEqual([
      { instance: "R_S3_no", value: CONTACT_OPEN_OHMS, role: "break", subject: "S3 NO throw" },
      { instance: "R_S3_nc", value: CONTACT_CLOSED_OHMS, role: "make", subject: "S3 NC throw" },
    ]);
    // The reverse order would put two 1 mΩ paths between NO and NC through
    // COM. On two different rails that is a dead short the engineer never
    // drew, so the order is a safety property and is asserted as one.
    expect(plan.steps[0]!.value).toBe(CONTACT_OPEN_OHMS);
    expect(plan.intermediate).toContain("both throws are open");
  });

  it("moves a wiper by altering both track legs, growing one before shrinking the other", () => {
    const next = wiperValue(control("RV1"), 0.8);
    expect(next).toBe("10k Wiper=0.8");

    const plan = planOf(control("RV1"), next!);
    expect(plan.form).toBe("wiper");
    expect(plan.steps).toEqual([
      { instance: "R_RV1_a", value: "8000", role: "track", subject: "RV1 A-to-wiper leg" },
      { instance: "R_RV1_b", value: "2000", role: "track", subject: "RV1 wiper-to-B leg" },
    ]);
    expect(plan.intermediate).toContain("13 kΩ");
    expect(plan.intermediate).toContain("10 kΩ");
  });

  it("holds the track above its real value between the two alters, never below", () => {
    // This is what grow-before-shrink actually buys, and the only property
    // that distinguishes the two orders: the run genuinely solves the
    // intermediate circuit, and on a pot wired as a rheostat across a supply a
    // momentarily SMALLER track is a current surge the real part cannot make.
    // Shrinking last means the total only ever errs high.
    for (const [from, to] of [[0.5, 0.8], [0.8, 0.5], [0.2, 0.9], [0.9, 0.1]] as const) {
      const plan = planOf(at("RV1", `10k Wiper=${from}`), `10k Wiper=${to}`);
      const legs: Record<string, number> = {
        R_RV1_a: 10_000 * from,
        R_RV1_b: 10_000 * (1 - from),
      };
      const first = plan.steps[0]!;
      legs[first.instance] = Number(first.value);
      const intermediate = legs.R_RV1_a! + legs.R_RV1_b!;
      expect(intermediate).toBeGreaterThan(10_000);

      // And the tap does not overshoot on the way. True of either order — it
      // is arithmetic, not a consequence of the ordering — but the UI claims
      // one continuous experiment, so it is worth having on record.
      const tap = legs.R_RV1_b! / intermediate;
      expect(tap).toBeGreaterThan(Math.min(1 - from, 1 - to));
      expect(tap).toBeLessThan(Math.max(1 - from, 1 - to));
    }
  });
});

// ── the value sent is the value the emitter would have written ──────────────

describe("live actuation — the altered circuit is the circuit a restart would build", () => {
  it("sends exactly the resistance the emitter writes for each contact position", () => {
    // If these ever diverge, a live run and a re-run of the same sheet are two
    // different circuits, which is the quietest possible way to be wrong.
    expect(emittedValue(deckOf({ switchState: "open" }).netlist, "R_S1")).toBe(CONTACT_OPEN_OHMS);
    expect(emittedValue(deckOf({ switchState: "closed" }).netlist, "R_S1")).toBe(CONTACT_CLOSED_OHMS);
    expect(emittedValue(deckOf({ spdtThrow: "nc" }).netlist, "R_S3_nc")).toBe(CONTACT_CLOSED_OHMS);
    expect(emittedValue(deckOf({ spdtThrow: "nc" }).netlist, "R_S3_no")).toBe(CONTACT_OPEN_OHMS);
  });

  it("sends exactly the leg resistances the emitter writes for a wiper position", () => {
    const moved = deckOf({ pot: "10k Wiper=0.8" }).netlist;
    const plan = planOf(control("RV1"), "10k Wiper=0.8");
    expect(plan.steps.map((step) => step.value)).toEqual([
      emittedValue(moved, "R_RV1_a"),
      emittedValue(moved, "R_RV1_b"),
    ]);
  });

  it("resolves every instance it names out of the deck itself", () => {
    for (const [component, next] of [
      [control("S1"), "closed"],
      [control("SW-1"), "closed"],
      [control("S3"), "nc"],
      [control("RV1"), "10k Wiper=0.25"],
    ] as const) {
      for (const step of planOf(component, next).steps) {
        expect(DECK.netlist).toContain(`\n${step.instance} `);
      }
    }
  });
});

// ── refusals are named, and nothing is sent ─────────────────────────────────

describe("live actuation — parts that cannot be altered on this running deck", () => {
  it("refuses a name this deck does not contain rather than sending it", () => {
    // `alter r_s1 = 1m` against an absent instance is ACCEPTED by ngspice: the
    // run carries on, the value never changes, and nothing reports an error.
    // Refusing to produce a step is the only defence.
    const otherDeck = buildSpiceDeck(
      {
        components: [
          part("vsource", "V1", "5", [{ id: "p", ...RAIL }, { id: "n", ...GND }]),
          part("ground", "", "", [{ id: "g", ...GND }]),
          part("resistor", "R1", "1k", [{ id: "a", ...RAIL }, { id: "b", ...GND }]),
        ],
        wires: [],
      },
      { kind: "tran", stopTime: 0.002, steps: 200 },
    );

    const target = planLiveActuation(otherDeck, control("S1"), "closed");
    expect(target).toMatchObject({
      kind: "refused",
      reason: "not-in-deck",
      needsRestart: true,
      failure: { kind: "alter-refused" },
    });
    if (target.kind !== "refused") return;
    expect(target.failure.message).toContain("R_S1");
    expect(describeLiveFailure(target.failure)).toContain("Tau did not change the circuit");
  });

  it("refuses a part that is not a hand control, in the schematic layer's own words", () => {
    const relay = part("relay", "K1", "100", [{ id: "a", ...RAIL }, { id: "b", ...GND }]);
    const target = planLiveActuation(DECK, relay, "closed");
    expect(target).toMatchObject({ kind: "refused", reason: "not-operable", needsRestart: false });
    if (target.kind !== "refused") return;
    expect(target.failure.message).toContain("thrown by its coil");
  });

  it("names a voltage-controlled switch as needing a restart, not as a broken knob", () => {
    // Its state is not a value in the deck at all — it comes from the control
    // pins. Setting it by hand emits a completely different device, and
    // `alter` cannot swap one device for another.
    const controlled = buildSpiceDeck(
      {
        components: [
          part("vsource", "V1", "5", [{ id: "p", ...RAIL }, { id: "n", ...GND }]),
          part("ground", "", "", [{ id: "g", ...GND }]),
          part("switch", "S1", "MYSW", [
            { id: "a", ...RAIL },
            { id: "b", x: 100, y: 0 },
            { id: "cp", ...RAIL },
            { id: "cn", ...GND },
          ]),
          part("resistor", "R1", "1k", [{ id: "a", x: 100, y: 0 }, { id: "b", ...GND }]),
        ],
        wires: [],
        directives: [".model MYSW SW(Ron=1 Roff=1e9 Vt=0.5 Vh=0)"],
      },
      { kind: "tran", stopTime: 0.002, steps: 200 },
    );
    expect(controlled.netlist).toContain("\nS1 ");
    expect(controlled.netlist).not.toContain("\nR_S1 ");

    const target = planLiveActuation(controlled, at("S1", "MYSW"), "closed");
    expect(target).toMatchObject({
      kind: "refused",
      reason: "controlled-device",
      needsRestart: true,
    });
    if (target.kind !== "refused") return;
    expect(target.failure.message).toContain("control pins");
  });

  it("refuses an unnamed part instead of guessing which deck resistor is its contact", () => {
    const unnamed = { ...control("S1"), label: "  " };
    const target = planLiveActuation(DECK, unnamed, "closed");
    expect(target).toMatchObject({ kind: "refused", reason: "not-in-deck", needsRestart: true });
    if (target.kind !== "refused") return;
    expect(target.failure.message).toContain("reference designator");
  });

  it("does not mistake a changed track for no change when the tap has not moved", () => {
    // Comparing the new tap against legs computed from the NEW track would
    // make this look identical to what the engine already holds, and a knob
    // that reports "nothing to do" about a real change is the silent no-op
    // this module exists to make impossible.
    const plan = planOf(at("RV1", "10k Wiper=0.5"), "20k Wiper=0.5");
    expect(plan.steps.map((step) => step.value)).toEqual(["10000", "10000"]);
    expect(plan.intermediate).toContain("20 kΩ");
  });

  it("sends both legs when the old track cannot be read, rather than comparing against a guess", () => {
    const plan = planOf(at("RV1", "{RPOT} Wiper=0.5"), "10k Wiper=0.8");
    expect(plan.steps.map((step) => step.instance)).toEqual(["R_RV1_a", "R_RV1_b"]);
    expect(plan.intermediate).toContain("neither the one it was");
  });

  it("refuses a wiper whose track resistance is not a number it may evaluate", () => {
    // A `{param}` track is baked at deck-build time. Re-deriving it here would
    // be Tau inventing a value for a running circuit.
    const target = planLiveActuation(DECK, at("RV1", "{RPOT} Wiper=0.5"), "{RPOT} Wiper=0.8");
    expect(target).toMatchObject({ kind: "refused", reason: "unreadable-value", needsRestart: false });
  });

  it("answers `unchanged` when the position it is asked for is the one already sent", () => {
    expect(planLiveActuation(DECK, control("S1"), "open")).toEqual({
      kind: "unchanged",
      controlId: "s1",
    });
    expect(planLiveActuation(DECK, control("S3"), "no").kind).toBe("unchanged");
    expect(planLiveActuation(DECK, control("RV1"), "10k Wiper=0.5").kind).toBe("unchanged");
  });

  it("keeps its refusal reasons and their restart advice enumerable", () => {
    expect([...LIVE_ACTUATION_REFUSALS].sort()).toEqual([
      "controlled-device",
      "not-in-deck",
      "not-operable",
      "unreadable-value",
    ]);
    expect(LIVE_ACTUATION_REFUSALS.filter(refusalNeedsRestart)).toEqual([
      "not-in-deck",
      "controlled-device",
    ]);
  });
});

// ── applying: order, and failures as typed values ───────────────────────────

describe("live actuation — applying a plan", () => {
  it("sends the steps in plan order and reports the engine's last telemetry", async () => {
    const engine = recorder();
    const plan = planOf(control("S3"), "nc");
    const outcome = await applyLiveActuation(plan, engine.send);

    expect(engine.sent).toEqual([
      { instance: "R_S3_no", value: CONTACT_OPEN_OHMS },
      { instance: "R_S3_nc", value: CONTACT_CLOSED_OHMS },
    ]);
    expect(outcome.kind).toBe("applied");
    if (outcome.kind !== "applied") return;
    expect(outcome.applied).toHaveLength(2);
    expect(outcome.telemetry.running).toBe(true);
  });

  it("propagates a refused first step as the engine's own typed failure", async () => {
    const failure: LiveFailure = {
      kind: "alter-refused",
      message: '"r_s1" is not a SPICE instance name Tau will alter.',
    };
    const engine = recorder([failWith(failure)]);
    const outcome = await applyLiveActuation(planOf(control("S1"), "closed"), engine.send);

    expect(outcome).toEqual({ kind: "failed", plan: expect.anything(), failure });
    expect(describeLiveActuationOutcome(outcome)).toBeNull();
  });

  it("says so when half a two-step change landed and half did not", async () => {
    // The circuit being solved is now neither the old one nor the one on the
    // sheet. A bare failure would let the UI show an error beside a schematic
    // that is lying about the running circuit.
    const failure: LiveFailure = { kind: "engine-refused", message: "ngspice refused the second alter." };
    const engine = recorder([Promise.resolve({ ok: true, value: telemetry() }), failWith(failure)]);
    const outcome = await applyLiveActuation(planOf(control("S3"), "nc"), engine.send);

    expect(outcome.kind).toBe("partial");
    if (outcome.kind !== "partial") return;
    expect(outcome.applied.map((step) => step.subject)).toEqual(["S3 NO throw"]);
    expect(outcome.pending.map((step) => step.subject)).toEqual(["S3 NC throw"]);
    expect(outcome.failure).toBe(failure);
    expect(describeLiveActuationOutcome(outcome)).toContain("not the one on the sheet");
  });

  it("stops asking once the run itself has ended mid-sequence", async () => {
    // A contact closing can provoke the divergence that ends the run. Every
    // remaining alter would come back with the same "nothing to alter"
    // sentence, so the stop is reported once instead of once per leg.
    const ended = telemetry({ running: false, stopReason: "non-finite", stopDetail: "non-finite sample" });
    const engine = recorder([Promise.resolve({ ok: true, value: ended })]);
    const outcome = await applyLiveActuation(planOf(control("RV1"), "10k Wiper=0.8"), engine.send);

    expect(engine.sent).toHaveLength(1);
    expect(outcome.kind).toBe("ended");
    if (outcome.kind !== "ended") return;
    expect(outcome.pending.map((step) => step.instance)).toEqual(["R_RV1_b"]);
    expect(describeLiveActuationOutcome(outcome)).toContain("The run stopped");
  });
});

// ── coalescing a burst ──────────────────────────────────────────────────────

describe("live actuation — a drag costs one halt/alter/resume, not one per value", () => {
  it("collapses a burst of wiper values in one tick to the last one", async () => {
    // A stop takes 10-13 ms and that latency is structural, so a drag that
    // halted per pointer move would stall the run it is being watched on.
    const engine = recorder();
    const queue = new LiveActuationQueue({ deck: DECK, send: engine.send });

    for (let step = 1; step <= 40; step += 1) {
      queue.push(control("RV1"), `10k Wiper=${(0.5 + step * 0.01).toFixed(2)}`);
    }
    await queue.settled();

    // Two commands, because the emitter spells a pot as two resistors — that
    // floor belongs to the netlist, not to the queue.
    expect(queue.haltResumeCycles).toBe(2);
    expect(engine.sent).toEqual([
      { instance: "R_RV1_a", value: "9000" },
      { instance: "R_RV1_b", value: "1000" },
    ]);
    expect(queue.isIdle).toBe(true);
  });

  it("collapses the values that arrive while a change is already in flight", async () => {
    const gate = deferred<void>();
    const sent: string[] = [];
    const queue = new LiveActuationQueue({
      deck: DECK,
      send: async (options) => {
        sent.push(options.value);
        if (sent.length === 1) await gate.promise;
        return { ok: true, value: telemetry() };
      },
    });

    queue.push(control("RV1"), "10k Wiper=0.6");
    // Let the pump start so the first alter is genuinely outstanding.
    await Promise.resolve();
    queue.push(control("RV1"), "10k Wiper=0.7");
    queue.push(control("RV1"), "10k Wiper=0.9");
    expect(queue.queuedControls).toBe(1);
    gate.resolve();
    await queue.settled();

    // The in-flight change finishes, then the newest position — never the two
    // superseded ones. Steps carry absolute values, so a superseded plan
    // cannot leave the destination wrong.
    expect(sent).toEqual(["6000", "4000", "9000", "1000"]);
    expect(queue.haltResumeCycles).toBe(4);
  });

  it("keeps a second control's change rather than letting the busiest one starve it", async () => {
    const engine = recorder();
    const queue = new LiveActuationQueue({ deck: DECK, send: engine.send });

    queue.push(control("RV1"), "10k Wiper=0.6");
    queue.push(control("S1"), "closed");
    queue.push(control("RV1"), "10k Wiper=0.7");
    await queue.settled();

    expect(engine.sent).toEqual([
      { instance: "R_RV1_a", value: "7000" },
      { instance: "R_RV1_b", value: "3000" },
      { instance: "R_S1", value: CONTACT_CLOSED_OHMS },
    ]);
  });

  it("never sends anything for a control it refused", async () => {
    const engine = recorder();
    const queue = new LiveActuationQueue({ deck: DECK, send: engine.send });
    const relay = part("relay", "K1", "100", [{ id: "a", ...RAIL }, { id: "b", ...GND }]);

    expect(queue.push(relay, "closed").kind).toBe("refused");
    expect(queue.push(control("S1"), "open").kind).toBe("unchanged");
    await queue.settled();

    expect(engine.sent).toEqual([]);
    expect(queue.haltResumeCycles).toBe(0);
  });

  it("abandons what is queued once there is no run left to talk to", async () => {
    const gone: LiveFailure = { kind: "not-running", message: "No live simulation is running." };
    const engine = recorder([failWith(gone)]);
    const outcomes: string[] = [];
    const queue = new LiveActuationQueue({
      deck: DECK,
      send: engine.send,
      onOutcome: (outcome) => outcomes.push(outcome.kind),
    });

    queue.push(control("S1"), "closed");
    queue.push(control("S3"), "nc");
    await queue.settled();

    // One refusal, reported once. Draining the rest would produce the same
    // sentence per queued control and drown the real one.
    expect(engine.sent).toEqual([{ instance: "R_S1", value: CONTACT_CLOSED_OHMS }]);
    expect(outcomes).toEqual(["failed"]);
    expect(queue.isIdle).toBe(true);
  });

  it("carries on after a refusal that is only about one control", async () => {
    const refused: LiveFailure = { kind: "alter-refused", message: "value out of range" };
    const engine = recorder([failWith(refused)]);
    const queue = new LiveActuationQueue({ deck: DECK, send: engine.send });

    queue.push(control("S1"), "closed");
    queue.push(control("SW-1"), "closed");
    await queue.settled();

    expect(engine.sent).toEqual([
      { instance: "R_S1", value: CONTACT_CLOSED_OHMS },
      { instance: "R_SW_m1", value: CONTACT_CLOSED_OHMS },
    ]);
  });

  it("drops queued positions when the caller cancels", async () => {
    const gate = deferred<void>();
    const engine = recorder([gate.promise.then(() => ({ ok: true as const, value: telemetry() }))]);
    const queue = new LiveActuationQueue({ deck: DECK, send: engine.send });

    queue.push(control("S1"), "closed");
    await Promise.resolve();
    queue.push(control("S3"), "nc");
    queue.cancelPending();
    gate.resolve();
    await queue.settled();

    expect(engine.sent).toEqual([{ instance: "R_S1", value: CONTACT_CLOSED_OHMS }]);
  });
});
