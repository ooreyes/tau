/**
 * DC Sweep Analysis (.dc)
 *
 * Sweeps an independent source's value over a linear range and records the
 * resulting DC operating point at each step. LTspice/SPICE syntax:
 *
 *   .dc <srcname> <start> <stop> <increment>
 *   .dc <src1> <start1> <stop1> <inc1> <src2> <start2> <stop2> <inc2>
 *
 * For a **nested** sweep the FIRST source is the inner (fastest-varying) loop
 * and the second is the outer loop, exactly as SPICE orders them. We re-run the
 * inner sweep once per outer value and return the result as a family of curves:
 * each base net is expanded into one trace per outer value, annotated with the
 * outer source's value, and the X axis stays the inner sweep. This is how
 * LTspice draws a nested `.dc` - a fan of curves vs the inner source.
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
export const MAX_POINTS = 100_001;

/** Cap the outer loop so a nested sweep can't fan out into thousands of curves. */
export const MAX_OUTER_POINTS = 64;

/** One source's linear sweep bounds. */
export interface DcSweepLeg {
  /** Component label to sweep, e.g. "V1". Matched case-insensitively. */
  source: string;
  start: number;
  stop: number;
  /** Increment magnitude; sign is normalized to move start → stop. */
  step: number;
}

export interface DcSweepSpec extends DcSweepLeg {
  /**
   * Optional outer (slower-varying) source. When present the inner source
   * ({@link DcSweepLeg.source}) is swept once per outer value.
   */
  source2?: string;
  start2?: number;
  stop2?: number;
  step2?: number;
}

/** A single net's voltage series over the (inner) sweep axis. */
export interface DcSweepNet {
  id: string;
  /** Display label (annotated with the outer value for nested sweeps). */
  label: string;
  voltages: number[];
  /** Ground net (V≈0) - the UI hides these from the plot. */
  ground: boolean;
}

export type DcSweepResult =
  | {
      ok: true;
      source: string;
      /** The inner swept source values, in order (shared X axis). */
      sweep: number[];
      /** One series per net (×outer value for nested sweeps). */
      nets: DcSweepNet[];
      warnings: string[];
    }
  | {
      ok: false;
      message: string;
      warnings: string[];
    };

/**
 * Parse a `.dc` directive line into a {@link DcSweepSpec}. Accepts an optional
 * leading "." or "!" and the bare `dc` keyword. Reads an optional second
 * (nested) source sweep. Returns `null` when the line is not a usable source
 * sweep.
 */
export function parseDcDirective(line: string): DcSweepSpec | null {
  const cleaned = line.trim().replace(/^[.!]/, "").trim();
  const parts = cleaned.split(/\s+/);
  if (parts.length === 0) return null;
  if (parts[0].toLowerCase() !== "dc") return null;

  const inner = parseLeg(parts, 1);
  if (!inner) return null;
  const spec: DcSweepSpec = inner;

  // Optional nested second source: `.dc src1 ... src2 start2 stop2 inc2`.
  if (parts.length >= 9) {
    const outer = parseLeg(parts, 5);
    if (outer) {
      spec.source2 = outer.source;
      spec.start2 = outer.start;
      spec.stop2 = outer.stop;
      spec.step2 = outer.step;
    }
  }
  return spec;
}

/** Parse `<src> <start> <stop> <incr>` starting at token index `i`. */
function parseLeg(parts: string[], i: number): DcSweepLeg | null {
  const source = parts[i];
  const start = parts[i + 1];
  const stop = parts[i + 2];
  const incr = parts[i + 3];
  if (!source || start === undefined || stop === undefined || incr === undefined) return null;
  try {
    const s = parseQuantity(start, "");
    const e = parseQuantity(stop, "");
    const inc = parseQuantity(incr, "");
    if (!Number.isFinite(s) || !Number.isFinite(e) || !Number.isFinite(inc)) return null;
    return { source, start: s, stop: e, step: inc };
  } catch {
    return null;
  }
}

/** Build the ordered list of swept values, or throw on a degenerate spec. */
export function sweepValues(leg: DcSweepLeg, max: number): number[] {
  const { start, stop, step } = leg;
  if (step === 0) throw new Error("DC sweep increment must be non-zero.");
  const dir = stop >= start ? 1 : -1;
  const inc = Math.abs(step) * dir;
  // +1e-9 fudge so a clean endpoint (e.g. 0→10 step 1) includes the final point.
  const count = Math.floor((stop - start) / inc + 1e-9) + 1;
  if (count <= 0) throw new Error("DC sweep range is empty.");
  if (count > max) {
    throw new Error(`DC sweep would take ${count} points (max ${max}); increase the increment.`);
  }
  const values: number[] = [];
  for (let k = 0; k < count; k += 1) values.push(start + k * inc);
  return values;
}

export interface SweepSchematic {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels?: NetLabel[];
  params?: ParamScope;
}

