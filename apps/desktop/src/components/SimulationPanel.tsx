import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Crosshair, Maximize2, Minimize2, RefreshCw, Square, X } from "lucide-react";
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
import type { Probe, NetLabel, SchematicWire } from "../schematic/types";
import { netAtPoint } from "../schematic/netlist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { OperatingPointResult } from "../simulation/operatingPoint";
import type { AcResult, AcTrace } from "../simulation/acSweep";
import type { DcSweepResult, DcSweepNet, DcSweepSpec } from "../simulation/dcSweep";
import type { TfResult, TfSpec } from "../simulation/transferFunction";
import type { NoiseResult, NoiseSpec } from "../simulation/noise";
import type { StepSetupUi } from "../simulation/analysisSetup";
import {
  DcSetupForm,
  NoiseSetupForm,
  StepSetupForm,
  TfSetupForm,
} from "./AnalysisSetupForms";
import type { StepFamilyResult } from "../simulation/stepFamily";
import {
  acFamilyOverlaySeries,
  dcFamilyOverlaySeries,
  type AnalysisFamily,
} from "../simulation/stepAnalysisFamily";
import type { MeasResult } from "../simulation/measure";
import type { FourierResult } from "../simulation/fourier";
import { evaluatePlotExpression } from "../simulation/plotExpression";
import { evaluateAcPlotExpression } from "../simulation/plotExpressionAc";
import { evaluateDcPlotExpression } from "../simulation/plotExpressionDc";
import { commonTraceUnit } from "../simulation/exprUnit";
import { groupDelay } from "../simulation/groupDelay";
import { stabilityMargins } from "../simulation/stability";
import { seriesToCsv } from "../simulation/waveformCsv";
import { runWaveformFft, type WindowFn } from "../simulation/fft";
import { spectrumInsights } from "../simulation/spectrumInsights";
import { buildSpiceDeck } from "../engine/spiceNetlist";
import { serializeRaw, inferRawType } from "../io/rawExport";
import { cursorReadout, dbPerDecade, fractionToX, logFractionToX } from "../simulation/cursors";
import type { CursorTraceInput } from "../simulation/cursors";
import { parseRaw } from "../io/rawImport";
import type { RawData } from "../io/rawImport";
import { buildReferenceOverlay } from "../simulation/rawOverlay";
import { buildParamScope } from "../simulation/paramScope";
import { isNativeSpiceRuntime, MAX_NATIVE_OUTPUT_POINTS } from "../engine/nativeSpice";
import { displaySampleIndices, waveformBounds } from "../simulation/waveform";
import {
  type PaneLayout,
  defaultLayout,
  automaticLayout,
} from "./plotPanes";
import { PlotAxes, ScopeClip } from "./PlotAxes";
import { useMeasuredSize, tickCountsFromSize } from "./useMeasuredSize";
import { usePlotViewport } from "./usePlotViewport";
import { ScopeZoomCluster } from "./ScopeZoomCluster";
import type { Viewport } from "../simulation/plotViewport";
import { visibleTransientTraces } from "../simulation/visibleTraces";
import { EngineeringTraceReadout } from "./EngineeringTraceReadout";
import { ComponentMeasurementsPanel } from "./ComponentMeasurementsPanel";
import {
  componentMeasurements,
  traceStatistics,
  type ComponentMeasurement,
} from "../simulation/measurementModel";

interface SimulationPanelProps {
  result: AnalysisResult | null;
  opResult: OperatingPointResult | null;
  acResult: AcResult | null;
  dcResult: DcSweepResult | null;
  tfResult: TfResult | null;
  noiseResult: NoiseResult | null;
  stepResult: StepFamilyResult | null;
  /** `.step` families of the AC/DC analyses, drawn as extra curves on their panes. */
  acStepFamily: AnalysisFamily<AcResult> | null;
  dcStepFamily: AnalysisFamily<DcSweepResult> | null;
  measurements: MeasResult[];
  fourier: FourierResult[];
  acMeasurements: MeasResult[];
  dcMeasurements: MeasResult[];
  noiseMeasurements: MeasResult[];
  options: AnalysisOptions;
  /** True while transient resolution is auto-derived from the circuit (§11 C8). */
  optionsAuto?: boolean;
  isRunning: boolean;
  onOptionsChange: (options: AnalysisOptions) => void;
  /** Return transient resolution to automatic (clears a manual override). */
  onResetOptions?: () => void;
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
  dcSetup: DcSweepSpec;
  onDcSetupChange: (next: DcSweepSpec) => void;
  tfSetup: TfSpec;
  onTfSetupChange: (next: TfSpec) => void;
  noiseSetup: NoiseSpec;
  onNoiseSetupChange: (next: NoiseSpec) => void;
  stepSetupUi: StepSetupUi;
  onStepSetupUiChange: (next: StepSetupUi) => void;
}

const PLOT_WIDTH = 340;
const PLOT_HEIGHT = 210;
const PLOT_PAD = 40;

