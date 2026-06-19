import { useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import { CATALOG_BY_KIND } from "../schematic/catalog";
import { useSchematic } from "../store/useSchematic";
import type { AnalysisOptions, AnalysisResult, Trace } from "../simulation/linearTransient";
import { formatEngineering } from "../simulation/quantity";
import { OPAMP_LIBRARY, findOpAmp } from "../library/opamps";
import type { Probe } from "../schematic/types";
import { paramFields, decodeParams, encodeParams } from "../schematic/params";

interface SimulationPanelProps {
  result: AnalysisResult | null;
  options: AnalysisOptions;
  onOptionsChange: (options: AnalysisOptions) => void;
  onRun: () => void;
}

const PLOT_WIDTH = 340;
const PLOT_HEIGHT = 210;
const PLOT_PAD = 26;

export function SimulationPanel({ result, options, onOptionsChange, onRun }: SimulationPanelProps) {
  const components = useSchematic((s) => s.components);
  const wires = useSchematic((s) => s.wires);
  const selectedId = useSchematic((s) => s.selectedId);
  const setValue = useSchematic((s) => s.setValue);
  const beginChange = useSchematic((s) => s.beginChange);
  const probes = useSchematic((s) => s.probes);
  const editingRef = useRef(false);
  const selected = components.find((component) => component.id === selectedId) ?? null;
  const selectedEntry = selected ? CATALOG_BY_KIND[selected.kind] : null;
  const opampPart = selected && selected.kind === "opamp" ? findOpAmp(selected.value) : null;
  const warnings = result?.warnings ?? [];

  return (
    <aside className="plotter" aria-label="Analysis plotter">
      <div className="plotter-header">
        <div>
          <div className="plotter-kicker">Analysis</div>
          <div className="plotter-title">Transient scope</div>
        </div>
        <button className="plotter-run" onClick={onRun}>
          Run
        </button>
      </div>

      <div className="plotter-tabs" aria-label="Analysis modes">
        <button className="plotter-tab active">TRAN</button>
        <button className="plotter-tab" disabled>
          OP
        </button>
        <button className="plotter-tab" disabled>
          AC
        </button>
      </div>

      <WaveformPlot result={result} probes={probes} />

      <div className="meter-row">
        <Metric label="NETS" value={result?.ok ? String(result.stats.netCount) : "--"} tone="green" />
        <Metric label="NODES" value={result?.ok ? String(Math.max(0, result.stats.netCount - 1)) : "--"} tone="cyan" />
        <Metric label="SAMPLES" value={result?.ok ? String(result.stats.sampleCount) : "--"} tone="cream" />
      </div>

      <div className="plotter-controls">
        <DialControl
          label="STOP"
          value={`${formatEngineering(options.stopTime, "s", 2)}`}
          min={0.1}
          max={200}
          step={0.1}
          numericValue={options.stopTime * 1000}
          onChange={(value) => onOptionsChange({ ...options, stopTime: value / 1000 })}
        />
        <DialControl
          label="STEPS"
          value={String(options.steps)}
          min={32}
          max={1000}
          step={1}
          numericValue={options.steps}
          onChange={(value) => onOptionsChange({ ...options, steps: Math.round(value) })}
        />
      </div>

      <div className="selection-strip">
        <div className="strip-label">SELECT</div>
        {selected && selectedEntry ? (
          <>
            <div className="selected-part">
              <span>{selected.label || selectedEntry.name}</span>
              <small>{selectedEntry.name}</small>
            </div>
            {selected.kind === "opamp" ? (
              <>
                <label className="value-editor">
                  <span>MODEL</span>
                  <select
                    value={OPAMP_LIBRARY.some((p) => p.part === selected.value) ? selected.value : "Ideal"}
                    onChange={(event) => {
                      beginChange();
                      setValue(selected.id, event.currentTarget.value);
                    }}
                  >
                    {OPAMP_LIBRARY.map((p) => (
                      <option key={p.part} value={p.part}>
                        {p.part}
                        {p.part === "Ideal" ? "" : ` · ${p.manufacturer}`}
                      </option>
                    ))}
                  </select>
                  <em>IC</em>
                </label>
                {opampPart && (
                  <div className="opamp-spec">
                    {Number.isFinite(opampPart.gbwHz) && opampPart.gbwHz > 0
                      ? `${formatEngineering(opampPart.gbwHz, "Hz", 2)} GBW · ${opampPart.slewRate} V/µs · ±${opampPart.supplyMax} V · ${opampPart.package}`
                      : "ideal — infinite gain & bandwidth"}
                  </div>
                )}
              </>
            ) : paramFields(selected.kind).length > 0 ? (
              <div className="param-fields">
                {paramFields(selected.kind).map((f) => (
                  <label key={f.key} className="value-editor">
                    <span>{f.label}</span>
                    <input
                      value={decodeParams(selected.kind, selected.value)[f.key] ?? ""}
                      onFocus={() => {
                        editingRef.current = false;
                      }}
                      onChange={(event) => {
                        if (!editingRef.current) {
                          beginChange();
                          editingRef.current = true;
                        }
                        const next = {
                          ...decodeParams(selected.kind, selected.value),
                          [f.key]: event.currentTarget.value,
                        };
                        setValue(selected.id, encodeParams(selected.kind, next));
                      }}
                      spellCheck={false}
                    />
                    {f.unit && <em>{f.unit}</em>}
                  </label>
                ))}
              </div>
            ) : (
              <div className="selected-part muted">No parameters</div>
            )}
          </>
        ) : (
          <div className="selected-part muted">No selection</div>
        )}
      </div>

      <div className="plotter-footer">
        <div className="tiny-leds" aria-hidden="true">
          <span className={components.length ? "on green" : ""} />
          <span className={wires.length ? "on cyan" : ""} />
          <span className={result?.ok ? "on cream" : result && !result.ok ? "on red" : ""} />
        </div>
        <div className="plotter-message">
          {result ? (
            result.ok ? (
              <>
                <strong>{result.title}</strong>
                <span>{formatEngineering(result.stats.stepSize, "s", 2)} step</span>
              </>
            ) : (
              <>
                <strong>{result.title}</strong>
                <span>{result.message}</span>
              </>
            )
          ) : (
            <>
              <strong>Idle</strong>
              <span>{components.length} parts · {wires.length} wires</span>
            </>
          )}
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="warning-list">
          {warnings.slice(0, 3).map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      )}
    </aside>
  );
}

