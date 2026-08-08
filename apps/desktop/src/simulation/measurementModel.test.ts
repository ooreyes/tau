import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "./linearTransient";
import { runTransientAnalysis } from "./linearTransient";
import type { SchematicComponent, SchematicWire } from "../schematic/types";
import { classifySignal, componentMeasurements, noiseFloorForUnit, traceStatistics, windowedTraceStatistics } from "./measurementModel";

describe("traceStatistics", () => {
  it("computes min/max/final and time-weighted AVG/RMS on a non-uniform axis", () => {
    const stats = traceStatistics([0, 1, 3], [0, 2, 2]);
    expect(stats).not.toBeNull();
    expect(stats!.min).toBe(0);
    expect(stats!.max).toBe(2);
    expect(stats!.final).toBe(2);
    expect(stats!.average).toBeCloseTo(5 / 3);
    expect(stats!.rms).toBeCloseTo(Math.sqrt(10 / 3));
  });

  it("ignores non-finite samples and returns null for no usable values", () => {
    expect(traceStatistics([0, 1, 2], [1, Number.NaN, 3])).toMatchObject({ min: 1, max: 3, final: 3 });
    expect(traceStatistics([0], [Number.NaN])).toBeNull();
  });

  it("excludes values whose timestamps are not finite", () => {
    expect(traceStatistics([0, Number.NaN, 2], [1, 100, 3])).toMatchObject({ min: 1, max: 3, final: 3 });
  });
});

describe("windowedTraceStatistics", () => {
  it("restricts AVG/RMS to the visible [tMin,tMax] window", () => {
    // Full run: [0,1,2,3] → values [0,0,10,10]. Window [1,2] → samples 0,10 at t=1,2.
    const stats = windowedTraceStatistics([0, 1, 2, 3], [0, 0, 10, 10], 1, 2);
    expect(stats).not.toBeNull();
    expect(stats!.average).toBeCloseTo(5);
    expect(stats!.rms).toBeCloseTo(Math.sqrt(50));
    expect(stats!.min).toBe(0);
    expect(stats!.max).toBe(10);
  });

  it("returns null for an empty or inverted window", () => {
    expect(windowedTraceStatistics([0, 1], [1, 2], 5, 6)).toBeNull();
    expect(windowedTraceStatistics([0, 1], [1, 2], 1, 1)).toBeNull();
  });
});

