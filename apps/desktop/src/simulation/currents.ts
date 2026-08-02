import type { CurrentTrace } from "./linearTransient";
import type { ExtractedComponent } from "../schematic/netlist";
import { parseQuantity } from "./quantity";

/**
 * A two-terminal passive whose current Tau reconstructs, carrying its own pin
 * order. `a`/`b` are net ids in the element's own orientation, and that order
 * is the entire sign contract - see {@link deriveDcRcBranches}.
 */
interface RcElement {
  /** SchematicComponent id. */
  id: string;
  /** Ref-des. */
  ref: string;
  kind: "resistor" | "capacitor";
  /** Ohms for a resistor (non-zero; negative active resistance is legal), or
   *  farads for a capacitor (positive). */
  size: number;
  a: string | undefined;
  b: string | undefined;
}

/**
 * The passives Tau can reconstruct a current for, in schematic order. Held in
 * one place so the transient and operating-point paths cannot drift on which
 * parts qualify, or on which way round they run.
 */
function rcElements(components: ReadonlyArray<ExtractedComponent>): RcElement[] {
  const out: RcElement[] = [];
  for (const { component, pins } of components) {
    const ref = component.label;
    if (!ref) continue;
    if (component.kind !== "resistor" && component.kind !== "capacitor") continue;
    let size: number;
    try {
      size = parseQuantity(component.value, component.kind === "resistor" ? "Ω" : "F");
    } catch { continue; }
    if (component.kind === "resistor" ? size === 0 : !(size > 0)) continue;
    out.push({ id: component.id, ref, kind: component.kind, size, a: pins.a, b: pins.b });
  }
  return out;
}

export interface ComplexSamples {
  real: number[];
  imaginary: number[];
}

/** Reconstruct resistor/capacitor AC branch phasors from node phasors:
 * `I_R=(Va−Vb)/R`, `I_C=jωC(Va−Vb)`, in the element's a→b orientation. */
export function deriveAcRcCurrents(
  components: ReadonlyArray<ExtractedComponent>,
  nodePhasors: ReadonlyMap<string, ComplexSamples>,
  frequencies: ReadonlyArray<number>,
): { id: string; ref: string; label: string; real: number[]; imaginary: number[] }[] {
  const read = (netId: string | undefined, index: number): { re: number; im: number } | null => {
    if (!netId) return null;
    const phasor = nodePhasors.get(netId);
    if (!phasor) return null;
    const re = phasor.real[index];
    const im = phasor.imaginary[index];
    return Number.isFinite(re) && Number.isFinite(im) ? { re, im } : null;
  };
  const output: { id: string; ref: string; label: string; real: number[]; imaginary: number[] }[] = [];
  for (const element of rcElements(components)) {
    const real: number[] = [];
    const imaginary: number[] = [];
    let complete = true;
    for (let index = 0; index < frequencies.length; index += 1) {
      const a = read(element.a, index);
      const b = read(element.b, index);
      if (!a || !b) { complete = false; break; }
      const voltage = { re: a.re - b.re, im: a.im - b.im };
      if (element.kind === "resistor") {
        real.push(voltage.re / element.size);
        imaginary.push(voltage.im / element.size);
      } else {
        const omegaC = 2 * Math.PI * frequencies[index] * element.size;
        real.push(-omegaC * voltage.im);
        imaginary.push(omegaC * voltage.re);
      }
    }
    if (complete) output.push({ id: element.id, ref: element.ref, label: `I(${element.ref})`, real, imaginary });
  }
  return output;
}

/**
 * Split a current signal name into the part it belongs to and the terminal it
 * names: `I(R1)` is a whole part, `Ib(Q1)` is one BJT terminal. Returns null
 * for anything that is not a current, including a bare node or `V(out)`.
 */
export function parseCurrentSignal(text: string): { ref: string; terminal?: string } | null {
  const match = /^i([a-z]?)\(([^)]+)\)$/i.exec(text.trim());
  if (!match) return null;
  const ref = match[2].trim();
  if (!ref) return null;
  return match[1] ? { ref, terminal: match[1].toLowerCase() } : { ref };
}

/**
 * The terminal a part's own current already IS, keyed by the ref-des letter of
 * the element type that reports it. `I(Q1)` is a BJT's collector current and
 * `I(M1)` a three-terminal device's drain current, so those two currents carry
 * no terminal tag and nothing in a result answers to `c` or `d`.
 *
 * Mirrors the params the deck asks ngspice for - `DEVICE_CURRENT_PARAMS` in
 * engine/spiceNetlist.ts is `i` plus the letter here - and a test holds the two
 * in step, because a letter accepted here that the deck saves under a different
 * name resolves to nothing and says nothing about why.
 */
export const PRIMARY_TERMINALS: Readonly<Record<string, string>> = {
  d: "d",
  q: "c",
  m: "d",
  j: "d",
};

