import { describe, expect, it } from "vitest";
import type { SchematicComponent, SchematicWire } from "../schematic/types";
import { runTransientAnalysis } from "./linearTransient";
import {
  LIVE_SCHEMATIC_LOOP_MS,
  LIVE_SCHEMATIC_UPDATE_INTERVAL_MS,
  liveReadoutTime,
  shouldDriveLiveSchematicReadout,
  shouldUpdateLiveSchematicFrame,
} from "./liveSchematicPlayback";
import { nearestSampleIndex, tranComponentCurrents, tranNetVoltages } from "./wireCurrentFlow";

describe("liveSchematicPlayback", () => {
  it("maps wall-clock phase onto the real .tran time axis and loops", () => {
    const times = [0, 1e-3, 2e-3, 4e-3];
    expect(liveReadoutTime(times, 0)).toBeCloseTo(0, 12);
    expect(liveReadoutTime(times, LIVE_SCHEMATIC_LOOP_MS / 2)).toBeCloseTo(2e-3, 12);
    expect(liveReadoutTime(times, LIVE_SCHEMATIC_LOOP_MS)).toBeCloseTo(0, 12);
    expect(liveReadoutTime(times, LIVE_SCHEMATIC_LOOP_MS * 1.25)).toBeCloseTo(1e-3, 12);
  });

  it("returns null / single-sample / final when the axis is empty or flat", () => {
    expect(liveReadoutTime([], 100)).toBeNull();
    expect(liveReadoutTime([7e-3], 100)).toBe(7e-3);
    expect(liveReadoutTime([1, 1], 100)).toBe(1);
  });

  it("yields to cursors and stays off without an ok transient", () => {
    expect(
      shouldDriveLiveSchematicReadout({ liveEnabled: true, cursorsOpen: false, hasOkTransient: true }),
    ).toBe(true);
    expect(
      shouldDriveLiveSchematicReadout({ liveEnabled: true, cursorsOpen: true, hasOkTransient: true }),
    ).toBe(false);
    expect(
      shouldDriveLiveSchematicReadout({ liveEnabled: false, cursorsOpen: false, hasOkTransient: true }),
    ).toBe(false);
    expect(
      shouldDriveLiveSchematicReadout({ liveEnabled: true, cursorsOpen: false, hasOkTransient: false }),
    ).toBe(false);
  });

  it("caps App-visible live readouts at thirty updates per second", () => {
    expect(shouldUpdateLiveSchematicFrame(LIVE_SCHEMATIC_UPDATE_INTERVAL_MS - 0.01)).toBe(false);
    expect(shouldUpdateLiveSchematicFrame(LIVE_SCHEMATIC_UPDATE_INTERVAL_MS)).toBe(true);
    expect(shouldUpdateLiveSchematicFrame(100)).toBe(true);
    expect(shouldUpdateLiveSchematicFrame(Number.NaN)).toBe(false);
  });

  it("mid-loop sample uses real PULSE voltages — not just the final sample", async () => {
    // PULSE(0 5 1m 0 0 2m 4m): low → high → low. Live scrub must pick different samples.
    const vs: SchematicComponent = {
      id: "vs-1",
      kind: "vsource",
      x: 0,
      y: 32,
      rotation: 0,
      value: "PULSE(0 5 1m 0 0 2m 4m)",
      label: "V1",
    };
    const r1: SchematicComponent = {
      id: "r-1",
      kind: "resistor",
      x: 96,
      y: 0,
      rotation: 0,
      value: "1k",
      label: "R1",
    };
    const gndVs: SchematicComponent = {
      id: "g-1",
      kind: "ground",
      x: 0,
      y: 64,
      rotation: 0,
      value: "",
      label: "",
    };
    const gndR: SchematicComponent = {
      id: "g-2",
      kind: "ground",
      x: 128,
      y: 0,
      rotation: 0,
      value: "",
      label: "",
    };
    const wires: SchematicWire[] = [
      { id: "w-1", points: [{ x: 0, y: 0 }, { x: 64, y: 0 }] },
    ];
    const result = await runTransientAnalysis(
      { components: [vs, r1, gndVs, gndR], wires },
      { stopTime: 4e-3, steps: 400, uic: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // ~12.5% of the scrub ≈ 0.5 ms (still low); ~50% ≈ 2 ms (high).
    const lowTime = liveReadoutTime(result.times, LIVE_SCHEMATIC_LOOP_MS * 0.125);
    const highTime = liveReadoutTime(result.times, LIVE_SCHEMATIC_LOOP_MS * 0.5);
    expect(lowTime).not.toBeNull();
    expect(highTime).not.toBeNull();
    const lowIdx = nearestSampleIndex(result.times, lowTime!);
    const highIdx = nearestSampleIndex(result.times, highTime!);
    expect(lowIdx).toBeLessThan(highIdx);

    const lowV = Math.max(...tranNetVoltages(result, lowIdx).values());
    const highV = Math.max(...tranNetVoltages(result, highIdx).values());
    expect(lowV).toBeLessThan(0.5);
    expect(highV).toBeGreaterThan(4.5);

    const highI = tranComponentCurrents(result, highIdx).get("r-1");
    const lowI = tranComponentCurrents(result, lowIdx).get("r-1");
    expect(highI).toBeDefined();
    expect(lowI).toBeDefined();
    expect(Math.abs(highI!)).toBeGreaterThan(Math.abs(lowI!) + 1e-4);
  });
});
