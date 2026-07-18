import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "./linearTransient";
import { classifySignal, componentMeasurements, traceStatistics } from "./measurementModel";

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

  it("does not mistake damped ringing for a sustained periodic signal", () => {
    const times = Array.from({ length: 401 }, (_, i) => i / 100);
    const values = times.map((time) => Math.exp(-time) * Math.sin(2 * Math.PI * 2 * time));
    expect(classifySignal(times, values)).toEqual({ kind: "transient" });
  });

  it("reports frequency for a single 10 Hz sine cycle over 100 ms", () => {
    // Auto-resolution for Class-D (10 Hz audio + 100 kHz carrier) often lands
    // on a 100 ms window — exactly one audio cycle. Rising-only detection
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
