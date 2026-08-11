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
  onBeginChange: () => void;
  onValueChange: (value: string) => void;
}

function SourceField({ label, value, unit = "", onBeginChange, onValueChange }: SourceFieldProps) {
  return (
    <label className="property-field">
      <span title={label}>{label}</span>
      {unit ? (
        <EngineeringInput
          label={label}
          value={value}
          unit={unit}
          onBeginChange={onBeginChange}
          onValueChange={onValueChange}
        />
      ) : (
        <input
          className="mono-num"
          aria-label={label}
          value={value}
          // Same treatment as the rest of the panel: an unset optional field
          // reads "none" rather than as an empty box that says nothing.
          placeholder="none"
          spellCheck={false}
          onChange={(event) => onValueChange(event.currentTarget.value)}
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
            onBeginChange={() => onBeginChange("acMagnitude")}
            onValueChange={(nextValue) => update("acMagnitude", nextValue)}
          />
          <SourceField
            label="AC phase (°)"
            value={source.acPhase}
            onBeginChange={() => onBeginChange("acPhase")}
            onValueChange={(nextValue) => update("acPhase", nextValue)}
          />
        </>
      )}
    </div>
  );
}
