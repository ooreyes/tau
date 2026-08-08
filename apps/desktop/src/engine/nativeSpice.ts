import { invoke } from "@tauri-apps/api/core";
import { buildSpiceDeck, unresolvedSubcktMessage, type DeviceCurrent, type SpiceAnalysis } from "./spiceNetlist";
import type { NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";
import { resolveComponentValues, EMPTY_SCOPE, type ParamScope } from "../simulation/paramScope";
import { parseAcSpec } from "./acSpec";
import type { NoiseResult, NoiseSpec } from "../simulation/noise";
import type { AnalysisOptions, AnalysisResult, CurrentTrace, Trace } from "../simulation/linearTransient";
import { deriveAcRcCurrents, deriveDcRcBranches, deriveRcCurrents } from "../simulation/currents";
import type { DeviceOperatingPoint, OperatingPointResult } from "../simulation/operatingPoint";
import { hasAcExcitation, NO_AC_SOURCE_MESSAGE, type AcResult, type AcTrace } from "../simulation/acSweep";
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
import { parseNativeFourier, parseNativeMeasurements } from "../simulation/nativeMeasFour";
import {
  assembleNativeAnalysisFamily,
  assembleNativeStepFamily,
  canUseNativeStepPath,
  orderNativeStepPlots,
  type NativePlotVectors,
} from "../simulation/nativeStepFamily";
import type { StepSpec } from "../simulation/paramStep";
import type { StepFamilyResult } from "../simulation/stepFamily";
import type { AnalysisFamily } from "../simulation/stepAnalysisFamily";

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
   * curves here. A native `.step` deck leaves earlier step plots here. */
  extraPlots: NativePlot[];
  messages: string[];
  libraryPath: string;
}

type Schematic = { components: SchematicComponent[]; wires: SchematicWire[]; netLabels?: NetLabel[]; params?: ParamScope; directives?: string[]; userModelLibraries?: readonly string[]; userModelLibraryNames?: readonly string[] };
type NativeExecution = { result: NativeSpiceResult; deck: ReturnType<typeof buildSpiceDeck> };

/**
 * Highest output-point count the UI will request of ngspice.
 *
 * This is a request, not a promise about the result: `.tran` takes the count as
 * an output-step hint and ngspice saves its own timepoints, adding a breakpoint
 * at every source discontinuity, so a run asks for 2,000,000 points and comes
 * back with 2,000,014. Rust's transfer guard resamples anything past its
 * ceiling instead of refusing it, which is what keeps a long transient - a 60 s
 * thermal or soft-start run is ordinary - from being thrown away over a handful
 * of extra samples.
 */
export const MAX_NATIVE_OUTPUT_POINTS = 2_000_000;

/** Rotation order is load-bearing, not cosmetic - see DESIGN_SYSTEM.md §1.5.
 * These hues only clear the adjacent-pair checks in this exact sequence: olive
 * (cream) beside green fails the normal-vision floor, and vermillion (red)
 * beside olive collapses under deuteranopia. This list must stay identical to
 * the one in `simulation/linearTransient.ts`; `styles/palette.test.ts` reads
 * both and fails if they drift apart or out of order. */
const TRACE_COLORS = [
  "var(--trace-green)",
  "var(--trace-red)",
  "var(--trace-cyan)",
  "var(--trace-cream)",
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
  const converted = transientFromNativePlot(
    { name: execution.result.plot, vectors: execution.result.vectors },
    execution.deck,
    schematic,
    options,
    execution.result.messages,
    { requireOk: true, title: "ngspice transient" },
  );
  // P1.6: prefer ngspice's own `.meas` / `.four` printout when the deck
  // carried those cards. Empty means the UI keeps the TS runners.
  const nativeMeasurements = parseNativeMeasurements(execution.result.messages);
  const nativeFourier = parseNativeFourier(execution.result.messages);
  if (!converted.ok) return converted;
  return {
    ...converted,
    ...(nativeMeasurements.length > 0 ? { nativeMeasurements } : {}),
    ...(nativeFourier.length > 0 ? { nativeFourier } : {}),
  };
}

