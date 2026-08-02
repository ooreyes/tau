import type { SchematicComponent, SchematicForeignSymbol } from "../schematic/types";

/**
 * LTspice symbols that are retained as geometrically-correct Tau carriers but
 * do not yet have an electrically equivalent model. The carrier exists for
 * lossless editing and connectivity only; treating it as its Tau kind would
 * produce a believable but false waveform.
 */
const SAFE_IMPORTED_KIND: Record<string, SchematicComponent["kind"]> = {
  diac: "subckt",
  triac: "subckt",
  varistor: "subckt",
};

function symbolLeaf(type: string): string {
  const segments = type.trim().split(/[\\/]/);
  return segments[segments.length - 1]?.toLowerCase() ?? "";
}

function componentName(component: SchematicComponent): string {
  return component.label.trim() || component.ltSymbolType?.trim() || component.id;
}

function foreignSymbolName(symbol: SchematicForeignSymbol): string {
  return symbol.attrs.InstName?.trim() || symbol.type;
}

/**
 * Explain why running this document would misrepresent its electrical model.
 * Returns null only when every represented symbol has a simulation model.
 */
export function simulationBlockReason(
  components: readonly SchematicComponent[],
  foreignSymbols: readonly SchematicForeignSymbol[] = [],
): string | null {
  const placeholders = components.filter((component) =>
    component.ltSymbolType !== undefined
    && SAFE_IMPORTED_KIND[symbolLeaf(component.ltSymbolType)] !== undefined
    && component.kind !== SAFE_IMPORTED_KIND[symbolLeaf(component.ltSymbolType)],
  );

  if (placeholders.length === 0 && foreignSymbols.length === 0) return null;

  const unsupported = [
    ...placeholders.map((component) =>
      `${componentName(component)} (${component.ltSymbolType})`,
    ),
    ...foreignSymbols.map((symbol) => `${foreignSymbolName(symbol)} (${symbol.type})`),
  ].join(", ");

  return `Simulation refused: ${unsupported} ${placeholders.length + foreignSymbols.length === 1 ? "has" : "have"} no electrically equivalent Tau model. Replace or map each unsupported part to a user-supplied subcircuit. No approximate or partial circuit was run.`;
}

/** Refuse before deck construction or solver startup, never after partial work. */
export function assertSimulationIntegrity(
  components: readonly SchematicComponent[],
  foreignSymbols: readonly SchematicForeignSymbol[] = [],
): void {
  const reason = simulationBlockReason(components, foreignSymbols);
  if (reason) throw new Error(reason);
}
