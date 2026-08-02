// Real-engine proof for `.ac` on ngspice: builds the deck Tau would hand the
// native engine, runs it through the ngspice binary, and holds the adapter's
// engine-facing assumptions against what a real run returns. A Bode plot
// depends on `.ac` entirely, and its complex-vector contract was only ever
// checked against a hand-rolled preview solver.
//
// What is under test here is naming and convention, not arithmetic ngspice
// owns: the `frequency` scale, node vectors arriving bare rather than as
// `v(x)`, the real/imaginary ordering `acTraceFromComplex` assumes, and the
// two unit conversions (dB, degrees-from-radians) between ngspice's own
// columns and what the adapter reports.
// Runs under vitest.corpus.config.ts only; skips without ngspice.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";
import { AC_SCALE_NAME, AC_DB_FLOOR, acTraceFromComplex } from "../src/engine/nativeSpice";
import { runAcSweep, hasAcExcitation, NO_AC_SOURCE_MESSAGE } from "../src/simulation/acSweep";
import { deriveAcRcCurrents } from "../src/simulation/currents";
import type { NetLabel, SchematicComponent } from "../src/schematic/types";

const haveNgspice = spawnSync("ngspice", ["--version"], { encoding: "utf8" }).error === undefined;

const vsource = (label: string, value: string, x: number, y: number): SchematicComponent => ({
  id: label, kind: "vsource", label, value, x, y, rotation: 0,
});
const resistor = (label: string, value: string, x: number, y: number): SchematicComponent => ({
  id: label, kind: "resistor", label, value, x, y, rotation: 0,
});
const capacitor = (label: string, value: string, x: number, y: number): SchematicComponent => ({
  id: label, kind: "capacitor", label, value, x, y, rotation: 0,
});
const inductor = (label: string, value: string, x: number, y: number): SchematicComponent => ({
  id: label, kind: "inductor", label, value, x, y, rotation: 0,
});
const lbl = (x: number, y: number, text: string): NetLabel => ({ id: `f-${x}-${y}`, x, y, text });

interface AcRun {
  /** Every vector name ngspice reported, in its own spelling. */
  names: string[];
  /** One column per printed expression, keyed by the text ngspice echoes back in its header. */
  columns: Map<string, number[]>;
  /** Combined stdout/stderr, for callers that need to check ngspice's own message text. */
  raw: string;
}

/**
 * Run a `.ac` deck and read back what ngspice itself reports: the vector
 * names from `display`, and explicit real-valued columns from an explicit
 * `print`.
 *
 * `print all` is unusable here: on an AC run each complex vector prints as
 * TWO whitespace-separated cells under ONE header name, which breaks the
 * row-width check below that assumes one cell per column. An explicit
 * `print` of real-valued expressions (`real(v(x))`, `vdb(x)`, ...) gives one
 * real cell per column instead - but ngspice still splits more than a
 * handful of columns into successive groups that each repeat the scale, the
 * same shape `print all` uses in tranNative.corpus.ts, so the parser below
 * stays group- and pagination-aware even though a sweep this short (kept
 * under 50 rows) never actually pages.
 */
