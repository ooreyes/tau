/**
 * Pure circuit-context assembly for the AI assistant column. Turns whatever
 * App.tsx already has in memory (schematic, directives, latest transient
 * result, per-component telemetry) into one compact text block the assistant
 * grounds its answers in. Built fresh at send time — not kept live — so it
 * always reflects exactly the circuit the user is asking about right now.
 */
import type { NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";
import type { ParamScope } from "../simulation/paramScope";
import type { AnalysisResult } from "../simulation/linearTransient";
import type { ComponentMeasurement } from "../simulation/measurementModel";
import type { MeasResult } from "../simulation/measure";
import { buildSpiceDeck } from "../engine/spiceNetlist";
import { formatEngineering } from "../simulation/quantity";
import { primaryReading } from "../components/ComponentMeasurementsPanel";

export interface AssistantContextInput {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels: NetLabel[];
  directives: string[];
  params: ParamScope;
  /** Latest transient result, or null if nothing has been run yet. */
  analysis: AnalysisResult | null;
  componentRows: readonly ComponentMeasurement[];
  measurements?: readonly MeasResult[];
  selectedId: string | null;
}

export interface AssistantContext {
  text: string;
  /** True if the context was cut down to fit the overall cap. */
  truncated: boolean;
}

// ~4000 chars keeps the per-turn context cheap while still holding a small-
// to-medium netlist in full; NETLIST_CAP gives the deck itself a generous
// slice of that budget before the whole-context backstop below ever bites.
const CONTEXT_CHAR_CAP = 4000;
const NETLIST_CHAR_CAP = 2000;

/** Nominal `.tran` line for a context-only deck build — the actual stop
 *  time/steps don't matter here (nothing is simulated), so a real result's
 *  numbers are preferred when available, purely for a more representative
 *  netlist header. */
const FALLBACK_TRAN = { stopTime: 0.006, steps: 240 };

function truncateMiddle(text: string, cap: number): string {
  if (text.length <= cap) return text;
  const omitted = text.length - cap;
  const head = Math.ceil(cap * 0.6);
  const tail = cap - head;
  return `${text.slice(0, head)}\n… [netlist truncated — ${omitted} chars omitted] …\n${text.slice(text.length - tail)}`;
}

function buildNetlistSection(input: AssistantContextInput): string {
  try {
    const { stopTime, steps } = input.analysis?.ok
      ? { stopTime: input.analysis.stats.stopTime, steps: input.analysis.stats.sampleCount }
      : FALLBACK_TRAN;
    const deck = buildSpiceDeck(
      { components: input.components, wires: input.wires, netLabels: input.netLabels, params: input.params, directives: input.directives },
      { kind: "tran", stopTime, steps },
    );
    return `SPICE netlist:\n${truncateMiddle(deck.netlist.trim(), NETLIST_CHAR_CAP)}`;
  } catch (error) {
    return `Netlist unavailable: ${error instanceof Error ? error.message : "could not build a netlist from this circuit."}`;
  }
}

function componentLine(component: SchematicComponent, row: ComponentMeasurement | undefined): string {
  const bits = [
    `${component.label || component.id} (${component.kind})`,
    component.value ? `= ${component.value}` : null,
  ];
  if (row?.voltage) bits.push(`V=${formatEngineering(primaryReading(row.voltage).value, "V", 3)}`);
  if (row?.current) bits.push(`I=${formatEngineering(primaryReading(row.current).value, "A", 3)}`);
  if (row?.power) bits.push(`P=${formatEngineering(primaryReading(row.power).value, "W", 3)}`);
  return bits.filter((bit): bit is string => Boolean(bit)).join(" ");
}

function buildComponentSection(input: AssistantContextInput): string {
  const placed = input.components.filter((c) => c.kind !== "ground" && c.label);
  if (placed.length === 0) return "Components: none placed.";
  const rowsById = new Map(input.componentRows.map((row) => [row.componentId, row]));
  const lines = placed.map((component) => componentLine(component, rowsById.get(component.id)));
  return `Components (${placed.length}):\n${lines.join("\n")}`;
}

function buildAnalysisSection(input: AssistantContextInput): string {
  const { analysis } = input;
  if (!analysis) return "Analysis: no simulation has been run yet.";
  if (!analysis.ok) return `Analysis: last transient run failed — ${analysis.message}`;

  const { stats, warnings } = analysis;
  const lines = [
    `Analysis: transient, ${stats.sampleCount.toLocaleString()} samples over `
    + `${formatEngineering(stats.stopTime, "s", 3)}, ${stats.netCount} nets, `
    + `${stats.componentCount} components.`,
  ];
  if (warnings.length > 0) lines.push(`Warnings: ${warnings.join("; ")}`);
  if (input.measurements && input.measurements.length > 0) {
    const measLines = input.measurements.map((m) => (
      m.value !== null ? `${m.name} = ${formatEngineering(m.value, "", 4)}` : `${m.name} = undetermined${m.error ? ` (${m.error})` : ""}`
    ));
    lines.push(`Measurements (.meas):\n${measLines.join("\n")}`);
  }
  return lines.join("\n");
}

function buildSelectionSection(input: AssistantContextInput): string {
  const component = input.selectedId ? input.components.find((c) => c.id === input.selectedId) : null;
  return component ? `Selection: ${component.label || component.id} (${component.kind}).` : "Selection: none.";
}

export function buildAssistantContext(input: AssistantContextInput): AssistantContext {
  const sections = [
    buildNetlistSection(input),
    buildComponentSection(input),
    buildAnalysisSection(input),
    buildSelectionSection(input),
  ];
  const text = sections.join("\n\n");
  if (text.length <= CONTEXT_CHAR_CAP) return { text, truncated: false };
  // Backstop beyond the netlist's own middle-truncation (e.g. a very long
  // component list) — keep the head (netlist + components, what most
  // questions actually need) and note the cut rather than silently dropping it.
  const omitted = text.length - CONTEXT_CHAR_CAP;
  return { text: `${text.slice(0, CONTEXT_CHAR_CAP)}\n… [context truncated — ${omitted} chars omitted]`, truncated: true };
}
