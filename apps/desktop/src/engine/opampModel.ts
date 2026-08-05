import type { SchematicComponent } from "../schematic/types";
import { sanitizeSubcktName } from "./bundledSubcircuits";
import {
  parseUserModelLibraries,
  resolveUserSubckt,
  type UserModelLibraryRegistry,
} from "./userModelLibrary";

/** Imported LTspice symbols whose behavior is defined by Tau's explicit
 * Universal/ideal implementation, not by a named vendor macromodel. */
const BEHAVIORAL_SYMBOLS = new Set([
  "opamp2",
  "universalopamp",
  "universalopamp1",
  "universalopamp2",
]);

export interface VendorOpampIdentity {
  mode: "vendor";
  /** Visible part/symbol identity, which may differ from the subckt name. */
  partName: string;
  /** Exact `.subckt` selected for simulation (OP07 may select LT1001, etc.). */
  modelName: string;
  imported: boolean;
}

export interface BehavioralOpampIdentity {
  mode: "behavioral";
  partName: string;
  imported: boolean;
}

export type OpampIdentity = VendorOpampIdentity | BehavioralOpampIdentity;

export interface OpampSubcktHeader {
  name: string;
  ports: string[];
}

export type OpampModelStatus =
  | { kind: "behavioral" }
  | { kind: "missing"; identity: VendorOpampIdentity }
  | { kind: "incompatible"; identity: VendorOpampIdentity; portCount: number }
  | {
    kind: "ready";
    identity: VendorOpampIdentity;
    block: string | null;
    header: OpampSubcktHeader;
    source: "document" | "library";
  };

