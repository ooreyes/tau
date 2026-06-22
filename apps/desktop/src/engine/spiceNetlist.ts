import { extractCircuit, type ExtractedCircuit, type ExtractedComponent } from "../schematic/netlist";
import type { ComponentKind, SchematicComponent, SchematicWire } from "../schematic/types";
import { parseQuantity } from "../simulation/quantity";

export type SpiceAnalysis =
  | { kind: "tran"; stopTime: number; steps: number }
  | { kind: "op" }
  | { kind: "ac"; startHz: number; stopHz: number; pointsPerDecade: number };

export interface SpiceDeck {
  circuit: ExtractedCircuit;
  netlist: string;
}

type Schematic = { components: SchematicComponent[]; wires: SchematicWire[] };

const DEFAULT_MODELS = [
  ".model TAU_DIODE D(Is=1e-14 N=1)",
  ".model TAU_LED D(Is=1e-16 N=2 Rs=10)",
  ".model TAU_ZENER D(Is=1e-14 N=1 Bv=5.1 Ibv=1m)",
  ".model TAU_NMOS NMOS(Level=1 Vto=1 Kp=200u Lambda=0.02)",
  ".model TAU_PMOS PMOS(Level=1 Vto=-1 Kp=80u Lambda=0.02)",
  ".model TAU_NPN NPN(Is=1e-14 Bf=100 Vaf=100)",
  ".model TAU_PNP PNP(Is=1e-14 Bf=100 Vaf=100)",
];

/**
 * Convert Tau's neutral schematic into a complete ngspice deck. Models here
 * are intentionally generic starter models; named vendor models belong in an
 * imported library, not in the schematic renderer or React UI.
 */
export function buildSpiceDeck(schematic: Schematic, analysis: SpiceAnalysis): SpiceDeck {
  const circuit = extractCircuit(schematic.components, schematic.wires);
  if (schematic.components.length === 0) throw new Error("Place components before running analysis.");
  if (!circuit.groundNetId) throw new Error("Add a ground symbol so node voltages have a reference.");

  const lines = ["Tau generated circuit", ".options gmin=1e-12 reltol=1e-4 abstol=1e-12 vntol=1e-7"];
  const usedKinds = new Set(schematic.components.map((component) => component.kind));
  const needsModels = ["diode", "led", "zener", "nmos", "pmos", "npn", "pnp"].some((kind) => usedKinds.has(kind as ComponentKind));
  if (needsModels) lines.push(...DEFAULT_MODELS);

  circuit.components.forEach((entry, index) => {
    lines.push(...componentLines(entry, index));
  });
  lines.push(analysisLine(analysis), ".end");

  return { circuit, netlist: lines.join("\n") };
}

function componentLines(entry: ExtractedComponent, index: number): string[] {
  const { component } = entry;
  const name = instanceName(component, index);
  const node = (pin: string) => requiredNode(entry, pin);

  switch (component.kind) {
    case "resistor":
      return [`${name} ${node("a")} ${node("b")} ${numberValue(component, "Ohm")}`];
    case "capacitor":
      return [`${name} ${node("a")} ${node("b")} ${numberValue(component, "F")}`];
    case "inductor":
      return [`${name} ${node("a")} ${node("b")} ${numberValue(component, "H")}`];
    case "vsource":
      return [`${name} ${node("p")} ${node("n")} DC ${numberValue(component, "V")}`];
    case "isource":
      return [`${name} ${node("p")} ${node("n")} DC ${numberValue(component, "A")}`];
    case "vac": {
      const signal = sourceSignal(component, "V");
      return [`${name} ${node("p")} ${node("n")} DC ${signal.offset} AC ${signal.amplitude} SIN(${signal.offset} ${signal.amplitude} ${signal.frequency})`];
    }
    case "iac": {
      const signal = sourceSignal(component, "A");
      return [`${name} ${node("p")} ${node("n")} DC ${signal.offset} AC ${signal.amplitude} SIN(${signal.offset} ${signal.amplitude} ${signal.frequency})`];
    }
    case "diode":
      return [`${name} ${node("a")} ${node("k")} TAU_DIODE`];
    case "led":
      return [`${name} ${node("a")} ${node("k")} TAU_LED`];
    case "zener":
      return [`${name} ${node("a")} ${node("k")} TAU_ZENER`];
    case "nmos":
      return [`${name} ${node("d")} ${node("g")} ${node("s")} ${node("b")} TAU_NMOS`];
    case "pmos":
      return [`${name} ${node("d")} ${node("g")} ${node("s")} ${node("b")} TAU_PMOS`];
    case "npn":
      return [`${name} ${node("c")} ${node("b")} ${node("e")} TAU_NPN`];
    case "pnp":
      return [`${name} ${node("c")} ${node("b")} ${node("e")} TAU_PNP`];
    case "opamp": {
      const base = safeName(component.label || `U${index + 1}`);
      return [
        `E_${base} ${node("out")} 0 ${node("in+")} ${node("in-")} 1e6`,
        `R_${base}_out ${node("out")} 0 1e9`,
      ];
    }
    case "potentiometer": {
      // Split the track into two equal halves around the wiper. ngspice does
      // not evaluate arithmetic in a bare value field, so emit a precomputed
      // number rather than an expression like "10000/2".
      const resistance = parsedNumber(component, "Ohm");
      const half = (resistance / 2).toString();
      const base = safeName(component.label || `RV${index + 1}`);
      return [
        `R_${base}_a ${node("a")} ${node("w")} ${half}`,
        `R_${base}_b ${node("w")} ${node("b")} ${half}`,
      ];
    }
    case "switch": {
      const closed = component.value.trim().toLowerCase().startsWith("closed");
      return [`R_${safeName(component.label || `S${index + 1}`)} ${node("a")} ${node("b")} ${closed ? "1m" : "1e12"}`];
    }
    case "transformer": {
      const base = safeName(component.label || `T${index + 1}`);
      const ratio = turnsRatio(component.value);
      const primaryInductance = 10e-3;
      const secondaryInductance = primaryInductance * (ratio.secondary / ratio.primary) ** 2;
      return [
        `L_${base}_p ${node("p1")} ${node("p2")} ${primaryInductance}`,
        `L_${base}_s ${node("s1")} ${node("s2")} ${secondaryInductance}`,
        `K_${base} L_${base}_p L_${base}_s 0.999`,
      ];
    }
    case "testpoint":
    case "ground":
      return [];
  }
}

