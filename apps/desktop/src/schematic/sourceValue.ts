export type IndependentSourceUnit = "V" | "A";
export type IndependentSourceMode = "dc" | "sine" | "pulse" | "pwl" | "exp" | "sffm";
/** Import-only spellings which predate the unified source editor. */
export type IndependentSourceLegacyKind = "vac" | "iac" | "vpulse";

export interface PwlPointValue {
  time: string;
  level: string;
}

export interface IndependentSourceValue {
  unit: IndependentSourceUnit;
  mode: IndependentSourceMode;
  dcBias: string;
  dcExplicit: boolean;
  acMagnitude: string;
  acPhase: string;
  modifiers: string;
  parameters: Record<string, string>;
  pwlPoints: PwlPointValue[];
  /** Present only while an untouched legacy source can still round-trip its
   * compact LTspice token form. Switching waveform mode clears it. */
  legacyKind?: IndependentSourceLegacyKind;
}

const AC_TEXT_RE = /\bAC\b\s+([^\s,;]+)(?:\s+([+-]?\d[\w.+-]*))?/i;
const FUNCTION_RE = /^(SINE|SIN|PULSE|PWL|EXP|SFFM)\s*\(([^)]*)\)\s*(.*)$/i;
const MODE_BY_FUNCTION: Record<string, IndependentSourceMode> = {
  SINE: "sine",
  SIN: "sine",
  PULSE: "pulse",
  PWL: "pwl",
  EXP: "exp",
  SFFM: "sffm",
};

const splitArgs = (text: string): string[] => text.trim().split(/[\s,]+/).filter(Boolean);

function sourceDefaults(
  mode: IndependentSourceMode,
  unit: IndependentSourceUnit,
  bias = "0",
): IndependentSourceValue {
  const common = {
    unit,
    mode,
    dcBias: bias || "0",
    dcExplicit: false,
    acMagnitude: "",
    acPhase: "",
    modifiers: "",
    pwlPoints: [] as PwlPointValue[],
  };
  switch (mode) {
    case "dc":
      return { ...common, parameters: {} };
    case "sine":
      return {
        ...common,
        parameters: {
          offset: bias || "0",
          amplitude: "1",
          frequency: "1k",
          delay: "0",
          damping: "0",
          phase: "0",
          cycles: "",
        },
      };
    case "pulse":
      return {
        ...common,
        parameters: {
          low: bias || "0",
          high: "5",
          delay: "0",
          rise: "1n",
          fall: "1n",
          width: "5u",
          period: "10u",
          cycles: "",
        },
      };
    case "pwl":
      return {
        ...common,
        parameters: {},
        pwlPoints: [
          { time: "0", level: bias || "0" },
          { time: "1m", level: bias || "0" },
        ],
      };
    case "exp":
      return {
        ...common,
        parameters: {
          initial: bias || "0",
          pulsed: "1",
          riseDelay: "0",
          riseTau: "1u",
          fallDelay: "1m",
          fallTau: "1u",
        },
      };
    case "sffm":
      return {
        ...common,
        parameters: {
          offset: bias || "0",
          amplitude: "1",
          carrierFrequency: "1k",
          modulationIndex: "1",
          signalFrequency: "100",
        },
      };
  }
}

function inferredBias(source: IndependentSourceValue): string {
  switch (source.mode) {
    case "dc": return source.dcBias;
    case "sine": return source.parameters.offset || "0";
    case "pulse": return source.parameters.low || "0";
    case "pwl": return source.pwlPoints[0]?.level || "0";
    case "exp": return source.parameters.initial || "0";
    case "sffm": return source.parameters.offset || "0";
  }
}

function withCommon(
  source: IndependentSourceValue,
  common: Pick<IndependentSourceValue, "dcBias" | "dcExplicit" | "acMagnitude" | "acPhase" | "modifiers">,
): IndependentSourceValue {
  return { ...source, ...common };
}

/**
 * Decode the one-string SPICE storage form into the controls shown by Tau.
 * Merely rendering these controls never writes the canonicalized form back, so
 * an untouched imported LTspice Value/Value2 remains byte-for-byte unchanged.
 */
