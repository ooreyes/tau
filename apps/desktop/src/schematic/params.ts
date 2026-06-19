import type { ComponentKind } from "./types";

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
  inductor: [{ key: "l", label: "Inductance", unit: "H" }],
  potentiometer: [{ key: "r", label: "Resistance", unit: "Ω" }],
  vsource: [{ key: "dc", label: "DC level", unit: "V" }],
  isource: [{ key: "dc", label: "DC level", unit: "A" }],
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
  diode: [{ key: "model", label: "Model", unit: "" }],
  led: [{ key: "model", label: "Model", unit: "" }],
  zener: [{ key: "model", label: "Model", unit: "" }],
  nmos: [{ key: "model", label: "Model", unit: "" }],
  pmos: [{ key: "model", label: "Model", unit: "" }],
  npn: [{ key: "model", label: "Model", unit: "" }],
  pnp: [{ key: "model", label: "Model", unit: "" }],
  switch: [{ key: "state", label: "State (open/closed)", unit: "" }],
  transformer: [{ key: "ratio", label: "Turns ratio", unit: "" }],
  // opamp uses a dedicated model chooser; testpoint / ground take no parameters.
};

export function paramFields(kind: ComponentKind): ParamField[] {
  return SCHEMA[kind] ?? [];
}

const AC_KINDS = new Set<ComponentKind>(["vac", "iac"]);

/** Split a value string into its structured fields for the given kind. */
export function decodeParams(kind: ComponentKind, value: string): Record<string, string> {
  const fields = paramFields(kind);
  if (fields.length === 0) return {};
  if (fields.length === 1) return { [fields[0].key]: value.trim() };
  if (AC_KINDS.has(kind)) {
    const t = value.trim().split(/[\s,;@]+/).filter(Boolean);
    if (t.length >= 3) return { offset: t[0], amplitude: t[1], frequency: t[2] };
    if (t.length === 2) return { offset: "0", amplitude: t[0], frequency: t[1] };
    if (t.length === 1) return { offset: "0", amplitude: t[0], frequency: "1k" };
    return { offset: "0", amplitude: "1", frequency: "1k" };
  }
  return {};
}

/** Re-assemble a value string from structured fields (solver-compatible form). */
export function encodeParams(kind: ComponentKind, values: Record<string, string>): string {
  const fields = paramFields(kind);
  if (fields.length === 1) return (values[fields[0].key] ?? "").trim();
  if (AC_KINDS.has(kind)) {
    const offset = (values.offset ?? "").trim() || "0";
    const amplitude = (values.amplitude ?? "").trim() || "0";
    const frequency = (values.frequency ?? "").trim() || "1k";
    // "amp freq" when there's no offset, else the full "offset amp freq" form.
    return offset === "0" ? `${amplitude} ${frequency}` : `${offset} ${amplitude} ${frequency}`;
  }
  return "";
}
