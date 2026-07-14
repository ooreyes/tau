/**
 * Safe, pure boundary between an assistant tool call and Tau's document/file
 * layer. Model-authored prose never passes through this module: only a typed
 * `tool_use` block with a valid LTspice payload can become a pending action.
 */
import { importAsc, parseAsc } from "../io/ascImport";
import { MAX_SCHEMATIC_FILE_BYTES } from "../schematic/documentValidation";
import type { SchematicDocument } from "../store/useSchematic";
import type Anthropic from "@anthropic-ai/sdk";

export const CREATE_ASC_TOOL_NAME = "create_asc_circuit";

export const CREATE_ASC_TOOL = {
  name: CREATE_ASC_TOOL_NAME,
  description:
    "Propose a new LTspice-compatible .asc schematic. Use this only when the user asks to create a circuit. "
    + "The source must be a complete raw LTspice Version 4 schematic, not Markdown or commentary. "
    + "Tau validates it and asks the user for confirmation before creating a file.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      filename: {
        type: "string",
        minLength: 1,
        maxLength: 120,
        description: "A leaf filename ending in .asc, with no folder or path separators.",
      },
      source: {
        type: "string",
        minLength: 1,
        maxLength: MAX_SCHEMATIC_FILE_BYTES,
        description: "Complete raw LTspice .asc text beginning with Version 4 and SHEET; never wrap it in a code fence.",
      },
    },
    required: ["filename", "source"],
  },
} satisfies Anthropic.Tool;

export interface AssistantCreateAscAction {
  type: "create_asc";
  /** Anthropic tool-use id; also a stable key for confirmation state. */
  id: string;
  filename: string;
  /** Validated, raw Version 4 ASC source. */
  source: string;
  /** Parsed document for callers that apply in memory rather than create a file. */
  document: SchematicDocument;
  componentCount: number;
  wireCount: number;
}

export interface AssistantActionParseResult {
  actions: AssistantCreateAscAction[];
  /** Deliberately kept out of the transcript; useful for a safe generic UI error. */
  rejected: string[];
}

interface ToolUseLike {
  id: string;
  name: string;
  input: unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function toolUse(block: unknown): ToolUseLike | null {
  const candidate = record(block);
  if (!candidate || candidate.type !== "tool_use") return null;
  if (typeof candidate.id !== "string" || typeof candidate.name !== "string") return null;
  return { id: candidate.id, name: candidate.name, input: candidate.input };
}

function safeFilename(value: unknown): string {
  if (typeof value !== "string") throw new Error("filename must be a string");
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120 || /[\\/\u0000-\u001f]/.test(trimmed)) {
    throw new Error("filename must be a safe leaf name");
  }
  if (trimmed === "." || trimmed === ".." || trimmed.startsWith(".")) {
    throw new Error("filename must not be hidden or relative");
  }
  if (/\.asc$/i.test(trimmed)) return trimmed;
  if (trimmed.includes(".")) throw new Error("filename must end in .asc");
  return `${trimmed}.asc`;
}

function validatedAscSource(value: unknown): {
  source: string;
  document: SchematicDocument;
  componentCount: number;
  wireCount: number;
} {
  if (typeof value !== "string") throw new Error("source must be a string");
  const byteLength = new TextEncoder().encode(value).byteLength;
  if (byteLength === 0 || byteLength > MAX_SCHEMATIC_FILE_BYTES || value.includes("\u0000")) {
    throw new Error("source is empty or exceeds Tau's schematic limit");
  }
  // Do not repair Markdown fences or extract a plausible-looking substring.
  // The exact model tool payload is the exact text the file callback receives.
  const source = value.replace(/\r\n?/g, "\n");
  const firstLine = source.split("\n").find((line) => line.trim())?.trim();
  if (firstLine !== "Version 4" || !/^SHEET\s+\d+\s+\d+\s+\d+\s*$/m.test(source)) {
    throw new Error("source is not a complete LTspice Version 4 schematic");
  }

  const parsed = parseAsc(source);
  if (parsed.version !== 4 || parsed.sheet.width <= 0 || parsed.sheet.height <= 0) {
    throw new Error("source has an invalid ASC header");
  }
  if (parsed.unknown.length > 0) throw new Error("source contains unsupported ASC records");
  if (parsed.symbols.length === 0) throw new Error("source does not contain a circuit component");
  if (!parsed.flags.some((flag) => flag.net === "0")) throw new Error("source has no ground reference");

  const imported = importAsc(source);
  if (imported.components.length === 0 || imported.warnings.length > 0) {
    throw new Error("source cannot be imported faithfully by Tau");
  }

  return {
    source,
    document: {
      components: imported.components,
      wires: imported.wires,
      probes: [],
      netLabels: imported.netLabels,
      directives: imported.directives,
    },
    componentCount: imported.components.filter((component) => component.kind !== "ground").length,
    wireCount: imported.wires.length,
  };
}

export function parseCreateAscAction(id: string, input: unknown): AssistantCreateAscAction {
  if (!id || id.length > 160) throw new Error("tool call has no valid id");
  const payload = record(input);
  if (!payload) throw new Error("tool input must be an object");
  const allowed = new Set(["filename", "source"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) throw new Error("tool input contains unknown fields");
  const filename = safeFilename(payload.filename);
  const asc = validatedAscSource(payload.source);
  return { type: "create_asc", id, filename, ...asc };
}

/** Parse at most one creation request from a completed assistant message. */
export function parseAssistantActions(content: readonly unknown[]): AssistantActionParseResult {
  const actions: AssistantCreateAscAction[] = [];
  const rejected: string[] = [];
  for (const block of content) {
    const call = toolUse(block);
    if (!call || call.name !== CREATE_ASC_TOOL_NAME) continue;
    if (actions.length > 0) {
      rejected.push("Only one circuit can be proposed in a turn.");
      continue;
    }
    try {
      actions.push(parseCreateAscAction(call.id, call.input));
    } catch (error) {
      rejected.push(error instanceof Error ? error.message : "Invalid circuit proposal.");
    }
  }
  return { actions, rejected };
}
