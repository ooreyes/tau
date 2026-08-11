import { useEffect, useId, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addPwlPoint,
  changeIndependentSourceMode,
  decodeIndependentSourceValue,
  encodeIndependentSourceValue,
  removePwlPoint,
  updateIndependentSourceField,
  updatePwlPoint,
  type IndependentSourceMode,
  type IndependentSourceLegacyKind,
  type IndependentSourceUnit,
  type IndependentSourceValue,
} from "../schematic/sourceValue";
import { EngineeringInput } from "./EngineeringInput";
import { parseQuantity } from "../simulation/quantity";

const WAVEFORM_MODES: readonly { value: IndependentSourceMode; label: string }[] = [
  { value: "dc", label: "DC" },
  { value: "sine", label: "Sine" },
  { value: "pulse", label: "Pulse" },
  { value: "pwl", label: "Piecewise linear" },
  { value: "exp", label: "Exponential" },
  { value: "sffm", label: "Single-frequency FM" },
];

interface SourceFieldProps {
  label: string;
  value: string;
  unit?: string;
  fieldKey?: string;
  onBeginChange: () => void;
  onValueChange: (value: string) => void;
}

interface SourceFieldConstraint {
  min?: number;
  minExclusive?: boolean;
  max?: number;
  allowEmpty?: boolean;
}

const SOURCE_FIELD_CONSTRAINTS: Record<string, SourceFieldConstraint> = {
  // A zero delay is meaningful, but a period, edge, time constant, or
  // frequency of zero cannot describe a runnable waveform.
  frequency: { min: 0, minExclusive: true },
  carrierFrequency: { min: 0, minExclusive: true },
  signalFrequency: { min: 0, minExclusive: true },
  rise: { min: 0, minExclusive: true },
  fall: { min: 0, minExclusive: true },
  width: { min: 0, minExclusive: true },
  period: { min: 0, minExclusive: true },
  riseTau: { min: 0, minExclusive: true },
  fallTau: { min: 0, minExclusive: true },
  delay: { min: 0 },
  riseDelay: { min: 0 },
  fallDelay: { min: 0 },
  duty: { min: 0, max: 1 },
  cycles: { min: 0, minExclusive: true, allowEmpty: true },
  acPhase: { allowEmpty: true },
  "pwl-time": { min: 0 },
};

function sourceFieldConstraint(fieldKey?: string): SourceFieldConstraint {
  return fieldKey ? SOURCE_FIELD_CONSTRAINTS[fieldKey] ?? {} : {};
}

function sourceFieldValidationMessage(fieldKey: string, raw: string): string | null {
  const constraint = sourceFieldConstraint(fieldKey);
  const text = raw.trim();
  if (!text) return constraint.allowEmpty ? null : "Enter a finite number.";
  let numeric: number;
  try {
    numeric = parseQuantity(text, "");
  } catch {
    return "Enter a finite number.";
  }
  if (!Number.isFinite(numeric)) return "Enter a finite number.";
  if (constraint.min !== undefined && (constraint.minExclusive ? numeric <= constraint.min : numeric < constraint.min)) {
    return `Enter a value ${constraint.minExclusive ? "above" : "at or above"} ${constraint.min}.`;
  }
  if (constraint.max !== undefined && numeric > constraint.max) {
    return `Enter a value at or below ${constraint.max}.`;
  }
  return null;
}

function UnitlessSourceField({
  fieldKey,
  label,
  value,
  onValueChange,
}: Pick<SourceFieldProps, "fieldKey" | "label" | "value" | "onValueChange">) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const errorId = useId();
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  const validationKey = fieldKey ?? label;
  const error = sourceFieldValidationMessage(validationKey, draft);
  return (
    <>
      <input
        className="mono-num"
        aria-label={label}
        value={draft}
        // Keep incomplete/invalid text visible locally. Only a finite,
        // in-range value is allowed to reach the schematic through the parent.
        placeholder="none"
        spellCheck={false}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; }}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setDraft(next);
          if (!sourceFieldValidationMessage(validationKey, next)) onValueChange(next);
        }}
      />
      {error && <span id={errorId} className="property-validation-error" role="alert">{error}</span>}
    </>
  );
}

function SourceField({ label, value, unit = "", fieldKey, onBeginChange, onValueChange }: SourceFieldProps) {
  const constraint = sourceFieldConstraint(fieldKey);
  return (
    <label className="property-field">
      <span title={label}>{label}</span>
      {unit ? (
        <EngineeringInput
          label={label}
          value={value}
          unit={unit}
          min={constraint.min}
          minExclusive={constraint.minExclusive}
          max={constraint.max}
          allowEmpty={constraint.allowEmpty}
          onBeginChange={onBeginChange}
          onValueChange={onValueChange}
        />
      ) : (
        <UnitlessSourceField
          fieldKey={fieldKey}
          label={label}
          value={value}
          onValueChange={onValueChange}
        />
      )}
    </label>
  );
}

