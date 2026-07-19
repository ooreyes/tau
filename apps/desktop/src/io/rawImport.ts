/**
 * LTspice `.raw` waveform IMPORTER (LTspice parity).
 *
 * Reads the simulation output LTspice writes alongside a `.asc` so its reference
 * waveforms can be loaded into Tau and overlaid against Tau's own results - the
 * heart of the acceptance test ("reproduce LTspice's waveforms exactly").
 *
 * Format (LTspice 17.x): a UTF-16LE (or ASCII) header of `Key: value` lines, a
 * `Variables:` table, then a `Binary:` or `Values:` data block. For binary real
 * data LTspice stores the independent variable (index 0: time/frequency/sweep)
 * as a float64 and every dependent variable as a float32 - unless `Flags`
 * contains `double`, when all are float64. Complex (`.ac`) data stores every
 * variable as a (re, im) float64 pair.
 */

export interface RawVariable {
  index: number;
  name: string;
  /** LTspice quantity type, e.g. "time", "voltage", "device_current". */
  type: string;
}

export interface RawData {
  title: string;
  date: string;
  plotname: string;
  flags: string[];
  complex: boolean;
  variables: RawVariable[];
  pointCount: number;
  /** `values[v][p]` - real part of variable `v` at point `p`. */
  values: number[][];
  /** Imaginary parts, present only for complex (`.ac`) data. */
  imaginary?: number[][];
}

/** UTF-16LE if the second byte of a multi-byte ASCII char is NUL (LTspice's
 *  default), else assume UTF-8/ASCII. Honors a leading BOM. */
function detectUtf16(bytes: Uint8Array): boolean {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return true;
  // "Title:" - the 'i' (0x69) at index 1 is followed by NUL in UTF-16LE.
  return bytes.length >= 4 && bytes[0] !== 0x00 && bytes[1] === 0x00;
}

/** Find the byte index just past `marker` (encoded in the header's encoding). */
function findMarkerEnd(bytes: Uint8Array, marker: string, utf16: boolean): number {
  const needle: number[] = [];
  for (const ch of marker) {
    needle.push(ch.charCodeAt(0));
    if (utf16) needle.push(0);
  }
  outer: for (let i = 0; i + needle.length <= bytes.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return i + needle.length;
  }
  return -1;
}

function parseVariables(headerText: string): RawVariable[] {
  const lines = headerText.split(/\r?\n/);
  const start = lines.findIndex((l) => /^Variables:/i.test(l.trim()));
  if (start < 0) return [];
  const vars: RawVariable[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const cols = lines[i].trim().split(/\s+/);
    if (cols.length < 2) continue;
    const index = Number(cols[0]);
    if (!Number.isInteger(index)) continue;
    vars.push({ index, name: cols[1], type: cols[2] ?? "" });
  }
  return vars;
}

const headerField = (text: string, key: string): string => {
  const m = new RegExp(`^${key}:\\s*(.*)$`, "im").exec(text);
  return m ? m[1].trim() : "";
};

/**
 * Parse an LTspice `.raw` file. Accepts an `ArrayBuffer`/`Uint8Array`. Throws on
 * a missing data marker or a variable/point count that disagrees with the data.
 */
export function parseRaw(input: ArrayBuffer | Uint8Array): RawData {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const utf16 = detectUtf16(bytes);

  let dataStart = findMarkerEnd(bytes, "Binary:\n", utf16);
  let binary = true;
  if (dataStart < 0) {
    dataStart = findMarkerEnd(bytes, "Values:\n", utf16);
    binary = false;
  }
  if (dataStart < 0) throw new Error("Not an LTspice .raw file (no Binary:/Values: marker).");

  const headerBytes = bytes.subarray(0, dataStart);
  const decoder = new TextDecoder(utf16 ? "utf-16le" : "utf-8");
  const headerText = decoder.decode(headerBytes);

  const flags = headerField(headerText, "Flags").split(/\s+/).filter(Boolean);
  const complex = flags.some((f) => f.toLowerCase() === "complex");
  const doublePrecision = flags.some((f) => f.toLowerCase() === "double");
  const variables = parseVariables(headerText);
  const nVars = Number(headerField(headerText, "No\\. Variables")) || variables.length;
  const pointCount = Number(headerField(headerText, "No\\. Points")) || 0;

  if (variables.length !== nVars) {
    throw new Error(`Variable table (${variables.length}) disagrees with No. Variables (${nVars}).`);
  }

  const values: number[][] = Array.from({ length: nVars }, () => new Array<number>(pointCount));
  const imaginary: number[][] | undefined = complex
    ? Array.from({ length: nVars }, () => new Array<number>(pointCount))
    : undefined;

  if (binary) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + dataStart, bytes.byteLength - dataStart);
    let off = 0;
    for (let p = 0; p < pointCount; p += 1) {
      for (let v = 0; v < nVars; v += 1) {
        if (complex) {
          values[v][p] = view.getFloat64(off, true); off += 8;
          imaginary![v][p] = view.getFloat64(off, true); off += 8;
        } else if (doublePrecision || v === 0) {
          values[v][p] = view.getFloat64(off, true); off += 8;
        } else {
          values[v][p] = view.getFloat32(off, true); off += 4;
        }
      }
    }
  } else {
    // ASCII: blocks of "<pointIndex>\t<v0>" then one value per following line.
    const lines = decoder.decode(bytes.subarray(dataStart)).split(/\r?\n/);
    let li = 0;
    for (let p = 0; p < pointCount; p += 1) {
      for (let v = 0; v < nVars; v += 1) {
        while (li < lines.length && lines[li].trim() === "") li += 1;
        const raw = (lines[li] ?? "").trim();
        li += 1;
        const token = v === 0 ? raw.split(/\s+/).pop() ?? raw : raw;
        if (complex) {
          const [re, im] = token.split(",");
          values[v][p] = Number(re);
          imaginary![v][p] = Number(im ?? 0);
        } else {
          values[v][p] = Number(token);
        }
      }
    }
  }

  return {
    title: headerField(headerText, "Title"),
    date: headerField(headerText, "Date"),
    plotname: headerField(headerText, "Plotname"),
    flags,
    complex,
    variables,
    pointCount,
    values,
    ...(imaginary ? { imaginary } : {}),
  };
}

/**
 * Look up a variable's samples by name (case-insensitive, whitespace-tolerant),
 * paired with the independent axis (variable 0). Returns `null` if not found.
 * For complex data the magnitude is returned.
 */
export function rawTrace(
  data: RawData,
  name: string,
): { axis: number[]; values: number[]; axisName: string } | null {
  const target = name.trim().toLowerCase();
  const v = data.variables.find((variable) => variable.name.toLowerCase() === target);
  if (!v) return null;
  const axisValues = data.values[0] ?? [];
  let series = data.values[v.index] ?? [];
  if (data.complex && data.imaginary) {
    const im = data.imaginary[v.index] ?? [];
    series = series.map((re, i) => Math.hypot(re, im[i] ?? 0));
  }
  return {
    axis: axisValues,
    values: series,
    axisName: data.variables[0]?.name ?? "",
  };
}
