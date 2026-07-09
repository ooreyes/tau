import { useEffect, useRef, useState, type FocusEvent } from "react";
import {
  ENGINEERING_PREFIXES,
  composeEngineeringValue,
  isEngineeringMantissa,
  splitEngineeringValue,
} from "../schematic/engineering";

interface EngineeringInputProps {
  value: string;
  unit: string;
  label: string;
  onValueChange: (value: string) => void;
  onBeginChange?: () => void;
}

/** Numeric mantissa plus explicit SI-prefix picker for SPICE-like values. */
export function EngineeringInput({ value, unit, label, onValueChange, onBeginChange }: EngineeringInputProps) {
  const [parts, setParts] = useState(() => splitEngineeringValue(value, unit));
  const focused = useRef(false);
  const changeStarted = useRef(false);
  const valid = isEngineeringMantissa(parts.mantissa);
  // Keep the unit tucked against the number; grow as digits are typed.
  const inputSize = Math.max(2, Math.min(14, parts.mantissa.length + 1));

  useEffect(() => {
    if (!focused.current) setParts(splitEngineeringValue(value, unit));
  }, [value, unit]);

  const commit = (next: typeof parts) => {
    if (!isEngineeringMantissa(next.mantissa)) return;
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
    if (!isEngineeringMantissa(parts.mantissa)) setParts(splitEngineeringValue(value, unit));
  };

  return (
    <div className="eng-input" onFocus={onFocus} onBlur={onBlur}>
      <input
        className="mono-num"
        aria-label={label}
        value={parts.mantissa}
        size={inputSize}
        inputMode="decimal"
        spellCheck={false}
        aria-invalid={!valid}
        onChange={(event) => {
          const next = { ...parts, mantissa: event.currentTarget.value };
          setParts(next);
          commit(next);
        }}
      />
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
    </div>
  );
}
