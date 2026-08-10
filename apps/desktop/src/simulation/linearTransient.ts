import { isIndependentVoltageBranchKind, isSpdtThrowToNo, isStaticContactClosed, logicConstantVolts, photodiodePhotocurrentAmps } from "../schematic/kindGroups";
import type { ComponentKind, NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";
import { extractCircuit, type ExtractedCircuit, type ExtractedComponent } from "../schematic/netlist";
import { formatEngineering, parseQuantity } from "./quantity";
import { resolveComponentValues, EMPTY_SCOPE, type ParamScope } from "./paramScope";
import { mutualTerms, type CouplingSpec, type MutualTerm } from "./coupling";
import { linearBSourceModel, resolveBehavioralTerms, type BehavioralTerm, type LinearBehavioral } from "./behavioral";
import { stripAcSpec } from "../engine/acSpec";
import { parseIcValue, stripIcSpec } from "../engine/icSpec";
import { parseTransientSource, isFunctionSource, type TransientSource } from "./sourceWaveform";
import { stripTcSpec } from "./temperature";
import { DIODE_KINDS, diodeConductance, diodeCurrent, diodeSpecFor, limitDiodeVoltage } from "./diodeCompanion";
import { primaryBranches, runOperatingPoint } from "./operatingPoint";
import { previewCurrentControlledSwitchMessage } from "../schematic/currentControlledSwitch";
import { previewChargeDefinedCapacitorMessage, previewNegativeCapacitorMessage } from "../schematic/behavioralCapacitor";
import { previewVendorOpampMessage } from "../engine/opampModel";
import type { FourierResult } from "./fourier";
import type { MeasResult } from "./measure";

export interface AnalysisOptions {
  stopTime: number;
  steps: number;
  /** Optional authored `.tran` output start time (seconds). */
  startTime?: number;
  /** Optional authored `.tran` maximum internal solver step (seconds). */
  maxStep?: number;
  /** Skip the DC operating-point solve and start reactive parts from zero
   *  state (SPICE `use initial conditions`). */
  uic?: boolean;
  /** LTspice `startup`: skip the operating point and ramp independent sources
   *  from zero over the first 20 µs. Distinct from bare `uic`, which starts
   *  them at their authored values immediately. */
  startup?: boolean;
}

/** The interim interactive solver needs enough samples to represent a sine
 * source faithfully. Native ngspice will eventually replace this ceiling. */
export const MIN_SAMPLES_PER_CYCLE = 32;
export const MAX_TRANSIENT_STEPS = 200_000;

export interface TransientResolution {
  maxFrequencyHz: number;
  requiredSteps: number;
  samplesPerCycle: number | null;
}

/** Physical unit a plotted trace carries on its axis. Node-voltage and
 *  reference traces are volts; derived expression traces can be amps (a probed
 *  branch current), watts (instantaneous power V·I), ohms, or dimensionless. */
export type TraceUnit = "V" | "A" | "W" | "Ω" | "S" | "";

export interface Trace {
  id: string;
  label: string;
  unit: TraceUnit;
  color: string;
  values: number[];
}

/** A branch-current waveform, e.g. `I(V1)` or `I(R1)`, in SPICE sign convention.
 *  Voltage-source and inductor currents come straight from the MNA solution
 *  vector; resistor/capacitor/current-source currents are derived from node
 *  voltages. Keyed by the component's ref-des so `.meas`/plot can resolve `I(ref)`. */
export interface CurrentTrace {
  ref: string;
  label: string;
  values: number[];
  /** The device terminal this current enters, for a part that reports more than
   *  one: a BJT contributes `b` and `e` alongside the collector current. Absent
   *  on the single trace a bare `I(ref)` resolves to, so several traces can
   *  share one ref-des - resolve through `findCurrentTrace`, never by scanning
   *  `ref` alone. */
  terminal?: string;
}

export interface AnalysisStats {
  netCount: number;
  componentCount: number;
  sampleCount: number;
  stopTime: number;
  stepSize: number;
}

export type AnalysisResult =
  | {
      ok: true;
      title: string;
      times: number[];
      traces: Trace[];
      currents: CurrentTrace[];
      stats: AnalysisStats;
      warnings: string[];
      circuit: ExtractedCircuit;
      /**
       * `.meas` rows parsed from ngspice's message log when the native deck
       * carried those cards (P1.6). Absent/empty means the UI should keep using
       * the TypeScript measurement runner against the returned waveform.
       */
      nativeMeasurements?: MeasResult[];
      /**
       * `.four` tables parsed from ngspice's message log (P1.6). Absent/empty
       * keeps the TypeScript Fourier path as the displayed source.
       */
      nativeFourier?: FourierResult[];
    }
  | {
      ok: false;
      title: string;
      message: string;
      /** Bounded raw engine output, displayed only in a collapsed disclosure. */
      details?: string;
      warnings: string[];
      circuit?: ExtractedCircuit;
    };

const TRACE_COLORS = [
  "var(--trace-green)",
  "var(--trace-red)",
  "var(--trace-cyan)",
  "var(--trace-cream)",
  "var(--trace-purple)",
  "var(--trace-amber)",
];

const TRANSIENT_SUPPORTED = new Set<ComponentKind>([
  "resistor",
  "bulb",
  "capacitor",
  "polarizedCapacitor",
  "inductor",
  "vsource",
  "isource",
  "vac",
  "iac",
  "logicConstant",
  "opamp",
  "vcvs",
  "vccs",
  "cccs",
  "ccvs",
  "bsource",
  "switch",
  "pushButton",
  "spdt",
  "ground",
  "diode",
  "led",
  "zener",
  "photodiode",
]);

/** Newton iteration budget per timestep when junction diodes are present.
 *  Matches SPICE's itl4-style ceiling; convergence normally takes < 10. */
const NEWTON_MAX_ITERATIONS = 100;

/** Tiny conductance added from every non-ground node to ground (SPICE gmin trick).
 *  Prevents singular matrices caused by floating nodes (e.g. unconnected op-amp rails). */
const GMIN = 1e-12;

/** Progress/cancellation hooks for a transient run (Fix 3 - no more frozen
 *  UI on a long solve). Both optional so every existing caller (production
 *  or test) that doesn't care about either keeps working unchanged, just
 *  now behind a `Promise` (the solve loop yields to the event loop
 *  periodically, so the function can no longer return synchronously). */
export interface TransientRunControl {
  /** Called with a fraction in [0, 1], monotonically non-decreasing, at each
   *  cooperative-yield checkpoint (see the loop below) - cheap and safe to
   *  call often; throttle on the receiving end (App.tsx) if needed. */
  onProgress?: (fraction: number) => void;
  /** Checked at each yield checkpoint. When aborted, the loop stops and the
   *  function resolves (never rejects) with a PARTIAL `ok: true` result built
   *  from whatever samples were already computed, plus a warning - abort is
   *  a normal user action (Stop button), not an error. */
  signal?: AbortSignal;
}

/** One macrotask yield so the browser can paint (progress bar) and deliver
 *  input (Stop button click) mid-solve. A microtask (`Promise.resolve().then`)
 *  would resume before the next paint and defeat the point. MessageChannel is
 *  preferred over `setTimeout(0)` because timers are clamped (4 ms after
 *  nesting, up to ~1 s in occluded/background documents) - a 300-step run with
 *  per-step yields crawled for minutes in a backgrounded window while the
 *  actual math took 21 ms. MessageChannel posts are never throttled (it's how
 *  React's scheduler yields); setTimeout remains as the fallback. */
function yieldToEventLoop(): Promise<void> {
  if (typeof MessageChannel !== "undefined") {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** How often the solve loop checks in with `onProgress`/`signal`: every 250
 *  steps, or every ~16ms of wall time if a single step is expensive enough
 *  that 250 of them would otherwise stall the UI thread noticeably longer
 *  than one frame. */
const YIELD_STEP_INTERVAL = 250;
const YIELD_TIME_INTERVAL_MS = 16;
/** The wall-clock half of the yield check only exists to catch a step that
 *  is itself slow enough to blow past YIELD_TIME_INTERVAL_MS before the next
 *  step-count boundary - it doesn't need to be re-sampled every single step
 *  to do that. Checking every 8 steps still notices a slow run well inside a
 *  frame, without a Date.now() call on (almost) every iteration. */
const YIELD_TIME_CHECK_STRIDE = 8;

export async function runTransientAnalysis(
  schematic: { components: SchematicComponent[]; wires: SchematicWire[]; netLabels?: NetLabel[]; params?: ParamScope; couplings?: CouplingSpec[] },
  options: AnalysisOptions,
  control?: TransientRunControl,
): Promise<AnalysisResult> {
  let circuit: ExtractedCircuit | undefined;
  try {
    const chargeCapacitorMessage = previewChargeDefinedCapacitorMessage(schematic.components);
    if (chargeCapacitorMessage) return fail("Native engine required", chargeCapacitorMessage, circuit);
    // Resolve {param} expressions in component values before extraction so the
    // solver sees concrete numbers (LTspice substitutes braces the same way).
    const components = resolveComponentValues(schematic.components, schematic.params ?? EMPTY_SCOPE);
    // Named vendor op-amps must not silently receive the ideal nullor stamp.
    // OP / AC / noise already refuse; transient had the same gap until this guard.
    const vendorOpampMessage = previewVendorOpampMessage(components);
    if (vendorOpampMessage) return fail("Native engine required", vendorOpampMessage, circuit);
    const negativeCapacitorMessage = previewNegativeCapacitorMessage(components);
    if (negativeCapacitorMessage) return fail("Native engine required", negativeCapacitorMessage, circuit);
    circuit = extractCircuit(components, schematic.wires, schematic.netLabels ?? []);
    validateOptions(options);

    const currentSwitchMessage = previewCurrentControlledSwitchMessage(components);
    if (currentSwitchMessage) return fail("Native engine required", currentSwitchMessage, circuit);

    const resolution = inspectTransientResolution(components, options);
    validateTransientResolution(resolution, options);

    if (components.length === 0) {
      return fail("No circuit", "Place components before running analysis.", circuit);
    }
    const unsupported = components.filter((component) => !TRANSIENT_SUPPORTED.has(component.kind));
    if (unsupported.length > 0) {
      return fail(
        "Unsupported model",
        `${unsupported.map((component) => component.label || component.kind).join(", ")} ${unsupported.length === 1 ? "is" : "are"} placeable and wireable, but this preview solver only supports R/C/L, voltage/current sources, AC sine sources, diodes/LEDs/zeners, switches, and grounds. Full device models need the ngspice engine, which runs in the desktop app.`,
        circuit,
      );
    }
    if (!circuit.groundNetId) {
      return fail("No reference", "Add a ground symbol so node voltages have a reference.", circuit);
    }
    if (!components.some((component) => ["vsource", "isource", "vac", "iac", "bsource", "logicConstant", "photodiode"].includes(component.kind))) {
      return fail("No source", "Add a voltage or current source to excite the circuit. This preview solver requires an explicit independent source.", circuit);
    }

    const nonGroundNets = circuit.nets.filter((net) => !net.isGround);
    if (nonGroundNets.length === 0) {
      return fail("No signal nodes", "Connect at least one non-ground node.", circuit);
    }

    const nodeIndex = new Map(nonGroundNets.map((net, index) => [net.id, index]));
    // Behavioral expressions reference nodes by (sanitized net-label) name.
    const netByName = new Map<string, number>();
    nonGroundNets.forEach((net, index) => netByName.set(net.id.toLowerCase(), index));
    const voltageSources = circuit.components.filter(({ component }) => isIndependentVoltageBranchKind(component.kind));
    const inductors = circuit.components.filter(({ component }) => component.kind === "inductor");
    // Junction diodes (diode/led/zener) are the solver's only nonlinear devices:
    // each timestep re-solves via Newton with a per-device companion model, so
    // collect their specs once and carry the junction voltage as solver state
    // (the previous timestep's solution is the next step's initial guess).
    const diodes = circuit.components.filter(({ component }) => DIODE_KINDS.has(component.kind));
    const diodeSpecs = new Map(diodes.map((entry) => [entry.component.id, diodeSpecFor(entry.component.kind, entry.component.value)]));
    const diodeVoltage = new Map<string, number>();
    const opamps = circuit.components.filter(({ component }) => component.kind === "opamp");
    // A switch's NC+/NC- control pair is optional; left unwired it forms
    // single-pin nets that are all-zero rows in the matrix. Same floating-node
    // case as an unconnected op-amp rail, so it takes the same gmin shunt.
    const hasSwitch = circuit.components.some(({ component }) => component.kind === "switch");
    const vcvss = circuit.components.filter(({ component }) => component.kind === "vcvs");
    const cccss = circuit.components.filter(({ component }) => component.kind === "cccs");
    const ccvss = circuit.components.filter(({ component }) => component.kind === "ccvs");
    // Behavioral sources (B): linearize once (constant - we reject time-varying
    // forms), V-type adds a branch unknown, I-type does not.
    const paramScope = schematic.params ?? EMPTY_SCOPE;
    const bModels = new Map<string, LinearBehavioral>();
    for (const e of circuit.components) {
      if (e.component.kind !== "bsource") continue;
      bModels.set(e.component.id, linearBSourceModel(e.component.label, e.component.value, paramScope.scope, paramScope.funcs));
    }
    const vBsources = circuit.components.filter(({ component }) => component.kind === "bsource" && bModels.get(component.id)?.type === "V");
    const voltageSourceOffset = nonGroundNets.length;
    const inductorOffset = voltageSourceOffset + voltageSources.length;
    const opampOffset = inductorOffset + inductors.length;
    const vcvsOffset = opampOffset + opamps.length;
    const cccsOffset = vcvsOffset + vcvss.length;
    const ccvsOffset = cccsOffset + cccss.length;
    const bsourceOffset = ccvsOffset + ccvss.length * 2;
    const size =
      nonGroundNets.length + voltageSources.length + inductors.length + opamps.length +
      vcvss.length + cccss.length + ccvss.length * 2 + vBsources.length;
    if (size === 0) return fail("Empty matrix", "The circuit has no unknowns to solve.", circuit);

    const stepSize = options.stopTime / options.steps;
    const times: number[] = [];
    const traceValues = nonGroundNets.map(() => [] as number[]);
    const capacitorVoltage = new Map<string, number>();
    const inductorCurrent = new Map<string, number>();

    // Per-instance initial conditions (`IC=` on a C/L): seed the companion-model
    // state so the value holds at t=0 (LTspice's `IC=` + `uic` semantics). A bad
    // IC token is ignored rather than failing the whole run.
    for (const entry of circuit.components) {
      const ic = parseIcValue(entry.component.value);
      if (ic === null) continue;
      try {
        if (entry.component.kind === "capacitor" || entry.component.kind === "polarizedCapacitor") {
          capacitorVoltage.set(entry.component.id, parseQuantity(ic, "V"));
        } else if (entry.component.kind === "inductor") {
          inductorCurrent.set(entry.component.id, parseQuantity(ic, "A"));
        }
      } catch {
        /* unparseable IC token - ignore, start from 0 */
      }
    }

    // Without `uic`, SPICE solves the DC operating point first and integrates
    // from that bias - a circuit already at steady state plots flat instead of
    // showing a fictitious startup transient. Seed the companion-model state
    // from the OP solution; an explicit per-instance `IC=` keeps its authored
    // value. When the OP cannot be computed (e.g. a node with no DC path, or
    // an inductor shorting an ideal source at DC), fall back to zero state -
    // exactly the old `uic`-style behavior - and say so in a warning.
    const extraWarnings: string[] = [];
    const needsOpSeed =
      !options.uic && !options.startup &&
      circuit.components.some(
        ({ component }) =>
          ((component.kind === "capacitor" || component.kind === "polarizedCapacitor") && !capacitorVoltage.has(component.id)) ||
          (component.kind === "inductor" && !inductorCurrent.has(component.id)),
      );
    if (needsOpSeed) {
      const op = runOperatingPoint(schematic, { returnBranches: true });
      if (op.ok) {
        const voltageByNet = new Map(op.nets.map((net) => [net.id, net.voltage]));
        // Through `primaryBranches`, not the raw list: a component id can carry
        // several entries, and a Map over all of them would seed an inductor
        // from whichever terminal came last.
        const branchCurrentById = new Map(primaryBranches(op.branches).map((branch) => [branch.id, branch.current]));
        const nodeVoltage = (netId: string | undefined) => (netId !== undefined ? voltageByNet.get(netId) ?? 0 : 0);
        for (const entry of circuit.components) {
          const { id, kind } = entry.component;
          if ((kind === "capacitor" || kind === "polarizedCapacitor") && !capacitorVoltage.has(id)) {
            capacitorVoltage.set(id, nodeVoltage(entry.pins.a) - nodeVoltage(entry.pins.b));
          } else if (kind === "inductor" && !inductorCurrent.has(id)) {
            const current = branchCurrentById.get(id);
            if (current !== undefined) inductorCurrent.set(id, current);
          }
        }
      } else {
        extraWarnings.push(
          `The DC operating point could not be computed (${op.message.replace(/\s+$/, "")}) - capacitors and inductors start from zero state instead, like a run with uic.`,
        );
      }
    }

    // Mutual inductance (K directives): pairwise coupling terms over the
    // inductor branch unknowns, computed once (M is time-invariant).
    const mutuals: MutualTerm[] =
      schematic.couplings && schematic.couplings.length > 0
        ? mutualTerms(
            inductors.map((entry) => ({
              label: entry.component.label,
              inductance: positiveValue(entry, "H"),
            })),
            schematic.couplings,
          )
        : [];
    // Independent-source waveforms parsed once (SINE/PULSE/PWL/EXP/SFFM or DC),
    // keyed by component id, so the time loop evaluates without re-parsing.
    const sourceWaveforms = new Map<string, TransientSource>();
    for (const entry of circuit.components) {
      const { kind } = entry.component;
      if (kind === "vsource" || kind === "isource") {
        sourceWaveforms.set(
          entry.component.id,
          parseTransientSource(entry.component.value, kind === "vsource" ? "V" : "A"),
        );
      }
    }

    // Per-run constants hoisted out of the time loop: branch-unknown indices,
    // parsed magnitudes, and waveform evaluators never change between steps,
    // so re-running findIndex scans and value-string parses every step only
    // made step cost grow with component count for identical numbers.
    const branchIndexOf = <T extends { component: { id: string } }>(entries: readonly T[]) =>
      new Map(entries.map((candidate, index) => [candidate.component.id, index]));
    const voltageSourceIndex = branchIndexOf(voltageSources);
    const inductorIndex = branchIndexOf(inductors);
    const opampIndex = branchIndexOf(opamps);
    const vcvsIndex = branchIndexOf(vcvss);
    const cccsIndex = branchIndexOf(cccss);
    const ccvsIndex = branchIndexOf(ccvss);
    const vBsourceIndex = branchIndexOf(vBsources);

    const conductanceOf = new Map<string, number>();
    const capacitanceOf = new Map<string, number>();
    const inductanceOf = new Map<string, number>();
    const gainOf = new Map<string, number>();
    const dcSourceValue = new Map<string, number>();
    const acWaveAt = new Map<string, (time: number) => number>();
    const closedSwitches = new Set<string>();
    const behavioralTermsOf = new Map<string, BehavioralTerm[]>();
    // The sampling loop historically parsed leniently (try/catch → 0) while
    // stamping parsed strictly; both are precomputed with their original
    // expressions so telemetry and failure behavior stay identical.
    const sampleCapacitance = new Map<string, number>();
    const sampleResistance = new Map<string, number>();
    for (const entry of circuit.components) {
      const { id } = entry.component;
      switch (entry.component.kind) {
        case "resistor":
        case "bulb": {
          conductanceOf.set(id, resistanceToConductance(entry));
          let r = 0;
          try { r = parseQuantity(entry.component.value, "Ω"); } catch { r = 0; }
          sampleResistance.set(id, r);
          break;
        }
        case "polarizedCapacitor":
        case "capacitor": {
          capacitanceOf.set(id, positiveValue(entry, "F"));
          let c = 0;
          try { c = parseQuantity(entry.component.value, "F"); } catch { c = 0; }
          sampleCapacitance.set(id, c);
          break;
        }
        case "inductor":
          inductanceOf.set(id, positiveValue(entry, "H"));
          break;
        case "vsource":
          if (!sourceWaveforms.get(id)) dcSourceValue.set(id, parseQuantity(stripAcSpec(entry.component.value), "V"));
          break;
        case "logicConstant": {
          let v: number;
          try {
            v = logicConstantVolts(entry.component.value);
          } catch {
            v = parseQuantity(entry.component.value, "V");
          }
          dcSourceValue.set(id, v);
          break;
        }
        case "isource":
          if (!sourceWaveforms.get(id)) dcSourceValue.set(id, parseQuantity(stripAcSpec(entry.component.value), "A"));
          break;
        case "vac":
          acWaveAt.set(id, signalEvaluator(entry.component.value, "V"));
          break;
        case "iac":
          acWaveAt.set(id, signalEvaluator(entry.component.value, "A"));
          break;
        case "vccs":
          gainOf.set(id, parseQuantity(entry.component.value, "A/V"));
          break;
        case "vcvs":
          gainOf.set(id, parseQuantity(entry.component.value, "V/V"));
          break;
        case "cccs":
          gainOf.set(id, parseQuantity(entry.component.value, "A/A"));
          break;
        case "ccvs":
          gainOf.set(id, parseQuantity(entry.component.value, "V/A"));
          break;
        case "switch":
        case "pushButton":
          if (isStaticContactClosed(entry.component.value)) closedSwitches.add(id);
          break;
        case "spdt":
          // Handled in the stamp loop via throw position (not closedSwitches).
          break;
        case "bsource":
          behavioralTermsOf.set(id, resolveBehavioralTerms(bModels.get(id)!, entry.component.label, netByName));
          break;
        default:
          break;
      }
    }

    // Per-component branch-current samples (SPICE sign convention), keyed by id.
    const currentSamples = new Map<string, number[]>();
    const currentRefs = new Map<string, string>();
    const pushCurrent = (id: string, ref: string, value: number) => {
      if (!ref) return; // unlabeled parts can't be referenced as I(ref)
      let arr = currentSamples.get(id);
      if (!arr) {
        arr = [];
        currentSamples.set(id, arr);
        currentRefs.set(id, ref);
      }
      arr.push(value);
    };

    // Stamp helpers shared between the one-time matrix build (F1, diode-free
    // circuits only - see `linear` below) and the per-step loop. `matrix` is
    // null whenever the LHS was already factored and only `rhs` needs
    // rebuilding for this step; every stamp function used here no-ops its
    // matrix-touching half when passed null (see the stamp* definitions
    // below the solver), so this is the exact same code path either way -
    // just with the matrix side skipped on most calls.
    // (`resolvedCircuit` re-binds the already-narrowed `circuit` to a plain
    // const: TS can't carry a `let`'s narrowing into a closure body, since it
    // can't prove the outer variable isn't reassigned before the closure
    // runs - this sidesteps that without changing anything at runtime.)
    const resolvedCircuit = circuit;
    const startupScale = (time: number) => options.startup ? Math.min(1, Math.max(0, time / 20e-6)) : 1;
    const stampComponents = (matrix: number[][] | null, rhs: number[], time: number) => {
      for (const entry of resolvedCircuit.components) {
        switch (entry.component.kind) {
          case "resistor":
          case "bulb":
            stampConductance(matrix, netIndex(entry.pins.a, nodeIndex), netIndex(entry.pins.b, nodeIndex), conductanceOf.get(entry.component.id)!);
            break;
          case "polarizedCapacitor":
          case "capacitor": {
            const conductance = capacitanceOf.get(entry.component.id)! / stepSize;
            const a = netIndex(entry.pins.a, nodeIndex);
            const b = netIndex(entry.pins.b, nodeIndex);
            const previousVoltage = capacitorVoltage.get(entry.component.id) ?? 0;
            stampConductance(matrix, a, b, conductance);
            stampCurrent(rhs, a, b, -conductance * previousVoltage);
            break;
          }
          case "vsource":
          case "logicConstant": {
            const sourceIndex = voltageSourceOffset + voltageSourceIndex.get(entry.component.id)!;
            const wave = sourceWaveforms.get(entry.component.id);
            const value = wave ? wave.at(time) : dcSourceValue.get(entry.component.id)!;
            stampVoltageSource(matrix, rhs, netIndex(entry.pins.p, nodeIndex), netIndex(entry.pins.n, nodeIndex), sourceIndex, value * startupScale(time));
            break;
          }
          case "vac": {
            const sourceIndex = voltageSourceOffset + voltageSourceIndex.get(entry.component.id)!;
            stampVoltageSource(matrix, rhs, netIndex(entry.pins.p, nodeIndex), netIndex(entry.pins.n, nodeIndex), sourceIndex, acWaveAt.get(entry.component.id)!(time) * startupScale(time));
            break;
          }
          case "isource": {
            // SPICE convention: positive value → current exits p into the external circuit.
            // Stamp from n to p so that rhs[p] += I (current injected into p).
            const wave = sourceWaveforms.get(entry.component.id);
            const value = wave ? wave.at(time) : dcSourceValue.get(entry.component.id)!;
            stampCurrent(rhs, netIndex(entry.pins.n, nodeIndex), netIndex(entry.pins.p, nodeIndex), value * startupScale(time));
            break;
          }
          case "iac":
            // Same polarity convention as isource.
            stampCurrent(rhs, netIndex(entry.pins.n, nodeIndex), netIndex(entry.pins.p, nodeIndex), acWaveAt.get(entry.component.id)!(time) * startupScale(time));
            break;
          case "inductor": {
            const branchIndex = inductorOffset + inductorIndex.get(entry.component.id)!;
            const resistance = inductanceOf.get(entry.component.id)! / stepSize;
            stampInductor(
              matrix,
              rhs,
              netIndex(entry.pins.a, nodeIndex),
              netIndex(entry.pins.b, nodeIndex),
              branchIndex,
              resistance,
              inductorCurrent.get(entry.component.id) ?? 0,
            );
            break;
          }
          case "opamp": {
            // Ideal op-amp (nullor): adds one extra unknown io (output branch current).
            // The constraint row enforces V(in+) = V(in-) (virtual short).
            // Output current io is injected into the out net KCL row.
            // Input pins draw NO current. Power pins (v+/v-) are ignored (gmin handles them).
            // All-matrix, no rhs term (rhs[ioIndex] = 0, already zero from
            // initialisation) - skipped entirely once the LHS is factored.
            if (matrix) {
              const ioIndex = opampOffset + opampIndex.get(entry.component.id)!;
              const outNode = netIndex(entry.pins["out"], nodeIndex);
              const inPlusNode = netIndex(entry.pins["in+"], nodeIndex);
              const inMinusNode = netIndex(entry.pins["in-"], nodeIndex);
              // Output current injection into out KCL row
              if (outNode >= 0) matrix[outNode][ioIndex] += 1;
              // Virtual-short constraint row: V(in+) - V(in-) = 0
              if (inPlusNode >= 0) matrix[ioIndex][inPlusNode] += 1;
              if (inMinusNode >= 0) matrix[ioIndex][inMinusNode] -= 1;
            }
            break;
          }
          case "vccs": {
            // VCCS (G): I(op→on) = gm·(V(cp) − V(cn)).
            const gm = gainOf.get(entry.component.id)!;
            stampVCCS(
              matrix,
              netIndex(entry.pins.op, nodeIndex),
              netIndex(entry.pins.on, nodeIndex),
              netIndex(entry.pins.cp, nodeIndex),
              netIndex(entry.pins.cn, nodeIndex),
              gm,
            );
            break;
          }
          case "vcvs": {
            // VCVS (E): V(op) − V(on) = gain·(V(cp) − V(cn)).
            const gain = gainOf.get(entry.component.id)!;
            const iIdx = vcvsOffset + vcvsIndex.get(entry.component.id)!;
            stampVCVS(
              matrix,
              netIndex(entry.pins.op, nodeIndex),
              netIndex(entry.pins.on, nodeIndex),
              netIndex(entry.pins.cp, nodeIndex),
              netIndex(entry.pins.cn, nodeIndex),
              iIdx,
              gain,
            );
            break;
          }
          case "cccs": {
            // CCCS (F): I(op→on) = gain·I_sense(cp→cn).
            const gain = gainOf.get(entry.component.id)!;
            const senseIdx = cccsOffset + cccsIndex.get(entry.component.id)!;
            stampCCCS(
              matrix,
              netIndex(entry.pins.op, nodeIndex),
              netIndex(entry.pins.on, nodeIndex),
              netIndex(entry.pins.cp, nodeIndex),
              netIndex(entry.pins.cn, nodeIndex),
              senseIdx,
              gain,
            );
            break;
          }
          case "ccvs": {
            // CCVS (H): V(op) − V(on) = r·I_sense(cp→cn).
            const r = gainOf.get(entry.component.id)!;
            const hi = ccvsIndex.get(entry.component.id)!;
            stampCCVS(
              matrix,
              netIndex(entry.pins.op, nodeIndex),
              netIndex(entry.pins.on, nodeIndex),
              netIndex(entry.pins.cp, nodeIndex),
              netIndex(entry.pins.cn, nodeIndex),
              ccvsOffset + hi * 2,
              ccvsOffset + hi * 2 + 1,
              r,
            );
            break;
          }
          case "bsource": {
            const model = bModels.get(entry.component.id)!;
            const p = netIndex(entry.pins.p, nodeIndex);
            const n = netIndex(entry.pins.n, nodeIndex);
            const terms = behavioralTermsOf.get(entry.component.id)!;
            if (model.type === "V") {
              const branchIndex = bsourceOffset + vBsourceIndex.get(entry.component.id)!;
              stampLinearVSource(matrix, rhs, p, n, branchIndex, model.constant, terms);
            } else {
              stampLinearISource(matrix, rhs, p, n, model.constant, terms);
            }
            break;
          }
          case "switch":
          case "pushButton":
            if (closedSwitches.has(entry.component.id)) {
              stampConductance(matrix, netIndex(entry.pins.a, nodeIndex), netIndex(entry.pins.b, nodeIndex), 1e9);
            }
            break;
          case "spdt": {
            const com = netIndex(entry.pins.com, nodeIndex);
            const thrown = isSpdtThrowToNo(entry.component.value)
              ? netIndex(entry.pins.no, nodeIndex)
              : netIndex(entry.pins.nc, nodeIndex);
            stampConductance(matrix, com, thrown, 1e9);
            break;
          }
          case "ground":
            break;
        }
      }
    };

    // Mutual-inductance coupling (backward-Euler companion): the flux in one
    // winding adds (M/h)·(Iother − Iother_prev) to this winding's branch eq,
    // mirroring the self term L/h. The cross-conductance matrix term is
    // constant (skipped when `matrix` is null); the history rhs term is not.
    const stampMutuals = (matrix: number[][] | null, rhs: number[]) => {
      for (const term of mutuals) {
        const ia = inductorOffset + term.a;
        const ib = inductorOffset + term.b;
        const r = term.m / stepSize;
        const iaPrev = inductorCurrent.get(inductors[term.a].component.id) ?? 0;
        const ibPrev = inductorCurrent.get(inductors[term.b].component.id) ?? 0;
        if (matrix) {
          matrix[ia][ib] -= r;
          matrix[ib][ia] -= r;
        }
        rhs[ia] -= r * ibPrev;
        rhs[ib] -= r * iaPrev;
      }
    };

    // F1: the transient LHS is provably time-invariant for a diode-free
    // circuit - every stamp above uses a constant (G, C/h, L/h, +/-1 at fixed
    // branch indices, fixed gains, M/h for mutuals); only `rhs` carries the
    // time-varying source and history terms. Factor the matrix once here
    // (recording the Gauss-Jordan row operations, see `factorMatrix` below)
    // and replay that factorization against a freshly-stamped `rhs` every
    // step, instead of re-running Gauss-Jordan (O(n^3)) on a freshly rebuilt
    // matrix every step. A circuit with junction diodes keeps the original
    // per-step rebuild + Newton path below unchanged: the diode companion
    // conductance is added onto a fresh copy of the matrix every Newton
    // iteration (see `diodes.length > 0` below), so the LHS genuinely
    // changes there and a single reusable factorization would be unsound.
    // Restricting the fast path to the diode-free case is deliberate -
    // correctness beats speed here.
    const linear = diodes.length === 0;
    let baseFactorization: GaussJordanFactorization | null = null;
    if (linear) {
      const baseMatrix = zeroMatrix(size);
      if (opamps.length > 0 || hasSwitch) {
        for (let i = 0; i < nonGroundNets.length; i += 1) {
          baseMatrix[i][i] += GMIN;
        }
      }
      const scratchRhs = Array(size).fill(0) as number[];
      stampComponents(baseMatrix, scratchRhs, 0);
      stampMutuals(baseMatrix, scratchRhs);
      baseFactorization = factorMatrix(baseMatrix);
    }

    // Set once the run is stopped early (Stop button / AbortSignal) - the
    // loop below breaks out and falls through to the same result-building
    // code as a completed run, just with fewer samples and a warning.
    let aborted = false;
    let lastYieldAt = Date.now();

    // Scratch reused for every step (and every Newton iteration within a
    // step). The Newton path used to build `matrix.map(row => [...row])` plus
    // a fresh rhs copy per iteration; on a 3001-step run with a diode that is
    // tens of thousands of throwaway arrays, all of which the GC then had to
    // walk. Allocated once here, consumed destructively by `solveAugmented`.
    const newtonWork = linear ? null : new Float64Array(size * (size + 1));
    const newtonOut = linear ? null : new Float64Array(size);

    for (let step = 0; step <= options.steps; step += 1) {
      const time = step * stepSize;
      // Diode-free: the matrix was already factored above, so stampComponents
      // /stampMutuals below are called with `matrix = null` and only rebuild
      // rhs. Diode-bearing: rebuild the matrix fresh every step exactly as
      // before, since the Newton loop mutates it per iteration.
      const matrix = linear ? null : zeroMatrix(size);
      const rhs = Array(size).fill(0) as number[];

      // SPICE gmin: when op-amps, diodes or switches are present, add GMIN from every
      // non-ground node to ground so floating nodes (e.g. unconnected op-amp
      // rails, or a node isolated behind a reverse-biased diode) resolve to
      // ~0 V rather than making the matrix singular. Applied only for those
      // devices to avoid masking genuine floating-node errors elsewhere.
      // (For the linear/opamp case this was already folded into the
      // factored base matrix above, so `matrix` being null skips it here.)
      if (matrix && (opamps.length > 0 || diodes.length > 0 || hasSwitch)) {
        for (let i = 0; i < nonGroundNets.length; i += 1) {
          matrix[i][i] += GMIN;
        }
      }

      stampComponents(matrix, rhs, time);
      stampMutuals(matrix, rhs);

      // Linear circuits solve via the factorization computed once above.
      // With junction diodes the assembled matrix/rhs here is the constant
      // part; Newton-iterate the diode companions on top of a copy until the
      // junction voltages settle (SPICE-style reltol/vntol), with pnjlim
      // damping each update.
      let solution: ArrayLike<number> | null = null;
      if (linear) {
        solution = solveWithFactorization(baseFactorization!, rhs);
      } else {
        const guesses = new Map<string, number>();
        for (const entry of diodes) {
          guesses.set(entry.component.id, diodeVoltage.get(entry.component.id) ?? 0);
        }
        for (let iteration = 0; iteration < NEWTON_MAX_ITERATIONS; iteration += 1) {
          // Non-null: this branch only runs when `linear` is false, which is
          // exactly when `matrix` above was allocated (not left null).
          // Load this iteration's system straight into the flat scratch:
          // the constant part stamped above, plus the rhs in the augmented
          // column. The diode companions are then stamped on top through
          // `newtonMatrix`/`newtonRhs`, which are thin views onto the same
          // buffer so the existing stamp helpers work unchanged.
          const work = newtonWork!;
          const stride = size + 1;
          for (let row = 0; row < size; row += 1) {
            const source = matrix![row];
            const base = row * stride;
            for (let col = 0; col < size; col += 1) work[base + col] = source[col];
            work[base + size] = rhs[row];
          }
          for (const entry of diodes) {
            const spec = diodeSpecs.get(entry.component.id)!;
            const junction = guesses.get(entry.component.id)!;
            const conductance = diodeConductance(spec, junction);
            const equivalent = diodeCurrent(spec, junction) - conductance * junction;
            const anode = netIndex(entry.pins.a, nodeIndex);
            const cathode = netIndex(entry.pins.k, nodeIndex);
            stampConductanceFlat(work, stride, anode, cathode, conductance);
            stampCurrentFlat(work, stride, size, anode, cathode, equivalent);
            if (entry.component.kind === "photodiode") {
              stampCurrentFlat(work, stride, size, cathode, anode, photodiodePhotocurrentAmps(entry.component.value));
            }
          }
          const attempt = solveAugmented(work, size, newtonOut!);
          let converged = true;
          for (const entry of diodes) {
            const spec = diodeSpecs.get(entry.component.id)!;
            const previous = guesses.get(entry.component.id)!;
            const next = limitDiodeVoltage(
              spec,
              voltageBetween(entry.pins.a, entry.pins.k, nodeIndex, attempt),
              previous,
            );
            if (Math.abs(next - previous) > 1e-6 + 1e-3 * Math.abs(next)) converged = false;
            guesses.set(entry.component.id, next);
          }
          if (converged) {
            solution = attempt;
            break;
          }
        }
        if (!solution) {
          return fail(
            "No convergence",
            `The diode models did not converge at t = ${formatEngineering(time, "s", 3)}. Try more time steps or simplify the circuit.`,
            circuit,
          );
        }
        for (const [id, junction] of guesses) diodeVoltage.set(id, junction);
      }
      times.push(time);
      for (let i = 0; i < nonGroundNets.length; i += 1) traceValues[i].push(solution[i]);

      for (const entry of circuit.components) {
        const id = entry.component.id;
        const ref = entry.component.label;
        switch (entry.component.kind) {
          case "polarizedCapacitor":
          case "capacitor": {
            const now = voltageBetween(entry.pins.a, entry.pins.b, nodeIndex, solution);
            const prev = capacitorVoltage.get(id) ?? 0;
            capacitorVoltage.set(id, now);
            const c = sampleCapacitance.get(id)!;
            pushCurrent(id, ref, step === 0 || !(c > 0) ? 0 : (c * (now - prev)) / stepSize);
            break;
          }
          case "inductor": {
            const currentIndex = inductorOffset + inductorIndex.get(id)!;
            inductorCurrent.set(id, solution[currentIndex]);
            pushCurrent(id, ref, solution[currentIndex]);
            break;
          }
          case "resistor":
          case "bulb": {
            const r = sampleResistance.get(id)!;
            if (r > 0) pushCurrent(id, ref, voltageBetween(entry.pins.a, entry.pins.b, nodeIndex, solution) / r);
            break;
          }
          case "vsource":
          case "logicConstant":
          case "vac": {
            const currentIndex = voltageSourceOffset + voltageSourceIndex.get(id)!;
            pushCurrent(id, ref, solution[currentIndex]);
            break;
          }
          case "isource": {
            // The strict stamp parse above already failed the run on a bad
            // value, so the once-parsed DC magnitude is safe to reuse here.
            const wave = sourceWaveforms.get(id);
            pushCurrent(id, ref, (wave ? wave.at(time) : dcSourceValue.get(id) ?? 0) * startupScale(time));
            break;
          }
          case "iac": {
            pushCurrent(id, ref, acWaveAt.get(id)!(time) * startupScale(time));
            break;
          }
          case "vcvs": {
            const currentIndex = vcvsOffset + vcvsIndex.get(id)!;
            pushCurrent(id, ref, solution[currentIndex]);
            break;
          }
          case "vccs": {
            const vctrl = voltageBetween(entry.pins.cp, entry.pins.cn, nodeIndex, solution);
            pushCurrent(id, ref, gainOf.get(id)! * vctrl);
            break;
          }
          case "cccs": {
            // Output current = gain·I_sense; the sense current is the branch unknown.
            const senseIdx = cccsOffset + cccsIndex.get(id)!;
            pushCurrent(id, ref, gainOf.get(id)! * solution[senseIdx]);
            break;
          }
          case "ccvs": {
            // Output branch current is the second of this device's two unknowns.
            const hi = ccvsIndex.get(id)!;
            pushCurrent(id, ref, solution[ccvsOffset + hi * 2 + 1]);
            break;
          }
          case "diode":
          case "led":
          case "zener":
          case "photodiode": {
            const spec = diodeSpecs.get(id)!;
            let amps = diodeCurrent(spec, voltageBetween(entry.pins.a, entry.pins.k, nodeIndex, solution));
            if (entry.component.kind === "photodiode") {
              // Net branch current anode→cathode = diode − Iph (Iph is K→A).
              amps -= photodiodePhotocurrentAmps(entry.component.value);
            }
            pushCurrent(id, ref, amps);
            break;
          }
        }
      }

      // Cooperative yield: this step's samples are already fully committed
      // above (times/traceValues/currentSamples), so it's always safe to
      // stop right here - never mid-step. The step-count check is free and
      // covers the common case; the wall-clock fallback is only sampled
      // every YIELD_TIME_CHECK_STRIDE steps rather than every step - `||`
      // only skips its right operand when the left one is true, so with the
      // step-count check on the left (true on 1 in YIELD_STEP_INTERVAL
      // steps) a plain `A || B` here called Date.now() on the other 249 of
      // every 250 steps, the opposite of what this comment used to claim.
      if (
        step % YIELD_STEP_INTERVAL === 0 ||
        (step % YIELD_TIME_CHECK_STRIDE === 0 && Date.now() - lastYieldAt >= YIELD_TIME_INTERVAL_MS)
      ) {
        control?.onProgress?.(step / options.steps);
        if (control?.signal?.aborted) {
          aborted = true;
          break;
        }
        await yieldToEventLoop();
        lastYieldAt = Date.now();
        if (control?.signal?.aborted) {
          aborted = true;
          break;
        }
      }
    }

    if (!aborted) control?.onProgress?.(1);

    const currents: CurrentTrace[] = [];
    for (const [id, values] of currentSamples) {
      const ref = currentRefs.get(id) ?? id;
      currents.push({ ref, label: `I(${ref})`, values });
    }

    // Reached stop time on an early abort is whatever the last committed
    // sample says, not the originally requested `options.stopTime` - the
    // stats/warning must describe what the user is actually looking at.
    const reachedStopTime = times.length > 0 ? times[times.length - 1] : 0;
    const warnings = [...circuit.warnings, ...extraWarnings];
    if (aborted) {
      warnings.push(
        `Stopped early at ${formatEngineering(reachedStopTime, "s", 2)} of ${formatEngineering(options.stopTime, "s", 2)}.`,
      );
    }

    return {
      ok: true,
      title: "Transient",
      times,
      traces: nonGroundNets.map((net, index) => ({
        id: net.id,
        label: `V(${nodeName(net)})`,
        unit: "V",
        color: TRACE_COLORS[index % TRACE_COLORS.length],
        values: traceValues[index],
      })),
      currents,
      stats: {
        netCount: circuit.nets.length,
        componentCount: circuit.components.length,
        sampleCount: times.length,
        stopTime: aborted ? reachedStopTime : options.stopTime,
        stepSize,
      },
      warnings,
      circuit,
    };
  } catch (error) {
    return fail("Analysis failed", error instanceof Error ? error.message : "Unknown analysis error.", circuit);
  }
}

/** A friendly node name derived from the parts it touches, e.g. "R1·C1" instead of "N001". */
function nodeName(net: { id: string; pins: { componentLabel: string }[] }): string {
  const labels = [...new Set(net.pins.map((p) => p.componentLabel).filter(Boolean))];
  return labels.length > 0 ? labels.slice(0, 2).join("·") : net.id;
}

function fail(title: string, message: string, circuit?: ExtractedCircuit): AnalysisResult {
  return {
    ok: false,
    title,
    message,
    warnings: circuit?.warnings ?? [],
    circuit,
  };
}

function validateOptions(options: AnalysisOptions) {
  if (!Number.isFinite(options.stopTime) || options.stopTime <= 0) {
    throw new Error("Stop time must be greater than zero.");
  }
  if (!Number.isInteger(options.steps) || options.steps < 8 || options.steps > MAX_TRANSIENT_STEPS) {
    throw new Error(`Steps must be an integer from 8 to ${MAX_TRANSIENT_STEPS.toLocaleString("en-US")}.`);
  }
}

/** Inspect the highest periodic source before running, so the UI can display a
 * meaningful samples-per-cycle figure and the solver can prevent aliasing. */
export function inspectTransientResolution(
  components: readonly SchematicComponent[],
  options: AnalysisOptions,
): TransientResolution {
  let maxFrequencyHz = 0;
  for (const component of components) {
    const frequency = periodicSourceFrequencyHz(component);
    if (frequency === null) continue;
    if (!Number.isFinite(frequency) || frequency < 0) {
      throw new Error(`${component.label || component.id} needs a non-negative frequency.`);
    }
    maxFrequencyHz = Math.max(maxFrequencyHz, frequency);
  }
  const samplesPerCycle = maxFrequencyHz > 0 ? options.steps / (options.stopTime * maxFrequencyHz) : null;
  return {
    maxFrequencyHz,
    requiredSteps: maxFrequencyHz > 0 ? Math.ceil(options.stopTime * maxFrequencyHz * MIN_SAMPLES_PER_CYCLE) : 0,
    samplesPerCycle,
  };
}

/**
 * Clamp a requested transient run to the circuit-derived minimum sample
 * density. When the requirement exceeds the runtime's output ceiling, return
 * the ceiling so the UI can honestly ask the user to shorten STOP.
 */
export function enforceMinimumTransientSteps(
  components: readonly SchematicComponent[],
  options: AnalysisOptions,
  maxSteps = MAX_TRANSIENT_STEPS,
): AnalysisOptions {
  try {
    const { requiredSteps } = inspectTransientResolution(components, options);
    if (requiredSteps <= 0 || options.steps >= requiredSteps) return options;
    return { ...options, steps: Math.min(maxSteps, requiredSteps) };
  } catch {
    // A malformed source is reported by the normal run validation. The
    // protective UI clamp must not make the whole workspace fail to render.
    return options;
  }
}

/** Dominant frequency a source imposes on transient sampling, or null when the
 *  component is not a source / is plain DC. May return NaN/negative for a
 *  malformed value - callers decide whether that is an error (the resolution
 *  inspector throws) or a skip (the auto-resolution heuristic). */
export function periodicSourceFrequencyHz(component: SchematicComponent): number | null {
  const isAcSymbol = component.kind === "vac" || component.kind === "iac";
  const isPlainSource = component.kind === "vsource" || component.kind === "isource";
  if (!isAcSymbol && !isPlainSource) return null;
  const unit: "V" | "A" = component.kind === "vac" || component.kind === "vsource" ? "V" : "A";
  if (isFunctionSource(component.value)) {
    // SINE/PULSE/SFFM etc. on any source symbol contributes its own frequency.
    return parseTransientSource(component.value, unit).maxFrequencyHz;
  }
  if (isAcSymbol) return parseSineSource(component.value, unit).frequency;
  return null; // a plain DC vsource/isource imposes no sampling requirement
}

function validateTransientResolution(resolution: TransientResolution, options: AnalysisOptions) {
  if (resolution.maxFrequencyHz <= 0) return;
  const frequency = formatEngineering(resolution.maxFrequencyHz, "Hz", 3);
  if (resolution.requiredSteps > MAX_TRANSIENT_STEPS) {
    const maxStopTime = MAX_TRANSIENT_STEPS / (resolution.maxFrequencyHz * MIN_SAMPLES_PER_CYCLE);
    throw new Error(
      `${frequency} across ${formatEngineering(options.stopTime, "s", 3)} needs ${formatStepCount(resolution.requiredSteps)} steps at ${MIN_SAMPLES_PER_CYCLE} samples/cycle. `
      + `The interactive solver is capped at ${formatStepCount(MAX_TRANSIENT_STEPS)}. Reduce STOP to ${formatEngineering(maxStopTime, "s", 3)} or less, or use AC analysis.`,
    );
  }
  if ((resolution.samplesPerCycle ?? Infinity) < MIN_SAMPLES_PER_CYCLE) {
    throw new Error(
      `Transient resolution is too low for ${frequency}: ${formatStepCount(options.steps)} steps gives ${formatSamplesPerCycle(resolution.samplesPerCycle)} samples/cycle. `
      + `Use at least ${formatStepCount(resolution.requiredSteps)} steps (${MIN_SAMPLES_PER_CYCLE} samples/cycle), reduce STOP, or use AC analysis.`,
    );
  }
}

const formatStepCount = (value: number) => value.toLocaleString("en-US");
const formatSamplesPerCycle = (value: number | null) => value === null ? "--" : Number(value.toPrecision(3)).toString();

function resistanceToConductance(entry: ExtractedComponent): number {
  return 1 / positiveValue(entry, "Ω");
}

function positiveValue(entry: ExtractedComponent, unit: string): number {
  // A C/L value may carry a per-instance `IC=` initial-condition token
  // (e.g. "100p IC=1") and a resistor may carry a `tc=` tempco; strip both
  // before parsing the magnitude.
  const value = parseQuantity(stripTcSpec(stripIcSpec(entry.component.value)), unit);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${entry.component.label || entry.component.id} must have a positive ${unit} value.`);
  }
  return value;
}

/** Parse a vac/iac stimulus once per run and return a per-step evaluator.
 * SINE/PULSE/PWL/EXP/SFFM stimulus on an AC-symbol source evaluates the full
 * time-domain waveform; plain `amp freq` (legacy vac/iac form) keeps the
 * bare-sine interpretation below. */
function signalEvaluator(value: string, unit: "V" | "A"): (time: number) => number {
  if (isFunctionSource(value)) {
    const source = parseTransientSource(value, unit);
    return (time) => source.at(time);
  }
  const source = parseSineSource(value, unit);
  return (time) => source.offset + source.amplitude * Math.sin(2 * Math.PI * source.frequency * time);
}

function parseSineSource(value: string, unit: "V" | "A") {
  const tokens = value.trim().split(/[\s,;@]+/).filter(Boolean);
  if (tokens.length === 0) throw new Error(`AC ${unit} source needs amplitude and frequency.`);
  if (tokens.length === 1) return { offset: 0, amplitude: parseQuantity(tokens[0], unit), frequency: 0 };

  const offset = tokens.length >= 3 ? parseQuantity(tokens[0], unit) : 0;
  const amplitude = parseQuantity(tokens.length >= 3 ? tokens[1] : tokens[0], unit);
  const frequency = parseQuantity(tokens.length >= 3 ? tokens[2] : tokens[1], "Hz");
  return { offset, amplitude, frequency };
}

function netIndex(net: string | undefined, nodeIndex: Map<string, number>): number {
  if (!net || net === "0") return -1;
  return nodeIndex.get(net) ?? -1;
}

function zeroMatrix(size: number): number[][] {
  return Array.from({ length: size }, () => Array(size).fill(0) as number[]);
}

// The stamp helpers below all take `matrix: number[][] | null`. For a
// diode-free circuit the LHS matrix is time-invariant (F1): it is built and
// factored once before the time loop, and every step thereafter passes
// `matrix = null` here to skip re-stamping it while still stamping the
// time-varying `rhs` terms. A nonlinear (diode-bearing) circuit still passes
// a real matrix every step, exactly as before - see the Newton loop below.
function stampConductance(matrix: number[][] | null, a: number, b: number, conductance: number) {
  if (!matrix) return;
  if (a >= 0) matrix[a][a] += conductance;
  if (b >= 0) matrix[b][b] += conductance;
  if (a >= 0 && b >= 0) {
    matrix[a][b] -= conductance;
    matrix[b][a] -= conductance;
  }
}

function stampCurrent(rhs: number[], a: number, b: number, currentFromAToB: number) {
  if (a >= 0) rhs[a] -= currentFromAToB;
  if (b >= 0) rhs[b] += currentFromAToB;
}

/* The two stamps the Newton loop needs, against the flat augmented buffer
 * `solveAugmented` consumes: `n` rows of `n + 1` doubles, the last column
 * being the rhs. Same arithmetic in the same order as the `number[][]`
 * versions above - only the addressing differs, so a diode circuit solves to
 * the same bits it always did. Kept as separate functions rather than proxy
 * views over the buffer: two multiply-adds do not deserve a Proxy. */
function stampConductanceFlat(work: Float64Array, stride: number, a: number, b: number, conductance: number) {
  if (a >= 0) work[a * stride + a] += conductance;
  if (b >= 0) work[b * stride + b] += conductance;
  if (a >= 0 && b >= 0) {
    work[a * stride + b] -= conductance;
    work[b * stride + a] -= conductance;
  }
}

function stampCurrentFlat(work: Float64Array, stride: number, n: number, a: number, b: number, currentFromAToB: number) {
  if (a >= 0) work[a * stride + n] -= currentFromAToB;
  if (b >= 0) work[b * stride + n] += currentFromAToB;
}

function stampVoltageSource(
  matrix: number[][] | null,
  rhs: number[],
  positive: number,
  negative: number,
  sourceIndex: number,
  voltage: number,
) {
  if (matrix) {
    if (positive >= 0) {
      matrix[positive][sourceIndex] += 1;
      matrix[sourceIndex][positive] += 1;
    }
    if (negative >= 0) {
      matrix[negative][sourceIndex] -= 1;
      matrix[sourceIndex][negative] -= 1;
    }
  }
  rhs[sourceIndex] += voltage;
}

/** Voltage-controlled current source: I(op→on) = gm·(V(cp) − V(cn)). */
function stampVCCS(matrix: number[][] | null, op: number, on: number, cp: number, cn: number, gm: number) {
  if (!matrix) return;
  if (op >= 0 && cp >= 0) matrix[op][cp] += gm;
  if (op >= 0 && cn >= 0) matrix[op][cn] -= gm;
  if (on >= 0 && cp >= 0) matrix[on][cp] -= gm;
  if (on >= 0 && cn >= 0) matrix[on][cn] += gm;
}

/** Voltage-controlled voltage source: V(op) − V(on) = gain·(V(cp) − V(cn)). */
function stampVCVS(matrix: number[][] | null, op: number, on: number, cp: number, cn: number, branchIndex: number, gain: number) {
  if (!matrix) return;
  if (op >= 0) {
    matrix[op][branchIndex] += 1;
    matrix[branchIndex][op] += 1;
  }
  if (on >= 0) {
    matrix[on][branchIndex] -= 1;
    matrix[branchIndex][on] -= 1;
  }
  if (cp >= 0) matrix[branchIndex][cp] -= gain;
  if (cn >= 0) matrix[branchIndex][cn] += gain;
}

/** Linear behavioral V-source: V(p) − V(n) = constant + Σ coeff·V(node). */
function stampLinearVSource(matrix: number[][] | null, rhs: number[], p: number, n: number, branchIndex: number, constant: number, terms: BehavioralTerm[]) {
  stampVoltageSource(matrix, rhs, p, n, branchIndex, constant);
  if (matrix) {
    for (const { index, coeff } of terms) {
      if (index >= 0) matrix[branchIndex][index] -= coeff;
    }
  }
}

/** Linear behavioral I-source: I(p→n) = constant + Σ coeff·V(node). */
function stampLinearISource(matrix: number[][] | null, rhs: number[], p: number, n: number, constant: number, terms: BehavioralTerm[]) {
  stampCurrent(rhs, p, n, constant);
  for (const { index, coeff } of terms) {
    stampVCCS(matrix, p, n, index, -1, coeff);
  }
}

/** Internal zero-volt control-sense source (cp→cn); `senseIdx` = I(cp→cn). */
function stampSenseBranch(matrix: number[][] | null, cp: number, cn: number, senseIdx: number) {
  if (!matrix) return;
  if (cp >= 0) {
    matrix[cp][senseIdx] += 1;
    matrix[senseIdx][cp] += 1;
  }
  if (cn >= 0) {
    matrix[cn][senseIdx] -= 1;
    matrix[senseIdx][cn] -= 1;
  }
}

/** Current-controlled current source: I(op→on) = gain·I_sense(cp→cn). */
function stampCCCS(matrix: number[][] | null, op: number, on: number, cp: number, cn: number, senseIdx: number, gain: number) {
  if (!matrix) return;
  stampSenseBranch(matrix, cp, cn, senseIdx);
  if (op >= 0) matrix[op][senseIdx] += gain;
  if (on >= 0) matrix[on][senseIdx] -= gain;
}

/** Current-controlled voltage source: V(op) − V(on) = r·I_sense(cp→cn). */
function stampCCVS(matrix: number[][] | null, op: number, on: number, cp: number, cn: number, senseIdx: number, outIdx: number, r: number) {
  if (!matrix) return;
  stampSenseBranch(matrix, cp, cn, senseIdx);
  if (op >= 0) {
    matrix[op][outIdx] += 1;
    matrix[outIdx][op] += 1;
  }
  if (on >= 0) {
    matrix[on][outIdx] -= 1;
    matrix[outIdx][on] -= 1;
  }
  matrix[outIdx][senseIdx] -= r;
}

function stampInductor(
  matrix: number[][] | null,
  rhs: number[],
  a: number,
  b: number,
  inductorIndex: number,
  resistance: number,
  previousCurrent: number,
) {
  if (matrix) {
    if (a >= 0) {
      matrix[a][inductorIndex] += 1;
      matrix[inductorIndex][a] += 1;
    }
    if (b >= 0) {
      matrix[b][inductorIndex] -= 1;
      matrix[inductorIndex][b] -= 1;
    }
    matrix[inductorIndex][inductorIndex] -= resistance;
  }
  rhs[inductorIndex] -= resistance * previousCurrent;
}

function voltageBetween(
  aNet: string | undefined,
  bNet: string | undefined,
  nodeIndex: Map<string, number>,
  // `ArrayLike`, not `number[]`: the solvers below hand back a Float64Array
  // scratch buffer now. Indexing is identical; only the declared type moves.
  solution: ArrayLike<number>,
): number {
  const a = netIndex(aNet, nodeIndex);
  const b = netIndex(bNet, nodeIndex);
  return (a >= 0 ? solution[a] : 0) - (b >= 0 ? solution[b] : 0);
}

/**
 * Gauss-Jordan on one contiguous augmented matrix.
 *
 * Same eliminations in the same order as the `number[][]` version this
 * replaces, so the result is bit-for-bit identical - the change is layout, not
 * arithmetic. Two things were costing more than the maths:
 *
 * - `matrix.map((row, i) => [...row, rhs[i]])` allocated n+1 fresh arrays on
 *   every call, and this is the Newton inner loop: once per iteration per
 *   timestep. A reused `Float64Array` allocates nothing.
 * - `a[row][item]` is two dependent loads (row pointer, then element) with the
 *   rows scattered across the heap. `a[row * stride + item]` is one load into
 *   memory the prefetcher can follow.
 *
 * Benchmarked against the old implementation on MNA-shaped matrices, checked
 * element-by-element with `Object.is`: 3.7x at n=16, 1.8x at n=48, 1.7x at
 * n=120. The small-n end is the allocation, the large-n end is the locality.
 *
 * `work` is `n` rows of `n + 1` doubles, row-major, the last column being the
 * rhs. It is consumed destructively. `out` receives the solution.
 */
function solveAugmented(work: Float64Array, n: number, out: Float64Array): Float64Array {
  const stride = n + 1;
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    let best = Math.abs(work[col * stride + col]);
    for (let row = col + 1; row < n; row += 1) {
      const candidate = Math.abs(work[row * stride + col]);
      if (candidate > best) { best = candidate; pivot = row; }
    }
    if (best < 1e-12) {
      throw new Error("Matrix is singular. Check for floating nodes, voltage-source loops, or missing ground connections.");
    }
    if (pivot !== col) {
      const pivotRow = pivot * stride;
      const colRow = col * stride;
      for (let item = 0; item <= n; item += 1) {
        const t = work[pivotRow + item];
        work[pivotRow + item] = work[colRow + item];
        work[colRow + item] = t;
      }
    }

    const colRow = col * stride;
    const pivotValue = work[colRow + col];
    for (let item = col; item <= n; item += 1) work[colRow + item] /= pivotValue;

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const base = row * stride;
      const factor = work[base + col];
      if (factor === 0) continue;
      for (let item = col; item <= n; item += 1) work[base + item] -= factor * work[colRow + item];
    }
  }

  for (let i = 0; i < n; i += 1) out[i] = work[i * stride + n];
  return out;
}

/** Recorded Gauss-Jordan row operations for a matrix that will be reused
 *  across many right-hand sides (F1: the transient LHS is time-invariant for
 *  a diode-free circuit, so it only needs to be reduced once). This is not
 *  classic LU + triangular solves - it is the same full reduce-to-identity
 *  elimination `solveLinearSystem` performs, just split so the matrix-only
 *  half runs once and the recorded pivot/factor sequence replays against a
 *  fresh rhs every step. Replaying the identical operations in the identical
 *  order is what makes the result bit-for-bit equal to calling
 *  `solveLinearSystem(matrix, rhs)` fresh every step - a genuine LU/back-
 *  substitution implementation would round differently in the last bit or
 *  two, which would fail the bit-identical proof this fix requires. */
interface GaussJordanFactorization {
  n: number;
  /** Row swapped into `col` during elimination (may equal `col`). */
  swapWith: Int32Array;
  /** Diagonal value each row was normalized by, read after the swap. */
  pivotValue: Float64Array;
  /**
   * The recorded eliminations, flattened CSR-style: column `col` owns
   * `[start[col], start[col + 1])` of `elimRow`/`elimFactor`, in the same
   * row-iteration order the dense elimination visited them.
   *
   * This was `{ row, factor }[][]` - an array, of arrays, of small objects -
   * and it is read in the innermost loop of the entire transient solve, once
   * per recorded elimination per timestep. Every element cost a pointer
   * dereference to an object somewhere else on the heap plus two property
   * loads. Three parallel typed arrays put the whole replay in contiguous
   * memory: measured 1.2-1.4x on the full 3001-step replay, bit-identical
   * output because the order and the arithmetic are unchanged.
   */
  start: Int32Array;
  elimRow: Int32Array;
  elimFactor: Float64Array;
  /** Reused across steps so a 3001-step run allocates one solution vector. */
  scratch: Float64Array;
}

function factorMatrix(matrix: number[][]): GaussJordanFactorization {
  const n = matrix.length;
  // Flat working copy, same reason as `solveAugmented`: this is O(n^3) over
  // memory the row-of-arrays layout scattered across the heap.
  const a = new Float64Array(n * n);
  for (let row = 0; row < n; row += 1) {
    const source = matrix[row];
    for (let col = 0; col < n; col += 1) a[row * n + col] = source[col];
  }
  const swapWith = new Int32Array(n);
  const pivotValue = new Float64Array(n);
  const elimRow: number[] = [];
  const elimFactor: number[] = [];
  const start = new Int32Array(n + 1);

  for (let col = 0; col < n; col += 1) {
    start[col] = elimRow.length;
    let pivot = col;
    let best = Math.abs(a[col * n + col]);
    for (let row = col + 1; row < n; row += 1) {
      const candidate = Math.abs(a[row * n + col]);
      if (candidate > best) { best = candidate; pivot = row; }
    }
    if (best < 1e-12) {
      throw new Error("Matrix is singular. Check for floating nodes, voltage-source loops, or missing ground connections.");
    }
    swapWith[col] = pivot;
    if (pivot !== col) {
      const pivotRow = pivot * n;
      const colRow = col * n;
      for (let item = 0; item < n; item += 1) {
        const t = a[pivotRow + item];
        a[pivotRow + item] = a[colRow + item];
        a[colRow + item] = t;
      }
    }

    const colRow = col * n;
    const value = a[colRow + col];
    pivotValue[col] = value;
    for (let item = col; item < n; item += 1) a[colRow + item] /= value;

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const base = row * n;
      const factor = a[base + col];
      if (factor === 0) continue;
      for (let item = col; item < n; item += 1) a[base + item] -= factor * a[colRow + item];
      elimRow.push(row);
      elimFactor.push(factor);
    }
  }
  start[n] = elimRow.length;

  return {
    n,
    swapWith,
    pivotValue,
    start,
    elimRow: Int32Array.from(elimRow),
    elimFactor: Float64Array.from(elimFactor),
    scratch: new Float64Array(n),
  };
}

/** Replay the recorded elimination against one rhs vector. Produces the same
 *  result `solveLinearSystem(matrix, rhs)` would, in O(n^2) instead of
 *  O(n^3), because the O(n^3) matrix-side work already happened once in
 *  `factorMatrix`. */
function solveWithFactorization(
  factorization: GaussJordanFactorization,
  rhs: readonly number[],
): Float64Array {
  const { n, swapWith, pivotValue, start, elimRow, elimFactor, scratch: v } = factorization;
  for (let i = 0; i < n; i += 1) v[i] = rhs[i];
  for (let col = 0; col < n; col += 1) {
    const pivot = swapWith[col];
    if (pivot !== col) {
      const t = v[pivot];
      v[pivot] = v[col];
      v[col] = t;
    }
    // Hoisted: the old form re-read `v[col]` from memory on every elimination
    // in the inner loop, and the compiler cannot prove `v[row] -= ...` never
    // aliases it (row === col is excluded when recording, but only we know
    // that). One local, one read.
    const vc = (v[col] /= pivotValue[col]);
    for (let k = start[col], end = start[col + 1]; k < end; k += 1) {
      v[elimRow[k]] -= elimFactor[k] * vc;
    }
  }
  return v;
}
