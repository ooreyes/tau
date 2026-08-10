/**
 * The worker offload, tested where there is no worker.
 *
 * That is not a gap in the coverage, it is the point. This suite runs under
 * vitest's `node` environment, which has no `Worker` at all, so every call
 * here takes the pool's fallback path - and the fallback is what the offload's
 * safety rests on. If it ever stopped producing exactly what the direct solver
 * produces, the app would quietly return different numbers in any environment
 * where a worker could not be created, and nothing else in the suite would
 * notice.
 *
 * What genuinely cannot be exercised here is a real thread. The one part of
 * the worker path that is pure logic rather than plumbing - the transferable
 * marshalling that carries samples across the boundary - is therefore tested
 * directly, because a rounding error introduced there would corrupt every
 * off-thread result while every on-thread test stayed green.
 *
 * Circuit geometry follows the documented pin rule: a two-terminal part at
 * (x, y) with rotation 0 has "a" at (x - 32, y) and "b" at (x + 32, y); a
 * vsource has "p" at (x, y - 32) and "n" at (x, y + 32); a ground's pin is on
 * its own coordinate. Pins connect where world coordinates coincide.
 */

import { describe, it, expect } from "vitest";
import { runTransientAnalysis, type AnalysisResult } from "./linearTransient";
import { runAcSweep } from "./acSweep";
import { runDcSweep } from "./dcSweep";
import { packSolverResult, unpackSolverResult, type SolverJobResult } from "./solverJobs";
import {
  runAcSweepOffThread,
  runDcSweepOffThread,
  runTransientAnalysisOffThread,
  solverConcurrency,
} from "./solverPool";
import type { SchematicComponent, SchematicWire } from "../schematic/types";

let ids = 0;
const part = (
  kind: SchematicComponent["kind"],
  x: number,
  y: number,
  value: string,
  label: string,
): SchematicComponent => ({ id: `${kind}-${++ids}`, kind, x, y, rotation: 0, value, label });

/** V1 --R1-- mid --C1-- gnd, the same RC the transient suite uses. */
function rcCircuit(): { components: SchematicComponent[]; wires: SchematicWire[] } {
  return {
    components: [
      part("vsource", 0, 32, "5", "V1"),
      part("resistor", 96, 0, "1k", "R1"),
      part("capacitor", 224, 0, "1u", "C1"),
      part("ground", 0, 64, "", ""),
      part("ground", 256, 0, "", ""),
    ],
    wires: [
      { id: "w1", points: [{ x: 0, y: 0 }, { x: 64, y: 0 }] },
      { id: "w2", points: [{ x: 128, y: 0 }, { x: 192, y: 0 }] },
    ],
  };
}

/** Every sample, compared with `Object.is` - `===` would call a `-0` that had
 *  become a `0` a match, and that is exactly the kind of drift worth catching. */
function expectSameTransient(actual: AnalysisResult, expected: AnalysisResult) {
  expect(actual.ok).toBe(expected.ok);
  if (!actual.ok || !expected.ok) return;
  expect(actual.times.length).toBe(expected.times.length);
  actual.times.forEach((t, i) => expect(Object.is(t, expected.times[i])).toBe(true));
  expect(actual.traces.map((t) => t.label)).toEqual(expected.traces.map((t) => t.label));
  actual.traces.forEach((trace, i) => {
    trace.values.forEach((v, k) => expect(Object.is(v, expected.traces[i].values[k])).toBe(true));
  });
  expect(actual.currents.map((c) => c.label)).toEqual(expected.currents.map((c) => c.label));
  actual.currents.forEach((current, i) => {
    current.values.forEach((v, k) => expect(Object.is(v, expected.currents[i].values[k])).toBe(true));
  });
  expect(actual.stats).toEqual(expected.stats);
  expect(actual.warnings).toEqual(expected.warnings);
}

