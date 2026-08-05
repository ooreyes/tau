import { describe, expect, it } from "vitest";
import { dualAxisSide, partitionTracesByAxis, planDualAxisY } from "./dualAxis";

describe("planDualAxisY", () => {
  it("uses a single axis when every trace shares one unit", () => {
    expect(planDualAxisY(["V", "V"])).toEqual({ dual: false, leftUnit: "V", rightUnit: null });
    expect(planDualAxisY(["A", "A", ""])).toEqual({ dual: false, leftUnit: "A", rightUnit: null });
  });

  it("defaults empty panes to volts on a single axis", () => {
    expect(planDualAxisY([])).toEqual({ dual: false, leftUnit: "V", rightUnit: null });
    expect(planDualAxisY(["", ""])).toEqual({ dual: false, leftUnit: "V", rightUnit: null });
  });

  it("enables dual Y for mixed voltage + current only", () => {
    expect(planDualAxisY(["V", "A"])).toEqual({ dual: true, leftUnit: "V", rightUnit: "A" });
    expect(planDualAxisY(["A", "V", "V", "A"])).toEqual({ dual: true, leftUnit: "V", rightUnit: "A" });
  });

  it("refuses dual for other mixes (no silent third-axis invent)", () => {
    expect(planDualAxisY(["V", "W"])).toEqual({ dual: false, leftUnit: "", rightUnit: null });
    expect(planDualAxisY(["V", "A", "W"])).toEqual({ dual: false, leftUnit: "", rightUnit: null });
    expect(planDualAxisY(["Ω", "A"])).toEqual({ dual: false, leftUnit: "", rightUnit: null });
  });
});

describe("dualAxisSide / partitionTracesByAxis", () => {
  it("routes amps to the right axis when dual", () => {
    const plan = planDualAxisY(["V", "A"]);
    expect(dualAxisSide("V", plan)).toBe("left");
    expect(dualAxisSide("A", plan)).toBe("right");
    expect(dualAxisSide("", plan)).toBe("left");
  });

  it("partitions traces without mutating input order within each side", () => {
    const plan = planDualAxisY(["V", "A"]);
    const traces = [
      { id: "n1", unit: "V" as const },
      { id: "i1", unit: "A" as const },
      { id: "n2", unit: "V" as const },
    ];
    expect(partitionTracesByAxis(traces, plan)).toEqual({
      left: [
        { id: "n1", unit: "V" },
        { id: "n2", unit: "V" },
      ],
      right: [{ id: "i1", unit: "A" }],
    });
  });

  it("keeps every trace on the left in single-axis mode", () => {
    const plan = planDualAxisY(["V", "W"]);
    const traces = [
      { id: "a", unit: "V" as const },
      { id: "b", unit: "W" as const },
    ];
    expect(partitionTracesByAxis(traces, plan)).toEqual({ left: traces, right: [] });
  });
});