export function decodeIndependentSourceValue(
  rawValue: string,
  unit: IndependentSourceUnit,
  legacyKind?: IndependentSourceLegacyKind,
): IndependentSourceValue {
  const raw = rawValue.trim();
  const acMatch = AC_TEXT_RE.exec(raw);
  const acMagnitude = acMatch?.[1] ?? "";
  const acPhase = acMatch?.[2] ?? "";
  let remaining = raw.replace(AC_TEXT_RE, " ").replace(/\s+/g, " ").trim();

  let dcExplicit = false;
  let explicitBias = "";
  const dcMatch = /^DC\s+([^\s,;]+)\s*/i.exec(remaining);
  if (dcMatch) {
    dcExplicit = true;
    explicitBias = dcMatch[1];
    remaining = remaining.slice(dcMatch[0].length).trim();
  }

  // `vac`, `iac`, and `vpulse` are old storage kinds, not different source
  // semantics. Decode their compact positional values into the same waveform
  // controls as a unified source, but retain the kind privately so an
  // untouched edit still writes the original LTspice spelling. No migration is
  // performed at import or render time.
  if (legacyKind && !FUNCTION_RE.test(remaining)) {
    const tokens = remaining.split(/\s+/).filter(Boolean);
    if (legacyKind === "vac" || legacyKind === "iac") {
      const offset = tokens.length >= 3 ? tokens[0] ?? "0" : "0";
      const amplitude = tokens.length >= 3 ? tokens[1] ?? "1" : tokens[0] ?? "1";
      const frequency = tokens.length >= 3 ? tokens[2] ?? "1k" : tokens[1] ?? "1k";
      const source = sourceDefaults("sine", unit, offset);
      source.parameters = {
        ...source.parameters,
        offset,
        amplitude,
        frequency,
      };
      source.dcBias = offset;
      source.dcExplicit = dcExplicit;
      source.acMagnitude = acMagnitude;
      source.acPhase = acPhase;
      source.modifiers = tokens.length > 3 ? tokens.slice(3).join(" ") : "";
      source.legacyKind = legacyKind;
      return source;
    }
    const source = sourceDefaults("pulse", unit, tokens[0] ?? "0");
    source.parameters = {
      low: tokens[0] ?? "0",
      high: tokens[1] ?? "5",
      frequency: tokens[2] ?? "100k",
      duty: tokens[3] ?? "0.5",
    };
    source.dcBias = source.parameters.low;
    source.dcExplicit = dcExplicit;
    source.acMagnitude = acMagnitude;
    source.acPhase = acPhase;
    source.modifiers = tokens.length > 4 ? tokens.slice(4).join(" ") : "";
    source.legacyKind = legacyKind;
    return source;
  }

  const functionMatch = FUNCTION_RE.exec(remaining);
  if (!functionMatch) {
    const tokens = remaining.split(/\s+/).filter(Boolean);
    const value = explicitBias || tokens.shift() || "0";
    return withCommon(sourceDefaults("dc", unit, value), {
      dcBias: value,
      dcExplicit,
      acMagnitude,
      acPhase,
      modifiers: tokens.join(" "),
    });
  }

  const mode = MODE_BY_FUNCTION[functionMatch[1].toUpperCase()] ?? "dc";
  const args = splitArgs(functionMatch[2]);
  let source = sourceDefaults(mode, unit);
  source.modifiers = functionMatch[3].trim();
  source.acMagnitude = acMagnitude;
  source.acPhase = acPhase;
  source.dcExplicit = dcExplicit;

  switch (mode) {
    case "sine":
      source.parameters = {
        offset: args[0] ?? "0",
        amplitude: args[1] ?? "1",
        frequency: args[2] ?? "1k",
        delay: args[3] ?? "0",
        damping: args[4] ?? "0",
        phase: args[5] ?? "0",
        cycles: args[6] ?? "",
      };
      break;
    case "pulse":
      source.parameters = {
        low: args[0] ?? "0",
        high: args[1] ?? "5",
        delay: args[2] ?? "0",
        rise: args[3] ?? "1n",
        fall: args[4] ?? "1n",
        width: args[5] ?? "5u",
        period: args[6] ?? "10u",
        cycles: args[7] ?? "",
      };
      break;
    case "pwl": {
      const points: PwlPointValue[] = [];
      for (let index = 0; index < args.length; index += 2) {
        points.push({ time: args[index] ?? "0", level: args[index + 1] ?? "0" });
      }
      source.pwlPoints = points.length > 0 ? points : [{ time: "0", level: "0" }];
      break;
    }
    case "exp":
      source.parameters = {
        initial: args[0] ?? "0",
        pulsed: args[1] ?? "1",
        riseDelay: args[2] ?? "0",
        riseTau: args[3] ?? "1u",
        fallDelay: args[4] ?? "1m",
        fallTau: args[5] ?? "1u",
      };
      break;
    case "sffm":
      source.parameters = {
        offset: args[0] ?? "0",
        amplitude: args[1] ?? "1",
        carrierFrequency: args[2] ?? "1k",
        modulationIndex: args[3] ?? "1",
        signalFrequency: args[4] ?? "100",
      };
      break;
    case "dc":
      break;
  }

  source.dcBias = explicitBias || inferredBias(source);
  return source;
}

function trimOptionalZeros(values: string[], required: number): string[] {
  const out = [...values];
  while (out.length > required && (out[out.length - 1] === "" || out[out.length - 1] === "0")) out.pop();
  return out;
}

