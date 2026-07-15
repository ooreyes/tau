import { routeWireSmart } from "../components/Canvas.geometry";
import { importAsc } from "../io/ascImport";
import { schematicToAsc } from "../io/ascExport";
import { CATALOG_BY_KIND } from "../schematic/catalog";
import { getComponentPins, getLocalPins } from "../schematic/pins";
import type {
  ComponentKind,
  NetLabel,
  Point,
  SchematicComponent,
  SchematicWire,
} from "../schematic/types";
import {
  parseApplyCurrentAscAction,
  parseCreateAscAction,
  type AssistantAscAction,
} from "./assistantActions";

/**
 * Local models are intentionally never asked to author ASC geometry. They emit
 * this small logical plan; Tau owns validation, placement, routing, and ASC
 * serialization. This makes a weak/offline model useful without trusting it
 * with file syntax or direct canvas mutations.
 */
export const TAU_CIRCUIT_PLAN_TOOL_NAME = "build_tau_circuit";

const MAX_COMPONENTS = 80;
const MAX_NETS = 160;
const MAX_DIRECTIVES = 32;
const GRID = 16;

// These kinds round-trip through Tau's LTspice exporter/importer without a
// proprietary symbol library. Native-only markers and the kinds whose ASC
// symbol mapping is not yet lossless stay out of the model-facing contract.
export const ASSISTANT_GENERATABLE_KINDS = [
  "resistor", "capacitor", "inductor", "vsource", "isource",
  "diode", "led", "zener", "opamp", "vcvs", "vccs",
  "bsource", "nmos", "pmos", "njf", "pjf", "npn", "pnp",
  "switch", "tline", "sampleHold", "modulator",
] as const satisfies readonly ComponentKind[];

type GeneratableKind = (typeof ASSISTANT_GENERATABLE_KINDS)[number];

export const TAU_CIRCUIT_PLAN_TOOL = {
  type: "function" as const,
  function: {
    name: TAU_CIRCUIT_PLAN_TOOL_NAME,
    description:
      "Build a circuit from Tau library components and named electrical nets. "
      + "Tau validates every part and pin, chooses a clean layout, routes wires, and creates the LTspice ASC proposal.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: {
          type: "string",
          enum: ["create", "replace_current"],
          description: "Use create for a new file; replace_current only when the user explicitly asks to rebuild the open circuit.",
        },
        filename: {
          type: "string",
          description: "Leaf .asc filename for create mode. Omit for replace_current.",
        },
        components: {
          type: "array",
          minItems: 1,
          maxItems: MAX_COMPONENTS,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              ref: { type: "string", description: "Unique reference such as R1, C1, V1, Q1, or U1." },
              kind: { type: "string", enum: [...ASSISTANT_GENERATABLE_KINDS] },
              value: { type: "string", description: "Tau/SPICE value. Omit to use the library default." },
            },
            required: ["ref", "kind"],
          },
        },
        nets: {
          type: "array",
          minItems: 1,
          maxItems: MAX_NETS,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string", description: "Net name. Use 0 for circuit ground." },
              pins: {
                type: "array",
                minItems: 1,
                items: { type: "string", description: "Exact ref.pin connection such as V1.p or R1.a." },
              },
            },
            required: ["name", "pins"],
          },
        },
        directives: {
          type: "array",
          maxItems: MAX_DIRECTIVES,
          items: { type: "string", description: "Optional analysis directive such as .tran 10m or .ac dec 100 10 1Meg." },
        },
      },
      required: ["mode", "components", "nets"],
    },
  },
};

export const ASSISTANT_CATALOG_PROMPT = ASSISTANT_GENERATABLE_KINDS.map((kind) => ({
  kind,
  name: CATALOG_BY_KIND[kind].name,
  refPrefix: CATALOG_BY_KIND[kind].prefix,
  defaultValue: CATALOG_BY_KIND[kind].defaultValue,
  pins: getLocalPins(kind).map(({ id, label }) => ({ id, label })),
}));

interface CircuitPlanComponent {
  ref: string;
  kind: GeneratableKind;
  value?: string;
}

interface CircuitPlanNet {
  name: string;
  pins: string[];
}

