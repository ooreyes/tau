import { describe, expect, it } from "vitest";
import { phaseDetectorDeckLines, parsePhaseDetector } from "../src/engine/phaseDetectorSpec";
import { varistorDeckLine } from "../src/engine/varistorSpec";
import { compareWaveforms } from "../src/simulation/waveformCompare";
import { runPairedBatch } from "./parityHarness";

describe("LTspice special-device parity", () => {
  it("matches the documented four-terminal VARISTOR waveform", () => {
    const common = [
      "Tau/LTspice controlled varistor parity",
      "Vdrive src 0 SIN(0 5 10k)",
      "Vcontrol ctrl 0 PULSE(-3 3 0 .5m .5m 0 1m)",
      "R1 src out 1k",
    ];
    const ltspice = [
      ...common,
      "A1 ctrl 0 0 0 0 0 out 0 VARISTOR Rclamp=1",
      ".tran 1u 3m 0 1u",
    ].join("\n");
    const ngspice = [
      ...common,
      varistorDeckLine("A1", "ctrl", "0", "out", "0", { rclamp: 1 }),
      ".tran 1u 3m 0 1u",
    ].join("\n");
    const result = runPairedBatch("varistor", ltspice, ["v(out)"], [], ngspice);
    const lt = result.ltspice.get("v(out)")!;
    const ng = result.ngspice.get("v(out)")!;
    const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
      rmsTolerance: 0.005,
      maxTolerance: 0.02,
    });
    expect(comparison.pass, JSON.stringify(comparison)).toBe(true);
  });

  it("matches PHASEDET charge-pump polarity and accumulated phase error", () => {
    const common = [
      "Tau/LTspice phase-frequency detector parity",
      "Va a 0 PULSE(-.5 2.5 10u 1n 1n .4m 1m)",
      "Vb b 0 PULSE(-.5 2.5 110u 1n 1n .4m 1m)",
      "Rload q 0 100k",
      "Cload q 0 100n",
    ];
    const spec = parsePhaseDetector("Iout=15u Vhigh=2.5 Vlow=-.5 Ref=0");
    const ltspice = [
      ...common,
      "A1 a b 0 0 0 0 q 0 PHASEDET Iout=15u Vhigh=2.5 Vlow=-.5 Ref=0",
      ".tran 1u 5m 0 1u",
    ].join("\n");
    const ngspice = [
      ...common,
      ...phaseDetectorDeckLines("A1", { a: "a", b: "b", q: "q", com: "0" }, spec),
      ".tran 1u 5m 0 1u",
    ].join("\n");
    const result = runPairedBatch("phidet", ltspice, ["v(q)"], [], ngspice);
    const lt = result.ltspice.get("v(q)")!;
    const ng = result.ngspice.get("v(q)")!;
    const comparison = compareWaveforms(ng.axis, ng.values, lt.axis, lt.values, {
      rmsTolerance: 0.03,
      maxTolerance: 0.12,
    });
    expect(comparison.pass, JSON.stringify(comparison)).toBe(true);
  });
});
