/**
 * Small-Signal DC Transfer Function (.tf)
 *
 * LTspice/SPICE syntax:
 *
 *   .tf <output> <input-source>
 *
 * where `<output>` is `V(node)`, `V(a,b)`, or `I(Vname)` and `<input-source>` is
 * the name of an independent source (the stimulus). It reports three numbers,
 * exactly as SPICE does:
 *
 *   - transfer function   = d(output) / d(input)          (the DC gain)
 *   - input impedance     = d(Vin)    / d(Iin)  at source
 *   - output impedance    = d(Vout)   / d(Iout) at the output port
 *
 * Because Tau's DC operating point is a linear MNA solve, all three are computed
 * by SUPERPOSITION/PERTURBATION around the existing `runOperatingPoint` solver
 * (no duplicated stamping - same pattern as `dcSweep.ts`):
 *
 *   - gain:  solve with the input source set to 0 and to 1, take the difference.
 *            Any other independent sources keep their authored values and cancel
 *            in the difference, so the result is the pure input→output ratio.
 *   - Rin :  zero every OTHER source, drive the input with a unit stimulus, read
 *            the current it delivers (voltage input) or the voltage across it
 *            (current input).
 *   - Rout:  zero EVERY source, inject a unit test current into the output port,
 *            read the resulting port voltage.
 */

import type {
  ComponentKind,
  NetLabel,
  SchematicComponent,
  SchematicWire,
} from "../schematic/types";
import { extractCircuit } from "../schematic/netlist";
import { runOperatingPoint, type OperatingPointResult } from "./operatingPoint";
import { EMPTY_SCOPE, resolveComponentValues, type ParamScope } from "./paramScope";

/** Independent-source kinds usable as a `.tf` stimulus. */
const SOURCE_KINDS = new Set<ComponentKind>(["vsource", "isource", "vac", "iac", "logicConstant"]);

export type TfOutput =
  | { kind: "voltage"; pos: string; neg?: string }
  | { kind: "current"; device: string };

export interface TfSpec {
  output: TfOutput;
  /** Component label of the input source, e.g. "V1". Matched case-insensitively. */
  source: string;
}

export type TfResult =
  | {
      ok: true;
      spec: TfSpec;
      /** d(output)/d(input). */
      gain: number;
      /** Human label for the gain row, e.g. "V(out)/V1". */
      gainLabel: string;
      /** Unit of the gain: "" (V/V or A/A), "Ω", or "A/V". */
      gainUnit: string;
      /** Input resistance seen by the source, in ohms. */
      inputImpedance: number;
      /** Output resistance at the output port, in ohms. */
      outputImpedance: number;
      warnings: string[];
    }
  | { ok: false; message: string; warnings: string[] };

interface Schematic {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels?: NetLabel[];
  params?: ParamScope;
}

/**
 * Parse a `.tf` directive into a {@link TfSpec}. Accepts an optional leading
 * "." or "!" and the bare `tf` keyword. Returns `null` for anything that is not
 * a usable `<output> <source>` request.
 */
export function parseTfDirective(line: string): TfSpec | null {
  const cleaned = line.trim().replace(/^[.!]/, "").trim();
  const m = cleaned.match(/^tf\b\s+(.*)$/is);
  if (!m) return null;
  const body = m[1].trim();

  // Output is a V(...) / I(...) group (which may contain a comma + spaces) or a
  // bare token; the input source is the final whitespace-separated token.
  const grouped = body.match(/^([vi])\s*\(([^)]*)\)\s+(\S+)\s*$/i);
  if (grouped) {
    const fn = grouped[1].toLowerCase();
    const inner = grouped[2].trim();
    const source = grouped[3];
    if (fn === "v") {
      const nodes = inner.split(",").map((s) => s.trim()).filter(Boolean);
      if (nodes.length === 0) return null;
      return {
        output: { kind: "voltage", pos: nodes[0], neg: nodes[1] },
        source,
      };
    }
    // I(device): a single device label.
    if (!inner || inner.includes(",")) return null;
    return { output: { kind: "current", device: inner }, source };
  }

  // Bare form: ".tf out V1" → treat the first token as V(out).
  const parts = body.split(/\s+/).filter(Boolean);
  if (parts.length !== 2) return null;
  return { output: { kind: "voltage", pos: parts[0] }, source: parts[1] };
}

