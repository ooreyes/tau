/**
 * LTspice `.plt` plot-settings import (waveform DoD).
 *
 * A `.plt` is ASCII: one or more `[Analysis type]` sections, each listing
 * panes with plotted expressions, X/Y ranges, and log flags. Tau parses the
 * durable bits (traces + panes + axis windows) and applies them to the
 * waveform viewer — never invents signals that are not in the file.
 */

import type { PaneLayout } from "../components/plotPanes";

/** Analysis families Tau can map a `.plt` section onto. */
export type PltAnalysisKind = "transient" | "ac" | "dc" | "noise" | "fft" | "unknown";

/** One LTspice axis tuple: `('prefix', flag, min, tick, max)`. */
export interface PltAxis {
  /** Engineering prefix glyph (`m`, `µ`, `K`, space) or `_` when the axis is unused. */
  prefix: string;
  flag: number;
  min: number;
  tick: number;
  max: number;
}

/** One plotted expression inside a pane (`{colorId,flag,"V(out)"}`). */
export interface PltTrace {
  colorId: number;
  flag: number;
  expression: string;
}

/** One vertical pane inside a `.plt` section. */
export interface PltPane {
  traces: PltTrace[];
  x: PltAxis | null;
  y0: PltAxis | null;
  y1: PltAxis | null;
  /** `Log: a b c` → X / left-Y / right-Y log flags (0 = linear). */
  log: [number, number, number] | null;
}

/** One `[Analysis …]` block from a `.plt` file. */
export interface PltSection {
  /** Raw header text without brackets, e.g. `Transient Analysis`. */
  header: string;
  kind: PltAnalysisKind;
  npanes: number;
  activePane: number | null;
  panes: PltPane[];
}

/** Full parsed `.plt` document. */
export interface PltFile {
  sections: PltSection[];
}

/** Result of mapping a section onto Tau's pane model + expression bar. */
export interface PltApplyResult {
  layout: PaneLayout;
  /** Expressions that need the plot-expression evaluator (`expr:…` ids). */
  expressions: string[];
  /** First finite X window from the file, if any. */
  xWindow: { xMin: number; xMax: number } | null;
  /** First finite left-Y window from the file, if any. */
  yWindow: { yMin: number; yMax: number } | null;
  xLog: boolean;
  yLog: boolean;
  /** Expressions present in the file that did not resolve to a known trace id. */
  unresolved: string[];
}

/** Classify an LTspice section header into a Tau analysis kind. */
export function classifyPltHeader(header: string): PltAnalysisKind {
  const h = header.trim().toLowerCase();
  // FFT headers often say "time domain data" — check before transient.
  if (h.includes("fft")) return "fft";
  if (h.includes("noise")) return "noise";
  if (h.includes("transient") || h.includes("time domain")) return "transient";
  if (h.startsWith("ac ") || h.includes("ac analysis") || h.includes("bode")) return "ac";
  if (h.includes("dc ") || h.includes("dc transfer") || h.includes("dc sweep")) return "dc";
  return "unknown";
}

/** Map Tau's UI analysis mode onto a `.plt` section kind. */
export function pltKindForMode(mode: string, stepDomain: "tran" | "ac" | "dc" = "tran"): PltAnalysisKind {
  if (mode === "tran") return "transient";
  if (mode === "ac") return "ac";
  if (mode === "dc") return "dc";
  if (mode === "noise") return "noise";
  if (mode === "step") {
    if (stepDomain === "ac") return "ac";
    if (stepDomain === "dc") return "dc";
    return "transient";
  }
  return "unknown";
}

/** First section matching `kind`, else the first section, else null. */
export function selectPltSection(file: PltFile, kind: PltAnalysisKind): PltSection | null {
  if (file.sections.length === 0) return null;
  if (kind !== "unknown") {
    const match = file.sections.find((s) => s.kind === kind);
    if (match) return match;
  }
  return file.sections[0] ?? null;
}

/**
 * Parse an LTspice `.plt` text document. Throws when the text is empty or has
 * no `[Analysis]` sections — never invents a plot configuration.
 */
