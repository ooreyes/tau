import type { ComponentKind } from "./types";
import { parseComparator } from "../engine/comparatorSpec";
import { parseIcValue, stripIcSpec } from "../engine/icSpec";

/**
 * Structured parameter fields per component kind. The canonical storage stays a
 * single `value` string (so the solver, persistence and netlist are unchanged);
 * these helpers encode/decode the structured fields to/from it. This lets the
 * editor expose LTspice-style knobs (DC level, amplitude, frequency, …) instead
 * of one cryptic text box.
 *
 * Both directions are driven by the declarative table below - a field list plus
 * the grammar that packs it into the value string. Nothing here dispatches on
 * `kind`, so giving a kind a field set is a data edit: there is no second place
 * to forget, and forgetting used to blank the component on the first keystroke.
 * `keyed` is the default grammar and the one a new kind should want; the
 * positional forms exist because those value strings are already on disk and in
 * `.asc` files.
 */
export type ParamFieldKind = "number" | "text" | "choice" | "toggle";

export interface ParamChoice {
  value: string;
  label: string;
}

export interface ParamField {
  key: string;
  label: string;
  unit: string;
  /**
   * Editor affordance and constraints. The Properties panel renders every field
   * as a text box today; these describe what a field means so a richer control
   * can be attached without re-deriving it per kind.
   */
  kind?: ParamFieldKind;
  choices?: readonly ParamChoice[];
  min?: number;
  max?: number;
  advanced?: boolean;
  description?: string;
  /** Name used in the `Name=value` form. Defaults to `key`. */
  token?: string;
  /** Substituted when the stored value omits this field. */
  fallback?: string;
  /** Written when the user clears the box, if that differs from `fallback`. */
  blank?: string;
  /** Keyed grammar: stored as the leading bare token, not as `Name=value`. */
  bare?: boolean;
  /** Positional grammar: may be absent from the head of the token list. */
  omittable?: boolean;
  /** Keyed grammar: omit the token while the value still equals its fallback,
   *  so an untouched default keeps the compact spelling already on disk. */
  omitWhenFallback?: boolean;
}

type ParamCodec =
  | { form: "single" }
  | { form: "keyed" }
  | {
    form: "positional";
    /** Token separators. Defaults to whitespace, comma and semicolon. */
    split?: RegExp;
    /** Also read a `Name=value` spelling of the same fields. */
    acceptKeyed?: boolean;
    /** Fold a typed µ to the ASCII suffix the engine parses. */
    asciiMicro?: boolean;
  }
  | {
    form: "custom";
    decode: (value: string) => Record<string, string>;
    encode: (values: Record<string, string>) => string;
  };

interface ParamSpec {
  fields: ParamField[];
  /** Defaults to `single` for a lone field, `keyed` otherwise. */
  codec?: ParamCodec;
  /** Variant selector: this field set applies only to a matching value. */
  when?: RegExp;
}

/** Unparsed `Name=value` tokens, carried through an edit so none are dropped. */
export const EXTRA_PARAM_KEY = "$extra";

const CHARGE_CAPACITOR: ParamSpec = {
  when: /^\s*Q\s*=/i,
  fields: [
    { key: "charge", label: "Charge expression", unit: "" },
    { key: "ic", label: "Initial voltage", unit: "V", kind: "number" },
  ],
  codec: {
    form: "custom",
    decode: (value) => ({
      charge: stripIcSpec(value).replace(/^\s*Q\s*=\s*/i, "").trim(),
      ic: parseIcValue(value) ?? "",
    }),
    encode: (values) => {
      const charge = (values.charge ?? "").trim();
      const ic = (values.ic ?? "").trim();
      return `Q=${charge}${ic ? ` IC=${ic}` : ""}`;
    },
  },
};

const AC_SOURCE = (unit: string): ParamSpec => ({
  fields: [
    { key: "offset", label: "Offset", unit, kind: "number", fallback: "0", omittable: true },
    // A cleared amplitude means "no stimulus", so it encodes as 0 rather than
    // silently restoring the 1-unit default the empty-value decode assumes.
    { key: "amplitude", label: "Amplitude", unit, kind: "number", fallback: "1", blank: "0" },
    { key: "frequency", label: "Frequency", unit: "Hz", kind: "number", fallback: "1k" },
  ],
  codec: { form: "positional", split: /[\s,;@]+/ },
});