interface CircuitPlan {
  mode: "create" | "replace_current";
  filename?: string;
  components: CircuitPlanComponent[];
  nets: CircuitPlanNet[];
  directives: string[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${field} must be text`);
  const text = value.trim();
  if (!text || text.length > maxLength || /[\r\n\0]/.test(text)) {
    throw new Error(`${field} is empty or invalid`);
  }
  return text;
}

function parsePlan(input: unknown): CircuitPlan {
  const source = record(input);
  if (!source) throw new Error("circuit plan must be an object");
  const allowed = new Set(["mode", "filename", "components", "nets", "directives"]);
  if (Object.keys(source).some((key) => !allowed.has(key))) throw new Error("circuit plan has unknown fields");
  if (source.mode !== "create" && source.mode !== "replace_current") throw new Error("circuit plan mode is invalid");
  if (!Array.isArray(source.components) || source.components.length < 1 || source.components.length > MAX_COMPONENTS) {
    throw new Error(`circuit plan must contain 1–${MAX_COMPONENTS} components`);
  }
  if (!Array.isArray(source.nets) || source.nets.length < 1 || source.nets.length > MAX_NETS) {
    throw new Error(`circuit plan must contain 1–${MAX_NETS} nets`);
  }

  const kindSet = new Set<string>(ASSISTANT_GENERATABLE_KINDS);
  const refs = new Set<string>();
  const components = source.components.map((raw, index): CircuitPlanComponent => {
    const component = record(raw);
    if (!component || Object.keys(component).some((key) => !["ref", "kind", "value"].includes(key))) {
      throw new Error(`components[${index}] is invalid`);
    }
    const ref = cleanText(component.ref, `components[${index}].ref`, 24);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(ref) || refs.has(ref.toLowerCase())) {
      throw new Error(`${ref} is not a unique safe reference`);
    }
    refs.add(ref.toLowerCase());
    if (typeof component.kind !== "string" || !kindSet.has(component.kind)) {
      throw new Error(`${ref} uses a component kind Tau cannot generate safely`);
    }
    const kind = component.kind as GeneratableKind;
    const prefix = CATALOG_BY_KIND[kind].prefix.toLowerCase();
    if (!ref.toLowerCase().startsWith(prefix.toLowerCase())) {
      throw new Error(`${ref} must use the ${CATALOG_BY_KIND[kind].prefix} reference prefix`);
    }
    return {
      ref,
      kind,
      ...(component.value === undefined ? {} : { value: cleanText(component.value, `${ref}.value`, 160) }),
    };
  });

  const byRef = new Map(components.map((component) => [component.ref.toLowerCase(), component]));
  const connectedPins = new Set<string>();
  const netNames = new Set<string>();
  const nets = source.nets.map((raw, index): CircuitPlanNet => {
    const net = record(raw);
    if (!net || Object.keys(net).some((key) => !["name", "pins"].includes(key))) {
      throw new Error(`nets[${index}] is invalid`);
    }
    const name = cleanText(net.name, `nets[${index}].name`, 48);
    if (!/^(?:0|[A-Za-z_][A-Za-z0-9_.$-]*)$/.test(name) || netNames.has(name.toLowerCase())) {
      throw new Error(`${name} is not a unique safe net name`);
    }
    netNames.add(name.toLowerCase());
    if (!Array.isArray(net.pins) || net.pins.length < 1 || net.pins.length > MAX_COMPONENTS) {
      throw new Error(`${name} must connect at least one pin`);
    }
    const pins = net.pins.map((rawPin, pinIndex) => {
      const token = cleanText(rawPin, `${name}.pins[${pinIndex}]`, 64);
      const split = token.lastIndexOf(".");
      if (split <= 0 || split === token.length - 1) throw new Error(`${token} is not a ref.pin connection`);
      const ref = token.slice(0, split);
      const pin = token.slice(split + 1);
      const component = byRef.get(ref.toLowerCase());
      if (!component) throw new Error(`${token} references an unknown component`);
      if (!getLocalPins(component.kind).some((candidate) => candidate.id === pin)) {
        throw new Error(`${token} is not a valid ${component.kind} pin`);
      }
      const canonical = `${component.ref}.${pin}`;
      const key = canonical.toLowerCase();
      if (connectedPins.has(key)) throw new Error(`${canonical} is connected to more than one net`);
      connectedPins.add(key);
      return canonical;
    });
    return { name, pins };
  });
  if (!nets.some((net) => net.name === "0")) throw new Error("circuit plan needs a 0 ground net");

  const rawDirectives = source.directives ?? [];
  if (!Array.isArray(rawDirectives) || rawDirectives.length > MAX_DIRECTIVES) {
    throw new Error(`circuit plan supports at most ${MAX_DIRECTIVES} directives`);
  }
  const safeDirective = /^(?:tran|ac|op|dc|noise|tf|step|meas|param|func|temp|options|model)\b/i;
  const directives = rawDirectives.map((raw, index) => {
    const directive = cleanText(raw, `directives[${index}]`, 240).replace(/^[.!]\s*/, "");
    if (!safeDirective.test(directive)) throw new Error(`directive .${directive.split(/\s/)[0]} is not allowed in an AI plan`);
    return directive;
  });

  const filename = source.mode === "create"
    ? cleanText(source.filename ?? "untitled.asc", "filename", 120)
    : undefined;
  return { mode: source.mode, filename, components, nets, directives };
}

function componentLevels(plan: CircuitPlan): Map<string, number> {
  const neighbors = new Map(plan.components.map((component) => [component.ref, new Set<string>()]));
  for (const net of plan.nets) {
    const refs = [...new Set(net.pins.map((pin) => pin.slice(0, pin.lastIndexOf("."))))];
    for (const left of refs) for (const right of refs) if (left !== right) neighbors.get(left)?.add(right);
  }
  const sourceRefs = plan.components
    .filter((component) => component.kind === "vsource" || component.kind === "isource")
    .map((component) => component.ref);
  const roots = sourceRefs.length > 0 ? sourceRefs : [plan.components[0].ref];
  const levels = new Map<string, number>();
  const queue = roots.map((ref) => ({ ref, level: 0 }));
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || levels.has(next.ref)) continue;
    levels.set(next.ref, next.level);
    for (const ref of neighbors.get(next.ref) ?? []) queue.push({ ref, level: next.level + 1 });
  }
  let disconnectedLevel = Math.max(0, ...levels.values()) + 1;
  for (const component of plan.components) {
    if (!levels.has(component.ref)) levels.set(component.ref, disconnectedLevel++);
  }
  return levels;
}

function layoutComponents(plan: CircuitPlan): SchematicComponent[] {
  const levels = componentLevels(plan);
  const rowsByLevel = new Map<number, number>();
  return plan.components.map((component, index) => {
    const level = levels.get(component.ref) ?? index;
    const row = rowsByLevel.get(level) ?? 0;
    rowsByLevel.set(level, row + 1);
    return {
      id: `ai-component-${index + 1}`,
      kind: component.kind,
      x: 160 + level * 176,
      y: 128 + row * 128,
      rotation: 0,
      value: component.value ?? CATALOG_BY_KIND[component.kind].defaultValue,
      label: component.ref,
    };
  });
}

/** Resolve the actual LTspice symbol-local pin banks before routing. Tau's
 * native symbols are center-anchored while ASC SYMBOL records use library
 * origins; routing against native pins and importing afterward would leave
 * visually plausible wires detached from the re-imported electrical pins. */
function resolveAscPinGeometry(components: SchematicComponent[]): SchematicComponent[] {
  const exported = schematicToAsc({ components, wires: [], netLabels: [] });
  const lossy = exported.warnings.find((warning) => /skipped|no LTspice symbol/i.test(warning));
  if (lossy) throw new Error(lossy);
  const imported = importAsc(exported.text);
  if (imported.warnings.length > 0) throw new Error(imported.warnings[0]);
  const byLabel = new Map(imported.components.map((component) => [component.label, component]));
  return components.map((component) => {
    const resolved = byLabel.get(component.label);
    if (!resolved || resolved.kind !== component.kind) {
      throw new Error(`${component.label} cannot round-trip through Tau's ASC symbol library`);
    }
    return resolved;
  });
}