/**
 * Single-deck native `.step` (P1.6): emit `.step` once, consume every returned
 * plot as a family member. Mutually exclusive with the TypeScript re-run loop
 * — that path must keep `emitNativeStep` off. Source, param, and temp kinds are
 * eligible (Rust expands the unimplemented ngspice `.step` card). Unsupported
 * param brace shapes return null so the caller keeps the TS path. Returns null
 * outside the Tauri runtime.
 */
export async function runNativeSteppedTransient(
  schematic: Schematic,
  options: AnalysisOptions,
  specs: readonly StepSpec[],
): Promise<StepFamilyResult | null> {
  if (!isNativeSpiceRuntime()) return null;
  if (!canUseNativeStepPath(specs, { components: schematic.components })) return null;

  const execution = await executeNative(
    schematic,
    { kind: "tran", ...options },
    { emitNativeStep: true },
  );
  if (!execution) return null;

  const ordered = orderNativeStepPlots(
    { name: execution.result.plot, vectors: execution.result.vectors },
    execution.result.extraPlots,
  );
  const familyWarnings = [...execution.deck.circuit.warnings, ...engineWarnings(execution.result.messages)];
  return assembleNativeStepFamily(ordered, specs, (plot, label, value) => ({
    label,
    value,
    result: transientFromNativePlot(plot, execution.deck, schematic, options, [], {
      requireOk: false,
      title: `ngspice transient (${label})`,
      warnings: familyWarnings,
    }),
  }));
}

/**
 * Convert one ngspice plot's vectors into a Tau transient result. Shared by the
 * single-run and native-step multi-plot paths so stepped members are not a
 * parallel, inventable converter.
 */
function transientFromNativePlot(
  plot: NativePlotVectors,
  deck: NativeExecution["deck"],
  schematic: Schematic,
  options: AnalysisOptions,
  messages: readonly string[],
  meta: { requireOk: boolean; title: string; warnings?: string[] },
): AnalysisResult {
  const lookup = (name: string) => vectorIn(plot.vectors, name);
  const time = lookup("time");
  if (!time || time.real.length < 2) {
    const detail = messages
      .map((message) => message.trim())
      .filter(Boolean)
      .slice(-4)
      .join(" ");
    const message = detail
      ? `ngspice could not start the transient analysis: ${detail}`
      : `ngspice step plot “${plot.name}” returned no time samples.`;
    if (meta.requireOk) throw new Error(message);
    return { ok: false, title: meta.title, message, warnings: meta.warnings ?? [] };
  }

  const traces: Trace[] = deck.circuit.nets
    .filter((net) => !net.isGround)
    .flatMap((net, index) => {
      const values = lookup(`v(${net.id})`)?.real;
      if (!values || values.length !== time.real.length) return [];
      return [{
        id: net.id,
        label: `V(${friendlyNetName(net)})`,
        unit: "V" as const,
        color: TRACE_COLORS[index % TRACE_COLORS.length],
        values,
      }];
    });

  if (traces.length === 0) {
    const message = meta.requireOk
      ? "ngspice completed, but returned no node-voltage traces."
      : `ngspice step plot “${plot.name}” returned no node-voltage traces.`;
    if (meta.requireOk) throw new Error(message);
    return { ok: false, title: meta.title, message, warnings: meta.warnings ?? [] };
  }

  // Branch currents: voltage-source and inductor currents are the ones ngspice
  // returns on its own, as `<ref>#branch`. Resistor and capacitor currents are
  // derived from the node voltages below. A semiconductor has neither - its own
  // current comes back only under the `@<ref>[<param>]` name the deck asked for
  // in its `.save` card, so it is looked up through the deck's own record of
  // what it asked for.
  const nodeVoltages = new Map<string, number[]>(traces.map((t) => [t.id, t.values]));
  const deviceCurrents = primaryDeviceCurrents(deck.deviceCurrents);
  const currents: CurrentTrace[] = [];
  const seen = new Set<string>();
  for (const { component } of deck.circuit.components) {
    const ref = component.label;
    if (!ref || seen.has(ref.toLowerCase())) continue;
    const branch = componentCurrentVectorFrom(plot.vectors, deviceCurrents.get(component.id), ref)?.real;
    if (branch && branch.length === time.real.length) {
      currents.push({ ref, label: `I(${ref})`, values: branch });
      seen.add(ref.toLowerCase());
      // A part that reports more than one terminal contributes an extra trace
      // per terminal under the SAME ref-des, so `seen` cannot gate them and
      // they are appended here rather than in the dedupe loop above. Values go
      // in unflipped, like the primary: ngspice gives the current INTO each
      // terminal, so a BJT's three sum to zero and `Ie(Q1)` reads negative for
      // a forward-active NPN.
      for (const extra of deck.deviceCurrents) {
        if (extra.componentId !== component.id || !extra.terminal) continue;
        const values = lookup(extra.vector)?.real;
        if (!values || values.length !== time.real.length) continue;
        currents.push({ ref, label: `I${extra.terminal}(${ref})`, values, terminal: extra.terminal });
      }
    }
  }
  for (const derived of deriveRcCurrents(deck.circuit.components, nodeVoltages, time.real)) {
    if (seen.has(derived.ref.toLowerCase())) continue;
    currents.push(derived);
    seen.add(derived.ref.toLowerCase());
  }

  const stopTime = time.real[time.real.length - 1] ?? options.stopTime;
  // ngspice picks its own timestep, so the returned samples are not on a
  // uniform grid and the first interval is not the step: a `.tran 10u 2m` run
  // opens with a 10 ps step while it finds the solution. The average interval
  // describes the samples that actually came back, and equals the requested
  // step when the grid is uniform.
  const span = stopTime - (time.real[0] ?? 0);
  return {
    ok: true,
    title: meta.title,
    times: time.real,
    traces,
    currents,
    stats: {
      netCount: deck.circuit.nets.length,
      componentCount: schematic.components.length,
      sampleCount: time.real.length,
      stopTime,
      stepSize: time.real.length > 1 ? span / (time.real.length - 1) : stopTime,
    },
    warnings: meta.warnings ?? [...deck.circuit.warnings, ...engineWarnings([...messages])],
    circuit: deck.circuit,
  };
}

