import { routeWireSmart } from "../components/Canvas.geometry";
import { schematicToAsc } from "../io/ascExport";
import { CATALOG_BY_KIND } from "../schematic/catalog";
import { extractCircuit } from "../schematic/netlist";
import { getComponentPins, getLocalPins } from "../schematic/pins";
import { parseComparator } from "../engine/comparatorSpec";
import { parsePotentiometerSpec, potentiometerLegs } from "../engine/potentiometerSpec";
import { parseQuantity } from "../simulation/quantity";
import type {
  ComponentKind,
  NetLabel,
  Point,
  Rotation,
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
// Beyond this size a star of point-to-point wires is slower, less readable,
// and electrically equivalent to repeated LTspice net labels. Named flags are
// the conventional representation for buses, rails, and clock fanout.
const LABELED_FANOUT_THRESHOLD = 12;

// These kinds round-trip through Tau's LTspice exporter/importer without a
// proprietary symbol library. Native-only markers and the kinds whose ASC
// symbol mapping is not yet lossless stay out of the model-facing contract.
export const ASSISTANT_DIRECT_GENERATABLE_KINDS = [
  "resistor", "capacitor", "polarizedCapacitor", "inductor", "bulb", "vsource", "isource",
  "logicConstant",
  "diode", "led", "zener", "photodiode", "opamp", "vcvs", "vccs",
  "bsource", "nmos", "pmos", "njf", "pjf", "npn", "pnp",
  "tline", "sampleHold", "modulator",
  "digitalGate", "dflop", "srflop", "tflop", "jkflop",
  "counter", "timer555", "adc", "dac", "sevenSeg",
] as const satisfies readonly ComponentKind[];

/** Tau-native parts whose pin contract cannot be represented by one stock
 * LTspice symbol. The compiler lowers these macros into portable primitives
 * before layout/export, retaining every requested terminal electrically. */
export const ASSISTANT_COMPOSITE_KINDS = [
  "cccs", "ccvs", "comparator", "potentiometer", "switch", "pushButton", "relay", "motor", "transformer",
  "ctTransformer",
] as const satisfies readonly ComponentKind[];

export const ASSISTANT_GENERATABLE_KINDS = [
  ...ASSISTANT_DIRECT_GENERATABLE_KINDS,
  ...ASSISTANT_COMPOSITE_KINDS,
] as const satisfies readonly ComponentKind[];

type GeneratableKind = (typeof ASSISTANT_GENERATABLE_KINDS)[number];
type DirectGeneratableKind = (typeof ASSISTANT_DIRECT_GENERATABLE_KINDS)[number];

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

/** The pins a plan may reference for a kind. A switch is lowered to a plain
 *  resistor and accepts only open/closed, so its NC+/NC- control pair cannot be
 *  placed: advertising it would invite plans the compiler has to reject, and
 *  requiring nets on it would reject every valid switch plan.
 *
 *  The bank is read at the kind's DEFAULT VALUE, not from the kind alone: a
 *  logic gate's input count follows its value, so `getLocalPins(kind)` would
 *  advertise in3..in5 on a part the planner then places as a 2-input AND. */
function plannablePins(kind: ComponentKind) {
  return getLocalPins(kind, CATALOG_BY_KIND[kind].defaultValue).filter(
    ({ id }) => !(kind === "switch" && (id === "cp" || id === "cn")),
  );
}

export const ASSISTANT_CATALOG_PROMPT = ASSISTANT_GENERATABLE_KINDS.map((kind) => ({
  kind,
  name: CATALOG_BY_KIND[kind].name,
  refPrefix: CATALOG_BY_KIND[kind].prefix,
  defaultValue: CATALOG_BY_KIND[kind].defaultValue,
  pins: plannablePins(kind).map(({ id, label }) => ({ id, label })),
}));

/**
 * Canonical Class-D approximation the system prompt teaches and the compiler
 * must accept end-to-end (1 V 10 Hz → ~10 V filtered half-bridge). Tests and
 * the MLX prompt stay locked to this topology so prompt drift cannot silently
 * reintroduce floating-pin / dual-net failures.
 */
export const GOLDEN_CLASS_D_ASSISTANT_PLAN = {
  mode: "create" as const,
  filename: "class-d-approx.asc",
  components: [
    { ref: "Vsig", kind: "vsource" as const, value: "SINE(0 1 10)" },
    { ref: "Vtri", kind: "vsource" as const, value: "SINE(0 1 100k)" },
    { ref: "Vdd", kind: "vsource" as const, value: "10" },
    { ref: "U1", kind: "comparator" as const, value: "10 0 0" },
    { ref: "M1", kind: "nmos" as const, value: "NMOS W=0.1 L=1u" },
    { ref: "M2", kind: "pmos" as const, value: "PMOS W=0.25 L=1u" },
    { ref: "L1", kind: "inductor" as const, value: "100u" },
    { ref: "C1", kind: "capacitor" as const, value: "1u" },
    { ref: "R_L", kind: "resistor" as const, value: "8" },
  ],
  nets: [
    { name: "IN", pins: ["Vsig.p", "U1.in+"] },
    { name: "TRI", pins: ["Vtri.p", "U1.in-"] },
    { name: "PWM", pins: ["U1.out", "M1.g", "M2.g"] },
    { name: "VDD", pins: ["Vdd.p", "M2.s", "M2.b"] },
    { name: "SW", pins: ["M1.d", "M2.d", "L1.a"] },
    { name: "OUT", pins: ["L1.b", "C1.a", "R_L.a"] },
    {
      name: "0",
      pins: ["Vsig.n", "Vtri.n", "Vdd.n", "M1.s", "M1.b", "C1.b", "R_L.b"],
    },
  ],
  // Explicit Tstep/Tmax keep the 100 kHz carrier resolved across a 100 ms
  // audio window (one 10 Hz cycle) so PWM is dense switching, not two gaps.
  directives: [".tran 1u 100m 0 1u"],
};

/** Known-good two-bit register sequence used by the assistant prompt and
 * regression tests: Q1Q0 samples 01, 11, 10 on the 1/3/5 ms rising edges.
 * ngspice's d_dff PRE/CLR controls are active-high, so both must be tied to
 * ground while inactive (the earlier prompt incorrectly suggested VDD). */
export const GOLDEN_TWO_BIT_REGISTER_PLAN = {
  mode: "create" as const,
  filename: "2bit-register.asc",
  components: [
    { ref: "VD0", kind: "vsource" as const, value: "PWL(0 5 4m 5 4.001m 0 6m 0)" },
    { ref: "VD1", kind: "vsource" as const, value: "PWL(0 0 2m 0 2.001m 5 6m 5)" },
    { ref: "VCLK", kind: "vsource" as const, value: "PULSE(0 5 1m 1n 1n 0.5m 2m)" },
    { ref: "A1", kind: "dflop" as const, value: "Vhigh=5" },
    { ref: "A2", kind: "dflop" as const, value: "Vhigh=5" },
  ],
  nets: [
    { name: "D0", pins: ["VD0.p", "A1.d"] },
    { name: "D1", pins: ["VD1.p", "A2.d"] },
    { name: "CLK", pins: ["VCLK.p", "A1.clk", "A2.clk"] },
    { name: "Q0", pins: ["A1.q"] },
    { name: "Q0BAR", pins: ["A1.qbar"] },
    { name: "Q1", pins: ["A2.q"] },
    { name: "Q1BAR", pins: ["A2.qbar"] },
    { name: "0", pins: ["VD0.n", "VD1.n", "VCLK.n", "A1.pre", "A1.clr", "A1.com", "A2.pre", "A2.clr", "A2.com"] },
  ],
  directives: [".tran 1u 6m"],
};

/**
 * Models often emit spice-ish pin nicknames (U1.n, U1.+, VDD). Map those onto
 * Tau's exact pin ids before validation so Class-D / op-amp plans don't die on
 * a naming mismatch.
 */
const PIN_ALIASES: Partial<Record<ComponentKind, Record<string, string>>> = {
  opamp: {
    n: "in-",
    p: "in+",
    "+": "in+",
    "-": "in-",
    inn: "in-",
    inp: "in+",
    in: "in-",
    outp: "out",
    output: "out",
    vdd: "v+",
    vss: "v-",
    "vs+": "v+",
    "vs-": "v-",
    vsplus: "v+",
    vsminus: "v-",
    "supply+": "v+",
    "supply-": "v-",
    avdd: "v+",
    avss: "v-",
    dvdd: "v+",
    dvss: "v-",
    vcc: "v+",
    vee: "v-",
    vp: "v+",
    vn: "v-",
    "v+": "v+",
    "v-": "v-",
  },
  comparator: {
    n: "in-",
    p: "in+",
    "+": "in+",
    "-": "in-",
    inn: "in-",
    inp: "in+",
    in: "in-",
    outp: "out",
    output: "out",
    // Comparators have no drawable supply pins - rails live in the value
    // string. Map supply nicknames away so models do not invent U1.v+/-.
  },
  npn: { base: "b", collector: "c", emitter: "e", b: "b", c: "c", e: "e" },
  pnp: { base: "b", collector: "c", emitter: "e", b: "b", c: "c", e: "e" },
  nmos: {
    gate: "g", drain: "d", source: "s", bulk: "b",
    g: "g", d: "d", s: "s", b: "b",
    gnd: "s", substrate: "b", body: "b",
  },
  pmos: {
    gate: "g", drain: "d", source: "s", bulk: "b",
    g: "g", d: "d", s: "s", b: "b",
    gnd: "s", substrate: "b", body: "b",
  },
};

const MOS_KINDS = new Set<ComponentKind>(["nmos", "pmos"]);

/** Positive-rail names models use for half-bridge / Class-D supplies. */
function isPositiveSupplyNetName(name: string): boolean {
  return /^(?:vdd|vcc|vp|v\+|avdd|dvdd|pvdd|supply|vs\+)$/i.test(name);
}

/** Prefer a named rail over ground when the model lists the same pin twice.
 * MOSFET source/bulk are special: nmos return wants ground; pmos wants the
 * positive rail - otherwise a dual-listed M1.s on SW+0 would stick to SW. */
function netAssignmentScore(
  netName: string,
  pinCountOnNet: number,
  pinContext?: { kind: ComponentKind; pinId: string },
): number {
  const pinId = pinContext?.pinId.toLowerCase();
  const isMosReturn = pinContext
    && MOS_KINDS.has(pinContext.kind)
    && (pinId === "s" || pinId === "b");
  if (isMosReturn) {
    if (pinContext!.kind === "nmos") {
      // Low-side return: ground wins over any accidental named-net duplicate.
      return netName === "0" ? 10_000 + pinCountOnNet : pinCountOnNet;
    }
    // High-side return: named supply / denser rail beats ground.
    if (netName === "0") return pinCountOnNet;
    if (isPositiveSupplyNetName(netName)) return 10_000 + pinCountOnNet;
    return 1000 + pinCountOnNet;
  }
  if (netName === "0") return pinCountOnNet;
  // Named nets always beat ground. Pin count breaks ties among named nets so a
  // denser intentional rail wins over a singleton leftover - equal counts stay
  // ambiguous and reject below.
  return 1000 + pinCountOnNet;
}

function formatPinConflictHint(
  canonical: string,
  netNames: string[],
  kind: ComponentKind,
): string {
  const validIds = getLocalPins(kind).map((pin) => pin.id).join(", ");
  return (
    `${canonical} is connected to more than one net (${netNames.join(", ")}). `
    + `Each pin may appear in exactly one net - aliases like vee/vss/v- collapse to the same pin. `
    + `Keep ${canonical} only on the intended net and remove it from the others. `
    + `${kind} pins: ${validIds}.`
  );
}

/**
 * Safe MOS pin defaults when the model omits source/bulk (classic Class-D miss:
 * gates+drains wired, M1.s/M2.s left floating → compile rejection).
 *
 * Rules (documented product behavior):
 * - Uncovered nmos `s` → attach to ground net `0` (low-side / common-source return).
 * - Uncovered pmos `s` → attach to a positive supply net: prefer a net named
 *   VDD/VCC/…, else any non-ground net that already holds a vsource `.p`.
 * - Uncovered `b` (bulk) → tie to that device's source net (after source repair).
 * Gate/drain are never invented - those stay hard failures for the repair loop.
 */
function autoRepairMosSourceAndBulk(
  components: CircuitPlanComponent[],
  nets: CircuitPlanNet[],
): CircuitPlanNet[] {
  const mutable = nets.map((net) => ({ name: net.name, pins: [...net.pins] }));
  const connected = new Set(mutable.flatMap((net) => net.pins.map((pin) => pin.toLowerCase())));
  const byRef = new Map(components.map((component) => [component.ref.toLowerCase(), component]));

  const attach = (netName: string, pin: string): boolean => {
    const net = mutable.find((entry) => entry.name === netName);
    if (!net) return false;
    const key = pin.toLowerCase();
    if (connected.has(key)) return true;
    net.pins.push(pin);
    connected.add(key);
    return true;
  };

  const netHolding = (pinKey: string): string | undefined =>
    mutable.find((net) => net.pins.some((pin) => pin.toLowerCase() === pinKey))?.name;

  const resolvePmosSourceNet = (): string | undefined => {
    const named = mutable.find((net) => net.name !== "0" && isPositiveSupplyNetName(net.name));
    if (named) return named.name;
    for (const net of mutable) {
      if (net.name === "0") continue;
      for (const token of net.pins) {
        const split = token.lastIndexOf(".");
        if (split <= 0) continue;
        const ref = token.slice(0, split);
        const pinId = token.slice(split + 1).toLowerCase();
        if (pinId === "p" && byRef.get(ref.toLowerCase())?.kind === "vsource") {
          return net.name;
        }
      }
    }
    return undefined;
  };

  for (const component of components) {
    if (!MOS_KINDS.has(component.kind)) continue;
    const sourcePin = `${component.ref}.s`;
    const bulkPin = `${component.ref}.b`;
    const sourceKey = sourcePin.toLowerCase();
    const bulkKey = bulkPin.toLowerCase();

    if (!connected.has(sourceKey)) {
      const target = component.kind === "nmos" ? "0" : resolvePmosSourceNet();
      if (!target || !attach(target, sourcePin)) continue;
    }

    if (!connected.has(bulkKey)) {
      const sourceNet = netHolding(sourceKey);
      if (sourceNet) attach(sourceNet, bulkPin);
    }
  }

  return mutable;
}

/**
 * Dual-NMOS half-bridges cannot switch the high side from a 0-VDD gate drive
 * (needs bootstrap / level shift). Live Class-D failures used two nmos with a
 * shared PWM gate - rewrite the second device to pmos and park its source/bulk
 * on the positive rail so the complementary golden topology is recovered.
 */
function autoRepairDualNmosHalfBridge(
  components: CircuitPlanComponent[],
  nets: CircuitPlanNet[],
): { components: CircuitPlanComponent[]; nets: CircuitPlanNet[] } {
  const nmos = components.filter((component) => component.kind === "nmos");
  const pmos = components.filter((component) => component.kind === "pmos");
  if (nmos.length < 2 || pmos.length > 0) return { components, nets };

  const mutableNets = nets.map((net) => ({ name: net.name, pins: [...net.pins] }));
  const pinNet = (pinKey: string): string | undefined =>
    mutableNets.find((net) => net.pins.some((pin) => pin.toLowerCase() === pinKey))?.name;

  // Prefer a shared gate net - that is the PWM comparator drive.
  const gateNets = new Map<string, string[]>();
  for (const fet of nmos) {
    const gateNet = pinNet(`${fet.ref}.g`.toLowerCase());
    if (!gateNet) continue;
    const refs = gateNets.get(gateNet) ?? [];
    refs.push(fet.ref);
    gateNets.set(gateNet, refs);
  }
  const shared = [...gateNets.values()].find((refs) => refs.length >= 2);
  if (!shared) return { components, nets };

  const supplyNet = mutableNets.find((net) => net.name !== "0" && isPositiveSupplyNetName(net.name))?.name
    ?? mutableNets.find((net) => {
      if (net.name === "0") return false;
      return net.pins.some((token) => {
        const split = token.lastIndexOf(".");
        if (split <= 0) return false;
        const ref = token.slice(0, split);
        const pinId = token.slice(split + 1).toLowerCase();
        return pinId === "p" && components.some((c) => c.ref.toLowerCase() === ref.toLowerCase() && c.kind === "vsource");
      });
    })?.name;
  if (!supplyNet) return { components, nets };

  // Convert the last shared-gate nmos into the high-side pmos.
  const highRef = shared[shared.length - 1];
  const nextComponents = components.map((component) =>
    component.ref === highRef
      ? {
          ...component,
          kind: "pmos" as const,
          value: component.value?.includes("W=") ? component.value.replace(/NMOS/i, "PMOS") : "PMOS W=0.25 L=1u",
        }
      : component.kind === "nmos" && !component.value?.includes("W=")
        ? { ...component, value: "NMOS W=0.1 L=1u" }
        : component,
  );

  const movePin = (pin: string, toNet: string) => {
    const key = pin.toLowerCase();
    for (const net of mutableNets) {
      net.pins = net.pins.filter((entry) => entry.toLowerCase() !== key);
    }
    const target = mutableNets.find((net) => net.name === toNet);
    if (target && !target.pins.some((entry) => entry.toLowerCase() === key)) {
      target.pins.push(pin);
    }
  };
  movePin(`${highRef}.s`, supplyNet);
  movePin(`${highRef}.b`, supplyNet);

  // High-side drain must share the switch node with the low-side drain / inductor,
  // not sit on VDD (series-stack dual-nmos mistake).
  const highDrainNet = pinNet(`${highRef}.d`.toLowerCase());
  const lowRef = shared[0];
  const lowDrainNet = pinNet(`${lowRef}.d`.toLowerCase());
  if (highDrainNet && lowDrainNet && highDrainNet !== lowDrainNet && isPositiveSupplyNetName(highDrainNet)) {
    movePin(`${highRef}.d`, lowDrainNet);
  }

  return { components: nextComponents, nets: mutableNets.filter((net) => net.pins.length > 0 || net.name === "0") };
}

/** Repair-loop hint when pins remain uncovered after MOS auto-repair. */
function formatUncoveredPinsHint(uncoveredPins: string[], components: CircuitPlanComponent[]): string {
  const verb = uncoveredPins.length === 1 ? "is" : "are";
  const base = (
    `${uncoveredPins.join(", ")} ${verb} not connected to any net; every pin needs a net `
    + `(use a dedicated single-pin net for a deliberately unused pin)`
  );
  const byRef = new Map(components.map((component) => [component.ref.toLowerCase(), component]));
  const hasMos = uncoveredPins.some((token) => {
    const split = token.lastIndexOf(".");
    const kind = byRef.get(token.slice(0, split).toLowerCase())?.kind;
    return kind === "nmos" || kind === "pmos";
  });
  if (!hasMos) return base;
  return (
    `${base}. MOSFET fix pattern: nmos source+bulk on ground `
    + `(add M1.s,M1.b to net 0); pmos source+bulk on the positive rail `
    + `(add M2.s,M2.b next to Vdd.p). Half-bridge example: `
    + `VDD=[Vdd.p,M2.s,M2.b], SW=[M1.d,M2.d,L1.a], 0=[Vdd.n,M1.s,M1.b,...].`
  );
}

export function canonicalizeAssistantPin(kind: ComponentKind, pin: string): string {
  const aliases = PIN_ALIASES[kind];
  const aliased = aliases?.[pin.toLowerCase()];
  if (aliased) return aliased;
  const exact = getLocalPins(kind).find((candidate) => candidate.id.toLowerCase() === pin.toLowerCase());
  return exact?.id ?? pin;
}

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

interface DirectCircuitPlan extends Omit<CircuitPlan, "components"> {
  components: Array<Omit<CircuitPlanComponent, "kind"> & { kind: DirectGeneratableKind }>;
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
    throw new Error(`circuit plan must contain 1-${MAX_COMPONENTS} components`);
  }
  if (!Array.isArray(source.nets) || source.nets.length < 1 || source.nets.length > MAX_NETS) {
    throw new Error(`circuit plan must contain 1-${MAX_NETS} nets`);
  }

  const kindSet = new Set<string>(ASSISTANT_GENERATABLE_KINDS);
  const refs = new Set<string>();
  let components = source.components.map((raw, index): CircuitPlanComponent => {
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
  const netNames = new Set<string>();
  // First pass: canonicalize + within-net dedupe (U1.vee + U1.v- on the same
  // net is one connection, not a conflict). Track every net each pin lands on
  // so a later pass can auto-prefer a named rail over ground or reject.
  const draftNets: CircuitPlanNet[] = [];
  const pinToNets = new Map<string, string[]>();
  const pinMeta = new Map<string, { canonical: string; kind: ComponentKind }>();

  for (let index = 0; index < source.nets.length; index += 1) {
    const raw = source.nets[index];
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
    const seenOnNet = new Set<string>();
    const pins: string[] = [];
    for (let pinIndex = 0; pinIndex < net.pins.length; pinIndex += 1) {
      const rawPinToken = net.pins[pinIndex];
      const token = cleanText(rawPinToken, `${name}.pins[${pinIndex}]`, 64);
      const split = token.lastIndexOf(".");
      if (split <= 0 || split === token.length - 1) throw new Error(`${token} is not a ref.pin connection`);
      const ref = token.slice(0, split);
      const rawPin = token.slice(split + 1);
      const component = byRef.get(ref.toLowerCase());
      if (!component) {
        // Name the declared refs: a small model that invented "Vtri" (or
        // mistyped a ref) needs the actual roster to converge in one repair
        // attempt - either connect an existing ref or declare the missing one.
        const declared = [...byRef.values()].map((candidate) => candidate.ref).join(", ");
        throw new Error(
          `${token} references an unknown component - declared components are: ${declared}. `
          + `Either use one of those refs or add the missing component to the components list`,
        );
      }
      const pin = canonicalizeAssistantPin(component.kind, rawPin);
      const validIds = getLocalPins(component.kind).map((candidate) => candidate.id);
      if (!validIds.includes(pin)) {
        const supplyLike = /^(?:v\+|v-|vcc|vee|vdd|vss|vp|vn|avdd|avss)$/i.test(rawPin);
        if (component.kind === "comparator" && supplyLike) {
          throw new Error(
            `${component.ref}.${rawPin} is not a valid comparator pin - comparators have NO supply pins `
            + `(use ${validIds.join(", ")}; put high/low rails in the value string, e.g. "10 0 0")`,
          );
        }
        throw new Error(
          `${component.ref}.${rawPin} is not a valid ${component.kind} pin (use ${validIds.join(", ")})`,
        );
      }
      const canonical = `${component.ref}.${pin}`;
      const key = canonical.toLowerCase();
      // Identical after aliasing → keep once on this net.
      if (seenOnNet.has(key)) continue;
      seenOnNet.add(key);
      pins.push(canonical);
      pinMeta.set(key, { canonical, kind: component.kind });
      const netsForPin = pinToNets.get(key) ?? [];
      netsForPin.push(name);
      pinToNets.set(key, netsForPin);
    }
    draftNets.push({ name, pins });
  }

  // Across-net conflicts: prefer a named / denser net over ground when the
  // model double-listed a supply pin (classic Class-D failure: U1.v- on vee
  // and again on 0 via U1.vee). Ambiguous equal-score conflicts still reject
  // with a repair hint that lists both nets and the legal pin ids.
  const drop = new Map<string, Set<string>>(); // netName → pin keys to remove
  for (const [key, netsForPin] of pinToNets) {
    if (netsForPin.length < 2) continue;
    const uniqueNets = [...new Set(netsForPin)];
    if (uniqueNets.length < 2) continue;
    const scored = uniqueNets
      .map((netName) => {
        const pinCount = draftNets.find((net) => net.name === netName)?.pins.length ?? 0;
        const meta = pinMeta.get(key);
        const pinId = meta?.canonical.slice(meta.canonical.lastIndexOf(".") + 1) ?? "";
        return {
          netName,
          score: netAssignmentScore(
            netName,
            pinCount,
            meta ? { kind: meta.kind, pinId } : undefined,
          ),
        };
      })
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    const contested = scored.filter((entry) => entry.score === best.score);
    if (contested.length > 1) {
      const meta = pinMeta.get(key);
      throw new Error(formatPinConflictHint(
        meta?.canonical ?? key,
        uniqueNets,
        meta?.kind ?? "opamp",
      ));
    }
    for (const loser of scored.slice(1)) {
      const removals = drop.get(loser.netName) ?? new Set<string>();
      removals.add(key);
      drop.set(loser.netName, removals);
    }
  }

  const nets: CircuitPlanNet[] = [];
  for (const draft of draftNets) {
    const removals = drop.get(draft.name);
    const pins = removals
      ? draft.pins.filter((pin) => !removals.has(pin.toLowerCase()))
      : draft.pins;
    if (pins.length === 0) {
      if (draft.name === "0") {
        throw new Error("circuit plan needs a 0 ground net with at least one pin after deduplicating supply aliases");
      }
      // Drop empty leftover nets created solely by a conflicting duplicate pin.
      continue;
    }
    nets.push({ name: draft.name, pins });
  }
  if (!nets.some((net) => net.name === "0")) throw new Error("circuit plan needs a 0 ground net");

  // Models routinely wire MOSFET gates/drains and omit source/bulk. Auto-repair
  // those two pins when the topology is unambiguous (see autoRepairMosSourceAndBulk);
  // remaining floaters still reject with an explicit MOSFET fix pattern.
  const afterMosPins = autoRepairMosSourceAndBulk(components, nets);
  // Dual-NMOS half-bridges (shared PWM gate, no pmos) cannot switch from a
  // 0-VDD gate drive - rewrite to complementary nmos+pmos before validation.
  const repaired = autoRepairDualNmosHalfBridge(components, afterMosPins);
  components = repaired.components;
  const repairedNets = repaired.nets;

  const connectedPins = new Set(
    repairedNets.flatMap((net) => net.pins.map((pin) => pin.toLowerCase())),
  );

  // A pin absent from every net is a silently floating part - the simulation
  // would read 0 V / 0 A and the schematic would look plausible but be wrong.
  // Rejecting here feeds the provider's repair loop, so the model corrects
  // its own plan instead of shipping a broken circuit. Report every floating
  // pin at once: a small model given one pin per attempt burns its limited
  // repair attempts without converging.
  const uncoveredPins = components.flatMap((component) =>
    plannablePins(component.kind)
      .map(({ id }) => `${component.ref}.${id}`)
      .filter((pin) => !connectedPins.has(pin.toLowerCase())),
  );
  if (uncoveredPins.length > 0) {
    throw new Error(formatUncoveredPinsHint(uncoveredPins, components));
  }

  const rawDirectives = source.directives ?? [];
  if (!Array.isArray(rawDirectives) || rawDirectives.length > MAX_DIRECTIVES) {
    throw new Error(`circuit plan supports at most ${MAX_DIRECTIVES} directives`);
  }
  const safeDirective = /^(?:tran|ac|op|dc|noise|tf|step|meas|param|func|temp|options|model)\b/i;
  const directives = rawDirectives.map((raw, index) => {
    // Leading "*" is tolerated alongside "."/"!": Qwen intermittently emits
    // "*op" for ".op", and the safelist below still gates what may run.
    const directive = cleanText(raw, `directives[${index}]`, 240).replace(/^[.!*]\s*/, "");
    if (!safeDirective.test(directive)) throw new Error(`directive .${directive.split(/\s/)[0]} is not allowed in an AI plan`);
    return directive;
  });

  const filename = source.mode === "create"
    ? cleanText(source.filename ?? "untitled.asc", "filename", 120)
    : undefined;
  return { mode: source.mode, filename, components, nets: repairedNets, directives };
}

function finiteQuantity(value: string, ref: string, unit: string): number {
  try {
    const parsed = parseQuantity(value, unit);
    if (Number.isFinite(parsed)) return parsed;
  } catch {
    // Re-throw one component-aware validation message below.
  }
  throw new Error(`${ref} needs a valid ${unit || "numeric"} value`);
}

/** Expand library macros into stock LTspice parts while preserving a mapping
 * from every logical ref.pin to one or more physical ref.pin endpoints. */
function lowerCompositePlan(plan: CircuitPlan): DirectCircuitPlan {
  const directKinds = new Set<string>(ASSISTANT_DIRECT_GENERATABLE_KINDS);
  const reservedRefs = new Set(plan.components.map((component) => component.ref.toLowerCase()));
  const logicalNetByPin = new Map(plan.nets.flatMap((net) => net.pins.map((pin) => [pin.toLowerCase(), net.name] as const)));
  const pinMap = new Map<string, string[]>();
  const components: DirectCircuitPlan["components"] = [];
  const internalDirectives: string[] = [];
  const internalGroundPins: string[] = [];

  const uniqueRef = (candidate: string): string => {
    let ref = candidate;
    let suffix = 2;
    while (reservedRefs.has(ref.toLowerCase())) ref = `${candidate}_${suffix++}`;
    reservedRefs.add(ref.toLowerCase());
    return ref;
  };
  const mapPin = (logical: string, ...physical: string[]) => pinMap.set(logical.toLowerCase(), physical);
  const add = (ref: string, kind: DirectGeneratableKind, value: string) => components.push({ ref, kind, value });

  for (const component of plan.components) {
    if (directKinds.has(component.kind)) {
      const direct = component as Omit<CircuitPlanComponent, "kind"> & { kind: DirectGeneratableKind };
      components.push(direct);
      for (const pin of getLocalPins(component.kind)) mapPin(`${component.ref}.${pin.id}`, `${component.ref}.${pin.id}`);
      continue;
    }

    const value = component.value ?? CATALOG_BY_KIND[component.kind].defaultValue;
    switch (component.kind) {
      case "potentiometer": {
        const { resistanceText, wiper } = parsePotentiometerSpec(value);
        const total = finiteQuantity(resistanceText, component.ref, "Ohm");
        if (total <= 0) throw new Error(`${component.ref} needs a positive Ohm value`);
        const legs = potentiometerLegs(total, wiper);
        const upper = uniqueRef(`R_${component.ref}_A`);
        const lower = uniqueRef(`R_${component.ref}_B`);
        add(upper, "resistor", String(legs.a));
        add(lower, "resistor", String(legs.b));
        mapPin(`${component.ref}.a`, `${upper}.a`);
        mapPin(`${component.ref}.w`, `${upper}.b`, `${lower}.a`);
        mapPin(`${component.ref}.b`, `${lower}.b`);
        break;
      }
      case "switch":
      case "pushButton": {
        const state = value.trim().toLowerCase();
        if (!/^(?:open|off|0|closed|on|1|pressed)$/.test(state)) {
          throw new Error(`${component.ref} ${component.kind} value must be open or closed`);
        }
        const resistor = uniqueRef(`R_${component.ref}`);
        add(resistor, "resistor", /^(?:closed|on|1|pressed)$/.test(state) ? "1m" : "1e12");
        mapPin(`${component.ref}.a`, `${resistor}.a`);
        mapPin(`${component.ref}.b`, `${resistor}.b`);
        break;
      }
      case "relay": {
        // Coil R + contact held open as a high-Z R in the ASC macro expand —
        // native ngspice path uses TAU_SW; the portable expand stays honest
        // about "coil present, contact not auto-switching in ASC".
        const coilOhms = value.trim() || "100";
        const coil = uniqueRef(`R_${component.ref}_coil`);
        const contact = uniqueRef(`R_${component.ref}_sw`);
        add(coil, "resistor", coilOhms);
        add(contact, "resistor", "1e12");
        mapPin(`${component.ref}.cp`, `${coil}.a`);
        mapPin(`${component.ref}.cn`, `${coil}.b`);
        mapPin(`${component.ref}.a`, `${contact}.a`);
        mapPin(`${component.ref}.b`, `${contact}.b`);
        break;
      }
      case "motor": {
        // ASC macro: armature R only. Native deck emits series R+L.
        const tokens = value.trim().split(/[\s,;]+/).filter(Boolean);
        const r = tokens[0] || "10";
        const armR = uniqueRef(`R_${component.ref}`);
        add(armR, "resistor", r);
        mapPin(`${component.ref}.a`, `${armR}.a`);
        mapPin(`${component.ref}.b`, `${armR}.b`);
        break;
      }
      case "transformer": {
        const ratio = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(value);
        const primaryTurns = Number(ratio?.[1]);
        const secondaryTurns = Number(ratio?.[2]);
        if (!ratio || primaryTurns <= 0 || secondaryTurns <= 0) {
          throw new Error(`${component.ref} needs a positive turns ratio such as 1:2`);
        }
        const primary = uniqueRef(`L_${component.ref}_P`);
        const secondary = uniqueRef(`L_${component.ref}_S`);
        const primaryInductance = 10e-3;
        const secondaryInductance = primaryInductance * (secondaryTurns / primaryTurns) ** 2;
        add(primary, "inductor", String(primaryInductance));
        add(secondary, "inductor", String(secondaryInductance));
        mapPin(`${component.ref}.p1`, `${primary}.a`);
        mapPin(`${component.ref}.p2`, `${primary}.b`);
        mapPin(`${component.ref}.s1`, `${secondary}.a`);
        mapPin(`${component.ref}.s2`, `${secondary}.b`);
        internalDirectives.push(`K_${component.ref} ${primary} ${secondary} 0.999`);
        break;
      }
      case "ctTransformer": {
        const ratio = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(value);
        const primaryTurns = Number(ratio?.[1]);
        const secondaryTurns = Number(ratio?.[2]);
        if (!ratio || primaryTurns <= 0 || secondaryTurns <= 0) {
          throw new Error(`${component.ref} needs a positive turns ratio such as 1:2`);
        }
        const primary = uniqueRef(`L_${component.ref}_P`);
        const sa = uniqueRef(`L_${component.ref}_SA`);
        const sb = uniqueRef(`L_${component.ref}_SB`);
        const primaryInductance = 10e-3;
        const fullSecondary = primaryInductance * (secondaryTurns / primaryTurns) ** 2;
        const half = fullSecondary / 4;
        add(primary, "inductor", String(primaryInductance));
        add(sa, "inductor", String(half));
        add(sb, "inductor", String(half));
        mapPin(`${component.ref}.p1`, `${primary}.a`);
        mapPin(`${component.ref}.p2`, `${primary}.b`);
        mapPin(`${component.ref}.s1`, `${sa}.a`);
        mapPin(`${component.ref}.ct`, `${sa}.b`, `${sb}.b`);
        mapPin(`${component.ref}.s2`, `${sb}.a`);
        internalDirectives.push(`K_${component.ref} ${primary} ${sa} ${sb} 0.999`);
        break;
      }
      case "cccs":
      case "ccvs": {
        const unit = component.kind === "cccs" ? "A/A" : "V/A";
        const gain = finiteQuantity(value, component.ref, unit);
        const sense = uniqueRef(`V_${component.ref}_SENSE`);
        const output = uniqueRef(`B_${component.ref}_OUT`);
        add(sense, "vsource", "0");
        add(output, "bsource", `${component.kind === "cccs" ? "I" : "V"}=I(${sense})*${gain}`);
        mapPin(`${component.ref}.cp`, `${sense}.p`);
        mapPin(`${component.ref}.cn`, `${sense}.n`);
        mapPin(`${component.ref}.op`, `${output}.p`);
        mapPin(`${component.ref}.on`, `${output}.n`);
        break;
      }
      case "comparator": {
        const inPlus = logicalNetByPin.get(`${component.ref}.in+`.toLowerCase());
        const inMinus = logicalNetByPin.get(`${component.ref}.in-`.toLowerCase());
        const outputNet = logicalNetByPin.get(`${component.ref}.out`.toLowerCase());
        if (!inPlus || !inMinus || !outputNet) {
          throw new Error(`${component.ref} comparator needs in+, in-, and out connected`);
        }
        const spec = parseComparator(value);
        const output = uniqueRef(`B_${component.ref}`);
        const inputPlus = uniqueRef(`R_${component.ref}_INP`);
        const inputMinus = uniqueRef(`R_${component.ref}_INM`);
        const diff = `(V(${inPlus})-V(${inMinus}))`;
        const expression = spec.vhyst <= 0
          ? `V=if(${diff}>0,${spec.vhigh},${spec.vlow})`
          : `V=if(V(${outputNet})>${(spec.vhigh + spec.vlow) / 2},if(${diff}>${-spec.vhyst},${spec.vhigh},${spec.vlow}),if(${diff}>${spec.vhyst},${spec.vhigh},${spec.vlow}))`;
        add(output, "bsource", expression);
        // Stock LTspice B sources reference input nets by expression and have
        // no drawable input terminals. Two effectively-open shunts provide
        // explicit pin anchors in the generated schematic without materially
        // loading the circuit (1 PΩ each).
        add(inputPlus, "resistor", "1e15");
        add(inputMinus, "resistor", "1e15");
        mapPin(`${component.ref}.out`, `${output}.p`);
        mapPin(`${component.ref}.in+`, `${inputPlus}.a`);
        mapPin(`${component.ref}.in-`, `${inputMinus}.a`);
        internalGroundPins.push(`${output}.n`, `${inputPlus}.b`, `${inputMinus}.b`);
        break;
      }
    }
  }

  const nets = plan.nets.map((net) => ({
    ...net,
    pins: net.pins.flatMap((pin) => {
      const physical = pinMap.get(pin.toLowerCase());
      if (!physical) throw new Error(`Tau could not lower ${pin} to an LTspice primitive`);
      return physical;
    }),
  }));
  nets.find((net) => net.name === "0")?.pins.push(...internalGroundPins);
  return { ...plan, components, nets, directives: [...plan.directives, ...internalDirectives] };
}

// Moderate pitch - pin-alignment below keeps wires straight so we do not need
// huge empty rectangles between parts.
const COLUMN_PITCH = 208;
const ROW_PITCH = 144;

// Two-pin passives Tau draws natively with left/right pins at rotation 0.
// Rotation below uses Tau's native pin transform (NOT LTspice ASC banks).
const ROTATABLE_TWO_PIN_KINDS = new Set<ComponentKind>([
  "resistor", "capacitor", "polarizedCapacitor", "inductor", "bulb", "motor", "diode", "led", "zener", "photodiode",
]);

/** net name → refs of every component on that net. */
function netMembership(plan: DirectCircuitPlan): Map<string, string[]> {
  const members = new Map<string, string[]>();
  for (const net of plan.nets) {
    const refs = [...new Set(net.pins.map((pin) => pin.slice(0, pin.lastIndexOf("."))))];
    members.set(net.name, refs);
  }
  return members;
}

/**
 * Orient two-pin passives for Tau's native symbols (horizontal at rotation 0):
 * - Series between different levels → horizontal, pin a toward the source.
 * - Shunt to ground → vertical, pin a on top / pin b|k on bottom (rotation 90).
 */
function rotationForComponent(
  component: DirectCircuitPlan["components"][number],
  levels: Map<string, number>,
  netByPin: Map<string, string>,
  netMembers: Map<string, string[]>,
): Rotation {
  if (!ROTATABLE_TWO_PIN_KINDS.has(component.kind)) return 0;
  const [pin0, pin1] = getLocalPins(component.kind);
  const net0 = netByPin.get(`${component.ref}.${pin0.id}`.toLowerCase());
  const net1 = netByPin.get(`${component.ref}.${pin1.id}`.toLowerCase());
  if (!net0 || !net1 || net0 === net1) return 0;

  if (net0 === "0" || net1 === "0") {
    // Native rot 90 puts pin0 (a) above pin1 (b/k). Flip to 270 if ground is on a.
    return net1 === "0" ? 90 : 270;
  }

  const ownLevel = levels.get(component.ref) ?? 0;
  const neighborLevel = (net: string): number | null => {
    const others = (netMembers.get(net) ?? []).filter((ref) => ref !== component.ref);
    if (others.length === 0) return null;
    return Math.min(...others.map((ref) => levels.get(ref) ?? ownLevel));
  };
  const level0 = neighborLevel(net0);
  const level1 = neighborLevel(net1);
  if (level0 === null || level1 === null || level0 === level1) return 0;
  // Native rot 0: pin0 on the left. Prefer that when pin0 faces the upstream level.
  return level0 < level1 ? 0 : 180;
}

function componentLevels(plan: DirectCircuitPlan): Map<string, number> {
  const neighbors = new Map(plan.components.map((component) => [component.ref, new Set<string>()]));
  for (const net of plan.nets) {
    // The ground rail connects almost everything; treating it as adjacency
    // collapses the signal-flow ordering (a load lands next to the source).
    if (net.name === "0") continue;
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

function moveComponent(
  components: SchematicComponent[],
  label: string,
  dx: number,
  dy: number,
): void {
  const component = components.find((candidate) => candidate.label === label);
  if (!component || (dx === 0 && dy === 0)) return;
  const x = Math.round((component.x + dx) / GRID) * GRID;
  const y = Math.round((component.y + dy) / GRID) * GRID;
  // Alignment slides accumulate over passes; refuse any slide that would walk
  // this part onto (or right next to) another center, or the aligner can
  // collapse a whole column one 64px hop at a time.
  const collides = components.some((other) =>
    other !== component && Math.abs(other.x - x) < 96 && Math.abs(other.y - y) < 96,
  );
  if (collides) return;
  component.x = x;
  component.y = y;
}

/**
 * After coarse level placement, slide parts so connected pins share an axis.
 * That turns L-shaped router jogs into single straight wires - the difference
 * between a hand-drawn LED loop and a sparse rectangle with stair-steps.
 */
function alignConnectedPins(plan: DirectCircuitPlan, components: SchematicComponent[]): void {
  const levels = componentLevels(plan);
  for (let pass = 0; pass < 12; pass += 1) {
    let moved = false;
    for (const net of plan.nets) {
      const endpoints = net.pins.map((token) => {
        const split = token.lastIndexOf(".");
        const ref = token.slice(0, split);
        const pinId = token.slice(split + 1);
        const component = components.find((candidate) => candidate.label === ref);
        const pin = component && getComponentPins(component).find((candidate) => candidate.id === pinId);
        if (!component || !pin) return null;
        return { ref, level: levels.get(ref) ?? 0, pin, component };
      }).filter((endpoint): endpoint is NonNullable<typeof endpoint> => endpoint !== null);

      for (let i = 0; i < endpoints.length; i += 1) {
        for (let j = i + 1; j < endpoints.length; j += 1) {
          const left = endpoints[i];
          const right = endpoints[j];
          // Two pins of the SAME part can never be brought together by moving
          // that part: their offset is fixed by the symbol. Attempting it just
          // translates the component, once per pass, until it is nowhere near
          // the circuit - which is what a flip-flop with PRE, CLR and COM all
          // on the ground net did, sliding 960 units off its column and
          // shorting three signals together on the way.
          if (left.ref === right.ref) continue;
          const dx = right.pin.x - left.pin.x;
          const dy = right.pin.y - left.pin.y;
          // Move the downstream (higher level) part toward the upstream pin.
          const [anchor, mobile] = left.level <= right.level ? [left, right] : [right, left];
          // Micro-align native pin-bank offsets so series chains stay on one
          // axis (straight wires). Cap the slide so dense graphs do not collapse.
          if (Math.abs(dx) >= Math.abs(dy) && dy !== 0 && Math.abs(dy) <= 64) {
            moveComponent(components, mobile.ref, 0, anchor.pin.y - mobile.pin.y);
            moved = true;
          } else if (Math.abs(dy) > Math.abs(dx) && dx !== 0 && Math.abs(dx) <= 64) {
            moveComponent(components, mobile.ref, anchor.pin.x - mobile.pin.x, 0);
            moved = true;
          }
        }
      }
    }
    if (!moved) break;
  }
}

/**
 * Row order within each level, chosen so parts sit next to what they connect
 * to (Sugiyama barycenter sweeps) instead of stacking in plan order - plan
 * order is what left an LC filter's C and R dangling far below the bridge
 * while L drifted to the top. Shorter columns are then centered against the
 * tallest so single-part levels ride the visual middle of the signal path.
 */
function rowAssignments(plan: DirectCircuitPlan, levels: Map<string, number>): {
  rowByRef: Map<string, number>;
  rowCountByLevel: Map<number, number>;
} {
  const adjacency = new Map<string, Set<string>>(plan.components.map((component) => [component.ref, new Set()]));
  for (const net of plan.nets) {
    if (net.name === "0") continue; // ground pulls everything everywhere
    const refs = [...new Set(net.pins.map((pin) => pin.slice(0, pin.lastIndexOf("."))))];
    for (const left of refs) for (const right of refs) if (left !== right) adjacency.get(left)?.add(right);
  }
  const refsByLevel = new Map<number, string[]>();
  for (const component of plan.components) {
    const level = levels.get(component.ref) ?? 0;
    refsByLevel.set(level, [...(refsByLevel.get(level) ?? []), component.ref]);
  }
  const orderedLevels = [...refsByLevel.keys()].sort((a, b) => a - b);
  const rowByRef = new Map<string, number>();
  for (const level of orderedLevels) {
    (refsByLevel.get(level) ?? []).forEach((ref, index) => rowByRef.set(ref, index));
  }

  const sweep = (levelOrder: number[], neighborSide: (own: number, other: number) => boolean): void => {
    for (const level of levelOrder) {
      const refs = refsByLevel.get(level) ?? [];
      if (refs.length < 2) continue;
      const scored = refs.map((ref, index) => {
        const anchors = [...(adjacency.get(ref) ?? [])]
          .filter((other) => neighborSide(level, levels.get(other) ?? level))
          .map((other) => rowByRef.get(other) ?? 0);
        const score = anchors.length > 0
          ? anchors.reduce((sum, row) => sum + row, 0) / anchors.length
          : rowByRef.get(ref) ?? index;
        return { ref, score, index };
      });
      scored.sort((a, b) => a.score - b.score || a.index - b.index);
      scored.forEach((entry, row) => rowByRef.set(entry.ref, row));
    }
  };
  // One downstream sweep pulls parts toward their sources; one upstream sweep
  // settles feedback/load parts the first pass could not see yet.
  sweep(orderedLevels, (own, other) => other < own);
  sweep([...orderedLevels].reverse(), (own, other) => other > own);

  const rowCountByLevel = new Map<number, number>();
  for (const [level, refs] of refsByLevel) rowCountByLevel.set(level, refs.length);
  return { rowByRef, rowCountByLevel };
}

function layoutComponents(plan: DirectCircuitPlan): SchematicComponent[] {
  const levels = componentLevels(plan);
  const netMembers = netMembership(plan);
  const netByPin = new Map<string, string>();
  for (const net of plan.nets) {
    for (const pin of net.pins) netByPin.set(pin.toLowerCase(), net.name);
  }
  const { rowByRef, rowCountByLevel } = rowAssignments(plan, levels);
  const tallestColumn = Math.max(1, ...rowCountByLevel.values());
  const components = plan.components.map((component, index) => {
    const level = levels.get(component.ref) ?? index;
    const row = rowByRef.get(component.ref) ?? 0;
    const columnRows = rowCountByLevel.get(level) ?? 1;
    // Whole row-pitch steps only: fractional offsets leave columns on
    // different lattices, and the pin-alignment slides (≤64px) can then snap
    // two parts onto the same point. Same-lattice rows can never collide.
    const centerOffset = Math.floor((tallestColumn - columnRows) / 2) * ROW_PITCH;
    return {
      id: `ai-component-${index + 1}`,
      kind: component.kind,
      x: 160 + level * COLUMN_PITCH,
      y: 208 + row * ROW_PITCH + centerOffset,
      rotation: rotationForComponent(component, levels, netByPin, netMembers),
      value: component.value ?? CATALOG_BY_KIND[component.kind].defaultValue,
      label: component.ref,
    };
  });
  alignConnectedPins(plan, components);
  return components;
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

function pointsEqual(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Reject drawings where wires miss the symbols they claim to connect. This is
 * the geometric stand-in for a screenshot QA pass: every wire end must land on
 * a real Tau pin (or the ground origin), and no two parts may share a center.
 */
export function assertAssistantDrawingIntegrity(
  components: readonly SchematicComponent[],
  wires: readonly SchematicWire[],
): void {
  const pinPoints: Point[] = [];
  const centers = new Map<string, string>();
  for (const component of components) {
    const key = `${component.x},${component.y}`;
    const occupant = centers.get(key);
    if (occupant !== undefined) {
      throw new Error(
        `Tau layout overlapped ${component.label || component.kind} onto ${occupant} at (${component.x}, ${component.y})`,
      );
    }
    centers.set(key, component.label || component.kind);
    for (const pin of getComponentPins(component)) pinPoints.push({ x: pin.x, y: pin.y });
  }
  for (const wire of wires) {
    if (wire.points.length < 2) throw new Error("Tau layout produced an empty wire");
    for (const end of [wire.points[0], wire.points[wire.points.length - 1]]) {
      const onPin = pinPoints.some((pin) => pointsEqual(pin, end));
      if (!onPin) {
        throw new Error(
          `Tau layout left a wire floating at (${end.x}, ${end.y}) - not attached to any symbol pin`,
        );
      }
    }
  }
}

/**
 * SVG snapshot of an assistant layout for visual regression / human QA.
 * Coordinates match the schematic canvas (y grows downward).
 */
export function assistantSchematicSvg(
  components: readonly SchematicComponent[],
  wires: readonly SchematicWire[],
  netLabels: readonly NetLabel[] = [],
): string {
  const pins = components.flatMap((component) => getComponentPins(component));
  const xs = [...components.map((c) => c.x), ...wires.flatMap((w) => w.points.map((p) => p.x)), 0];
  const ys = [...components.map((c) => c.y), ...wires.flatMap((w) => w.points.map((p) => p.y)), 0];
  const minX = Math.min(...xs) - 64;
  const minY = Math.min(...ys) - 64;
  const maxX = Math.max(...xs) + 64;
  const maxY = Math.max(...ys) + 64;
  const body = [
    ...wires.map((wire) => {
      const d = wire.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
      return `<path d="${d}" fill="none" stroke="#ccc" stroke-width="2"/>`;
    }),
    ...components.map((component) =>
      `<g transform="translate(${component.x} ${component.y}) rotate(${component.rotation})">`
      + `<rect x="-24" y="-16" width="48" height="32" fill="none" stroke="#8cf" stroke-width="2"/>`
      + `<text y="4" text-anchor="middle" fill="#8cf" font-size="12">${component.label || component.kind}</text>`
      + `</g>`,
    ),
    ...pins.map((pin) => `<circle cx="${pin.x}" cy="${pin.y}" r="3" fill="#f66"/>`),
    ...netLabels.map((label) =>
      `<text x="${label.x + 6}" y="${label.y - 6}" fill="#8f8" font-size="11">${label.text}</text>`,
    ),
  ].join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}">${body}</svg>`;
}

function compileDocument(plan: DirectCircuitPlan): {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels: NetLabel[];
} {
  // Layout and route against Tau's native pin banks only. Routing against
  // LTspice ASC pin overrides made wires attach to coordinates the canvas
  // symbols do not draw - the "disconnected spaghetti" failure mode.
  const components = layoutComponents(plan);
  const groundNet = plan.nets.find((net) => net.name === "0");
  if (!groundNet) throw new Error("circuit plan needs a 0 ground net");
  const groundOrigin = pinPoint(components, groundNet.pins[0]);
  const groundX = Math.round(groundOrigin.x / GRID) * GRID;
  let groundY = Math.round((groundOrigin.y + 64) / GRID) * GRID;
  // The anchor pin's column may continue below it (a stacked source column):
  // slide the symbol further down until it clears every component box, or it
  // renders on top of the next part's body.
  for (let nudge = 0; nudge < 4; nudge += 1) {
    const collides = components.some((other) =>
      Math.abs(other.x - groundX) < 96 && Math.abs(other.y - groundY) < 96,
    );
    if (!collides) break;
    groundY += 80;
  }
  components.push({
    id: "ai-ground-1",
    kind: "ground",
    x: groundX,
    y: groundY,
    rotation: 0,
    value: "",
    label: "",
  });

  const wires: SchematicWire[] = [];
  const netLabels: NetLabel[] = [];
  let wireIndex = 1;
  let labelIndex = 1;
  for (const net of plan.nets) {
    // Wires already created for this same logical net are valid junctions, not
    // obstacles. Feeding them back into the generic crossing-avoidance scorer
    // makes a high-fanout star quadratic in its own harmless branches and can
    // turn the maximum 80-part AI plan into a multi-second route. Freeze only
    // wires from earlier, electrically distinct nets as blockers.
    const blockingWires = [...wires];
    const points = net.pins.map((token) => pinPoint(components, token));
    const ground = components[components.length - 1];
    if (net.name === "0") points.push({ x: ground.x, y: ground.y });
    if (points.length > LABELED_FANOUT_THRESHOLD) {
      const labelPoints = net.name === "0" ? points.slice(0, -1) : points;
      for (const point of labelPoints) {
        netLabels.push({
          id: `ai-label-${labelIndex++}`,
          x: point.x,
          y: point.y,
          text: net.name,
        });
      }
      continue;
    }
    const anchor = points[0];
    const connected = [anchor];
    for (const target of points.slice(1)) {
      const source = connected.reduce((nearest, candidate) => {
        const candidateDistance = Math.abs(candidate.x - target.x) + Math.abs(candidate.y - target.y);
        const nearestDistance = Math.abs(nearest.x - target.x) + Math.abs(nearest.y - target.y);
        return candidateDistance < nearestDistance ? candidate : nearest;
      }, connected[0]);
      const route = routeWireSmart(source, target, components, blockingWires);
      if (route.length > 1) wires.push({ id: `ai-wire-${wireIndex++}`, points: route });
      connected.push(target);
    }
    if (net.name !== "0") {
      netLabels.push({ id: `ai-label-${labelIndex++}`, x: anchor.x, y: anchor.y, text: net.name });
    }
  }
  assertAssistantDrawingIntegrity(components, wires);
  return { components, wires, netLabels };
}

/** Prove the on-canvas (native Tau) document preserves the requested nets. */
function validateNativeTopology(
  plan: DirectCircuitPlan,
  components: readonly SchematicComponent[],
  wires: readonly SchematicWire[],
  netLabels: readonly NetLabel[],
): void {
  const circuit = extractCircuit(
    [...components],
    [...wires],
    [...netLabels],
  );
  const pinsByRef = new Map(circuit.components.map(({ component, pins }) => [component.label, pins]));
  const actualToExpected = new Map<string, string>();

  for (const net of plan.nets) {
    const actualNodes = new Set<string>();
    for (const token of net.pins) {
      const split = token.lastIndexOf(".");
      const ref = token.slice(0, split);
      const pin = token.slice(split + 1);
      const actualNode = pinsByRef.get(ref)?.[pin];
      if (!actualNode) throw new Error(`Tau could not preserve requested connectivity for ${token}`);
      actualNodes.add(actualNode);
    }
    if (actualNodes.size !== 1) {
      throw new Error(`Tau could not preserve requested connectivity for net ${net.name}`);
    }
    const actualNode = [...actualNodes][0];
    const otherNet = actualToExpected.get(actualNode);
    if (otherNet && otherNet !== net.name) {
      console.log("DBG node", actualNode, "nets", otherNet, net.name);
      for (const c of circuit.components) console.log("DBG comp", c.component.label, c.component.x, c.component.y, JSON.stringify(c.pins));
      for (const w of wires) console.log("DBG wire", JSON.stringify(w.points));
      throw new Error(`Tau could not preserve requested isolation between nets ${otherNet} and ${net.name}`);
    }
    actualToExpected.set(actualNode, net.name);
  }
}

export function compileAssistantCircuitPlan(id: string, input: unknown): AssistantAscAction {
  if (!id || id.length > 160) throw new Error("tool call has no valid id");
  const plan = parsePlan(input);
  const loweredPlan = lowerCompositePlan(plan);
  const native = compileDocument(loweredPlan);
  validateNativeTopology(loweredPlan, native.components, native.wires, native.netLabels);
  assertAssistantDrawingIntegrity(native.components, native.wires);

  const exported = schematicToAsc({ ...native, directives: loweredPlan.directives });
  const lossy = exported.warnings.filter((warning) => /skipped|no LTspice symbol/i.test(warning));
  if (lossy.length > 0) throw new Error(lossy[0]);

  // ASC is the durable file format; the in-app document must stay on Tau's
  // native pin geometry so the canvas symbols and wires actually meet.
  const nativeDocument = {
    components: native.components,
    wires: native.wires,
    probes: [] as [],
    netLabels: native.netLabels,
    directives: loweredPlan.directives,
  };
  const action = plan.mode === "create"
    ? parseCreateAscAction(id, { filename: plan.filename, source: exported.text }, true)
    : parseApplyCurrentAscAction(id, { source: exported.text }, true);
  return {
    ...action,
    document: nativeDocument,
    componentCount: native.components.filter((component) => component.kind !== "ground").length,
    wireCount: native.wires.length,
  };
}