function WaveformPlot({ result, probes }: { result: AnalysisResult | null; probes: Probe[] }) {
  const success = result?.ok ? result : null;

  // With probes, show exactly the probed nets in their probe colors; otherwise
  // fall back to the first few node voltages.
  const traces = useMemo<Trace[]>(() => {
    if (!success) return [];
    if (probes.length === 0) return success.traces.slice(0, 6);
    const out: Trace[] = [];
    for (const probe of probes) {
      const net = success.circuit.nets.find(
        (n) => !n.isGround && n.points.some((pt) => pt.x === probe.x && pt.y === probe.y),
      );
      if (!net) continue;
      const trace = success.traces.find((tr) => tr.id === net.id);
      if (trace && !out.some((o) => o.id === trace.id)) out.push({ ...trace, color: probe.color });
    }
    return out;
  }, [success, probes]);

  const plot = useMemo(() => {
    if (!success || traces.length === 0) return null;
    const values = traces.flatMap((trace) => trace.values);
    const rawMin = Math.min(...values, 0);
    const rawMax = Math.max(...values, 0);
    const span = rawMax - rawMin || 1;
    const min = rawMin - span * 0.08;
    const max = rawMax + span * 0.08;
    const tMax = success.times[success.times.length - 1] || 1;
    return { min, max, tMax };
  }, [success, traces]);

  return (
    <div className="scope-shell">
      <svg className="scope-svg" viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`} role="img" aria-label="Waveform plot">
        <g className="scope-grid">
          {Array.from({ length: 6 }).map((_, i) => {
            const x = PLOT_PAD + (i * (PLOT_WIDTH - PLOT_PAD * 2)) / 5;
            return <line key={`x${i}`} x1={x} y1={PLOT_PAD} x2={x} y2={PLOT_HEIGHT - PLOT_PAD} />;
          })}
          {Array.from({ length: 5 }).map((_, i) => {
            const y = PLOT_PAD + (i * (PLOT_HEIGHT - PLOT_PAD * 2)) / 4;
            return <line key={`y${i}`} x1={PLOT_PAD} y1={y} x2={PLOT_WIDTH - PLOT_PAD} y2={y} />;
          })}
        </g>
        <rect className="scope-frame" x={PLOT_PAD} y={PLOT_PAD} width={PLOT_WIDTH - PLOT_PAD * 2} height={PLOT_HEIGHT - PLOT_PAD * 2} />
        {plot &&
          traces.map((trace) => (
            <path key={trace.id} className="scope-trace" stroke={trace.color} d={tracePath(trace, success!.times, plot.min, plot.max, plot.tMax)} />
          ))}
        <text className="scope-axis" x={PLOT_PAD} y={18}>
          {plot ? formatEngineering(plot.max, "V", 2) : "MAX"}
        </text>
        <text className="scope-axis" x={PLOT_PAD} y={PLOT_HEIGHT - 8}>
          {plot ? formatEngineering(plot.min, "V", 2) : "MIN"}
        </text>
        <text className="scope-axis right" x={PLOT_WIDTH - PLOT_PAD} y={PLOT_HEIGHT - 8}>
          {success ? formatEngineering(success.stats.stopTime, "s", 2) : "TIME"}
        </text>
      </svg>
      <div className="scope-legend">
        {traces.length > 0 ? (
          traces.map((trace) => (
            <span key={trace.id}>
              <i style={{ background: trace.color }} />
              {trace.label}
            </span>
          ))
        ) : (
          <span className="muted">No traces</span>
        )}
      </div>
    </div>
  );
}

function tracePath(trace: Trace, times: number[], min: number, max: number, tMax: number): string {
  return trace.values
    .map((value, index) => {
      const x = PLOT_PAD + ((times[index] ?? 0) / tMax) * (PLOT_WIDTH - PLOT_PAD * 2);
      const y = PLOT_HEIGHT - PLOT_PAD - ((value - min) / (max - min || 1)) * (PLOT_HEIGHT - PLOT_PAD * 2);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DialControl({
  label,
  value,
  numericValue,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: string;
  numericValue: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const progress = Math.max(0, Math.min(1, (numericValue - min) / (max - min)));
  return (
    <label className="param-control">
      <div className="param-head">
        <span className="param-label">{label}</span>
        <span className="param-value">{value}</span>
      </div>
      <input
        className="param-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={numericValue}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        style={{ "--fill": `${progress * 100}%` } as CSSProperties}
      />
    </label>
  );
}