const MOSFET = (model: string): ParamSpec => ({
  // `MODEL W=<w> L=<l> KP=<kp> VTO=<vto>`; omitted keys keep netlist defaults.
  fields: [
    { key: "model", label: "Model", unit: "", bare: true, fallback: model },
    { key: "w", label: "Width (W)", unit: "m", kind: "number", token: "W" },
    { key: "l", label: "Length (L)", unit: "m", kind: "number", token: "L" },
    { key: "kp", label: "KP", unit: "A/V²", kind: "number", token: "KP" },
    { key: "vto", label: "Vt (VTO)", unit: "V", kind: "number", token: "VTO" },
  ],
});

const SCHEMA: Partial<Record<ComponentKind, ParamSpec | ParamSpec[]>> = {
  resistor: { fields: [{ key: "r", label: "Resistance", unit: "Ω", kind: "number" }] },
  capacitor: [CHARGE_CAPACITOR, { fields: [{ key: "c", label: "Capacitance", unit: "F", kind: "number" }] }],
  polarizedCapacitor: [CHARGE_CAPACITOR, { fields: [{ key: "c", label: "Capacitance", unit: "F", kind: "number" }] }],
  inductor: { fields: [{ key: "l", label: "Inductance", unit: "H", kind: "number" }] },
  potentiometer: {
    fields: [
      { key: "r", label: "Resistance", unit: "Ω", kind: "number", bare: true, fallback: "10k" },
      {
        key: "wiper",
        label: "Wiper position",
        unit: "",
        kind: "number",
        token: "Wiper",
        fallback: "0.5",
        min: 0,
        max: 1,
        omitWhenFallback: true,
        description: "Fraction of the track between pin A and the wiper. 0.5 is centred.",
      },
    ],
  },
  bulb: { fields: [{ key: "r", label: "Filament R (cold)", unit: "Ω", kind: "number" }] },
  vsource: { fields: [{ key: "dc", label: "DC level", unit: "V", kind: "number" }] },
  isource: { fields: [{ key: "dc", label: "DC level", unit: "A", kind: "number" }] },
  logicConstant: { fields: [{ key: "level", label: "Level (0 / 1)", unit: "V" }] },
  vac: AC_SOURCE("V"),
  iac: AC_SOURCE("A"),
  vpulse: {
    fields: [
      { key: "low", label: "Low level", unit: "V", kind: "number", fallback: "0" },
      { key: "high", label: "High level", unit: "V", kind: "number", fallback: "5" },
      { key: "frequency", label: "Frequency", unit: "Hz", kind: "number", fallback: "100k" },
      { key: "duty", label: "Duty (0-1)", unit: "", kind: "number", fallback: "0.5", min: 0, max: 1 },
    ],
    codec: { form: "positional" },
  },
  // Semiconductor symbols use Tau's generic built-in models. Arbitrary vendor
  // names stay unavailable until a parsed library-to-symbol mapping can affect
  // the generated deck instead of being silently ignored.
  switch: { fields: [{ key: "state", label: "State (open/closed)", unit: "" }] },
  pushButton: { fields: [{ key: "state", label: "State (open/pressed)", unit: "" }] },
  spdt: { fields: [{ key: "throw", label: "Throw (no/nc)", unit: "" }] },
  photodiode: { fields: [{ key: "iph", label: "Photocurrent", unit: "A", kind: "number" }] },
  relay: { fields: [{ key: "coil", label: "Coil resistance", unit: "Ω", kind: "number" }] },
  motor: {
    fields: [
      { key: "r", label: "Armature R", unit: "Ω", kind: "number", token: "R", fallback: "10" },
      { key: "l", label: "Armature L", unit: "H", kind: "number", token: "L", fallback: "1m" },
    ],
    codec: { form: "positional", acceptKeyed: true, asciiMicro: true },
  },
  transformer: { fields: [{ key: "ratio", label: "Turns ratio", unit: "" }] },
  ctTransformer: { fields: [{ key: "ratio", label: "Turns ratio", unit: "" }] },
  tline: {
    fields: [
      {
        key: "td",
        label: "Delay",
        unit: "s",
        kind: "number",
        token: "Td",
        fallback: "1n",
        description: "One-way propagation delay along the line.",
      },
      {
        key: "z0",
        label: "Impedance",
        unit: "Ω",
        kind: "number",
        token: "Z0",
        fallback: "50",
        description: "Characteristic impedance of the ideal lossless line.",
      },
    ],
  },
  comparator: {
    fields: [
      { key: "vhigh", label: "Output high", unit: "V", kind: "number" },
      { key: "vlow", label: "Output low", unit: "V", kind: "number" },
      { key: "vhyst", label: "Hysteresis", unit: "V", kind: "number", min: 0 },
    ],
    codec: {
      form: "custom",
      // Decoding goes through the solver's own parser so the panel shows the
      // levels the comparator will actually switch between, aliases included.
      decode: (value) => {
        const spec = parseComparator(value);
        return { vhigh: String(spec.vhigh), vlow: String(spec.vlow), vhyst: String(spec.vhyst) };
      },
      encode: (values) => {
        const vhigh = (values.vhigh ?? "").trim() || "1";
        const vlow = (values.vlow ?? "").trim() || "0";
        const vhyst = (values.vhyst ?? "").trim() || "0";
        // Drop a zero hysteresis so the common ideal comparator stays "vhi vlo".
        return Number(vhyst) ? `${vhigh} ${vlow} ${vhyst}` : `${vhigh} ${vlow}`;
      },
    },
  },
  nmos: MOSFET("NMOS"),
  pmos: MOSFET("PMOS"),
  // opamp uses a dedicated model chooser; ground takes no parameters.
};

