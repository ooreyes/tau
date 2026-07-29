import { invoke } from "@tauri-apps/api/core";
import { buildSpiceDeck, unresolvedSubcktMessage, type SpiceAnalysis } from "./spiceNetlist";
import type { NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";
import { resolveComponentValues, EMPTY_SCOPE, type ParamScope } from "../simulation/paramScope";
import { parseAcSpec } from "./acSpec";
import type { NoiseResult, NoiseSpec } from "../simulation/noise";
import type { AnalysisOptions, AnalysisResult, CurrentTrace, Trace } from "../simulation/linearTransient";
import { deriveRcCurrents } from "../simulation/currents";
import type { OperatingPointResult } from "../simulation/operatingPoint";
import type { AcResult, AcTrace } from "../simulation/acSweep";
import {
  MAX_OUTER_POINTS,
  MAX_POINTS,
  findSource,
  formatSweepValue,
  sweepValues,
  type DcSweepNet,
  type DcSweepResult,
  type DcSweepSpec,
} from "../simulation/dcSweep";
import { formatOutput, unitFor, type TfResult, type TfSpec } from "../simulation/transferFunction";

interface NativeVector {
  name: string;
  real: number[];
  imaginary: number[] | null;
}

interface NativePlot {
  name: string;
  vectors: NativeVector[];
}

interface NativeSpiceResult {
  plot: string;
  vectors: NativeVector[];
  /** Plots the run made besides the current one, which stays in `vectors`. A
   * `.noise` run leaves its integrated totals current and its spectral density
   * curves here. */
  extraPlots: NativePlot[];
  messages: string[];
  libraryPath: string;
}

type Schematic = { components: SchematicComponent[]; wires: SchematicWire[]; netLabels?: NetLabel[]; params?: ParamScope; directives?: string[]; userModelLibraries?: readonly string[]; userModelLibraryNames?: readonly string[] };
type NativeExecution = { result: NativeSpiceResult; deck: ReturnType<typeof buildSpiceDeck> };

/** Keeps a single high-resolution result below Rust's transfer guard. */
export const MAX_NATIVE_OUTPUT_POINTS = 2_000_000;

const TRACE_COLORS = [
  "var(--trace-cyan)",
  "var(--trace-green)",
  "var(--trace-cream)",
  "var(--trace-red)",
  "var(--trace-purple)",
  "var(--trace-amber)",
];

/** `invoke` is available only inside a Tauri webview. Browser development keeps
 * the small TypeScript solvers as an explicit fallback, never as desktop fake. */
export function isNativeSpiceRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Requests termination of the currently isolated native worker, if any. */
export async function cancelNativeSpice(): Promise<boolean> {
  if (!isNativeSpiceRuntime()) return false;
  return invoke<boolean>("cancel_spice");
}

/**
 * Runs a transient analysis via ngspice through Tauri's `invoke` IPC - a
 * single request/response round trip to a Rust-spawned ngspice worker. The
 * worker has bounded IPC, a hard timeout, and can be terminated through
 * `cancelNativeSpice`; progress stays indeterminate because ngspice does not
 * expose a stable per-analysis completion fraction.
 */
export async function runNativeTransient(
  schematic: Schematic,
  options: AnalysisOptions,
): Promise<AnalysisResult | null> {
  const execution = await executeNative(schematic, { kind: "tran", ...options });
  if (!execution) return null;
  const time = vector(execution.result, "time");
  if (!time || time.real.length < 2) {
    const detail = execution.result.messages
      .map((message) => message.trim())
      .filter(Boolean)
      .slice(-4)
      .join(" ");
    throw new Error(detail
      ? `ngspice could not start the transient analysis: ${detail}`
      : "ngspice could not start the transient analysis and returned no time samples.");
  }

  const traces: Trace[] = execution.deck.circuit.nets
    .filter((net) => !net.isGround)
    .flatMap((net, index) => {
      const values = vector(execution.result, `v(${net.id})`)?.real;
      if (!values || values.length !== time.real.length) return [];
      return [{
        id: net.id,
        label: `V(${friendlyNetName(net)})`,
        unit: "V" as const,
        color: TRACE_COLORS[index % TRACE_COLORS.length],
        values,
      }];
    });

  if (traces.length === 0) throw new Error("ngspice completed, but returned no node-voltage traces.");

  // Branch currents: voltage-source/inductor currents normally arrive as
  // `<ref>#branch`. Some ngspice decks also retain a two-terminal
  // semiconductor's explicit `@ref[id]` device vector; preserve it when it is
  // present instead of leaving that component's telemetry blank. Resistor and
  // capacitor currents are derived from the node voltages below.
  const nodeVoltages = new Map<string, number[]>(traces.map((t) => [t.id, t.values]));
  const currents: CurrentTrace[] = [];
  const seen = new Set<string>();
  for (const { component } of execution.deck.circuit.components) {
    const ref = component.label;
    if (!ref || seen.has(ref.toLowerCase())) continue;
    const branch = componentCurrentVector(execution.result, component.kind, ref)?.real;
    if (branch && branch.length === time.real.length) {
      currents.push({ ref, label: `I(${ref})`, values: branch });
      seen.add(ref.toLowerCase());
    }
  }
  for (const derived of deriveRcCurrents(execution.deck.circuit.components, nodeVoltages, time.real)) {
    if (seen.has(derived.ref.toLowerCase())) continue;
    currents.push(derived);
    seen.add(derived.ref.toLowerCase());
  }

  const stopTime = time.real[time.real.length - 1] ?? options.stopTime;
  return {
    ok: true,
    title: "ngspice transient",
    times: time.real,
    traces,
    currents,
    stats: {
      netCount: execution.deck.circuit.nets.length,
      componentCount: schematic.components.length,
      sampleCount: time.real.length,
      stopTime,
      stepSize: time.real.length > 1 ? (time.real[1] - time.real[0]) : stopTime,
    },
    warnings: [...execution.deck.circuit.warnings, ...engineWarnings(execution.result.messages)],
    circuit: execution.deck.circuit,
  };
}

function componentCurrentVector(
  result: NativeSpiceResult,
  kind: SchematicComponent["kind"],
  ref: string,
): NativeVector | undefined {
  const candidates = [`${ref}#branch`, `i(${ref})`];
  if (kind === "diode" || kind === "led" || kind === "zener") {
    candidates.push(`@${ref}[id]`);
  }
  for (const candidate of candidates) {
    const found = vector(result, candidate);
    if (found) return found;
  }
  return undefined;
}

export async function runNativeOperatingPoint(schematic: Schematic): Promise<OperatingPointResult | null> {
  const execution = await executeNative(schematic, { kind: "op" });
  if (!execution) return null;
  const nonGroundNets = execution.deck.circuit.nets
    .filter((net) => !net.isGround)
    .flatMap((net) => {
      const voltage = vector(execution.result, `v(${net.id})`)?.real[0];
      return Number.isFinite(voltage) ? [{ id: net.id, label: `V(${friendlyNetName(net)})`, voltage: voltage as number }] : [];
    });
  if (nonGroundNets.length === 0) throw new Error("ngspice completed, but returned no operating-point voltages.");
  // Prepend the ground net at 0 V, matching the TS solver's OperatingPointResult shape.
  const nets = [{ id: "0", label: "GND", voltage: 0 }, ...nonGroundNets];
  return { ok: true, nets, warnings: [...execution.deck.circuit.warnings, ...engineWarnings(execution.result.messages)] };
}

export async function runNativeAcSweep(
  schematic: Schematic,
  options: { startHz: number; stopHz: number; pointsPerDecade: number },
): Promise<AcResult | null> {
  const execution = await executeNative(schematic, { kind: "ac", ...options });
  if (!execution) return null;
  const frequency = vector(execution.result, "frequency");
  if (!frequency || frequency.real.length < 2) throw new Error("ngspice returned no AC frequency vector.");

  const traces: AcTrace[] = execution.deck.circuit.nets
    .filter((net) => !net.isGround)
    .flatMap((net) => {
      const values = vector(execution.result, `v(${net.id})`);
      if (!values || values.real.length !== frequency.real.length) return [];
      const imag = values.imaginary ?? Array(values.real.length).fill(0);
      return [{
        id: net.id,
        label: `V(${friendlyNetName(net)})`,
        magDb: values.real.map((real, index) => {
          const magnitude = Math.hypot(real, imag[index] ?? 0);
          return magnitude > 0 ? 20 * Math.log10(magnitude) : -300;
        }),
        phaseDeg: values.real.map((real, index) => Math.atan2(imag[index] ?? 0, real) * (180 / Math.PI)),
      }];
    });

  if (traces.length === 0) throw new Error("ngspice completed, but returned no AC node-voltage traces.");
  return { ok: true, freqs: frequency.real, traces, warnings: [...execution.deck.circuit.warnings, ...engineWarnings(execution.result.messages)] };
}

/**
 * Runs a DC transfer sweep on ngspice. The TypeScript solver behind
 * `runDcSweep` re-solves an operating point per step and has no semiconductor
 * stamps, so it refuses every transistor - this is the only path on which a
 * MOSFET or BJT transfer curve can be swept at all.
 *
 * ngspice returns a nested sweep as one flat inner-major run: with three inner
 * and three outer points the vectors are nine long and the sweep axis reads
 * 0,1,2,0,1,2,0,1,2. The legs are split back apart here so the result matches
 * the shape the plot already draws for the TypeScript solver.
 */
export async function runNativeDcSweep(
  schematic: Schematic,
  spec: DcSweepSpec,
): Promise<DcSweepResult | null> {
  if (!isNativeSpiceRuntime()) return null;

  // Validate the sweep spec before paying a native round trip: ngspice reports
  // an unknown sweep source as a generic parse failure the user cannot act on,
  // and its own point count is unbounded, so the TS solver's caps are applied
  // here too rather than letting a nested sweep fan out into thousands of curves.
  const inner = findSource(schematic, spec.source);
  if (typeof inner === "string") throw new Error(inner);
  sweepValues(spec, MAX_POINTS);
  let outer: SchematicComponent | null = null;
  let outerValues: number[] = [];
  // Exactly the condition the deck emits a second sweep on, so the runner and
  // `analysisLine` can never disagree about whether a run is nested.
  const source2 = spec.source2?.trim();
  if (
    source2
    && Number.isFinite(spec.start2)
    && Number.isFinite(spec.stop2)
    && Number.isFinite(spec.step2)
    && spec.step2 !== 0
  ) {
    const found = findSource(schematic, source2);
    if (typeof found === "string") throw new Error(found);
    if (found.id === inner.id) throw new Error("DC sweep inner and outer sources must differ.");
    outer = found;
    outerValues = sweepValues(
      { source: source2, start: spec.start2!, stop: spec.stop2!, step: spec.step2! },
      MAX_OUTER_POINTS,
    );
  }

  const execution = await executeNative(schematic, { kind: "dc", ...spec });
  if (!execution) return null;

  // ngspice names the DC scale for the swept source's type, not its refdes:
  // `v-sweep` for a voltage source, `i-sweep` for a current source.
  const scale = execution.result.vectors.find((candidate) => /^[vi]-sweep$/i.test(candidate.name.trim()));
  if (!scale || scale.real.length === 0) throw new Error("ngspice completed, but returned no DC sweep axis.");

  // The inner leg restarts when the axis returns to its first value. A
  // single-source sweep never does, giving one leg of the full length; an
  // inner sweep pinned to a single point repeats immediately, giving legs of
  // one - both fall out of the same rule.
  const repeat = scale.real.findIndex((value, index) => index > 0 && value === scale.real[0]);
  const legLength = repeat > 0 ? repeat : scale.real.length;
  const sweep = scale.real.slice(0, legLength);
  const legCount = Math.floor(scale.real.length / legLength);

  const series = execution.deck.circuit.nets
    .filter((net) => !net.isGround)
    .flatMap((net) => {
      const values = vector(execution.result, `v(${net.id})`);
      if (!values || values.real.length !== scale.real.length) return [];
      return [{ id: net.id, label: `V(${friendlyNetName(net)})`, values: values.real }];
    });
  if (series.length === 0) throw new Error("ngspice completed, but returned no DC node-voltage traces.");

  const warnings = [...execution.deck.circuit.warnings, ...engineWarnings(execution.result.messages)];

  if (!outer) {
    // Ground rides along at 0 V so the shape matches the TS solver, which
    // carries it through from the operating point; the plot hides it.
    const nets: DcSweepNet[] = [
      { id: "0", label: "GND", voltages: sweep.map(() => 0), ground: true },
      ...series.map((net) => ({ id: net.id, label: net.label, voltages: net.values, ground: false })),
    ];
    return { ok: true, source: inner.label, sweep, nets, warnings };
  }

  const fanned: DcSweepNet[] = [];
  for (let leg = 0; leg < legCount; leg += 1) {
    // Label from the outer values Tau computed, which is the same arithmetic
    // ngspice sweeps with. If the two ever disagree on leg count, fall back to
    // the leg's ordinal rather than captioning a curve with the wrong value.
    const value = outerValues[leg];
    const caption = value === undefined
      ? `${outer.label} leg ${leg + 1}`
      : `${outer.label}=${formatSweepValue(value)}`;
    const key = value === undefined ? `leg${leg + 1}` : `${outer.label}=${formatSweepValue(value)}`;
    for (const net of series) {
      fanned.push({
        id: `${net.id}@${key}`,
        label: `${net.label} (${caption})`,
        voltages: net.values.slice(leg * legLength, (leg + 1) * legLength),
        ground: false,
      });
    }
  }
  return { ok: true, source: inner.label, sweep, nets: fanned, warnings };
}

/** Independent-source kinds usable as a `.tf` or `.noise` stimulus, matching
 *  the TS solvers. */
const INDEPENDENT_SOURCE_KINDS = new Set<SchematicComponent["kind"]>(["vsource", "isource", "vac", "iac"]);

/**
 * How ngspice's three `.tf` scalars are recognised, against a lower-cased
 * vector name. It spells the port into two of the names - the output
 * impedance is `output_impedance_at_V(out)` for a node output but
 * `<device>#Output_impedance` for a branch-current one - so they are matched
 * by shape. `scripts/tfNative.corpus.ts` checks these against the names a real
 * ngspice run produces.
 */
export const TF_VECTOR_MATCHERS = {
  gain: (name: string) => name === "transfer_function",
  inputImpedance: (name: string) => name.endsWith("#input_impedance"),
  outputImpedance: (name: string) =>
    name.startsWith("output_impedance_at_") || name.endsWith("#output_impedance"),
};

/**
 * Runs a small-signal transfer function on ngspice. The TypeScript solver
 * behind `runTransferFunction` derives gain and the two impedances from
 * repeated operating-point solves, which have no semiconductor stamps, so it
 * refuses every transistor - on an amplifier this is the only path that
 * produces a transfer function at all.
 *
 * ngspice returns the three results as scalars in a `Transfer Function` plot.
 * Their names carry the port in them (`output_impedance_at_V(out)`,
 * `v1#Input_impedance`), so they are matched by shape rather than spelled out.
 */
export async function runNativeTransferFunction(
  schematic: Schematic,
  spec: TfSpec,
): Promise<TfResult | null> {
  if (!isNativeSpiceRuntime()) return null;

  // Resolve the port against the schematic before paying a native round trip:
  // ngspice reports an unknown node or source as a generic parse failure, and
  // the TS solver's wording for these is what the panel already shows.
  const input = schematic.components.find(
    (component) => component.label.toLowerCase() === spec.source.toLowerCase(),
  );
  if (!input) return { ok: false, message: `.tf source "${spec.source}" not found in the circuit.`, warnings: [] };
  if (!INDEPENDENT_SOURCE_KINDS.has(input.kind)) {
    return {
      ok: false,
      message: `.tf source "${spec.source}" is a ${input.kind}, not an independent source.`,
      warnings: [],
    };
  }

  // Node names in the deck are net ids; resolve the user's name against a
  // throwaway `.op` deck, whose net extraction does not depend on the analysis.
  let output: Extract<SpiceAnalysis, { kind: "tf" }>["output"];
  if (spec.output.kind === "current") {
    const device = spec.output.device;
    if (!schematic.components.some((component) => component.label.toLowerCase() === device.toLowerCase())) {
      return { ok: false, message: `.tf output I(${device}) is not a device in the circuit.`, warnings: [] };
    }
    output = { kind: "current", device };
  } else {
    const nets = buildSpiceDeck(schematic, { kind: "op" }).circuit.nets;
    const node = deckNodeFor(nets, spec.output.pos);
    if (node === undefined) {
      return {
        ok: false,
        message: `.tf output node "${spec.output.pos}" not found. Label the net (e.g. add a "${spec.output.pos}" net label).`,
        warnings: [],
      };
    }
    let refNode: string | undefined;
    if (spec.output.neg !== undefined) {
      refNode = deckNodeFor(nets, spec.output.neg);
      if (refNode === undefined) {
        return { ok: false, message: `.tf output node "${spec.output.neg}" not found.`, warnings: [] };
      }
    }
    output = { kind: "voltage", node, refNode };
  }

  const execution = await executeNative(schematic, { kind: "tf", output, source: input.label });
  if (!execution) return null;

  const warnings = [...execution.deck.circuit.warnings, ...engineWarnings(execution.result.messages)];
  const scalar = (match: (name: string) => boolean): number | undefined => {
    const found = execution.result.vectors.find((candidate) => match(candidate.name.trim().toLowerCase()));
    return found?.real[0];
  };

  const gain = scalar(TF_VECTOR_MATCHERS.gain);
  if (gain === undefined || !Number.isFinite(gain)) {
    throw new Error("ngspice completed, but returned no transfer function.");
  }
  const inputImpedance = scalar(TF_VECTOR_MATCHERS.inputImpedance);
  const outputImpedance = scalar(TF_VECTOR_MATCHERS.outputImpedance);
  if (outputImpedance === undefined) {
    warnings.push("Output impedance for an I(...) output is not reported.");
  }

  return {
    ok: true,
    spec,
    gain,
    gainLabel: `${formatOutput(spec.output)}/${input.label}`,
    gainUnit: unitFor(spec.output.kind, input.kind === "vsource" || input.kind === "vac"),
    // An input impedance ngspice did not return reads as open, matching what
    // the TS solver reports for a port it draws no current from - never as a
    // plausible zero.
    inputImpedance: inputImpedance ?? Infinity,
    outputImpedance: outputImpedance ?? NaN,
    warnings,
  };
}

/**
 * How ngspice names a `.noise` run's results. The run answers across two
 * plots: the two integrated totals are left current, while the spectral
 * density curves and their own frequency scale are a separate plot that
 * `ngSpice_CurPlot` cannot reach - they arrive in `extraPlots`.
 * `scripts/noiseNative.corpus.ts` checks these names against a real run.
 */
export const NOISE_VECTOR_NAMES = {
  outputTotal: "onoise_total",
  inputTotal: "inoise_total",
  outputSpectrum: "onoise_spectrum",
  inputSpectrum: "inoise_spectrum",
  scale: "frequency",
} as const;

/**
 * Runs a small-signal noise analysis on ngspice. The TypeScript solver behind
 * `runNoiseAnalysis` models resistor thermal noise only and refuses every
 * circuit holding a semiconductor, so on anything with a transistor, diode or
 * vendor macromodel in it this is the only path that produces noise numbers at
 * all - and the only one that includes a device's own shot and flicker noise.
 */
export async function runNativeNoise(
  schematic: Schematic,
  spec: NoiseSpec,
): Promise<NoiseResult | null> {
  if (!isNativeSpiceRuntime()) return null;

  // Resolve the port before paying a native round trip, for the same reason as
  // `.tf`: ngspice reports an unknown node or source as a generic parse
  // failure, and the TS solver's wording is what the panel already shows.
  const input = schematic.components.find(
    (component) => component.label.toLowerCase() === spec.source.toLowerCase(),
  );
  if (!input) {
    return { ok: false, message: `.noise input source "${spec.source}" not found in the circuit.`, warnings: [] };
  }
  if (!INDEPENDENT_SOURCE_KINDS.has(input.kind)) {
    return {
      ok: false,
      message: `.noise input "${spec.source}" is a ${input.kind}, not an independent source.`,
      warnings: [],
    };
  }

  // ngspice refers the output noise back to the input through that source's AC
  // stimulus, and a source carrying none aborts the entire run ("noise input
  // source has no AC value") - no plots, no partial answer. Catch it here so
  // the panel can name the fix rather than report an empty result.
  const [resolvedInput] = resolveComponentValues([input], schematic.params ?? EMPTY_SCOPE);
  if (!parseAcSpec(resolvedInput?.value ?? input.value)) {
    return {
      ok: false,
      message: `.noise input source "${spec.source}" has no AC amplitude, so the input-referred noise has nothing to refer to. Add one to its value (for example "AC 1").`,
      warnings: [],
    };
  }

  // Node names in the deck are net ids; resolve the user's names against a
  // throwaway `.op` deck, whose net extraction does not depend on the analysis.
  const nets = buildSpiceDeck(schematic, { kind: "op" }).circuit.nets;
  const node = deckNodeFor(nets, spec.output.pos);
  if (node === undefined) {
    return {
      ok: false,
      message: `.noise output node "${spec.output.pos}" not found. Label the net (e.g. add a "${spec.output.pos}" net label).`,
      warnings: [],
    };
  }
  let refNode: string | undefined;
  if (spec.output.neg !== undefined) {
    refNode = deckNodeFor(nets, spec.output.neg);
    if (refNode === undefined) {
      return { ok: false, message: `.noise output node "${spec.output.neg}" not found.`, warnings: [] };
    }
  }

  const execution = await executeNative(schematic, {
    kind: "noise",
    output: { node, refNode },
    source: input.label,
    ...spec.sweep,
  });
  if (!execution) return null;

  const named = (vectors: NativeVector[], name: string): NativeVector | undefined =>
    vectors.find((candidate) => candidate.name.trim().toLowerCase() === name);

  // The spectral density curves live in the secondary plot, so a read of the
  // current plot alone would find nothing to draw.
  const spectrum = execution.result.extraPlots.find(
    (plot) => named(plot.vectors, NOISE_VECTOR_NAMES.outputSpectrum) !== undefined,
  );
  const freqs = spectrum ? named(spectrum.vectors, NOISE_VECTOR_NAMES.scale)?.real : undefined;
  const onoise = spectrum ? named(spectrum.vectors, NOISE_VECTOR_NAMES.outputSpectrum)?.real : undefined;
  const inoise = spectrum ? named(spectrum.vectors, NOISE_VECTOR_NAMES.inputSpectrum)?.real : undefined;
  // Both curves share the one frequency scale, so a short read of either would
  // draw a trace against the wrong axis rather than a shorter one.
  if (
    !freqs || !onoise || !inoise || freqs.length === 0
    || onoise.length !== freqs.length || inoise.length !== freqs.length
  ) {
    throw new Error("ngspice completed, but returned no noise spectral density curves.");
  }

  // The integrated totals are the current plot, not the spectrum one.
  const totalOutputNoise = named(execution.result.vectors, NOISE_VECTOR_NAMES.outputTotal)?.real[0];
  const totalInputNoise = named(execution.result.vectors, NOISE_VECTOR_NAMES.inputTotal)?.real[0];
  if (totalOutputNoise === undefined || totalInputNoise === undefined) {
    throw new Error("ngspice completed, but returned no integrated noise totals.");
  }

  const inputIsVoltage = input.kind === "vsource" || input.kind === "vac";
  return {
    ok: true,
    spec,
    freqs,
    onoise,
    inoise,
    inoiseUnit: inputIsVoltage ? "V/√Hz" : "A/√Hz",
    totalOutputNoise,
    totalInputNoise,
    warnings: [...execution.deck.circuit.warnings, ...engineWarnings(execution.result.messages)],
  };
}

/** The deck node name for a user-facing net name, or undefined when unknown. */
function deckNodeFor(
  nets: readonly { id: string; isGround: boolean }[],
  name: string,
): string | undefined {
  const lower = name.trim().toLowerCase();
  if (lower === "0" || lower === "gnd" || lower === "ground") return "0";
  const net = nets.find((candidate) => candidate.id.toLowerCase() === lower);
  if (!net) return undefined;
  return net.isGround ? "0" : net.id.toLowerCase();
}

async function executeNative(schematic: Schematic, analysis: SpiceAnalysis): Promise<NativeExecution | null> {
  if (!isNativeSpiceRuntime()) return null;
  const deck = buildSpiceDeck(schematic, analysis);
  // A subcircuit reference with no resolvable definition would make ngspice
  // reject the deck with a cryptic native error. We know the exact missing
  // name(s) here, so fail fast with actionable copy instead of paying a native
  // round trip for an error the user cannot act on.
  if (deck.unresolvedSubckts.length > 0) {
    throw new Error(unresolvedSubcktMessage(deck.unresolvedSubckts));
  }
  const result = await invoke<NativeSpiceResult>("simulate_spice", { request: { netlist: deck.netlist } });
  return { result, deck };
}

function vector(result: NativeSpiceResult, name: string): NativeVector | undefined {
  const normalized = nodeVectorName(name);
  return result.vectors.find((candidate) => nodeVectorName(candidate.name) === normalized);
}

function nodeVectorName(name: string): string {
  const normalized = name.toLowerCase().replace(/\s+/g, "");
  const voltageMatch = normalized.match(/^v\((.+)\)$/);
  return voltageMatch?.[1] ?? normalized;
}

function friendlyNetName(net: { id: string; pins: { componentLabel: string }[] }): string {
  const labels = [...new Set(net.pins.map((pin) => pin.componentLabel).filter(Boolean))];
  return labels.length > 0 ? labels.slice(0, 2).join(".") : net.id;
}

function engineWarnings(messages: string[]): string[] {
  const cleaned = messages
    .filter((message) => /warn|singular|converg|error/i.test(message))
    .map((message) => {
      const withoutStream = message.replace(/^\s*(?:stdout|stderr)\s*/i, "").trim();
      const missingIc = /warning\s*:\s*ic on non-existent node\s*-\s*([^,\s]+),?\s*ignored/i.exec(withoutStream);
      if (missingIc) return `Ignored initial voltage for missing node “${missingIc[1]}”.`;
      return withoutStream.replace(/^warning\s*:\s*/i, "").trim();
    })
    .filter(Boolean);
  return [...new Set(cleaned)].slice(0, 8);
}