function analysisLine(analysis: SpiceAnalysis): string {
  switch (analysis.kind) {
    case "tran": {
      if (!Number.isFinite(analysis.stopTime) || analysis.stopTime <= 0 || !Number.isInteger(analysis.steps) || analysis.steps < 2) {
        throw new Error("Transient analysis needs a positive stop time and at least two output steps.");
      }
      return `.tran ${analysis.stopTime / analysis.steps} ${analysis.stopTime}`;
    }
    case "op":
      return ".op";
    case "ac":
      if (!Number.isFinite(analysis.startHz) || !Number.isFinite(analysis.stopHz) || analysis.startHz <= 0 || analysis.stopHz <= analysis.startHz || analysis.pointsPerDecade < 1) {
        throw new Error("AC analysis needs positive start/stop frequencies and at least one point per decade.");
      }
      return `.ac dec ${Math.round(analysis.pointsPerDecade)} ${analysis.startHz} ${analysis.stopHz}`;
  }
}

function instanceName(component: SchematicComponent, index: number): string {
  const prefix: Record<ComponentKind, string> = {
    resistor: "R", capacitor: "C", inductor: "L", vsource: "V", isource: "I", vac: "V", iac: "I",
    diode: "D", led: "D", zener: "D", opamp: "E", nmos: "M", pmos: "M", npn: "Q", pnp: "Q",
    potentiometer: "R", switch: "R", transformer: "L", testpoint: "X", ground: "X",
  };
  const requested = safeName(component.label);
  return requested.startsWith(prefix[component.kind]) ? requested : `${prefix[component.kind]}${index + 1}`;
}

function requiredNode(entry: ExtractedComponent, pin: string): string {
  const value = entry.pins[pin];
  if (!value) throw new Error(`${entry.component.label || entry.component.kind} is missing its ${pin} pin.`);
  return value.toLowerCase();
}

function numberValue(component: SchematicComponent, unit: string): string {
  return parsedNumber(component, unit).toString();
}

function parsedNumber(component: SchematicComponent, unit: string): number {
  try {
    const value = parseQuantity(component.value, unit);
    if (!Number.isFinite(value)) throw new Error("not finite");
    return value;
  } catch {
    throw new Error(`${component.label || component.kind} needs a valid ${unit} value.`);
  }
}

function sourceSignal(component: SchematicComponent, unit: "V" | "A") {
  const tokens = component.value.trim().split(/[\s,;@]+/).filter(Boolean);
  try {
    if (tokens.length >= 3) {
      return { offset: parseQuantity(tokens[0], unit), amplitude: parseQuantity(tokens[1], unit), frequency: parseQuantity(tokens[2], "Hz") };
    }
    if (tokens.length === 2) {
      return { offset: 0, amplitude: parseQuantity(tokens[0], unit), frequency: parseQuantity(tokens[1], "Hz") };
    }
    if (tokens.length === 1) {
      return { offset: 0, amplitude: parseQuantity(tokens[0], unit), frequency: 1e3 };
    }
  } catch {
    // Re-throw below with a component-aware message.
  }
  throw new Error(`${component.label || component.kind} needs amplitude and frequency values.`);
}

function turnsRatio(value: string) {
  const [primaryRaw, secondaryRaw] = value.split(":").map((part) => Number(part.trim()));
  if (Number.isFinite(primaryRaw) && Number.isFinite(secondaryRaw) && primaryRaw > 0 && secondaryRaw > 0) {
    return { primary: primaryRaw, secondary: secondaryRaw };
  }
  return { primary: 1, secondary: 1 };
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, "_") || "X";
}
