import { describe, it, expect } from "vitest";
import { parseRaw, rawTrace } from "./rawImport";
import { OP_RAW_B64 } from "./rawFixture";

/** Decode the embedded base64 fixture to bytes (browser/node `atob`). */
function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Build a binary `.raw` with an ASCII header and var0=float64, rest=float32. */
function makeBinaryRaw(
  vars: { name: string; type: string }[],
  points: number[][],
): Uint8Array {
  const header =
    `Title: synthetic\n` +
    `Date: today\n` +
    `Plotname: Transient Analysis\n` +
    `Flags: real forward\n` +
    `No. Variables: ${vars.length}\n` +
    `No. Points: ${points.length}\n` +
    `Variables:\n` +
    vars.map((v, i) => `\t${i}\t${v.name}\t${v.type}`).join("\n") +
    `\nBinary:\n`;
  const headerBytes = new TextEncoder().encode(header);
  const perPoint = 8 + (vars.length - 1) * 4;
  const body = new ArrayBuffer(perPoint * points.length);
  const dv = new DataView(body);
  let off = 0;
  for (const row of points) {
    for (let v = 0; v < vars.length; v += 1) {
      if (v === 0) { dv.setFloat64(off, row[v], true); off += 8; }
      else { dv.setFloat32(off, row[v], true); off += 4; }
    }
  }
  const out = new Uint8Array(headerBytes.length + body.byteLength);
  out.set(headerBytes, 0);
  out.set(new Uint8Array(body), headerBytes.length);
  return out;
}

describe("parseRaw (synthetic binary)", () => {
  const raw = makeBinaryRaw(
    [{ name: "time", type: "time" }, { name: "V(out)", type: "voltage" }],
    [[0, 0], [1e-3, 2.5], [2e-3, -1.25]],
  );
  const data = parseRaw(raw);

  it("reads the header fields", () => {
    expect(data.plotname).toBe("Transient Analysis");
    expect(data.complex).toBe(false);
    expect(data.pointCount).toBe(3);
    expect(data.variables.map((v) => v.name)).toEqual(["time", "V(out)"]);
  });

  it("decodes var0 as float64 and dependents as float32", () => {
    expect(data.values[0]).toEqual([0, 1e-3, 2e-3]);
    expect(data.values[1][1]).toBeCloseTo(2.5, 5);
    expect(data.values[1][2]).toBeCloseTo(-1.25, 5);
  });

  it("rawTrace pairs a named variable with the axis", () => {
    const t = rawTrace(data, "v(out)");
    expect(t).not.toBeNull();
    expect(t!.axisName).toBe("time");
    expect(t!.axis).toEqual([0, 1e-3, 2e-3]);
    expect(t!.values[1]).toBeCloseTo(2.5, 5);
    expect(rawTrace(data, "V(nope)")).toBeNull();
  });
});

describe("parseRaw (ASCII Values)", () => {
  const text =
    `Title: t\nPlotname: DC transfer\nFlags: real\nNo. Variables: 2\n` +
    `No. Points: 2\nVariables:\n\t0\tv-sweep\tvoltage\n\t1\tV(o)\tvoltage\n` +
    `Values:\n0\t0.0\n\t1.0\n1\t2.0\n\t3.0\n`;
  const data = parseRaw(new TextEncoder().encode(text));

  it("reads block-formatted ASCII data", () => {
    expect(data.pointCount).toBe(2);
    expect(data.values[0]).toEqual([0, 2]);
    expect(data.values[1]).toEqual([1, 3]);
  });
});

describe("parseRaw (errors)", () => {
  it("throws when there is no data marker", () => {
    expect(() => parseRaw(new TextEncoder().encode("Title: x\n"))).toThrow(/not an ltspice/i);
  });
});

// A REAL LTspice operating-point .raw (embedded base64 fixture) - exercises the
// genuine UTF-16LE header + float64/float32 binary layout end to end.
describe("parseRaw (real .op.raw, UTF-16LE)", () => {
  const data = parseRaw(fromBase64(OP_RAW_B64));
  it("parses the operating-point header and a known node value", () => {
    expect(data.plotname).toBe("Operating Point");
    expect(data.variables).toHaveLength(22);
    expect(data.pointCount).toBe(1);
    const vn001 = rawTrace(data, "V(n001)");
    expect(vn001!.values[0]).toBeCloseTo(-0.9983, 3);
  });
});
