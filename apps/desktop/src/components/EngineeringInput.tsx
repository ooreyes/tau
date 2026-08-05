import { useEffect, useRef, useState, type FocusEvent } from "react";
import {
  ENGINEERING_PREFIXES,
  compactEngineeringMantissa,
  composeEngineeringValue,
  isEngineeringMantissa,
  isEngineeringMantissaDraft,
  splitEngineeringValue,
} from "../schematic/engineering";
import { parseQuantity } from "../simulation/quantity";

interface EngineeringInputProps {
  value: string;
  unit: string;
  label: string;
  onValueChange: (value: string) => void;
  onBeginChange?: () => void;
  min?: number;
  max?: number;
  minExclusive?: boolean;
  /**
   * Optional command fields (e.g. scope "At value") may sit empty at rest.
   * When true, an empty mantissa is not marked invalid — incomplete drafts
   * like `1e` still are, and empty still never commits.
   */
  allowEmpty?: boolean;
}

/** Numeric mantissa plus explicit SI-prefix picker for SPICE-like values. */
export function EngineeringInput({
  value,
  unit,
  label,
  onValueChange,
  onBeginChange,
  min,
  max,
  minExclusive = false,
  allowEmpty = false,
}: EngineeringInputProps) {
  const [parts, setParts] = useState(() => splitEngineeringValue(value, unit));
  const focused = useRef(false);
  const changeStarted = useRef(false);
  const validParts = (candidate: typeof parts) => {
    if (!isEngineeringMantissa(candidate.mantissa)) return false;
    let numeric: number;
    try {
      numeric = parseQuantity(composeEngineeringValue(candidate.mantissa, candidate.prefix), unit);
    } catch {
      return false;
    }
    if (!Number.isFinite(numeric)) return false;
    if (min !== undefined && (minExclusive ? numeric <= min : numeric < min)) return false;
    if (max !== undefined && numeric > max) return false;
    return true;
  };
  const emptyAllowed = allowEmpty && parts.mantissa.trim() === "";
  const valid = emptyAllowed || validParts(parts);
  // `field-sizing: content` is not reliable in the macOS WebView. Give WebKit
  // an explicit character width so the complete mantissa remains visible.
  const inputSize = Math.max(2, Math.min(14, parts.mantissa.length + 1));

  useEffect(() => {
    if (!focused.current) setParts(splitEngineeringValue(value, unit));
  }, [value, unit]);

  const commit = (next: typeof parts) => {
    if (!validParts(next)) return;
    if (!changeStarted.current) {
      onBeginChange?.();
      changeStarted.current = true;
    }
    onValueChange(composeEngineeringValue(next.mantissa, next.prefix));
  };

  const onFocus = () => {
    if (focused.current) return;
    focused.current = true;
    changeStarted.current = false;
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    focused.current = false;
    changeStarted.current = false;
    if (!validParts(parts)) {
      setParts(splitEngineeringValue(value, unit));
      return;
    }
    setParts((current) => ({
      ...current,
      mantissa: compactEngineeringMantissa(current.mantissa),
    }));
  };

  return (
    <div className="eng-input" onFocus={onFocus} onBlur={onBlur}>
      <input
        className="mono-num"
        aria-label={label}
        value={parts.mantissa}
        size={inputSize}
        style={{ width: `${inputSize}ch` }}
        inputMode="decimal"
        spellCheck={false}
        aria-invalid={!valid}
        onChange={(event) => {
          if (!isEngineeringMantissaDraft(event.currentTarget.value)) return;
          const next = { ...parts, mantissa: event.currentTarget.value };
          setParts(next);
          commit(next);
        }}
      />
      {unit && (
        <select
          aria-label={`${label} SI prefix`}
          value={parts.prefix}
          onChange={(event) => {
            const next = { ...parts, prefix: event.currentTarget.value as typeof parts.prefix };
            setParts(next);
            commit(next);
          }}
        >
          {ENGINEERING_PREFIXES.map((prefix) => (
            <option key={prefix.value || "base"} value={prefix.value}>
              {prefix.label ? `${prefix.label}${unit}` : unit}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