export function parsePlt(text: string): PltFile {
  const src = text.replace(/^\uFEFF/, "");
  if (!src.trim()) throw new Error("The .plt file is empty.");

  const sections: PltSection[] = [];
  // Headers are whole-line `[Transient Analysis]` etc. — never mid-line
  // `Y[0]:` / `Y[1]:` axis keys.
  const headerRe = /^\[([^\]]+)\]/gm;
  let match: RegExpExecArray | null;
  const headers: { header: string; index: number; end: number }[] = [];
  while ((match = headerRe.exec(src)) !== null) {
    headers.push({ header: match[1].trim(), index: match.index, end: match.index + match[0].length });
  }
  if (headers.length === 0) {
    throw new Error("No [Analysis] section found in the .plt file.");
  }

  for (let i = 0; i < headers.length; i++) {
    const { header, end } = headers[i];
    const next = headers[i + 1]?.index ?? src.length;
    const chunk = src.slice(end, next);
    const bodyStart = chunk.indexOf("{");
    if (bodyStart < 0) continue;
    const body = extractBalanced(chunk, bodyStart);
    if (body === null) {
      throw new Error(`Unbalanced braces in [${header}] plot settings.`);
    }
    sections.push(parseSection(header, body));
  }

  if (sections.length === 0) {
    throw new Error("No usable panes found in the .plt file.");
  }
  return { sections };
}

/**
 * Map a parsed section onto Tau's pane layout + expression list.
 *
 * `resolveTraceId` turns a simple signal label (`V(out)`, `I(R1)`) into an
 * existing Tau trace id. Unresolved / arithmetic expressions become
 * `expr:<text>` ids and are listed in `expressions` for the evaluator.
 */
export function applyPltSection(
  section: PltSection,
  resolveTraceId: (expression: string) => string | null,
): PltApplyResult {
  const expressions: string[] = [];
  const unresolved: string[] = [];
  const seenExpr = new Set<string>();
  const panes: PaneLayout = [];

  for (let i = 0; i < section.panes.length; i++) {
    const pane = section.panes[i];
    const traceIds: string[] = [];
    for (const tr of pane.traces) {
      const expr = tr.expression.trim();
      if (!expr) continue;
      const resolved = resolveTraceId(expr);
      if (resolved) {
        if (!traceIds.includes(resolved)) traceIds.push(resolved);
        continue;
      }
      const exprId = `expr:${expr}`;
      if (!traceIds.includes(exprId)) traceIds.push(exprId);
      if (!seenExpr.has(expr)) {
        seenExpr.add(expr);
        expressions.push(expr);
        unresolved.push(expr);
      }
    }
    panes.push({ id: `plt-p${i}`, traceIds });
  }

  const layout: PaneLayout = panes.length > 0 ? panes : [{ id: "plt-p0", traceIds: [] }];
  const first = section.panes[0] ?? null;
  const xWindow = finiteWindow(first?.x ?? null);
  const yWindow = finiteWindow(first?.y0 ?? null);
  const log = first?.log ?? null;

  return {
    layout,
    expressions,
    xWindow: xWindow ? { xMin: xWindow.min, xMax: xWindow.max } : null,
    yWindow: yWindow ? { yMin: yWindow.min, yMax: yWindow.max } : null,
    xLog: Boolean(log && log[0] !== 0),
    yLog: Boolean(log && log[1] !== 0),
    unresolved,
  };
}

/** Build a case-insensitive label → id resolver from known traces. */
export function makePltTraceResolver(
  signals: ReadonlyArray<{ id: string; label: string }>,
): (expression: string) => string | null {
  const byLabel = new Map<string, string>();
  for (const s of signals) {
    byLabel.set(normalizeSignalKey(s.label), s.id);
    // Also accept bare net names when the label is V(net).
    const bare = s.label.match(/^[Vv]\((.+)\)$/);
    if (bare) byLabel.set(normalizeSignalKey(bare[1]), s.id);
  }
  return (expression: string) => {
    const key = normalizeSignalKey(expression);
    return byLabel.get(key) ?? null;
  };
}

/** Canonical LTspice section header for a Tau analysis kind. */
export function headerForPltKind(kind: PltAnalysisKind): string {
  switch (kind) {
    case "transient":
      return "Transient Analysis";
    case "ac":
      return "AC Analysis";
    case "dc":
      return "DC transfer characteristic";
    case "noise":
      return "Noise Spectral Density - (V/Hz½ or A/Hz½)";
    case "fft":
      return "FFT of time domain data";
    default:
      return "Transient Analysis";
  }
}

