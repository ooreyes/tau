import { formatEngineering } from "../simulation/quantity";
import {
  buildEngineeringTraceReadout,
  type EngineeringTraceReadoutModel,
  type TraceReadoutCursor,
} from "../simulation/engineeringTraceReadout";
import type { Trace } from "../simulation/linearTransient";

export interface EngineeringTraceReadoutProps {
  trace: Pick<Trace, "id" | "label" | "unit" | "values">;
  times: readonly number[];
  cursor?: TraceReadoutCursor;
  /** Optional accessible name when the surrounding pane supplies more context. */
  ariaLabel?: string;
  className?: string;
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
    : model.classification.kind === "steady" ? "Steady" : "Transient";
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
  ariaLabel,
  className = "",
}: EngineeringTraceReadoutProps) {
  const model = buildEngineeringTraceReadout(trace, times, cursor);
  if (!model) return null;
  const value = (measurement: number) => formatEngineering(measurement, model.unit, 3);
  const periodic = model.classification.kind === "periodic";
  const primaryLabel = periodic ? "RMS" : "FINAL";
  const primaryValue = periodic ? model.rms : model.final;

  return (
    <section
      className={`engineering-trace-readout ${className}`.trim()}
      aria-label={ariaLabel ?? `${model.label} engineering readout`}
    >
      <header className="engineering-trace-readout__header">
        <strong className="engineering-trace-readout__name">{model.label}</strong>
        <Classification model={model} />
      </header>
      <dl className="engineering-trace-readout__primary-metrics">
        <ReadoutItem
          className="engineering-trace-readout__item--primary"
          label={primaryLabel}
          value={value(primaryValue)}
          title={periodic ? "Root mean square" : "Final finite sample"}
        />
        <ReadoutItem label="P–P" value={value(model.peakToPeak)} title="Peak to peak" />
        {model.frequency !== undefined && (
          <ReadoutItem label="FREQ" value={formatEngineering(model.frequency, "Hz", 3)} title="Estimated frequency" />
        )}
      </dl>
      <details className="engineering-trace-readout__details">
        <summary className="engineering-trace-readout__details-summary">More measurements</summary>
        <dl className="engineering-trace-readout__metrics">
          <ReadoutItem label="MIN" value={value(model.minimum)} title="Minimum" />
          <ReadoutItem label="MAX" value={value(model.maximum)} title="Maximum" />
          <ReadoutItem label="AVG" value={value(model.average)} title="Time-weighted average" />
          <ReadoutItem label="RMS" value={value(model.rms)} title="Root mean square" />
          <ReadoutItem label="FINAL" value={value(model.final)} title="Final finite sample" />
          {model.period !== undefined && (
            <ReadoutItem label="PERIOD" value={formatEngineering(model.period, "s", 3)} title="Estimated period" />
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