describe("classifySignal", () => {
  it("separates steady, one-shot transient, and periodic signals", () => {
    expect(classifySignal([0, 1, 2], [5, 5, 5])).toEqual({ kind: "steady" });
    expect(classifySignal([0, 1, 2, 3, 4], [0, 1, 0.6, 0.3, 0.1])).toEqual({ kind: "transient" });

    const times = Array.from({ length: 401 }, (_, i) => i / 100);
    const values = times.map((time) => 3 + 2 * Math.sin(2 * Math.PI * 2 * time));
    const classification = classifySignal(times, values);
    expect(classification.kind).toBe("periodic");
    expect(classification.frequency).toBeCloseTo(2, 2);
  });

  it("calls a trace that stopped moving settled, not an ongoing transient", () => {
    const times = Array.from({ length: 200 }, (_, i) => i / 199);
    // The shape the defect report was about: one step at t=0 and a flat line
    // afterwards. The step is real movement - it is just over.
    expect(classifySignal(times, times.map((_, i) => (i === 0 ? 1.9268998 : 1.9268818))))
      .toEqual({ kind: "settled" });
    // An exponential that finished inside the run has also settled.
    expect(classifySignal(times, times.map((t) => 5 * (1 - Math.exp(-t / 0.01)))))
      .toEqual({ kind: "settled" });
  });

  it("keeps calling a trace transient while it is still moving at the stop time", () => {
    const times = Array.from({ length: 200 }, (_, i) => i / 199);
    // Same exponential, but with a time constant long enough that the last
    // quarter of the run is still visibly climbing.
    expect(classifySignal(times, times.map((t) => 5 * (1 - Math.exp(-t / 0.5)))))
      .toEqual({ kind: "transient" });
  });

  it("does not mistake damped ringing for a sustained periodic signal", () => {
    const times = Array.from({ length: 401 }, (_, i) => i / 100);
    const values = times.map((time) => Math.exp(-time) * Math.sin(2 * Math.PI * 2 * time));
    expect(classifySignal(times, values)).toEqual({ kind: "transient" });
  });

  it("reports frequency for a single 10 Hz sine cycle over 100 ms", () => {
    // Auto-resolution for Class-D (10 Hz audio + 100 kHz carrier) often lands
    // on a 100 ms window - exactly one audio cycle. Rising-only detection
    // previously needed ≥3 periods and labelled this transient.
    const times = Array.from({ length: 1001 }, (_, i) => i * 0.0001);
    const values = times.map((time) => Math.sin(2 * Math.PI * 10 * time));
    const classification = classifySignal(times, values);
    expect(classification.kind).toBe("periodic");
    expect(classification.frequency).toBeCloseTo(10, 1);
    expect(classification.period).toBeCloseTo(0.1, 2);
  });

  it("still reports frequency for a dense multi-cycle carrier", () => {
    const times = Array.from({ length: 2001 }, (_, i) => i * 1e-7);
    const values = times.map((time) => Math.sin(2 * Math.PI * 100_000 * time));
    const classification = classifySignal(times, values);
    expect(classification.kind).toBe("periodic");
    expect(classification.frequency).toBeCloseTo(100_000, -2);
  });

  it.each([0.1, 0.2, 0.4, 0.6, 0.8, 0.9])(
    "classifies a %.0% duty pulse train at its true frequency",
    (duty) => {
      const frequency = 2_500;
      const period = 1 / frequency;
      const times = Array.from({ length: 8_001 }, (_, i) => i * period / 1_000);
      const values = times.map((time) => (time % period) < duty * period ? 3.3 : 0);
      const classification = classifySignal(times, values);
      expect(classification.kind).toBe("periodic");
      expect(classification.frequency).toBeCloseTo(frequency, -1);
      expect(classification.period).toBeCloseTo(period, 5);
    },
  );
});

