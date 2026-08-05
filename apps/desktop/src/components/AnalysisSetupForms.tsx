import type { ReactNode } from "react";
import type { SchematicComponent } from "../schematic/types";
import type { DcSweepSpec } from "../simulation/dcSweep";
import type { TfSpec } from "../simulation/transferFunction";
import type { NoiseSpec } from "../simulation/noise";
import {
  labeledComponents,
  sweepableSources,
  type StepSetupUi,
} from "../simulation/analysisSetup";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EngineeringInput } from "./EngineeringInput";

/** Radix SelectItem forbids value=""; map the empty placeholder slot. */
const SELECT_EMPTY = "__tau_empty__";

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="analysis-setup-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function SourceSelect({
  value,
  components,
  onChange,
  label,
}: {
  value: string;
  components: readonly SchematicComponent[];
  onChange: (value: string) => void;
  label: string;
}) {
  const sources = sweepableSources(components);
  const items: { value: string; label: string }[] = sources.map((c) => ({
    value: c.label,
    label: c.label,
  }));
  if (value && !items.some((item) => item.value === value)) {
    items.unshift({ value, label: value });
  }
  if (items.length === 0 || value === "") {
    if (!items.some((item) => item.value === SELECT_EMPTY)) {
      items.unshift({ value: SELECT_EMPTY, label: value || "-" });
    }
  }
  const selectValue = value === "" ? SELECT_EMPTY : value;

  return (
    <Select
      value={selectValue}
      onValueChange={(next) => onChange(next === SELECT_EMPTY ? "" : next)}
    >
      <SelectTrigger
        size="sm"
        className="analysis-setup-select mono-num w-full"
        aria-label={label}
      >
        <SelectValue placeholder="-" />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const STEP_KIND_ITEMS: readonly { value: StepSetupUi["kind"]; label: string }[] = [
  { value: "source", label: "Source" },
  { value: "param", label: "Parameter" },
  { value: "temp", label: "Temperature" },
];

export function DcSetupForm({
  setup,
  components,
  onChange,
}: {
  setup: DcSweepSpec;
  components: readonly SchematicComponent[];
  onChange: (next: DcSweepSpec) => void;
}) {
  return (
    <div className="analysis-setup" aria-label="DC sweep setup">
      <div className="analysis-setup-head">DC sweep</div>
      <div className="analysis-setup-grid">
        <FieldRow label="Source">
          <SourceSelect
            label="DC sweep source"
            value={setup.source}
            components={components}
            onChange={(source) => onChange({ ...setup, source })}
          />
        </FieldRow>
        <FieldRow label="Start">
          <EngineeringInput
            label="DC start"
            value={String(setup.start)}
            unit="V"
            onValueChange={(v) => onChange({ ...setup, start: Number(v) || 0 })}
          />
        </FieldRow>
        <FieldRow label="Stop">
          <EngineeringInput
            label="DC stop"
            value={String(setup.stop)}
            unit="V"
            onValueChange={(v) => onChange({ ...setup, stop: Number(v) || 0 })}
          />
        </FieldRow>
        <FieldRow label="Step">
          <EngineeringInput
            label="DC increment"
            value={String(setup.step)}
            unit="V"
            onValueChange={(v) => onChange({ ...setup, step: Number(v) || 0 })}
          />
        </FieldRow>
      </div>
    </div>
  );
}

export function TfSetupForm({
  setup,
  components,
  onChange,
}: {
  setup: TfSpec;
  components: readonly SchematicComponent[];
  onChange: (next: TfSpec) => void;
}) {
  const pos = setup.output.kind === "voltage" ? setup.output.pos : "";
  return (
    <div className="analysis-setup" aria-label="Transfer function setup">
      <div className="analysis-setup-head">Transfer function</div>
      <div className="analysis-setup-grid">
        <FieldRow label="Output V(+)">
          <Input
            variant="mono"
            size="sm"
            aria-label="TF output positive node"
            value={pos}
            placeholder="out"
            onChange={(e) =>
              onChange({
                ...setup,
                output: { kind: "voltage", pos: e.currentTarget.value, neg: setup.output.kind === "voltage" ? setup.output.neg : undefined },
              })
            }
          />
        </FieldRow>
        <FieldRow label="Output V(−)">
          <Input
            variant="mono"
            size="sm"
            aria-label="TF output negative node"
            value={setup.output.kind === "voltage" ? setup.output.neg ?? "" : ""}
            placeholder="0"
            onChange={(e) =>
              onChange({
                ...setup,
                output: { kind: "voltage", pos, neg: e.currentTarget.value || undefined },
              })
            }
          />
        </FieldRow>
        <FieldRow label="Input source">
          <SourceSelect
            label="TF input source"
            value={setup.source}
            components={components}
            onChange={(source) => onChange({ ...setup, source })}
          />
        </FieldRow>
      </div>
    </div>
  );
}

export function NoiseSetupForm({
  setup,
  components,
  onChange,
}: {
  setup: NoiseSpec;
  components: readonly SchematicComponent[];
  onChange: (next: NoiseSpec) => void;
}) {
  return (
    <div className="analysis-setup" aria-label="Noise analysis setup">
      <div className="analysis-setup-head">Noise</div>
      <div className="analysis-setup-grid">
        <FieldRow label="Output V(+)">
          <Input
            variant="mono"
            size="sm"
            aria-label="Noise output positive node"
            value={setup.output.pos}
            onChange={(e) => onChange({ ...setup, output: { ...setup.output, pos: e.currentTarget.value } })}
          />
        </FieldRow>
        <FieldRow label="Ref source">
          <SourceSelect
            label="Noise reference source"
            value={setup.source}
            components={components}
            onChange={(source) => onChange({ ...setup, source })}
          />
        </FieldRow>
        <FieldRow label="F start">
          <EngineeringInput
            label="Noise start frequency"
            value={String(setup.sweep.startHz)}
            unit="Hz"
            onValueChange={(v) => onChange({ ...setup, sweep: { ...setup.sweep, startHz: Number(v) || 1 } })}
          />
        </FieldRow>
        <FieldRow label="F stop">
          <EngineeringInput
            label="Noise stop frequency"
            value={String(setup.sweep.stopHz)}
            unit="Hz"
            onValueChange={(v) => onChange({ ...setup, sweep: { ...setup.sweep, stopHz: Number(v) || 1 } })}
          />
        </FieldRow>
        <FieldRow label="Pts/dec">
          <Input
            variant="mono"
            size="sm"
            type="number"
            min={1}
            aria-label="Noise points per decade"
            value={String(setup.sweep.pointsPerDecade)}
            onChange={(e) =>
              onChange({
                ...setup,
                sweep: { ...setup.sweep, pointsPerDecade: Math.max(1, Number(e.currentTarget.value) || 10) },
              })
            }
          />
        </FieldRow>
      </div>
    </div>
  );
}

export function StepSetupForm({
  setup,
  components,
  onChange,
}: {
  setup: StepSetupUi;
  components: readonly SchematicComponent[];
  onChange: (next: StepSetupUi) => void;
}) {
  return (
    <div className="analysis-setup" aria-label="Step sweep setup">
      <div className="analysis-setup-head">Step sweep</div>
      <div className="analysis-setup-grid">
        <FieldRow label="Kind">
          <Select
            value={setup.kind}
            onValueChange={(kind) => onChange({ ...setup, kind: kind as StepSetupUi["kind"] })}
          >
            <SelectTrigger
              size="sm"
              className="analysis-setup-select mono-num w-full"
              aria-label="Step sweep kind"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STEP_KIND_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
        {setup.kind !== "temp" && (
          <FieldRow label={setup.kind === "param" ? "Param" : "Source"}>
            {setup.kind === "source" ? (
              <SourceSelect
                label="Step source"
                value={setup.name}
                components={components}
                onChange={(name) => onChange({ ...setup, name })}
              />
            ) : (
              <Input
                variant="mono"
                size="sm"
                aria-label="Step parameter name"
                value={setup.name}
                onChange={(e) => onChange({ ...setup, name: e.currentTarget.value })}
              />
            )}
          </FieldRow>
        )}
        <FieldRow label="Start">
          <EngineeringInput
            label="Step start"
            value={String(setup.start)}
            unit={setup.kind === "temp" ? "°C" : "V"}
            onValueChange={(v) => onChange({ ...setup, start: Number(v) || 0 })}
          />
        </FieldRow>
        <FieldRow label="Stop">
          <EngineeringInput
            label="Step stop"
            value={String(setup.stop)}
            unit={setup.kind === "temp" ? "°C" : "V"}
            onValueChange={(v) => onChange({ ...setup, stop: Number(v) || 0 })}
          />
        </FieldRow>
        <FieldRow label="Step">
          <EngineeringInput
            label="Step increment"
            value={String(setup.step)}
            unit={setup.kind === "temp" ? "°C" : "V"}
            onValueChange={(v) => onChange({ ...setup, step: Number(v) || 0 })}
          />
        </FieldRow>
      </div>
      {labeledComponents(components).length === 0 && (
        <p className="analysis-setup-hint">Place at least one source before running a step sweep.</p>
      )}
    </div>
  );
}