/** Clone a source component into a 0-contribution DC source (AC kinds collapse to DC). */
function zeroed(c: SchematicComponent): SchematicComponent {
  if (c.kind === "vsource" || c.kind === "vac" || c.kind === "logicConstant") {
    return { ...c, kind: "vsource", value: "0" };
  }
  if (c.kind === "isource" || c.kind === "iac") return { ...c, kind: "isource", value: "0" };
  return c;
}

/** Clone a source component into a DC source driven at `value` (AC kinds become DC). */
function driven(c: SchematicComponent, value: string): SchematicComponent {
  if (c.kind === "vsource" || c.kind === "vac" || c.kind === "logicConstant") {
    return { ...c, kind: "vsource", value };
  }
  if (c.kind === "isource" || c.kind === "iac") return { ...c, kind: "isource", value };
  return c;
}

/** Resolve the net id of a named output node, case-insensitively, from a solved OP. */
function netIdFor(
  nets: { id: string }[],
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  if (lower === "0" || lower === "gnd" || lower === "ground") return "0";
  return nets.find((n) => n.id.toLowerCase() === lower)?.id;
}

function voltageOf(nets: { id: string; voltage: number }[], netId: string): number {
  if (netId === "0") return 0;
  return nets.find((n) => n.id === netId)?.voltage ?? 0;
}

/**
 * Run a small-signal DC transfer-function analysis. Returns gain, input
 * impedance and output impedance, or a clear error message.
 */