const specsFor = (kind: ComponentKind): ParamSpec[] => {
  const entry = SCHEMA[kind];
  if (!entry) return [];
  return Array.isArray(entry) ? entry : [entry];
};

/** The variant whose pattern matches the stored value; the base spec otherwise. */
const specForValue = (kind: ComponentKind, value: string): ParamSpec | null =>
  specsFor(kind).find((spec) => !spec.when || spec.when.test(value)) ?? null;

/**
 * The variant a decoded field set belongs to. A variant is chosen by a key only
 * it defines (a charge capacitor's `charge`), so a plain edit still lands on the
 * base spec.
 */
const specForValues = (kind: ComponentKind, values: Record<string, string>): ParamSpec | null => {
  const specs = specsFor(kind);
  for (const spec of specs) {
    if (!spec.when) return spec;
    const ownKeys = spec.fields
      .map((field) => field.key)
      .filter((key) => !specs.some((other) => other !== spec && other.fields.some((f) => f.key === key)));
    if (ownKeys.some((key) => Object.prototype.hasOwnProperty.call(values, key))) return spec;
  }
  return null;
};

const codecFor = (spec: ParamSpec): ParamCodec =>
  spec.codec ?? (spec.fields.length === 1 ? { form: "single" } : { form: "keyed" });

const tokenOf = (field: ParamField): string => field.token ?? field.key;

const fallbackOf = (field: ParamField): string => field.fallback ?? "";

/** Value written for a field the user cleared. */
const blankOf = (field: ParamField): string => field.blank ?? fallbackOf(field);

export function paramFields(kind: ComponentKind, value = ""): ParamField[] {
  return specForValue(kind, value)?.fields ?? [];
}

/** Split a value string into its structured fields for the given kind. */
export function decodeParams(kind: ComponentKind, value: string): Record<string, string> {
  const spec = specForValue(kind, value);
  if (!spec || spec.fields.length === 0) return {};
  const codec = codecFor(spec);
  switch (codec.form) {
    case "custom":
      return codec.decode(value);
    case "single":
      return { [spec.fields[0].key]: value.trim() };
    case "keyed":
      return decodeKeyed(spec.fields, value);
    case "positional":
      return decodePositional(spec.fields, value, codec);
  }
}

/** Re-assemble a value string from structured fields (solver-compatible form). */
export function encodeParams(kind: ComponentKind, values: Record<string, string>): string {
  const spec = specForValues(kind, values);
  if (!spec || spec.fields.length === 0) return "";
  const codec = codecFor(spec);
  switch (codec.form) {
    case "custom":
      return codec.encode(values);
    case "single":
      return (values[spec.fields[0].key] ?? "").trim();
    case "keyed":
      return encodeKeyed(spec.fields, values);
    case "positional":
      return encodePositional(spec.fields, values);
  }
}

