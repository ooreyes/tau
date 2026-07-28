/**
 * Unified import format detection and routing.
 *
 * A single "Import" surface (Explorer header, the empty-state action, and
 * dropping a file on the editor) all funnel through {@link planFileImport}, so
 * format detection and conversion happen exactly once regardless of entry
 * point. Detection is CONTENT-first, extension second: `.net` is used both by
 * a flat SPICE netlist and by KiCad's own S-expression netlist export, and
 * only the content tells them apart. See `fileImport.ts` for the orchestration
 * layer (project destination, persistence, model-library attachment) built on
 * top of this pure, synchronous planner.
 */
import { decodeSchematicText } from "./ascImport";
import { schematicToAsc } from "./ascExport";
import { parseCir } from "./cirImport";
import { parseKicadNet } from "./kicadNetImport";
import { parseRaw } from "./rawImport";

export type ImportPlan =
  | {
      kind: "schematic";
      /** LTspice `.asc` text ready to persist and open - the original bytes
       *  for a genuine `.asc`, or a synthesized document for anything Tau
       *  converts into one (a SPICE or KiCad netlist). */
      ascText: string;
      /** Conversion-time warnings (e.g. a KiCad part or SPICE device Tau could
       *  not place). Empty for a native `.asc`, whose own warnings surface
       *  later, at open time, exactly as they always have. */
      warnings: string[];
      suggestedFileName: string;
      /** False only for an unmodified `.asc` - lets the caller persist the
       *  file's original bytes untouched rather than a re-encoded copy of
       *  `ascText`. */
      synthesized: boolean;
    }
  | { kind: "model-library"; name: string; text: string }
  | { kind: "unsupported"; message: string };

const MODEL_LIBRARY_EXTENSIONS = new Set(["lib", "sub", "subckt", "mod"]);
const SPICE_NETLIST_EXTENSIONS = new Set(["cir", "net", "sp", "spi", "ckt"]);
const SUPPORTED_FORMATS_SUMMARY =
  "Tau imports LTspice schematics (.asc), SPICE netlists (.cir/.net/.sp), and vendor model "
  + "libraries (.lib/.subckt/.mod).";

function extensionOf(fileName: string): string {
  const match = /\.([a-z0-9_]+)$/i.exec(fileName);
  return match ? match[1].toLowerCase() : "";
}

function withAscExtension(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9_]+$/i, "").trim();
  return `${base || "imported"}.asc`;
}

function looksLikeRawWaveform(bytes: Uint8Array): boolean {
  try {
    parseRaw(bytes);
    return true;
  } catch {
    return false;
  }
}

function firstNonBlankLine(text: string): string {
  return text.replace(/^﻿/, "").split(/\r?\n/).find((line) => line.trim() !== "")?.trim() ?? "";
}

function looksLikeAsc(text: string): boolean {
  return /^Version\s+\d/i.test(firstNonBlankLine(text)) && /^\s*SHEET\b/im.test(text);
}

function looksLikeKicadNetExport(text: string): boolean {
  return /^\s*\(export\b/.test(text);
}

function looksLikeKicadSchematic(text: string): boolean {
  return /^\s*\(kicad_sch\b/.test(text);
}

/** A vendor model file is directives only - `.subckt`/`.model` definitions
 *  with no top-level device instantiation to place on a sheet. Used only as a
 *  fallback when the extension itself doesn't already say "model library". */
function looksLikeModelLibraryOnly(text: string): boolean {
  if (!/^\s*\.(subckt|model)\b/im.test(text)) return false;
  let depth = 0;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("*")) continue;
    if (/^\.subckt\b/i.test(line)) { depth += 1; continue; }
    if (/^\.ends\b/i.test(line)) { depth = Math.max(0, depth - 1); continue; }
    if (depth > 0) continue; // inside a subckt body, not a top-level device
    if (line.startsWith(".")) continue; // another top-level directive (.model, .param, ...)
    return false; // a bare device/instance line outside any subckt
  }
  return true;
}

function looksLikeSpiceNetlist(text: string): boolean {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.some((line) => /^\.(tran|ac|op|dc|tf|noise)\b/i.test(line))
    || lines.some((line) => /^[A-Za-z][\w.]*\s+\S+\s+\S+/.test(line));
}

function convertToAsc(input: Parameters<typeof schematicToAsc>[0]): { text: string; warnings: string[] } {
  const result = schematicToAsc(input);
  return { text: result.text, warnings: result.warnings };
}

/**
 * Detect a dropped/picked file's format from its bytes and decide how (or
 * whether) Tau can import it. Pure and synchronous - no store access, no I/O -
 * so every branch is unit-testable in isolation.
 */
export function planFileImport(fileName: string, bytes: Uint8Array): ImportPlan {
  const ext = extensionOf(fileName);

  if (looksLikeRawWaveform(bytes)) {
    return {
      kind: "unsupported",
      message: `"${fileName}" holds simulation results (.raw), not a circuit to open. Open the `
        + "waveform view and use its reference-overlay control to load it against a result instead.",
    };
  }

  const text = decodeSchematicText(bytes);

  if (looksLikeKicadSchematic(text)) {
    return {
      kind: "unsupported",
      message: `"${fileName}" is a KiCad schematic. Tau does not open .kicad_sch directly yet. In `
        + "KiCad, generate a netlist (Tools > Generate Netlist File, Spice or KiCad format) and "
        + "import that file instead.",
    };
  }

  if (looksLikeKicadNetExport(text)) {
    let parsed: ReturnType<typeof parseKicadNet>;
    try {
      parsed = parseKicadNet(text);
    } catch (error) {
      return {
        kind: "unsupported",
        message: error instanceof Error ? error.message : `Could not read the KiCad netlist "${fileName}".`,
      };
    }
    const converted = convertToAsc(parsed);
    return {
      kind: "schematic",
      ascText: converted.text,
      warnings: [...parsed.warnings, ...converted.warnings],
      suggestedFileName: withAscExtension(fileName),
      synthesized: true,
    };
  }

  if (ext === "asc" || looksLikeAsc(text)) {
    return { kind: "schematic", ascText: text, warnings: [], suggestedFileName: fileName, synthesized: false };
  }

  if (MODEL_LIBRARY_EXTENSIONS.has(ext) || (!SPICE_NETLIST_EXTENSIONS.has(ext) && looksLikeModelLibraryOnly(text))) {
    return { kind: "model-library", name: fileName, text };
  }

  if (SPICE_NETLIST_EXTENSIONS.has(ext) || looksLikeSpiceNetlist(text)) {
    const parsed = parseCir(text);
    if (parsed.components.length === 0 && parsed.directives.length === 0) {
      return {
        kind: "unsupported",
        message: `Tau could not find any recognizable SPICE devices in "${fileName}". ${SUPPORTED_FORMATS_SUMMARY}`,
      };
    }
    const converted = convertToAsc({
      components: parsed.components,
      wires: parsed.wires,
      netLabels: parsed.netLabels,
      directives: parsed.directives,
      comments: parsed.comments,
    });
    return {
      kind: "schematic",
      ascText: converted.text,
      warnings: [...parsed.warnings, ...converted.warnings],
      suggestedFileName: withAscExtension(fileName),
      synthesized: true,
    };
  }

  return {
    kind: "unsupported",
    message: `Tau does not recognize "${fileName}". ${SUPPORTED_FORMATS_SUMMARY}`,
  };
}
