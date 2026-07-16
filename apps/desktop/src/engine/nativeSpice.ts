import { invoke } from "@tauri-apps/api/core";
import { buildSpiceDeck, type SpiceAnalysis } from "./spiceNetlist";
import type { NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";
import type { ParamScope } from "../simulation/paramScope";
import type { AnalysisOptions, AnalysisResult, CurrentTrace, Trace } from "../simulation/linearTransient";
import { deriveRcCurrents } from "../simulation/currents";
import type { OperatingPointResult } from "../simulation/operatingPoint";
import type { AcResult, AcTrace } from "../simulation/acSweep";

interface NativeVector {
  name: string;
  real: number[];
  imaginary: number[] | null;
}

interface NativeSpiceResult {
  plot: string;
  vectors: NativeVector[];
  messages: string[];
  libraryPath: string;
}

type Schematic = { components: SchematicComponent[]; wires: SchematicWire[]; netLabels?: NetLabel[]; params?: ParamScope; directives?: string[] };
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

/**
 * Runs a transient analysis via ngspice through Tauri's `invoke` IPC — a
 * single request/response round trip to a Rust-spawned ngspice subprocess,
 * not a streamed/cancellable call. Unlike `runTransientAnalysis` (the web TS
 * solver, Fix 3), this has no progress channel and no abort path: `invoke`
 * doesn't support incremental callbacks, and there is no supported way to
 * interrupt an in-flight ngspice subprocess from here without risking a
 * corrupted/partial write on its side — so this deliberately does NOT
 * attempt to kill the process on Stop. App.tsx's `executeTransient` reflects
 * this by leaving `runProgress` at `null` (indeterminate bar) for the whole
 * call, and a Stop click while this is in flight just lets the eventual
 * result arrive and get discarded as stale (see `transientAbortRef` there).
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

async function executeNative(schematic: Schematic, analysis: SpiceAnalysis): Promise<NativeExecution | null> {
  if (!isNativeSpiceRuntime()) return null;
  const deck = buildSpiceDeck(schematic, analysis);
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
  return messages.filter((message) => /warn|singular|converg|error/i.test(message)).slice(0, 8);
}
