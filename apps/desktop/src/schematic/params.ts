import type { ComponentKind } from "./types";
import { parseComparator } from "../engine/comparatorSpec";
import { parseIcValue, stripIcSpec } from "../engine/icSpec";

/**
 * Structured parameter fields per component kind. The canonical storage stays a
 * single `value` string (so the solver, persistence and netlist are unchanged);
 * these helpers encode/decode the structured fields to/from it. This lets the
 * editor expose LTspice-style knobs (DC level, amplitude, frequency, …) instead
 * of one cryptic text box.
 */
export interface ParamField {
  key: string;
  label: string;
  unit: string;
}

const SCHEMA: Partial<Record<ComponentKind, ParamField[]>> = {
  resistor: [{ key: "r", label: "Resistance", unit: "Ω" }],
  capacitor: [{ key: "c", label: "Capacitance", unit: "F" }],
  polarizedCapacitor: [{ key: "c", label: "Capacitance", unit: "F" }],
  inductor: [{ key: "l", label: "Inductance", unit: "H" }],
  potentiometer: [{ key: "r", label: "Resistance", unit: "Ω" }],
  vsource: [{ key: "dc", label: "DC level", unit: "V" }],
  isource: [{ key: "dc", label: "DC level", unit: "A" }],
  logicConstant: [{ key: "level", label: "Level (0 / 1)", unit: "V" }],
  vac: [
    { key: "offset", label: "Offset", unit: "V" },
    { key: "amplitude", label: "Amplitude", unit: "V" },
    { key: "frequency", label: "Frequency", unit: "Hz" },
  ],
  iac: [
    { key: "offset", label: "Offset", unit: "A" },
    { key: "amplitude", label: "Amplitude", unit: "A" },
    { key: "frequency", label: "Frequency", unit: "Hz" },
  ],
  vpulse: [
    { key: "low", label: "Low level", unit: "V" },
    { key: "high", label: "High level", unit: "V" },
    { key: "frequency", label: "Frequency", unit: "Hz" },
    { key: "duty", label: "Duty (0-1)", unit: "" },
  ],
  // Semiconductor symbols use Tau's generic built-in models. Arbitrary vendor
  // names stay unavailable until a parsed library-to-symbol mapping can affect
  // the generated deck instead of being silently ignored.
  switch: [{ key: "state", label: "State (open/closed)", unit: "" }],
  pushButton: [{ key: "state", label: "State (open/pressed)", unit: "" }],
  spdt: [{ key: "throw", label: "Throw (no/nc)", unit: "" }],
  photodiode: [{ key: "iph", label: "Photocurrent", unit: "A" }],
  transformer: [{ key: "ratio", label: "Turns ratio", unit: "" }],
  comparator: [
    { key: "vhigh", label: "Output high", unit: "V" },
    { key: "vlow", label: "Output low", unit: "V" },
    { key: "vhyst", label: "Hysteresis", unit: "V" },
  ],
  // MOSFET instance params encoded as: `MODEL W=<w> L=<l> KP=<kp> VTO=<vto>`
  // (order fixed; omitted keys keep netlist defaults). Model name is the first token.
  nmos: [
    { key: "model", label: "Model", unit: "" },
    { key: "w", label: "Width (W)", unit: "m" },
    { key: "l", label: "Length (L)", unit: "m" },
    { key: "kp", label: "KP", unit: "A/V²" },
    { key: "vto", label: "Vt (VTO)", unit: "V" },
  ],
  pmos: [
    { key: "model", label: "Model", unit: "" },
    { key: "w", label: "Width (W)", unit: "m" },
    { key: "l", label: "Length (L)", unit: "m" },
    { key: "kp", label: "KP", unit: "A/V²" },
    { key: "vto", label: "Vt (VTO)", unit: "V" },
  ],
  // opamp uses a dedicated model chooser; testpoint / ground take no parameters.
};

const CHARGE_CAPACITOR_FIELDS: ParamField[] = [
  { key: "charge", label: "Charge expression", unit: "" },
  { key: "ic", label: "Initial voltage", unit: "V" },
];

export function paramFields(kind: ComponentKind, value = ""): ParamField[] {
  if ((kind === "capacitor" || kind === "polarizedCapacitor") && /^\s*Q\s*=/i.test(value)) return CHARGE_CAPACITOR_FIELDS;
  return SCHEMA[kind] ?? [];
}

const AC_KINDS = new Set<ComponentKind>(["vac", "iac"]);

