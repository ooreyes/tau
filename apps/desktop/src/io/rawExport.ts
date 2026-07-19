/**
 * LTspice `.raw` waveform EXPORTER - the inverse of `rawImport.ts`. Writes a
 * Tau simulation result in LTspice's binary `.raw` format so the user can open
 * Tau's waveforms in LTspice's own viewer (or any nutmeg-compatible tool) and
 * compare them side-by-side (LTspice parity).
 *
 * Emits the canonical LTspice layout: a UTF-16LE header, a `Variables:` table,
 * a `Binary:` marker, then binary samples with the independent variable (index
 * 0) as float64 and dependents as float32 for real data - exactly what
 * {@link parseRaw} reads, so `parseRaw(serializeRaw(x))` round-trips.
 */
import type { RawVariable } from "./rawImport";

export interface RawExportInput {
  plotname: string;
  title?: string;
  date?: string;
  variables: RawVariable[];
  /** `values[v][p]` - real part of variable `v` at point `p`. */
  values: number[][];
  complex?: boolean;
  /** Imaginary parts (required when `complex`). */
  imaginary?: number[][];
}

/** Default LTspice quantity type for a variable name (`time`/`frequency`/V/I). */
export function inferRawType(name: string): string {
  const n = name.trim().toLowerCase();
  if (n === "time") return "time";
  if (n === "frequency") return "frequency";
  if (/^i[xb]?\(/.test(n)) return "device_current";
  if (/^v\(/.test(n)) return "voltage";
  return "voltage";
}

/**
 * Serialize a Tau result to LTspice binary `.raw` bytes. The first variable is
 * the independent axis (time/frequency/sweep). Throws if the value matrix shape
 * disagrees with the variable count.
 */
export function serializeRaw(input: RawExportInput): Uint8Array {
  const { variables, values } = input;
  const complex = input.complex ?? false;
  if (values.length !== variables.length) {
    throw new Error(`values has ${values.length} rows but ${variables.length} variables.`);
  }
  const pointCount = values[0]?.length ?? 0;
  for (const row of values) {
    if (row.length !== pointCount) throw new Error("All variables must have the same point count.");
  }
  if (complex && (!input.imaginary || input.imaginary.length !== variables.length)) {
    throw new Error("Complex data requires a matching imaginary matrix.");
  }

  const flags = complex ? "complex forward" : "real forward";
  const headerText =
    `Title: ${input.title ?? "* Tau export"}\n` +
    `Date: ${input.date ?? new Date().toUTCString()}\n` +
    `Plotname: ${input.plotname}\n` +
    `Flags: ${flags}\n` +
    `No. Variables: ${variables.length}\n` +
    `No. Points: ${pointCount}\n` +
    `Offset: 0.0000000000000000e+000\n` +
    `Command: Tau\n` +
    `Variables:\n` +
    variables.map((v, i) => `\t${i}\t${v.name}\t${v.type || inferRawType(v.name)}`).join("\n") +
    `\nBinary:\n`;

  // UTF-16LE header bytes.
  const headerBytes = new Uint8Array(headerText.length * 2);
  for (let i = 0; i < headerText.length; i += 1) {
    const code = headerText.charCodeAt(i);
    headerBytes[i * 2] = code & 0xff;
    headerBytes[i * 2 + 1] = (code >> 8) & 0xff;
  }

  const perPoint = complex
    ? variables.length * 16
    : 8 + (variables.length - 1) * 4;
  const body = new ArrayBuffer(perPoint * pointCount);
  const dv = new DataView(body);
  let off = 0;
  for (let p = 0; p < pointCount; p += 1) {
    for (let v = 0; v < variables.length; v += 1) {
      if (complex) {
        dv.setFloat64(off, values[v][p], true); off += 8;
        dv.setFloat64(off, input.imaginary![v][p], true); off += 8;
      } else if (v === 0) {
        dv.setFloat64(off, values[v][p], true); off += 8;
      } else {
        dv.setFloat32(off, values[v][p], true); off += 4;
      }
    }
  }

  const out = new Uint8Array(headerBytes.length + body.byteLength);
  out.set(headerBytes, 0);
  out.set(new Uint8Array(body), headerBytes.length);
  return out;
}