export function encodeIndependentSourceValue(source: IndependentSourceValue): string {
  let transient: string;
  switch (source.mode) {
    case "dc":
      transient = source.dcBias.trim() || "0";
      break;
    case "sine": {
      const p = source.parameters;
      if ((source.legacyKind === "vac" || source.legacyKind === "iac")
        && !p.delay && !p.damping && !p.phase && !p.cycles) {
        const args = [p.offset || "0", p.amplitude || "1", p.frequency || "1k"];
        transient = args[0] === "0" ? args.slice(1).join(" ") : args.join(" ");
      } else {
        const args = trimOptionalZeros([
          p.offset || "0", p.amplitude || "1", p.frequency || "1k", p.delay || "0",
          p.damping || "0", p.phase || "0", p.cycles || "",
        ], 3);
        transient = `SINE(${args.join(" ")})`;
      }
      break;
    }
    case "pulse": {
      const p = source.parameters;
      if (source.legacyKind === "vpulse" && p.frequency) {
        transient = [p.low || "0", p.high || "5", p.frequency, p.duty || "0.5"].join(" ");
      } else {
        const args = [
          p.low || "0", p.high || "5", p.delay || "0", p.rise || "1n",
          p.fall || "1n", p.width || "5u", p.period || "10u",
        ];
        if (p.cycles) args.push(p.cycles);
        transient = `PULSE(${args.join(" ")})`;
      }
      break;
    }
    case "pwl": {
      const points = source.pwlPoints.length > 0 ? source.pwlPoints : [{ time: "0", level: "0" }];
      transient = `PWL(${points.flatMap((point) => [point.time || "0", point.level || "0"]).join(" ")})`;
      break;
    }
    case "exp": {
      const p = source.parameters;
      transient = `EXP(${[
        p.initial || "0", p.pulsed || "1", p.riseDelay || "0", p.riseTau || "1u",
        p.fallDelay || "1m", p.fallTau || "1u",
      ].join(" ")})`;
      break;
    }
    case "sffm": {
      const p = source.parameters;
      transient = `SFFM(${[
        p.offset || "0", p.amplitude || "1", p.carrierFrequency || "1k",
        p.modulationIndex || "1", p.signalFrequency || "100",
      ].join(" ")})`;
      break;
    }
  }

  const bias = source.dcBias.trim() || "0";
  if (source.mode !== "dc" && (source.dcExplicit || bias !== inferredBias(source).trim())) {
    transient = `DC ${bias} ${transient}`;
  }
  const ac = source.acMagnitude.trim()
    ? ` AC ${source.acMagnitude.trim()}${source.acPhase.trim() ? ` ${source.acPhase.trim()}` : ""}`
    : "";
  const modifiers = source.modifiers.trim() ? ` ${source.modifiers.trim()}` : "";
  return `${transient}${ac}${modifiers}`.trim();
}

export function updateIndependentSourceField(
  source: IndependentSourceValue,
  key: string,
  value: string,
): IndependentSourceValue {
  if (key === "dcBias") return { ...source, dcBias: value, dcExplicit: true };
  if (key === "acMagnitude") return { ...source, acMagnitude: value };
  if (key === "acPhase") return { ...source, acPhase: value };
  const parameters = { ...source.parameters, [key]: value };
  const next = { ...source, parameters };
  const initialKey = source.mode === "sine" || source.mode === "sffm"
    ? "offset"
    : source.mode === "pulse"
      ? "low"
      : source.mode === "exp"
        ? "initial"
        : "";
  return key === initialKey && !source.dcExplicit ? { ...next, dcBias: value } : next;
}

export function changeIndependentSourceMode(
  source: IndependentSourceValue,
  mode: IndependentSourceMode,
): IndependentSourceValue {
  return withCommon(sourceDefaults(mode, source.unit, source.dcBias), {
    dcBias: source.dcBias,
    dcExplicit: false,
    acMagnitude: source.acMagnitude,
    acPhase: source.acPhase,
    modifiers: source.modifiers,
  });
}

export function updatePwlPoint(
  source: IndependentSourceValue,
  index: number,
  key: keyof PwlPointValue,
  value: string,
): IndependentSourceValue {
  const pwlPoints = source.pwlPoints.map((point, pointIndex) =>
    pointIndex === index ? { ...point, [key]: value } : point,
  );
  const next = { ...source, pwlPoints };
  return index === 0 && key === "level" && !source.dcExplicit ? { ...next, dcBias: value } : next;
}

export function addPwlPoint(source: IndependentSourceValue): IndependentSourceValue {
  const last = source.pwlPoints[source.pwlPoints.length - 1] ?? { time: "0", level: source.dcBias || "0" };
  return { ...source, pwlPoints: [...source.pwlPoints, { ...last }] };
}

export function removePwlPoint(source: IndependentSourceValue, index: number): IndependentSourceValue {
  if (source.pwlPoints.length <= 1) return source;
  const pwlPoints = source.pwlPoints.filter((_, pointIndex) => pointIndex !== index);
  const next = { ...source, pwlPoints };
  return index === 0 && !source.dcExplicit ? { ...next, dcBias: pwlPoints[0]?.level || "0" } : next;
}
