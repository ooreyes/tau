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
  /** Ohms for a resistor, farads for a capacitor. Always finite and positive. */
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
    if (!(size > 0)) continue;
    out.push({ id: component.id, ref, kind: component.kind, size, a: pins.a, b: pins.b });
  }
  return out;
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
 * Resolve a current signal against a result's traces.
 *
 * A device that reports several terminals contributes several traces under ONE
 * ref-des, so matching on `ref` alone returns whichever happens to come first -
 * or, for a Map built over the list, whichever comes LAST. Every caller goes
 * through here so "a bare `I(ref)` means the part's own current, not one of its
 * terminals" is stated once instead of re-derived per call site.
 */
export function findCurrentTrace<T extends { ref: string; terminal?: string }>(
  currents: ReadonlyArray<T> | undefined,
  ref: string,
  terminal?: string,
): T | undefined {
  const wantedRef = ref.trim().toLowerCase();
  const wantedTerminal = terminal?.toLowerCase();
  return currents?.find((c) => c.ref.toLowerCase() === wantedRef && c.terminal === wantedTerminal);
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