/** Locate a sweepable independent source by label, or return an error message. */
export function findSource(
  schematic: SweepSchematic,
  label: string,
): SchematicComponent | string {
  const target = schematic.components.find(
    (c) => c.label.toLowerCase() === label.toLowerCase(),
  );
  if (!target) return `DC sweep source "${label}" not found in the circuit.`;
  if (!SWEEPABLE.has(target.kind)) {
    return `DC sweep source "${label}" is a ${target.kind}, not an independent source.`;
  }
  return target;
}

/**
 * Solve the inner sweep against a fixed set of base components (the outer source
 * may already be overridden in `baseComponents`). Returns the per-net series, or
 * an error message string on the first failing solve.
 */
function solveInnerSweep(
  baseComponents: SchematicComponent[],
  schematic: SweepSchematic,
  target: SchematicComponent,
  values: number[],
): { nets: DcSweepNet[] } | string {
  const params = schematic.params ?? EMPTY_SCOPE;
  const order: { id: string; label: string }[] = [];
  const series = new Map<string, number[]>();
  const groundSeen = new Map<string, boolean>();

  for (const v of values) {
    const components = baseComponents.map((c) =>
      c.id === target.id ? { ...c, value: formatSweepValue(v) } : c,
    );
    const op = runOperatingPoint({
      components,
      wires: schematic.wires,
      netLabels: schematic.netLabels,
      params,
    });
    if (!op.ok) {
      return `DC sweep failed at ${target.label}=${formatSweepValue(v)}: ${op.message}`;
    }
    if (order.length === 0) {
      for (const net of op.nets) {
        order.push({ id: net.id, label: net.label });
        series.set(net.id, []);
        groundSeen.set(net.id, net.label === "GND" || net.label === "0");
      }
    }
    for (const net of op.nets) series.get(net.id)?.push(net.voltage);
  }

  return {
    nets: order.map((n) => ({
      id: n.id,
      label: n.label,
      voltages: series.get(n.id) ?? [],
      ground: groundSeen.get(n.id) ?? false,
    })),
  };
}

/**
 * Run a DC sweep: solve the operating point once per swept value with the named
 * source overridden. For a nested spec the inner sweep is repeated per outer
 * value and the curves are returned as a single fan (one net trace per outer
 * value), aligned on the inner sweep axis.
 */
export function runDcSweep(schematic: SweepSchematic, spec: DcSweepSpec): DcSweepResult {
  const warnings: string[] = [];

  const inner = findSource(schematic, spec.source);
  if (typeof inner === "string") return { ok: false, message: inner, warnings };

  let innerValues: number[];
  try {
    innerValues = sweepValues(spec, MAX_POINTS);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error), warnings };
  }

  // -- Single-source sweep --------------------------------------------------
  if (spec.source2 === undefined) {
    const solved = solveInnerSweep(schematic.components, schematic, inner, innerValues);
    if (typeof solved === "string") return { ok: false, message: solved, warnings };
    return { ok: true, source: inner.label, sweep: innerValues, nets: solved.nets, warnings };
  }

  // -- Nested two-source sweep ----------------------------------------------
  const outer = findSource(schematic, spec.source2);
  if (typeof outer === "string") return { ok: false, message: outer, warnings };
  if (outer.id === inner.id) {
    return { ok: false, message: "DC sweep inner and outer sources must differ.", warnings };
  }

  let outerValues: number[];
  try {
    outerValues = sweepValues(
      { source: spec.source2, start: spec.start2!, stop: spec.stop2!, step: spec.step2! },
      MAX_OUTER_POINTS,
    );
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error), warnings };
  }

  const fanned: DcSweepNet[] = [];
  for (const ov of outerValues) {
    // Pin the outer source for this curve, then sweep the inner over it.
    const base = schematic.components.map((c) =>
      c.id === outer.id ? { ...c, value: formatSweepValue(ov) } : c,
    );
    const solved = solveInnerSweep(base, schematic, inner, innerValues);
    if (typeof solved === "string") return { ok: false, message: solved, warnings };
    for (const net of solved.nets) {
      if (net.ground) continue; // a flat 0 V per outer value adds nothing
      fanned.push({
        id: `${net.id}@${spec.source2}=${formatSweepValue(ov)}`,
        label: `${net.label} (${outer.label}=${formatSweepValue(ov)})`,
        voltages: net.voltages,
        ground: false,
      });
    }
  }

  return { ok: true, source: inner.label, sweep: innerValues, nets: fanned, warnings };
}

/** Render a swept numeric value as a plain SPICE literal (no SI suffix). */
export function formatSweepValue(v: number): string {
  // Avoid scientific notation surprises for tidy values; parseQuantity reads both.
  return Number.isInteger(v) ? String(v) : v.toPrecision(12).replace(/\.?0+$/, "");
}