function runAc(netlist: string, name: string, exprs: string[]): AcRun {
  const scaffolded = `${netlist.replace(/^\s*\.end\s*$/mi, "")}
.control
run
display
print frequency ${exprs.join(" ")}
.endc
.end
`;
  const cirPath = join(tmpdir(), `tau-ac-${name}.cir`);
  writeFileSync(cirPath, scaffolded);
  const run = spawnSync("ngspice", ["-b", cirPath], { encoding: "utf8", timeout: 120_000 });
  const out = `${run.stdout}\n${run.stderr}`;

  // `display` heads its dump with `Name: <plot> (...)`, then lists one
  // indented `vector : type` line each. Title/Name/Date sit at column 0, so
  // requiring the leading indent keeps them out.
  const dump = out.split(/here are the vectors currently active:/i)[1];
  expect(dump, `ngspice listed no vectors for ${name}:\n${out}`).toBeDefined();
  const names: string[] = [];
  for (const line of dump.split("\n")) {
    if (/^\s*Index\s/.test(line)) break;
    const vec = line.match(/^\s+([A-Za-z0-9_#().[\]-]+)\s+:\s+\S/);
    if (vec && !names.includes(vec[1])) names.push(vec[1]);
  }

  // A column is claimed by the first group to carry it, so the repeated
  // `frequency` scale is not collected twice; within one header a repeat is
  // the same vector printed again, not another column.
  const columns = new Map<string, number[]>();
  let claims: { column: string; index: number }[] = [];
  let group = "";
  let width = 0;
  for (const line of out.split("\n")) {
    const head = line.match(/^Index\s+(.+?)\s*$/);
    if (head) {
      const header = head[1].trim().split(/\s+/);
      width = header.length;
      if (head[1] === group) continue;
      group = head[1];
      claims = [];
      header.forEach((column, index) => {
        if (columns.has(column)) return;
        columns.set(column, []);
        claims.push({ column, index });
      });
      continue;
    }
    if (width === 0) continue;
    const cells = line.trim().split(/\s+/);
    if (cells.length !== width + 1 || !/^\d+$/.test(cells[0])) continue;
    const values = cells.slice(1).map(Number);
    if (values.some((value) => !Number.isFinite(value))) continue;
    for (const claim of claims) columns.get(claim.column)!.push(values[claim.index]);
  }
  return { names, columns, raw: out };
}

const column = (run: AcRun, name: string): number[] => {
  const values = run.columns.get(name);
  expect(values, `ngspice printed no column for ${name}; it has ${[...run.columns.keys()].join(", ")}`).toBeDefined();
  return values!;
};

describe.skipIf(!haveNgspice)("`.ac` through the native engine", () => {
  // R=1k, C=159.1549n puts the pole at 1/(2*pi*R*C) = 1000.000 Hz, and a
  // `dec 4` sweep starting at 10 Hz lands exactly on that point (two decades
  // up is 8 quarter-decade steps), so the pole itself - not just the general
  // shape - can be checked directly at a known index.
  // Pin geometry: resistor/capacitor are horizontal two-terminal parts,
  // a=(x-32,y) b=(x+32,y); vsource p=(x,y-32) n=(x,y+32).
  const R = 1000;
  const C = 159.1549e-9;
  const rcLowPass = {
    components: [
      vsource("V1", "AC 1", 100, 300),
      resistor("R1", "1k", 200, 268),
      capacitor("C1", "159.1549n", 300, 300),
    ],
    wires: [],
    netLabels: [
      lbl(100, 268, "in"), lbl(168, 268, "in"),
      lbl(232, 268, "out"), lbl(268, 300, "out"),
      lbl(100, 332, "0"), lbl(332, 300, "0"),
    ],
  };
  const sweep = { startHz: 10, stopHz: 100e3, pointsPerDecade: 4 };

  it("names the scale `frequency` and the node vectors bare, not `v(node)`", () => {
    const deck = buildSpiceDeck(rcLowPass, { kind: "ac", ...sweep });
    expect(deck.netlist).toContain(".ac dec 4 10 100000");
    // Pins the net labels landed where the geometry above puts them, not on
    // some other net picked up by an unintended short.
    expect(deck.netlist).toContain("V1 in 0 DC 0 AC 1");
    expect(deck.netlist).toContain("R1 in out 1000");
    expect(deck.netlist).toContain("C1 out 0 1.591549e-7");

    const run = runAc(deck.netlist, "rcnames", ["real(v(out))"]);

    // The adapter reads the axis under AC_SCALE_NAME and every trace as
    // `v(<net>)`. ngspice returns the axis under that name but the nodes
    // WITHOUT the `v(...)` wrapper, which is the whole reason
    // `nodeVectorName` strips it - a literal lookup would find no traces at
    // all and the adapter would throw.
    expect(run.names).toContain(AC_SCALE_NAME);
    expect(run.names).toContain("out");
    expect(run.names).not.toContain("v(out)");

    // Ground is not returned as a vector, which is why the adapter filters it
    // out of the trace list rather than expecting a flat zero series.
    expect(run.names).not.toContain("0");

    // The source current, the AC ladder's only rung: present under the same
    // `<ref>#branch` spelling a transient run uses, and also complex.
    expect(run.names).toContain("v1#branch");
  });

  it("the real/imaginary split is the phasor, in that order, with a lagging sign", () => {
    const deck = buildSpiceDeck(rcLowPass, { kind: "ac", ...sweep });
    const run = runAc(deck.netlist, "rcphasor", ["real(v(out))", "imag(v(out))"]);
    const freq = column(run, "frequency");
    const real = column(run, "real(v(out))");
    const imag = column(run, "imag(v(out))");
    expect(real).toHaveLength(freq.length);
    expect(imag).toHaveLength(freq.length);

    // Closed form for a single-pole RC low-pass: H(jw) = 1/(1+jx), x = wRC,
    // so real = 1/(1+x^2) and imag = -x/(1+x^2). This is the assumption
    // `acTraceFromComplex` rests on: that the FIRST column read back is the
    // real part and the SECOND is the imaginary, in that order.
    freq.forEach((f, i) => {
      const x = 2 * Math.PI * f * R * C;
      expect(real[i]).toBeCloseTo(1 / (1 + x * x), 6);
      expect(imag[i]).toBeCloseTo(-x / (1 + x * x), 6);
    });

    // A low-pass lags: V(out) never leads V(in).
    for (let i = 1; i < imag.length; i += 1) expect(imag[i]).toBeLessThan(0);

    // A decade above the pole the reactive term dominates the resistive one
    // by roughly the frequency ratio itself - real and imaginary are not
    // interchangeable in magnitude either, which is what makes a swapped pair
    // impossible to pass by accident.
    const aboveIndex = freq.findIndex((f) => Math.abs(f - 10_000) < 1);
    expect(aboveIndex, `no sweep point near 10 kHz among ${freq.join(", ")}`).toBeGreaterThanOrEqual(0);
    const ratio = Math.abs(imag[aboveIndex]) / Math.abs(real[aboveIndex]);
    expect(ratio).toBeGreaterThan(9);
    expect(ratio).toBeLessThan(11);
  });

  it("returns I(L1) and agrees with a derived passive current on a real AC run", () => {
    const rl = {
      components: [
        vsource("V1", "AC 1", 100, 300),
        inductor("L1", "1m", 200, 268),
        resistor("R1", "1k", 300, 268),
      ],
      wires: [],
      netLabels: [
        lbl(100, 268, "in"), lbl(168, 268, "in"),
        lbl(232, 268, "mid"), lbl(268, 268, "mid"),
        lbl(100, 332, "0"), lbl(332, 268, "0"),
      ],
    };
    const deck = buildSpiceDeck(rl, { kind: "ac", ...sweep });
    const run = runAc(deck.netlist, "rlcurrent", [
      "real(v(mid))", "imag(v(mid))", "real(l1#branch)", "imag(l1#branch)",
    ]);
    const freqs = column(run, "frequency");
    const lReal = column(run, "real(l1#branch)");
    const lImag = column(run, "imag(l1#branch)");
    expect(run.names).toContain("l1#branch");

    const ground = new Array(freqs.length).fill(0);
    const derived = deriveAcRcCurrents(
      deck.circuit.components,
      new Map([
        ["mid", { real: column(run, "real(v(mid))"), imaginary: column(run, "imag(v(mid))") }],
        [deck.circuit.groundNetId!, { real: ground, imaginary: ground }],
      ]),
      freqs,
    ).find((current) => current.label === "I(R1)");
    expect(derived).toBeDefined();
    derived!.real.forEach((value, index) => expect(Math.abs(value - lReal[index])).toBeLessThan(1e-7));
    derived!.imaginary.forEach((value, index) => expect(Math.abs(value - lImag[index])).toBeLessThan(1e-7));
  });

  it("the dB and phase conventions match the engine after the documented conversion", () => {
    const deck = buildSpiceDeck(rcLowPass, { kind: "ac", ...sweep });
    const run = runAc(deck.netlist, "rcconventions", ["real(v(out))", "imag(v(out))", "vdb(out)", "vp(out)"]);
    const freq = column(run, "frequency");
    const real = column(run, "real(v(out))");
    const imag = column(run, "imag(v(out))");
    const vdb = column(run, "vdb(out)");
    const vp = column(run, "vp(out)");
    const engine = acTraceFromComplex(real, imag);
    expect(engine.magDb).toHaveLength(freq.length);
    expect(engine.phaseDeg).toHaveLength(freq.length);

    // ngspice prints six significant digits, which sets the floor on every
    // comparison against a printed column.
    engine.magDb.forEach((db, i) => expect(Math.abs(db - vdb[i])).toBeLessThan(1e-4));

    const poleIndex = freq.findIndex((f) => Math.abs(f - 1000) < 1);
    expect(poleIndex, `no sweep point near 1 kHz among ${freq.join(", ")}`).toBeGreaterThanOrEqual(0);
    expect(engine.magDb[poleIndex]).toBeCloseTo(-3.0103, 4);

    // ngspice's phase is RADIANS; Tau reports DEGREES. The two agree only
    // after this conversion - comparing the raw columns directly would be off
    // by a factor of 180/pi everywhere.
    engine.phaseDeg.forEach((deg, i) => expect(Math.abs(deg - vp[i] * (180 / Math.PI))).toBeLessThan(1e-3));
    expect(engine.phaseDeg[poleIndex]).toBeCloseTo(-45, 4);
  });

  it("both engines agree on the circuit both can answer", () => {
    const deck = buildSpiceDeck(rcLowPass, { kind: "ac", ...sweep });
    const run = runAc(deck.netlist, "rcagree", ["real(v(out))", "imag(v(out))"]);
    const freq = column(run, "frequency");
    const real = column(run, "real(v(out))");
    const imag = column(run, "imag(v(out))");
    const engine = acTraceFromComplex(real, imag);

    const ts = runAcSweep(rcLowPass, sweep);
    expect(ts.ok).toBe(true);
    if (!ts.ok) return;

    // The preview solver generates its own frequency grid rather than reusing
    // ngspice's, so the two are checked against each other first - a relative
    // tolerance, since the swept range spans four decades and an absolute one
    // would be meaningless at both ends at once.
    expect(ts.freqs).toHaveLength(freq.length);
    ts.freqs.forEach((f, i) => expect(Math.abs(f - freq[i]) / freq[i]).toBeLessThan(1e-6));

    const tsOut = ts.traces.find((trace) => trace.id === "out");
    expect(tsOut, `no "out" trace among ${ts.traces.map((trace) => trace.id).join(", ")}`).toBeDefined();
    engine.magDb.forEach((db, i) => expect(Math.abs(tsOut!.magDb[i] - db)).toBeLessThan(0.01));
    engine.phaseDeg.forEach((deg, i) => expect(Math.abs(tsOut!.phaseDeg[i] - deg)).toBeLessThan(0.05));
  });

  it("a transistor Bode plot only the native engine can give", () => {
    // Common-emitter stage, direct-driven (Rb runs straight from src to base,
    // no coupling capacitor) so the AC stimulus reaches the base without
    // picking up a high-pass corner of its own that would confuse the
    // mid-band check below with a real one.
    // Pin geometry: npn c=(x+16,y-32) b=(x-32,y) e=(x+16,y+32).
    const amplifier = {
      components: [
        vsource("V1", "5", 100, 300),
        vsource("Vin", "SINE(0.8 0.02 1k) AC 1", 150, 500),
        resistor("Rb", "10k", 250, 400),
        resistor("Rc", "2k", 250, 200),
        { id: "Q1", kind: "npn" as const, label: "Q1", value: "NPN", x: 500, y: 300, rotation: 0 as const },
      ],
      wires: [],
      netLabels: [
        lbl(100, 268, "vdd"), lbl(218, 200, "vdd"),
        lbl(100, 332, "0"), lbl(150, 532, "0"), lbl(516, 332, "0"),
        lbl(150, 468, "src"), lbl(218, 400, "src"),
        lbl(282, 400, "base"), lbl(468, 300, "base"),
        lbl(282, 200, "coll"), lbl(516, 268, "coll"),
      ],
    };

    // No semiconductor stamps in the preview solver, so it has no answer at all.
    const ts = runAcSweep(amplifier, sweep);
    expect(ts.ok).toBe(false);

    const deck = buildSpiceDeck(amplifier, { kind: "ac", ...sweep });
    expect(deck.netlist).toMatch(/^Q1 coll base 0 /m);

    const run = runAc(deck.netlist, "amplifier", ["real(v(coll))", "imag(v(coll))"]);
    const freq = column(run, "frequency");
    const real = column(run, "real(v(coll))");
    const imag = column(run, "imag(v(coll))");
    expect(real).toHaveLength(freq.length);
    expect(imag).toHaveLength(freq.length);

    const engine = acTraceFromComplex(real, imag);
    const midStart = Math.floor(freq.length / 3);
    const midEnd = Math.ceil((2 * freq.length) / 3);
    const midDb = engine.magDb.slice(midStart, midEnd);
    const midPhase = engine.phaseDeg.slice(midStart, midEnd);

    // A real, sizeable mid-band gain - the number the preview solver above
    // cannot produce at all.
    expect(Math.max(...midDb)).toBeGreaterThan(10);
    // And inverting: a common-emitter stage's phase magnitude sits past 90
    // degrees, the qualitative signature that does not depend on the model's beta.
    expect(Math.max(...midPhase.map(Math.abs))).toBeGreaterThan(90);
  });

  it("an unexcited sweep is a clean run of exact zeros, which is what the refusal guards", () => {
    // Same RC circuit, but V1 carries no `AC` keyword at all.
    const unexcited = {
      components: [
        vsource("V1", "5", 100, 300),
        resistor("R1", "1k", 200, 268),
        capacitor("C1", "159.1549n", 300, 300),
      ],
      wires: [],
      netLabels: [
        lbl(100, 268, "in"), lbl(168, 268, "in"),
        lbl(232, 268, "out"), lbl(268, 300, "out"),
        lbl(100, 332, "0"), lbl(332, 300, "0"),
      ],
    };

    // Both the check and the solver that gates on it refuse before paying for
    // a run at all.
    expect(hasAcExcitation(unexcited.components)).toBe(false);
    const ts = runAcSweep(unexcited, sweep);
    expect(ts.ok).toBe(false);
    if (ts.ok) return;
    expect(ts.message).toBe(NO_AC_SOURCE_MESSAGE);

    // ngspice itself does not refuse: it solves the circuit and reports every
    // node as exactly zero, with nothing that reads as an error.
    const deck = buildSpiceDeck(unexcited, { kind: "ac", ...sweep });
    const run = runAc(deck.netlist, "unexcited", ["real(v(out))", "imag(v(out))"]);
    const freq = column(run, "frequency");
    const real = column(run, "real(v(out))");
    const imag = column(run, "imag(v(out))");
    // 4 decades (10 Hz to 100 kHz) at 4 points per decade, plus the starting
    // point: 17 rows, the same count every other case in this file gets.
    expect(freq).toHaveLength(17);
    expect(real).toHaveLength(freq.length);
    expect(imag).toHaveLength(freq.length);
    // `Math.abs` rather than a direct `toBe(0)` so a stray negative zero from
    // the solver's arithmetic - still zero, just the wrong sign bit - cannot
    // fail an otherwise-correct run.
    real.forEach((value) => expect(Math.abs(value)).toBe(0));
    imag.forEach((value) => expect(Math.abs(value)).toBe(0));
    expect(run.raw, `ngspice reported an error for an unexcited AC sweep:\n${run.raw}`).not.toMatch(/error/i);

    // The flat trace at the floor a plot would otherwise draw with no warning
    // at all - the reason the refusal above exists.
    const engine = acTraceFromComplex(real, imag);
    engine.magDb.forEach((db) => expect(db).toBe(AC_DB_FLOOR));
  });
});
