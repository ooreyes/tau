import { useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { CATALOG_BY_KIND } from "../schematic/catalog";
import { useSchematic } from "../store/useSchematic";
import {
  MAX_TRANSIENT_STEPS,
  MIN_SAMPLES_PER_CYCLE,
  inspectTransientResolution,
  type AnalysisOptions,
  type AnalysisResult,
  type Trace,
} from "../simulation/linearTransient";
import { formatEngineering } from "../simulation/quantity";
import { OPAMP_LIBRARY, findOpAmp } from "../library/opamps";
import type { Probe, NetLabel } from "../schematic/types";
import { paramFields, decodeParams, encodeParams } from "../schematic/params";
import { EngineeringInput } from "./EngineeringInput";
import type { OperatingPointResult } from "../simulation/operatingPoint";
import type { AcResult } from "../simulation/acSweep";
import type { DcSweepResult } from "../simulation/dcSweep";
import type { TfResult } from "../simulation/transferFunction";
import type { NoiseResult } from "../simulation/noise";
import type { StepFamilyResult } from "../simulation/stepFamily";
import type { MeasResult } from "../simulation/measure";
import type { FourierResult } from "../simulation/fourier";
import { evaluatePlotExpression } from "../simulation/plotExpression";
import { commonTraceUnit } from "../simulation/exprUnit";
import { seriesToCsv } from "../simulation/waveformCsv";
import { runWaveformFft, dominantFrequency, spectrumThd, type WindowFn } from "../simulation/fft";
import { buildSpiceDeck } from "../engine/spiceNetlist";
import { serializeRaw, inferRawType } from "../io/rawExport";
import { cursorReadout, fractionToX } from "../simulation/cursors";
import type { CursorTraceInput } from "../simulation/cursors";
import { parseRaw } from "../io/rawImport";
import type { RawData } from "../io/rawImport";
import { buildReferenceOverlay } from "../simulation/rawOverlay";
import { buildParamScope } from "../simulation/paramScope";
import { isNativeSpiceRuntime, MAX_NATIVE_OUTPUT_POINTS } from "../engine/nativeSpice";
import { displaySampleIndices, waveformBounds } from "../simulation/waveform";

interface SimulationPanelProps {
  result: AnalysisResult | null;
  opResult: OperatingPointResult | null;
  acResult: AcResult | null;
  dcResult: DcSweepResult | null;
  tfResult: TfResult | null;
  noiseResult: NoiseResult | null;
  stepResult: StepFamilyResult | null;
  measurements: MeasResult[];
  fourier: FourierResult[];
  acMeasurements: MeasResult[];
  dcMeasurements: MeasResult[];
  noiseMeasurements: MeasResult[];
  options: AnalysisOptions;
  isRunning: boolean;
  onOptionsChange: (options: AnalysisOptions) => void;
  onRun: () => void | Promise<void>;
  onRunOperatingPoint: () => void | Promise<void>;
  onRunAcSweep: () => void | Promise<void>;
  onRunDcSweep: () => void | Promise<void>;
  onRunTf: () => void | Promise<void>;
  onRunNoise: () => void | Promise<void>;
  onRunStep: () => void | Promise<void>;
  onStop: () => void;
  onStep: () => void | Promise<void>;
  onClose: () => void;
}

const PLOT_WIDTH = 340;
const PLOT_HEIGHT = 210;
const PLOT_PAD = 26;

export function SimulationPanel({
  result,
  opResult,
  acResult,
  dcResult,
  tfResult,
  noiseResult,
  stepResult,
  measurements,
  fourier,
  acMeasurements,
  dcMeasurements,
  noiseMeasurements,
  options,
  isRunning,
  onOptionsChange,
  onRun,
  onRunOperatingPoint,
  onRunAcSweep,
  onRunDcSweep,
  onRunTf,
  onRunNoise,
  onRunStep,
  onStop,
  onStep,
  onClose,
}: SimulationPanelProps) {
  const components = useSchematic((s) => s.components);
  const wires = useSchematic((s) => s.wires);
  const selectedId = useSchematic((s) => s.selectedId);
  const setValue = useSchematic((s) => s.setValue);
  const beginChange = useSchematic((s) => s.beginChange);
  const probes = useSchematic((s) => s.probes);
  const selectedWireId = useSchematic((s) => s.selectedWireId);
  const netLabels = useSchematic((s) => s.netLabels);
  const directives = useSchematic((s) => s.directives);
  const setNetLabelDirect = useSchematic((s) => s.setNetLabelDirect);
  const editingRef = useRef(false);
  const netLabelEditingRef = useRef(false);
  const selected = components.find((component) => component.id === selectedId) ?? null;
  const selectedWire = wires.find((w) => w.id === selectedWireId) ?? null;
  // Reset undo-tracking refs whenever the selection changes so each new component
  // or wire edit gets its own undo entry from the first keystroke.
  const prevSelectedIdRef = useRef<string | null>(null);
  if (prevSelectedIdRef.current !== selectedId) {
    prevSelectedIdRef.current = selectedId;
    editingRef.current = false;
  }
  const prevWireIdRef = useRef<string | null>(null);
  if (prevWireIdRef.current !== selectedWireId) {
    prevWireIdRef.current = selectedWireId;
    netLabelEditingRef.current = false;
  }
  const selectedEntry = selected ? CATALOG_BY_KIND[selected.kind] : null;
  const opampPart = selected && selected.kind === "opamp" ? findOpAmp(selected.value) : null;
  const warnings = result?.warnings ?? [];

  const [mode, setMode] = useState<"tran" | "op" | "ac" | "dc" | "tf" | "noise" | "step">("tran");
  const [maximized, setMaximized] = useState(false);
  // User-entered expression traces overlaid on the transient scope (§6), e.g.
  // `V(out)-V(in)` or power `V(out)*I(R1)`.
  const [exprList, setExprList] = useState<string[]>([]);
  const [exprInput, setExprInput] = useState("");
  const [exprError, setExprError] = useState<string | null>(null);
  const [netlistError, setNetlistError] = useState<string | null>(null);
  // An LTspice `.raw` loaded as a reference to overlay against Tau's results.
  const [refData, setRefData] = useState<RawData | null>(null);
  const [refError, setRefError] = useState<string | null>(null);
  const refInputRef = useRef<HTMLInputElement | null>(null);

  // Evaluate each saved expression against the latest transient result; drop the
  // ones that no longer resolve (e.g. after a circuit change removes a node).
  const exprTraces = useMemo<Trace[]>(() => {
    const out: Trace[] = [];
    exprList.forEach((expr, i) => {
      const r = evaluatePlotExpression(expr, result, EXPR_COLORS[i % EXPR_COLORS.length]);
      if (r.ok) out.push(r.trace);
    });
    return out;
  }, [exprList, result]);

  // Match a loaded LTspice `.raw` to the current transient result by signal name,
  // resampling each match onto Tau's time grid for overlay + numeric comparison.
  const refOverlay = useMemo(() => {
    if (!refData || !result || !result.ok) return null;
    const signals = [
      ...result.traces.map((t) => ({ label: t.label, values: t.values })),
      ...result.currents.map((c) => ({ label: c.label, values: c.values })),
      ...exprTraces.map((t) => ({ label: t.label, values: t.values })),
    ];
    return buildReferenceOverlay(refData, result.times, signals, REF_COLORS);
  }, [refData, result, exprTraces]);

  const loadReferenceRaw = async (file: File) => {
    try {
      setRefData(parseRaw(await file.arrayBuffer()));
      setRefError(null);
    } catch (err) {
      setRefData(null);
      setRefError(err instanceof Error ? err.message : "Could not read the .raw file.");
    } finally {
      if (refInputRef.current) refInputRef.current.value = "";
    }
  };

  const scopeTraces = useMemo(
    () => (refOverlay ? [...exprTraces, ...refOverlay.traces] : exprTraces),
    [exprTraces, refOverlay],
  );

  const addExpression = () => {
    const expr = exprInput.trim();
    if (!expr) return;
    const probe = evaluatePlotExpression(expr, result, "#000");
    if (!probe.ok) {
      setExprError(probe.error);
      return;
    }
    if (!exprList.includes(expr)) setExprList((prev) => [...prev, expr]);
    setExprInput("");
    setExprError(null);
  };

  // Export the transient result (node voltages + branch currents + any plotted
  // expressions) as a CSV table — one column per signal, one row per timestep.
  const exportCsv = () => {
    if (!result || !result.ok) return;
    const series = [
      ...result.traces.map((t) => ({ label: t.label, values: t.values })),
      ...result.currents.map((c) => ({ label: c.label, values: c.values })),
      ...exprTraces.map((t) => ({ label: t.label, values: t.values })),
    ];
    downloadCsv(seriesToCsv("time", result.times, series), "transient");
  };

  // Export the AC sweep as a CSV table: freq + per-trace magnitude(dB)/phase(°).
  const exportAcCsv = () => {
    if (!acResult || !acResult.ok) return;
    const series = acResult.traces.flatMap((t) => [
      { label: `${t.label} mag(dB)`, values: t.magDb },
      { label: `${t.label} phase(deg)`, values: t.phaseDeg },
    ]);
    downloadCsv(seriesToCsv("freq", acResult.freqs, series), "ac");
  };

  // Export the DC sweep as a CSV table: swept source value + each net's voltage.
  const exportDcCsv = () => {
    if (!dcResult || !dcResult.ok) return;
    const series = dcResult.nets.map((n) => ({ label: n.label, values: n.voltages }));
    downloadCsv(seriesToCsv(dcResult.source, dcResult.sweep, series), "dc");
  };

  // Export the noise analysis as a CSV table: freq + output-referred and
  // input-referred spectral densities (V/√Hz, A/√Hz).
  const exportNoiseCsv = () => {
    if (!noiseResult || !noiseResult.ok) return;
    const series = [
      { label: "onoise (V/sqrtHz)", values: noiseResult.onoise },
      { label: `inoise (${noiseResult.inoiseUnit})`, values: noiseResult.inoise },
    ];
    downloadCsv(seriesToCsv("freq", noiseResult.freqs, series), "noise");
  };
  // Export the generated SPICE netlist as a `.cir` file (LTspice "View → SPICE
  // Netlist"). Builds the same deck the engine runs for the transient analysis,
  // resolving `.param` values; surfaces build errors (no ground, no parts) inline.
  const exportNetlist = () => {
    try {
      const params = directives.length > 0 ? buildParamScope(directives) : undefined;
      const deck = buildSpiceDeck(
        { components, wires, netLabels, params, directives },
        { kind: "tran", stopTime: options.stopTime, steps: options.steps },
      );
      downloadText(deck.netlist, "netlist", "cir", "text/plain");
      setNetlistError(null);
    } catch (err) {
      setNetlistError(err instanceof Error ? err.message : "Could not build the netlist.");
    }
  };

  // Export the transient result as an LTspice binary `.raw` (time + every node
  // voltage / branch current / plotted expression) so it can be opened in
  // LTspice's own waveform viewer for a side-by-side comparison.
  const exportRaw = () => {
    if (!result || !result.ok) return;
    const signals = [
      ...result.traces.map((t) => ({ label: t.label, values: t.values })),
      ...result.currents.map((c) => ({ label: c.label, values: c.values })),
      ...exprTraces.map((t) => ({ label: t.label, values: t.values })),
    ];
    const variables = [
      { index: 0, name: "time", type: "time" },
      ...signals.map((s, i) => ({ index: i + 1, name: s.label, type: inferRawType(s.label) })),
    ];
    const values = [Array.from(result.times), ...signals.map((s) => Array.from(s.values))];
    const bytes = serializeRaw({ plotname: "Transient Analysis", variables, values });
    downloadText(bytes, "transient", "raw", "application/octet-stream");
  };

  const title =
    mode === "tran" ? "Transient scope"
    : mode === "op" ? "Operating point"
    : mode === "ac" ? "AC sweep"
    : mode === "dc" ? "DC sweep"
    : mode === "tf" ? "Transfer function"
    : mode === "noise" ? "Noise analysis"
    : "Step sweep";
  // ngspice may include the final endpoint in addition to requested steps.
  const maxTransientSteps = isNativeSpiceRuntime() ? MAX_NATIVE_OUTPUT_POINTS - 1 : MAX_TRANSIENT_STEPS;
  const resolution = useMemo(() => {
    try {
      return inspectTransientResolution(components, options);
    } catch {
      return null;
    }
  }, [components, options]);

  return (
    <aside className={`plotter${maximized ? " maximized" : ""}`} aria-label="Analysis plotter" aria-busy={isRunning}>
      <div className="plotter-header">
        <div>
          <div className="plotter-kicker">Analysis</div>
          <div className="plotter-title">{title}</div>
        </div>
        <div className="plotter-actions">
          <button className="plotter-icon-action" onClick={onStop} title="Clear transient result" aria-label="Stop simulation">
            ■
          </button>
          <button className="plotter-icon-action" onClick={onStep} title="Re-run transient at finer resolution" aria-label="Refine transient resolution" disabled={isRunning}>
            ◔
          </button>
          <button
            className="plotter-max"
            onClick={() => setMaximized((m) => !m)}
            title={maximized ? "Restore panel" : "Maximize analysis"}
            aria-label="Toggle maximized analysis"
          >
            {maximized ? "⤡" : "⤢"}
          </button>
          <button className="plotter-close" onClick={onClose} title="Minimize graphs" aria-label="Minimize graphs">
            ×
          </button>
          {mode === "tran" ? (
            <>
              <button className="plotter-run" onClick={() => void onRun()} title="Run transient analysis" disabled={isRunning}>
                {isRunning ? "Running" : "▶ Run"}
              </button>
            </>
          ) : (
            <div className="plotter-live">{isRunning ? "Running" : "Ready"}</div>
          )}
        </div>
      </div>

      <div className="plotter-tabs" role="tablist" aria-label="Analysis modes">
        <div className="plotter-tabs-inner">
          <button className={`plotter-tab${mode === "tran" ? " active" : ""}`} role="tab" aria-selected={mode === "tran"} onClick={() => setMode("tran")} disabled={isRunning}>
            TRAN
          </button>
          <button
            className={`plotter-tab${mode === "op" ? " active" : ""}`}
            role="tab"
            aria-selected={mode === "op"}
            disabled={isRunning}
            onClick={() => {
              setMode("op");
              void onRunOperatingPoint();
            }}
          >
            OP
          </button>
          <button
            className={`plotter-tab${mode === "ac" ? " active" : ""}`}
            role="tab"
            aria-selected={mode === "ac"}
            disabled={isRunning}
            onClick={() => {
              setMode("ac");
              void onRunAcSweep();
            }}
          >
            AC
          </button>
          <button
            className={`plotter-tab${mode === "dc" ? " active" : ""}`}
            role="tab"
            aria-selected={mode === "dc"}
            disabled={isRunning}
            onClick={() => {
              setMode("dc");
              void onRunDcSweep();
            }}
          >
            DC
          </button>
          <button
            className={`plotter-tab${mode === "tf" ? " active" : ""}`}
            role="tab"
            aria-selected={mode === "tf"}
            disabled={isRunning}
            onClick={() => {
              setMode("tf");
              void onRunTf();
            }}
          >
            TF
          </button>
          <button
            className={`plotter-tab${mode === "noise" ? " active" : ""}`}
            role="tab"
            aria-selected={mode === "noise"}
            disabled={isRunning}
            onClick={() => {
              setMode("noise");
              void onRunNoise();
            }}
          >
            NOISE
          </button>
          <button
            className={`plotter-tab${mode === "step" ? " active" : ""}`}
            role="tab"
            aria-selected={mode === "step"}
            disabled={isRunning}
            onClick={() => {
              setMode("step");
              void onRunStep();
            }}
          >
            STEP
          </button>
        </div>
      </div>

      {mode === "tran" && (
        <>
          <WaveformPlot result={result} probes={probes} netLabels={netLabels} extraTraces={scopeTraces} />

          <div className="expr-bar">
            <input
              className="expr-input"
              type="text"
              value={exprInput}
              placeholder="Plot an expression, e.g. V(out)-V(in) or V(out)*I(R1)"
              aria-label="Plot expression"
              onChange={(e) => {
                setExprInput(e.currentTarget.value);
                if (exprError) setExprError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") addExpression();
              }}
            />
            <button className="expr-add" onClick={addExpression} disabled={!exprInput.trim()}>
              Add trace
            </button>
            <button
              className="expr-add"
              onClick={exportCsv}
              disabled={!result?.ok}
              title="Export the transient waveforms as a CSV table"
            >
              Export CSV
            </button>
            <button
              className="expr-add"
              onClick={exportNetlist}
              disabled={components.length === 0}
              title="Export the generated SPICE netlist as a .cir file"
            >
              Netlist
            </button>
            <button
              className="expr-add"
              onClick={exportRaw}
              disabled={!result?.ok}
              title="Export the transient waveforms as an LTspice .raw file"
            >
              Save .raw
            </button>
            <button
              className="expr-add"
              onClick={() => refInputRef.current?.click()}
              disabled={!result?.ok}
              title="Overlay an LTspice .raw reference waveform and compare"
            >
              {refData ? "Ref .raw ✓" : "Ref .raw"}
            </button>
            {refData && (
              <button className="expr-add" onClick={() => { setRefData(null); setRefError(null); }} title="Remove the reference overlay">
                Clear ref
              </button>
            )}
            <input
              ref={refInputRef}
              className="file-input"
              type="file"
              accept=".raw"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                if (file) void loadReferenceRaw(file);
              }}
            />
          </div>
          {refError && <div className="expr-error" role="alert">{refError}</div>}
          {refOverlay && (
            <div className="ref-compare">
              {refOverlay.comparisons.length === 0 ? (
                <span className="muted">
                  No reference signal matched a plotted trace
                  {refOverlay.unmatched.length > 0 ? ` (${refOverlay.unmatched.slice(0, 4).join(", ")}…)` : ""}.
                </span>
              ) : (
                refOverlay.comparisons.map((c) => (
                  <span key={c.label} className={c.pass ? "ref-pass" : "ref-fail"}>
                    {c.label}: {(c.normalizedRms * 100).toFixed(2)}% RMS {c.pass ? "✓" : "✗"}
                  </span>
                ))
              )}
            </div>
          )}
          {exprError && <div className="expr-error" role="alert">{exprError}</div>}
          {netlistError && <div className="expr-error" role="alert">{netlistError}</div>}
          {exprList.length > 0 && (
            <div className="expr-list">
              {exprList.map((expr, i) => (
                <span key={expr} className="expr-chip" style={{ borderColor: EXPR_COLORS[i % EXPR_COLORS.length] }}>
                  <i style={{ background: EXPR_COLORS[i % EXPR_COLORS.length] }} />
                  {expr}
                  <button
                    className="expr-remove"
                    aria-label={`Remove ${expr}`}
                    onClick={() => setExprList((prev) => prev.filter((e) => e !== expr))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="meter-row">
            <Metric label="NETS" value={result?.ok ? String(result.stats.netCount) : "--"} tone="green" />
            <Metric label="NODES" value={result?.ok ? String(Math.max(0, result.stats.netCount - 1)) : "--"} tone="cyan" />
            <Metric label="SAMPLES" value={result?.ok ? String(result.stats.sampleCount) : "--"} tone="cream" />
          </div>

          <MeasTable measurements={measurements} />
          <FourierTable results={fourier} />
          <FftView result={result} />
          <CursorView result={result} extraTraces={exprTraces} />

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
              max={maxTransientSteps}
              step={1}
              numericValue={options.steps}
              onChange={(value) => onOptionsChange({ ...options, steps: Math.round(value) })}
            />
            <ResolutionControl
              resolution={resolution}
              steps={options.steps}
              maxSteps={maxTransientSteps}
              onApply={() => {
                if (!resolution || resolution.requiredSteps <= 0 || resolution.requiredSteps > maxTransientSteps) return;
                onOptionsChange({ ...options, steps: Math.max(32, resolution.requiredSteps) });
              }}
            />
          </div>
        </>
      )}

      {mode === "op" && <OpTable result={opResult} />}
      {mode === "ac" && (
        <>
          <AcPlot result={acResult} />
          <div className="expr-bar">
            <button className="expr-add" onClick={exportAcCsv} disabled={!acResult?.ok} title="Export the AC sweep as a CSV table">
              Export CSV
            </button>
          </div>
          <MeasTable measurements={acMeasurements} />
        </>
      )}
      {mode === "dc" && (
        <>
          <DcPlot result={dcResult} />
          <div className="expr-bar">
            <button className="expr-add" onClick={exportDcCsv} disabled={!dcResult?.ok} title="Export the DC sweep as a CSV table">
              Export CSV
            </button>
          </div>
          <MeasTable measurements={dcMeasurements} />
        </>
      )}
      {mode === "tf" && <TfTable result={tfResult} />}
      {mode === "noise" && (
        <>
          <NoisePlot result={noiseResult} />
          <div className="expr-bar">
            <button className="expr-add" onClick={exportNoiseCsv} disabled={!noiseResult?.ok} title="Export the noise spectrum as a CSV table">
              Export CSV
            </button>
          </div>
          <MeasTable measurements={noiseMeasurements} />
        </>
      )}
      {mode === "step" && <StepPlot result={stepResult} probes={probes} />}

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
                  <label key={f.key} className={`value-editor${f.unit ? " engineering-value-editor" : ""}`}>
                    <span>{f.label}</span>
                    {f.unit ? (
                      <EngineeringInput
                        label={f.label}
                        value={decodeParams(selected.kind, selected.value)[f.key] ?? ""}
                        unit={f.unit}
                        onBeginChange={() => {
                          if (!editingRef.current) {
                            beginChange();
                            editingRef.current = true;
                          }
                        }}
                        onValueChange={(value) => {
                          const next = {
                            ...decodeParams(selected.kind, selected.value),
                            [f.key]: value,
                          };
                          setValue(selected.id, encodeParams(selected.kind, next));
                        }}
                      />
                    ) : (
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
                    )}
                  </label>
                ))}
              </div>
            ) : (
              <div className="selected-part muted">No parameters</div>
            )}
          </>
        ) : selectedWire ? (
          <>
            <div className="selected-part">
              <span>Net</span>
              <small>wire segment</small>
            </div>
            <label className="value-editor">
              <span>NET NAME</span>
              <input
                value={
                  netLabels.find((l) => l.x === selectedWire.points[0].x && l.y === selectedWire.points[0].y)?.text ?? ""
                }
                placeholder="e.g. Vout"
                onFocus={() => { netLabelEditingRef.current = false; }}
                onBlur={() => {
                  // On blur, commit a final upsert so deletion (empty text) is recorded cleanly.
                  netLabelEditingRef.current = false;
                }}
                onChange={(event) => {
                  if (!netLabelEditingRef.current) {
                    beginChange();
                    netLabelEditingRef.current = true;
                  }
                  setNetLabelDirect(selectedWire.points[0].x, selectedWire.points[0].y, event.currentTarget.value);
                }}
                spellCheck={false}
              />
            </label>
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

function WaveformPlot({
  result,
  probes,
  netLabels,
  extraTraces = [],
}: {
  result: AnalysisResult | null;
  probes: Probe[];
  netLabels: NetLabel[];
  /** User-entered expression traces overlaid on the scope (§6). */
  extraTraces?: Trace[];
}) {
  const success = result?.ok ? result : null;

  // With probes, show exactly the probed nets in their probe colors; otherwise
  // fall back to the first few node voltages. User expression traces are always
  // overlaid on top of whichever node set is shown.
  const traces = useMemo<Trace[]>(() => {
    if (!success) return [];
    let base: Trace[];
    if (probes.length === 0) {
      base = success.traces.slice(0, 6);
    } else {
      base = [];
      for (const probe of probes) {
        const net = success.circuit.nets.find(
          (n) => !n.isGround && n.points.some((pt) => pt.x === probe.x && pt.y === probe.y),
        );
        if (!net) continue;
        const trace = success.traces.find((tr) => tr.id === net.id);
        if (trace && !base.some((o) => o.id === trace.id)) base.push({ ...trace, color: probe.color });
      }
    }
    return [...base, ...extraTraces];
  }, [success, probes, extraTraces]);

  const plot = useMemo(() => {
    if (!success || traces.length === 0) return null;
    const { min, max } = waveformBounds(traces);
    const tMax = success.times[success.times.length - 1] || 1;
    // Label the value axis by the traces' shared physical unit (amps for a
    // probed branch current, watts for a V·I power expression); fall back to
    // volts when the pane mixes units or carries only node voltages.
    const unit = commonTraceUnit(traces.map((t) => t.unit)) || "V";
    return { min, max, tMax, unit };
  }, [success, traces]);

  // Prefer a user-assigned net name (V(Vout)) over the auto V(R1·C1) label.
  const labelFor = (trace: Trace) => {
    if (!success) return trace.label;
    const net = success.circuit.nets.find((n) => n.id === trace.id);
    if (net) {
      const lbl = netLabels.find((l) => net.points.some((pt) => pt.x === l.x && pt.y === l.y));
      if (lbl) return `V(${lbl.text})`;
    }
    return trace.label;
  };

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
            <path
              key={trace.id}
              className={trace.id.startsWith("ref:") ? "scope-trace ref" : "scope-trace"}
              stroke={trace.color}
              d={tracePath(trace, success!.times, plot.min, plot.max, plot.tMax)}
            />
          ))}
        <text className="scope-axis" x={PLOT_PAD} y={18}>
          {plot ? formatEngineering(plot.max, plot.unit, 2) : "MAX"}
        </text>
        <text className="scope-axis" x={PLOT_PAD} y={PLOT_HEIGHT - 8}>
          {plot ? formatEngineering(plot.min, plot.unit, 2) : "MIN"}
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
              {labelFor(trace)}
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
  const sampleCount = Math.min(trace.values.length, times.length);
  let path = "";
  let started = false;
  for (const index of displaySampleIndices(sampleCount)) {
    const value = trace.values[index];
    const time = times[index];
    if (!Number.isFinite(value) || !Number.isFinite(time)) continue;
    const x = PLOT_PAD + (time / tMax) * (PLOT_WIDTH - PLOT_PAD * 2);
    const y = PLOT_HEIGHT - PLOT_PAD - ((value - min) / (max - min || 1)) * (PLOT_HEIGHT - PLOT_PAD * 2);
    path += `${started ? "L" : "M"} ${x.toFixed(2)} ${y.toFixed(2)} `;
    started = true;
  }
  return path;
}