function symbolLeaf(component: SchematicComponent): string {
  const parts = (component.ltSymbolType ?? "").trim().split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

function firstModelToken(value: string | undefined): string | null {
  const token = value?.trim().split(/\s+/)[0] ?? "";
  return token && !token.includes("=") ? token : null;
}

/**
 * Decode the visible part identity separately from the subcircuit identity.
 * LTspice's five-pin vendor symbols use `Value` for the part shown on canvas
 * and may use `Value2` for a different real subckt name (for example
 * `OP07` -> `LT1001`, `AD711` -> `AD712`).
 */
export function opampIdentity(component: SchematicComponent): OpampIdentity {
  const leaf = symbolLeaf(component);
  const imported = leaf !== "";
  if (imported && BEHAVIORAL_SYMBOLS.has(leaf.toLowerCase())) {
    return { mode: "behavioral", partName: leaf, imported: true };
  }

  if (imported) {
    const attrs = component.ltExtraAttrs;
    const partName = firstModelToken(attrs?.baseValue)
      ?? firstModelToken(component.value)
      ?? leaf;
    const modelName = firstModelToken(attrs?.extras.Value2)
      ?? firstModelToken(attrs?.extras.SpiceModel)
      ?? firstModelToken(component.ltModelName)
      ?? firstModelToken(component.value)
      ?? partName;
    return { mode: "vendor", partName, modelName, imported: true };
  }

  const value = component.value.trim();
  if (
    value === ""
    || value.toLowerCase() === "ideal"
    || value.includes("=")
    || /^level\./i.test(value)
  ) {
    return { mode: "behavioral", partName: value || "Ideal", imported: false };
  }
  const modelName = firstModelToken(value) ?? value;
  return { mode: "vendor", partName: modelName, modelName, imported: false };
}

/** Parse one `.subckt` header and its continuation lines. Node tokens stop at
 * `params:` or the first parameter assignment; only the external port count
 * is relevant to the five-terminal symbol contract. */
export function opampSubcktHeader(text: string, requested: string): OpampSubcktHeader | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const key = sanitizeSubcktName(requested).toLowerCase();
  for (let index = 0; index < lines.length; index += 1) {
    const first = lines[index].trim();
    const match = /^\.subckt\s+(\S+)\s*(.*)$/i.exec(first);
    if (!match || sanitizeSubcktName(match[1]).toLowerCase() !== key) continue;
    const fragments = [match[2]];
    while (index + 1 < lines.length && /^\s*\+/.test(lines[index + 1])) {
      index += 1;
      fragments.push(lines[index].replace(/^\s*\+\s*/, ""));
    }
    const tokens = fragments
      .join(" ")
      .replace(/;.*$/, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const paramsAt = tokens.findIndex((token) => /^params?:?$/i.test(token) || token.includes("="));
    return {
      name: match[1],
      ports: (paramsAt < 0 ? tokens : tokens.slice(0, paramsAt)),
    };
  }
  return null;
}

/** Resolve a vendor op-amp against document-local definitions first, then the
 * user's attached model libraries. A definition is usable only when its
 * external interface has exactly the five verified LTspice terminals. */
export function resolveOpampModel(
  component: SchematicComponent,
  directives: readonly string[],
  registry: UserModelLibraryRegistry,
): OpampModelStatus {
  const identity = opampIdentity(component);
  if (identity.mode === "behavioral") return { kind: "behavioral" };

  const documentRegistry = parseUserModelLibraries([directives.join("\n")]);
  const documentBlock = resolveUserSubckt(documentRegistry, identity.modelName);
  if (documentBlock) {
    const documentHeader = opampSubcktHeader(documentBlock, identity.modelName);
    if (!documentHeader) return { kind: "missing", identity };
    return documentHeader.ports.length === 5
      ? { kind: "ready", identity, block: documentBlock, header: documentHeader, source: "document" }
      : { kind: "incompatible", identity, portCount: documentHeader.ports.length };
  }

  const block = resolveUserSubckt(registry, identity.modelName);
  if (!block) return { kind: "missing", identity };
  const header = opampSubcktHeader(block, identity.modelName);
  if (!header) return { kind: "missing", identity };
  return header.ports.length === 5
    ? { kind: "ready", identity, block, header, source: "library" }
    : { kind: "incompatible", identity, portCount: header.ports.length };
}

/** Convenience for the Properties panel; parsing remains outside React. */
export function inspectOpampModel(
  component: SchematicComponent,
  directives: readonly string[],
  libraryTexts: readonly string[],
): OpampModelStatus {
  return resolveOpampModel(component, directives, parseUserModelLibraries(libraryTexts));
}

/**
 * Apply a model choice without collapsing LTspice's attribute slots. Imported
 * parts keep their visible `Value`; the simulation identity is written to
 * `Value2`, which is where LTspice vendor symbols store aliases. The folded
 * value is rebuilt so the existing exact ASC exporter can re-emit both slots.
 */
export function withOpampModel(component: SchematicComponent, modelName: string): SchematicComponent {
  const trimmed = modelName.trim();
  // This value becomes both a Value2 record and a deck subcircuit token. Keep
  // it one bounded token so a pasted newline/parameter fragment cannot forge
  // another ASC record or alter the generated X-device line.
  if (!trimmed || trimmed.length > 160 || /[\s=(){};]/.test(trimmed)) return component;
  const identity = opampIdentity(component);
  if (!identity.imported) return { ...component, value: trimmed };

  const provenance = component.ltExtraAttrs;
  const baseValue = provenance?.baseValue
    ?? (firstModelToken(component.value) ? component.value.trim() : "");
  const extras: Record<string, string> = { ...(provenance?.extras ?? {}), Value2: trimmed };
  const derivedValue = [baseValue, extras.Value2, extras.SpiceLine, extras.SpiceLine2]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
  return {
    ...component,
    value: derivedValue,
    ltModelName: trimmed,
    ltExtraAttrs: { baseValue, derivedValue, extras },
  };
}

export function opampModelRefusal(component: SchematicComponent, status: Exclude<OpampModelStatus, { kind: "ready" | "behavioral" }>): Error {
  const ref = component.label.trim() || component.id;
  const identity = status.identity;
  const reason = status.kind === "missing"
    ? `no document definition or attached Model Library provides it`
    : `the available definition exposes ${status.portCount} terminals instead of the required five`;
  return new Error(
    `Simulation refused: ${ref} (${identity.partName}) requires the five-terminal subcircuit "${identity.modelName}", but ${reason}. Attach a compatible vendor .lib or .subckt under Model Libraries, then run again. No approximate or partial circuit was run.`,
  );
}

/** The browser preview has only a mathematical ideal op-amp stamp and cannot
 * consume vendor subcircuits, even when the desktop deck can resolve one. */
export function previewVendorOpampMessage(components: readonly SchematicComponent[]): string | null {
  const vendor = components.filter((component) =>
    component.kind === "opamp" && opampIdentity(component).mode === "vendor",
  );
  if (vendor.length === 0) return null;
  const refs = vendor.map((component) => component.label.trim() || opampIdentity(component).partName).join(", ");
  return `${refs} ${vendor.length === 1 ? "uses a named vendor op-amp model" : "use named vendor op-amp models"}. The preview solver has only an ideal op-amp stamp and will not substitute it. Run the packaged desktop app with the matching Model Library attached.`;
}