/**
 * `deviceVector` is the `@<ref>[<param>]` name the deck saved for this component,
 * absent for anything that is not a primitive semiconductor. It is tried first
 * because it is the only name the deck explicitly asked ngspice to keep; the
 * `#branch` form is what sources and inductors get for free.
 */
/**
 * The one vector per component that a bare `I(ref)` means, indexed by component
 * id. Terminal currents share their component id, so building this over the
 * whole list would let the LAST entry - a BJT's emitter - answer for the part.
 */
function primaryDeviceCurrents(deviceCurrents: ReadonlyArray<DeviceCurrent>): Map<string, string> {
  return new Map(deviceCurrents.filter((d) => !d.terminal).map((d) => [d.componentId, d.vector]));
}

function componentCurrentVector(
  result: NativeSpiceResult,
  deviceVector: string | undefined,
  ref: string,
): NativeVector | undefined {
  return componentCurrentVectorFrom(result.vectors, deviceVector, ref);
}

function componentCurrentVectorFrom(
  vectors: ReadonlyArray<NativeVector>,
  deviceVector: string | undefined,
  ref: string,
): NativeVector | undefined {
  const candidates = deviceVector ? [deviceVector, `${ref}#branch`] : [`${ref}#branch`, `i(${ref})`];
  for (const candidate of candidates) {
    const found = vectorIn(vectors, candidate);
    if (found) return found;
  }
  return undefined;
}

