import { describe, expect, it } from "vitest";
import { parseNativeFourier, parseNativeMeasurements } from "./nativeMeasFour";

const SAMPLE_MEAS_LOG = [
  "stdout Doing analysis at TEMP = 27.000000 and TNOM = 27.000000",
  "No. of Data Rows : 512",
  "  Measurements for Transient Analysis",
  "peak                =  2.54392e-01 at=  4.57296e-04",
  "vavg                =  6.99335e-03 from=  2.00000e-03 to=  5.00000e-03",
  "stderr .meas tran bad max v(nope) failed!",
  "Total analysis time (seconds) = 0.002",
];

const SAMPLE_FOUR_LOG = [
  "Fourier analysis for v(out):",
  "  No. Harmonics: 10, THD: 0.267908 %, Gridsize: 200, Interpolation Degree: 1, No. Periods: 1",
  "Harmonic Frequency   Magnitude   Phase       Norm. Mag   Norm. Phase",
  "-------- ---------   ---------   -----       ---------   -----------",
  " 0       0           0.0018007   0           0           0",
  " 1       1000        0.157061    -80.753     1           0",
  " 2       2000        0.000285776 6.22034     0.00181952  86.9737",
  "Total analysis time (seconds) = 0.002",
];

describe("parseNativeMeasurements", () => {
  it("reads successful measure lines and optional at=", () => {
    const rows = parseNativeMeasurements(SAMPLE_MEAS_LOG);
    const peak = rows.find((r) => r.name === "peak");
    const vavg = rows.find((r) => r.name === "vavg");
    expect(peak).toMatchObject({ value: 2.54392e-1, at: 4.57296e-4 });
    expect(vavg?.value).toBeCloseTo(6.99335e-3, 12);
    expect(vavg?.at).toBeUndefined();
  });

  it("records failed .meas lines as null with an error", () => {
    const bad = parseNativeMeasurements(SAMPLE_MEAS_LOG).find((r) => r.name === "bad");
    expect(bad).toEqual({ name: "bad", value: null, error: "ngspice measurement failed" });
  });

  it("ignores DRAM / analysis chatter that looks vaguely numeric", () => {
    const rows = parseNativeMeasurements([
      "Total DRAM available = 16384.000 MB.",
      "Maximum ngspice program size =    9.844 MB.",
    ]);
    expect(rows).toEqual([]);
  });

  it("parses AC-domain measure lines the same way", () => {
    const rows = parseNativeMeasurements([
      "Measurements for AC Analysis",
      "gain                =  -6.02060e+00 at=  1.00000e+03",
    ]);
    expect(rows).toEqual([{ name: "gain", value: -6.0206, at: 1000 }]);
  });
});

describe("parseNativeFourier", () => {
  it("parses the harmonic table and converts THD percent to a fraction", () => {
    const [result] = parseNativeFourier(SAMPLE_FOUR_LOG);
    expect(result.output).toBe("V(out)");
    expect(result.frequency).toBe(1000);
    expect(result.dc).toBeCloseTo(0.0018007, 12);
    expect(result.thd).toBeCloseTo(0.00267908, 12);
    expect(result.harmonics[0]).toMatchObject({ harmonic: 0, magnitude: 0.0018007, normalized: 0 });
    expect(result.harmonics[1]).toMatchObject({
      harmonic: 1,
      frequency: 1000,
      magnitude: 0.157061,
      phase: -80.753,
      normalized: 1,
    });
    expect(result.harmonics[2]?.normalized).toBeCloseTo(0.00181952, 12);
  });

  it("returns empty when no Fourier block is present", () => {
    expect(parseNativeFourier(SAMPLE_MEAS_LOG)).toEqual([]);
  });
});
