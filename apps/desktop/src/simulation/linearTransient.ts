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

export interface AnalysisOptions {
  stopTime: number;
  steps: number;
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
    }
  | {
      ok: false;
      title: string;
      message: string;
      warnings: string[];
      circuit?: ExtractedCircuit;
    };

const TRACE_COLORS = [
  "var(--trace-cyan)",
  "var(--trace-green)",
  "var(--trace-cream)",
  "var(--trace-red)",
  "var(--trace-purple)",
  "var(--trace-amber)",
];

const TRANSIENT_SUPPORTED = new Set<ComponentKind>([
  "resistor",
  "capacitor",
  "inductor",
  "vsource",
  "isource",
  "vac",
  "iac",
  "opamp",
  "vcvs",
  "vccs",
  "cccs",
  "ccvs",
  "bsource",
  "switch",
  "testpoint",
  "ground",
]);

/** Tiny conductance added from every non-ground node to ground (SPICE gmin trick).
 *  Prevents singular matrices caused by floating nodes (e.g. unconnected op-amp rails). */
const GMIN = 1e-12;

/** Progress/cancellation hooks for a transient run (Fix 3 — no more frozen
 *  UI on a long solve). Both optional so every existing caller (production
 *  or test) that doesn't care about either keeps working unchanged, just
 *  now behind a `Promise` (the solve loop yields to the event loop
 *  periodically, so the function can no longer return synchronously). */
export interface TransientRunControl {
  /** Called with a fraction in [0, 1], monotonically non-decreasing, at each
   *  cooperative-yield checkpoint (see the loop below) — cheap and safe to
   *  call often; throttle on the receiving end (App.tsx) if needed. */
  onProgress?: (fraction: number) => void;
  /** Checked at each yield checkpoint. When aborted, the loop stops and the
   *  function resolves (never rejects) with a PARTIAL `ok: true` result built
   *  from whatever samples were already computed, plus a warning — abort is
   *  a normal user action (Stop button), not an error. */
  signal?: AbortSignal;
}

/** One macrotask yield so the browser can paint (progress bar) and deliver
 *  input (Stop button click) mid-solve. A microtask (`Promise.resolve().then`)
 *  would resume before the next paint and defeat the point; `setTimeout`
 *  works identically in the browser and in Node (tests). */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** How often the solve loop checks in with `onProgress`/`signal`: every 250
 *  steps, or every ~16ms of wall time if a single step is expensive enough
 *  that 250 of them would otherwise stall the UI thread noticeably longer
 *  than one frame. */
const YIELD_STEP_INTERVAL = 250;
const YIELD_TIME_INTERVAL_MS = 16;

