import { useMemo, type CSSProperties } from "react";
import { formatEngineering } from "../simulation/quantity";
import {
  buildEngineeringTraceReadout,
  type EngineeringTraceReadoutModel,
  type TraceReadoutCursor,
} from "../simulation/engineeringTraceReadout";
import type { Trace } from "../simulation/linearTransient";

export interface EngineeringTraceReadoutProps {
  trace: Pick<Trace, "id" | "label" | "unit" | "values"> & Partial<Pick<Trace, "color">>;
  times: readonly number[];
  cursor?: TraceReadoutCursor;
  visibleWindow?: { tMin: number; tMax: number };
  /** The containing channel/card may already own the visible signal name. */
  showIdentity?: boolean;
  /** Optional accessible name when the surrounding pane supplies more context. */
  ariaLabel?: string;
  className?: string;
}

interface EngineeringValueParts {
  mantissa: string;
  unit: string;
}

/** Keep the formatter as the precision authority while giving the attached SI
 * unit its own subordinate type role. `formatEngineering` always separates
 * mantissa and unit with its final space; unitless and unavailable values do
 * not fabricate one. */
function splitEngineeringValue(formatted: string): EngineeringValueParts {
  const separator = formatted.lastIndexOf(" ");
  if (separator <= 0) return { mantissa: formatted, unit: "" };
  return {
    mantissa: formatted.slice(0, separator),
    unit: formatted.slice(separator + 1),
  };
}

function HeroValue({ formatted }: { formatted: string }) {
  const { mantissa, unit } = splitEngineeringValue(formatted);
  return (
    <span className="engineering-trace-readout__hero-value" aria-label={formatted}>
      <span className="engineering-trace-readout__hero-mantissa">{mantissa}</span>
      {unit && <span className="engineering-trace-readout__hero-unit">{unit}</span>}
    </span>
  );
}

interface ReadoutItemProps {
  label: string;
  value: string;
  title?: string;
  className?: string;
}

function ReadoutItem({ label, value, title, className = "" }: ReadoutItemProps) {
  return (
    <div className={`engineering-trace-readout__item ${className}`.trim()}>
      <dt title={title}>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Classification({ model }: { model: EngineeringTraceReadoutModel }) {
  const text = model.frequency
    ? `Periodic · ${formatEngineering(model.frequency, "Hz", 3)}`
    : model.classification.kind === "steady"
      ? "Steady"
      : model.classification.kind === "settled"
        ? "Settled"
        : "Transient";
  return (
    <span
      className={`engineering-trace-readout__classification engineering-trace-readout__classification--${model.classification.kind}`}
    >
      {text}
    </span>
  );
}

/**
 * Compact, semantic instrument readout for a waveform card header. This file
 * intentionally owns no visual values: integration CSS can style its stable
 * BEM classes entirely through Tau's design tokens.
 */
export function EngineeringTraceReadout({
  trace,
  times,
  cursor,
  visibleWindow,
  showIdentity = true,
  ariaLabel,
  className = "",
}: EngineeringTraceReadoutProps) {
  const model = useMemo(
    () => buildEngineeringTraceReadout(trace, times, cursor, visibleWindow),
    [
      trace.id,
      trace.label,
      trace.unit,
      trace.values,
      times,
      cursor?.label,
      cursor?.time,
      cursor?.value,
      visibleWindow?.tMin,
      visibleWindow?.tMax,
    ],
  );
  if (!model) return null;
  const value = (measurement: number) => formatEngineering(measurement, model.unit, 3);
  const periodic = model.classification.kind === "periodic";
  const primaryLabel = periodic ? "RMS" : "Final value";
  const primaryValue = periodic ? model.rms : model.final;

  return (
    <section
      className={`engineering-trace-readout ${className}`.trim()}
      aria-label={ariaLabel ?? `${model.label} engineering readout`}
      style={trace.color ? ({ "--trace-color": trace.color } as CSSProperties) : undefined}
    >
      <header className={`engineering-trace-readout__header${showIdentity ? "" : " engineering-trace-readout__header--classification-only"}`}>
        {showIdentity && <strong className="engineering-trace-readout__name">{model.label}</strong>}
        <Classification model={model} />
      </header>
      <div className="engineering-trace-readout__hero">
        <span className="engineering-trace-readout__hero-label">{primaryLabel}</span>
        <HeroValue formatted={value(primaryValue)} />
      </div>
      <dl className="engineering-trace-readout__primary-metrics">
        <ReadoutItem label="Peak-to-peak" value={value(model.peakToPeak)} title="Full run peak to peak" />
        {model.visibleWindow && (
          <ReadoutItem
            label="Visible P-P"
            value={value(model.visibleWindow.peakToPeak)}
            title={`Peak-to-peak in visible window ${model.visibleWindow.tMin}–${model.visibleWindow.tMax}`}
          />
        )}
        {model.frequency !== undefined && (
          <ReadoutItem label="Frequency" value={formatEngineering(model.frequency, "Hz", 3)} title="Estimated frequency" />
        )}
      </dl>
      <details className="engineering-trace-readout__details">
        <summary className="engineering-trace-readout__details-summary">More measurements</summary>
        <dl className="engineering-trace-readout__metrics">
          <ReadoutItem label="Minimum" value={value(model.minimum)} title="Minimum" />
          <ReadoutItem label="Maximum" value={value(model.maximum)} title="Maximum" />
          <ReadoutItem label="Average" value={value(model.average)} title="Time-weighted average" />
          <ReadoutItem label="RMS" value={value(model.rms)} title="Root mean square" />
          <ReadoutItem label="Final value" value={value(model.final)} title="Final finite sample" />
          {model.period !== undefined && (
            <ReadoutItem label="Period" value={formatEngineering(model.period, "s", 3)} title="Estimated period" />
          )}
          {model.cursor && (
            <ReadoutItem
              className="engineering-trace-readout__item--cursor"
              label={model.cursor.label}
              value={`${formatEngineering(model.cursor.value, model.unit, 3)} @ ${formatEngineering(model.cursor.time, "s", 3)}`}
              title="Cursor value and time"
            />
          )}
        </dl>
      </details>
    </section>
  );
}
