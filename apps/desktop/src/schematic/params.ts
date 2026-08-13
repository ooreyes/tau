import type { ComponentKind } from "./types";
import { parseComparator } from "../engine/comparatorSpec";
import { parseIcValue, stripIcSpec } from "../engine/icSpec";
import {
  LED_COLOR_CHOICES,
  DEFAULT_LED_FORWARD_VOLTS,
  ledColorFromValue,
  ledHasExplicitColor,
  ledHasExplicitForwardVoltage,
  normalizeLedColor,
  ledTypicalForwardVolts,
} from "../engine/ledSpec";
import { formatEngineering, parseQuantity } from "../simulation/quantity";
import { isStaticSwitchValue, STATIC_SWITCH_VALUE_RE } from "./kindGroups";

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

/**
 * A unit the panel shows a field in, when that differs from the unit the deck
 * stores it in.
 *
 * A normalised 0..1 fraction is the case this exists for, and it is a general
 * one: a potentiometer's wiper and a pulse source's duty are both stored as a
 * fraction because that is what the solver and the `.asc` file want, and are
 * both READ as a percentage by every engineer alive. Special-casing the wiper
 * in the panel would have left the duty cycle - the identical problem, two
 * lines further down the same table - still showing "0.5".
 *
 * `scale` is a display multiplier only. Storage, the netlist and the bounds in
 * `min`/`max` all stay in the field's own unit; {@link displayParamField}
 * converts the bounds so a single {@link clampParamValue} still enforces them,
 * and {@link fromDisplayParamValue} converts a committed number back before it
 * is encoded. Nothing downstream of the panel learns that percentages exist.
 */
export interface ParamDisplayUnit {
  /** Stored value times this is what the reader sees and types. */
  scale: number;
  /** Shown against the number. Not SI-prefixable - "m%" is not a quantity. */
  unit: string;
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
  /**
   * Inclusive bounds. These are ENFORCED, not advisory: {@link clampParamValue}
   * folds a committed value into the range and the Properties panel shows the
   * range beside the box. They were decorative for a while, and a gate happily
   * stored `Inputs=21000` while drawing its five-lead maximum - the file and
   * the drawing disagreeing about the same part.
   */
  min?: number;
  max?: number;
  /** Whole numbers only - a gate cannot have three and a half inputs. */
  integer?: boolean;
  /** Show and accept this field in another unit - see {@link ParamDisplayUnit}. */
  display?: ParamDisplayUnit;
  advanced?: boolean;
  /** Stored identity used by the codec, never an editable generic knob. */
  internal?: boolean;
  description?: string;
  /**
   * Kind-specific syntax which cannot be expressed as a unit/range pair.
   * Returning a message keeps an invalid draft in the editor and out of the
   * stored schematic, exactly like numeric bounds do.
   */
  validate?: (raw: string) => string | null;
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
  /**
   * What the part does and what its pins are for, shown above the fields. A
   * per-field `description` can only explain the number it sits under; a part
   * whose meaning lives in pins the panel has no field for (the modulator's FM,
   * AM and COM) has nowhere else to say so.
   */
  summary?: string;
}

/** Unparsed `Name=value` tokens, carried through an edit so none are dropped. */
export const EXTRA_PARAM_KEY = "$extra";

// These decode-only markers distinguish an inferred color/Vf from a value the
// author actually wrote. They never reach the stored component string.
const LED_COLOR_EXPLICIT_KEY = "$ledColorExplicit";
const LED_VFWD_EXPLICIT_KEY = "$ledVfwdExplicit";

const isKnownLedColor = (raw: string): boolean => {
  const normalized = raw.trim().toLowerCase().replace(/[_-]+/g, " ");
  return normalized === "orange"
    || normalized === "amber/orange"
    || LED_COLOR_CHOICES.some((choice) => choice.value === normalized);
};

/**
 * Transformer values are a compact little grammar, not arbitrary prose. The
 * netlister has always accepted a turns ratio plus optional L1/L2/k terms; the
 * inspector validates that same authored surface before it writes a value the
 * deck would quietly fall back from.
 */
const transformerValueValidationMessage = (raw: string): string | null => {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  const ratio = tokens.shift();
  const ratioMatch = /^([+]?(?:\d+(?:\.\d*)?|\.\d+))\s*:\s*([+]?(?:\d+(?:\.\d*)?|\.\d+))$/.exec(ratio ?? "");
  if (!ratioMatch || Number(ratioMatch[1]) <= 0 || Number(ratioMatch[2]) <= 0) {
    return "Enter a positive turns ratio such as 1:1.";
  }
  const seen = new Set<string>();
  for (const token of tokens) {
    const match = /^(L1|L2|k)=([^\s]+)$/i.exec(token);
    if (!match || seen.has(match[1].toLowerCase())) {
      return "Use optional L1=, L2=, and k= terms after the turns ratio.";
    }
    seen.add(match[1].toLowerCase());
    let numeric: number;
    try {
      numeric = parseQuantity(match[2], match[1].toLowerCase() === "k" ? "" : "H");
    } catch {
      return `${match[1]} must be a finite ${match[1].toLowerCase() === "k" ? "coupling" : "inductance"}.`;
    }
    if (!Number.isFinite(numeric) || numeric <= 0 || (match[1].toLowerCase() === "k" && numeric >= 1)) {
      return match[1].toLowerCase() === "k"
        ? "k must be greater than 0 and below 1."
        : `${match[1]} must be greater than 0.`;
    }
  }
  return null;
};