function resultFixture(): Extract<AnalysisResult, { ok: true }> {
  return {
    ok: true,
    title: "Transient",
    times: [0, 1, 2],
    traces: [{ id: "out", label: "V(out)", unit: "V", color: "var(--trace-cyan)", values: [4, 2, 0] }],
    currents: [{ ref: "R1", label: "I(R1)", values: [2, 1, 0] }],
    stats: { netCount: 2, componentCount: 2, sampleCount: 3, stopTime: 2, stepSize: 1 },
    warnings: [],
    circuit: {
      groundNetId: "gnd",
      warnings: [],
      nets: [
        { id: "out", points: [], pins: [], isGround: false, labelCount: 1 },
        { id: "gnd", points: [], pins: [], isGround: true, labelCount: 0 },
      ],
      components: [
        {
          component: { id: "r1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "2", label: "R1" },
          pins: { a: "out", b: "gnd" },
        },
        {
          component: { id: "g1", kind: "ground", x: 0, y: 0, rotation: 0, value: "", label: "" },
          pins: { g: "gnd" },
        },
      ],
    },
  };
}

describe("componentMeasurements", () => {
  it("derives signed V/I/P series and summaries using component polarity", () => {
    const rows = componentMeasurements(resultFixture());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ componentId: "r1", ref: "R1", kind: "resistor" });
    expect(rows[0].voltage?.values).toEqual([4, 2, 0]);
    expect(rows[0].current?.values).toEqual([2, 1, 0]);
    expect(rows[0].power?.values).toEqual([8, 2, 0]);
    expect(rows[0].voltage?.statistics).toMatchObject({ min: 0, max: 4, average: 2, final: 0 });
    expect(rows[0].power?.unit).toBe("W");
  });

  it("keeps a component row but omits unavailable current and power", () => {
    const result = resultFixture();
    result.currents = [];
    const [row] = componentMeasurements(result);
    expect(row.voltage).toBeDefined();
    expect(row.current).toBeUndefined();
    expect(row.power).toBeUndefined();
  });

  it("derives an LED current from source branch current by KCL and reports the measured direct drive", () => {
    const result = resultFixture();
    result.traces[0] = {
      ...result.traces[0],
      id: "hot",
      label: "V(hot)",
      values: [5, 5, 5],
    };
    result.currents = [{ ref: "V1", label: "I(V1)", values: [-0.315, -0.315, -0.315] }];
    result.circuit.nets = [
      { id: "hot", points: [], pins: [], isGround: false, labelCount: 0 },
      { id: "gnd", points: [], pins: [], isGround: true, labelCount: 0 },
    ];
    result.circuit.components = [
      {
        component: { id: "v1", kind: "vsource", x: 0, y: 0, rotation: 0, value: "5", label: "V1" },
        pins: { p: "hot", n: "gnd" },
      },
      {
        component: { id: "d1", kind: "led", x: 0, y: 0, rotation: 0, value: "LED", label: "D1" },
        pins: { a: "hot", k: "gnd" },
      },
      {
        component: { id: "g1", kind: "ground", x: 0, y: 0, rotation: 0, value: "", label: "" },
        pins: { g: "gnd" },
      },
    ];

    const [source, led] = componentMeasurements(result);
    expect(source.current?.values).toEqual([-0.315, -0.315, -0.315]);
    expect(led.current?.values).toEqual([0.315, 0.315, 0.315]);
    expect(led.power?.statistics.final).toBeCloseTo(1.575);
    expect(led.advisories).toEqual([
      expect.objectContaining({
        kind: "direct-led-drive",
        severity: "warning",
        title: "Direct LED drive · no external limiter",
        message: expect.stringMatching(/D1 model predicts 315 mA.+not an overcurrent determination.+series resistor/i),
      }),
    ]);
  });

  it("does not fabricate a direct-drive current advisory from topology alone", () => {
    const result = resultFixture();
    result.traces[0] = {
      ...result.traces[0],
      id: "hot",
      label: "V(hot)",
      values: [0, 0, 0],
    };
    result.currents = [{ ref: "V1", label: "I(V1)", values: [0, 0, 0] }];
    result.circuit.nets = [
      { id: "hot", points: [], pins: [], isGround: false, labelCount: 0 },
      { id: "gnd", points: [], pins: [], isGround: true, labelCount: 0 },
    ];
    result.circuit.components = [
      {
        component: { id: "v1", kind: "vsource", x: 0, y: 0, rotation: 0, value: "0", label: "V1" },
        pins: { p: "hot", n: "gnd" },
      },
      {
        component: { id: "d1", kind: "led", x: 0, y: 0, rotation: 0, value: "LED", label: "D1" },
        pins: { a: "hot", k: "gnd" },
      },
    ];

    const led = componentMeasurements(result).find((row) => row.ref === "D1");
    expect(led?.current?.statistics.final).toBe(0);
    expect(led?.power?.statistics.final).toBe(0);
    expect(led?.advisories).toBeUndefined();
  });

  it("does not claim a current-limiter warning when a resistor is in series", () => {
    const result = resultFixture();
    result.traces = [
      { ...result.traces[0], id: "source", label: "V(source)", values: [5, 5, 5] },
      { ...result.traces[0], id: "led-anode", label: "V(led-anode)", values: [2, 2, 2] },
    ];
    result.currents = [{ ref: "V1", label: "I(V1)", values: [-0.315, -0.315, -0.315] }];
    result.circuit.components = [
      {
        component: { id: "v1", kind: "vsource", x: 0, y: 0, rotation: 0, value: "5", label: "V1" },
        pins: { p: "source", n: "gnd" },
      },
      {
        component: { id: "r1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "10", label: "R1" },
        pins: { a: "source", b: "led-anode" },
      },
      {
        component: { id: "d1", kind: "led", x: 0, y: 0, rotation: 0, value: "LED", label: "D1" },
        pins: { a: "led-anode", k: "gnd" },
      },
      {
        component: { id: "g1", kind: "ground", x: 0, y: 0, rotation: 0, value: "", label: "" },
        pins: { g: "gnd" },
      },
    ];

    const led = componentMeasurements(result).find((row) => row.ref === "D1");
    expect(led?.current?.statistics.final).toBeCloseTo(0.315);
    expect(led?.advisories).toBeUndefined();
  });

  it("does not infer one branch current through a multi-terminal transistor", () => {
    const result = resultFixture();
    result.traces = [
      { ...result.traces[0], id: "collector", label: "V(collector)", values: [5, 5, 5] },
      { ...result.traces[0], id: "emitter", label: "V(emitter)", values: [0.7, 0.7, 0.7] },
      { ...result.traces[0], id: "base", label: "V(base)", values: [1.4, 1.4, 1.4] },
    ];
    result.currents = [{ ref: "V1", label: "I(V1)", values: [-0.02, -0.02, -0.02] }];
    result.circuit.components = [
      {
        component: { id: "v1", kind: "vsource", x: 0, y: 0, rotation: 0, value: "5", label: "V1" },
        pins: { p: "emitter", n: "gnd" },
      },
      {
        component: { id: "q1", kind: "npn", x: 0, y: 0, rotation: 0, value: "2N3904", label: "Q1" },
        pins: { c: "collector", b: "base", e: "emitter" },
      },
    ];

    const transistor = componentMeasurements(result).find((row) => row.ref === "Q1");
    expect(transistor?.voltage).toBeDefined();
    expect(transistor?.current).toBeUndefined();
    expect(transistor?.power).toBeUndefined();
  });

  it("uses passive sign convention for independent current-source power", () => {
    const result = resultFixture();
    result.circuit.components[0].component = {
      ...result.circuit.components[0].component,
      id: "i1",
      label: "I1",
      kind: "isource",
    };
    result.currents = [{ ref: "I1", label: "I(I1)", values: [2, 1, 0] }];
    const [row] = componentMeasurements(result);
    expect(row.current?.values).toEqual([-2, -1, -0]);
    expect(row.power?.values).toEqual([-8, -2, -0]);
    expect(row.power?.statistics.min).toBe(-8);
  });

  /**
   * A charged two-terminal part across one node and ground. `hot` carries the
   * voltage at the part's `a` pin unless the wiring is flipped by the caller.
   */
  function capacitorFixture(
    kind: "capacitor" | "polarizedCapacitor",
    pins: { a: string; b: string },
    hotVolts: readonly number[],
  ): Extract<AnalysisResult, { ok: true }> {
    const result = resultFixture();
    result.traces = [{ ...result.traces[0], id: "hot", label: "V(hot)", values: [...hotVolts] }];
    result.currents = [];
    result.circuit.nets = [
      { id: "hot", points: [], pins: [], isGround: false, labelCount: 0 },
      { id: "gnd", points: [], pins: [], isGround: true, labelCount: 0 },
    ];
    result.circuit.components = [
      {
        component: { id: "c1", kind, x: 0, y: 0, rotation: 0, value: "10µ", label: "C1" },
        pins,
      },
      {
        component: { id: "g1", kind: "ground", x: 0, y: 0, rotation: 0, value: "", label: "" },
        pins: { g: "gnd" },
      },
    ];
    return result;
  }

  it("stays silent on a correctly oriented polarized capacitor", () => {
    // `a` is the marked "+" terminal, so `a` on the 5 V node is right way round.
    const rows = componentMeasurements(capacitorFixture("polarizedCapacitor", { a: "hot", b: "gnd" }, [0, 2.5, 5]));
    const cap = rows.find((row) => row.ref === "C1");
    expect(cap?.voltage?.statistics.final).toBe(5);
    expect(cap?.advisories).toBeUndefined();
  });

  it("warns by name and voltage when a polarized capacitor is wired backwards", () => {
    const rows = componentMeasurements(capacitorFixture("polarizedCapacitor", { a: "gnd", b: "hot" }, [0, 2.1, 4.2]));
    const cap = rows.find((row) => row.ref === "C1");
    expect(cap?.voltage?.statistics.final).toBe(-4.2);
    expect(cap?.advisories).toEqual([
      expect.objectContaining({
        kind: "reverse-biased-electrolytic",
        severity: "warning",
        title: "Reverse-biased electrolytic · sustained",
        message: expect.stringMatching(/^C1: reverse-biased to -4\.2 V and still reverse-biased when the run ends\./),
      }),
    ]);
    expect(cap?.advisories?.[0].message).toContain("positive terminal is the lower one");
  });

  it("separates a polarized capacitor that only reverses while the circuit settles", () => {
    const result = capacitorFixture("polarizedCapacitor", { a: "hot", b: "gnd" }, [-4.2, 1, 3]);
    const cap = componentMeasurements(result).find((row) => row.ref === "C1");
    expect(cap?.advisories).toHaveLength(1);
    expect(cap?.advisories?.[0].title).toBe("Reverse-biased electrolytic · during settling");
    expect(cap?.advisories?.[0].message).toContain("then recovers");
  });

  it("never reports polarity on a plain capacitor, wired either way", () => {
    for (const pins of [{ a: "hot", b: "gnd" }, { a: "gnd", b: "hot" }]) {
      const cap = componentMeasurements(capacitorFixture("capacitor", pins, [0, 2.1, 4.2]))
        .find((row) => row.ref === "C1");
      expect(cap?.voltage).toBeDefined();
      expect(cap?.advisories).toBeUndefined();
    }
  });

  it("does not raise polarity noise from millivolt solver residue around 0 V", () => {
    // Reversed wiring, but the node never leaves the numerical floor: 0.9 mV
    // of residue against a 1 mV threshold is not a reversal.
    const cap = componentMeasurements(capacitorFixture("polarizedCapacitor", { a: "gnd", b: "hot" }, [0, 4e-4, 9e-4]))
      .find((row) => row.ref === "C1");
    expect(cap?.voltage?.statistics.final).toBeCloseTo(-9e-4, 12);
    expect(cap?.advisories).toBeUndefined();
  });

  it("bounds retained sparkline samples for large native results", () => {
    const result = resultFixture();
    result.times = Array.from({ length: 10_000 }, (_, index) => index / 10_000);
    result.traces[0].values = result.times.map((time) => Math.sin(time));
    result.currents[0].values = result.times.map(() => 1);
    const [row] = componentMeasurements(result);
    expect(row.voltage?.values.length).toBeLessThanOrEqual(96);
    expect(row.current?.values.length).toBeLessThanOrEqual(96);
    expect(row.power?.values.length).toBeLessThanOrEqual(96);
  });
});

