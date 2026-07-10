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
