import { Activity, Search, TriangleAlert } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { componentDisplayName } from "../schematic/componentNames";
import type { ComponentAdvisory, ComponentMeasurement, MeasuredSeries } from "../simulation/measurementModel";
import { formatEngineering } from "../simulation/quantity";

export interface ComponentMeasurementsPanelProps {
  rows: readonly ComponentMeasurement[];
  selectedId: string | null;
  onSelect: (componentId: string | null) => void;
  className?: string;
  /** Limits the telemetry viewport without constraining the containing layout. */
  maxHeight?: number | string;
  /** "full" (default) is the searchable card grid used standalone. "compact"
   *  renders the same rows as a responsive grid of small cards
   *  for the simulator's telemetry dock - same data/selection model, a
   *  different shell entirely (no search, no sign-convention disclosure). */
  variant?: "full" | "compact";
}

interface PrimaryReading {
  value: number;
  qualifier: "AVG" | "RMS" | "FINAL";
}

/** Periodic V/I use RMS; periodic power uses average real power. */
export function primaryReading(series: MeasuredSeries): PrimaryReading {
  if (series.classification.kind !== "periodic") {
    return { value: series.statistics.final, qualifier: "FINAL" };
  }
  return series.unit === "W"
    ? { value: series.statistics.average, qualifier: "AVG" }
    : { value: series.statistics.rms, qualifier: "RMS" };
}

function readingText(series: MeasuredSeries | undefined): string {
  if (!series) return "Unavailable";
  const reading = primaryReading(series);
  return formatEngineering(reading.value, series.unit, 3);
}

function classificationText(series: MeasuredSeries): string {
  if (series.classification.kind !== "periodic") return series.classification.kind;
  const frequency = series.classification.frequency;
  return frequency && Number.isFinite(frequency)
    ? `Periodic · ${formatEngineering(frequency, "Hz", 3)}`
    : "Periodic";
}