describe("classifySignal noise floor", () => {
  const times = Array.from({ length: 601 }, (_, i) => i * 1e-5);

  it("calls a dead pA-scale current steady instead of inventing a frequency", () => {
    // Exactly the shape of a settled RC under a DC source in native ngspice:
    // a ~5 pA leakage with femtoamp solver jitter. With only a relative
    // tolerance this returned {kind:"periodic", frequency:~15.9 kHz}.
    const values = times.map((_, i) => 5e-12 + Math.sin(i) * 1e-15);
    const classification = classifySignal(times, values, noiseFloorForUnit("A"));
    expect(classification.kind).toBe("steady");
    expect(classification.frequency).toBeUndefined();
  });

  it("still resolves a real small-signal current above the floor", () => {
    // A 5 pA peak-to-peak 1 kHz signal is genuine, not noise, and must survive.
    const values = times.map((t) => 5e-12 * Math.sin(2 * Math.PI * 1e3 * t));
    const classification = classifySignal(times, values, noiseFloorForUnit("A"));
    expect(classification.kind).toBe("periodic");
    expect(classification.frequency).toBeCloseTo(1e3, -2);
  });

  it("keeps a settled volt-scale node steady, as it already did", () => {
    const values = times.map((_, i) => 5 + Math.sin(i) * 3e-15);
    expect(classifySignal(times, values, noiseFloorForUnit("V")).kind).toBe("steady");
  });

  it("maps each quantity to its own floor and leaves unitless traces alone", () => {
    expect(noiseFloorForUnit("A")).toBe(1e-12);
    expect(noiseFloorForUnit("V")).toBe(1e-9);
    expect(noiseFloorForUnit("W")).toBe(1e-15);
    expect(noiseFloorForUnit("")).toBe(0);
    expect(noiseFloorForUnit(undefined)).toBe(0);
  });

  it("defaults to the old purely-relative behaviour when no floor is given", () => {
    const values = times.map((_, i) => 5e-12 + Math.sin(i) * 1e-15);
    expect(classifySignal(times, values).kind).not.toBe("steady");
  });
});