export function SimulationPanel({
  result,
  opResult,
  acResult,
  dcResult,
  tfResult,
  noiseResult,
  stepResult,
  acStepFamily,
  dcStepFamily,
  measurements,
  fourier,
  acMeasurements,
  dcMeasurements,
  noiseMeasurements,
  options,
  optionsAuto,
  isRunning,
  onOptionsChange,
  onResetOptions,
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
  dcSetup,
  onDcSetupChange,
  tfSetup,
  onTfSetupChange,
  noiseSetup,
  onNoiseSetupChange,
  stepSetupUi,
  onStepSetupUiChange,
}: SimulationPanelProps) {
  const components = useSchematic((s) => s.components);
  const wires = useSchematic((s) => s.wires);
  const selectedId = useSchematic((s) => s.selectedId);
  const select = useSchematic((s) => s.select);
  const probes = useSchematic((s) => s.probes);
  const netLabels = useSchematic((s) => s.netLabels);
  const directives = useSchematic((s) => s.directives);
  const warnings = result?.warnings ?? [];

  const [mode, setMode] = useState<"tran" | "op" | "ac" | "dc" | "tf" | "noise" | "step">("tran");
  const componentRows = useMemo<ComponentMeasurement[]>(
    () => (mode === "tran" && result?.ok ? componentMeasurements(result) : []),
    [mode, result],
  );
  // Advanced Simulation Settings disclosure — closed by default (§11 Unit C7):
  // Tau picks stop time / step count automatically unless the user overrides.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  // User-entered expression traces overlaid on the transient scope (§6), e.g.
  // `V(out)-V(in)` or power `V(out)*I(R1)`.
  const [exprList, setExprList] = useState<string[]>([]);
  const [exprInput, setExprInput] = useState("");
  const [exprError, setExprError] = useState<string | null>(null);
  // Expression traces overlaid on the AC (Bode) pane, e.g. `db(V(out))-db(V(in))`
  // for a transfer function, and on the DC pane, e.g. `V(out)-V(in)` (§6).
  const [acExprList, setAcExprList] = useState<string[]>([]);
  const [acExprInput, setAcExprInput] = useState("");
  const [acExprError, setAcExprError] = useState<string | null>(null);
  const [dcExprList, setDcExprList] = useState<string[]>([]);
  const [dcExprInput, setDcExprInput] = useState("");
  const [dcExprError, setDcExprError] = useState<string | null>(null);
  const [netlistError, setNetlistError] = useState<string | null>(null);
  // Multi-pane layout for the transient scope. Starts as a single pane with all
  // traces (preserving existing behavior). Updated via pane controls / trace moves.
  const [paneLayout, setPaneLayout] = useState<PaneLayout>(() => defaultLayout());
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

  // AC/DC expression overlays: evaluate each saved expression against the latest
  // AC/DC result, dropping the ones that no longer resolve (same lifecycle as the
  // transient overlays above).
  const acExprTraces = useMemo<AcTrace[]>(() => {
    const out: AcTrace[] = [];
    acExprList.forEach((expr) => {
      const r = evaluateAcPlotExpression(expr, acResult);
      if (r.ok) out.push(r.trace);
    });
    return out;
  }, [acExprList, acResult]);

  const dcExprTraces = useMemo<DcSweepNet[]>(() => {
    const out: DcSweepNet[] = [];
    dcExprList.forEach((expr) => {
      const r = evaluateDcPlotExpression(expr, dcResult);
      if (r.ok) out.push(r.trace);
    });
    return out;
  }, [dcExprList, dcResult]);

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

  const baseTraces = useMemo(
    () => (result?.ok ? visibleTransientTraces(result, probes, wires, netLabels) : []),
    [result, probes, wires, netLabels],
  );

  // ── Pane layout reconciliation ──────────────────────────────────────────────
  // Compute the full set of trace ids available for the current result.  These
  // are the same ids used by WaveformPlot: node trace ids (from result.traces)
  // plus expression/ref trace labels.  When the set changes, we reconcile the
  // layout to add new traces (to pane 0) and drop stale ones.
  const availableTraceIds = useMemo<string[]>(() => {
    const base = baseTraces.map((trace) => trace.id);
    const extraIds = scopeTraces.map((t) => t.id);
    return [...base, ...extraIds.filter((id) => !base.includes(id))];
  }, [baseTraces, scopeTraces]);

  // Auto-create one readable plot card per signal whenever the interest set
  // changes. A rerun with the same signals preserves manual pane assignments.
  const availableTraceKey = availableTraceIds.join("\u0000");
  useEffect(() => {
    setPaneLayout(automaticLayout(availableTraceIds));
    // The stable key deliberately ignores a new result object's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableTraceKey]);

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

  const addAcExpression = () => {
    const expr = acExprInput.trim();
    if (!expr) return;
    const probe = evaluateAcPlotExpression(expr, acResult);
    if (!probe.ok) {
      setAcExprError(probe.error);
      return;
    }
    if (!acExprList.includes(expr)) setAcExprList((prev) => [...prev, expr]);
    setAcExprInput("");
    setAcExprError(null);
  };

  const addDcExpression = () => {
    const expr = dcExprInput.trim();
    if (!expr) return;
    const probe = evaluateDcPlotExpression(expr, dcResult);
    if (!probe.ok) {
      setDcExprError(probe.error);
      return;
    }
    if (!dcExprList.includes(expr)) setDcExprList((prev) => [...prev, expr]);
    setDcExprInput("");
    setDcExprError(null);
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

  // §11 Unit C6 — one status voice for the whole panel: the dashboard strip
  // under the tabs. Idle (nothing run), Running (amber, tactical), Complete
  // (success + last-run figures), Error (danger, details live in the Errors
  // panel). Each tab reads its own result object; no invented values.
  const activeResult: { ok: boolean } | null =
    mode === "tran" ? result
    : mode === "op" ? opResult
    : mode === "ac" ? acResult
    : mode === "dc" ? dcResult
    : mode === "tf" ? tfResult
    : mode === "noise" ? noiseResult
    : stepResult;
  const runStatus = isRunning ? "running" : activeResult ? (activeResult.ok ? "complete" : "error") : "idle";
  const statusLabel =
    runStatus === "running" ? "Running"
    : runStatus === "complete" ? "Complete"
    : runStatus === "error" ? "Error"
    : "Idle";
  const lastRunInfo =
    runStatus === "complete" && mode === "tran" && result?.ok
      ? `${formatEngineering(result.stats.stopTime, "s", 2)} · ${result.stats.sampleCount} samples · ${result.stats.netCount} nets · ${result.stats.componentCount} parts`
      : runStatus === "error"
        ? "Simulation failed — details in the Errors panel"
        : runStatus === "idle"
          ? "No results yet — press Run in the toolbar or pick an analysis tab"
          : null;

  // Selecting an analysis tab both switches the visible pane and kicks off
  // that analysis immediately — the one primary Run control lives in the top
  // toolbar (§11 Unit C); in here tab selection IS the run gesture.
  const handleModeChange = (value: string) => {
    const next = value as typeof mode;
    setMode(next);
    if (next === "tran") void onRun();
    else if (next === "op") void onRunOperatingPoint();
    else if (next === "ac") void onRunAcSweep();
    else if (next === "dc") void onRunDcSweep();
    else if (next === "tf") void onRunTf();
    else if (next === "noise") void onRunNoise();
    else if (next === "step") void onRunStep();
  };

  return (
    <aside className={`plotter${maximized ? " maximized" : ""}`} aria-label="Analysis plotter" aria-busy={isRunning}>
      <div className="plotter-header">
        <div>
          <div className="plotter-kicker">Analysis</div>
          <div className="plotter-title">{title}</div>
        </div>
        <div className="plotter-actions">
          {isRunning && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={onStop}
                  aria-label="Stop simulation"
                >
                  <Square size={13} strokeWidth={1.8} aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop the running analysis</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={onStep}
                disabled={isRunning}
                aria-label="Refine transient resolution"
              >
                <RefreshCw size={13} strokeWidth={1.8} aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Re-run transient at finer resolution</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setMaximized((m) => !m)}
                aria-label="Toggle maximized analysis"
              >
                {maximized
                  ? <Minimize2 size={13} strokeWidth={1.8} aria-hidden="true" />
                  : <Maximize2 size={13} strokeWidth={1.8} aria-hidden="true" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{maximized ? "Restore panel" : "Maximize analysis"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={onClose}
                aria-label="Minimize graphs"
              >
                <X size={14} strokeWidth={1.8} aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Minimize graphs</TooltipContent>
          </Tooltip>
          {/* No Run button here — the single primary Run lives in the top
              toolbar (§11 Unit C). The refine control above is the only
              in-panel rerun affordance, deliberately secondary; run status
              lives in the dashboard strip under the tabs (Unit C6). */}
        </div>
      </div>

      <div className="plotter-tabs">
        <Tabs value={mode} onValueChange={handleModeChange}>
          <TabsList aria-label="Analysis modes" className="plotter-tabs-inner">
            <TabsTrigger className="plotter-tab" value="tran" disabled={isRunning}>TRAN</TabsTrigger>
            <TabsTrigger className="plotter-tab" value="op" disabled={isRunning}>OP</TabsTrigger>
            <TabsTrigger className="plotter-tab" value="ac" disabled={isRunning}>AC</TabsTrigger>
            <TabsTrigger className="plotter-tab" value="dc" disabled={isRunning}>DC</TabsTrigger>
            <TabsTrigger className="plotter-tab" value="tf" disabled={isRunning}>TF</TabsTrigger>
            <TabsTrigger className="plotter-tab" value="noise" disabled={isRunning}>NOISE</TabsTrigger>
            <TabsTrigger className="plotter-tab" value="step" disabled={isRunning}>STEP</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className={`plotter-status plotter-status--${runStatus}`} role="status" aria-live="polite">
        <span className="plotter-status-lamp" aria-hidden="true" />
        <span className="plotter-status-state">{statusLabel}</span>
        {lastRunInfo && <span className="plotter-status-info">{lastRunInfo}</span>}
      </div>

      {mode === "tran" && (
        <>
          <WaveformPlot
            result={result}
            baseTraces={baseTraces}
            netLabels={netLabels}
            extraTraces={scopeTraces}
            paneLayout={paneLayout}
          />

          <details className="plot-tools advanced-settings">
            <summary className="disclosure-header">
              <span className="disclosure-label">Advanced plot tools</span>
              <span className="disclosure-rule" aria-hidden="true" />
              <span className="disclosure-chevron">›</span>
            </summary>
            <div className="plot-tools-body">
          <div className="expr-bar">
            <Input
              variant="mono"
              size="sm"
              className="flex-1 min-w-40"
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
            <Button size="sm" onClick={addExpression} disabled={!exprInput.trim()}>
              Add trace
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={exportCsv} disabled={!result?.ok}>
                  Export CSV
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export the transient waveforms as a CSV table</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={exportNetlist} disabled={components.length === 0}>
                  Netlist
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export the generated SPICE netlist as a .cir file</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={exportRaw} disabled={!result?.ok}>
                  Save .raw
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export the transient waveforms as an LTspice .raw file</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={() => refInputRef.current?.click()} disabled={!result?.ok}>
                  {refData ? "Ref .raw ✓" : "Ref .raw"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Overlay an LTspice .raw reference waveform and compare</TooltipContent>
            </Tooltip>
            {refData && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setRefData(null); setRefError(null); }}
                  >
                    Clear ref
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Remove the reference overlay</TooltipContent>
              </Tooltip>
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
            </div>
          </details>

          <MeasTable measurements={measurements} />
          <FourierTable results={fourier} />
          <FftView result={result} preferredSignals={baseTraces.map((trace) => trace.label)} />
          <CursorView result={result} extraTraces={exprTraces} />

          <div className="advanced-settings">
            <button
              className="disclosure-header"
              onClick={() => setAdvancedOpen((o) => !o)}
              aria-expanded={advancedOpen}
              aria-label="Toggle advanced simulation settings"
            >
              <span className="disclosure-label">Advanced simulation settings</span>
              {optionsAuto && <span className="advanced-settings-auto">AUTO</span>}
              <span className="disclosure-rule" aria-hidden="true" />
              <span className={`disclosure-chevron${advancedOpen ? " open" : ""}`}>›</span>
            </button>
            {advancedOpen && (
              <>
                <div className="advanced-settings-help-row">
                  <p className="advanced-settings-help">
                    Tau automatically chooses simulation settings unless overridden.
                  </p>
                  {!optionsAuto && onResetOptions && (
                    <Button variant="outline" size="sm" onClick={onResetOptions}>
                      Reset to auto
                    </Button>
                  )}
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
          </div>
        </>
      )}

      {mode === "op" && <OpTable result={opResult} />}
      {mode === "ac" && (
        <>
          <AcPlot result={acResult} overlays={acExprTraces} />
          <div className="expr-bar">
            <Input
              variant="mono"
              size="sm"
              className="flex-1 min-w-40"
              type="text"
              value={acExprInput}
              placeholder="Plot an expression, e.g. db(V(out))-db(V(in)) or mag(V(a,b))"
              aria-label="Plot AC expression"
              onChange={(e) => {
                setAcExprInput(e.currentTarget.value);
                if (acExprError) setAcExprError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") addAcExpression();
              }}
            />
            <Button size="sm" onClick={addAcExpression} disabled={!acExprInput.trim()}>
              Add trace
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={exportAcCsv} disabled={!acResult?.ok}>
                  Export CSV
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export the AC sweep as a CSV table</TooltipContent>
            </Tooltip>
          </div>
          {acExprError && <div className="expr-error" role="alert">{acExprError}</div>}
          {acExprList.length > 0 && (
            <div className="expr-list">
              {acExprList.map((expr, i) => (
                <span key={expr} className="expr-chip" style={{ borderColor: EXPR_COLORS[i % EXPR_COLORS.length] }}>
                  <i style={{ background: EXPR_COLORS[i % EXPR_COLORS.length] }} />
                  {expr}
                  <button
                    className="expr-remove"
                    aria-label={`Remove ${expr}`}
                    onClick={() => setAcExprList((prev) => prev.filter((e) => e !== expr))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <AcFamilyPlot family={acStepFamily} />
          <MeasTable measurements={acMeasurements} />
        </>
      )}
      {mode === "dc" && (
        <>
          <DcSetupForm setup={dcSetup} components={components} onChange={onDcSetupChange} />
          <DcPlot result={dcResult} overlays={dcExprTraces} />
          <div className="expr-bar">
            <Input
              variant="mono"
              size="sm"
              className="flex-1 min-w-40"
              type="text"
              value={dcExprInput}
              placeholder="Plot an expression, e.g. V(out)-V(in) or V(a)/V(b)"
              aria-label="Plot DC expression"
              onChange={(e) => {
                setDcExprInput(e.currentTarget.value);
                if (dcExprError) setDcExprError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") addDcExpression();
              }}
            />
            <Button size="sm" onClick={addDcExpression} disabled={!dcExprInput.trim()}>
              Add trace
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={exportDcCsv} disabled={!dcResult?.ok}>
                  Export CSV
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export the DC sweep as a CSV table</TooltipContent>
            </Tooltip>
          </div>
          {dcExprError && <div className="expr-error" role="alert">{dcExprError}</div>}
          {dcExprList.length > 0 && (
            <div className="expr-list">
              {dcExprList.map((expr, i) => (
                <span key={expr} className="expr-chip" style={{ borderColor: EXPR_COLORS[i % EXPR_COLORS.length] }}>
                  <i style={{ background: EXPR_COLORS[i % EXPR_COLORS.length] }} />
                  {expr}
                  <button
                    className="expr-remove"
                    aria-label={`Remove ${expr}`}
                    onClick={() => setDcExprList((prev) => prev.filter((e) => e !== expr))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <DcFamilyPlot family={dcStepFamily} />
          <MeasTable measurements={dcMeasurements} />
        </>
      )}
      {mode === "tf" && (
        <>
          <TfSetupForm setup={tfSetup} components={components} onChange={onTfSetupChange} />
          <TfTable result={tfResult} />
        </>
      )}
      {mode === "noise" && (
        <>
          <NoiseSetupForm setup={noiseSetup} components={components} onChange={onNoiseSetupChange} />
          <NoisePlot result={noiseResult} />
          <div className="expr-bar">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={exportNoiseCsv} disabled={!noiseResult?.ok}>
                  Export CSV
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export the noise spectrum as a CSV table</TooltipContent>
            </Tooltip>
          </div>
          <MeasTable measurements={noiseMeasurements} />
        </>
      )}
      {mode === "step" && (
        <>
          <StepSetupForm setup={stepSetupUi} components={components} onChange={onStepSetupUiChange} />
          <StepPlot result={stepResult} probes={probes} wires={wires} />
        </>
      )}

      {mode === "tran" && (
        <ComponentMeasurementsPanel
          rows={componentRows}
          selectedId={selectedId}
          onSelect={select}
          className="component-measurements"
        />
      )}

      <div className="plotter-footer">
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

export function WaveformPlot({
  result,
  baseTraces,
  netLabels,
  extraTraces = [],
  paneLayout,
}: {
  result: AnalysisResult | null;
  baseTraces: Trace[];
  netLabels: NetLabel[];
  /** User-entered expression traces overlaid on the scope (§6). */
  extraTraces?: Trace[];
  paneLayout: PaneLayout;
}) {
  const success = result?.ok ? result : null;

  // Build the full ordered trace list (all panes, all traces) the same way as
  // before — probed nets or the first 6, then expression/ref overlays.  We keep
  // a map from id → Trace for fast lookup when rendering per-pane subsets.
  const allTraces = useMemo<Trace[]>(() => {
    return [...baseTraces, ...extraTraces];
  }, [baseTraces, extraTraces]);

  const traceById = useMemo<Map<string, Trace>>(() => {
    const m = new Map<string, Trace>();
    for (const t of allTraces) m.set(t.id, t);
    return m;
  }, [allTraces]);

  const tMax = useMemo(() => (success ? success.times[success.times.length - 1] || 1 : 1), [success]);

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

  const multiPane = paneLayout.length > 1;

  return (
    <div className="scope-shell">
      {success && allTraces.length === 0 && (
        <div className="scope-empty-state">
          <Crosshair size={20} strokeWidth={1.5} aria-hidden="true" />
          <strong>Choose signals on the circuit</strong>
          <span>Add a probe dot or name a node to create its plot automatically.</span>
        </div>
      )}

      {allTraces.length > 0 && paneLayout.map((pane, paneIndex) => {
        // Resolve traces for this pane (preserve insertion order within pane).
        const paneTraces = pane.traceIds
          .map((id) => traceById.get(id))
          .filter((t): t is Trace => t !== undefined);

        // Per-pane Y autorange.
        const plot =
          success && paneTraces.length > 0
            ? (() => {
                const { min, max } = waveformBounds(paneTraces);
                const unit = commonTraceUnit(paneTraces.map((t) => t.unit)) || "V";
                return { min, max, tMax, unit };
              })()
            : null;

        return (
          <div key={pane.id} className={`pane-wrapper${multiPane ? " pane-wrapper--split" : ""}`}>
            {/* Per-pane header with remove button (only visible in multi-pane mode). */}
            {multiPane && (
              <div className="pane-header">
                <span className="pane-label">
                  {paneTraces.length === 1 ? labelFor(paneTraces[0]) : `Plot ${paneIndex + 1}`}
                </span>
              </div>
            )}

            <TranScopePane
              paneTraces={paneTraces}
              plot={plot}
              times={success ? success.times : []}
              ariaLabel={multiPane ? `Waveform pane ${paneIndex + 1}` : "Waveform plot"}
              showXAxis
              // Not just `success`: on the render where a run first resolves,
              // `plot` can still be null for one tick before `paneLayout`
              // catches up with the new trace ids — folding `plot`'s presence
              // into the reset key means the viewport reset effect fires
              // exactly when this pane actually has data to fit, not before.
              runKey={plot ? success : null}
            />

            {/* Per-pane legend with optional "move to pane" selector. */}
            <div className="scope-legend" aria-label="Trace measurements">
              {paneTraces.length > 0 ? (
                paneTraces.map((trace) => (
                  <EngineeringTraceReadout
                    key={trace.id}
                    trace={{ ...trace, label: labelFor(trace) }}
                    times={success ? success.times : []}
                  />
                ))
              ) : (
                <span className="muted">{multiPane ? "Empty — move a trace here" : "No traces"}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * One TRAN scope pane's `<svg>`: real tick axes (via {@link PlotAxes}) plus
 * the trace paths, with Desmos-style cursor-anchored wheel zoom, drag pan,
 * and an auto-fit ⌂ button (`usePlotViewport`). Split out of
 * {@link WaveformPlot}'s per-pane `.map()` so each pane can own its own
 * hooks — hooks can't live inside a `.map()` callback in the parent, and
 * each pane needs an independent zoom viewport anyway.
 */
function TranScopePane({
  paneTraces,
  plot,
  times,
  ariaLabel,
  showXAxis,
  runKey,
}: {
  paneTraces: Trace[];
  plot: { min: number; max: number; tMax: number; unit: string } | null;
  times: number[];
  ariaLabel: string;
  showXAxis: boolean;
  /** Identity of the current run — changing it resets this pane's zoom to full-fit. */
  runKey: unknown;
}) {
  const clipId = useId();
  const [plotHeight, setPlotHeight] = useState(190);
  const [measureRef, size] = useMeasuredSize<SVGSVGElement>();
  const { targetXTicks, targetYTicks } = tickCountsFromSize(size);
  const domain = useMemo<Viewport>(
    () => ({ xMin: 0, xMax: plot ? plot.tMax : 1, yMin: plot ? plot.min : -1, yMax: plot ? plot.max : 1 }),
    [plot],
  );
  const { viewport, attachSvg, isPanning, fit, zoomBy, dragHandlers } = usePlotViewport({
    domain,
    resetKey: runKey,
    width: PLOT_WIDTH,
    height: plotHeight,
    pad: PLOT_PAD,
  });
  const setRefs = useCallback(
    (el: SVGSVGElement | null) => {
      measureRef.current = el;
      attachSvg(el);
    },
    [measureRef, attachSvg],
  );

  return (
    <div className="scope-plot-wrap">
      <div className="scope-size-controls" aria-label="Plot size">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={plotHeight <= 190}
          aria-label="Decrease plot height"
          onClick={() => setPlotHeight((height) => Math.max(190, height - 50))}
        >
          <Minimize2 size={13} aria-hidden="true" />
        </Button>
        <span className="mono-num" aria-live="polite">{plotHeight}px</span>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={plotHeight >= 340}
          aria-label="Increase plot height"
          onClick={() => setPlotHeight((height) => Math.min(340, height + 50))}
        >
          <Maximize2 size={13} aria-hidden="true" />
        </Button>
      </div>
      <svg
        ref={setRefs}
        className={isPanning ? "scope-svg panning" : "scope-svg"}
        viewBox={`0 0 ${PLOT_WIDTH} ${plotHeight}`}
        style={{ aspectRatio: `${PLOT_WIDTH} / ${plotHeight}` }}
        role="img"
        aria-label={ariaLabel}
        {...dragHandlers}
      >
        <PlotAxes
          width={PLOT_WIDTH}
          height={plotHeight}
          pad={PLOT_PAD}
          xMin={viewport.xMin}
          xMax={viewport.xMax}
          yMin={viewport.yMin}
          yMax={viewport.yMax}
          xUnit="s"
          yUnit={plot ? plot.unit : "V"}
          xAxisTitle="Time"
          yAxisTitle={plot?.unit === "A" ? "Current" : plot?.unit === "W" ? "Power" : "Voltage"}
          targetXTicks={targetXTicks}
          targetYTicks={targetYTicks}
          showXTicks={showXAxis}
        />
        {plot && (
          <>
            <ScopeClip id={clipId} width={PLOT_WIDTH} height={plotHeight} pad={PLOT_PAD}>
              {paneTraces.map((trace) => (
                <path
                  key={trace.id}
                  className={trace.id.startsWith("ref:") ? "scope-trace ref" : "scope-trace"}
                  stroke={trace.color}
                  d={tracePath(trace, times, viewport.xMin, viewport.xMax, viewport.yMin, viewport.yMax, plotHeight)}
                />
              ))}
            </ScopeClip>
            {paneTraces.length === 1 && (
              <ScopeStatisticsOverlay
                trace={paneTraces[0]}
                times={times}
                viewport={viewport}
                height={plotHeight}
              />
            )}
          </>
        )}
      </svg>
      {plot && <ScopeZoomCluster onZoomIn={() => zoomBy(0.7)} onZoomOut={() => zoomBy(1 / 0.7)} onFit={fit} />}
    </div>
  );
}

function ScopeStatisticsOverlay({
  trace,
  times,
  viewport,
  height,
}: {
  trace: Trace;
  times: number[];
  viewport: Viewport;
  height: number;
}) {
  const statistics = useMemo(() => traceStatistics(times, trace.values), [times, trace.values]);
  if (!statistics) return null;
  const rawMarks = [
    { label: "MAX", value: statistics.max, kind: "limit" },
    { label: "AVG", value: statistics.average, kind: "average" },
    { label: "MIN", value: statistics.min, kind: "limit" },
  ];
  const marks = rawMarks.reduce<Array<{ label: string; value: number; kind: string }>>((groups, mark) => {
    const tolerance = Math.max(1, Math.abs(mark.value)) * 1e-10;
    const existing = groups.find((group) => Math.abs(group.value - mark.value) <= tolerance);
    if (existing) {
      existing.label += ` · ${mark.label}`;
      if (mark.kind === "average") existing.kind = "average";
    } else {
      groups.push({ ...mark });
    }
    return groups;
  }, []);
  const innerHeight = height - PLOT_PAD * 2;
  const ySpan = viewport.yMax - viewport.yMin || 1;

  return (
    <g className="scope-stat-overlay" style={{ color: trace.color }} aria-hidden="true">
      {marks.map((mark) => {
        if (mark.value < viewport.yMin || mark.value > viewport.yMax) return null;
        const y = height - PLOT_PAD - ((mark.value - viewport.yMin) / ySpan) * innerHeight;
        return (
          <g key={mark.label} className={`scope-stat-mark scope-stat-mark--${mark.kind}`}>
            <line x1={PLOT_PAD} x2={PLOT_WIDTH - PLOT_PAD} y1={y} y2={y} />
            <text x={PLOT_WIDTH - PLOT_PAD - 3} y={Math.max(PLOT_PAD + 9, y - 3)}>
              {mark.label} {formatEngineering(mark.value, trace.unit, 2)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Map a transient trace to an SVG path over an explicit `[xMin,xMax]` time
 *  window (not always `[0,tMax]` — zoom/pan can move the visible window to
 *  a non-zero start). `tMax`-only callers (unzoomed) pass `xMin=0`. */
function tracePath(
  trace: Trace,
  times: number[],
  xMin: number,
  xMax: number,
  min: number,
  max: number,
  height = PLOT_HEIGHT,
): string {
  const sampleCount = Math.min(trace.values.length, times.length);
  const xSpan = xMax - xMin || 1;
  let path = "";
  let started = false;
  for (const index of displaySampleIndices(sampleCount)) {
    const value = trace.values[index];
    const time = times[index];
    if (!Number.isFinite(value) || !Number.isFinite(time)) continue;
    const x = PLOT_PAD + ((time - xMin) / xSpan) * (PLOT_WIDTH - PLOT_PAD * 2);
    const y = height - PLOT_PAD - ((value - min) / (max - min || 1)) * (height - PLOT_PAD * 2);
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
        <div className="analysis-empty warn" role="status">{result.warnings.join(" ")}</div>
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
export function NoisePlot({ result }: { result: NoiseResult | null }) {
  const success = result?.ok ? result : null;
  const clipId = useId();
  const [measureRef, size] = useMeasuredSize<SVGSVGElement>();
  const { targetXTicks, targetYTicks } = tickCountsFromSize(size);
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

  const domain = useMemo<Viewport>(
    () => ({
      xMin: plot ? 10 ** plot.f0 : 1,
      xMax: plot ? 10 ** plot.f1 : 10,
      yMin: plot ? 10 ** plot.yMin : 1e-9,
      yMax: plot ? 10 ** plot.yMax : 1e-6,
    }),
    [plot],
  );
  const { viewport, attachSvg, isPanning, fit, zoomBy, dragHandlers } = usePlotViewport({
    domain,
    xScale: "log",
    yScale: "log",
    resetKey: plot ? success : null,
    width: PLOT_WIDTH,
    height: PLOT_HEIGHT,
    pad: PLOT_PAD,
  });
  const setRefs = useCallback(
    (el: SVGSVGElement | null) => {
      measureRef.current = el;
      attachSvg(el);
    },
    [measureRef, attachSvg],
  );

  if (!result) return null;
  if (!result.ok) return <div className="analysis-empty">{result.message}</div>;

  const path = plot
    ? noisePath(result.onoise, result.freqs, {
        yMin: Math.log10(viewport.yMin),
        yMax: Math.log10(viewport.yMax),
        f0: Math.log10(viewport.xMin),
        f1: Math.log10(viewport.xMax),
      })
    : "";

  return (
    <>
      <div className="scope-shell">
        <div className="scope-plot-wrap">
          <svg
            ref={setRefs}
            className={isPanning ? "scope-svg panning" : "scope-svg"}
            viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
            role="img"
            aria-label="Output noise density"
            {...dragHandlers}
          >
            <PlotAxes
              width={PLOT_WIDTH}
              height={PLOT_HEIGHT}
              pad={PLOT_PAD}
              xMin={viewport.xMin}
              xMax={viewport.xMax}
              yMin={viewport.yMin}
              yMax={viewport.yMax}
              xScale="log"
              yScale="log"
              xUnit="Hz"
              yUnit="V/√Hz"
              targetXTicks={targetXTicks}
              targetYTicks={targetYTicks}
            />
            {path && (
              <ScopeClip id={clipId} width={PLOT_WIDTH} height={PLOT_HEIGHT} pad={PLOT_PAD}>
                <path className="scope-trace" stroke="var(--trace-red)" d={path} />
              </ScopeClip>
            )}
          </svg>
          {plot && <ScopeZoomCluster onZoomIn={() => zoomBy(0.7)} onZoomOut={() => zoomBy(1 / 0.7)} onFit={fit} />}
        </div>
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
      {result.warnings.length > 0 && <div className="analysis-empty warn" role="status">{result.warnings.join(" ")}</div>}
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
export function FftView({ result, preferredSignals = [] }: { result: AnalysisResult | null; preferredSignals?: string[] }) {
  const [open, setOpen] = useState(false);
  const [signal, setSignal] = useState<string>("");
  const [windowFn, setWindowFn] = useState<WindowFn>("hann");
  const [cursorsOn, setCursorsOn] = useState(false);
  const [cf1, setCf1] = useState(0.25);
  const [cf2, setCf2] = useState(0.75);
  const clipId = useId();
  const [measureRef, size] = useMeasuredSize<SVGSVGElement>();
  const { targetXTicks, targetYTicks } = tickCountsFromSize(size);

  const success = result?.ok ? result : null;
  const signals = useMemo(() => {
    if (!success) return [];
    const all = [...new Set([...success.traces.map((t) => t.label), ...success.currents.map((c) => c.label)])];
    return [...preferredSignals.filter((label) => all.includes(label)), ...all.filter((label) => !preferredSignals.includes(label))];
  }, [success, preferredSignals]);
  const chosen = signal && signals.includes(signal) ? signal : signals[0] ?? "";

  const spectrum = useMemo(() => {
    if (!open || !success || !chosen) return null;
    try {
      return runWaveformFft(success, chosen, { window: windowFn });
    } catch {
      return null;
    }
  }, [open, success, chosen, windowFn]);
  const insights = useMemo(() => (spectrum ? spectrumInsights(spectrum) : null), [spectrum]);

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

  // Two measurement cursors along the log-frequency axis: dB at each, ΔdB, and
  // the dB/decade slope between them (harmonic levels / filter rolloff).
  const cursors = useMemo(() => {
    if (!cursorsOn || !spectrum) return null;
    const x1 = logFractionToX(spectrum.frequencies, cf1);
    const x2 = logFractionToX(spectrum.frequencies, cf2);
    if (!Number.isFinite(x1) || !Number.isFinite(x2)) return null;
    try {
      return cursorReadout(spectrum.frequencies, [{ label: chosen, values: spectrum.magnitudeDb }], x1, x2);
    } catch {
      return null;
    }
  }, [cursorsOn, spectrum, cf1, cf2, chosen]);

  const domain = useMemo<Viewport>(
    () => ({ xMin: plot ? 10 ** plot.f0 : 1, xMax: plot ? 10 ** plot.f1 : 10, yMin: plot ? plot.minDb : -60, yMax: plot ? plot.maxDb : 0 }),
    [plot],
  );
  const { viewport, attachSvg, isPanning, fit, zoomBy, dragHandlers } = usePlotViewport({
    domain,
    xScale: "log",
    resetKey: plot ? spectrum : null,
    width: PLOT_WIDTH,
    height: PLOT_HEIGHT,
    pad: PLOT_PAD,
  });
  const setRefs = useCallback(
    (el: SVGSVGElement | null) => {
      measureRef.current = el;
      attachSvg(el);
    },
    [measureRef, attachSvg],
  );

  // Cursor pixel position from the LIVE (possibly zoomed/panned) viewport, not
  // the static full-spectrum domain — a cursor placed via the 0-100% slider
  // stays anchored to its actual frequency and simply scrolls off-plot
  // (returns null, hidden) once zoom/pan moves it outside the visible window.
  const cursorPixelX = (f: number): number | null => {
    if (!(f > 0) || !(viewport.xMin > 0) || !(viewport.xMax > 0)) return null;
    const f0 = Math.log10(viewport.xMin);
    const f1 = Math.log10(viewport.xMax);
    const fSpan = f1 - f0 || 1;
    const frac = (Math.log10(f) - f0) / fSpan;
    if (frac < 0 || frac > 1) return null;
    return PLOT_PAD + frac * (PLOT_WIDTH - PLOT_PAD * 2);
  };

  if (!success) return null;

  return (
    <div className="fft-view">
      <button
        className="disclosure-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Toggle FFT spectrum"
      >
        <span className="disclosure-label">FFT spectrum</span>
        <span className="disclosure-rule" aria-hidden="true" />
        <span className={`disclosure-chevron${open ? " open" : ""}`}>›</span>
      </button>
      {open && (
        <>
          <div className="fft-control-bar">
            <label>
              <span>Signal</span>
              <select
                value={chosen}
                aria-label="FFT signal"
                onChange={(e) => setSignal(e.currentTarget.value)}
              >
                {signals.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Window</span>
              <select
                value={windowFn}
                aria-label="FFT window"
                onChange={(e) => setWindowFn(e.currentTarget.value as WindowFn)}
              >
                <option value="hann">Hann</option>
                <option value="hamming">Hamming</option>
                <option value="blackman">Blackman</option>
                <option value="rectangular">Rectangular</option>
              </select>
            </label>
            <Button
              variant={cursorsOn ? "default" : "outline"}
              size="sm"
              aria-pressed={cursorsOn}
              aria-label="Toggle FFT cursors"
              onClick={() => setCursorsOn((c) => !c)}
            >
              Cursors
            </Button>
          </div>
          <div className="scope-shell">
            <div className="scope-plot-wrap">
              <svg
                ref={setRefs}
                className={isPanning ? "scope-svg panning" : "scope-svg"}
                viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
                role="img"
                aria-label="FFT magnitude"
                {...dragHandlers}
              >
                <PlotAxes
                  width={PLOT_WIDTH}
                  height={PLOT_HEIGHT}
                  pad={PLOT_PAD}
                  xMin={viewport.xMin}
                  xMax={viewport.xMax}
                  yMin={viewport.yMin}
                  yMax={viewport.yMax}
                  xScale="log"
                  xUnit="Hz"
                  yUnit="dB"
                  xAxisTitle="Frequency"
                  yAxisTitle="Magnitude"
                  targetXTicks={targetXTicks}
                  targetYTicks={targetYTicks}
                />
                {plot && spectrum && (
                  <ScopeClip id={clipId} width={PLOT_WIDTH} height={PLOT_HEIGHT} pad={PLOT_PAD}>
                    <path
                      className="scope-trace"
                      stroke={AC_COLORS[0]}
                      d={bodePath(spectrum.magnitudeDb, spectrum.frequencies, {
                        minDb: viewport.yMin,
                        maxDb: viewport.yMax,
                        f0: Math.log10(viewport.xMin),
                        f1: Math.log10(viewport.xMax),
                      })}
                    />
                  </ScopeClip>
                )}
                {cursors &&
                  [cursors.x1, cursors.x2].map((f, i) => {
                    const x = cursorPixelX(f);
                    if (x === null) return null;
                    return (
                      <g key={`c${i}`} className="plot-cursor">
                        <line x1={x} y1={PLOT_PAD} x2={x} y2={PLOT_HEIGHT - PLOT_PAD} />
                        <text x={x + 3} y={PLOT_PAD + 10}>{i + 1}</text>
                      </g>
                    );
                  })}
                {plot && insights && [
                  insights.fundamental && { ...insights.fundamental, label: "F1" },
                  ...insights.harmonics.slice(0, 5).map((harmonic) => ({ ...harmonic, label: `H${harmonic.order}` })),
                ].filter((tone): tone is NonNullable<typeof tone> => Boolean(tone)).map((tone) => {
                  if (
                    !(tone.frequencyHz > 0)
                    || tone.frequencyHz < viewport.xMin
                    || tone.frequencyHz > viewport.xMax
                    || tone.amplitudeDb < viewport.yMin
                    || tone.amplitudeDb > viewport.yMax
                  ) return null;
                  const x = PLOT_PAD + ((Math.log10(tone.frequencyHz) - Math.log10(viewport.xMin))
                    / (Math.log10(viewport.xMax) - Math.log10(viewport.xMin) || 1)) * (PLOT_WIDTH - PLOT_PAD * 2);
                  const y = PLOT_HEIGHT - PLOT_PAD - ((tone.amplitudeDb - viewport.yMin)
                    / (viewport.yMax - viewport.yMin || 1)) * (PLOT_HEIGHT - PLOT_PAD * 2);
                  return (
                    <g key={tone.label} className="fft-tone-marker" transform={`translate(${x} ${y})`}>
                      <circle r="2.4" />
                      <text x="4" y="-4">{tone.label}</text>
                    </g>
                  );
                })}
              </svg>
              {plot && <ScopeZoomCluster onZoomIn={() => zoomBy(0.7)} onZoomOut={() => zoomBy(1 / 0.7)} onFit={fit} />}
            </div>
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
          {cursorsOn && (
            <div className="cursor-sliders">
              <label>
                C1
                <input
                  type="range" min={0} max={1000} value={Math.round(cf1 * 1000)}
                  aria-label="FFT cursor 1 position"
                  onChange={(e) => setCf1(Number(e.currentTarget.value) / 1000)}
                />
              </label>
              <label>
                C2
                <input
                  type="range" min={0} max={1000} value={Math.round(cf2 * 1000)}
                  aria-label="FFT cursor 2 position"
                  onChange={(e) => setCf2(Number(e.currentTarget.value) / 1000)}
                />
              </label>
            </div>
          )}
          {cursors && (
            <div className="meter-row analysis-meter">
              <Metric label="f1" value={formatEngineering(cursors.x1, "Hz", 3)} tone="cyan" />
              <Metric label="f2" value={formatEngineering(cursors.x2, "Hz", 3)} tone="cyan" />
              <Metric label="@C1" value={`${cursors.traces[0].y1.toFixed(1)} dB`} tone="green" />
              <Metric label="@C2" value={`${cursors.traces[0].y2.toFixed(1)} dB`} tone="green" />
              <Metric label="Δ" value={`${cursors.traces[0].dy.toFixed(1)} dB`} tone="cream" />
              <Metric
                label="SLOPE"
                value={
                  Number.isFinite(dbPerDecade(cursors, cursors.traces[0]))
                    ? `${dbPerDecade(cursors, cursors.traces[0]).toFixed(1)} dB/dec`
                    : "--"
                }
                tone="cream"
              />
            </div>
          )}
          {insights && <SpectrumInsightsPanel insights={insights} unit={chosen.startsWith("I(") ? "A" : "V"} />}
        </>
      )}
    </div>
  );
}

function SpectrumInsightsPanel({
  insights,
  unit,
}: {
  insights: ReturnType<typeof spectrumInsights>;
  unit: "V" | "A";
}) {
  const percent = (value: number | null | undefined) => value === null || value === undefined
    ? "—"
    : `${value.toFixed(3)}%`;
  const db = (value: number | null | undefined) => value === null || value === undefined
    ? "—"
    : `${value.toFixed(1)} dB`;
  const hasSignal = Boolean(insights.fundamental && insights.fundamental.amplitude > 0);
  return (
    <section className="fft-insights" aria-label="FFT measurements">
      <div className="fft-insight-grid">
        <SpectrumMetric
          label="Fundamental"
          value={hasSignal && insights.fundamental ? formatEngineering(insights.fundamental.frequencyHz, "Hz", 3) : "No tone"}
          detail={hasSignal && insights.fundamental ? `${insights.fundamental.amplitudeDb.toFixed(1)} dB · ${formatEngineering(insights.fundamental.amplitude, unit, 3)}` : "No spectral energy above the FFT floor"}
        />
        <SpectrumMetric label="THD" value={percent(insights.thd?.percent)} detail={db(insights.thd?.db)} />
        <SpectrumMetric label="THD + noise" value={percent(insights.thdPlusNoise?.percent)} detail={db(insights.thdPlusNoise?.db)} />
        <SpectrumMetric label="SFDR" value={db(insights.sfdrDb)} detail="Fundamental to largest spur" />
        <SpectrumMetric label="Noise floor" value={db(insights.noiseFloorDb)} detail="Median per FFT bin" />
        <SpectrumMetric
          label="Resolution"
          value={insights.frequencyResolutionHz ? formatEngineering(insights.frequencyResolutionHz, "Hz", 3) : "—"}
          detail="FFT bin width"
        />
        <SpectrumMetric
          label="DC"
          value={insights.dc ? formatEngineering(insights.dc.amplitude, unit, 3) : "—"}
          detail={insights.dc ? `${insights.dc.amplitudeDb.toFixed(1)} dB` : undefined}
        />
      </div>
      {insights.harmonics.length > 0 && (
        <div className="fft-harmonics-wrap">
          <table className="fft-harmonics">
            <caption>Harmonic peaks</caption>
            <thead><tr><th>Order</th><th>Frequency</th><th>Level</th><th>Relative</th></tr></thead>
            <tbody>
              {insights.harmonics.map((harmonic) => (
                <tr key={harmonic.order}>
                  <td>H{harmonic.order}</td>
                  <td>{formatEngineering(harmonic.frequencyHz, "Hz", 3)}</td>
                  <td>{harmonic.amplitudeDb.toFixed(1)} dB</td>
                  <td>{harmonic.dBc.toFixed(1)} dBc</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SpectrumMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="fft-insight-item">
      <span>{label}</span>
      <strong className="mono-num">{value}</strong>
      {detail && <small>{detail}</small>}
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
        className="disclosure-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Toggle measurement cursors"
      >
        <span className="disclosure-label">Cursors</span>
        <span className="disclosure-rule" aria-hidden="true" />
        <span className={`disclosure-chevron${open ? " open" : ""}`}>›</span>
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

export function AcPlot({ result, overlays = [] }: { result: AcResult | null; overlays?: AcTrace[] }) {
  const success = result?.ok ? result : null;
  const magClipId = useId();
  const phaseClipId = useId();
  const [magMeasureRef, magSize] = useMeasuredSize<SVGSVGElement>();
  const [phaseMeasureRef, phaseSize] = useMeasuredSize<SVGSVGElement>();
  const magTicks = tickCountsFromSize(magSize);
  const phaseTicks = tickCountsFromSize(phaseSize);
  const traces = success ? success.traces.slice(0, 4) : [];
  // Expression overlays share the magnitude axis (their value rides `magDb`).
  const magTraces = success ? [...traces, ...overlays] : [];
  const plot = useMemo(() => {
    if (!success || magTraces.length === 0) return null;
    let rawMin = 0;
    let rawMax = 0;
    let found = false;
    for (const trace of magTraces) {
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
    // Phase axis: bound to the data, snapped to 45° gridlines, with a sane
    // ±180° floor so a flat response still shows a readable scale.
    let phMin = 180;
    let phMax = -180;
    for (const trace of traces) {
      for (const p of trace.phaseDeg) {
        if (!Number.isFinite(p)) continue;
        phMin = Math.min(phMin, p);
        phMax = Math.max(phMax, p);
      }
    }
    const maxPh = Math.ceil(Math.max(phMax, 0) / 45) * 45;
    const minPh = Math.floor(Math.min(phMin, maxPh - 45) / 45) * 45;
    return { minDb, maxDb, f0, f1, minPh, maxPh };
  }, [success, traces, overlays]);

  // Independent zoom per pane — magnitude and phase don't share an x-viewport
  // in this pass (a documented scoping decision, see PROGRESS.md): they're
  // visually stacked halves of one Bode plot but each is its own `<svg>` with
  // its own `usePlotViewport`, so zooming one doesn't move the other.
  const magDomain = useMemo<Viewport>(
    () => ({ xMin: plot ? 10 ** plot.f0 : 1, xMax: plot ? 10 ** plot.f1 : 10, yMin: plot ? plot.minDb : -60, yMax: plot ? plot.maxDb : 0 }),
    [plot],
  );
  const phaseDomain = useMemo<Viewport>(
    () => ({ xMin: plot ? 10 ** plot.f0 : 1, xMax: plot ? 10 ** plot.f1 : 10, yMin: plot ? plot.minPh : -180, yMax: plot ? plot.maxPh : 180 }),
    [plot],
  );
  const magVp = usePlotViewport({
    domain: magDomain,
    xScale: "log",
    resetKey: plot ? success : null,
    width: PLOT_WIDTH,
    height: PLOT_HEIGHT,
    pad: PLOT_PAD,
  });
  const phaseVp = usePlotViewport({
    domain: phaseDomain,
    xScale: "log",
    resetKey: plot ? success : null,
    width: PLOT_WIDTH,
    height: PLOT_HEIGHT,
    pad: PLOT_PAD,
  });
  const setMagRefs = useCallback(
    (el: SVGSVGElement | null) => {
      magMeasureRef.current = el;
      magVp.attachSvg(el);
    },
    [magMeasureRef, magVp.attachSvg],
  );
  const setPhaseRefs = useCallback(
    (el: SVGSVGElement | null) => {
      phaseMeasureRef.current = el;
      phaseVp.attachSvg(el);
    },
    [phaseMeasureRef, phaseVp.attachSvg],
  );

  if (!result) return null;
  if (!result.ok) return <div className="analysis-empty">{result.message}</div>;
  let peak = -Infinity;
  for (const trace of traces) {
    for (const db of trace.magDb) {
      if (Number.isFinite(db)) peak = Math.max(peak, db);
    }
  }
  // Peak group delay τ = -dφ/dω of the primary (first) output trace — the
  // network's worst-case envelope delay in the swept band (LTspice §6).
  let peakGroupDelay = 0;
  if (traces.length > 0) {
    for (const tau of groupDelay(result.freqs, traces[0].phaseDeg)) {
      if (Number.isFinite(tau) && Math.abs(tau) > Math.abs(peakGroupDelay)) peakGroupDelay = tau;
    }
  }
  // Loop-stability margins of the primary trace (treated as the open-loop
  // response): phase margin at the 0 dB crossover, gain margin at −180° (§6).
  const margins =
    traces.length > 0
      ? stabilityMargins(result.freqs, traces[0].magDb, traces[0].phaseDeg)
      : null;

  return (
    <>
      <div className="scope-shell">
        <div className="scope-plot-wrap">
          <svg
            ref={setMagRefs}
            className={magVp.isPanning ? "scope-svg panning" : "scope-svg"}
            viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
            role="img"
            aria-label="Bode magnitude"
            {...magVp.dragHandlers}
          >
            <PlotAxes
              width={PLOT_WIDTH}
              height={PLOT_HEIGHT}
              pad={PLOT_PAD}
              xMin={magVp.viewport.xMin}
              xMax={magVp.viewport.xMax}
              yMin={magVp.viewport.yMin}
              yMax={magVp.viewport.yMax}
              xScale="log"
              xUnit="Hz"
              yUnit="dB"
              targetXTicks={magTicks.targetXTicks}
              targetYTicks={magTicks.targetYTicks}
              showXTicks={false}
            />
            {plot && (
              <ScopeClip id={magClipId} width={PLOT_WIDTH} height={PLOT_HEIGHT} pad={PLOT_PAD}>
                {(() => {
                  const magPlot = { minDb: magVp.viewport.yMin, maxDb: magVp.viewport.yMax, f0: Math.log10(magVp.viewport.xMin), f1: Math.log10(magVp.viewport.xMax) };
                  return (
                    <>
                      {traces.map((t, i) => (
                        <path key={t.id} className="scope-trace" stroke={AC_COLORS[i % AC_COLORS.length]} d={bodePath(t.magDb, success!.freqs, magPlot)} />
                      ))}
                      {overlays.map((t, i) => (
                        <path key={t.id} className="scope-trace" stroke={EXPR_COLORS[i % EXPR_COLORS.length]} d={bodePath(t.magDb, success!.freqs, magPlot)} />
                      ))}
                    </>
                  );
                })()}
              </ScopeClip>
            )}
          </svg>
          {plot && <ScopeZoomCluster onZoomIn={() => magVp.zoomBy(0.7)} onZoomOut={() => magVp.zoomBy(1 / 0.7)} onFit={magVp.fit} />}
        </div>
        <div className="scope-plot-wrap">
          <svg
            ref={setPhaseRefs}
            className={phaseVp.isPanning ? "scope-svg panning" : "scope-svg"}
            viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
            role="img"
            aria-label="Bode phase"
            {...phaseVp.dragHandlers}
          >
            <PlotAxes
              width={PLOT_WIDTH}
              height={PLOT_HEIGHT}
              pad={PLOT_PAD}
              xMin={phaseVp.viewport.xMin}
              xMax={phaseVp.viewport.xMax}
              yMin={phaseVp.viewport.yMin}
              yMax={phaseVp.viewport.yMax}
              xScale="log"
              xUnit="Hz"
              yUnit="°"
              targetXTicks={phaseTicks.targetXTicks}
              targetYTicks={phaseTicks.targetYTicks}
            />
            {plot && (
              <ScopeClip id={phaseClipId} width={PLOT_WIDTH} height={PLOT_HEIGHT} pad={PLOT_PAD}>
                {traces.map((t, i) => (
                  <path
                    key={t.id}
                    className="scope-trace ref"
                    stroke={AC_COLORS[i % AC_COLORS.length]}
                    d={bodeValuePath(t.phaseDeg, success!.freqs, {
                      min: phaseVp.viewport.yMin,
                      max: phaseVp.viewport.yMax,
                      f0: Math.log10(phaseVp.viewport.xMin),
                      f1: Math.log10(phaseVp.viewport.xMax),
                    })}
                  />
                ))}
              </ScopeClip>
            )}
          </svg>
          {plot && <ScopeZoomCluster onZoomIn={() => phaseVp.zoomBy(0.7)} onZoomOut={() => phaseVp.zoomBy(1 / 0.7)} onFit={phaseVp.fit} />}
        </div>
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
          {overlays.map((t, i) => (
            <span key={t.id}>
              <i style={{ background: EXPR_COLORS[i % EXPR_COLORS.length] }} />
              {t.label}
            </span>
          ))}
        </div>
      </div>
      <div className="meter-row analysis-meter">
        <Metric label="START" value={formatEngineering(result.freqs[0] ?? 0, "Hz", 0)} tone="green" />
        <Metric label="POINTS" value={String(result.freqs.length)} tone="cyan" />
        <Metric label="PEAK" value={Number.isFinite(peak) ? `${peak.toFixed(1)} dB` : "--"} tone="cream" />
        <Metric label="GRP DELAY" value={traces.length > 0 ? formatEngineering(peakGroupDelay, "s", 2) : "--"} tone="cyan" />
        <Metric
          label="PM"
          value={margins?.phaseMarginDeg != null ? `${margins.phaseMarginDeg.toFixed(1)}°` : "--"}
          tone={margins?.phaseMarginDeg != null && margins.phaseMarginDeg < 0 ? "red" : "green"}
        />
        <Metric
          label="GM"
          value={margins?.gainMarginDb != null ? `${margins.gainMarginDb.toFixed(1)} dB` : "--"}
          tone={margins?.gainMarginDb != null && margins.gainMarginDb < 0 ? "red" : "green"}
        />
      </div>
    </>
  );
}

function bodePath(magDb: number[], freqs: number[], plot: { minDb: number; maxDb: number; f0: number; f1: number }): string {
  return bodeValuePath(magDb, freqs, { min: plot.minDb, max: plot.maxDb, f0: plot.f0, f1: plot.f1 });
}

// Generic "value vs. log-frequency" trace path shared by the Bode magnitude
// (dB) and phase (degrees) sub-plots. X is log10(f); Y maps [min,max] onto the
// plot box (clamped so out-of-range samples ride the frame instead of escaping).
function bodeValuePath(
  values: number[],
  freqs: number[],
  plot: { min: number; max: number; f0: number; f1: number },
): string {
  const span = plot.max - plot.min || 1;
  const fSpan = plot.f1 - plot.f0 || 1;
  const count = Math.min(values.length, freqs.length);
  let path = "";
  let started = false;
  for (const index of displaySampleIndices(count)) {
    const v = values[index];
    const frequency = freqs[index];
    if (!Number.isFinite(v) || !Number.isFinite(frequency) || frequency <= 0) continue;
    const lx = (Math.log10(frequency) - plot.f0) / fSpan;
    const x = PLOT_PAD + lx * (PLOT_WIDTH - PLOT_PAD * 2);
    const yv = Math.max(plot.min, Math.min(plot.max, v));
    const y = PLOT_HEIGHT - PLOT_PAD - ((yv - plot.min) / span) * (PLOT_HEIGHT - PLOT_PAD * 2);
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
export function DcPlot({ result, overlays = [] }: { result: DcSweepResult | null; overlays?: DcSweepNet[] }) {
  const clipId = useId();
  const [measureRef, size] = useMeasuredSize<SVGSVGElement>();
  const { targetXTicks, targetYTicks } = tickCountsFromSize(size);
  const traces = result?.ok ? result.nets.filter((n) => !n.ground).slice(0, 6) : [];
  const sweep = result?.ok ? result.sweep : [];
  // Expression overlays share the voltage axis with the swept node curves.
  const allTraces = result?.ok ? [...traces, ...overlays] : [];
  const plot = useMemo(() => {
    if (allTraces.length === 0 || sweep.length === 0) return null;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const net of allTraces) {
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
  }, [traces, overlays, sweep]);

  const domain = useMemo<Viewport>(
    () => ({ xMin: plot ? plot.xMin : 0, xMax: plot ? plot.xMax : 1, yMin: plot ? plot.vMin : -1, yMax: plot ? plot.vMax : 1 }),
    [plot],
  );
  const { viewport, attachSvg, isPanning, fit, zoomBy, dragHandlers } = usePlotViewport({
    domain,
    resetKey: plot ? result : null,
    width: PLOT_WIDTH,
    height: PLOT_HEIGHT,
    pad: PLOT_PAD,
  });
  const setRefs = useCallback(
    (el: SVGSVGElement | null) => {
      measureRef.current = el;
      attachSvg(el);
    },
    [measureRef, attachSvg],
  );

  if (!result) return null;
  if (!result.ok) return <div className="analysis-empty">{result.message}</div>;

  const viewPlot = { vMin: viewport.yMin, vMax: viewport.yMax, xMin: viewport.xMin, xMax: viewport.xMax };

  return (
    <>
      <div className="scope-shell">
        <div className="scope-plot-wrap">
          <svg
            ref={setRefs}
            className={isPanning ? "scope-svg panning" : "scope-svg"}
            viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
            role="img"
            aria-label="DC sweep plot"
            {...dragHandlers}
          >
            <PlotAxes
              width={PLOT_WIDTH}
              height={PLOT_HEIGHT}
              pad={PLOT_PAD}
              xMin={viewport.xMin}
              xMax={viewport.xMax}
              yMin={viewport.yMin}
              yMax={viewport.yMax}
              yUnit="V"
              targetXTicks={targetXTicks}
              targetYTicks={targetYTicks}
            />
            {plot && (
              <ScopeClip id={clipId} width={PLOT_WIDTH} height={PLOT_HEIGHT} pad={PLOT_PAD}>
                {traces.map((net, i) => (
                  <path key={net.id} className="scope-trace" stroke={AC_COLORS[i % AC_COLORS.length]} d={dcPath(net.voltages, sweep, viewPlot)} />
                ))}
                {overlays.map((net, i) => (
                  <path key={net.id} className="scope-trace" stroke={EXPR_COLORS[i % EXPR_COLORS.length]} d={dcPath(net.voltages, sweep, viewPlot)} />
                ))}
              </ScopeClip>
            )}
          </svg>
          {plot && <ScopeZoomCluster onZoomIn={() => zoomBy(0.7)} onZoomOut={() => zoomBy(1 / 0.7)} onFit={fit} />}
        </div>
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
          {overlays.map((net, i) => (
            <span key={net.id}>
              <i style={{ background: EXPR_COLORS[i % EXPR_COLORS.length] }} />
              {net.label}
            </span>
          ))}
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
export function StepPlot({ result, probes, wires }: { result: StepFamilyResult | null; probes: Probe[]; wires: SchematicWire[] }) {
  const [svgRef, size] = useMeasuredSize<SVGSVGElement>();
  const { targetXTicks, targetYTicks } = tickCountsFromSize(size);
  // Members whose run succeeded, paired with the chosen trace for each.
  const family = useMemo(() => {
    if (!result?.ok) return null;
    const ok = result.members.filter((m) => m.result.ok);
    if (ok.length === 0) return null;
    const first = ok[0].result;
    if (!first.ok) return null;
    const traceId = pickFamilyTraceId(first, probes, wires);
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
  }, [result, probes, wires]);

  if (!result) return null;
  if (!result.ok) return <div className="analysis-empty">{result.message ?? "No step sweep to show."}</div>;
  if (!family) return <div className="analysis-empty">Step ran, but the selected signal has no data. Probe a node or check the sweep.</div>;

  return (
    <>
      <div className="scope-shell">
        <svg ref={svgRef} className="scope-svg" viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`} role="img" aria-label="Step family plot">
          <PlotAxes
            width={PLOT_WIDTH}
            height={PLOT_HEIGHT}
            pad={PLOT_PAD}
            xMin={0}
            xMax={family.tMax}
            yMin={family.min}
            yMax={family.max}
            xUnit="s"
            yUnit="V"
            targetXTicks={targetXTicks}
            targetYTicks={targetYTicks}
          />
          {family.series.map((s, i) => (
            <path
              key={s.label}
              className="scope-trace"
              stroke={STEP_COLORS[i % STEP_COLORS.length]}
              d={tracePath(s.trace, s.times, 0, family.tMax, family.min, family.max)}
            />
          ))}
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
function pickFamilyTraceId(
  success: Extract<AnalysisResult, { ok: true }>,
  probes: Probe[],
  wires: SchematicWire[],
): string | null {
  for (const probe of probes) {
    const net = netAtPoint(success.circuit.nets, wires, probe);
    if (!net || net.isGround) continue;
    const trace = success.traces.find((t) => t.id === net.id);
    if (trace) return trace.id;
  }
  return success.traces[0]?.id ?? null;
}

/**
 * The AC counterpart of {@link StepPlot}, shown under the Bode pane when the
 * document carries a runnable `.step`: one magnitude curve per swept value of
 * the signal chosen by {@link acFamilyOverlaySeries}, on its own log-f/dB axes
 * autoranged over the whole family (snapped to 10 dB like the main Bode plot).
 */
export function AcFamilyPlot({ family }: { family: AnalysisFamily<AcResult> | null }) {
  const [svgRef, size] = useMeasuredSize<SVGSVGElement>();
  const { targetXTicks, targetYTicks } = tickCountsFromSize(size);
  const overlay = useMemo(() => acFamilyOverlaySeries(family), [family]);
  const plot = useMemo(() => {
    if (!overlay) return null;
    let rawMin = 0;
    let rawMax = 0;
    let found = false;
    let fLo = Infinity;
    let fHi = -Infinity;
    for (const s of overlay.series) {
      for (const db of s.magDb) {
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
      for (const f of s.freqs) {
        if (!Number.isFinite(f) || f <= 0) continue;
        fLo = Math.min(fLo, f);
        fHi = Math.max(fHi, f);
      }
    }
    if (!found || !Number.isFinite(fLo)) return null;
    const max = Math.ceil(Math.max(rawMax, 0) / 10) * 10;
    const min = Math.floor(Math.min(rawMin, max - 10) / 10) * 10;
    return { min, max, f0: Math.log10(fLo), f1: Math.log10(fHi > fLo ? fHi : fLo * 10) };
  }, [overlay]);

  if (!family) return null;
  if (!family.ok) {
    // When every member failed, surface the first member's own error (e.g. a
    // singular matrix) instead of a generic banner.
    const memberError = family.members.map((m) => (m.result.ok ? null : m.result.message)).find((m) => m);
    return <div className="analysis-empty">{family.message ?? memberError ?? "The .step sweep could not run."}</div>;
  }
  if (!overlay || !plot) return null;

  return (
    <>
      <div className="scope-shell">
        <svg ref={svgRef} className="scope-svg" viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`} role="img" aria-label="AC step family plot">
          <PlotAxes
            width={PLOT_WIDTH}
            height={PLOT_HEIGHT}
            pad={PLOT_PAD}
            xMin={10 ** plot.f0}
            xMax={10 ** plot.f1}
            yMin={plot.min}
            yMax={plot.max}
            xScale="log"
            xUnit="Hz"
            yUnit="dB"
            targetXTicks={targetXTicks}
            targetYTicks={targetYTicks}
          />
          {overlay.series.map((s, i) => (
            <path
              key={s.label}
              className="scope-trace"
              stroke={STEP_COLORS[i % STEP_COLORS.length]}
              d={bodeValuePath(s.magDb, s.freqs, plot)}
            />
          ))}
        </svg>
        <div className="scope-legend">
          {overlay.series.map((s, i) => (
            <span key={s.label}>
              <i style={{ background: STEP_COLORS[i % STEP_COLORS.length] }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div className="meter-row analysis-meter">
        <Metric label="SIGNAL" value={overlay.signal} tone="green" />
        <Metric label="STEPS" value={String(overlay.series.length)} tone="cyan" />
        <Metric label="SWEEP" value={family.spec?.name ?? "--"} tone="cream" />
      </div>
    </>
  );
}

/**
 * The DC counterpart of {@link AcFamilyPlot}: one transfer curve per swept
 * value of the net chosen by {@link dcFamilyOverlaySeries}, on its own linear
 * sweep/volts axes autoranged over the whole family.
 */
export function DcFamilyPlot({ family }: { family: AnalysisFamily<DcSweepResult> | null }) {
  const [svgRef, size] = useMeasuredSize<SVGSVGElement>();
  const { targetXTicks, targetYTicks } = tickCountsFromSize(size);
  const overlay = useMemo(() => dcFamilyOverlaySeries(family), [family]);
  const plot = useMemo(() => {
    if (!overlay) return null;
    let vMin = Infinity;
    let vMax = -Infinity;
    let xMin = Infinity;
    let xMax = -Infinity;
    for (const s of overlay.series) {
      for (const v of s.voltages) {
        if (!Number.isFinite(v)) continue;
        vMin = Math.min(vMin, v);
        vMax = Math.max(vMax, v);
      }
      for (const x of s.sweep) {
        if (!Number.isFinite(x)) continue;
        xMin = Math.min(xMin, x);
        xMax = Math.max(xMax, x);
      }
    }
    if (!Number.isFinite(vMin) || !Number.isFinite(xMin)) return null;
    // Pad a flat family so it sits mid-frame instead of on an axis edge.
    if (vMax - vMin < 1e-12) {
      vMin -= 0.5;
      vMax += 0.5;
    }
    return { vMin, vMax, xMin, xMax };
  }, [overlay]);

  if (!family) return null;
  if (!family.ok) {
    // When every member failed, surface the first member's own error (e.g. a
    // singular matrix) instead of a generic banner.
    const memberError = family.members.map((m) => (m.result.ok ? null : m.result.message)).find((m) => m);
    return <div className="analysis-empty">{family.message ?? memberError ?? "The .step sweep could not run."}</div>;
  }
  if (!overlay || !plot) return null;

  return (
    <>
      <div className="scope-shell">
        <svg ref={svgRef} className="scope-svg" viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`} role="img" aria-label="DC step family plot">
          <PlotAxes
            width={PLOT_WIDTH}
            height={PLOT_HEIGHT}
            pad={PLOT_PAD}
            xMin={plot.xMin}
            xMax={plot.xMax}
            yMin={plot.vMin}
            yMax={plot.vMax}
            yUnit="V"
            targetXTicks={targetXTicks}
            targetYTicks={targetYTicks}
          />
          {overlay.series.map((s, i) => (
            <path
              key={s.label}
              className="scope-trace"
              stroke={STEP_COLORS[i % STEP_COLORS.length]}
              d={dcPath(s.voltages, s.sweep, plot)}
            />
          ))}
        </svg>
        <div className="scope-legend">
          {overlay.series.map((s, i) => (
            <span key={s.label}>
              <i style={{ background: STEP_COLORS[i % STEP_COLORS.length] }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div className="meter-row analysis-meter">
        <Metric label="SIGNAL" value={overlay.signal} tone="green" />
        <Metric label="STEPS" value={String(overlay.series.length)} tone="cyan" />
        <Metric label="SWEEP" value={family.spec?.name ?? "--"} tone="cream" />
      </div>
    </>
  );
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
      <strong className="mono-num">{value}</strong>
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
        <span className="param-value mono-num">{value}</span>
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
        <strong className="mono-num">DC / static</strong>
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
        <strong className="mono-num">{formatSamples(samples)} samples / cycle</strong>
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
