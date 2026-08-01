import { describe, expect, it } from "vitest";
import { deriveDcRcBranches, deriveRcCurrents, findCurrentTrace, parseCurrentSignal, PRIMARY_TERMINALS } from "./currents";
import { DEVICE_CURRENT_PARAMS } from "../engine/spiceNetlist";
import type { ExtractedComponent } from "../schematic/netlist";
import type { SchematicComponent } from "../schematic/types";

function comp(kind: SchematicComponent["kind"], label: string, value: string, pins: Record<string, string>): ExtractedComponent {
  return { component: { id: label, kind, x: 0, y: 0, rotation: 0, value, label }, pins };
}

describe("deriveRcCurrents (native-path R/C currents from node voltages)", () => {
  it("derives resistor current as (Va - Vb)/R in a→b sign", () => {
    // R1 = 1k between node `out` (held at 2 V) and ground.
    const comps = [comp("resistor", "R1", "1k", { a: "out", b: "0" })];
    const voltages = new Map<string, number[]>([["out", [2, 2, 2]]]);
    const out = deriveRcCurrents(comps, voltages, [0, 1, 2]);
    expect(out).toHaveLength(1);
    expect(out[0].ref).toBe("R1");
    expect(out[0].label).toBe("I(R1)");
    expect(out[0].values).toEqual([0.002, 0.002, 0.002]);
  });

  it("derives capacitor current as C·dV/dt, zero at the first sample", () => {
    // C1 = 1µF; node `n` ramps 0→1→2 V over dt=1s ⇒ I = 1e-6 * 1 / 1 = 1µA.
    const comps = [comp("capacitor", "C1", "1u", { a: "n", b: "0" })];
    const voltages = new Map<string, number[]>([["n", [0, 1, 2]]]);
    const out = deriveRcCurrents(comps, voltages, [0, 1, 2]);
    expect(out[0].values[0]).toBe(0);
    expect(out[0].values[1]).toBeCloseTo(1e-6, 12);
    expect(out[0].values[2]).toBeCloseTo(1e-6, 12);
  });

  it("skips unlabeled parts and unparseable values", () => {
    const comps = [
      comp("resistor", "", "1k", { a: "out", b: "0" }), // no ref-des
      comp("resistor", "R2", "abc", { a: "out", b: "0" }), // bad value
    ];
    const voltages = new Map<string, number[]>([["out", [1]]]);
    expect(deriveRcCurrents(comps, voltages, [0])).toHaveLength(0);
  });

  it("treats ground ('0') and untraced nets as 0 V", () => {
    const comps = [comp("resistor", "R1", "2k", { a: "hot", b: "0" })];
    const voltages = new Map<string, number[]>([["hot", [4]]]);
    expect(deriveRcCurrents(comps, voltages, [0])[0].values[0]).toBeCloseTo(0.002, 9);
  });
});

describe("deriveDcRcBranches (operating-point R/C currents from node voltages)", () => {
  it("derives resistor current as (Va - Vb)/R, in the element's own pin order", () => {
    // The same 1k held at 2 V, wired the two ways round. The pin order is the
    // entire sign contract: it has to follow the element, not the magnitude.
    const forward = [comp("resistor", "R1", "1k", { a: "out", b: "0" })];
    const reversed = [comp("resistor", "R1", "1k", { a: "0", b: "out" })];
    const voltages = new Map<string, number>([["out", 2], ["0", 0]]);

    expect(deriveDcRcBranches(forward, voltages)).toEqual([
      { id: "R1", ref: "R1", label: "I(R1)", current: 0.002 },
    ]);
    expect(deriveDcRcBranches(reversed, voltages)[0].current).toBe(-0.002);
  });

  it("reports a capacitor as exactly zero rather than omitting it", () => {
    // A converged DC solution holds a capacitor's voltage constant, so its
    // current is zero however much voltage stands across it. Listing it is the
    // honest answer; leaving it out would read as "unknown".
    const comps = [comp("capacitor", "C1", "1u", { a: "n", b: "0" })];
    const voltages = new Map<string, number>([["n", 12], ["0", 0]]);
    expect(deriveDcRcBranches(comps, voltages)).toEqual([
      { id: "C1", ref: "C1", label: "I(C1)", current: 0 },
    ]);
  });

  it("skips a resistor with an unknown terminal instead of reading it as ground", () => {
    // `floating` is absent from the map, not zero in it. Defaulting it to 0
    // would report 4 mA through R1 with nothing saying the node was never
    // solved for.
    const comps = [comp("resistor", "R1", "1k", { a: "hot", b: "floating" })];
    const voltages = new Map<string, number>([["hot", 4]]);
    expect(deriveDcRcBranches(comps, voltages)).toHaveLength(0);
  });

  it("skips unlabeled parts and unparseable values, like the transient path", () => {
    const comps = [
      comp("resistor", "", "1k", { a: "out", b: "0" }),
      comp("resistor", "R2", "abc", { a: "out", b: "0" }),
      comp("resistor", "R3", "0", { a: "out", b: "0" }),
    ];
    const voltages = new Map<string, number>([["out", 1], ["0", 0]]);
    expect(deriveDcRcBranches(comps, voltages)).toHaveLength(0);
  });
});