/** A bounded path builder so a telemetry row never emits an SVG point per simulation sample. */
export function sparklinePath(values: readonly number[], width = 112, height = 32, maxPoints = 64): string {
  if (values.length < 2 || maxPoints < 2) return "";
  const lastIndex = values.length - 1;
  const sampleCount = Math.min(maxPoints, values.length);
  const samples: Array<{ index: number; value: number }> = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const index = Math.round((i / (sampleCount - 1)) * lastIndex);
    const value = values[index];
    if (Number.isFinite(value)) samples.push({ index, value });
  }
  if (samples.length < 2) return "";

  let min = Infinity;
  let max = -Infinity;
  for (const sample of samples) {
    min = Math.min(min, sample.value);
    max = Math.max(max, sample.value);
  }
  const span = max - min || 1;
  return samples
    .map((sample, index) => {
      const x = (sample.index / lastIndex) * width;
      const y = height - 2 - ((sample.value - min) / span) * (height - 4);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function Sparkline({
  series,
  tone = "default",
}: {
  series: MeasuredSeries;
  tone?: "default" | "voltage" | "current";
}) {
  const path = sparklinePath(series.values);
  if (!path) return <span className="text-xs text-muted-foreground">No waveform</span>;
  const description = `${series.label}: ${classificationText(series)}`;
  return (
    <svg
      className={cn(
        "h-8 w-28 shrink-0 overflow-visible text-primary",
        tone !== "default" && "telemetry-waveform-svg",
        tone === "voltage" && "telemetry-waveform-svg--voltage",
        tone === "current" && "telemetry-waveform-svg--current",
      )}
      viewBox="0 0 112 32"
      role="img"
      aria-label={description}
    >
      <title>{description}</title>
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Reading({ label, series }: { label: "Voltage" | "Current" | "Power"; series?: MeasuredSeries }) {
  const reading = series ? primaryReading(series) : null;
  return (
    <div className="min-w-0 rounded-md bg-muted px-3 py-2">
      <dt className="flex items-baseline justify-between gap-2 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
        <span>{label}</span>
        <span>{reading?.qualifier ?? "-"}</span>
      </dt>
      <dd className={cn("m-0 mt-1 truncate font-mono text-sm font-semibold tabular-nums", series ? "text-foreground" : "text-muted-foreground")}>
        {readingText(series)}
      </dd>
    </div>
  );
}

function MeasurementAdvisories({ advisories, compact = false }: { advisories?: readonly ComponentAdvisory[]; compact?: boolean }) {
  if (!advisories?.length) return null;
  return (
    <div className={cn("grid gap-2", compact && "mt-2")}>
      {advisories.map((advisory) => (
        <div
          key={`${advisory.kind}:${advisory.message}`}
          className={cn(
            "flex items-start gap-2 rounded-md border border-[var(--signal-line)] bg-[var(--signal-soft)] text-left text-foreground [border-style:solid]",
            compact ? "px-2 py-1.5 text-[0.6875rem] leading-snug" : "px-3 py-2 text-xs leading-relaxed",
          )}
          role="status"
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-[var(--signal)]" aria-hidden="true" />
          <span>
            <strong className="font-semibold">{advisory.title}</strong>
            <span className={cn("text-muted-foreground", compact ? "sr-only" : "ml-1")}>{advisory.message}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function MeasurementCard({
  row,
  selected,
  onSelect,
}: {
  row: ComponentMeasurement;
  selected: boolean;
  onSelect: (componentId: string | null) => void;
}) {
  const titleId = useId();
  const primary = row.voltage ?? row.current ?? row.power;

  return (
    <li>
      <article
        className={cn(
          "grid w-full gap-3 rounded-lg border bg-card p-4 text-card-foreground [border-style:solid]",
          selected ? "border-primary bg-accent" : "border-border",
        )}
        aria-labelledby={titleId}
      >
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 id={titleId} className="m-0 truncate font-mono text-sm font-semibold text-foreground">{row.ref}</h3>
            <div className="mt-0.5 truncate text-xs capitalize text-muted-foreground">{row.kind}</div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
            {primary && (
              <>
                <Sparkline series={primary} />
                <span className="rounded-full border border-border px-2 py-1 text-[0.6875rem] font-medium text-muted-foreground [border-style:solid]">
                  {classificationText(primary)}
                </span>
              </>
            )}
            <Button
              type="button"
              size="sm"
              variant={selected ? "secondary" : "outline"}
              aria-pressed={selected}
              aria-label={(selected ? "Deselect " : "Select ") + row.ref}
              onClick={() => onSelect(selected ? null : row.componentId)}
            >
              {selected ? "Deselect" : "Select"}
            </Button>
          </div>
        </div>

        <dl className="m-0 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Reading label="Voltage" series={row.voltage} />
          <Reading label="Current" series={row.current} />
          <Reading label="Power" series={row.power} />
        </dl>
        <MeasurementAdvisories advisories={row.advisories} />
      </article>
    </li>
  );
}

/**
 * Human names for the schematic kind strings ("vac" → "Sine voltage source")
 * so the dock reads like a spec sheet, not an internal enum.
 *
 * The names themselves live in `schematic/componentNames.ts`, shared with the
 * Properties panel's group titles. This used to be a private partial map with a
 * capitalise-the-enum fallback, which meant a kind added to the catalog leaked
 * "Sevenseg" here while Properties printed "sevenSeg" - two surfaces of one app
 * disagreeing about what the part is called.
 */
function displayKind(kind: ComponentMeasurement["kind"]): string {
  return componentDisplayName(kind);
}

/** One row of the compact card's spec table: full-word quantity on the left
 *  (with the qualifier the value actually carries - RMS/AVG/final; the data
 *  model picks it per series), engineering value + unit right-aligned. The
 *  whole card is the button (unlike the full card's dedicated Select
 *  button) - in the dock, clicking a card IS "focus this on canvas". */
function CompactReading({ label, series }: { label: "Voltage" | "Current" | "Power"; series?: MeasuredSeries }) {
  const reading = series ? primaryReading(series) : null;
  return (
    <div className="telemetry-card-row">
      <dt>
        {label}
        {reading && (
          <span className="telemetry-card-qualifier">
            {reading.qualifier === "FINAL" ? "final" : reading.qualifier}
          </span>
        )}
      </dt>
      <dd className={reading ? undefined : "muted"}>
        {series && reading ? formatEngineering(reading.value, series.unit, 3) : "-"}
      </dd>
    </div>
  );
}

function CompactMeasurementCard({
  row,
  selected,
  onSelect,
}: {
  row: ComponentMeasurement;
  selected: boolean;
  onSelect: (componentId: string | null) => void;
}) {
  // The badge has exactly one job: warn that the headline number below it -
  // which is labelled "final" - is not the whole story. So it fires only for
  // the two classes where that is true: `transient` (still moving at the stop
  // time) and `periodic` (the final sample is one arbitrary phase). A `settled`
  // trace reached a DC operating point and holds it; its final value IS the
  // answer, so badging it would be a warning about nothing. `steady` never
  // moved at all.
  //
  // Only a series that actually exists can say the component varies. The old
  // `row.voltage?.classification.kind !== "steady"` was true for a MISSING
  // series too (undefined !== "steady"), so a component Tau could not measure
  // was badged as time-varying on no evidence at all.
  const timeVarying = [row.voltage, row.current].some(
    (series) => series?.classification.kind === "transient" || series?.classification.kind === "periodic",
  );

  return (
    <li className="telemetry-card-item">
      <button
        type="button"
        className={cn("telemetry-card", selected && "telemetry-card--selected")}
        aria-pressed={selected}
        onClick={() => onSelect(selected ? null : row.componentId)}
      >
        <div className="telemetry-card-head">
          <span className="telemetry-card-ref">{row.ref}</span>
          <span className="telemetry-card-meta">
            {timeVarying && <span className="telemetry-card-badge">Time-varying</span>}
            {!!row.advisories?.length && (
              <span className="telemetry-card-warning" aria-label={`${row.advisories.length} warning${row.advisories.length === 1 ? "" : "s"}`}>
                <TriangleAlert size={11} aria-hidden="true" />
                {row.advisories.length}
              </span>
            )}
            <span className="telemetry-card-kind">{displayKind(row.kind)}</span>
          </span>
        </div>
        <dl className="telemetry-card-rows">
          <CompactReading label="Voltage" series={row.voltage} />
          <CompactReading label="Current" series={row.current} />
          <CompactReading label="Power" series={row.power} />
        </dl>
      </button>
    </li>
  );
}

function CompactTransientInspector({ row }: { row: ComponentMeasurement }) {
  // Deliberately wider than the card badge: this section is detail-on-demand
  // for a component the user selected, so a `settled` trace still earns a
  // sparkline (the settling - inrush, a charge curve - is exactly what a final
  // value cannot show). The badge, which is unsolicited, does not.
  const varyingSeries = [
    row.voltage?.classification.kind !== "steady" ? { quantity: "V(t)", tone: "voltage" as const, series: row.voltage } : null,
    row.current?.classification.kind !== "steady" ? { quantity: "I(t)", tone: "current" as const, series: row.current } : null,
  ].filter((entry): entry is { quantity: string; tone: "voltage" | "current"; series: MeasuredSeries } => Boolean(entry?.series));

  if (varyingSeries.length === 0 && !row.advisories?.length) return null;

  return (
    <section className="telemetry-inspector" aria-label={`${row.ref} transient details`}>
      <div className="telemetry-inspector-head">
        <div>
          <span className="telemetry-inspector-eyebrow">Selected component</span>
          <strong>{row.ref} · Transient behavior</strong>
        </div>
        {varyingSeries.length > 0 && <span>Use Probe for a full time-axis plot</span>}
      </div>
      {varyingSeries.length > 0 && (
        <div className="telemetry-waveforms-grid" role="group" aria-label={`${row.ref} time-varying voltage and current`}>
          {varyingSeries.map(({ quantity, tone, series }) => (
            <div className="telemetry-waveform" key={series.id}>
              <div className="telemetry-waveform-label">
                <span>{quantity}</span>
                <span>{classificationText(series)}</span>
              </div>
              <Sparkline series={series} tone={tone} />
            </div>
          ))}
        </div>
      )}
      <MeasurementAdvisories advisories={row.advisories} />
    </section>
  );
}

function CompactMeasurementsGrid({
  rows,
  selectedId,
  onSelect,
  className,
}: Pick<ComponentMeasurementsPanelProps, "rows" | "selectedId" | "onSelect" | "className">) {
  if (rows.length === 0) {
    return (
      <p className={cn("telemetry-strip-empty", className)} aria-live="polite">
        Run a simulation to see per-component V, I, and P.
      </p>
    );
  }
  const selectedRow = rows.find((row) => row.componentId === selectedId);
  return (
    <div className={cn("telemetry-compact-layout", className)}>
      {selectedRow && <CompactTransientInspector row={selectedRow} />}
      <ul className="telemetry-strip">
        {rows.map((row) => (
          <CompactMeasurementCard
            key={row.componentId}
            row={row}
            selected={row.componentId === selectedId}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </div>
  );
}

export function ComponentMeasurementsPanel({
  rows,
  selectedId,
  onSelect,
  className,
  maxHeight = 520,
  variant = "full",
}: ComponentMeasurementsPanelProps) {
  const filterId = useId();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleRows = useMemo(
    () => normalizedQuery
      ? rows.filter((row) => `${row.ref} ${row.kind}`.toLocaleLowerCase().includes(normalizedQuery))
      : rows,
    [normalizedQuery, rows],
  );
  const completeCount = useMemo(
    () => rows.filter((row) => row.voltage && row.current && row.power).length,
    [rows],
  );

  if (variant === "compact") {
    return <CompactMeasurementsGrid rows={rows} selectedId={selectedId} onSelect={onSelect} className={className} />;
  }

  return (
    <section
      className={cn("overflow-hidden rounded-xl border border-border bg-card text-card-foreground [border-style:solid]", className)}
      aria-labelledby={`${filterId}-title`}
    >
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-5 py-4 [border-bottom-style:solid]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-primary" aria-hidden="true" />
            <h2 id={`${filterId}-title`} className="m-0 text-sm font-semibold text-foreground">
              Component measurements
            </h2>
          </div>
          <p className="m-0 mt-1 text-xs text-muted-foreground">
            {rows.length} components · {completeCount} with complete V/I/P
          </p>
        </div>

        <div className="relative w-full sm:w-64">
          <label className="sr-only" htmlFor={filterId}>Filter component measurements</label>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id={filterId}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Filter by reference or type"
            className="pl-8"
            aria-controls={`${filterId}-results`}
          />
        </div>
      </header>

      <div className="flex items-start justify-between gap-4 border-b border-border px-5 text-[0.6875rem] text-muted-foreground [border-bottom-style:solid]">
        <details className="min-w-0 flex-1 py-2">
          <summary className="w-fit cursor-pointer font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            Reading and sign conventions
          </summary>
          <div className="mt-2 grid gap-1 pb-1 sm:grid-cols-2">
            <span>Periodic voltage/current use RMS; periodic power uses average real power.</span>
            <span>FINAL is the instantaneous value at the simulation stop time.</span>
            <span>Voltage is measured from the component positive terminal to its negative terminal.</span>
            <span>Current is positive in the displayed I(reference) direction.</span>
            <span>Positive power is absorbed; negative power is delivered.</span>
          </div>
        </details>
        <span aria-live="polite">{visibleRows.length} shown</span>
      </div>

      <ScrollArea style={{ height: maxHeight }}>
        <div id={`${filterId}-results`} className="p-3">
          {visibleRows.length > 0 ? (
            <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 xl:grid-cols-2">
              {visibleRows.map((row) => (
                <MeasurementCard
                  key={row.componentId}
                  row={row}
                  selected={row.componentId === selectedId}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          ) : (
            <div className="grid min-h-36 place-items-center px-5 text-center text-sm text-muted-foreground" aria-live="polite">
              {rows.length === 0
                ? "Run a transient analysis to populate component measurements."
                : `No components match “${query.trim()}”.`}
            </div>
          )}
        </div>
      </ScrollArea>
    </section>
  );
}

export default ComponentMeasurementsPanel;