function deviceRegion(
  component: SchematicComponent,
  parameters: ReadonlyMap<string, number>,
  current: number | undefined,
): DeviceOperatingPoint["region"] {
  if (component.kind === "diode" || component.kind === "led" || component.kind === "zener") {
    return Math.abs(current ?? 0) > 1e-12 ? "conducting" : "cutoff";
  }
  if (component.kind === "npn" || component.kind === "pnp") {
    const polarity = component.kind === "pnp" ? -1 : 1;
    const beForward = polarity * (parameters.get("VBE") ?? 0) > 0.45;
    const bcForward = polarity * (parameters.get("VBC") ?? 0) > 0.45;
    if (beForward && bcForward) return "saturation";
    if (beForward) return "forward-active";
    if (bcForward) return "reverse-active";
    return "cutoff";
  }
  if (["nmos", "pmos", "njf", "pjf"].includes(component.kind)) {
    const gm = Math.abs(parameters.get("GM") ?? 0);
    if (Math.abs(current ?? 0) <= 1e-15 && gm <= 1e-15) return "cutoff";
    const vds = parameters.get("VDS");
    const vdsat = parameters.get("VDSAT");
    if (vds === undefined || vdsat === undefined) return undefined;
    return Math.abs(vds) >= Math.abs(vdsat) ? "saturation" : "linear";
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

  // Branch currents, read through the same helper the transient path uses so
  // the two cannot drift. The values are ngspice's own, UNFLIPPED: its
  // `#branch` on an `.op` run is already the raw MNA unknown that the TS
  // solver's own `branches` contract specifies (see `OperatingPointResult` in
  // simulation/operatingPoint.ts) - the NEGATIVE of the conventional current
  // out of a source's + terminal - so no sign flip belongs here, and the two
  // engines report a source current the same way round. A semiconductor's
  // own current is present at all only because this deck named it in its
  // `.save` card (see `wantsDeviceCurrents` in spiceNetlist.ts).
  const deviceCurrents = primaryDeviceCurrents(execution.deck.deviceCurrents);
  const branches: { id: string; label: string; current: number; terminal?: string }[] = [];
  const seen = new Set<string>();
  for (const { component } of execution.deck.circuit.components) {
    const ref = component.label;
    if (!ref || seen.has(ref.toLowerCase())) continue;
    const found = componentCurrentVector(execution.result, deviceCurrents.get(component.id), ref);
    const current = found?.real[0];
    if (Number.isFinite(current)) {
      // `id` is the SchematicComponent id, not the ref-des: opAnnotations.ts
      // locates a branch's component with `circuit.components.find((c) =>
      // c.component.id === branch.id)`, so a ref-des here would silently
      // render zero canvas current labels.
      branches.push({ id: component.id, label: `I(${ref})`, current: current as number });
      seen.add(ref.toLowerCase());
      // A part reporting several terminals adds one entry per terminal under
      // the SAME component id and ref-des, so `seen` cannot gate them. Values
      // go in unflipped like the primary: ngspice gives the current INTO each
      // terminal, so a BJT's three sum to zero and `Ie(Q1)` reads negative for
      // a forward-active NPN. `id` is no longer unique across the list - see
      // `primaryBranches` for the consumers that need one entry per part.
      for (const extra of execution.deck.deviceCurrents) {
        if (extra.componentId !== component.id || !extra.terminal) continue;
        const value = vector(execution.result, extra.vector)?.real[0];
        if (!Number.isFinite(value)) continue;
        branches.push({
          id: component.id,
          label: `I${extra.terminal}(${ref})`,
          current: value as number,
          terminal: extra.terminal,
        });
      }
    }
  }

  // ngspice gives a resistor or a capacitor no vector of its own, so their DC
  // currents are reconstructed here from the node voltages - the same thing the
  // transient path does with `deriveRcCurrents`, through the same oriented pin
  // order, so the two report a passive the same way round. Ground reads as an
  // explicit 0 V rather than as a missing node, since a missing one skips its
  // element.
  const voltageByNet = new Map(nonGroundNets.map((net) => [net.id, net.voltage]));
  for (const net of execution.deck.circuit.nets) if (net.isGround) voltageByNet.set(net.id, 0);
  for (const { ref, ...derived } of deriveDcRcBranches(execution.deck.circuit.components, voltageByNet)) {
    if (seen.has(ref.toLowerCase())) continue;
    branches.push(derived);
    seen.add(ref.toLowerCase());
  }

  const primaryCurrentById = new Map(
    branches.filter((branch) => !branch.terminal).map((branch) => [branch.id, branch.current]),
  );
  const parameterRecords = new Map<string, DeviceOperatingPoint["parameters"]>();
  for (const saved of execution.deck.deviceOperatingPoints) {
    const value = vector(execution.result, saved.vector)?.real[0];
    if (!Number.isFinite(value)) continue;
    const records = parameterRecords.get(saved.componentId) ?? [];
    records.push({ name: saved.name, value: value as number, unit: saved.unit });
    parameterRecords.set(saved.componentId, records);
  }
  const devices: DeviceOperatingPoint[] = [];
  for (const { component } of execution.deck.circuit.components) {
    const parameters = parameterRecords.get(component.id);
    if (!parameters || parameters.length === 0) continue;
    const values = new Map(parameters.map((parameter) => [parameter.name, parameter.value]));
    devices.push({
      id: component.id,
      label: component.label,
      region: deviceRegion(component, values, primaryCurrentById.get(component.id)),
      parameters,
    });
  }

  return {
    ok: true,
    nets,
    ...(branches.length > 0 ? { branches } : {}),
    ...(devices.length > 0 ? { devices } : {}),
    warnings: [...execution.deck.circuit.warnings, ...engineWarnings(execution.result.messages)],
  };
}

/**
 * ngspice names the AC scale `frequency`, and returns it as a complex vector
 * whose imaginary part is all zeros - so the axis is its real part, never its
 * magnitude.
 */
export const AC_SCALE_NAME = "frequency";

/** Reported for a node whose response is exactly zero, where dB is undefined. */
export const AC_DB_FLOOR = -300;

/**
 * Turns one complex node vector into the magnitude/phase pair the Bode plot
 * draws. ngspice hands back the phasor itself, not its polar form, so both
 * conventions are Tau's to choose and both are checked against the engine:
 *
 * - dB is `20*log10(|v|)`, a voltage ratio, which agrees with ngspice's own
 *   `vdb()` to the printed digits.
 * - phase is in DEGREES. ngspice's `vp()` / `ph()` default to RADIANS, so the
 *   engine's own phase column agrees with this one only after conversion.
 *
 * `imaginary` is absent when ngspice returns a real vector where a complex one
 * was expected; treating that as zero quadrature keeps the magnitude honest
 * rather than dropping the trace.
 */
export function acTraceFromComplex(
  real: readonly number[],
  imaginary: readonly number[] | null,
): { magDb: number[]; phaseDeg: number[] } {
  return {
    magDb: real.map((value, index) => {
      const magnitude = Math.hypot(value, imaginary?.[index] ?? 0);
      return magnitude > 0 ? 20 * Math.log10(magnitude) : AC_DB_FLOOR;
    }),
    phaseDeg: real.map((value, index) => Math.atan2(imaginary?.[index] ?? 0, value) * (180 / Math.PI)),
  };
}

export async function runNativeAcSweep(
  schematic: Schematic,
  options: { startHz: number; stopHz: number; pointsPerDecade: number },
): Promise<AcResult | null> {
  if (!isNativeSpiceRuntime()) return null;

  // An unexcited AC sweep is not an error to ngspice: it solves the circuit,
  // reports no warning, and returns every node as exactly 0 + 0j. That would
  // reach the plot as a flat trace at the dB floor, which reads as an answer.
  // The preview solver already refuses it, so refuse here too, with its wording.
  const resolved = resolveComponentValues(schematic.components, schematic.params ?? EMPTY_SCOPE);
  if (!hasAcExcitation(resolved)) {
    return { ok: false, message: NO_AC_SOURCE_MESSAGE, warnings: [] };
  }

  const execution = await executeNative(schematic, { kind: "ac", ...options });
  if (!execution) return null;
  const converted = acFromNativePlot(
    { name: execution.result.plot, vectors: execution.result.vectors },
    execution.deck,
    execution.result.messages,
    { requireOk: true },
  );
  const nativeMeasurements = parseNativeMeasurements(execution.result.messages);
  if (!converted.ok) return converted;
  return {
    ...converted,
    ...(nativeMeasurements.length > 0 ? { nativeMeasurements } : {}),
  };
}

/**
 * Single-deck native `.step` for AC (P1.6): one emit, multi-plot Bode family.
 * Mutually exclusive with `runAcStepFamily` (that path never sets
 * `emitNativeStep`). Returns null outside Tauri or when the step kind is
 * ineligible so the caller keeps the TypeScript re-run path.
 */
export async function runNativeSteppedAcSweep(
  schematic: Schematic,
  options: { startHz: number; stopHz: number; pointsPerDecade: number },
  specs: readonly StepSpec[],
): Promise<AnalysisFamily<AcResult> | null> {
  if (!isNativeSpiceRuntime()) return null;
  if (!canUseNativeStepPath(specs, { components: schematic.components })) return null;

  const resolved = resolveComponentValues(schematic.components, schematic.params ?? EMPTY_SCOPE);
  if (!hasAcExcitation(resolved)) {
    return { ok: false, message: NO_AC_SOURCE_MESSAGE, members: [], warnings: [] };
  }

  const execution = await executeNative(
    schematic,
    { kind: "ac", ...options },
    { emitNativeStep: true },
  );
  if (!execution) return null;

  const ordered = orderNativeStepPlots(
    { name: execution.result.plot, vectors: execution.result.vectors },
    execution.result.extraPlots,
  );
  const familyWarnings = [...execution.deck.circuit.warnings, ...engineWarnings(execution.result.messages)];
  return assembleNativeAnalysisFamily(ordered, specs, (plot, label, value) => ({
    label,
    value,
    result: acFromNativePlot(plot, execution.deck, [], {
      requireOk: false,
      warnings: familyWarnings,
    }),
  }));
}

/** Convert one ngspice AC plot into a Tau Bode result (shared by single + step). */
function acFromNativePlot(
  plot: NativePlotVectors,
  deck: NativeExecution["deck"],
  messages: readonly string[],
  meta: { requireOk: boolean; warnings?: string[] },
): AcResult {
  const lookup = (name: string) => vectorIn(plot.vectors, name);
  const frequency = lookup(AC_SCALE_NAME);
  if (!frequency || frequency.real.length < 2) {
    const detail = messages
      .map((message) => message.trim())
      .filter(Boolean)
      .slice(-4)
      .join(" ");
    const message = detail
      ? `ngspice could not start the AC analysis: ${detail}`
      : `ngspice step plot “${plot.name}” returned no AC frequency vector.`;
    if (meta.requireOk) throw new Error(message);
    return { ok: false, message, warnings: meta.warnings ?? [] };
  }

  const nodeTraces: AcTrace[] = deck.circuit.nets
    .filter((net) => !net.isGround)
    .flatMap((net) => {
      const values = lookup(`v(${net.id})`);
      if (!values || values.real.length !== frequency.real.length) return [];
      return [{
        id: net.id,
        label: `V(${friendlyNetName(net)})`,
        ...acTraceFromComplex(values.real, values.imaginary),
      }];
    });

  if (nodeTraces.length === 0) {
    const message = meta.requireOk
      ? "ngspice completed, but returned no AC node-voltage traces."
      : `ngspice step plot “${plot.name}” returned no AC node-voltage traces.`;
    if (meta.requireOk) throw new Error(message);
    return { ok: false, message, warnings: meta.warnings ?? [] };
  }

  const count = frequency.real.length;
  const nodePhasors = new Map<string, { real: number[]; imaginary: number[] }>();
  for (const net of deck.circuit.nets) {
    if (net.isGround) {
      nodePhasors.set(net.id, { real: new Array(count).fill(0), imaginary: new Array(count).fill(0) });
      continue;
    }
    const values = lookup(`v(${net.id})`);
    if (!values || values.real.length !== count) continue;
    nodePhasors.set(net.id, { real: values.real, imaginary: values.imaginary ?? new Array(count).fill(0) });
  }

  const traces = [...nodeTraces];
  const primary = primaryDeviceCurrents(deck.deviceCurrents);
  const seen = new Set<string>();
  for (const { component } of deck.circuit.components) {
    const ref = component.label;
    if (!ref || seen.has(ref.toLowerCase())) continue;
    let values = componentCurrentVectorFrom(plot.vectors, primary.get(component.id), ref);
    if (!values && (component.kind === "isource" || component.kind === "iac")) {
      const stimulus = parseAcSpec(component.value);
      const magnitude = stimulus?.mag ?? 0;
      const radians = ((stimulus?.phase ?? 0) * Math.PI) / 180;
      values = {
        name: `i(${ref})`,
        real: new Array(count).fill(magnitude * Math.cos(radians)),
        imaginary: new Array(count).fill(magnitude * Math.sin(radians)),
      };
    }
    if (!values || values.real.length !== count) continue;
    traces.push({
      id: `current:${component.id}`,
      label: `I(${ref})`,
      ...acTraceFromComplex(values.real, values.imaginary),
    });
    seen.add(ref.toLowerCase());
    for (const extra of deck.deviceCurrents) {
      if (extra.componentId !== component.id || !extra.terminal) continue;
      const terminal = lookup(extra.vector);
      if (!terminal || terminal.real.length !== count) continue;
      traces.push({
        id: `current:${component.id}:${extra.terminal}`,
        label: `I${extra.terminal}(${ref})`,
        ...acTraceFromComplex(terminal.real, terminal.imaginary),
      });
    }
  }
  for (const derived of deriveAcRcCurrents(deck.circuit.components, nodePhasors, frequency.real)) {
    if (seen.has(derived.ref.toLowerCase())) continue;
    traces.push({
      id: `current:${derived.id}`,
      label: derived.label,
      ...acTraceFromComplex(derived.real, derived.imaginary),
    });
    seen.add(derived.ref.toLowerCase());
  }

  return {
    ok: true,
    freqs: frequency.real,
    traces,
    warnings: meta.warnings ?? [...deck.circuit.warnings, ...engineWarnings([...messages])],
  };
}

/**
 * ngspice names the DC scale for the swept source's type, not its refdes:
 * `v-sweep` for a voltage source, `i-sweep` for a current source.
 */
export const DC_SWEEP_SCALE = /^[vi]-sweep$/i;

/**
 * Splits a `.dc` sweep axis into its inner legs. The inner leg restarts when
 * the axis returns to its first value. A single-source sweep never does, giving
 * one leg of the full length; an inner sweep pinned to a single point repeats
 * immediately, giving legs of one - both fall out of the same rule.
 */
export function splitDcSweepLegs(axis: number[]): { sweep: number[]; legLength: number; legCount: number } {
  const repeat = axis.findIndex((value, index) => index > 0 && value === axis[0]);
  const legLength = repeat > 0 ? repeat : axis.length;
  return { sweep: axis.slice(0, legLength), legLength, legCount: Math.floor(axis.length / legLength) };
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

  const resolved = resolveDcSweepAxes(schematic, spec);
  const execution = await executeNative(schematic, { kind: "dc", ...spec });
  if (!execution) return null;

  const converted = dcFromNativePlot(
    { name: execution.result.plot, vectors: execution.result.vectors },
    execution.deck,
    resolved,
    execution.result.messages,
    { requireOk: true },
  );
  const nativeMeasurements = parseNativeMeasurements(execution.result.messages);
  if (!converted.ok) return converted;
  return {
    ...converted,
    ...(nativeMeasurements.length > 0 ? { nativeMeasurements } : {}),
  };
}

/**
 * Single-deck native `.step` for DC (P1.6): one emit, multi-plot transfer
 * family. Mutually exclusive with `runDcStepFamily`. Returns null outside
 * Tauri or when the step kind is ineligible.
 */
export async function runNativeSteppedDcSweep(
  schematic: Schematic,
  spec: DcSweepSpec,
  specs: readonly StepSpec[],
): Promise<AnalysisFamily<DcSweepResult> | null> {
  if (!isNativeSpiceRuntime()) return null;
  if (!canUseNativeStepPath(specs, { components: schematic.components })) return null;

  const resolved = resolveDcSweepAxes(schematic, spec);
  const execution = await executeNative(
    schematic,
    { kind: "dc", ...spec },
    { emitNativeStep: true },
  );
  if (!execution) return null;

  const ordered = orderNativeStepPlots(
    { name: execution.result.plot, vectors: execution.result.vectors },
    execution.result.extraPlots,
  );
  const familyWarnings = [...execution.deck.circuit.warnings, ...engineWarnings(execution.result.messages)];
  return assembleNativeAnalysisFamily(ordered, specs, (plot, label, value) => ({
    label,
    value,
    result: dcFromNativePlot(plot, execution.deck, resolved, [], {
      requireOk: false,
      warnings: familyWarnings,
    }),
  }));
}

type ResolvedDcAxes = {
  innerLabel: string;
  outer: SchematicComponent | null;
  outerValues: number[];
};

/** Validate + resolve `.dc` axes before a native round trip (shared by single/step). */
function resolveDcSweepAxes(schematic: Schematic, spec: DcSweepSpec): ResolvedDcAxes {
  const inner = findSource(schematic, spec.source);
  if (typeof inner === "string") throw new Error(inner);
  sweepValues(spec, MAX_POINTS);
  let outer: SchematicComponent | null = null;
  let outerValues: number[] = [];
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
  return { innerLabel: inner.label, outer, outerValues };
}

function dcFromNativePlot(
  plot: NativePlotVectors,
  deck: NativeExecution["deck"],
  axes: ResolvedDcAxes,
  messages: readonly string[],
  meta: { requireOk: boolean; warnings?: string[] },
): DcSweepResult {
  const scale = plot.vectors.find((candidate) => DC_SWEEP_SCALE.test(candidate.name.trim()));
  if (!scale || scale.real.length === 0) {
    const detail = messages
      .map((message) => message.trim())
      .filter(Boolean)
      .slice(-4)
      .join(" ");
    const message = detail
      ? `ngspice could not start the DC sweep: ${detail}`
      : `ngspice step plot “${plot.name}” returned no DC sweep axis.`;
    if (meta.requireOk) throw new Error(message);
    return { ok: false, message, warnings: meta.warnings ?? [] };
  }

  const { sweep, legLength, legCount } = splitDcSweepLegs(scale.real);
  const lookup = (name: string) => vectorIn(plot.vectors, name);
  const series = deck.circuit.nets
    .filter((net) => !net.isGround)
    .flatMap((net) => {
      const values = lookup(`v(${net.id})`);
      if (!values || values.real.length !== scale.real.length) return [];
      return [{ id: net.id, label: `V(${friendlyNetName(net)})`, values: values.real }];
    });
  if (series.length === 0) {
    const message = meta.requireOk
      ? "ngspice completed, but returned no DC node-voltage traces."
      : `ngspice step plot “${plot.name}” returned no DC node-voltage traces.`;
    if (meta.requireOk) throw new Error(message);
    return { ok: false, message, warnings: meta.warnings ?? [] };
  }

  const warnings = meta.warnings ?? [...deck.circuit.warnings, ...engineWarnings([...messages])];
  const { innerLabel, outer, outerValues } = axes;

  if (!outer) {
    const nets: DcSweepNet[] = [
      { id: "0", label: "GND", voltages: sweep.map(() => 0), ground: true },
      ...series.map((net) => ({ id: net.id, label: net.label, voltages: net.values, ground: false })),
    ];
    return { ok: true, source: innerLabel, sweep, nets, warnings };
  }

  const fanned: DcSweepNet[] = [];
  for (let leg = 0; leg < legCount; leg += 1) {
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
  return { ok: true, source: innerLabel, sweep, nets: fanned, warnings };
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

async function executeNative(
  schematic: Schematic,
  analysis: SpiceAnalysis,
  deckOptions: Parameters<typeof buildSpiceDeck>[2] = {},
): Promise<NativeExecution | null> {
  if (!isNativeSpiceRuntime()) return null;
  const deck = buildSpiceDeck(schematic, analysis, deckOptions);
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
  return vectorIn(result.vectors, name);
}

function vectorIn(vectors: ReadonlyArray<NativeVector>, name: string): NativeVector | undefined {
  const normalized = nodeVectorName(name);
  return vectors.find((candidate) => nodeVectorName(candidate.name) === normalized);
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