describe("solver pool - fallback when there is no Worker", () => {
  it("reports a concurrency of one, because the inline path is one solve at a time", () => {
    expect(typeof Worker).toBe("undefined");
    expect(solverConcurrency()).toBe(1);
  });

  it("returns bit-identical transient samples to the direct solver", async () => {
    const { components, wires } = rcCircuit();
    const options = { stopTime: 5e-3, steps: 500 };
    const direct = await runTransientAnalysis({ components, wires }, options);
    const pooled = await runTransientAnalysisOffThread({ components, wires }, options);
    expectSameTransient(pooled, direct);
  });

  it("returns bit-identical AC and DC results to the direct solvers", async () => {
    const { components, wires } = rcCircuit();
    const acComponents = components.map((c) => (c.kind === "vsource" ? { ...c, kind: "vac" as const, value: "1 1k" } : c));
    const acOptions = { startHz: 10, stopHz: 100_000, pointsPerDecade: 20 };
    const ac = await runAcSweepOffThread({ components: acComponents, wires }, acOptions);
    const acDirect = runAcSweep({ components: acComponents, wires }, acOptions);
    expect(ac).toEqual(acDirect);

    const dcSpec = { source: "V1", start: 0, stop: 10, step: 2 };
    const dc = await runDcSweepOffThread({ components, wires }, dcSpec);
    expect(dc).toEqual(runDcSweep({ components, wires }, dcSpec));
  });

  it("still reports progress from 0 to 1, monotonically", async () => {
    const { components, wires } = rcCircuit();
    const fractions: number[] = [];
    const result = await runTransientAnalysisOffThread(
      { components, wires },
      { stopTime: 5e-3, steps: 1000 },
      { onProgress: (fraction) => fractions.push(fraction) },
    );
    expect(result.ok).toBe(true);
    expect(fractions.length).toBeGreaterThanOrEqual(2);
    expect(fractions[0]).toBe(0);
    expect(fractions[fractions.length - 1]).toBe(1);
    fractions.forEach((f, i) => { if (i > 0) expect(f).toBeGreaterThanOrEqual(fractions[i - 1]); });
  });

  it("aborts into a partial ok result with its warning, and never rejects", async () => {
    const { components, wires } = rcCircuit();
    const controller = new AbortController();
    const result = await runTransientAnalysisOffThread(
      { components, wires },
      { stopTime: 5e-3, steps: 1000 },
      { signal: controller.signal, onProgress: (fraction) => { if (fraction >= 0.3) controller.abort(); } },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.sampleCount).toBeGreaterThan(0);
    expect(result.stats.sampleCount).toBeLessThan(1001);
    expect(result.warnings.some((w) => /stopped early/i.test(w))).toBe(true);
  });

  it("treats an already-aborted signal as an abort at the first checkpoint", async () => {
    const { components, wires } = rcCircuit();
    const controller = new AbortController();
    controller.abort();
    const result = await runTransientAnalysisOffThread(
      { components, wires },
      { stopTime: 5e-3, steps: 1000 },
      { signal: controller.signal },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.sampleCount).toBe(1);
    expect(result.warnings.some((w) => /stopped early/i.test(w))).toBe(true);
  });
});

describe("solver result marshalling", () => {
  /** Wrap a bare series in the smallest thing the packer will accept. */
  const wrap = (values: number[]): SolverJobResult => ({
    kind: "dc",
    result: { ok: true, source: "V1", sweep: values, nets: [], warnings: [] },
  });
  const sweepOf = (result: SolverJobResult) =>
    result.kind === "dc" && result.result.ok ? result.result.sweep : [];

  it("round-trips every double exactly, including the ones equality lies about", () => {
    const awkward = [0, -0, NaN, Infinity, -Infinity, Number.MIN_VALUE, Number.MAX_VALUE, Math.PI, -1e-300];
    // Padded past the length threshold so the packer actually engages.
    const values = [...awkward, ...Array.from({ length: 100 }, (_, i) => Math.sin(i) * 1e-7)];

    const { payload, transfer } = packSolverResult(wrap([...values]));
    expect(transfer).toHaveLength(1);
    expect(sweepOf(payload)).toBeInstanceOf(Float64Array);

    const restored = sweepOf(unpackSolverResult(payload));
    expect(Array.isArray(restored)).toBe(true);
    expect(restored).toHaveLength(values.length);
    values.forEach((v, i) => expect(Object.is(restored[i], v)).toBe(true));
  });

  it("leaves short series and non-numeric arrays alone", () => {
    const short = [1, 2, 3];
    const { payload, transfer } = packSolverResult(wrap(short));
    expect(transfer).toHaveLength(0);
    expect(sweepOf(payload)).toEqual(short);

    const objects: SolverJobResult = {
      kind: "dc",
      result: {
        ok: true,
        source: "V1",
        // Long enough to pass the length threshold, but not numbers - the
        // packer must notice, or a net's `points` would become garbage.
        nets: Array.from({ length: 100 }, (_, i) => ({ id: `n${i}`, label: `n${i}`, voltages: [i], ground: false })),
        sweep: [],
        warnings: [],
      },
    };
    const packed = packSolverResult(objects);
    expect(packed.transfer).toHaveLength(0);
    expect(unpackSolverResult(packed.payload)).toEqual(objects);
  });

  it("packs every series of a real transient result and restores it unchanged", async () => {
    const { components, wires } = rcCircuit();
    const direct = await runTransientAnalysis({ components, wires }, { stopTime: 5e-3, steps: 500 });
    // The packer mutates, so it gets its own copy and the original stays the
    // reference to compare against.
    const { payload, transfer } = packSolverResult({ kind: "tran", result: structuredClone(direct) });
    expect(transfer.length).toBeGreaterThan(1);
    const restored = unpackSolverResult(payload);
    expect(restored.kind).toBe("tran");
    if (restored.kind !== "tran") return;
    expectSameTransient(restored.result, direct);
  });
});
