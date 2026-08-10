import { describe, it, expect } from "vitest";
import { runDcMeasurements, dcResultToWaveform } from "./measureDc";
import { runDcSweep, type DcSweepResult } from "./dcSweep";
import type { NetLabel, SchematicComponent } from "../schematic/types";

// A synthetic DC-sweep result we fully control: Vin swept 0→10 step 1 driving a
// node `out` at exactly Vin/2 (a 1:1 divider). Hand-computed so the expected
// measurement values are obvious.
function dividerResult(): Extract<DcSweepResult, { ok: true }> {
  const sweep = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  return {
    ok: true,
    source: "Vin",
    sweep,
    nets: [
      { id: "out", label: "out", voltages: sweep.map((v) => v / 2), ground: false },
      { id: "gnd", label: "GND", voltages: sweep.map(() => 0), ground: true },
    ],
    warnings: [],
  };
}

function descendingDividerResult(): Extract<DcSweepResult, { ok: true }> {
  const sweep = [10, 8, 6, 4, 2, 0];
  return {
    ok: true,
    source: "Vin",
    sweep,
    nets: [{ id: "out", label: "out", voltages: sweep.map((v) => v / 2), ground: false }],
    warnings: [],
  };
}

describe("dcResultToWaveform", () => {
  it("maps the sweep axis and net series onto a MeasWaveform", () => {
    const wf = dcResultToWaveform(dividerResult());
    expect(wf.times).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(wf.traces.map((t) => t.label)).toEqual(["out", "GND"]);
    expect(wf.traces[0].values[10]).toBe(5);
  });
});

describe("runDcMeasurements", () => {
  it("evaluates MAX/MIN aggregates over the swept axis", () => {
    const res = runDcMeasurements(
      [".meas dc vmax MAX V(out)", ".meas dc vmin MIN V(out)"],
      dividerResult(),
    );
    expect(res.map((r) => [r.name, r.value])).toEqual([
      ["vmax", 5],
      ["vmin", 0],
    ]);
  });

  it("FIND V(out) AT=<source value> interpolates on the source axis", () => {
    const [r] = runDcMeasurements([".meas dc vat FIND V(out) AT=6"], dividerResult());
    expect(r.value).toBeCloseTo(3, 12); // V(out)=Vin/2 → at Vin=6, out=3
    expect(r.at).toBe(6);
  });

  it("matches LTspice measurements on a descending DC sweep", () => {
    const result = descendingDividerResult();
    const measured = runDcMeasurements([
      ".meas dc vat FIND V(out) AT=5",
      ".meas dc vmax MAX V(out) FROM=2.5 TO=7.5",
      ".meas dc vmin MIN V(out) FROM=2.5 TO=7.5",
      ".meas dc vavg AVG V(out) FROM=2.5 TO=7.5",
      ".meas dc vint INTEG V(out) FROM=2.5 TO=7.5",
      ".meas dc trip WHEN V(out)=3",
    ], result);
    expect(measured.map(({ name, value }) => [name, value])).toEqual([
      ["vat", 2.5],
      ["vmax", 3.75],
      ["vmin", 1.25],
      ["vavg", 2.5],
      ["vint", 12.5],
      ["trip", 6],
    ]);
  });

  it("WHEN V(out)=<level> returns the swept-source value at the crossing", () => {
    const [r] = runDcMeasurements([".meas dc trip WHEN V(out)=2.5"], dividerResult());
    // out=2.5 occurs at Vin=5.
    expect(r.value).toBeCloseTo(5, 12);
  });

  it("chains: a later PARAM references earlier measurement names", () => {
    const res = runDcMeasurements(
      [".meas dc vmax MAX V(out)", ".meas dc vmin MIN V(out)", ".meas dc span PARAM vmax-vmin"],
      dividerResult(),
    );
    expect(res.find((r) => r.name === "span")?.value).toBeCloseTo(5, 12);
  });

  it("ignores .meas tran / .meas ac lines (wrong domain)", () => {
    const res = runDcMeasurements(
      [".meas tran t MAX V(out)", ".meas ac g FIND db(V(out)) AT=1k", ".meas dc vmax MAX V(out)"],
      dividerResult(),
    );
    expect(res).toHaveLength(1);
    expect(res[0].name).toBe("vmax");
  });

  it("returns no measurements for a failed sweep", () => {
    const failed: DcSweepResult = { ok: false, message: "boom", warnings: [] };
    expect(runDcMeasurements([".meas dc vmax MAX V(out)"], failed)).toEqual([]);
  });

  // Integration: measure over a real solver run with an electrical net label so
  // `V(out)` resolves by name. V(out) = Vin * R2/(R1+R2) = Vin/2.
  it("measures over a real runDcSweep result via a net label", () => {
    const components: SchematicComponent[] = [
      { id: "vin", label: "Vin", kind: "vsource", x: 0, y: 0, rotation: 0, value: "0",
        pinOverride: [{ id: "p", label: "+", x: 0, y: 0 }, { id: "n", label: "-", x: 0, y: 100 }] },
      { id: "r1", label: "R1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k",
        pinOverride: [{ id: "a", label: "a", x: 0, y: 0 }, { id: "b", label: "b", x: 0, y: 50 }] },
      { id: "r2", label: "R2", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k",
        pinOverride: [{ id: "a", label: "a", x: 0, y: 50 }, { id: "b", label: "b", x: 0, y: 100 }] },
      { id: "g", label: "", kind: "ground", x: 0, y: 100, rotation: 0, value: "",
        pinOverride: [{ id: "g", label: "gnd", x: 0, y: 100 }] },
    ];
    const netLabels: NetLabel[] = [{ id: "nl", x: 0, y: 50, text: "out" }];
    const result = runDcSweep({ components, wires: [], netLabels }, { source: "Vin", start: 0, stop: 10, step: 2 });
    expect(result.ok).toBe(true);

    const [vmax] = runDcMeasurements([".meas dc vmax MAX V(out)"], result);
    expect(vmax.value).toBeCloseTo(5, 9); // Vin max 10 → out 5
  });
});
