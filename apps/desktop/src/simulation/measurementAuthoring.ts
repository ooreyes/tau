import type { NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";
import { extractCircuit } from "../schematic/netlist";
import { parseMeasDirective, type AggregateKind, type MeasAnalysis } from "./measure";

export type EditableMeasurementCalculation = AggregateKind | "PARAM";
export type EditableMeasurementQuantity =
  | "node-voltage"
  | "component-current"
  | "component-power"
  | "component-power-delivered"
  | "formula";

export interface EditableMeasurement {
  id: string;
  name: string;
  analysis: Exclude<MeasAnalysis, null | "op" | "tf">;
  calculation: EditableMeasurementCalculation;
  quantity: EditableMeasurementQuantity;
  target: string;
  formula: string;
  from: string;
  to: string;
  originalLine?: string;
  originalFingerprint?: string;
}

export interface MeasurementAuthoringContext {
  nodeNames: string[];
  currentRefs: string[];
  sourcePowerRefs: string[];
  powerExpressionByRef: Map<string, string>;
}

const SIGNAL_VOLTAGE_RE = /^V\(\s*([^,()]+)\s*\)$/i;
const SIGNAL_CURRENT_RE = /^I\(\s*([^,()]+)\s*\)$/i;
const MEASUREMENT_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.$]*$/;
const TERMINAL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["a", "b"],
  ["a", "k"],
  ["p", "n"],
  ["op", "on"],
  ["d", "s"],
  ["c", "e"],
  ["out", "com"],
  ["q", "com"],
];

function numericField(value: number | null): string {
  return value === null ? "" : String(value);
}

export function measurementFingerprint(row: EditableMeasurement): string {
  return JSON.stringify({
    name: row.name.trim(),
    analysis: row.analysis,
    calculation: row.calculation,
    quantity: row.quantity,
    target: row.target.trim(),
    formula: row.formula.trim(),
    from: row.from.trim(),
    to: row.to.trim(),
  });
}

/** Decode the aggregate and derived-result forms Tau can represent with named
 * controls. Timing/crossing forms remain untouched in Expert directives until
 * their dedicated UI lands. */
export function editableMeasurementFromDirective(line: string, id: string): EditableMeasurement | null {
  const spec = parseMeasDirective(line);
  if (!spec || (spec.kind !== "aggregate" && spec.kind !== "param")) return null;
  if (spec.analysis === "op" || spec.analysis === "tf") return null;

  const analysis = spec.analysis ?? "tran";
  let quantity: EditableMeasurementQuantity = "formula";
  let target = "";
  let formula = spec.expr;
  if (spec.kind === "aggregate") {
    const voltage = SIGNAL_VOLTAGE_RE.exec(spec.expr);
    const current = SIGNAL_CURRENT_RE.exec(spec.expr);
    if (voltage) {
      quantity = "node-voltage";
      target = voltage[1].trim();
      formula = "";
    } else if (current) {
      quantity = "component-current";
      target = current[1].trim();
      formula = "";
    }
  }

  const row: EditableMeasurement = {
    id,
    name: spec.name,
    analysis,
    calculation: spec.kind === "param" ? "PARAM" : spec.op,
    quantity,
    target,
    formula,
    from: spec.kind === "aggregate" ? numericField(spec.from) : "",
    to: spec.kind === "aggregate" ? numericField(spec.to) : "",
    originalLine: line,
  };
  row.originalFingerprint = measurementFingerprint(row);
  return row;
}

export function blankEditableMeasurement(id: string): EditableMeasurement {
  return {
    id,
    name: "measurement",
    analysis: "tran",
    calculation: "AVG",
    quantity: "node-voltage",
    target: "",
    formula: "",
    from: "",
    to: "",
  };
}

function componentPowerExpression(
  ref: string,
  pins: Record<string, string>,
): string | null {
  for (const [positivePin, negativePin] of TERMINAL_PAIRS) {
    const positiveNet = pins[positivePin];
    const negativeNet = pins[negativePin];
    if (!positiveNet || !negativeNet) continue;
    const voltage = negativeNet === "0" ? `V(${positiveNet})` : `V(${positiveNet},${negativeNet})`;
    return `${voltage}*I(${ref})`;
  }
  return null;
}