export function runTransferFunction(schematic: Schematic, spec: TfSpec): TfResult {
  const warnings: string[] = [];
  const params = schematic.params ?? EMPTY_SCOPE;

  const input = schematic.components.find(
    (c) => c.label.toLowerCase() === spec.source.toLowerCase(),
  );
  if (!input) {
    return { ok: false, message: `.tf source "${spec.source}" not found in the circuit.`, warnings };
  }
  if (!SOURCE_KINDS.has(input.kind)) {
    return {
      ok: false,
      message: `.tf source "${spec.source}" is a ${input.kind}, not an independent source.`,
      warnings,
    };
  }
  const inputIsVoltage = input.kind === "vsource" || input.kind === "vac" || input.kind === "logicConstant";

  const solve = (
    components: SchematicComponent[],
    inject?: { netId: string; amps: number }[],
  ) =>
    runOperatingPoint(
      { components, wires: schematic.wires, netLabels: schematic.netLabels, params },
      { injectCurrents: inject, returnBranches: true },
    );

  // Map a component override into the full list.
  const withSource = (replace: SchematicComponent) =>
    schematic.components.map((c) => (c.id === input.id ? replace : c));

  // --- Gain: difference of two solves (input at 1 vs 0) -------------------
  const base = solve(withSource(driven(input, "0")));
  if (!base.ok) return { ok: false, message: base.message, warnings };
  const hot = solve(withSource(driven(input, "1")));
  if (!hot.ok) return { ok: false, message: hot.message, warnings };

  const readOutput = (r: Extract<OperatingPointResult, { ok: true }>): number | string => {
    if (spec.output.kind === "current") {
      const dev = spec.output.device.toLowerCase();
      const br = r.branches?.find((b) => b.label.toLowerCase() === `i(${dev})`);
      if (!br) {
        return `.tf output I(${spec.output.device}) is not a voltage source or inductor branch current.`;
      }
      return br.current;
    }
    const posId = netIdFor(r.nets, spec.output.pos);
    if (posId === undefined) {
      return `.tf output node "${spec.output.pos}" not found. Label the net (e.g. add a "${spec.output.pos}" net label).`;
    }
    let v = voltageOf(r.nets, posId);
    if (spec.output.neg !== undefined) {
      const negId = netIdFor(r.nets, spec.output.neg);
      if (negId === undefined) {
        return `.tf output node "${spec.output.neg}" not found.`;
      }
      v -= voltageOf(r.nets, negId);
    }
    return v;
  };

  const outBase = readOutput(base);
  if (typeof outBase === "string") return { ok: false, message: outBase, warnings };
  const outHot = readOutput(hot);
  if (typeof outHot === "string") return { ok: false, message: outHot, warnings };
  const gain = outHot - outBase; // d(output)/d(input), Δinput = 1

  // --- Input impedance ----------------------------------------------------
  // Drive the input alone (every other source zeroed) with a unit stimulus.
  const onlyInput = schematic.components.map((c) => {
    if (c.id === input.id) return driven(c, "1");
    return SOURCE_KINDS.has(c.kind) ? zeroed(c) : c;
  });
  const inSolve = solve(onlyInput);
  if (!inSolve.ok) return { ok: false, message: inSolve.message, warnings };

  let inputImpedance: number;
  if (inputIsVoltage) {
    // Current delivered by the source = −(its branch unknown). Rin = 1 V / Idel.
    const br = inSolve.branches?.find(
      (b) => b.label.toLowerCase() === `i(${input.label.toLowerCase()})`,
    );
    const delivered = br ? -br.current : 0;
    inputImpedance = delivered !== 0 ? 1 / delivered : Infinity;
  } else {
    // Current input: Rin = V across the source / 1 A. Find its terminal nets.
    const [pNet, nNet] = inputSourceNets(schematic, params, input);
    const vp = pNet ? voltageOf(inSolve.nets, pNet) : 0;
    const vn = nNet ? voltageOf(inSolve.nets, nNet) : 0;
    inputImpedance = vp - vn; // driven at 1 A
  }

  // --- Output impedance ---------------------------------------------------
  // Zero every source, inject a unit test current into the output port.
  const allZero = schematic.components.map((c) =>
    SOURCE_KINDS.has(c.kind) ? zeroed(c) : c,
  );
  let outputImpedance = NaN;
  if (spec.output.kind === "voltage") {
    const posId = netIdFor(base.nets, spec.output.pos);
    const negId = spec.output.neg !== undefined ? netIdFor(base.nets, spec.output.neg) : "0";
    if (posId !== undefined && negId !== undefined) {
      const inject = [{ netId: posId, amps: 1 }];
      if (negId !== "0") inject.push({ netId: negId, amps: -1 });
      const z = solve(allZero, inject);
      if (z.ok) {
        const vp = voltageOf(z.nets, posId);
        const vn = negId === "0" ? 0 : voltageOf(z.nets, negId);
        outputImpedance = vp - vn; // injected 1 A
      }
    }
  } else {
    warnings.push("Output impedance for an I(...) output is not reported.");
  }

  const gainLabel = `${formatOutput(spec.output)}/${input.label}`;
  const gainUnit = unitFor(spec.output.kind, inputIsVoltage);

  return {
    ok: true,
    spec,
    gain,
    gainLabel,
    gainUnit,
    inputImpedance,
    outputImpedance,
    warnings,
  };
}

/** Find the two terminal net ids of the input source via a topology extraction. */
function inputSourceNets(
  schematic: Schematic,
  params: ParamScope,
  input: SchematicComponent,
): [string | undefined, string | undefined] {
  const resolved = resolveComponentValues(schematic.components, params);
  const circuit = extractCircuit(resolved, schematic.wires, schematic.netLabels ?? []);
  let p: string | undefined;
  let n: string | undefined;
  for (const net of circuit.nets) {
    for (const pin of net.pins) {
      if (pin.componentId !== input.id) continue;
      if (pin.id === "p") p = net.isGround ? "0" : net.id;
      if (pin.id === "n") n = net.isGround ? "0" : net.id;
    }
  }
  return [p, n];
}

/** The gain row's output half, e.g. `V(out)` or `I(V1)`. */
export function formatOutput(output: TfOutput): string {
  if (output.kind === "current") return `I(${output.device})`;
  return output.neg !== undefined ? `V(${output.pos},${output.neg})` : `V(${output.pos})`;
}

/** Unit of d(output)/d(input) for the four port combinations. */
export function unitFor(outputKind: TfOutput["kind"], inputIsVoltage: boolean): string {
  const outIsVoltage = outputKind === "voltage";
  if (outIsVoltage && inputIsVoltage) return ""; // V/V
  if (!outIsVoltage && !inputIsVoltage) return ""; // A/A
  if (outIsVoltage && !inputIsVoltage) return "Ω"; // V/A transimpedance
  return "A/V"; // I/V transconductance
}
