/**
 * DC Sweep Analysis (.dc)
 *
 * Sweeps a single independent source's value over a linear range and records
 * the resulting DC operating point at each step. LTspice/SPICE syntax:
 *
 *   .dc <srcname> <start> <stop> <increment>
 *
 * (Nested second-source sweeps — `.dc src1 ... src2 ...` — are parsed but only
 * the primary source is swept for now; the rest is surfaced as a warning.)
 *
 * This module is SELF-CONTAINED apart from reusing `runOperatingPoint`: for each
 * swept value it overrides the named source's `value` field and solves the DC
 * point, so it inherits the exact same MNA solver (no duplicated stamping).
 */

import type { NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";
import { runOperatingPoint } from "./operatingPoint";
import { parseQuantity } from "./quantity";
import { EMPTY_SCOPE, type ParamScope } from "./paramScope";

/** Source kinds whose DC value a `.dc` sweep is allowed to drive. */
const SWEEPABLE = new Set(["vsource", "isource", "vac", "iac"]);

/** Guard against pathological step counts (e.g. tiny increment over a huge span). */
const MAX_POINTS = 100_001;

export interface DcSweepSpec {
  /** Component label to sweep, e.g. "V1". Matched case-insensitively. */
  source: string;
  start: number;
  stop: number;
  /** Increment magnitude; sign is normalized to move start → stop. */
  step: number;
}

export type DcSweepResult =
  | {
      ok: true;
      source: string;
      /** The swept source values, in order. */
      sweep: number[];
      /** One series per net, aligned index-for-index with `sweep`. */
      nets: { id: string; label: string; voltages: number[] }[];
      warnings: string[];
    }
  | {
      ok: false;
      message: string;
      warnings: string[];
    };

/**
 * Parse a `.dc` directive line into a {@link DcSweepSpec}. Accepts an optional
 * leading "." or "!" and the bare `dc` keyword. Returns `null` when the line is
 * not a usable linear source sweep.
 */
export function parseDcDirective(line: string): DcSweepSpec | null {
  const cleaned = line.trim().replace(/^[.!]/, "").trim();
  const parts = cleaned.split(/\s+/);
  if (parts.length === 0) return null;
  if (parts[0].toLowerCase() !== "dc") return null;
  // .dc <src> <start> <stop> <incr>
  const [, source, start, stop, incr] = parts;
  if (!source || start === undefined || stop === undefined || incr === undefined) return null;
  try {
    const s = parseQuantity(start, "");
    const e = parseQuantity(stop, "");
    const i = parseQuantity(incr, "");
    if (!Number.isFinite(s) || !Number.isFinite(e) || !Number.isFinite(i)) return null;
    return { source, start: s, stop: e, step: i };
  } catch {
    return null;
  }
}

/** Build the ordered list of swept values, or throw on a degenerate spec. */
function sweepValues(spec: DcSweepSpec): number[] {
  const { start, stop, step } = spec;
  if (step === 0) throw new Error("DC sweep increment must be non-zero.");
  const dir = stop >= start ? 1 : -1;
  const inc = Math.abs(step) * dir;
  // +1e-9 fudge so a clean endpoint (e.g. 0→10 step 1) includes the final point.
  const count = Math.floor((stop - start) / inc + 1e-9) + 1;
  if (count <= 0) throw new Error("DC sweep range is empty.");
  if (count > MAX_POINTS) {
    throw new Error(`DC sweep would take ${count} points (max ${MAX_POINTS}); increase the increment.`);
  }
  const values: number[] = [];
  for (let k = 0; k < count; k += 1) values.push(start + k * inc);
  return values;
}

/**
 * Run a DC sweep: solve the operating point once per swept value with the named
 * source overridden. Returns a per-net voltage series indexed by sweep point.
 */
export function runDcSweep(
  schematic: {
    components: SchematicComponent[];
    wires: SchematicWire[];
    netLabels?: NetLabel[];
    params?: ParamScope;
  },
  spec: DcSweepSpec,
): DcSweepResult {
  const warnings: string[] = [];

  const target = schematic.components.find(
    (c) => c.label.toLowerCase() === spec.source.toLowerCase(),
  );
  if (!target) {
    return { ok: false, message: `DC sweep source "${spec.source}" not found in the circuit.`, warnings };
  }
  if (!SWEEPABLE.has(target.kind)) {
    return {
      ok: false,
      message: `DC sweep source "${spec.source}" is a ${target.kind}, not an independent source.`,
      warnings,
    };
  }

  let values: number[];
  try {
    values = sweepValues(spec);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error), warnings };
  }

  const params = schematic.params ?? EMPTY_SCOPE;
  // Net id → its voltage series; net order locked in from the first solve.
  const order: { id: string; label: string }[] = [];
  const series = new Map<string, number[]>();

  for (let k = 0; k < values.length; k += 1) {
    const v = values[k];
    const components = schematic.components.map((c) =>
      c.id === target.id ? { ...c, value: formatSweepValue(v) } : c,
    );
    const op = runOperatingPoint({ components, wires: schematic.wires, netLabels: schematic.netLabels, params });
    if (!op.ok) {
      return {
        ok: false,
        message: `DC sweep failed at ${spec.source}=${formatSweepValue(v)}: ${op.message}`,
        warnings,
      };
    }
    if (order.length === 0) {
      for (const net of op.nets) {
        order.push({ id: net.id, label: net.label });
        series.set(net.id, []);
      }
    }
    for (const net of op.nets) {
      const arr = series.get(net.id);
      if (arr) arr.push(net.voltage);
    }
  }

  return {
    ok: true,
    source: target.label,
    sweep: values,
    nets: order.map((n) => ({ id: n.id, label: n.label, voltages: series.get(n.id) ?? [] })),
    warnings,
  };
}

/** Render a swept numeric value as a plain SPICE literal (no SI suffix). */
function formatSweepValue(v: number): string {
  // Avoid scientific notation surprises for tidy values; parseQuantity reads both.
  return Number.isInteger(v) ? String(v) : v.toPrecision(12).replace(/\.?0+$/, "");
}