/** Split a value string into its structured fields for the given kind. */
export function decodeParams(kind: ComponentKind, value: string): Record<string, string> {
  const fields = paramFields(kind, value);
  if (fields.length === 0) return {};
  if ((kind === "capacitor" || kind === "polarizedCapacitor") && /^\s*Q\s*=/i.test(value)) {
    return {
      charge: stripIcSpec(value).replace(/^\s*Q\s*=\s*/i, "").trim(),
      ic: parseIcValue(value) ?? "",
    };
  }
  if (fields.length === 1) return { [fields[0].key]: value.trim() };
  if (AC_KINDS.has(kind)) {
    const t = value.trim().split(/[\s,;@]+/).filter(Boolean);
    if (t.length >= 3) return { offset: t[0], amplitude: t[1], frequency: t[2] };
    if (t.length === 2) return { offset: "0", amplitude: t[0], frequency: t[1] };
    if (t.length === 1) return { offset: "0", amplitude: t[0], frequency: "1k" };
    return { offset: "0", amplitude: "1", frequency: "1k" };
  }
  if (kind === "vpulse") {
    const t = value.trim().split(/[\s,;]+/).filter(Boolean);
    return {
      low: t[0] ?? "0",
      high: t[1] ?? "5",
      frequency: t[2] ?? "100k",
      duty: t[3] ?? "0.5",
    };
  }
  if (kind === "comparator") {
    const spec = parseComparator(value);
    return {
      vhigh: String(spec.vhigh),
      vlow: String(spec.vlow),
      vhyst: String(spec.vhyst),
    };
  }
  if (kind === "nmos" || kind === "pmos") {
    return decodeMosfetParams(value, kind === "nmos" ? "NMOS" : "PMOS");
  }
  return {};
}

/** Parse `MODEL W=… L=… KP=… VTO=…` (any subset; first bare token = model). */
function decodeMosfetParams(value: string, fallbackModel: string): Record<string, string> {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  const out: Record<string, string> = {
    model: fallbackModel,
    w: "",
    l: "",
    kp: "",
    vto: "",
  };
  if (tokens.length === 0) return out;
  let i = 0;
  if (!/^(W|L|KP|VTO)=/i.test(tokens[0])) {
    out.model = tokens[0];
    i = 1;
  }
  for (; i < tokens.length; i += 1) {
    const m = tokens[i].match(/^(W|L|KP|VTO)=(.+)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === "w") out.w = m[2];
    else if (key === "l") out.l = m[2];
    else if (key === "kp") out.kp = m[2];
    else if (key === "vto") out.vto = m[2];
  }
  return out;
}

/** Re-assemble a value string from structured fields (solver-compatible form). */
export function encodeParams(kind: ComponentKind, values: Record<string, string>): string {
  if ((kind === "capacitor" || kind === "polarizedCapacitor") && Object.prototype.hasOwnProperty.call(values, "charge")) {
    const charge = (values.charge ?? "").trim();
    const ic = (values.ic ?? "").trim();
    return `Q=${charge}${ic ? ` IC=${ic}` : ""}`;
  }
  const fields = paramFields(kind);
  if (fields.length === 1) return (values[fields[0].key] ?? "").trim();
  if (AC_KINDS.has(kind)) {
    const offset = (values.offset ?? "").trim() || "0";
    const amplitude = (values.amplitude ?? "").trim() || "0";
    const frequency = (values.frequency ?? "").trim() || "1k";
    // "amp freq" when there's no offset, else the full "offset amp freq" form.
    return offset === "0" ? `${amplitude} ${frequency}` : `${offset} ${amplitude} ${frequency}`;
  }
  if (kind === "vpulse") {
    const low = (values.low ?? "").trim() || "0";
    const high = (values.high ?? "").trim() || "5";
    const frequency = (values.frequency ?? "").trim() || "100k";
    const duty = (values.duty ?? "").trim() || "0.5";
    return `${low} ${high} ${frequency} ${duty}`;
  }
  if (kind === "comparator") {
    const vhigh = (values.vhigh ?? "").trim() || "1";
    const vlow = (values.vlow ?? "").trim() || "0";
    const vhyst = (values.vhyst ?? "").trim() || "0";
    // Drop a zero hysteresis so the common ideal comparator stays "vhi vlo".
    return Number(vhyst) ? `${vhigh} ${vlow} ${vhyst}` : `${vhigh} ${vlow}`;
  }
  if (kind === "nmos" || kind === "pmos") {
    const model = (values.model ?? "").trim() || (kind === "nmos" ? "NMOS" : "PMOS");
    const parts = [model];
    const w = (values.w ?? "").trim();
    const l = (values.l ?? "").trim();
    const kp = (values.kp ?? "").trim();
    const vto = (values.vto ?? "").trim();
    if (w) parts.push(`W=${w}`);
    if (l) parts.push(`L=${l}`);
    if (kp) parts.push(`KP=${kp}`);
    if (vto) parts.push(`VTO=${vto}`);
    return parts.join(" ");
  }
  return "";
}