/** Derive the exact node and component choices from the schematic, including
 * generated net ids when a wire has no label. */
export function measurementAuthoringContext(
  components: SchematicComponent[],
  wires: SchematicWire[],
  netLabels: NetLabel[],
): MeasurementAuthoringContext {
  const circuit = extractCircuit(components, wires, netLabels);
  const nodeNames = circuit.nets
    .filter((net) => !net.isGround)
    .map((net) => net.id)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const currentRefs: string[] = [];
  const sourcePowerRefs: string[] = [];
  const powerExpressionByRef = new Map<string, string>();
  for (const entry of circuit.components) {
    const ref = entry.component.label?.trim();
    if (!ref || entry.component.kind === "ground") continue;
    currentRefs.push(ref);
    const expression = componentPowerExpression(ref, entry.pins);
    if (expression) powerExpressionByRef.set(ref, expression);
    if (["vsource", "isource", "vac", "iac", "vpulse"].includes(entry.component.kind)) sourcePowerRefs.push(ref);
  }
  currentRefs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  sourcePowerRefs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return { nodeNames, currentRefs, sourcePowerRefs, powerExpressionByRef };
}

export function validateEditableMeasurements(
  rows: readonly EditableMeasurement[],
  context: MeasurementAuthoringContext,
): string | null {
  const names = new Set<string>();
  for (const row of rows) {
    const name = row.name.trim();
    if (!MEASUREMENT_NAME_RE.test(name)) return "Give every measurement a valid name beginning with a letter or underscore.";
    const normalizedName = name.toLowerCase();
    if (names.has(normalizedName)) return `Measurement name “${name}” is used more than once.`;
    names.add(normalizedName);
    if (row.calculation === "PARAM") {
      if (!row.formula.trim()) return `Enter the formula for ${name}.`;
      continue;
    }
    if (row.quantity === "node-voltage" && !context.nodeNames.includes(row.target)) return `Choose a node for ${name}.`;
    if (row.quantity === "component-current" && !context.currentRefs.includes(row.target)) return `Choose a component for ${name}.`;
    if (row.quantity === "component-power" && !context.powerExpressionByRef.has(row.target)) {
      return `Choose a two-terminal component for ${name}.`;
    }
    if (row.quantity === "component-power-delivered" && !context.sourcePowerRefs.includes(row.target)) return `Choose a source for ${name}.`;
    if (row.quantity === "formula" && !row.formula.trim()) return `Enter the quantity formula for ${name}.`;
    for (const [label, raw] of [["start", row.from], ["end", row.to]] as const) {
      if (raw.trim() && !Number.isFinite(Number(raw))) return `Enter ${name}’s ${label} time in seconds.`;
    }
  }
  return null;
}

export function serializeEditableMeasurement(
  row: EditableMeasurement,
  context: MeasurementAuthoringContext,
): string {
  if (row.originalLine && row.originalFingerprint === measurementFingerprint(row)) return row.originalLine;
  const head = `.meas ${row.analysis} ${row.name.trim()}`;
  if (row.calculation === "PARAM") return `${head} PARAM ${row.formula.trim()}`;

  let expression: string;
  switch (row.quantity) {
    case "node-voltage":
      expression = `V(${row.target})`;
      break;
    case "component-current":
      expression = `I(${row.target})`;
      break;
    case "component-power":
      expression = context.powerExpressionByRef.get(row.target) ?? "";
      break;
    case "component-power-delivered":
      expression = `-(${context.powerExpressionByRef.get(row.target) ?? ""})`;
      break;
    case "formula":
      expression = row.formula.trim();
      break;
  }
  const window = [
    row.from.trim() ? `FROM=${row.from.trim()}` : "",
    row.to.trim() ? `TO=${row.to.trim()}` : "",
  ].filter(Boolean).join(" ");
  return `${head} ${row.calculation} ${expression}${window ? ` ${window}` : ""}`;
}
