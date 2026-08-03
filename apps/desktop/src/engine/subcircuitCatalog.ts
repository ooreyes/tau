import { bundledSubcircuitBlock, bundledSubcircuitNames } from "./bundledSubcircuits";
import { modelLibLinesFromDirectives } from "./modelDirectives";
import { parseUserModelLibraries } from "./userModelLibrary";

export interface SubcircuitLibraryText {
  readonly name: string;
  readonly text: string;
}

export interface SubcircuitParameter {
  readonly name: string;
  readonly defaultValue: string;
  readonly label?: string;
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly minExclusive?: boolean;
  readonly description?: string;
}

export interface SubcircuitOption {
  readonly name: string;
  readonly ports: readonly string[];
  readonly parameters: readonly SubcircuitParameter[];
  readonly source: "document" | "library" | "bundled";
  readonly sourceLabel: string;
}

export interface SubcircuitInstanceValue {
  readonly name: string;
  readonly overrides: ReadonlyMap<string, string>;
}

const ASSIGNMENT = /([A-Za-z_][\w.]*)\s*=\s*(\{[^}]*\}|"[^"]*"|'[^']*'|[^\s]+)/g;

const BUNDLED_PARAMETER_UI: Readonly<Record<string, Readonly<Record<string, Omit<SubcircuitParameter, "name" | "defaultValue">>>>> = {
  taudeadtimedriver: {
    dead: {
      label: "Dead time",
      unit: "s",
      min: 1e-12,
      max: 1,
      minExclusive: false,
      description: "Blanking interval between one gate turning off and the other turning on.",
    },
    threshold: {
      label: "Input threshold",
      min: 0.1,
      max: 0.9,
      description: "PWM switching threshold as a fraction from VEE (0) to VCC (1).",
    },
    hysteresis: {
      label: "Input hysteresis",
      min: 0,
      max: 0.2,
      description: "Normalized Schmitt band around the input threshold.",
    },
    transition: {
      label: "Gate transition",
      unit: "s",
      min: 1e-12,
      max: 1e-3,
      description: "Analog rise/fall time of each gate command.",
    },
    rout: {
      label: "Output resistance",
      unit: "Ω",
      min: 1e-3,
      max: 1e6,
      description: "Series resistance between the ideal rail-scaled driver and each gate.",
    },
  },
};

/** Read the public contract of a `.subckt` without interpreting its body. */
export function describeSubcircuit(block: string): Pick<SubcircuitOption, "name" | "ports" | "parameters"> | null {
  const lines = block.replace(/\r\n/g, "\n").split("\n");
  const headerIndex = lines.findIndex((line) => /^\s*\.subckt\b/i.test(line));
  if (headerIndex < 0) return null;
  let header = lines[headerIndex].trim();
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const continuation = lines[index].trim();
    if (!continuation.startsWith("+")) break;
    header += ` ${continuation.slice(1).trim()}`;
  }
  const match = /^\s*\.subckt\s+([^\s(]+)(?:\s+(.*))?$/i.exec(header.trim());
  if (!match) return null;
  const name = match[1];
  const tail = match[2]?.trim() ?? "";
  const tokens = tail.match(/\{[^}]*\}|"[^"]*"|'[^']*'|\S+/g) ?? [];
  let parameterStart = tokens.findIndex((token) => /^params?:$/i.test(token) || /^[A-Za-z_][\w.]*=/.test(token));
  if (parameterStart < 0) parameterStart = tokens.length;
  const ports = tokens.slice(0, parameterStart).filter((token) => token !== "");
  const parameterText = tokens.slice(parameterStart)
    .filter((token) => !/^params?:$/i.test(token))
    .join(" ");
  const parameters: SubcircuitParameter[] = [];
  for (const assignment of parameterText.matchAll(ASSIGNMENT)) {
    parameters.push({ name: assignment[1], defaultValue: assignment[2] });
  }
  if (ports.length === 0 || ports.length > 64) return null;
  return { name, ports, parameters };
}

function addBlocks(
  options: SubcircuitOption[],
  claimed: Set<string>,
  blocks: Iterable<string>,
  source: SubcircuitOption["source"],
  sourceLabel: string,
) {
  const found: SubcircuitOption[] = [];
  for (const block of blocks) {
    const descriptor = describeSubcircuit(block);
    if (!descriptor) continue;
    const key = descriptor.name.toLowerCase();
    if (claimed.has(key)) continue;
    claimed.add(key);
    const ui = source === "bundled" ? BUNDLED_PARAMETER_UI[key] : undefined;
    found.push({
      ...descriptor,
      parameters: descriptor.parameters.map((parameter) => ({
        ...parameter,
        ...(ui?.[parameter.name.toLowerCase()] ?? {}),
      })),
      source,
      sourceLabel,
    });
  }
  found.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  options.push(...found);
}

/** Definitions in the same first-wins order used by the native deck. */
export function subcircuitOptions(
  directives: readonly string[],
  libraries: readonly SubcircuitLibraryText[],
): SubcircuitOption[] {
  const options: SubcircuitOption[] = [];
  const claimed = new Set<string>();
  const document = parseUserModelLibraries([modelLibLinesFromDirectives(directives).join("\n")]);
  addBlocks(options, claimed, document.subckts.values(), "document", "This document");
  for (const library of libraries) {
    const registry = parseUserModelLibraries([library.text]);
    addBlocks(options, claimed, registry.subckts.values(), "library", library.name);
  }
  const bundled = [...bundledSubcircuitNames()]
    .map((name) => bundledSubcircuitBlock(name))
    .filter((block): block is string => block !== null);
  addBlocks(options, claimed, bundled, "bundled", "Tau bundled subcircuits");
  return options;
}

export function parseSubcircuitInstanceValue(value: string): SubcircuitInstanceValue {
  const trimmed = value.trim();
  const name = trimmed.split(/\s+/, 1)[0] ?? "";
  const overrides = new Map<string, string>();
  const tail = trimmed.slice(name.length);
  for (const assignment of tail.matchAll(ASSIGNMENT)) {
    overrides.set(assignment[1], assignment[2]);
  }
  return { name, overrides };
}

export function subcircuitParameterValue(
  overrides: ReadonlyMap<string, string>,
  parameterName: string,
): string | undefined {
  const key = parameterName.toLowerCase();
  for (const [name, value] of overrides) {
    if (name.toLowerCase() === key) return value;
  }
  return undefined;
}

export function encodeSubcircuitInstanceValue(name: string, overrides: ReadonlyMap<string, string>): string {
  const assignments = [...overrides]
    .filter(([key, value]) => /^[A-Za-z_][\w.]*$/.test(key) && value.trim() !== "")
    .map(([key, value]) => `${key}=${value.trim()}`);
  return [name.trim(), ...assignments].filter(Boolean).join(" ");
}