const CHARGE_CAPACITOR: ParamSpec = {
  when: /^\s*Q\s*=/i,
  fields: [
    { key: "charge", label: "Charge expression", unit: "", kind: "text" },
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

/** The `Laplace=` token itself, matched the way `engine/laplace.ts` matches it
 *  so the panel and the deck agree on where the expression starts. */
const LAPLACE_HEAD = /(?:^|\s)laplace\s*=\s*/i;

/**
 * An LTspice `Laplace=H(s)` value on an E or G source is a transfer function,
 * not a gain, and the two spellings are mutually exclusive: neither engine has
 * an E/G form carrying a constant gain AND a Laplace expression, so a value
 * holding both would be a string Tau writes into a `.asc` that LTspice cannot
 * read. It is therefore a value VARIANT (the charge-defined capacitor's
 * mechanism) rather than a second box - a source whose value is a transfer
 * function shows a transfer-function control, and one whose value is a number
 * shows its gain. Anything sitting in front of the `Laplace=` token rides
 * through an edit under `EXTRA_PARAM_KEY`, as in the keyed grammar, so editing
 * the expression cannot delete syntax the panel does not model.
 *
 * The description is per-kind because the honest answer differs by kind.
 * `s_xfer` is a voltage-in/voltage-out code model, so only an E source can
 * realize a rational H(s) exactly; `laplace.ts` guards that branch with
 * `if (!isCurrent)` and falls every G source back to the DC gain H(0). Telling
 * a VCCS user that the output follows H(s) would promise a frequency response
 * the deck never runs.
 */
const LAPLACE_TRANSFER = (description: string): ParamSpec => ({
  when: /(?:^|\s)laplace\s*=/i,
  fields: [{
    key: "laplace",
    label: "Transfer H(s)",
    unit: "",
    kind: "text",
    description,
  }],
  codec: {
    form: "custom",
    decode: (value) => {
      const text = value.trim();
      const match = LAPLACE_HEAD.exec(text);
      if (!match) return { laplace: "" };
      const head = text.slice(0, match.index).trim();
      const out: Record<string, string> = { laplace: text.slice(match.index + match[0].length).trim() };
      if (head) out[EXTRA_PARAM_KEY] = head;
      return out;
    },
    encode: (values) => {
      const head = (values[EXTRA_PARAM_KEY] ?? "").trim();
      return `${head ? `${head} ` : ""}Laplace=${(values.laplace ?? "").trim()}`;
    },
  },
});

const MOSFET = (model: string): ParamSpec => ({
  // `MODEL W=<w> L=<l> KP=<kp> VTO=<vto>`; omitted keys keep netlist defaults.
  fields: [
    { key: "model", label: "Model", unit: "", bare: true, fallback: model, internal: true },
    { key: "w", label: "Width (W)", unit: "m", kind: "number", token: "W", min: 1e-12, max: 1,
      description: "Channel width; larger W increases drive strength." },
    { key: "l", label: "Length (L)", unit: "m", kind: "number", token: "L", min: 1e-12, max: 1,
      description: "Channel length; larger L reduces drive strength." },
    { key: "kp", label: "KP", unit: "A/V²", kind: "number", token: "KP", min: 0, max: 1e3,
      description: "Process transconductance; larger values increase drain current." },
    { key: "vto", label: "Vt (VTO)", unit: "V", kind: "number", token: "VTO", min: -100, max: 100,
      description: "Threshold voltage where the channel begins to conduct." },
  ],
});

const GENERIC_DIODE: ParamSpec = {
  when: /^(?:d|diode)(?:\s|$)/i,
  fields: [
    { key: "model", label: "Model", unit: "", bare: true, fallback: "D", internal: true },
    { key: "is", label: "Saturation current", unit: "A", kind: "number", token: "Is", fallback: "1e-14", min: 0, max: 1, omitWhenFallback: true, advanced: true,
      description: "Sets reverse leakage and shifts the forward current curve." },
    { key: "n", label: "Emission coefficient", unit: "", kind: "number", token: "N", fallback: "1", min: 0.1, max: 10, omitWhenFallback: true,
      description: "Shapes how sharply forward current rises with voltage." },
  ],
};

const GENERIC_LED: ParamSpec = {
  when: /^led(?:\s|$)/i,
  fields: [
    { key: "model", label: "Model", unit: "", bare: true, fallback: "LED", internal: true },
    {
      key: "color",
      label: "Color",
      unit: "",
      kind: "choice",
      fallback: "red",
      omitWhenFallback: true,
      choices: LED_COLOR_CHOICES,
      description: "Each color starts with a typical forward voltage.",
    },
    {
      key: "vfwd",
      label: "Forward voltage",
      unit: "V",
      kind: "number",
      token: "Vfwd",
      fallback: String(DEFAULT_LED_FORWARD_VOLTS),
      min: 0.1,
      max: 20,
      omitWhenFallback: true,
      description: "Uses the selected color’s default until you enter an override for this LED.",
    },
  ],
  codec: {
    form: "custom",
    decode: (value) => {
      const tokens = value.trim().split(/[\s,;]+/).filter(Boolean);
      const modelIndex = tokens.findIndex((token) => !token.includes("="));
      const model = modelIndex >= 0 ? tokens[modelIndex] : "LED";
      const color = ledColorFromValue(value);
      const keyedColor = keyedValue(value, ["color"]);
      const vfwd = keyedValue(value, ["Vfwd", "Forward"]);
      const extras = tokens.filter((token, index) => {
        if (index === modelIndex) return false;
        if (/^(?:color|Vfwd|Forward)\s*=/i.test(token)) return false;
        // Preserve the compact legacy `LED blue` spelling while it is being
        // decoded; an edit will write the canonical keyed spelling.
        if (index > modelIndex && normalizeLedColor(token) === color &&
            (/^(?:red|amber|orange|amber\/orange|yellow|green|blue|white|custom)$/i.test(token))) return false;
        return true;
      });
      return {
        model,
        // Keep an unknown imported token intact for the schema's round-trip
        // guarantee; the inspector's choice validator still refuses it before
        // a user edit can commit it.
        color: keyedColor && !isKnownLedColor(keyedColor) ? keyedColor : color,
        // This is a display value only when absent from storage. The explicit
        // marker below prevents it from becoming a false `Vfwd=` override.
        vfwd: vfwd ?? String(ledTypicalForwardVolts(color)),
        [LED_COLOR_EXPLICIT_KEY]: ledHasExplicitColor(value) ? "true" : "false",
        [LED_VFWD_EXPLICIT_KEY]: vfwd ? "true" : "false",
        ...(extras.length > 0 ? { [EXTRA_PARAM_KEY]: extras.join(" ") } : {}),
      };
    },
    encode: (values) => {
      const model = (values.model ?? "LED").trim() || "LED";
      const rawColor = (values.color ?? "").trim();
      const color = isKnownLedColor(rawColor) ? normalizeLedColor(rawColor) : rawColor || "red";
      const colorExplicit = values[LED_COLOR_EXPLICIT_KEY] === "true" || color !== "red";
      const vfwd = (values.vfwd ?? "").trim();
      // Objects assembled directly by callers predate the decode markers and
      // are treated as explicit, while decoded color defaults remain inferred.
      const vfwdExplicit = values[LED_VFWD_EXPLICIT_KEY] === undefined
        ? Boolean(vfwd)
        : values[LED_VFWD_EXPLICIT_KEY] === "true";
      const parts = [model];
      if (colorExplicit) parts.push(`color=${color}`);
      if (vfwdExplicit && vfwd) parts.push(`Vfwd=${vfwd}`);
      const extras = (values[EXTRA_PARAM_KEY] ?? "").trim();
      if (extras) parts.push(extras);
      return parts.join(" ");
    },
  },
};

const parseVoltageMarking = (text: string): number | null => {
  const rNotation = /^(\d{1,3})V(\d{1,2})$/i.exec(text.trim());
  const decimal = /^(\d{1,3}(?:\.\d{1,2})?)V$/i.exec(text.trim());
  const volts = rNotation ? Number(`${rNotation[1]}.${rNotation[2]}`) : decimal ? Number(decimal[1]) : NaN;
  return Number.isFinite(volts) && volts > 0 && volts <= 400 ? volts : null;
};

const keyedValue = (value: string, names: readonly string[]): string | undefined => {
  const pattern = names.join("|");
  return new RegExp(`(?:^|[\\s,;])(?:${pattern})\\s*=\\s*([^\\s,;]+)`, "i").exec(` ${value}`)?.[1];
};

const GENERIC_ZENER: ParamSpec = {
  when: /^(?:zener|\d{1,3}(?:\.\d{1,2})?v(?:\d{1,2})?)(?:\s|$)/i,
  fields: [
    { key: "model", label: "Model", unit: "", bare: true, fallback: "5V1", internal: true },
    { key: "breakdown", label: "Breakdown voltage", unit: "V", kind: "number", fallback: "5.1", min: 0.1, max: 400,
      description: "Reverse voltage where the zener begins to conduct." },
    { key: "vfwd", label: "Forward voltage", unit: "V", kind: "number", token: "Vfwd", fallback: "0.7", min: 0.1, max: 20, omitWhenFallback: true,
      description: "Forward-direction voltage drop." },
  ],
  codec: {
    form: "custom",
    decode: (value) => {
      const tokens = value.trim().split(/[\s,;]+/).filter(Boolean);
      const model = tokens.find((token) => !token.includes("=")) ?? "5V1";
      const breakdown = keyedValue(value, ["Vrev", "Bv", "Breakdown"])
        ?? String(parseVoltageMarking(model) ?? 5.1);
      const vfwd = keyedValue(value, ["Vfwd", "Forward"] ) ?? "0.7";
      const known = new Set([model.toLowerCase(), "vrev", "bv", "breakdown", "vfwd", "forward"]);
      const extras = tokens.filter((token) => {
        const [name] = token.split("=", 1);
        return !known.has(name.toLowerCase()) && token !== model;
      });
      return { model, breakdown, vfwd, ...(extras.length > 0 ? { [EXTRA_PARAM_KEY]: extras.join(" ") } : {}) };
    },
    encode: (values) => {
      const model = (values.model ?? "5V1").trim() || "5V1";
      const breakdown = (values.breakdown ?? "5.1").trim() || "5.1";
      const vfwd = (values.vfwd ?? "0.7").trim() || "0.7";
      const modelVolts = parseVoltageMarking(model);
      const parts = [model];
      const breakdownNumber = Number(breakdown);
      if (modelVolts === null || !Number.isFinite(breakdownNumber) || Math.abs(modelVolts - breakdownNumber) > 1e-9) {
        parts.push(`Vrev=${breakdown}`);
      }
      if (vfwd !== "0.7") parts.push(`Vfwd=${vfwd}`);
      const extras = (values[EXTRA_PARAM_KEY] ?? "").trim();
      if (extras) parts.push(extras);
      return parts.join(" ");
    },
  },
};

const GENERIC_BJT = (model: string): ParamSpec => ({
  when: new RegExp(`^${model}(?:\\s|$)`, "i"),
  fields: [
    { key: "model", label: "Model", unit: "", bare: true, fallback: model, internal: true },
    { key: "beta", label: "Forward gain (β)", unit: "", kind: "number", token: "Bf", fallback: "100", min: 0.1, max: 1e6, omitWhenFallback: true,
      description: "DC current gain: collector current per base current." },
    { key: "vaf", label: "Early voltage", unit: "V", kind: "number", token: "Vaf", fallback: "100", min: 0.1, max: 1e6, omitWhenFallback: true,
      description: "Models collector current’s change with output voltage." },
  ],
});

const GENERIC_JFET = (model: string, defaultVto: string): ParamSpec => ({
  when: new RegExp(`^${model}(?:\\s|$)`, "i"),
  fields: [
    { key: "model", label: "Model", unit: "", bare: true, fallback: model, internal: true },
    { key: "vto", label: "Pinch-off voltage", unit: "V", kind: "number", token: "Vto", fallback: defaultVto, min: -100, max: 100, omitWhenFallback: true,
      description: "Gate-to-source voltage where the channel pinches off." },
    { key: "beta", label: "Beta", unit: "A/V²", kind: "number", token: "Beta", fallback: "1m", min: 1e-12, max: 1e3, omitWhenFallback: true,
      description: "Sets channel current versus gate voltage." },
  ],
});

const GENERIC_OPAMP: ParamSpec = {
  when: /^(?:ideal|(?:gain|avol|vmin|vmax|min|max)\s*=)/i,
  fields: [
    { key: "model", label: "Model", unit: "", kind: "text", bare: true, fallback: "ideal", internal: true },
    { key: "gain", label: "Open-loop gain", unit: "V/V", kind: "number", token: "Gain", fallback: "1Meg", min: 1, max: 1e12,
      description: "Unloaded differential gain before the output reaches its limits." },
    { key: "vmin", label: "Minimum output", unit: "V", kind: "number", token: "Vmin", fallback: "-15", min: -1e3, max: 1e3,
      description: "Lowest output voltage this behavioral op-amp can produce." },
    { key: "vmax", label: "Maximum output", unit: "V", kind: "number", token: "Vmax", fallback: "15", min: -1e3, max: 1e3,
      description: "Highest output voltage this behavioral op-amp can produce." },
  ],
  codec: {
    form: "custom",
    decode: (value) => {
      const tokens = value.trim().split(/[\s,;]+/).filter(Boolean);
      const model = tokens.find((token) => !token.includes("=")) ?? "ideal";
      return {
        model,
        gain: keyedValue(value, ["Gain", "Avol"]) ?? "1Meg",
        vmin: keyedValue(value, ["Vmin", "Min", "Vlo"]) ?? "-15",
        vmax: keyedValue(value, ["Vmax", "Max", "Vhi"]) ?? "15",
      };
    },
    encode: (values) => [
      (values.model ?? "ideal").trim() || "ideal",
      (values.gain && values.gain.trim() !== "1Meg") ? `Gain=${values.gain.trim()}` : "",
      (values.vmin && values.vmin.trim() !== "-15") ? `Vmin=${values.vmin.trim()}` : "",
      (values.vmax && values.vmax.trim() !== "15") ? `Vmax=${values.vmax.trim()}` : "",
    ].filter(Boolean).join(" "),
  },
};

const SCHEMA: Partial<Record<ComponentKind, ParamSpec | ParamSpec[]>> = {
  resistor: { fields: [{ key: "r", label: "Resistance", unit: "Ω", kind: "number" }] },
  capacitor: [CHARGE_CAPACITOR, { fields: [{ key: "c", label: "Capacitance", unit: "F", kind: "number" }] }],
  // The polarity marking is the only thing separating this from a plain
  // capacitor, so the panel has to say what it costs to get it wrong. The
  // simulation now checks it: see `simulation/polarizedCapacitor.ts`.
  polarizedCapacitor: [CHARGE_CAPACITOR, {
    fields: [{
      key: "c",
      label: "Capacitance",
      unit: "F",
      kind: "number",
      description: "The + terminal must sit at the higher potential.",
    }],
  }],
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
        display: { scale: 100, unit: "%" },
        omitWhenFallback: true,
      },
    ],
  },
  bulb: { fields: [{ key: "r", label: "Filament R (cold)", unit: "Ω", kind: "number" }] },
  vsource: { fields: [{ key: "dc", label: "DC level", unit: "V", kind: "number" }] },
  isource: { fields: [{ key: "dc", label: "DC level", unit: "A", kind: "number" }] },
  logicConstant: {
    fields: [{
      key: "level",
      label: "Level",
      unit: "",
      kind: "choice",
      bare: true,
      fallback: "1",
      choices: [{ value: "0", label: "0 · low" }, { value: "1", label: "1 · high" }],
    }],
  },
  // The gate function is the leading bare token the deck already reads; the
  // input count rides the same keyed grammar. `omitWhenFallback` keeps a plain
  // two-input gate spelled exactly "and" on disk, as every saved file has it.
  // The parser (`engine/digitalGateSpec.ts`) clamps to what the deck can emit.
  digitalGate: {
    fields: [
      { key: "fn", label: "Function", unit: "", kind: "choice", bare: true, fallback: "and",
        choices: [
          { value: "and", label: "AND" }, { value: "or", label: "OR" },
          { value: "nand", label: "NAND" }, { value: "nor", label: "NOR" },
          { value: "xor", label: "XOR" }, { value: "xnor", label: "XNOR" },
          { value: "buf", label: "Buffer" }, { value: "not", label: "NOT" },
          { value: "schmitt", label: "Schmitt trigger" },
        ] },
      { key: "inputs", label: "Inputs", unit: "", kind: "number", token: "Inputs",
        min: 2, max: 5, integer: true, fallback: "2", omitWhenFallback: true },
    ],
  },
  vac: AC_SOURCE("V"),
  iac: AC_SOURCE("A"),
  vpulse: {
    fields: [
      { key: "low", label: "Low level", unit: "V", kind: "number", fallback: "0" },
      { key: "high", label: "High level", unit: "V", kind: "number", fallback: "5" },
      { key: "frequency", label: "Frequency", unit: "Hz", kind: "number", fallback: "100k" },
      // Stored as the 0..1 fraction the PULSE spec on disk already uses; shown
      // as the percentage a duty cycle is quoted in. The old "(0-1)" in the
      // label was the panel apologising for a storage detail.
      {
        key: "duty",
        label: "Duty",
        unit: "",
        kind: "number",
        fallback: "0.5",
        min: 0,
        max: 1,
        display: { scale: 100, unit: "%" },
      },
    ],
    codec: { form: "positional" },
  },
  // A palette SPST accepts only Tau's own static vocabulary. Any other value
  // is a voltage-controlled `.model … SW` identity (for example `MYSW`) and
  // must bypass this field entirely, retaining its control pins and exact
  // model-resolution path rather than being coerced to Open or Closed.
  switch: [{
    when: STATIC_SWITCH_VALUE_RE,
    fields: [{
      key: "state",
      label: "State",
      unit: "",
      kind: "text",
      validate: (raw) => isStaticSwitchValue(raw)
        ? null
        : "Use Open or Closed for a native SPST contact.",
      description: "A static SPST contact connects A to B only while closed.",
    }],
  }, {
    // Named/imported SW models have no static state field: their Value is the
    // authored model name and selecting one must never rewrite it.
    fields: [],
  }],
  // `state` stays the leading bare token because the push-button solver reads
  // the raw contact state. Moving it behind a `state=` key would make every
  // closed button read as open.
  // `form` and `action` are omitted while they hold their defaults, so an
  // untouched button is still spelled exactly "open" on disk.
  pushButton: {
    fields: [
      { key: "state", label: "State", unit: "", kind: "choice", bare: true, fallback: "open",
        choices: [{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }] },
      // Both fall back to unset rather than to their default word. An omitted
      // `form` means "the state on disk is the rest state", which is what lets
      // a button that has never been pressed describe itself; writing "no" into
      // that slot would be indistinguishable from a real answer. An unset field
      // encodes to nothing, so the catalog default is still spelled "open".
      { key: "form", label: "Contact", unit: "", kind: "choice", fallback: "",
        choices: [
          { value: "no", label: "Normally open" },
          { value: "nc", label: "Normally closed" },
        ] },
      { key: "action", label: "Action", unit: "", kind: "choice", fallback: "",
        choices: [
          { value: "momentary", label: "Momentary" },
          { value: "latching", label: "Latching" },
        ] },
    ],
  },
  spdt: {
    fields: [{
      key: "throw",
      label: "Selected throw",
      unit: "",
      kind: "choice",
      choices: [{ value: "no", label: "Normally open" }, { value: "nc", label: "Normally closed" }],
      description: "COM connects to the selected throw; it never joins both poles.",
    }],
  },
  photodiode: [{
    when: /^\s*[+\-]?(?:\d|\.\d)/,
    fields: [{ key: "iph", label: "Photocurrent", unit: "A", kind: "number", min: 0,
      description: "Light-generated current; a larger value produces more reverse current." }],
  }, {
    // Preserve an imported model token exactly rather than coercing it into a
    // generic photocurrent setting just because it is not a number.
    fields: [],
  }],
  relay: { fields: [{ key: "coil", label: "Coil resistance", unit: "Ω", kind: "number", min: 0.001,
    description: "Coil voltage controls the contact; resistance affects coil current only." }] },
  motor: {
    fields: [
      { key: "r", label: "Armature R", unit: "Ω", kind: "number", token: "R", fallback: "10", min: 0.001,
        description: "Winding resistance; larger R reduces armature current." },
      { key: "l", label: "Armature L", unit: "H", kind: "number", token: "L", fallback: "1m", min: 0,
        description: "Winding inductance; larger L slows current changes." },
    ],
    codec: { form: "positional", acceptKeyed: true, asciiMicro: true },
  },
  transformer: { fields: [{ key: "ratio", label: "Turns ratio", unit: "", kind: "text", validate: transformerValueValidationMessage,
    description: "Primary:secondary turns; optional L1, L2, and k refine the coupled windings." }] },
  ctTransformer: { fields: [{ key: "ratio", label: "Turns ratio", unit: "", kind: "text", validate: transformerValueValidationMessage,
    description: "Primary:secondary turns; the secondary center tap is a separate terminal." }] },
  tline: {
    fields: [
      {
        key: "td",
        label: "Delay",
        unit: "s",
        kind: "number",
        token: "Td",
        fallback: "1n",
      },
      {
        key: "z0",
        label: "Impedance",
        unit: "Ω",
        kind: "number",
        token: "Z0",
        fallback: "50",
      },
    ],
  },
  // The VCO. Its value is already `mark=<f> space=<f>`, which is the default
  // keyed grammar, so the two frequencies are a data edit; what the panel adds
  // is that they ARE frequencies, which pin selects between them, and what the
  // other three pins do. The fallbacks are `parseModulator`'s own defaults, so
  // a value that omits one shows the number the deck will run.
  modulator: {
    // One line, not a paragraph. The two frequency rows below already carry
    // the 0 V / 1 V endpoints, so repeating them here was the panel explaining
    // itself twice.
    summary: "Q outputs a ±1 V sine; FM sets frequency, AM scales amplitude, COM is the reference.",
    fields: [
      {
        key: "mark",
        label: "Mark frequency",
        unit: "Hz",
        kind: "number",
        token: "mark",
        fallback: "1k",
        min: 0,
      },
      {
        key: "space",
        label: "Space frequency",
        unit: "Hz",
        kind: "number",
        token: "space",
        fallback: "0",
        min: 0,
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
  // Controlled sources. The value is one number, so the codec is the plain
  // `single` one; what the panel adds is the NAME of that number and the unit
  // the deck emits it in - `spiceNetlist.ts` hands exactly these unit strings
  // to `numberValue`, so a mismatch here would be a mislabelled quantity.
  // Four identical-looking pins make the control port the thing a reader
  // actually needs told, which is what the descriptions carry.
  vcvs: [LAPLACE_TRANSFER(
    "Transfer function in LTspice spelling, for example 1/(1+0.001*s). It replaces the constant gain. A rational H(s) runs exactly; anything else runs its DC gain, and Tau says so.",
  ), {
    fields: [{
      key: "gain",
      label: "Voltage gain",
      unit: "V/V",
      kind: "number",
      description: "Sensed across C+/C-; the control port draws no current.",
    }],
  }],
  vccs: [LAPLACE_TRANSFER(
    "Transfer function in LTspice spelling, for example 1/(1+0.001*s). It replaces the constant gain. A current source has no exact form here, so Tau runs the DC gain of H(s) and reports that it did.",
  ), {
    fields: [{
      key: "gain",
      label: "Transconductance",
      unit: "A/V",
      kind: "number",
      description: "Sensed across C+/C-; the control port draws no current.",
    }],
  }],
  // No Laplace variant on the current-controlled pair: F and H sources take a
  // constant only, in both engines.
  cccs: {
    fields: [{
      key: "gain",
      label: "Current gain",
      unit: "A/A",
      kind: "number",
      description: "Wire C+/C- in series with the sensed branch; Tau supplies the sense pair.",
    }],
  },
  ccvs: {
    fields: [{
      key: "gain",
      label: "Transresistance",
      unit: "V/A",
      kind: "number",
      description: "Wire C+/C- in series with the sensed branch; Tau supplies the sense pair.",
    }],
  },
  diode: GENERIC_DIODE,
  led: GENERIC_LED,
  zener: GENERIC_ZENER,
  npn: GENERIC_BJT("NPN"),
  pnp: GENERIC_BJT("PNP"),
  nmos: MOSFET("NMOS"),
  pmos: MOSFET("PMOS"),
  njf: GENERIC_JFET("NJF", "-2"),
  pjf: GENERIC_JFET("PJF", "2"),
  opamp: GENERIC_OPAMP,
  // ground takes no parameters.
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
  return specForValue(kind, value)?.fields.filter((field) => !field.internal) ?? [];
}

/**
 * Validate a single draft before it reaches the document. The solver still
 * owns model semantics, but the inspector must not write a non-finite number,
 * an out-of-range value, or an enum token that its symbol cannot represent.
 * Empty values are only allowed for explicitly optional fields.
 */
export function paramValidationMessage(field: ParamField, raw: string): string | null {
  const text = raw.trim();
  // Empty is the explicit way to omit an optional keyed token (and is also
  // how the existing single-value editor clears a field). The encoder decides
  // whether an omitted value gets a model fallback; validation must not turn a
  // half-typed or intentionally blank draft into a document mutation.
  if (!text) return null;
  const syntaxMessage = field.validate?.(text);
  if (syntaxMessage) return syntaxMessage;
  if (field.kind === "choice") {
    return field.choices?.some((choice) => choice.value.toLowerCase() === text.toLowerCase())
      ? null
      : `Choose ${field.choices?.map((choice) => choice.label).join(", ") || "a listed option"}.`;
  }
  if (field.kind !== "number") return null;
  let numeric: number;
  try {
    numeric = parseQuantity(text, field.unit);
  } catch {
    return `Enter a finite ${field.unit || "number"}.`;
  }
  if (!Number.isFinite(numeric)) return `Enter a finite ${field.unit || "number"}.`;
  if (field.integer && !Number.isInteger(numeric)) return "Enter a whole number.";
  if (field.min !== undefined && numeric < field.min) return `Enter a value at or above ${field.min}.`;
  if (field.max !== undefined && numeric > field.max) return `Enter a value at or below ${field.max}.`;
  return null;
}

/** Cross-field checks for schemas whose fields constrain one another. */
export function paramValuesValidationMessage(
  kind: ComponentKind,
  values: Record<string, string>,
): string | null {
  const fields = specForValues(kind, values)?.fields ?? [];
  for (const field of fields) {
    const message = paramValidationMessage(field, values[field.key] ?? "");
    if (message) return `${field.label}: ${message}`;
  }
  if (kind === "opamp") {
    let min = Number.NaN;
    let max = Number.NaN;
    try {
      min = parseQuantity(values.vmin ?? "", "V");
      max = parseQuantity(values.vmax ?? "", "V");
    } catch {
      // The per-field validator reports the malformed value below; there is no
      // useful cross-field message until both rails are numeric.
    }
    if (Number.isFinite(min) && Number.isFinite(max) && min >= max) {
      return "Minimum output must be below maximum output.";
    }
  }
  return null;
}

/** What this field set's part does, or "" when the fields speak for themselves. */
export function paramSummary(kind: ComponentKind, value = ""): string {
  return specForValue(kind, value)?.summary ?? "";
}

/** Whether this field constrains the number it holds. */
export function isBoundedParamField(field: ParamField): boolean {
  return field.min !== undefined || field.max !== undefined;
}

/**
 * The allowed range, written for the panel.
 *
 * The bound belongs on screen next to the number it governs. Discovering it by
 * having a keystroke rejected - or, worse, by not having it rejected and
 * finding out later that the drawing and the file disagree - is not a way to
 * learn what a field accepts. Mirrors `OutputPointsControl`, which states its
 * own range the same way.
 */
/**
 * A bound spelled the way the value beside it is spelled.
 *
 * Printing the raw number is fine up to a point and absurd past it: the
 * generic op-amp's gain ceiling rendered as `1–1000000000000`, which is wider
 * than the column it shares with the number it governs. Anything a reader
 * would say out loud with an SI prefix gets one, so a bound stays a glance.
 */
const rangeNumber = (value: number): string => {
  if (!Number.isFinite(value)) return String(value);
  if (Math.abs(value) < 1000) return String(value);
  return formatEngineering(value).replace(/\s+/g, "");
};

export function paramRangeLabel(field: ParamField): string {
  const { min, max } = field;
  if (min !== undefined && max !== undefined) {
    // A symmetric bound reads as one fact, not two: the op-amp's output rails
    // are "±1k", not "-1k–1k", which an en dash makes actively hard to parse.
    if (max > 0 && min === -max) return `±${rangeNumber(max)}`;
    return `${rangeNumber(min)}–${rangeNumber(max)}`;
  }
  if (min !== undefined) return `≥ ${rangeNumber(min)}`;
  if (max !== undefined) return `≤ ${rangeNumber(max)}`;
  return "";
}

/**
 * Fold a committed value into the field's declared range.
 *
 * Clamping, not refusing. Every intermediate state of a typed number is out of
 * range - select `2` in a 2..5 field and type `21` and the field passes through
 * `21` - so rejecting per keystroke makes the box uneditable, which is the
 * mistake `OutputPointsControl` was written to undo. Callers hold a draft and
 * commit once, on Enter or blur; this is what runs at that moment.
 *
 * Three things are deliberately left alone:
 *
 * - **An empty box.** That means "leave it to the model default", which the
 *   keyed grammar spells by omitting the token. Clamping it to `min` would
 *   invent a value the user did not type.
 * - **Anything that is not a number.** An expression or a parameter reference
 *   is something this function has no opinion about, and guessing one would be
 *   worse than passing it through.
 * - **A value already inside the range.** Its spelling survives: `1k` stays
 *   `1k` rather than being rewritten to `1000`.
 */
export function clampParamValue(field: ParamField, raw: string): string {
  if (!isBoundedParamField(field) && !field.integer) return raw;
  const text = raw.trim();
  if (!text) return raw;
  let numeric: number;
  try {
    numeric = parseQuantity(text, field.unit);
  } catch {
    return raw;
  }
  if (!Number.isFinite(numeric)) return raw;
  let bounded = field.integer ? Math.round(numeric) : numeric;
  if (field.min !== undefined) bounded = Math.max(field.min, bounded);
  if (field.max !== undefined) bounded = Math.min(field.max, bounded);
  return bounded === numeric ? raw : String(bounded);
}

/**
 * The field as the PANEL sees it: bounds and unit already converted into the
 * display unit, so the one `clampParamValue` still enforces the one range.
 *
 * A field without a display unit is returned unchanged, which is what lets the
 * editor call this unconditionally instead of branching on the wiper.
 */
export function displayParamField(field: ParamField): ParamField {
  const display = field.display;
  if (!display) return field;
  return {
    ...field,
    unit: display.unit,
    min: field.min === undefined ? undefined : field.min * display.scale,
    max: field.max === undefined ? undefined : field.max * display.scale,
  };
}

/** Trim the float dust a scale multiply leaves behind (0.7 * 100 = 70.00000000000001). */
const tidy = (value: number): string => String(Number(value.toPrecision(12)));

/**
 * A stored value in the unit the panel shows it in.
 *
 * Anything that is not a plain number - an empty box, an expression, a
 * parameter reference - passes through untouched, for the same reason
 * {@link clampParamValue} leaves it alone: scaling something this function
 * cannot read would invent a value the author did not write.
 */
export function toDisplayParamValue(field: ParamField, stored: string): string {
  const display = field.display;
  if (!display || !stored.trim()) return stored;
  let numeric: number;
  try {
    numeric = parseQuantity(stored, field.unit);
  } catch {
    return stored;
  }
  if (!Number.isFinite(numeric)) return stored;
  return tidy(numeric * display.scale);
}

/** The inverse: a number the reader typed, back in the unit the deck stores. */
export function fromDisplayParamValue(field: ParamField, shown: string): string {
  const display = field.display;
  if (!display || !shown.trim()) return shown;
  let numeric: number;
  try {
    numeric = parseQuantity(shown, display.unit);
  } catch {
    return shown;
  }
  if (!Number.isFinite(numeric)) return shown;
  return tidy(numeric / display.scale);
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

/** Apply a color's typical/default Vf without overwriting an explicit Vfwd. */
export function applyLedColorDefault(
  kind: ComponentKind,
  baseValue: string,
  values: Record<string, string>,
  key: string,
  nextValue: string,
): Record<string, string> {
  const next = { ...values, [key]: nextValue };
  if (kind !== "led") return next;
  if (key === "color") {
    next[LED_COLOR_EXPLICIT_KEY] = "true";
    if (!ledHasExplicitForwardVoltage(baseValue) && values[LED_VFWD_EXPLICIT_KEY] !== "true") {
      next.vfwd = String(ledTypicalForwardVolts(nextValue));
      next[LED_VFWD_EXPLICIT_KEY] = "false";
    }
  } else if (key === "vfwd") {
    next[LED_VFWD_EXPLICIT_KEY] = "true";
  }
  return next;
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
