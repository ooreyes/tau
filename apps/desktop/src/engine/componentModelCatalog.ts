import type { ComponentKind } from "../schematic/types";
import { modelLibLinesFromDirectives } from "./modelDirectives";
import { standardModelCatalog } from "./standardModels";
import { parseUserModelLibraries, type UserModelLibraryRegistry } from "./userModelLibrary";

export type ModelComponentKind =
  | "diode"
  | "led"
  | "zener"
  | "nmos"
  | "pmos"
  | "njf"
  | "pjf"
  | "npn"
  | "pnp";

export interface ModelLibraryText {
  readonly name: string;
  readonly text: string;
}

export interface ComponentModelOption {
  readonly name: string;
  readonly modelType: string;
  readonly source: "generic" | "document" | "library" | "bundled";
  readonly sourceLabel: string;
}

const MODEL_KINDS = new Set<ComponentKind>([
  "diode", "led", "zener", "nmos", "pmos", "njf", "pjf", "npn", "pnp",
]);

const GENERIC_MODELS: Record<ModelComponentKind, string> = {
  diode: "D",
  led: "LED",
  zener: "5V1",
  nmos: "NMOS",
  pmos: "PMOS",
  njf: "NJF",
  pjf: "PJF",
  npn: "NPN",
  pnp: "PNP",
};

export function isModelComponentKind(kind: ComponentKind): kind is ModelComponentKind {
  return MODEL_KINDS.has(kind);
}

function modelDescriptor(line: string): { name: string; type: string; pChannel: boolean } | null {
  const match = /^\.model\s+(\S+)\s+([A-Za-z][\w-]*)/i.exec(line.trim());
  if (!match) return null;
  const type = match[2].toLowerCase().replace(/^l(?=npn$|pnp$)/, "");
  return {
    name: match[1],
    type,
    pChannel: type === "pmos" || (type === "vdmos" && /\bpchan(?:nel)?\b/i.test(line)),
  };
}

function isCompatible(kind: ModelComponentKind, descriptor: { type: string; pChannel: boolean }): boolean {
  switch (kind) {
    case "diode":
    case "led":
    case "zener":
      return descriptor.type === "d";
    case "npn":
      return descriptor.type === "npn";
    case "pnp":
      return descriptor.type === "pnp";
    case "njf":
      return descriptor.type === "njf";
    case "pjf":
      return descriptor.type === "pjf";
    case "nmos":
      return descriptor.type === "nmos" || (descriptor.type === "vdmos" && !descriptor.pChannel);
    case "pmos":
      return descriptor.type === "pmos" || (descriptor.type === "vdmos" && descriptor.pChannel);
  }
}

function addRegistry(
  options: ComponentModelOption[],
  claimed: Set<string>,
  kind: ModelComponentKind,
  registry: UserModelLibraryRegistry,
  source: ComponentModelOption["source"],
  sourceLabel: string,
) {
  const found: ComponentModelOption[] = [];
  for (const line of registry.models.values()) {
    const descriptor = modelDescriptor(line);
    if (!descriptor || !isCompatible(kind, descriptor)) continue;
    const key = descriptor.name.toLowerCase();
    if (claimed.has(key)) continue;
    claimed.add(key);
    found.push({
      name: descriptor.name,
      modelType: descriptor.type,
      source,
      sourceLabel,
    });
  }
  found.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  options.push(...found);
}

/**
 * Models that the selected schematic symbol can actually instantiate, in the
 * same resolution order as the native deck: document, attached libraries,
 * then Tau's exact bundled parts. Wrong-polarity VDMOS and wrong device types
 * are omitted instead of offering a choice that ngspice would reject.
 */
export function componentModelOptions(
  kind: ModelComponentKind,
  directives: readonly string[],
  libraries: readonly ModelLibraryText[],
): ComponentModelOption[] {
  const genericName = GENERIC_MODELS[kind];
  const options: ComponentModelOption[] = [{
    name: genericName,
    modelType: kind,
    source: "generic",
    sourceLabel: `Tau generic ${kind.toUpperCase()}`,
  }];
  const claimed = new Set([genericName.toLowerCase()]);

  const documentText = modelLibLinesFromDirectives(directives).join("\n");
  if (documentText) {
    addRegistry(options, claimed, kind, parseUserModelLibraries([documentText]), "document", "This document");
  }
  for (const library of libraries) {
    addRegistry(options, claimed, kind, parseUserModelLibraries([library.text]), "library", library.name);
  }

  const bundledRegistry: UserModelLibraryRegistry = {
    models: new Map(standardModelCatalog().map((entry) => [entry.name.toLowerCase(), entry.line])),
    subckts: new Map(),
  };
  addRegistry(options, claimed, kind, bundledRegistry, "bundled", "Tau exact models");
  return options;
}