describe("current-signal resolution across a part with several terminals", () => {
  const traces = [
    { ref: "R1", label: "I(R1)", values: [1, 1] },
    { ref: "Q1", label: "I(Q1)", values: [10, 10] },
    { ref: "Q1", label: "Ib(Q1)", values: [0.1, 0.1], terminal: "b" },
    { ref: "Q1", label: "Ie(Q1)", values: [-10.1, -10.1], terminal: "e" },
    { ref: "M1", label: "I(M1)", values: [2, 2] },
    { ref: "M1", label: "Ig(M1)", values: [0, 0], terminal: "g" },
    { ref: "M1", label: "Is(M1)", values: [-2, -2], terminal: "s" },
  ];

  it("reads `I(ref)` as the part's own current, not the terminal listed last", () => {
    // The hazard this pins: three traces share the ref-des `Q1`, so a lookup
    // that matched on `ref` alone would answer with whichever the list happened
    // to end on - the emitter, a different number with the opposite sign.
    expect(findCurrentTrace(traces, "Q1")?.label).toBe("I(Q1)");
    expect(findCurrentTrace(traces, "q1")?.values).toEqual([10, 10]);
  });

  it("reads a terminal only when one is asked for, and never falls back to the part", () => {
    expect(findCurrentTrace(traces, "Q1", "b")?.label).toBe("Ib(Q1)");
    expect(findCurrentTrace(traces, "Q1", "E")?.label).toBe("Ie(Q1)");
    // A resistor has no terminals to name, and must not answer with its own
    // current when one is requested - `Ib(R1)` is unanswerable, not 1 A. The
    // fold below is what makes this worth pinning: it must not widen into
    // "any terminal on any part reads that part's current".
    expect(findCurrentTrace(traces, "R1", "b")).toBeUndefined();
    expect(findCurrentTrace(traces, "R1", "c")).toBeUndefined();
    // A letter this element type does not report stays unanswerable too: a BJT
    // has no drain and a MOSFET no collector.
    expect(findCurrentTrace(traces, "Q1", "d")).toBeUndefined();
    expect(findCurrentTrace(traces, "M1", "c")).toBeUndefined();
    expect(findCurrentTrace(traces, "Q1", "z")).toBeUndefined();
  });

  it("resolves a primary terminal spelled out to the part's own untagged trace", () => {
    // `Ic(Q1)` and `Id(M1)` are what LTspice calls a collector and a drain, and
    // nothing in a result carries `terminal: "c"` or `"d"` - the trace holding
    // those currents is the untagged one - so an exact match found nothing at
    // all for either spelling.
    expect(findCurrentTrace(traces, "Q1", "c")?.label).toBe("I(Q1)");
    expect(findCurrentTrace(traces, "M1", "D")?.label).toBe("I(M1)");
    // Landing on the part rather than on one of its tagged terminals is the
    // whole point: the emitter and the source sit in the same list under the
    // same ref-des, with the opposite sign.
    expect(findCurrentTrace(traces, "Q1", "c")?.values).toEqual([10, 10]);
    expect(findCurrentTrace(traces, "M1", "d")?.values).toEqual([2, 2]);
  });

  it("folds exactly the terminal the deck saves as the part's own current", () => {
    // Two tables state the same fact - what a part's own current IS - one for
    // the `.save` card and one for resolution. A letter that drifted apart
    // resolves to nothing, with no error to say why.
    expect(Object.keys(PRIMARY_TERMINALS).sort()).toEqual(Object.keys(DEVICE_CURRENT_PARAMS).sort());
    for (const [element, terminal] of Object.entries(PRIMARY_TERMINALS)) {
      expect(DEVICE_CURRENT_PARAMS[element], element).toBe(`i${terminal}`);
    }
  });

  it("splits a current signal into its part and terminal", () => {
    expect(parseCurrentSignal("I(R1)")).toEqual({ ref: "R1" });
    expect(parseCurrentSignal(" Ie(Q1) ")).toEqual({ ref: "Q1", terminal: "e" });
    expect(parseCurrentSignal("IB(Q1)")).toEqual({ ref: "Q1", terminal: "b" });
    expect(parseCurrentSignal("Ig(M1)")).toEqual({ ref: "M1", terminal: "g" });
    expect(parseCurrentSignal("Is(M1)")).toEqual({ ref: "M1", terminal: "s" });
    expect(parseCurrentSignal("V(out)")).toBeNull();
    expect(parseCurrentSignal("out")).toBeNull();
    expect(parseCurrentSignal("I()")).toBeNull();
  });
});