/**
 * Resolve a current signal against a result's traces.
 *
 * A device that reports several terminals contributes several traces under ONE
 * ref-des, so matching on `ref` alone returns whichever happens to come first -
 * or, for a Map built over the list, whichever comes LAST. Every caller goes
 * through here so "a bare `I(ref)` means the part's own current, not one of its
 * terminals" is stated once instead of re-derived per call site.
 *
 * Spelling that same current's terminal out resolves to it: `Ic(Q1)` and
 * `Id(M1)` are what LTspice calls a collector and a drain, and an exact match
 * finds nothing for either, since the trace carrying them is the untagged one.
 * Only the single letter the ref-des's element type reports folds that way, so
 * `Ib(R1)` stays unanswerable rather than quietly reading a resistor's current.
 */
export function findCurrentTrace<T extends { ref: string; terminal?: string }>(
  currents: ReadonlyArray<T> | undefined,
  ref: string,
  terminal?: string,
): T | undefined {
  const wantedRef = ref.trim().toLowerCase();
  const wantedTerminal = terminal?.toLowerCase();
  const exact = currents?.find((c) => c.ref.toLowerCase() === wantedRef && c.terminal === wantedTerminal);
  if (exact || wantedTerminal === undefined) return exact;
  if (PRIMARY_TERMINALS[wantedRef.slice(0, 1)] !== wantedTerminal) return undefined;
  return currents?.find((c) => c.ref.toLowerCase() === wantedRef && c.terminal === undefined);
}

/**
 * Derive resistor/capacitor branch-current waveforms from node-voltage traces,
 * for engine paths (native ngspice) that return node voltages but not every
 * device current. `I_R = (Va - Vb)/R`, `I_C = C dV/dt`, both in SPICE a→b sign
 * convention and keyed by ref-des so `.meas`/plot can resolve `I(R1)`/`I(C1)`.
 * Source/inductor currents are supplied separately by the caller (from the
 * ngspice `#branch` vectors), so they are not derived here.
 */
export function deriveRcCurrents(
  components: ReadonlyArray<ExtractedComponent>,
  nodeVoltages: Map<string, number[]>,
  times: ReadonlyArray<number>,
): CurrentTrace[] {
  const read = (netId: string | undefined, i: number): number => {
    if (!netId || netId === "0") return 0;
    const v = nodeVoltages.get(netId);
    return v ? v[i] ?? 0 : 0;
  };
  const out: CurrentTrace[] = [];
  for (const el of rcElements(components)) {
    const values =
      el.kind === "resistor"
        ? times.map((_, i) => (read(el.a, i) - read(el.b, i)) / el.size)
        : times.map((_, i) => {
            if (i === 0) return 0;
            const dt = times[i] - times[i - 1];
            if (!(dt > 0)) return 0;
            const now = read(el.a, i) - read(el.b, i);
            const prev = read(el.a, i - 1) - read(el.b, i - 1);
            return (el.size * (now - prev)) / dt;
          });
    out.push({ ref: el.ref, label: `I(${el.ref})`, values });
  }
  return out;
}

/**
 * The same two passives at a DC operating point, shaped as
 * `OperatingPointResult` branches. ngspice returns no vector at all for a
 * resistor or a capacitor even on a deck that saves everything (asserted
 * against the real engine in `scripts/opNative.corpus.ts`), so these values are
 * Tau's to reconstruct rather than to read back.
 *
 * The pin order is the whole sign contract, and it is the SAME convention the
 * MNA branch unknowns beside it already use: both are the current entering the
 * element's first terminal. So a resistor in series with an inductor reports
 * the inductor's `#branch` value, sign included, and the voltage source driving
 * them reports the negative of their sum.
 *
 * A capacitor is exactly zero: a converged DC solution holds its voltage
 * constant, so `C dV/dt` vanishes. That is a statement about the operating
 * point, not a missing value.
 *
 * A terminal whose voltage is unknown skips the element rather than reading as
 * ground, so a node the engine did not return produces no current instead of a
 * confident wrong one. `id` is the SchematicComponent id, matching the rest of
 * the branch list - `opAnnotations` locates a branch's component by it.
 */
export function deriveDcRcBranches(
  components: ReadonlyArray<ExtractedComponent>,
  nodeVoltages: ReadonlyMap<string, number>,
): { id: string; ref: string; label: string; current: number }[] {
  const out: { id: string; ref: string; label: string; current: number }[] = [];
  for (const el of rcElements(components)) {
    let current = 0;
    if (el.kind === "resistor") {
      const va = nodeVoltages.get(el.a ?? "");
      const vb = nodeVoltages.get(el.b ?? "");
      if (va === undefined || vb === undefined) continue;
      current = (va - vb) / el.size;
    }
    out.push({ id: el.id, ref: el.ref, label: `I(${el.ref})`, current });
  }
  return out;
}