/**
 * The two circuits from the "everything is time-varying" defect report, run
 * through the real solver rather than a fixture. Geometry conventions are the
 * ones documented at the top of realCircuits.test.ts: two-terminal parts sit at
 * x±32, sources put `p` at y-32 and `n` at y+32, and pins connect where their
 * world coordinates coincide.
 */
describe("componentMeasurements over a solved circuit", () => {
  let uid = 0;
  const mk = (
    kind: SchematicComponent["kind"],
    x: number,
    y: number,
    value: string,
    label: string,
  ): SchematicComponent => ({ id: `${kind}-${++uid}`, kind, x, y, rotation: 0, value, label });
  const wire = (...points: { x: number; y: number }[]): SchematicWire => ({ id: `w-${++uid}`, points });

  /** source → R1 → D1 → back to the source's negative terminal, which is ground. */
  async function ledLoop(source: SchematicComponent) {
    const result = await runTransientAnalysis(
      {
        components: [source, mk("ground", 0, 32, "", ""), mk("resistor", 96, -64, "1k", "R1"), mk("led", 224, -64, "", "D1")],
        wires: [
          wire({ x: 0, y: -32 }, { x: 0, y: -64 }, { x: 64, y: -64 }),
          wire({ x: 128, y: -64 }, { x: 192, y: -64 }),
          wire({ x: 256, y: -64 }, { x: 256, y: 32 }, { x: 0, y: 32 }),
        ],
      },
      { stopTime: 5e-3, steps: 512 },
    );
    if (!result.ok) throw new Error(`solver failed: ${result.message}`);
    return componentMeasurements(result);
  }

  it("reports no time-varying quantity anywhere in a 5 V / 1 k / LED DC circuit", async () => {
    const rows = await ledLoop(mk("vsource", 0, 0, "5", "V1"));
    expect(rows.map((row) => row.ref).sort()).toEqual(["D1", "R1", "V1"]);

    for (const row of rows) {
      for (const series of [row.voltage, row.current, row.power]) {
        if (!series) continue;
        // Nothing in this circuit varies. The solver's first sample comes from
        // the operating-point solve and differs from the transient solver's
        // answer by their convergence tolerances (~18 µV on the LED node);
        // that is the solver arriving, not the circuit doing something.
        expect(
          series.classification.kind,
          `${series.id} classified ${series.classification.kind}`,
        ).toMatch(/^(steady|settled)$/);
        expect(series.classification.frequency).toBeUndefined();
      }
    }

    const led = rows.find((row) => row.ref === "D1")!;
    expect(led.current?.statistics.final).toBeCloseTo(3.07e-3, 5);
  });

  it("still reports periodic quantities when the source really is a sine", async () => {
    const rows = await ledLoop(mk("vac", 0, 0, "SINE(0 5 2k)", "V1"));
    const resistor = rows.find((row) => row.ref === "R1")!;

    expect(resistor.voltage?.classification.kind).toBe("periodic");
    expect(resistor.voltage?.classification.frequency).toBeCloseTo(2000, -2);
    expect(resistor.current?.classification.kind).toBe("periodic");
  });
});
