import { parseQuantity } from "../simulation/quantity";

/** Characteristic impedance + one-way delay of an ideal lossless line. */
export interface TlineSpec {
  /** Characteristic impedance Z0, ohms. */
  z0: number;
  /** One-way transmission delay TD, seconds. */
  td: number;
}

const DEFAULT_Z0 = 50;
const DEFAULT_TD = 1e-9;

/** Stable machine-readable code for a lossless-line value Tau cannot run
 * without replacing an authored electrical parameter with a generic default. */
export const TLINE_PARAMETER_REFUSAL_CODE = "deck.refused.tline.invalid_parameter";

export interface TlineParameterRefusalDiagnostic {
  code: typeof TLINE_PARAMETER_REFUSAL_CODE;
  message: string;
  ref: string;
  parameter: "Z0" | "TD";
  value: string;
  reason: "must be a finite positive SPICE quantity";
}

/** A malformed authored T-line field is not equivalent to an omitted field.
 * Keep the structured detail for callers that surface diagnostics, and do not
 * silently substitute Tau's 50 Ohm / 1 ns placement defaults into an import. */
export class TlineParameterRefusal extends Error {
  readonly diagnostic: Readonly<TlineParameterRefusalDiagnostic>;

  constructor(diagnostic: TlineParameterRefusalDiagnostic) {
    super(diagnostic.message);
    this.name = "TlineParameterRefusal";
    this.diagnostic = Object.freeze(diagnostic);
  }
}

/** The inspector needs a stable display value while a reader is editing an
 * imported part, so this non-throwing parser remains deliberately lenient.
 * Deck construction separately rejects any malformed field that was present. */
function safeQuantity(text: string, unit: string): number {
  try {
    return parseQuantity(text, unit);
  } catch {
    return NaN;
  }
}

/**
 * Parse an LTspice ideal-lossless-transmission-line value into characteristic
 * impedance and one-way delay. LTspice writes the value as `Td=50n Z0=75`,
 * `Z0=150 Td=30n`, etc. - order-independent `key=value` tokens with SI
 * suffixes. This UI/parser surface uses Z0 = 50 Ω and Td = 1 ns for fields
 * that are missing or being edited; {@link tlineDeckParams} rejects invalid
 * *declared* fields before a simulation can substitute those defaults.
 */
export function parseTlineSpec(value: string): TlineSpec {
  const text = (value ?? "").trim();
  const z0Match = /\bz0\s*=\s*(\S+)/i.exec(text);
  // Accept LTspice's `Td=` and the SPICE-spelled `TD=`/`delay=`.
  const tdMatch = /\b(?:td|delay)\s*=\s*(\S+)/i.exec(text);
  const z0 = z0Match ? safeQuantity(z0Match[1], "Ohm") : DEFAULT_Z0;
  const td = tdMatch ? safeQuantity(tdMatch[1], "s") : DEFAULT_TD;
  return {
    z0: Number.isFinite(z0) && z0 > 0 ? z0 : DEFAULT_Z0,
    td: Number.isFinite(td) && td > 0 ? td : DEFAULT_TD,
  };
}

/** ngspice lossless-line params for the device line: `Z0=<ohm> TD=<s>`. */
export function tlineDeckParams(value: string, ref = "T-line"): string {
  const assertDeclaredField = (parameter: "Z0" | "TD", aliases: readonly string[], unit: string) => {
    const pattern = new RegExp(`(?:^|\\s)(?:${aliases.join("|")})\\s*=\\s*(\\S*)`, "ig");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(value ?? "")) !== null) {
      const authored = match[1] ?? "";
      try {
        const parsed = parseQuantity(authored, unit);
        if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("not positive");
      } catch {
        const message = `Simulation refused: ${ref}'s ${parameter} value "${authored}" must be a finite positive SPICE quantity. No approximate or partial circuit was run.`;
        throw new TlineParameterRefusal({
          code: TLINE_PARAMETER_REFUSAL_CODE,
          message,
          ref,
          parameter,
          value: authored,
          reason: "must be a finite positive SPICE quantity",
        });
      }
    }
  };

  // Missing fields deliberately retain Tau's placement defaults. A present
  // malformed field is instead a hard stop: treating `Td=garbage` as 1 ns
  // changes a transmission-line circuit's electrical behavior without notice.
  assertDeclaredField("Z0", ["z0"], "Ohm");
  assertDeclaredField("TD", ["td", "delay"], "s");
  const { z0, td } = parseTlineSpec(value);
  return `Z0=${z0} TD=${td}`;
}
