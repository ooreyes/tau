import { parseQuantity } from "../simulation/quantity";

/** Generic indicator-LED choices shared by the schema, renderer, and solvers. */
export const LED_COLOR_SPECS = [
  { value: "red", label: "Red", typicalForwardVolts: 2.0 },
  { value: "amber", label: "Amber / Orange", typicalForwardVolts: 2.1 },
  { value: "yellow", label: "Yellow", typicalForwardVolts: 2.1 },
  { value: "green", label: "Green", typicalForwardVolts: 2.2 },
  { value: "blue", label: "Blue", typicalForwardVolts: 3.0 },
  { value: "white", label: "White", typicalForwardVolts: 3.0 },
  { value: "custom", label: "Custom", typicalForwardVolts: 2.0 },
] as const;

export type LedColor = (typeof LED_COLOR_SPECS)[number]["value"];
export const LED_COLORS = LED_COLOR_SPECS.map((spec) => spec.value) as readonly LedColor[];
export const LED_COLOR_CHOICES = LED_COLOR_SPECS.map(({ value, label }) => ({ value, label }));
export const DEFAULT_LED_FORWARD_VOLTS = LED_COLOR_SPECS[0].typicalForwardVolts;

const colorSpec = (color: LedColor) => LED_COLOR_SPECS.find((spec) => spec.value === color) ?? LED_COLOR_SPECS[0];

/** Normalize stored/UI spellings without changing the canonical serialized token. */
export function normalizeLedColor(raw: string | undefined): LedColor {
  const normalized = (raw ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (normalized === "orange" || normalized === "amber/orange") return "amber";
  return LED_COLORS.includes(normalized as LedColor) ? normalized as LedColor : "red";
}

const isLedColorToken = (raw: string): boolean => {
  const normalized = raw.trim().toLowerCase().replace(/[_-]+/g, " ");
  return normalized === "orange"
    || normalized === "amber/orange"
    || LED_COLORS.includes(normalized as LedColor);
};

/** Read `Color=` plus the compact legacy `LED blue` spelling. */
export function ledColorFromValue(value: string): LedColor {
  const keyed = /(?:^|[\s,;])color\s*=\s*([^\s,;]+)/i.exec(value ?? "")?.[1];
  if (keyed) return normalizeLedColor(keyed);
  const bare = (value ?? "").trim().split(/[\s,;]+/).slice(1)
    .find((token) => !token.includes("=") && isLedColorToken(token));
  return bare ? normalizeLedColor(bare) : "red";
}

/** True when a color was authored in the stored value, rather than inferred. */
export function ledHasExplicitColor(value: string): boolean {
  if (/(?:^|[\s,;])color\s*=\s*[^\s,;]+/i.test(value ?? "")) return true;
  return (value ?? "").trim().split(/[\s,;]+/).slice(1)
    .some((token) => !token.includes("=") && isLedColorToken(token));
}

/** Typical/default forward voltage for a selected color; it is not a limit. */
export function ledTypicalForwardVolts(color: string | undefined): number {
  return colorSpec(normalizeLedColor(color)).typicalForwardVolts;
}

/** True when the stored value contains a user-authored forward-voltage override. */
export function ledHasExplicitForwardVoltage(value: string): boolean {
  return /(?:^|[\s,;])(?:Vfwd|Forward)\s*=\s*[^\s,;]+/i.test(value ?? "");
}

/** Resolve the value used by preview/native generic LED paths. */
export function ledForwardVoltsFromValue(value: string): number {
  const token = /(?:^|[\s,;])(?:Vfwd|Forward)\s*=\s*([^\s,;]+)/i.exec(value ?? "")?.[1];
  if (token) {
    try {
      const parsed = parseQuantity(token);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    } catch {
      // Fall through to the color's typical value.
    }
  }
  return ledTypicalForwardVolts(ledColorFromValue(value));
}