/**
 * Serialize a parsed `.plt` document back to LTspice-compatible ASCII.
 * Round-trips the durable fields Tau understands (Npanes, Active Pane, traces,
 * X/Y[0]/Y[1], Log). Volts/Amps/GridStyle chrome from foreign files is not
 * reinvented — Open→Save preserves what we parse.
 */
export function serializePlt(file: PltFile): string {
  if (file.sections.length === 0) {
    throw new Error("Cannot save an empty .plt file.");
  }
  return file.sections.map(serializeSection).join("\n");
}

/**
 * Build one `.plt` section from Tau's current pane/expression state so Save
 * round-trips with Open .plt. Trace color ids are stable 524290+i (Educational
 * convention); unused right Y uses LTspice's `_` / ±1e308 sentinel.
 */
export function buildPltSection(args: {
  kind: PltAnalysisKind;
  /** Per-pane ordered plot expressions (`V(out)`, `I(R1)`, `V(a)-V(b)`, …). */
  panes: ReadonlyArray<{ expressions: ReadonlyArray<string> }>;
  xWindow?: { xMin: number; xMax: number } | null;
  yWindow?: { yMin: number; yMax: number } | null;
  xLog?: boolean;
  yLog?: boolean;
  activePane?: number | null;
}): PltSection {
  const panesIn = args.panes.length > 0 ? args.panes : [{ expressions: [] as string[] }];
  const x = axisFromWindow(args.xWindow ?? null, " ");
  const y0 = axisFromWindow(args.yWindow ?? null, " ");
  const y1: PltAxis = { prefix: "_", flag: 0, min: 1e308, tick: 0, max: -1e308 };
  const log: [number, number, number] = [
    args.xLog ? 1 : 0,
    args.yLog ? 1 : 0,
    0,
  ];

  let color = 524290;
  const panes: PltPane[] = panesIn.map((pane) => {
    const exprs = pane.expressions.map((e) => e.trim()).filter(Boolean);
    const traces: PltTrace[] = exprs.map((expression) => {
      const tr = { colorId: color, flag: 0, expression };
      color += 1;
      return tr;
    });
    return { traces, x, y0, y1, log };
  });

  return {
    header: headerForPltKind(args.kind),
    kind: args.kind,
    npanes: panes.length,
    activePane: args.activePane ?? null,
    panes,
  };
}

/** Map a Tau trace id to a `.plt` expression (`expr:V(a)-V(b)` → `V(a)-V(b)`). */
export function expressionFromTraceId(
  traceId: string,
  labelForId: (id: string) => string | null,
): string | null {
  if (traceId.startsWith("expr:")) {
    const expr = traceId.slice("expr:".length).trim();
    return expr || null;
  }
  if (traceId.startsWith("ref:")) return null; // reference overlays are not .plt traces
  const label = labelForId(traceId);
  return label?.trim() || null;
}

// ── internals ──────────────────────────────────────────────────────────────

function normalizeSignalKey(s: string): string {
  return s.trim().replace(/\s+/g, "").toLowerCase();
}

function axisFromWindow(
  window: { xMin: number; xMax: number } | { yMin: number; yMax: number } | null,
  prefix: string,
): PltAxis | null {
  if (!window) return null;
  const min = "xMin" in window ? window.xMin : window.yMin;
  const max = "xMax" in window ? window.xMax : window.yMax;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return null;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const tick = (hi - lo) / 5;
  return { prefix, flag: 0, min: lo, tick, max: hi };
}