export async function runTransientAnalysis(
  schematic: { components: SchematicComponent[]; wires: SchematicWire[]; netLabels?: NetLabel[]; params?: ParamScope; couplings?: CouplingSpec[] },
  options: AnalysisOptions,
  control?: TransientRunControl,
): Promise<AnalysisResult> {
  let circuit: ExtractedCircuit | undefined;
  try {
    // Resolve {param} expressions in component values before extraction so the
    // solver sees concrete numbers (LTspice substitutes braces the same way).
    const components = resolveComponentValues(schematic.components, schematic.params ?? EMPTY_SCOPE);
    circuit = extractCircuit(components, schematic.wires, schematic.netLabels ?? []);
    validateOptions(options);

    const resolution = inspectTransientResolution(components, options);
    validateTransientResolution(resolution, options);

    if (components.length === 0) {
      return fail("No circuit", "Place components before running analysis.", circuit);
    }
    const unsupported = components.filter((component) => !TRANSIENT_SUPPORTED.has(component.kind));
    if (unsupported.length > 0) {
      return fail(
        "Unsupported model",
        `${unsupported.map((component) => component.label || component.kind).join(", ")} ${unsupported.length === 1 ? "is" : "are"} placeable and wireable, but the interim solver only supports R/C/L, voltage/current sources, AC sine sources, switches, grounds, and test points. Full models need the planned ngspice engine.`,
        circuit,
      );
    }
    if (!circuit.groundNetId) {
      return fail("No reference", "Add a ground symbol so node voltages have a reference.", circuit);
    }
    if (!components.some((component) => ["vsource", "isource", "vac", "iac", "bsource"].includes(component.kind))) {
      return fail("No source", "Add a voltage or current source to excite the circuit. The interim solver requires an explicit independent source.", circuit);
    }

    const nonGroundNets = circuit.nets.filter((net) => !net.isGround);
    if (nonGroundNets.length === 0) {
      return fail("No signal nodes", "Connect at least one non-ground node.", circuit);
    }

    const nodeIndex = new Map(nonGroundNets.map((net, index) => [net.id, index]));
    // Behavioral expressions reference nodes by (sanitized net-label) name.
    const netByName = new Map<string, number>();
    nonGroundNets.forEach((net, index) => netByName.set(net.id.toLowerCase(), index));
    const voltageSources = circuit.components.filter(({ component }) => component.kind === "vsource" || component.kind === "vac");
    const inductors = circuit.components.filter(({ component }) => component.kind === "inductor");
    const opamps = circuit.components.filter(({ component }) => component.kind === "opamp");
    const vcvss = circuit.components.filter(({ component }) => component.kind === "vcvs");
    const cccss = circuit.components.filter(({ component }) => component.kind === "cccs");
    const ccvss = circuit.components.filter(({ component }) => component.kind === "ccvs");
    // Behavioral sources (B): linearize once (constant — we reject time-varying
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
        if (entry.component.kind === "capacitor") {
          capacitorVoltage.set(entry.component.id, parseQuantity(ic, "V"));
        } else if (entry.component.kind === "inductor") {
          inductorCurrent.set(entry.component.id, parseQuantity(ic, "A"));
        }
      } catch {
        /* unparseable IC token — ignore, start from 0 */
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

    // Set once the run is stopped early (Stop button / AbortSignal) — the
    // loop below breaks out and falls through to the same result-building
    // code as a completed run, just with fewer samples and a warning.
    let aborted = false;
    let lastYieldAt = Date.now();

    for (let step = 0; step <= options.steps; step += 1) {
      const time = step * stepSize;
      const matrix = zeroMatrix(size);
      const rhs = Array(size).fill(0) as number[];

      // SPICE gmin: when op-amps are present, add GMIN from every non-ground
      // node to ground so floating nodes (e.g. unconnected op-amp v+/v- rails)
      // resolve to ~0 V rather than making the matrix singular.
      // Applied only when op-amps are in the circuit to avoid masking genuine
      // floating-node errors in resistive/reactive-only circuits.
      if (opamps.length > 0) {
        for (let i = 0; i < nonGroundNets.length; i += 1) {
          matrix[i][i] += GMIN;
        }
      }

      for (const entry of circuit.components) {
        switch (entry.component.kind) {
          case "resistor":
            stampConductance(matrix, netIndex(entry.pins.a, nodeIndex), netIndex(entry.pins.b, nodeIndex), resistanceToConductance(entry));
            break;
          case "capacitor": {
            const capacitance = positiveValue(entry, "F");
            const conductance = capacitance / stepSize;
            const a = netIndex(entry.pins.a, nodeIndex);
            const b = netIndex(entry.pins.b, nodeIndex);
            const previousVoltage = capacitorVoltage.get(entry.component.id) ?? 0;
            stampConductance(matrix, a, b, conductance);
            stampCurrent(rhs, a, b, -conductance * previousVoltage);
            break;
          }
          case "vsource": {
            const sourceIndex = voltageSourceOffset + voltageSources.findIndex((source) => source.component.id === entry.component.id);
            const wave = sourceWaveforms.get(entry.component.id);
            stampVoltageSource(matrix, rhs, netIndex(entry.pins.p, nodeIndex), netIndex(entry.pins.n, nodeIndex), sourceIndex, wave ? wave.at(time) : parseQuantity(stripAcSpec(entry.component.value), "V"));
            break;
          }
          case "vac": {
            const sourceIndex = voltageSourceOffset + voltageSources.findIndex((source) => source.component.id === entry.component.id);
            stampVoltageSource(matrix, rhs, netIndex(entry.pins.p, nodeIndex), netIndex(entry.pins.n, nodeIndex), sourceIndex, signalValue(entry.component.value, "V", time));
            break;
          }
          case "isource": {
            // SPICE convention: positive value → current exits p into the external circuit.
            // Stamp from n to p so that rhs[p] += I (current injected into p).
            const wave = sourceWaveforms.get(entry.component.id);
            stampCurrent(rhs, netIndex(entry.pins.n, nodeIndex), netIndex(entry.pins.p, nodeIndex), wave ? wave.at(time) : parseQuantity(stripAcSpec(entry.component.value), "A"));
            break;
          }
          case "iac":
            // Same polarity convention as isource.
            stampCurrent(rhs, netIndex(entry.pins.n, nodeIndex), netIndex(entry.pins.p, nodeIndex), signalValue(entry.component.value, "A", time));
            break;
          case "inductor": {
            const inductorIndex = inductorOffset + inductors.findIndex((source) => source.component.id === entry.component.id);
            const inductance = positiveValue(entry, "H");
            const resistance = inductance / stepSize;
            stampInductor(
              matrix,
              rhs,
              netIndex(entry.pins.a, nodeIndex),
              netIndex(entry.pins.b, nodeIndex),
              inductorIndex,
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
            const ioIndex = opampOffset + opamps.findIndex((op) => op.component.id === entry.component.id);
            const outNode = netIndex(entry.pins["out"], nodeIndex);
            const inPlusNode = netIndex(entry.pins["in+"], nodeIndex);
            const inMinusNode = netIndex(entry.pins["in-"], nodeIndex);
            // Output current injection into out KCL row
            if (outNode >= 0) matrix[outNode][ioIndex] += 1;
            // Virtual-short constraint row: V(in+) - V(in-) = 0
            if (inPlusNode >= 0) matrix[ioIndex][inPlusNode] += 1;
            if (inMinusNode >= 0) matrix[ioIndex][inMinusNode] -= 1;
            // rhs[ioIndex] = 0 (already zero from initialisation)
            break;
          }
          case "vccs": {
            // VCCS (G): I(op→on) = gm·(V(cp) − V(cn)).
            const gm = parseQuantity(entry.component.value, "A/V");
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
            const gain = parseQuantity(entry.component.value, "V/V");
            const iIdx = vcvsOffset + vcvss.findIndex((e) => e.component.id === entry.component.id);
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
            const gain = parseQuantity(entry.component.value, "A/A");
            const senseIdx = cccsOffset + cccss.findIndex((f) => f.component.id === entry.component.id);
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
            const r = parseQuantity(entry.component.value, "V/A");
            const hi = ccvss.findIndex((h) => h.component.id === entry.component.id);
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
            const terms = resolveBehavioralTerms(model, entry.component.label, netByName);
            if (model.type === "V") {
              const branchIndex = bsourceOffset + vBsources.findIndex((b) => b.component.id === entry.component.id);
              stampLinearVSource(matrix, rhs, p, n, branchIndex, model.constant, terms);
            } else {
              stampLinearISource(matrix, rhs, p, n, model.constant, terms);
            }
            break;
          }
          case "switch":
            if (entry.component.value.trim().toLowerCase().startsWith("closed")) {
              stampConductance(matrix, netIndex(entry.pins.a, nodeIndex), netIndex(entry.pins.b, nodeIndex), 1e9);
            }
            break;
          case "testpoint":
          case "ground":
            break;
        }
      }

      // Mutual-inductance coupling (backward-Euler companion): the flux in one
      // winding adds (M/h)·(Iother − Iother_prev) to this winding's branch eq,
      // mirroring the self term L/h. Stamp the cross conductance + history rhs.
      for (const term of mutuals) {
        const ia = inductorOffset + term.a;
        const ib = inductorOffset + term.b;
        const r = term.m / stepSize;
        const iaPrev = inductorCurrent.get(inductors[term.a].component.id) ?? 0;
        const ibPrev = inductorCurrent.get(inductors[term.b].component.id) ?? 0;
        matrix[ia][ib] -= r;
        matrix[ib][ia] -= r;
        rhs[ia] -= r * ibPrev;
        rhs[ib] -= r * iaPrev;
      }

      const solution = solveLinearSystem(matrix, rhs);
      times.push(time);
      for (let i = 0; i < nonGroundNets.length; i += 1) traceValues[i].push(solution[i]);

      for (const entry of circuit.components) {
        const id = entry.component.id;
        const ref = entry.component.label;
        switch (entry.component.kind) {
          case "capacitor": {
            const now = voltageBetween(entry.pins.a, entry.pins.b, nodeIndex, solution);
            const prev = capacitorVoltage.get(id) ?? 0;
            capacitorVoltage.set(id, now);
            let c = 0;
            try { c = parseQuantity(entry.component.value, "F"); } catch { c = 0; }
            pushCurrent(id, ref, step === 0 || !(c > 0) ? 0 : (c * (now - prev)) / stepSize);
            break;
          }
          case "inductor": {
            const currentIndex = inductorOffset + inductors.findIndex((source) => source.component.id === id);
            inductorCurrent.set(id, solution[currentIndex]);
            pushCurrent(id, ref, solution[currentIndex]);
            break;
          }
          case "resistor": {
            let r = 0;
            try { r = parseQuantity(entry.component.value, "Ω"); } catch { r = 0; }
            if (r > 0) pushCurrent(id, ref, voltageBetween(entry.pins.a, entry.pins.b, nodeIndex, solution) / r);
            break;
          }
          case "vsource":
          case "vac": {
            const currentIndex = voltageSourceOffset + voltageSources.findIndex((source) => source.component.id === id);
            pushCurrent(id, ref, solution[currentIndex]);
            break;
          }
          case "isource": {
            const wave = sourceWaveforms.get(id);
            let a = 0;
            if (wave) a = wave.at(time);
            else { try { a = parseQuantity(stripAcSpec(entry.component.value), "A"); } catch { a = 0; } }
            pushCurrent(id, ref, a);
            break;
          }
          case "iac": {
            pushCurrent(id, ref, signalValue(entry.component.value, "A", time));
            break;
          }
          case "vcvs": {
            const currentIndex = vcvsOffset + vcvss.findIndex((e) => e.component.id === id);
            pushCurrent(id, ref, solution[currentIndex]);
            break;
          }
          case "vccs": {
            let gm = 0;
            try { gm = parseQuantity(entry.component.value, "A/V"); } catch { gm = 0; }
            const vctrl = voltageBetween(entry.pins.cp, entry.pins.cn, nodeIndex, solution);
            pushCurrent(id, ref, gm * vctrl);
            break;
          }
          case "cccs": {
            // Output current = gain·I_sense; the sense current is the branch unknown.
            let gain = 0;
            try { gain = parseQuantity(entry.component.value, "A/A"); } catch { gain = 0; }
            const senseIdx = cccsOffset + cccss.findIndex((f) => f.component.id === id);
            pushCurrent(id, ref, gain * solution[senseIdx]);
            break;
          }
          case "ccvs": {
            // Output branch current is the second of this device's two unknowns.
            const hi = ccvss.findIndex((h) => h.component.id === id);
            pushCurrent(id, ref, solution[ccvsOffset + hi * 2 + 1]);
            break;
          }
        }
      }

      // Cooperative yield: this step's samples are already fully committed
      // above (times/traceValues/currentSamples), so it's always safe to
      // stop right here — never mid-step. Checked by step count first (cheap)
      // before the `Date.now()` call so the fast-per-step-large-circuit case
      // isn't paying a clock read every single iteration.
      if (step % YIELD_STEP_INTERVAL === 0 || Date.now() - lastYieldAt >= YIELD_TIME_INTERVAL_MS) {
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
    // sample says, not the originally requested `options.stopTime` — the
    // stats/warning must describe what the user is actually looking at.
    const reachedStopTime = times.length > 0 ? times[times.length - 1] : 0;
    const warnings = aborted
      ? [
          ...circuit.warnings,
          `Stopped early at ${formatEngineering(reachedStopTime, "s", 2)} of ${formatEngineering(options.stopTime, "s", 2)}.`,
        ]
      : circuit.warnings;

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
  components: SchematicComponent[],
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

/** Dominant frequency a source imposes on transient sampling, or null when the
 *  component is not a source / is plain DC. May return NaN/negative for a
 *  malformed value — callers decide whether that is an error (the resolution
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

function signalValue(value: string, unit: "V" | "A", time: number): number {
  // SINE/PULSE/PWL/EXP/SFFM stimulus on an AC-symbol source: evaluate the
  // full time-domain waveform. Plain `amp freq` (legacy vac/iac form) keeps the
  // bare-sine interpretation below.
  if (isFunctionSource(value)) return parseTransientSource(value, unit).at(time);
  const source = parseSineSource(value, unit);
  return source.offset + source.amplitude * Math.sin(2 * Math.PI * source.frequency * time);
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

function stampConductance(matrix: number[][], a: number, b: number, conductance: number) {
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

function stampVoltageSource(
  matrix: number[][],
  rhs: number[],
  positive: number,
  negative: number,
  sourceIndex: number,
  voltage: number,
) {
  if (positive >= 0) {
    matrix[positive][sourceIndex] += 1;
    matrix[sourceIndex][positive] += 1;
  }
  if (negative >= 0) {
    matrix[negative][sourceIndex] -= 1;
    matrix[sourceIndex][negative] -= 1;
  }
  rhs[sourceIndex] += voltage;
}

/** Voltage-controlled current source: I(op→on) = gm·(V(cp) − V(cn)). */
function stampVCCS(matrix: number[][], op: number, on: number, cp: number, cn: number, gm: number) {
  if (op >= 0 && cp >= 0) matrix[op][cp] += gm;
  if (op >= 0 && cn >= 0) matrix[op][cn] -= gm;
  if (on >= 0 && cp >= 0) matrix[on][cp] -= gm;
  if (on >= 0 && cn >= 0) matrix[on][cn] += gm;
}

/** Voltage-controlled voltage source: V(op) − V(on) = gain·(V(cp) − V(cn)). */
function stampVCVS(matrix: number[][], op: number, on: number, cp: number, cn: number, branchIndex: number, gain: number) {
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
function stampLinearVSource(matrix: number[][], rhs: number[], p: number, n: number, branchIndex: number, constant: number, terms: BehavioralTerm[]) {
  stampVoltageSource(matrix, rhs, p, n, branchIndex, constant);
  for (const { index, coeff } of terms) {
    if (index >= 0) matrix[branchIndex][index] -= coeff;
  }
}

/** Linear behavioral I-source: I(p→n) = constant + Σ coeff·V(node). */
function stampLinearISource(matrix: number[][], rhs: number[], p: number, n: number, constant: number, terms: BehavioralTerm[]) {
  stampCurrent(rhs, p, n, constant);
  for (const { index, coeff } of terms) {
    stampVCCS(matrix, p, n, index, -1, coeff);
  }
}

/** Internal zero-volt control-sense source (cp→cn); `senseIdx` = I(cp→cn). */
function stampSenseBranch(matrix: number[][], cp: number, cn: number, senseIdx: number) {
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
function stampCCCS(matrix: number[][], op: number, on: number, cp: number, cn: number, senseIdx: number, gain: number) {
  stampSenseBranch(matrix, cp, cn, senseIdx);
  if (op >= 0) matrix[op][senseIdx] += gain;
  if (on >= 0) matrix[on][senseIdx] -= gain;
}

/** Current-controlled voltage source: V(op) − V(on) = r·I_sense(cp→cn). */
function stampCCVS(matrix: number[][], op: number, on: number, cp: number, cn: number, senseIdx: number, outIdx: number, r: number) {
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
  matrix: number[][],
  rhs: number[],
  a: number,
  b: number,
  inductorIndex: number,
  resistance: number,
  previousCurrent: number,
) {
  if (a >= 0) {
    matrix[a][inductorIndex] += 1;
    matrix[inductorIndex][a] += 1;
  }
  if (b >= 0) {
    matrix[b][inductorIndex] -= 1;
    matrix[inductorIndex][b] -= 1;
  }
  matrix[inductorIndex][inductorIndex] -= resistance;
  rhs[inductorIndex] -= resistance * previousCurrent;
}

function voltageBetween(
  aNet: string | undefined,
  bNet: string | undefined,
  nodeIndex: Map<string, number>,
  solution: number[],
): number {
  const a = netIndex(aNet, nodeIndex);
  const b = netIndex(bNet, nodeIndex);
  return (a >= 0 ? solution[a] : 0) - (b >= 0 ? solution[b] : 0);
}

function solveLinearSystem(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) {
      throw new Error("Matrix is singular. Check for floating nodes, voltage-source loops, or missing ground connections.");
    }
    if (pivot !== col) [a[pivot], a[col]] = [a[col], a[pivot]];

    const pivotValue = a[col][col];
    for (let item = col; item <= n; item += 1) a[col][item] /= pivotValue;

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (factor === 0) continue;
      for (let item = col; item <= n; item += 1) a[row][item] -= factor * a[col][item];
    }
  }

  return a.map((row) => row[n]);
}