function pinPoint(components: readonly SchematicComponent[], token: string): Point {
  const split = token.lastIndexOf(".");
  const ref = token.slice(0, split);
  const pinId = token.slice(split + 1);
  const component = components.find((candidate) => candidate.label === ref);
  const pin = component && getComponentPins(component).find((candidate) => candidate.id === pinId);
  if (!pin) throw new Error(`Tau could not resolve ${token} after layout`);
  return { x: pin.x, y: pin.y };
}

function compileDocument(plan: CircuitPlan): {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels: NetLabel[];
} {
  const components = resolveAscPinGeometry(layoutComponents(plan));
  const groundNet = plan.nets.find((net) => net.name === "0");
  if (!groundNet) throw new Error("circuit plan needs a 0 ground net");
  const groundOrigin = pinPoint(components, groundNet.pins[0]);
  components.push({
    id: "ai-ground-1",
    kind: "ground",
    x: Math.round(groundOrigin.x / GRID) * GRID,
    y: Math.round((groundOrigin.y + 80) / GRID) * GRID,
    rotation: 0,
    value: "",
    label: "",
  });

  const wires: SchematicWire[] = [];
  const netLabels: NetLabel[] = [];
  let wireIndex = 1;
  let labelIndex = 1;
  for (const net of plan.nets) {
    const points = net.pins.map((token) => pinPoint(components, token));
    const ground = components[components.length - 1];
    if (net.name === "0") points.push({ x: ground.x, y: ground.y });
    const anchor = points[0];
    for (const target of points.slice(1)) {
      const route = routeWireSmart(anchor, target, components, wires);
      if (route.length > 1) wires.push({ id: `ai-wire-${wireIndex++}`, points: route });
    }
    if (net.name !== "0") {
      netLabels.push({ id: `ai-label-${labelIndex++}`, x: anchor.x, y: anchor.y, text: net.name });
    }
  }
  return { components, wires, netLabels };
}

export function compileAssistantCircuitPlan(id: string, input: unknown): AssistantAscAction {
  if (!id || id.length > 160) throw new Error("tool call has no valid id");
  const plan = parsePlan(input);
  const document = compileDocument(plan);
  const exported = schematicToAsc({ ...document, directives: plan.directives });
  const lossy = exported.warnings.filter((warning) => /skipped|no LTspice symbol/i.test(warning));
  if (lossy.length > 0) throw new Error(lossy[0]);
  return plan.mode === "create"
    ? parseCreateAscAction(id, { filename: plan.filename, source: exported.text })
    : parseApplyCurrentAscAction(id, { source: exported.text });
}