function serializeSection(section: PltSection): string {
  const lines: string[] = [];
  lines.push(`[${section.header}]`);
  lines.push("{");
  lines.push(`   Npanes: ${section.panes.length || section.npanes}`);
  if (section.activePane !== null && section.activePane !== undefined) {
    lines.push(`   Active Pane: ${section.activePane}`);
  }
  section.panes.forEach((pane, i) => {
    lines.push("   {");
    lines.push(`      traces: ${pane.traces.length}${serializeTraces(pane.traces)}`);
    if (pane.x) lines.push(`      X: ${serializeAxis(pane.x)}`);
    if (pane.y0) lines.push(`      Y[0]: ${serializeAxis(pane.y0)}`);
    if (pane.y1) lines.push(`      Y[1]: ${serializeAxis(pane.y1)}`);
    if (pane.log) lines.push(`      Log: ${pane.log[0]} ${pane.log[1]} ${pane.log[2]}`);
    lines.push(i < section.panes.length - 1 ? "   }," : "   }");
  });
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

function serializeTraces(traces: ReadonlyArray<PltTrace>): string {
  if (traces.length === 0) return "";
  return traces
    .map((t) => ` {${t.colorId},${t.flag},"${t.expression.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"}`)
    .join("");
}

function serializeAxis(axis: PltAxis): string {
  return `('${axis.prefix}',${axis.flag},${fmtNum(axis.min)},${fmtNum(axis.tick)},${fmtNum(axis.max)})`;
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  // Prefer compact form; keep enough digits for Educational µs windows.
  return String(n);
}

function parseSection(header: string, body: string): PltSection {
  const kind = classifyPltHeader(header);
  const npanes = readIntField(body, "Npanes") ?? 0;
  const activePane = readIntField(body, "Active Pane");
  const panes: PltPane[] = [];

  // Pane objects are the top-level `{ … }` blocks after the Npanes line.
  let searchFrom = 0;
  while (searchFrom < body.length) {
    const open = body.indexOf("{", searchFrom);
    if (open < 0) break;
    const paneBody = extractBalanced(body, open);
    if (paneBody === null) break;
    // Skip the outer section body itself: we receive body without its outer
    // braces, so every `{` here is a pane (or a nested unused block). A pane
    // must contain a `traces:` line.
    if (/\btraces\s*:/i.test(paneBody)) {
      panes.push(parsePane(paneBody));
    }
    searchFrom = open + paneBody.length + 2; // past `{` + body + `}`
  }

  return {
    header,
    kind,
    npanes: npanes || panes.length,
    activePane,
    panes,
  };
}

function parsePane(body: string): PltPane {
  return {
    traces: parseTraces(body),
    x: parseAxis(body, "X"),
    y0: parseAxis(body, "Y[0]"),
    y1: parseAxis(body, "Y[1]"),
    log: parseLog(body),
  };
}

function parseTraces(body: string): PltTrace[] {
  const line = body.match(/\btraces\s*:\s*[^\n\r]*/i)?.[0];
  if (!line) return [];
  const out: PltTrace[] = [];
  const re = /\{(\d+)\s*,\s*(\d+)\s*,\s*"((?:\\.|[^"\\])*)"\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    out.push({
      colorId: Number(m[1]),
      flag: Number(m[2]),
      expression: m[3].replace(/\\"/g, '"'),
    });
  }
  return out;
}

function parseAxis(body: string, name: string): PltAxis | null {
  // X: ('m',0,0,0.05,0.5)  — prefix may be space, underscore, or unicode µ
  const re = new RegExp(
    String.raw`${escapeRegExp(name)}\s*:\s*\('([^']*)'\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\)`,
    "i",
  );
  const m = body.match(re);
  if (!m) return null;
  const min = Number(m[3]);
  const tick = Number(m[4]);
  const max = Number(m[5]);
  if (![min, tick, max].every(Number.isFinite)) return null;
  return { prefix: m[1], flag: Number(m[2]) || 0, min, tick, max };
}

function parseLog(body: string): [number, number, number] | null {
  const m = body.match(/\bLog\s*:\s*(-?\d+)\s+(-?\d+)\s+(-?\d+)/i);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function readIntField(body: string, name: string): number | null {
  const re = new RegExp(String.raw`${escapeRegExp(name)}\s*:\s*(-?\d+)`, "i");
  const m = body.match(re);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function finiteWindow(axis: PltAxis | null): { min: number; max: number } | null {
  if (!axis) return null;
  if (axis.prefix === "_") return null;
  if (!Number.isFinite(axis.min) || !Number.isFinite(axis.max)) return null;
  // LTspice marks an unused right axis with ±1e308.
  if (Math.abs(axis.min) >= 1e307 || Math.abs(axis.max) >= 1e307) return null;
  if (axis.max === axis.min) return null;
  const min = Math.min(axis.min, axis.max);
  const max = Math.max(axis.min, axis.max);
  return { min, max };
}

/** Return the interior of the `{…}` opened at `openIdx`, or null if unbalanced. */
function extractBalanced(text: string, openIdx: number): string | null {
  if (text[openIdx] !== "{") return null;
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(openIdx + 1, i);
    }
  }
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
