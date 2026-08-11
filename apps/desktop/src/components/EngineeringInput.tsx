import { useEffect, useId, useRef, useState, type FocusEvent } from "react";
import {
  ENGINEERING_PREFIXES,
  compactEngineeringMantissa,
  composeEngineeringValue,
  isEngineeringMantissa,
  isEngineeringMantissaDraft,
  splitEngineeringValue,
  type EngineeringPrefix,
} from "../schematic/engineering";
import { parseQuantity } from "../simulation/quantity";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface EngineeringInputProps {
  value: string;
  unit: string;
  label: string;
  onValueChange: (value: string) => void;
  onBeginChange?: () => void;
  min?: number;
  max?: number;
  minExclusive?: boolean;
  /** A cross-field error owned by the inspector (for example rail ordering). */
  externalValidationMessage?: string | null;
  /**
   * Optional command fields (e.g. scope "At value") may sit empty at rest.
   * When true, an empty mantissa is not marked invalid — incomplete drafts
   * like `1e` still are, and empty still never commits.
   */
  allowEmpty?: boolean;
}

/** Radix SelectItem forbids value=""; map the base (no-prefix) slot. */
const BASE_PREFIX_VALUE = "__base__";

function prefixSelectValue(prefix: EngineeringPrefix): string {
  return prefix === "" ? BASE_PREFIX_VALUE : prefix;
}

function prefixFromSelectValue(value: string): EngineeringPrefix {
  return (value === BASE_PREFIX_VALUE ? "" : value) as EngineeringPrefix;
}

function prefixOptionLabel(prefix: (typeof ENGINEERING_PREFIXES)[number], unit: string): string {
  return prefix.label ? `${prefix.label}${unit}` : unit;
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
  externalValidationMessage = null,
}: EngineeringInputProps) {
  const [parts, setParts] = useState(() => splitEngineeringValue(value, unit));
  const [prefixOpen, setPrefixOpen] = useState(false);
  const focused = useRef(false);
  const changeStarted = useRef(false);
  const prefixOpenRef = useRef(false);
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
  const errorId = useId();
  const fieldValidationMessage = (() => {
    if (emptyAllowed) return null;
    if (!isEngineeringMantissa(parts.mantissa)) return `Enter a finite ${unit || "number"}.`;
    let numeric: number;
    try {
      numeric = parseQuantity(composeEngineeringValue(parts.mantissa, parts.prefix), unit);
    } catch {
      return `Enter a finite ${unit || "number"}.`;
    }
    if (!Number.isFinite(numeric)) return `Enter a finite ${unit || "number"}.`;
    if (min !== undefined && (minExclusive ? numeric <= min : numeric < min)) {
      return `Enter a value ${minExclusive ? "above" : "at or above"} ${min}.`;
    }
    if (max !== undefined && numeric > max) return `Enter a value at or below ${max}.`;
    return null;
  })();
  const validationMessage = externalValidationMessage ?? fieldValidationMessage;
  const valid = validationMessage === null;
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
    const next = event.relatedTarget as Node | null;
    if (event.currentTarget.contains(next)) return;
    // Radix SelectContent portals outside `.eng-input`; ignore focus moves into it.
    if (next && (next as Element).closest?.('[data-slot="select-content"]')) return;
    if (prefixOpenRef.current) return;
    focused.current = false;
    changeStarted.current = false;
    if (!validParts(parts)) return;
    setParts((current) => ({
      ...current,
      mantissa: compactEngineeringMantissa(current.mantissa),
    }));
  };

  return (
    <>
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
          aria-describedby={validationMessage ? errorId : undefined}
          onChange={(event) => {
            if (!isEngineeringMantissaDraft(event.currentTarget.value)) return;
            const next = { ...parts, mantissa: event.currentTarget.value };
            setParts(next);
            commit(next);
          }}
        />
        {unit && (
          <Select
            value={prefixSelectValue(parts.prefix)}
            open={prefixOpen}
            onOpenChange={(open) => {
              prefixOpenRef.current = open;
              setPrefixOpen(open);
            }}
            onValueChange={(nextValue) => {
              const next = { ...parts, prefix: prefixFromSelectValue(nextValue) };
              setParts(next);
              commit(next);
            }}
          >
            <SelectTrigger
              size="sm"
              className="eng-input-prefix mono-num"
              aria-label={`${label} SI prefix`}
            >
              <SelectValue placeholder={unit} />
            </SelectTrigger>
            <SelectContent>
              {ENGINEERING_PREFIXES.map((prefix) => (
                <SelectItem
                  key={prefix.value || "base"}
                  value={prefixSelectValue(prefix.value)}
                >
                  {prefixOptionLabel(prefix, unit)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {validationMessage && (
        <span id={errorId} className="property-validation-error" role="alert">
          {validationMessage}
        </span>
      )}
    </>
  );
}
