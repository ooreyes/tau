import { describe, it, expect } from "vitest";
import { serializeRaw, inferRawType } from "./rawExport";
import { parseRaw, rawTrace } from "./rawImport";

describe("inferRawType", () => {
  it("classifies axis and signal names", () => {
    expect(inferRawType("time")).toBe("time");
    expect(inferRawType("frequency")).toBe("frequency");
    expect(inferRawType("V(out)")).toBe("voltage");
    expect(inferRawType("I(R1)")).toBe("device_current");
    expect(inferRawType("Ix(u1:1)")).toBe("device_current");
  });
});

describe("serializeRaw → parseRaw round trip", () => {
  it("round-trips a real transient result", () => {
    const input = {
      plotname: "Transient Analysis",
      variables: [
        { index: 0, name: "time", type: "time" },
        { index: 1, name: "V(out)", type: "voltage" },
        { index: 2, name: "I(R1)", type: "device_current" },
      ],
      values: [
        [0, 1e-3, 2e-3, 3e-3],
        [0, 2.5, -1.25, 5],
        [0, 1e-3, 2e-3, -3e-3],
      ],
    };
    const data = parseRaw(serializeRaw(input));
    expect(data.plotname).toBe("Transient Analysis");
    expect(data.complex).toBe(false);
    expect(data.pointCount).toBe(4);
    expect(data.variables.map((v) => v.name)).toEqual(["time", "V(out)", "I(R1)"]);
    // time is float64 → exact; dependents are float32 → close.
    expect(data.values[0]).toEqual([0, 1e-3, 2e-3, 3e-3]);
    const out = rawTrace(data, "V(out)")!;
    expect(out.values[1]).toBeCloseTo(2.5, 5);
    expect(out.values[3]).toBeCloseTo(5, 5);
    expect(rawTrace(data, "I(R1)")!.values[2]).toBeCloseTo(2e-3, 6);
  });

  it("round-trips complex AC data as magnitude", () => {
    const input = {
      plotname: "AC Analysis",
      complex: true,
      variables: [
        { index: 0, name: "frequency", type: "frequency" },
        { index: 1, name: "V(out)", type: "voltage" },
      ],
      values: [
        [10, 100],
        [3, 0],
      ],
      imaginary: [
        [0, 0],
        [4, -2],
      ],
    };
    const data = parseRaw(serializeRaw(input));
    expect(data.complex).toBe(true);
    // magnitude of (3 + 4i) = 5, magnitude of (0 - 2i) = 2.
    const trace = rawTrace(data, "V(out)")!;
    expect(trace.values[0]).toBeCloseTo(5, 6);
    expect(trace.values[1]).toBeCloseTo(2, 6);
  });

  it("infers variable types when omitted", () => {
    const data = parseRaw(
      serializeRaw({
        plotname: "Transient Analysis",
        variables: [
          { index: 0, name: "time", type: "" },
          { index: 1, name: "V(a)", type: "" },
        ],
        values: [[0, 1], [2, 3]],
      }),
    );
    expect(data.variables[0].type).toBe("time");
    expect(data.variables[1].type).toBe("voltage");
  });

  it("rejects a malformed value matrix", () => {
    expect(() =>
      serializeRaw({
        plotname: "x",
        variables: [{ index: 0, name: "time", type: "time" }],
        values: [[0, 1], [2, 3]],
      }),
    ).toThrow(/variables/);
    expect(() =>
      serializeRaw({
        plotname: "x",
        variables: [
          { index: 0, name: "time", type: "time" },
          { index: 1, name: "V(a)", type: "voltage" },
        ],
        values: [[0, 1, 2], [2, 3]],
      }),
    ).toThrow(/same point count/);
  });
});
