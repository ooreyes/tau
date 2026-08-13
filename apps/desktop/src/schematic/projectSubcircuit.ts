import type { ProjectSheetPort, ProjectSubcircuitLink, SchematicPortDirection } from "./types";

/** A sheet interface larger than this is not practical to render or inspect. */
export const MAX_PROJECT_SUBCIRCUIT_PORTS = 64;
export const MAX_PROJECT_SHEET_PATH_LENGTH = 1_024;
export const MAX_PROJECT_SUBCIRCUIT_NAME_LENGTH = 80;

/**
 * Tau generates these names directly into a native deck. Keep the grammar
 * intentionally narrower than ngspice's full identifier grammar so a project
 * link never depends on a sanitizer silently changing an interface name.
 */
export const PROJECT_SPICE_TOKEN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const PORT_DIRECTIONS = new Set<SchematicPortDirection>(["In", "Out", "BiDir"]);

function issueForToken(value: unknown, role: string): string | null {
  if (typeof value !== "string" || !value || value.length > MAX_PROJECT_SUBCIRCUIT_NAME_LENGTH || !PROJECT_SPICE_TOKEN.test(value)) {
    return `${role} must be a SPICE-safe name starting with a letter or underscore.`;
  }
  return null;
}

/**
 * Normalize a path that is intentionally *relative to the open project*.
 * Returning null means the input is outside that sandbox or ambiguous. The
 * persisted value is required to already equal this spelling; callers that
 * accept text input may use this once before committing an edit.
 */
export function canonicalProjectSheetPath(value: string): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PROJECT_SHEET_PATH_LENGTH) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!normalized || normalized.startsWith("/")) return null;
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  if (!/\.(?:sim|tau\.json)$/i.test(normalized)) return null;
  return normalized;
}

/** Validation result suitable for an inspector/store without throwing. */
export interface ProjectSubcircuitValidationResult {
  ok: boolean;
  error?: string;
}

/** Validate a linked-sheet instance contract without changing it. */
export function projectSubcircuitLinkValidation(
  link: Pick<ProjectSubcircuitLink, "sheetPath" | "model" | "ports">,
): ProjectSubcircuitValidationResult {
  if (!link || typeof link !== "object") return { ok: false, error: "Linked sheet contract must be an object." };
  const canonicalPath = canonicalProjectSheetPath(link.sheetPath);
  if (!canonicalPath || canonicalPath !== link.sheetPath) {
    return { ok: false, error: "Linked sheet path must be a canonical project-relative path." };
  }
  const modelIssue = issueForToken(link.model, "Linked subcircuit name");
  if (modelIssue) return { ok: false, error: modelIssue };
  if (!Array.isArray(link.ports) || link.ports.length === 0 || link.ports.length > MAX_PROJECT_SUBCIRCUIT_PORTS) {
    return { ok: false, error: `Linked subcircuit needs between 1 and ${MAX_PROJECT_SUBCIRCUIT_PORTS} ordered ports.` };
  }
  const names = new Set<string>();
  for (const port of link.ports) {
    const portIssue = issueForToken(port, "Linked port name");
    if (portIssue) return { ok: false, error: portIssue };
    const key = port.toLocaleLowerCase();
    if (names.has(key)) return { ok: false, error: `Linked port name "${port}" is duplicated.` };
    names.add(key);
  }
  return { ok: true };
}

/** Validate ordered public sheet ports without inferring anything from labels. */
export function projectSheetPortsValidation(
  ports: readonly Pick<ProjectSheetPort, "name" | "labelId" | "direction">[],
): ProjectSubcircuitValidationResult {
  if (!Array.isArray(ports)) return { ok: false, error: "Sheet ports must be an array." };
  if (ports.length > MAX_PROJECT_SUBCIRCUIT_PORTS) {
    return { ok: false, error: `A sheet supports at most ${MAX_PROJECT_SUBCIRCUIT_PORTS} public ports.` };
  }
  const names = new Set<string>();
  const labels = new Set<string>();
  for (const port of ports) {
    if (!port || typeof port !== "object") return { ok: false, error: "Sheet port must be an object." };
    const nameIssue = issueForToken(port.name, "Sheet port name");
    if (nameIssue) return { ok: false, error: nameIssue };
    if (typeof port.labelId !== "string" || !port.labelId || port.labelId.length > 128 || /[\u0000-\u001f\u007f]/.test(port.labelId)) {
      return { ok: false, error: "Sheet port label identity is invalid." };
    }
    if (!PORT_DIRECTIONS.has(port.direction)) {
      return { ok: false, error: "Sheet port direction must be In, Out, or BiDir." };
    }
    const nameKey = port.name.toLocaleLowerCase();
    const labelKey = port.labelId.toLocaleLowerCase();
    if (names.has(nameKey)) return { ok: false, error: `Sheet port name "${port.name}" is duplicated.` };
    if (labels.has(labelKey)) return { ok: false, error: "A net label can define only one sheet port." };
    names.add(nameKey);
    labels.add(labelKey);
  }
  return { ok: true };
}

/** Case-insensitive but order-sensitive comparison of a link and child sheet. */
export function hasMatchingOrderedProjectPorts(
  linkPorts: readonly string[],
  sheetPorts: readonly Pick<ProjectSheetPort, "name">[],
): boolean {
  return linkPorts.length === sheetPorts.length && linkPorts.every((port, index) =>
    port.toLocaleLowerCase() === sheetPorts[index]?.name.toLocaleLowerCase());
}