/**
 * `MODEL Key=value …` - the grammar shared by MOSFET geometry, the transmission
 * line and the digital block. A leading bare token is claimed by a `bare` field
 * only when it is not itself a `Key=value`. Tokens no field claims ride along in
 * `EXTRA_PARAM_KEY` so editing one box never deletes syntax the panel does not
 * model.
 */
function decodeKeyed(fields: ParamField[], value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) out[field.key] = fallbackOf(field);
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  const claimsKey = (token: string) =>
    fields.some((field) => new RegExp(`^${tokenOf(field)}=`, "i").test(token));
  const extras: string[] = [];
  const lead = fields.find((field) => field.bare);
  // The bare token is the first one that is not a `Key=value`, wherever it sits.
  // Requiring it to lead would leave a hand-typed "Wiper=0.3 10k" with the
  // resistance in the unmodelled-token bag while the deck parsed it as the
  // resistance anyway - the panel and the netlist disagreeing about one string.
  const leadIndex = lead ? tokens.findIndex((token) => !claimsKey(token)) : -1;
  if (lead && leadIndex >= 0) out[lead.key] = tokens[leadIndex];
  for (let index = 0; index < tokens.length; index += 1) {
    if (index === leadIndex) continue;
    const token = tokens[index];
    const eq = token.indexOf("=");
    const name = eq > 0 ? token.slice(0, eq) : "";
    const field = fields.find((f) => !f.bare && tokenOf(f).toLowerCase() === name.toLowerCase());
    if (field) out[field.key] = token.slice(eq + 1);
    else extras.push(token);
  }
  if (extras.length > 0) out[EXTRA_PARAM_KEY] = extras.join(" ");
  return out;
}

function encodeKeyed(fields: ParamField[], values: Record<string, string>): string {
  const parts: string[] = [];
  for (const field of fields) {
    const raw = (values[field.key] ?? "").trim();
    if (field.bare) {
      parts.push(raw || blankOf(field));
      continue;
    }
    if (field.omitWhenFallback && raw === fallbackOf(field)) continue;
    // An empty box means "leave it to the model default", so the key is omitted
    // rather than emitted with nothing after the `=`.
    if (raw) parts.push(`${tokenOf(field)}=${raw}`);
  }
  const extras = (values[EXTRA_PARAM_KEY] ?? "").trim();
  if (extras) parts.push(extras);
  return parts.filter(Boolean).join(" ");
}

/**
 * Ordered bare tokens. When fewer are present than there are fields, the
 * `omittable` leading fields are the ones assumed absent - that is how a
 * two-token AC source means "amplitude frequency" with no offset.
 */
function decodePositional(
  fields: ParamField[],
  value: string,
  codec: { split?: RegExp; acceptKeyed?: boolean; asciiMicro?: boolean },
): Record<string, string> {
  const text = codec.asciiMicro ? value.trim().replace(/µ/g, "u") : value.trim();
  if (codec.acceptKeyed) {
    const keyed = fields.map((field) =>
      new RegExp(`(?:^|[\\s,;])${tokenOf(field)}\\s*=\\s*([^\\s,;]+)`, "i").exec(` ${text}`));
    if (keyed.some(Boolean)) {
      return Object.fromEntries(fields.map((field, i) => [field.key, keyed[i]?.[1] ?? fallbackOf(field)]));
    }
  }
  const tokens = text.split(codec.split ?? /[\s,;]+/).filter(Boolean);
  const leadingOmittable = fields.findIndex((field) => !field.omittable);
  const skip = Math.min(
    leadingOmittable < 0 ? fields.length : leadingOmittable,
    Math.max(0, fields.length - tokens.length),
  );
  return Object.fromEntries(fields.map((field, i) =>
    [field.key, (i < skip ? undefined : tokens[i - skip]) ?? fallbackOf(field)]));
}

function encodePositional(fields: ParamField[], values: Record<string, string>): string {
  const out = fields.map((field) => (values[field.key] ?? "").trim() || blankOf(field));
  // A leading omittable field still holding its fallback is left unwritten, so
  // an untouched AC source keeps the compact "amplitude frequency" spelling.
  let start = 0;
  while (start < fields.length && fields[start].omittable && out[start] === fallbackOf(fields[start])) {
    start += 1;
  }
  return out.slice(start).join(" ");
}