function OpTable({ result }: { result: OperatingPointResult | null }) {
  if (!result) return null;
  if (!result.ok) return <div className="analysis-empty">{result.message}</div>;
  // Avoid Math.max(...spread) over a potentially large array — use reduce instead.
  const maxAbs = result.nets.reduce((acc, net) => Math.max(acc, Math.abs(net.voltage)), 0);
  return (
    <>
      <div className="meter-row analysis-meter">
        <Metric label="NODES" value={String(Math.max(0, result.nets.length - 1))} tone="green" />
        <Metric label="GROUND" value="OK" tone="cyan" />
        <Metric label="MAX" value={formatEngineering(maxAbs, "V", 2)} tone="cream" />
      </div>
      <div className="op-table">
        <div className="op-row op-head">
          <span>NODE</span>
          <span>DC VOLTAGE</span>
        </div>
        {result.nets.map((n) => (
          <div className="op-row" key={n.id}>
            <span>{n.label}</span>
            <span>{formatEngineering(n.voltage, "V", 3)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/** Small-signal `.tf` results: gain, input impedance, output impedance. */
function TfTable({ result }: { result: TfResult | null }) {
  if (!result) return null;
  if (!result.ok) return <div className="analysis-empty">{result.message}</div>;
  const ohms = (v: number) => (Number.isFinite(v) ? formatEngineering(v, "Ω", 3) : "∞ Ω");
  const gainText =
    result.gainUnit === "Ω"
      ? formatEngineering(result.gain, "Ω", 4)
      : result.gainUnit === "A/V"
        ? `${formatEngineering(result.gain, "S", 4)}`
        : result.gain.toPrecision(5);
  return (
    <>
      <div className="meter-row analysis-meter">
        <Metric label="GAIN" value={gainText} tone="green" />
        <Metric label="ZIN" value={ohms(result.inputImpedance)} tone="cyan" />
        <Metric label="ZOUT" value={ohms(result.outputImpedance)} tone="cream" />
      </div>
      <div className="op-table">
        <div className="op-row op-head">
          <span>QUANTITY</span>
          <span>VALUE</span>
        </div>
        <div className="op-row">
          <span>{result.gainLabel}</span>
          <span>{gainText}</span>
        </div>
        <div className="op-row">
          <span>Input impedance at {result.spec.source}</span>
          <span>{ohms(result.inputImpedance)}</span>
        </div>
        <div className="op-row">
          <span>Output impedance</span>
          <span>{ohms(result.outputImpedance)}</span>
        </div>
      </div>
      {result.warnings.length > 0 && (
        <div className="analysis-empty">{result.warnings.join(" ")}</div>
      )}
    </>
  );
}

/**
 * Plot a `.noise` analysis: output-referred noise density vs frequency on a
 * log–log scale (frequency decades on X, V/√Hz decades on Y), with the
 * integrated total output / input-referred noise in the metric row. Mirrors
 * {@link AcPlot}'s log-frequency mapping but maps a single positive density
 * trace through log10 rather than dB.
 */
function NoisePlot({ result }: { result: NoiseResult | null }) {
  const success = result?.ok ? result : null;
  const plot = useMemo(() => {
    if (!success) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of success.onoise) {
      if (!Number.isFinite(v) || v <= 0) continue;
      const l = Math.log10(v);
      lo = Math.min(lo, l);
      hi = Math.max(hi, l);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    // Pad to whole decades and guarantee a non-zero span for a flat spectrum.
    let yMin = Math.floor(lo);
    let yMax = Math.ceil(hi);
    if (yMax - yMin < 1) {
      yMin = Math.floor(lo - 0.5);
      yMax = Math.ceil(hi + 0.5);
    }
    const f0 = Math.log10(success.freqs[0] || 1);
    const f1 = Math.log10(success.freqs[success.freqs.length - 1] || 10);
    return { yMin, yMax, f0, f1 };
  }, [success]);

  if (!result) return null;
  if (!result.ok) return <div className="analysis-empty">{result.message}</div>;

  const path = plot ? noisePath(result.onoise, result.freqs, plot) : "";
  const decadeLabel = (exp: number) => formatEngineering(Math.pow(10, exp), "V/√Hz", 1);

  return (
    <>
      <div className="scope-shell">
        <svg className="scope-svg" viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`} role="img" aria-label="Output noise density">
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
          {path && <path className="scope-trace" stroke="var(--trace-red)" d={path} />}
          <text className="scope-axis" x={PLOT_PAD} y={18}>
            {plot ? decadeLabel(plot.yMax) : "V/√Hz"}
          </text>
          <text className="scope-axis" x={PLOT_PAD} y={PLOT_HEIGHT - 8}>
            {plot ? decadeLabel(plot.yMin) : ""}
          </text>
          <text className="scope-axis right" x={PLOT_WIDTH - PLOT_PAD} y={PLOT_HEIGHT - 8}>
            {formatEngineering(result.freqs[result.freqs.length - 1] ?? 0, "Hz", 0)}
          </text>
        </svg>
        <div className="scope-legend">
          <span>
            <i style={{ background: "var(--trace-red)" }} />
            Output noise V({result.spec.output.pos}
            {result.spec.output.neg ? `,${result.spec.output.neg}` : ""})
          </span>
        </div>
      </div>
      <div className="meter-row analysis-meter">
        <Metric label="TOT ONOISE" value={formatEngineering(result.totalOutputNoise, "V", 3)} tone="green" />
        <Metric label="TOT INOISE" value={formatEngineering(result.totalInputNoise, result.inoiseUnit.replace("/√Hz", ""), 3)} tone="cyan" />
        <Metric label="POINTS" value={String(result.freqs.length)} tone="cream" />
      </div>
      {result.warnings.length > 0 && <div className="analysis-empty">{result.warnings.join(" ")}</div>}
    </>
  );
}

function noisePath(onoise: number[], freqs: number[], plot: { yMin: number; yMax: number; f0: number; f1: number }): string {
  const span = plot.yMax - plot.yMin || 1;
  const fSpan = plot.f1 - plot.f0 || 1;
  const count = Math.min(onoise.length, freqs.length);
  let path = "";
  let started = false;
  for (const index of displaySampleIndices(count)) {
    const v = onoise[index];
    const frequency = freqs[index];
    if (!Number.isFinite(v) || v <= 0 || !Number.isFinite(frequency) || frequency <= 0) continue;
    const lx = (Math.log10(frequency) - plot.f0) / fSpan;
    const x = PLOT_PAD + lx * (PLOT_WIDTH - PLOT_PAD * 2);
    const ly = Math.max(plot.yMin, Math.min(plot.yMax, Math.log10(v)));
    const y = PLOT_HEIGHT - PLOT_PAD - ((ly - plot.yMin) / span) * (PLOT_HEIGHT - PLOT_PAD * 2);
    path += `${started ? "L" : "M"} ${x.toFixed(2)} ${y.toFixed(2)} `;
    started = true;
  }
  return path;
}

/** Trigger a browser download of `content` under a dated, tagged file name. */
function downloadText(content: BlobPart, tag: string, ext: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tau-${tag}-${new Date().toISOString().slice(0, 10)}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Trigger a browser download of CSV text with a dated, analysis-tagged name. */
function downloadCsv(csv: string, tag: string): void {
  downloadText(csv, tag, "csv", "text/csv");
}

const AC_COLORS = ["var(--trace-cyan)", "var(--trace-green)", "var(--trace-cream)", "var(--trace-red)"];
// Distinct ramp for user expression traces so they stand out from node traces.
const EXPR_COLORS = ["var(--trace-red)", "var(--trace-cream)", "var(--trace-cyan)", "var(--trace-green)"];
// Reference (.raw overlay) traces — drawn dashed (see `.scope-trace.ref`).
const REF_COLORS = ["var(--trace-amber)", "var(--trace-purple)", "var(--trace-cream)", "var(--trace-green)"];

/**
 * FFT of a transient signal — LTspice's "View → FFT". Resamples the chosen
 * waveform onto a uniform grid, windows it, and shows the one-sided amplitude
 * spectrum on a log-frequency / dB axis. Collapsed by default so the (heavier)
 * transform only runs when the user opens it. Reuses {@link bodePath} for the
 * log-frequency / dB mapping it shares with the Bode plot.
 */
function FftView({ result }: { result: AnalysisResult | null }) {
  const [open, setOpen] = useState(false);
  const [signal, setSignal] = useState<string>("");
  const [windowFn, setWindowFn] = useState<WindowFn>("hann");

  const success = result?.ok ? result : null;
  const signals = useMemo(() => {
    if (!success) return [];
    return [...success.traces.map((t) => t.label), ...success.currents.map((c) => c.label)];
  }, [success]);
  const chosen = signal && signals.includes(signal) ? signal : signals[0] ?? "";

  const spectrum = useMemo(() => {
    if (!open || !success || !chosen) return null;
    try {
      return runWaveformFft(success, chosen, { window: windowFn });
    } catch {
      return null;
    }
  }, [open, success, chosen, windowFn]);

  const plot = useMemo(() => {
    if (!spectrum) return null;
    let rawMin = 0;
    let rawMax = 0;
    let found = false;
    for (let k = 1; k < spectrum.magnitudeDb.length; k++) {
      const db = spectrum.magnitudeDb[k];
      if (!Number.isFinite(db) || db <= -250) continue;
      if (!found) {
        rawMin = db;
        rawMax = db;
        found = true;
      } else {
        rawMin = Math.min(rawMin, db);
        rawMax = Math.max(rawMax, db);
      }
    }
    const maxDb = Math.ceil(rawMax / 10) * 10;
    const minDb = Math.floor(Math.min(rawMin, maxDb - 60) / 10) * 10;
    // Skip the DC bin (freq 0) — it has no place on a log axis.
    const positive = spectrum.frequencies.filter((f) => f > 0);
    const f0 = Math.log10(positive[0] || 1);
    const f1 = Math.log10(positive[positive.length - 1] || 10);
    return { minDb, maxDb, f0, f1 };
  }, [spectrum]);

  if (!success) return null;

  return (
    <div className="fft-view">
      <button
        className="fft-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Toggle FFT spectrum"
      >
        {open ? "▾" : "▸"} FFT spectrum
      </button>
      {open && (
        <>
          <div className="expr-bar">
            <select
              className="expr-input"
              value={chosen}
              aria-label="FFT signal"
              onChange={(e) => setSignal(e.currentTarget.value)}
            >
              {signals.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              className="expr-add"
              value={windowFn}
              aria-label="FFT window"
              onChange={(e) => setWindowFn(e.currentTarget.value as WindowFn)}
            >
              <option value="hann">Hann</option>
              <option value="hamming">Hamming</option>
              <option value="blackman">Blackman</option>
              <option value="rectangular">Rectangular</option>
            </select>
          </div>
          <div className="scope-shell">
            <svg className="scope-svg" viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`} role="img" aria-label="FFT magnitude">
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
              {plot && spectrum && (
                <path className="scope-trace" stroke={AC_COLORS[0]} d={bodePath(spectrum.magnitudeDb, spectrum.frequencies, plot)} />
              )}
              <text className="scope-axis" x={PLOT_PAD} y={18}>
                {plot ? `${plot.maxDb} dB` : "dB"}
              </text>
              <text className="scope-axis" x={PLOT_PAD} y={PLOT_HEIGHT - 8}>
                {plot ? `${plot.minDb} dB` : ""}
              </text>
              <text className="scope-axis right" x={PLOT_WIDTH - PLOT_PAD} y={PLOT_HEIGHT - 8}>
                {spectrum ? formatEngineering(spectrum.frequencies[spectrum.frequencies.length - 1], "Hz", 0) : "f"}
              </text>
            </svg>
            <div className="scope-legend">
              {spectrum ? (
                <span>
                  <i style={{ background: AC_COLORS[0] }} />
                  {chosen}
                </span>
              ) : (
                <span className="muted">No spectrum</span>
              )}
            </div>
          </div>
          <div className="meter-row analysis-meter">
            <Metric
              label="PEAK f"
              value={spectrum ? formatEngineering(dominantFrequency(spectrum), "Hz", 1) : "--"}
              tone="green"
            />
            <Metric
              label="THD"
              value={spectrum ? `${(spectrumThd(spectrum).thd * 100).toFixed(2)}%` : "--"}
              tone="cyan"
            />
            <Metric
              label="DC"
              value={spectrum ? formatEngineering(spectrum.magnitude[0], "V", 2) : "--"}
              tone="cream"
            />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Measurement cursors (§6) — two positions along the time axis with a per-trace
 * value + delta readout (LTspice's "1 & 2" cursors). Positions are sliders
 * (0–100% of the run) so there is no canvas drag to get wrong; the readout comes
 * from the unit-tested `cursorReadout`.
 */
function CursorView({ result, extraTraces }: { result: AnalysisResult | null; extraTraces: Trace[] }) {
  const [open, setOpen] = useState(false);
  const [f1, setF1] = useState(0.25);
  const [f2, setF2] = useState(0.75);

  const success = result?.ok ? result : null;
  const signals = useMemo<CursorTraceInput[]>(() => {
    if (!success) return [];
    return [
      ...success.traces.map((t) => ({ label: t.label, values: t.values })),
      ...success.currents.map((c) => ({ label: c.label, values: c.values })),
      ...extraTraces.map((t) => ({ label: t.label, values: t.values })),
    ];
  }, [success, extraTraces]);

  const readout = useMemo(() => {
    if (!open || !success || signals.length === 0) return null;
    try {
      const x1 = fractionToX(success.times, f1);
      const x2 = fractionToX(success.times, f2);
      return cursorReadout(success.times, signals, x1, x2);
    } catch {
      return null;
    }
  }, [open, success, signals, f1, f2]);

  if (!success) return null;

  return (
    <div className="fft-view">
      <button
        className="fft-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Toggle measurement cursors"
      >
        {open ? "▾" : "▸"} Cursors
      </button>
      {open && (
        <>
          <div className="cursor-sliders">
            <label>
              C1
              <input
                type="range" min={0} max={1000} value={Math.round(f1 * 1000)}
                aria-label="Cursor 1 position"
                onChange={(e) => setF1(Number(e.currentTarget.value) / 1000)}
              />
            </label>
            <label>
              C2
              <input
                type="range" min={0} max={1000} value={Math.round(f2 * 1000)}
                aria-label="Cursor 2 position"
                onChange={(e) => setF2(Number(e.currentTarget.value) / 1000)}
              />
            </label>
          </div>
          {readout && (
            <div className="meter-row analysis-meter">
              <Metric label="t1" value={formatEngineering(readout.x1, "s", 3)} tone="cyan" />
              <Metric label="t2" value={formatEngineering(readout.x2, "s", 3)} tone="cyan" />
              <Metric label="Δt" value={formatEngineering(readout.dx, "s", 3)} tone="green" />
              <Metric
                label="1/Δt"
                value={Number.isFinite(readout.inverseDx) ? formatEngineering(readout.inverseDx, "Hz", 3) : "--"}
                tone="cream"
              />
            </div>
          )}
          {readout && (
            <table className="cursor-table">
              <thead>
                <tr><th>Signal</th><th>@C1</th><th>@C2</th><th>Δ</th></tr>
              </thead>
              <tbody>
                {readout.traces.map((t) => (
                  <tr key={t.label}>
                    <td>{t.label}</td>
                    <td>{formatEngineering(t.y1, "V", 3)}</td>
                    <td>{formatEngineering(t.y2, "V", 3)}</td>
                    <td>{formatEngineering(t.dy, "V", 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function AcPlot({ result }: { result: AcResult | null }) {
  const success = result?.ok ? result : null;
  const traces = success ? success.traces.slice(0, 4) : [];
  const plot = useMemo(() => {
    if (!success || traces.length === 0) return null;
    let rawMin = 0;
    let rawMax = 0;
    let found = false;
    for (const trace of traces) {
      for (const db of trace.magDb) {
        if (!Number.isFinite(db) || db <= -250) continue;
        if (!found) {
          rawMin = db;
          rawMax = db;
          found = true;
        } else {
          rawMin = Math.min(rawMin, db);
          rawMax = Math.max(rawMax, db);
        }
      }
    }
    const maxDb = Math.ceil(Math.max(rawMax, 0) / 10) * 10;
    const minDb = Math.floor(Math.min(rawMin, maxDb - 10) / 10) * 10;
    const f0 = Math.log10(success.freqs[0] || 1);
    const f1 = Math.log10(success.freqs[success.freqs.length - 1] || 10);
    return { minDb, maxDb, f0, f1 };
  }, [success, traces]);

  if (!result) return null;
  if (!result.ok) return <div className="analysis-empty">{result.message}</div>;
  let peak = -Infinity;
  for (const trace of traces) {
    for (const db of trace.magDb) {
      if (Number.isFinite(db)) peak = Math.max(peak, db);
    }
  }

  return (
    <>
      <div className="scope-shell">
        <svg className="scope-svg" viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`} role="img" aria-label="Bode magnitude">
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
            traces.map((t, i) => (
              <path key={t.id} className="scope-trace" stroke={AC_COLORS[i % AC_COLORS.length]} d={bodePath(t.magDb, success!.freqs, plot)} />
            ))}
          <text className="scope-axis" x={PLOT_PAD} y={18}>
            {plot ? `${plot.maxDb} dB` : "dB"}
          </text>
          <text className="scope-axis" x={PLOT_PAD} y={PLOT_HEIGHT - 8}>
            {plot ? `${plot.minDb} dB` : ""}
          </text>
          <text className="scope-axis right" x={PLOT_WIDTH - PLOT_PAD} y={PLOT_HEIGHT - 8}>
            {success ? formatEngineering(success.freqs[success.freqs.length - 1], "Hz", 0) : "f"}
          </text>
        </svg>
        <div className="scope-legend">
          {traces.length > 0 ? (
            traces.map((t, i) => (
              <span key={t.id}>
                <i style={{ background: AC_COLORS[i % AC_COLORS.length] }} />
                {t.label}
              </span>
            ))
          ) : (
            <span className="muted">No traces</span>
          )}
        </div>
      </div>
      <div className="meter-row analysis-meter">
        <Metric label="START" value={formatEngineering(result.freqs[0] ?? 0, "Hz", 0)} tone="green" />
        <Metric label="POINTS" value={String(result.freqs.length)} tone="cyan" />
        <Metric label="PEAK" value={Number.isFinite(peak) ? `${peak.toFixed(1)} dB` : "--"} tone="cream" />
      </div>
    </>
  );
}

function bodePath(magDb: number[], freqs: number[], plot: { minDb: number; maxDb: number; f0: number; f1: number }): string {
  const span = plot.maxDb - plot.minDb || 1;
  const fSpan = plot.f1 - plot.f0 || 1;
  const count = Math.min(magDb.length, freqs.length);
  let path = "";
  let started = false;
  for (const index of displaySampleIndices(count)) {
    const db = magDb[index];
    const frequency = freqs[index];
    if (!Number.isFinite(db) || !Number.isFinite(frequency) || frequency <= 0) continue;
    const lx = (Math.log10(frequency) - plot.f0) / fSpan;
    const x = PLOT_PAD + lx * (PLOT_WIDTH - PLOT_PAD * 2);
    const yv = Math.max(plot.minDb, Math.min(plot.maxDb, db));
    const y = PLOT_HEIGHT - PLOT_PAD - ((yv - plot.minDb) / span) * (PLOT_HEIGHT - PLOT_PAD * 2);
    path += `${started ? "L" : "M"} ${x.toFixed(2)} ${y.toFixed(2)} `;
    started = true;
  }
  return path;
}

/**
 * Plot a `.dc` source sweep: the swept source value on a linear X axis, each
 * node's voltage on a linear Y axis. Mirrors {@link AcPlot} but without the log
 * frequency mapping. The ground net (label "GND") is dropped — it is always 0 V.
 */
function DcPlot({ result }: { result: DcSweepResult | null }) {
  const traces = result?.ok ? result.nets.filter((n) => !n.ground).slice(0, 6) : [];
  const sweep = result?.ok ? result.sweep : [];
  const plot = useMemo(() => {
    if (traces.length === 0 || sweep.length === 0) return null;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const net of traces) {
      for (const v of net.voltages) {
        if (!Number.isFinite(v)) continue;
        vMin = Math.min(vMin, v);
        vMax = Math.max(vMax, v);
      }
    }
    if (!Number.isFinite(vMin) || !Number.isFinite(vMax)) return null;
    // Pad a flat trace so it sits mid-frame instead of on an axis edge.
    if (vMax - vMin < 1e-12) {
      vMin -= 0.5;
      vMax += 0.5;
    }
    const xMin = sweep[0];
    const xMax = sweep[sweep.length - 1];
    return { vMin, vMax, xMin, xMax };
  }, [traces, sweep]);

  if (!result) return null;
  if (!result.ok) return <div className="analysis-empty">{result.message}</div>;

  return (
    <>
      <div className="scope-shell">
        <svg className="scope-svg" viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`} role="img" aria-label="DC sweep plot">
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
            traces.map((net, i) => (
              <path key={net.id} className="scope-trace" stroke={AC_COLORS[i % AC_COLORS.length]} d={dcPath(net.voltages, sweep, plot)} />
            ))}
          <text className="scope-axis" x={PLOT_PAD} y={18}>
            {plot ? formatEngineering(plot.vMax, "V", 2) : "MAX"}
          </text>
          <text className="scope-axis" x={PLOT_PAD} y={PLOT_HEIGHT - 8}>
            {plot ? formatEngineering(plot.vMin, "V", 2) : "MIN"}
          </text>
          <text className="scope-axis right" x={PLOT_WIDTH - PLOT_PAD} y={PLOT_HEIGHT - 8}>
            {plot ? `${result.source} ${formatEngineering(plot.xMax, "", 2)}` : result.source}
          </text>
        </svg>
        <div className="scope-legend">
          {traces.length > 0 ? (
            traces.map((net, i) => (
              <span key={net.id}>
                <i style={{ background: AC_COLORS[i % AC_COLORS.length] }} />
                {net.label}
              </span>
            ))
          ) : (
            <span className="muted">No traces</span>
          )}
        </div>
      </div>
      <div className="meter-row analysis-meter">
        <Metric label="SWEEP" value={result.source} tone="green" />
        <Metric label="POINTS" value={String(sweep.length)} tone="cyan" />
        <Metric label="NETS" value={String(traces.length)} tone="cream" />
      </div>
    </>
  );
}

/** Map a DC sweep net series to an SVG polyline over a linear X (sweep) / Y (volts) frame. */
function dcPath(
  voltages: number[],
  sweep: number[],
  plot: { vMin: number; vMax: number; xMin: number; xMax: number },
): string {
  const vSpan = plot.vMax - plot.vMin || 1;
  const xSpan = plot.xMax - plot.xMin || 1;
  const count = Math.min(voltages.length, sweep.length);
  let path = "";
  let started = false;
  for (const index of displaySampleIndices(count)) {
    const v = voltages[index];
    const sx = sweep[index];
    if (!Number.isFinite(v) || !Number.isFinite(sx)) continue;
    const x = PLOT_PAD + ((sx - plot.xMin) / xSpan) * (PLOT_WIDTH - PLOT_PAD * 2);
    const yv = Math.max(plot.vMin, Math.min(plot.vMax, v));
    const y = PLOT_HEIGHT - PLOT_PAD - ((yv - plot.vMin) / vSpan) * (PLOT_HEIGHT - PLOT_PAD * 2);
    path += `${started ? "L" : "M"} ${x.toFixed(2)} ${y.toFixed(2)} `;
    started = true;
  }
  return path;
}

// A wider ramp than AC_COLORS so a family of up to MAX_FAMILY_MEMBERS curves
// stays distinguishable. All entries are App.css trace variables (no hardcoding).
const STEP_COLORS = [
  "var(--trace-cyan)",
  "var(--trace-green)",
  "var(--trace-cream)",
  "var(--trace-red)",
  "var(--trace-purple)",
  "var(--trace-amber)",
];

/**
 * Overlay a `.step` family: re-run a transient once per swept value and draw the
 * same signal across the family, one colored curve per step (FEATURE_PARITY §6
 * family-of-curves). The plotted signal follows the probe (first probed net),
 * falling back to the first trace, matching the transient scope.
 */
function StepPlot({ result, probes }: { result: StepFamilyResult | null; probes: Probe[] }) {
  // Members whose run succeeded, paired with the chosen trace for each.
  const family = useMemo(() => {
    if (!result?.ok) return null;
    const ok = result.members.filter((m) => m.result.ok);
    if (ok.length === 0) return null;
    const first = ok[0].result;
    if (!first.ok) return null;
    const traceId = pickFamilyTraceId(first, probes);
    if (!traceId) return null;
    const series = ok
      .map((m) => {
        if (!m.result.ok) return null;
        const trace = m.result.traces.find((t) => t.id === traceId);
        if (!trace) return null;
        return { label: m.label, times: m.result.times, trace };
      })
      .filter((s): s is { label: string; times: number[]; trace: Trace } => s !== null);
    if (series.length === 0) return null;
    const { min, max } = waveformBounds(series.map((s) => s.trace));
    const tMax = series.reduce((acc, s) => Math.max(acc, s.times[s.times.length - 1] || 0), 0) || 1;
    const signal = first.traces.find((t) => t.id === traceId)?.label ?? "V";
    return { series, min, max, tMax, signal };
  }, [result, probes]);

  if (!result) return null;
  if (!result.ok) return <div className="analysis-empty">{result.message ?? "No step sweep to show."}</div>;
  if (!family) return <div className="analysis-empty">Step ran, but the selected signal has no data. Probe a node or check the sweep.</div>;

  return (
    <>
      <div className="scope-shell">
        <svg className="scope-svg" viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`} role="img" aria-label="Step family plot">
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
          {family.series.map((s, i) => (
            <path
              key={s.label}
              className="scope-trace"
              stroke={STEP_COLORS[i % STEP_COLORS.length]}
              d={tracePath(s.trace, s.times, family.min, family.max, family.tMax)}
            />
          ))}
          <text className="scope-axis" x={PLOT_PAD} y={18}>
            {formatEngineering(family.max, "V", 2)}
          </text>
          <text className="scope-axis" x={PLOT_PAD} y={PLOT_HEIGHT - 8}>
            {formatEngineering(family.min, "V", 2)}
          </text>
          <text className="scope-axis right" x={PLOT_WIDTH - PLOT_PAD} y={PLOT_HEIGHT - 8}>
            {formatEngineering(family.tMax, "s", 2)}
          </text>
        </svg>
        <div className="scope-legend">
          {family.series.map((s, i) => (
            <span key={s.label}>
              <i style={{ background: STEP_COLORS[i % STEP_COLORS.length] }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div className="meter-row analysis-meter">
        <Metric label="SIGNAL" value={family.signal} tone="green" />
        <Metric label="STEPS" value={String(family.series.length)} tone="cyan" />
        <Metric label="SWEEP" value={result.spec?.name ?? "--"} tone="cream" />
      </div>
    </>
  );
}

/** Pick the trace to plot across a step family: the first probed net's trace,
 *  else the first trace — mirroring the transient scope's selection. */
function pickFamilyTraceId(success: Extract<AnalysisResult, { ok: true }>, probes: Probe[]): string | null {
  for (const probe of probes) {
    const net = success.circuit.nets.find(
      (n) => !n.isGround && n.points.some((pt) => pt.x === probe.x && pt.y === probe.y),
    );
    if (!net) continue;
    const trace = success.traces.find((t) => t.id === net.id);
    if (trace) return trace.id;
  }
  return success.traces[0]?.id ?? null;
}

/** A compact table of `.meas` results, shown under the transient scope. */
function MeasTable({ measurements }: { measurements: MeasResult[] }) {
  if (measurements.length === 0) return null;
  return (
    <div className="meas-table" role="table" aria-label="Measurements">
      <div className="meas-table-head" role="row">
        <span role="columnheader">MEASURE</span>
        <span role="columnheader">VALUE</span>
      </div>
      {measurements.map((m) => (
        <div className="meas-row" role="row" key={m.name}>
          <span className="meas-name" role="cell">{m.name}</span>
          <span className={`meas-value${m.value === null ? " meas-fail" : ""}`} role="cell" title={m.error}>
            {m.value === null ? (m.error ?? "—") : formatEngineering(m.value, "", 4)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** `.four` Fourier results, shown under the transient scope: per output a THD
 *  header then DC / fundamental / harmonic magnitudes (normalized to fundamental). */
function FourierTable({ results }: { results: FourierResult[] }) {
  if (results.length === 0) return null;
  return (
    <div className="meas-table" role="table" aria-label="Fourier analysis">
      {results.map((r) => (
        <div key={r.output}>
          <div className="meas-table-head" role="row">
            <span role="columnheader">FOURIER {r.output}</span>
            <span role="columnheader">THD {(r.thd * 100).toFixed(3)}%</span>
          </div>
          {r.harmonics.map((h) => {
            const name = h.harmonic === 0
              ? "DC"
              : h.harmonic === 1
                ? `f₀ ${formatEngineering(h.frequency, "Hz", 3)}`
                : `${h.harmonic}× ${formatEngineering(h.frequency, "Hz", 3)}`;
            const norm = h.harmonic >= 1 ? ` (${h.normalized.toFixed(4)})` : "";
            return (
              <div className="meas-row" role="row" key={h.harmonic}>
                <span className="meas-name" role="cell">{name}</span>
                <span className="meas-value" role="cell">
                  {formatEngineering(h.magnitude, "", 4)}{norm}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
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

function ResolutionControl({
  resolution,
  steps,
  maxSteps,
  onApply,
}: {
  resolution: ReturnType<typeof inspectTransientResolution> | null;
  steps: number;
  maxSteps: number;
  onApply: () => void;
}) {
  if (!resolution || resolution.maxFrequencyHz <= 0) {
    return (
      <div className="resolution-control neutral">
        <span>RESOLUTION</span>
        <strong>DC / static</strong>
        <small>Add an AC source to calculate samples per cycle.</small>
      </div>
    );
  }

  const samples = resolution.samplesPerCycle ?? 0;
  const canResolve = resolution.requiredSteps <= maxSteps;
  const ready = samples >= MIN_SAMPLES_PER_CYCLE;
  return (
    <div className={`resolution-control${ready ? " ready" : " warning"}`}>
      <div>
        <span>RESOLUTION</span>
        <strong>{formatSamples(samples)} samples / cycle</strong>
        <small>
          {formatEngineering(resolution.maxFrequencyHz, "Hz", 3)} requires {formatCount(resolution.requiredSteps)} steps for {MIN_SAMPLES_PER_CYCLE}× sampling.
        </small>
      </div>
      {canResolve ? (
        <button type="button" onClick={onApply} disabled={steps >= resolution.requiredSteps}>
          {ready ? "Resolved" : `Set ${MIN_SAMPLES_PER_CYCLE}×`}
        </button>
      ) : (
        <small className="resolution-limit">Shorten STOP or use AC analysis. Output limit: {formatCount(maxSteps)} steps.</small>
      )}
    </div>
  );
}

const formatCount = (value: number) => value.toLocaleString("en-US");
const formatSamples = (value: number) => Number(value.toPrecision(3)).toString();