export function IndependentSourceEditor({
  value,
  unit,
  legacyKind,
  onBeginChange,
  onValueChange,
}: {
  value: string;
  unit: IndependentSourceUnit;
  legacyKind?: IndependentSourceLegacyKind;
  onBeginChange: (key: string) => void;
  onValueChange: (value: string) => void;
}) {
  const source = decodeIndependentSourceValue(value, unit, legacyKind);
  const commit = (key: string, next: IndependentSourceValue) => {
    onBeginChange(key);
    onValueChange(encodeIndependentSourceValue(next));
  };
  const update = (key: string, nextValue: string) =>
    commit(key, updateIndependentSourceField(source, key, nextValue));
  const parameter = (key: string, label: string, fieldUnit = "") => (
    <SourceField
      key={key}
      label={label}
      value={source.parameters[key] ?? ""}
      unit={fieldUnit}
      fieldKey={key}
      onBeginChange={() => onBeginChange(key)}
      onValueChange={(nextValue) => update(key, nextValue)}
    />
  );

  return (
    <div className="source-value-editor">
      <label className="property-field">
        <span>Waveform</span>
        <Select
          value={source.mode}
          onValueChange={(next) => commit(
            "mode",
            changeIndependentSourceMode(source, next as IndependentSourceMode),
          )}
        >
          <SelectTrigger
            size="sm"
            className="property-select mono-num w-full max-w-[168px]"
            aria-label="Waveform type"
          >
            <SelectValue placeholder="Waveform" />
          </SelectTrigger>
          <SelectContent>
            {WAVEFORM_MODES.map((mode) => (
              <SelectItem key={mode.value} value={mode.value}>
                {mode.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <SourceField
        label="DC operating point"
        value={source.dcBias}
        unit={unit}
        fieldKey="dcBias"
        onBeginChange={() => onBeginChange("dcBias")}
        onValueChange={(nextValue) => update("dcBias", nextValue)}
      />

      {source.mode === "sine" && (
        <>
          {parameter("offset", "Offset", unit)}
          {parameter("amplitude", "Amplitude", unit)}
          {parameter("frequency", "Frequency", "Hz")}
          {parameter("delay", "Start delay", "s")}
          {parameter("damping", "Damping", "Hz")}
          {parameter("phase", "Phase", "°")}
          {parameter("cycles", "Cycles")}
        </>
      )}

      {source.mode === "pulse" && (
        source.legacyKind === "vpulse" ? (
          <>
            {parameter("low", "Low level", unit)}
            {parameter("high", "High level", unit)}
            {parameter("frequency", "Frequency", "Hz")}
            {parameter("duty", "Duty (0–1)")}
          </>
        ) : (
          <>
            {parameter("low", "Low level", unit)}
            {parameter("high", "High level", unit)}
            {parameter("delay", "Start delay", "s")}
            {parameter("rise", "Rise time", "s")}
            {parameter("fall", "Fall time", "s")}
            {parameter("width", "On time", "s")}
            {parameter("period", "Period", "s")}
            {parameter("cycles", "Cycles")}
          </>
        )
      )}

      {source.mode === "pwl" && (
        <fieldset className="source-pwl-editor">
          <legend>Time / level points</legend>
          {source.pwlPoints.map((point, index) => (
            <div className="source-pwl-row" key={`${index}-${source.pwlPoints.length}`}>
              <EngineeringInput
                label={`PWL time ${index + 1}`}
                value={point.time}
                unit="s"
                min={0}
                onBeginChange={() => onBeginChange(`pwl-time-${index}`)}
                onValueChange={(nextValue) => commit(
                  `pwl-time-${index}`,
                  updatePwlPoint(source, index, "time", nextValue),
                )}
              />
              <EngineeringInput
                label={`PWL level ${index + 1}`}
                value={point.level}
                unit={unit}
                onBeginChange={() => onBeginChange(`pwl-level-${index}`)}
                onValueChange={(nextValue) => commit(
                  `pwl-level-${index}`,
                  updatePwlPoint(source, index, "level", nextValue),
                )}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove PWL point ${index + 1}`}
                disabled={source.pwlPoints.length <= 1}
                onClick={() => commit(`pwl-remove-${index}`, removePwlPoint(source, index))}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="source-pwl-add"
            onClick={() => commit("pwl-add", addPwlPoint(source))}
          >
            <Plus aria-hidden="true" />
            Add point
          </Button>
        </fieldset>
      )}

      {source.mode === "exp" && (
        <>
          {parameter("initial", "Initial level", unit)}
          {parameter("pulsed", "Pulsed level", unit)}
          {parameter("riseDelay", "Rise delay", "s")}
          {parameter("riseTau", "Rise time constant", "s")}
          {parameter("fallDelay", "Fall delay", "s")}
          {parameter("fallTau", "Fall time constant", "s")}
        </>
      )}

      {source.mode === "sffm" && (
        <>
          {parameter("offset", "Offset", unit)}
          {parameter("amplitude", "Amplitude", unit)}
          {parameter("carrierFrequency", "Carrier frequency", "Hz")}
          {parameter("modulationIndex", "Modulation index")}
          {parameter("signalFrequency", "Signal frequency", "Hz")}
        </>
      )}

      <label className="property-field source-ac-toggle">
        <span title="Small-signal AC magnitude for .ac analysis (LTspice Vac on a DC source). For a large-signal sine, place AC Voltage from the palette.">
          Small-signal AC (.ac)
        </span>
        <input
          type="checkbox"
          aria-label="Enable small-signal AC stimulus for .ac analysis"
          checked={Boolean(source.acMagnitude)}
          onChange={(event) => commit(
            "ac-enabled",
            {
              ...source,
              acMagnitude: event.currentTarget.checked ? (source.acMagnitude || "1") : "",
              acPhase: event.currentTarget.checked ? source.acPhase : "",
            },
          )}
        />
      </label>
      {source.acMagnitude && (
        <>
          <SourceField
            label="AC amplitude (.ac)"
            value={source.acMagnitude}
            unit={unit}
            fieldKey="acMagnitude"
            onBeginChange={() => onBeginChange("acMagnitude")}
            onValueChange={(nextValue) => update("acMagnitude", nextValue)}
          />
          <SourceField
            label="AC phase (°)"
            value={source.acPhase}
            fieldKey="acPhase"
            onBeginChange={() => onBeginChange("acPhase")}
            onValueChange={(nextValue) => update("acPhase", nextValue)}
          />
        </>
      )}
    </div>
  );
}
