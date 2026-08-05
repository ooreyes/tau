import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { Crosshair, Maximize2, Minimize2, Square } from "lucide-react";
import { useSchematic } from "../store/useSchematic";
import { useRuntimeModelLibraries } from "../store/useRuntimeModelLibraries";
import {
  MAX_TRANSIENT_STEPS,
  MIN_SAMPLES_PER_CYCLE,
  inspectTransientResolution,
  type AnalysisOptions,
  type AnalysisResult,
  type Trace,
} from "../simulation/linearTransient";
import { formatEngineering, parseQuantity } from "../simulation/quantity";
import type { Probe, NetLabel, SchematicWire } from "../schematic/types";
import { netAtPoint } from "../schematic/netlist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
import { evaluateStepPlotExpression } from "../simulation/plotExpressionStep";
import {
  expressionForTrace,
  traceMathMenuItems,
  wrapTraceMath,
  type TraceMathOp,
} from "../simulation/traceMath";
import { commonTraceUnit } from "../simulation/exprUnit";
import { partitionTracesByAxis, planDualAxisY } from "../simulation/dualAxis";
import { groupDelay, groupDelayYDomain } from "../simulation/groupDelay";
import { bodeMagYDomain, dbToLinearMag, freqToFraction } from "../simulation/freqAxis";
import type { AxisScale } from "../simulation/axisTicks";
import { stabilityMargins } from "../simulation/stability";
import { seriesToCsv, stepFamilyToCsv, spectrumToCsv, cursorReadoutToCsv } from "../simulation/waveformCsv";
import {
  applyPltSection,
  buildPltSection,
  expressionFromTraceId,
  makePltTraceResolver,
  parsePlt,
  pltKindForMode,
  selectPltSection,
  serializePlt,
} from "../simulation/plotSettings";
import { downloadWaveformPng, waveformSvgsToPng } from "../simulation/plotPng";
import { runWaveformFft, type WindowFn } from "../simulation/fft";
import { spectrumInsights } from "../simulation/spectrumInsights";
import { buildSpiceDeck } from "../engine/spiceNetlist";
import { serializeRaw, inferRawType } from "../io/rawExport";
import {
  cursorReadout,
  dbPerDecade,
  fractionToX,
  logFractionToX,
  plotClientXToFraction,
  findTraceCrossings,
  nearestCrossing,
  xToFraction,
} from "../simulation/cursors";
import type { CursorTraceInput } from "../simulation/cursors";
import { resolveCssColorHex, sameCssColor } from "../lib/cssColor";
import { parseRaw } from "../io/rawImport";
import type { RawData } from "../io/rawImport";
import { buildReferenceOverlay } from "../simulation/rawOverlay";
import { buildParamScope } from "../simulation/paramScope";
import { isNativeSpiceRuntime, MAX_NATIVE_OUTPUT_POINTS } from "../engine/nativeSpice";
import {
  displaySampleIndices,
  autoFrameWaveform,
  waveformBounds,
  waveformEnvelopeIndices,
} from "../simulation/waveform";
import {
  type PaneLayout,
  defaultLayout,
  automaticLayout,
  reconcileLayout,
} from "./plotPanes";
import {
  type CardHeight,
  type CardLayoutState,
  type CardSpec,
  type CardWidth,
  type DropTarget,
  PLOT_HEIGHT_PX,
  applyDrop,
  cycleCardHeight,
  dropTargetFor,
  loadCardLayout,
  reconcileCardLayout,
  saveCardLayout,
  toggleCardWidth,
} from "./cardLayout";
import { PlotAxes, ScopeClip } from "./PlotAxes";
import { useMeasuredSize, tickCountsFromSize } from "./useMeasuredSize";
import { usePlotViewport } from "./usePlotViewport";
import { ScopeZoomCluster } from "./ScopeZoomCluster";
import type { Viewport } from "../simulation/plotViewport";
import { visibleTransientTraces } from "../simulation/visibleTraces";
import { EngineeringTraceReadout } from "./EngineeringTraceReadout";
import { traceStatistics, windowedTraceStatistics } from "../simulation/measurementModel";
import { AnalysisModeRail, type AnalysisMode } from "./AnalysisModeRail";
import { ENGINE_DESCRIPTIONS, ENGINE_LABELS, type EngineProvenance } from "../simulation/engineProvenance";
import { EngineeringInput } from "./EngineeringInput";
import { interpolateAt } from "../simulation/waveformCompare";
import {
  collectAutoResolutionInputs,
  transientDetailSteps,
  type TransientDetailLevel,
} from "../simulation/autoResolution";

interface SimulationPanelProps {
  /** Active circuit tab's title - a best-effort key for persisting the TRAN
   *  grid's per-card layout (order/width/height) across reruns of the same
   *  circuit. Falls back to a shared key when omitted (e.g. in isolated
   *  WaveformPlot tests that don't model a tabbed document at all). */
  circuitTitle?: string;
  /** Analysis authored first in the document; selected when this circuit opens. */
  preferredMode?: AnalysisMode;
  result: (AnalysisResult & EngineProvenance) | null;
  opResult: (OperatingPointResult & EngineProvenance) | null;
  acResult: (AcResult & EngineProvenance) | null;
  dcResult: (DcSweepResult & EngineProvenance) | null;
  tfResult: (TfResult & EngineProvenance) | null;
  noiseResult: (NoiseResult & EngineProvenance) | null;
  stepResult: (StepFamilyResult & EngineProvenance) | null;
  /** Which analysis STEP repeats (from authored .ac/.dc, else transient). */
  stepDomain?: "tran" | "ac" | "dc";
  /** `.step` families of the AC/DC analyses, drawn as extra curves on their panes. */
  acStepFamily: AnalysisFamily<AcResult> | null;
  dcStepFamily: AnalysisFamily<DcSweepResult> | null;
  measurements: MeasResult[];
  fourier: FourierResult[];
  acMeasurements: MeasResult[];
  dcMeasurements: MeasResult[];
  noiseMeasurements: MeasResult[];
  options: AnalysisOptions;
  /** True while transient resolution is auto-derived from the circuit. */
  optionsAuto?: boolean;
  /** Honest origin of the active transient settings. */
  optionsSource?: "automatic" | "document" | "custom";
  /** Destination restored when a custom override is cleared. */
  resetOptionsTarget?: "automatic" | "document";
  /** Measured wall-clock duration of the last completed transient run. */
  lastRunDurationMs?: number | null;
  isRunning: boolean;
  /** Fraction in [0, 1] while the web TS transient solver is reporting real
   *  progress; null before the first callback and for the whole run when
   *  native ngspice handles it (no progress channel - App.tsx/executeTransient
   *  passes null through in that case) - the run overlay below shows an
   *  indeterminate bar instead of a percentage in that state. */
  runProgress: number | null;
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
// Labels and axis titles need separate visual bands; the shared plot box stays
// at 46px so the waveform retains useful vertical range. PlotAxes places the
// vertical title and Y tick anchors at opposite sides of this gutter.
const PLOT_PAD = 46;
// Keep round line caps visibly inside the instrument frame. Mapping endpoints
// exactly onto the clip boundary shaved half the stroke and made periodic
// traces look cut off at both ends even though their samples were complete.
const TRACE_EDGE_GUTTER = 2.5;

type TransientCursorId = "c1" | "c2";

const TRACE_SWATCHES = [
  { color: "var(--trace-green)", name: "green" },
  { color: "var(--trace-red)", name: "vermillion" },
  { color: "var(--trace-cyan)", name: "sky" },
  { color: "var(--trace-cream)", name: "olive" },
  { color: "var(--trace-purple)", name: "purple" },
  { color: "var(--trace-amber)", name: "orange" },
] as const;

export function SimulationPanel({
  circuitTitle,
  preferredMode = "tran",
  result,
  opResult,
  acResult,
  dcResult,
  tfResult,
  noiseResult,
  stepResult,
  stepDomain = "tran",
  acStepFamily,
  dcStepFamily,
  measurements,
  fourier,
  acMeasurements,
  dcMeasurements,
  noiseMeasurements,
  options,
  optionsAuto,
  optionsSource,
  resetOptionsTarget = "automatic",
  lastRunDurationMs = null,
  isRunning,
  runProgress,
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
  const probes = useSchematic((s) => s.probes);
  const netLabels = useSchematic((s) => s.netLabels);
  const directives = useSchematic((s) => s.directives);
  const userModelLibraries = useSchematic((s) => s.userModelLibraries);
  const installedLtspiceModelLibraries = useRuntimeModelLibraries((s) => s.installedLtspice);
  const userModelLibraryTexts = useMemo(
    () => [...userModelLibraries, ...installedLtspiceModelLibraries].map((library) => library.text),
    [installedLtspiceModelLibraries, userModelLibraries],
  );
  const userModelLibraryNames = useMemo(
    () => [...userModelLibraries, ...installedLtspiceModelLibraries].map((library) => library.name),
    [installedLtspiceModelLibraries, userModelLibraries],
  );

  const [mode, setMode] = useState<AnalysisMode>(preferredMode);
  // Each analysis tab collapses its power-user controls behind ONE Advanced
  // disclosure, closed by default - the default view stays a calm read of
  // plots + status, not a stacked instrument panel.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [acAdvancedOpen, setAcAdvancedOpen] = useState(false);
  const [dcAdvancedOpen, setDcAdvancedOpen] = useState(false);
  const [noiseAdvancedOpen, setNoiseAdvancedOpen] = useState(false);
  // MIN/AVG/MAX overlay on single-trace panes - opt-in (Advanced ▸ Plot tools)
  // so the default scope reads as a clean waveform, not a measurement grid.
  const [showStats, setShowStats] = useState(false);
  const [cursorsOpen, setCursorsOpen] = useState(false);
  const [activeTransientCursor, setActiveTransientCursor] = useState<TransientCursorId | null>(null);
  const [cursorF1, setCursorF1] = useState(0.25);
  const [cursorF2, setCursorF2] = useState(0.75);
  const [maximized, setMaximized] = useState(false);
  // User-entered expression traces overlaid on the transient scope, e.g.
  // `V(out)-V(in)` or power `V(out)*I(R1)`.
  const [exprList, setExprList] = useState<string[]>([]);
  const [exprInput, setExprInput] = useState("");
  const [exprError, setExprError] = useState<string | null>(null);

  // Switching circuits should reveal the analysis that its directives ask
  // for, without treating the programmatic tab change as another run.
  useEffect(() => {
    setMode(preferredMode);
  }, [circuitTitle, preferredMode]);
  // Expression traces overlaid on the AC (Bode) pane, e.g. `db(V(out))-db(V(in))`
  // for a transfer function, and on the DC pane, e.g. `V(out)-V(in)`.
  const [acExprList, setAcExprList] = useState<string[]>([]);
  const [acExprInput, setAcExprInput] = useState("");
  const [acExprError, setAcExprError] = useState<string | null>(null);
  const [dcExprList, setDcExprList] = useState<string[]>([]);
  const [dcExprInput, setDcExprInput] = useState("");
  const [dcExprError, setDcExprError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const transientPlotsRef = useRef<HTMLDivElement | null>(null);
  const acPlotsRef = useRef<HTMLDivElement | null>(null);
  const dcPlotsRef = useRef<HTMLDivElement | null>(null);
  const noisePlotsRef = useRef<HTMLDivElement | null>(null);
  // Multi-pane layout for the transient scope. Starts as a single pane with all
  // traces (preserving existing behavior). Updated via pane controls / trace moves.
  const [paneLayout, setPaneLayout] = useState<PaneLayout>(() => defaultLayout());
  // An LTspice `.raw` loaded as a reference to overlay against Tau's results.
  const [refData, setRefData] = useState<RawData | null>(null);
  const [refError, setRefError] = useState<string | null>(null);
  const refInputRef = useRef<HTMLInputElement | null>(null);
  // LTspice `.plt` plot settings — panes/traces/X applied to the active analysis.
  const [pltError, setPltError] = useState<string | null>(null);
  const [pltXWindow, setPltXWindow] = useState<{ xMin: number; xMax: number } | null>(null);
  const [pltLoadedName, setPltLoadedName] = useState<string | null>(null);
  const pltInputRef = useRef<HTMLInputElement | null>(null);

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

  /** Apply an LTspice `.plt` — panes, traces, expressions, and X window. */
  const loadPlotSettings = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parsePlt(text);
      const kind = pltKindForMode(mode, stepDomain);
      const section = selectPltSection(parsed, kind);
      if (!section) throw new Error("The .plt file has no plot sections.");

      if (kind === "transient" || (mode === "step" && stepDomain === "tran")) {
        if (!result?.ok) throw new Error("Run a transient analysis before applying .plt settings.");
        const resolve = makePltTraceResolver([
          ...result.traces.map((t) => ({ id: t.id, label: t.label })),
          ...result.currents.map((c) => ({ id: `I(${c.ref})`, label: c.label })),
        ]);
        const applied = applyPltSection(section, resolve);
        // LTspice .plt is plot authority: every authored expression becomes an
        // expression-bar trace (`expr:…`) so panes do not depend on probes.
        const allExprs = [
          ...new Set(
            section.panes.flatMap((p) => p.traces.map((t) => t.expression.trim())).filter(Boolean),
          ),
        ];
        const layout = section.panes.map((pane, i) => ({
          id: `plt-p${i}`,
          traceIds: pane.traces
            .map((t) => t.expression.trim())
            .filter(Boolean)
            .map((expr) => `expr:${expr}`),
        }));
        setExprList(allExprs);
        setPaneLayout(layout.length > 0 ? layout : applied.layout);
        setPltXWindow(applied.xWindow);
      } else if (kind === "ac") {
        if (!acResult?.ok) throw new Error("Run an AC analysis before applying .plt settings.");
        const resolve = makePltTraceResolver(acResult.traces.map((t) => ({ id: t.id, label: t.label })));
        const applied = applyPltSection(section, resolve);
        // Bode multi-pane layout is not the transient pane model — collect every
        // plotted expression (resolved labels + arithmetic) into the AC bar.
        const exprs = section.panes.flatMap((p) => p.traces.map((t) => t.expression.trim())).filter(Boolean);
        const needEval = [
          ...applied.expressions,
          ...exprs.filter((e) => !resolve(e) && !applied.expressions.includes(e)),
        ];
        // Prefer keeping simple V(node) traces via the AC result itself; only
        // push arithmetic / unresolved into the expression bar.
        if (needEval.length > 0) {
          setAcExprList((prev) => {
            const next = [...prev];
            for (const expr of needEval) {
              if (!next.includes(expr)) next.push(expr);
            }
            return next;
          });
        } else {
          // All traces resolved: still surface them as AC expressions so the
          // Bode pane shows the .plt selection even when probes differ.
          setAcExprList(exprs);
        }
        setPltXWindow(applied.xWindow);
      } else if (kind === "dc") {
        if (!dcResult?.ok) throw new Error("Run a DC sweep before applying .plt settings.");
        const resolve = makePltTraceResolver(dcResult.nets.map((n) => ({ id: n.id, label: n.label })));
        const applied = applyPltSection(section, resolve);
        if (applied.expressions.length > 0) {
          setDcExprList((prev) => {
            const next = [...prev];
            for (const expr of applied.expressions) {
              if (!next.includes(expr)) next.push(expr);
            }
            return next;
          });
        }
        setPltXWindow(applied.xWindow);
      } else {
        throw new Error(
          `This .plt section is “${section.header}”; Tau applies Transient/AC/DC plot settings only.`,
        );
      }

      setPltLoadedName(file.name);
      setPltError(null);
    } catch (err) {
      setPltLoadedName(null);
      setPltError(err instanceof Error ? err.message : "Could not read the .plt file.");
    } finally {
      if (pltInputRef.current) pltInputRef.current.value = "";
    }
  };

  /** Save current panes/expressions/X as an LTspice-compatible `.plt`. */
  const savePlotSettings = () => {
    try {
      const kind = pltKindForMode(mode, stepDomain);
      if (kind !== "transient" && kind !== "ac" && kind !== "dc") {
        throw new Error("Save .plt supports Transient, AC, and DC plot settings only.");
      }

      const labelById = new Map<string, string>();
      if (result?.ok) {
        for (const t of result.traces) labelById.set(t.id, t.label);
        for (const c of result.currents) labelById.set(`I(${c.ref})`, c.label);
      }
      for (const t of exprTraces) labelById.set(t.id, t.label);
      if (acResult?.ok) {
        for (const t of acResult.traces) labelById.set(t.id, t.label);
      }
      for (const t of acExprTraces) labelById.set(t.id, t.label);
      if (dcResult?.ok) {
        for (const n of dcResult.nets) labelById.set(n.id, n.label);
      }
      for (const t of dcExprTraces) labelById.set(t.id, t.label);

      const labelForId = (id: string) => labelById.get(id) ?? null;

      let panes: { expressions: string[] }[];
      if (kind === "transient") {
        panes = paneLayout.map((pane) => ({
          expressions: pane.traceIds
            .map((id) => expressionFromTraceId(id, labelForId))
            .filter((e): e is string => Boolean(e)),
        }));
        // If panes are empty but expression bar has entries, emit one pane.
        if (panes.every((p) => p.expressions.length === 0) && exprList.length > 0) {
          panes = [{ expressions: [...exprList] }];
        }
      } else if (kind === "ac") {
        const exprs = acExprList.length > 0
          ? [...acExprList]
          : (acResult?.ok ? acResult.traces.map((t) => t.label) : []);
        panes = [{ expressions: exprs }];
      } else {
        const exprs = dcExprList.length > 0
          ? [...dcExprList]
          : (dcResult?.ok ? dcResult.nets.filter((n) => !n.ground).map((n) => n.label) : []);
        panes = [{ expressions: exprs }];
      }

      if (!panes.some((p) => p.expressions.length > 0)) {
        throw new Error("Nothing to save — add a probe or plot expression first.");
      }

      const xWindow =
        pltXWindow
        ?? (kind === "transient" && result?.ok
          ? { xMin: 0, xMax: result.times[result.times.length - 1] || 1 }
          : null);

      const section = buildPltSection({
        kind,
        panes,
        xWindow,
        activePane: 0,
      });
      downloadText(serializePlt({ sections: [section] }), "plot", "plt", "text/plain");
      setPltError(null);
    } catch (err) {
      setPltError(err instanceof Error ? err.message : "Could not save the .plt file.");
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
  // When a `.plt` is applied, preserve its pane grouping via reconcile instead.
  const availableTraceKey = availableTraceIds.join("\u0000");
  useEffect(() => {
    if (pltLoadedName) {
      setPaneLayout((prev) => reconcileLayout(prev, availableTraceIds));
    } else {
      setPaneLayout(automaticLayout(availableTraceIds));
    }
    // The stable key deliberately ignores a new result object's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableTraceKey, pltLoadedName]);

  const plotExpression = useCallback(
    (raw: string) => {
      const expr = raw.trim();
      if (!expr) return;
      const probe = evaluatePlotExpression(expr, result, "#000");
      if (!probe.ok) {
        setExprError(probe.error);
        return;
      }
      if (!exprList.includes(expr)) setExprList((prev) => [...prev, expr]);
      setExprError(null);
    },
    [exprList, result],
  );

  const addExpression = () => {
    const expr = exprInput.trim();
    if (!expr) return;
    plotExpression(expr);
    setExprInput("");
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
  // expressions) as a CSV table - one column per signal, one row per timestep.
  const exportCsv = () => {
    if (!result || !result.ok) return;
    const series = [
      ...result.traces.map((t) => ({ label: t.label, values: t.values })),
      ...result.currents.map((c) => ({ label: c.label, values: c.values })),
      ...exprTraces.map((t) => ({ label: t.label, values: t.values })),
    ];
    downloadCsv(seriesToCsv("time", result.times, series), "transient");
  };

  const exportPng = async () => {
    try {
      const svgs = transientPlotsRef.current?.querySelectorAll<SVGSVGElement>("svg.scope-svg") ?? [];
      const blob = await waveformSvgsToPng(Array.from(svgs));
      downloadWaveformPng(blob);
      setExportError(null);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Could not export the waveform PNG.");
    }
  };

  const exportAcPng = async () => {
    try {
      const svgs = acPlotsRef.current?.querySelectorAll<SVGSVGElement>("svg.scope-svg") ?? [];
      const blob = await waveformSvgsToPng(Array.from(svgs));
      downloadWaveformPng(blob, "ac");
      setExportError(null);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Could not export the Bode PNG.");
    }
  };

  const exportDcPng = async () => {
    try {
      const svgs = dcPlotsRef.current?.querySelectorAll<SVGSVGElement>("svg.scope-svg") ?? [];
      const blob = await waveformSvgsToPng(Array.from(svgs));
      downloadWaveformPng(blob, "dc");
      setExportError(null);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Could not export the DC PNG.");
    }
  };

  const exportNoisePng = async () => {
    try {
      const svgs = noisePlotsRef.current?.querySelectorAll<SVGSVGElement>("svg.scope-svg") ?? [];
      const blob = await waveformSvgsToPng(Array.from(svgs));
      downloadWaveformPng(blob, "noise");
      setExportError(null);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Could not export the noise PNG.");
    }
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
        {
          components,
          wires,
          netLabels,
          params,
          directives,
          ...(userModelLibraryTexts.length > 0 ? { userModelLibraries: userModelLibraryTexts, userModelLibraryNames } : {}),
        },
        { kind: "tran", stopTime: options.stopTime, steps: options.steps },
      );
      downloadText(deck.netlist, "netlist", "cir", "text/plain");
      setExportError(null);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Could not build the netlist.");
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
  const transientCursorPositions = useMemo(() => {
    if (!cursorsOpen || !result?.ok || result.times.length === 0) return null;
    return {
      x1: fractionToX(result.times, cursorF1),
      x2: fractionToX(result.times, cursorF2),
    };
  }, [cursorsOpen, result, cursorF1, cursorF2]);
  const minimumTransientSteps =
    resolution && resolution.requiredSteps > 0 && resolution.requiredSteps <= maxTransientSteps
      ? Math.max(32, resolution.requiredSteps)
      : 32;
  const resolvedOptionsSource = optionsSource ?? (optionsAuto === false ? "custom" : "automatic");
  const detailInputs = useMemo(() => collectAutoResolutionInputs(components), [components]);
  const detailSteps = useMemo<Record<TransientDetailLevel, number>>(() => ({
    quick: Math.max(minimumTransientSteps, transientDetailSteps(detailInputs, options.stopTime, "quick", maxTransientSteps)),
    balanced: Math.max(minimumTransientSteps, transientDetailSteps(detailInputs, options.stopTime, "balanced", maxTransientSteps)),
    precision: Math.max(minimumTransientSteps, transientDetailSteps(detailInputs, options.stopTime, "precision", maxTransientSteps)),
  }), [detailInputs, maxTransientSteps, minimumTransientSteps, options.stopTime]);
  const selectedDetail = (Object.entries(detailSteps) as [TransientDetailLevel, number][])
    .find(([, steps]) => steps === options.steps)?.[0] ?? null;

  // one status voice for the whole panel: the dashboard strip
  // under the tabs. Idle (nothing run), Running (amber, tactical), Complete
  // (success + last-run figures), Error (danger, details live in the Errors
  // panel). Each tab reads its own result object; no invented values.
  const activeResult: ({ ok: boolean } & EngineProvenance) | null =
    mode === "tran" ? result
    : mode === "op" ? opResult
    : mode === "ac" ? acResult
    : mode === "dc" ? dcResult
    : mode === "tf" ? tfResult
    : mode === "noise" ? noiseResult
    : mode === "step" && stepDomain === "ac"
      ? (acStepFamily ? { ok: acStepFamily.ok, ...(stepResult?.engine ? { engine: stepResult.engine } : {}) } : stepResult)
    : mode === "step" && stepDomain === "dc"
      ? (dcStepFamily ? { ok: dcStepFamily.ok, ...(stepResult?.engine ? { engine: stepResult.engine } : {}) } : stepResult)
    : stepResult;
  const runStatus = isRunning ? "running" : activeResult ? (activeResult.ok ? "complete" : "error") : "idle";
  // Read off the displayed result, not off the runtime: the two engines model
  // different circuits, so a number is only meaningful next to the name of the
  // solver that produced it. Absent while running or idle - there is no result
  // to attribute yet - and absent on a result that never chose an engine.
  const activeEngine = isRunning ? undefined : activeResult?.engine;
  const statusLabel =
    runStatus === "running" ? "Running"
    : runStatus === "complete" ? "Complete"
    : runStatus === "error" ? "Error"
    : "Idle";
  const lastRunInfo =
    runStatus === "complete" && mode === "tran" && result?.ok
      ? `${formatEngineering(result.stats.stopTime, "s", 2)} · ${result.stats.sampleCount} samples · ${result.stats.netCount} nets · ${result.stats.componentCount} parts${lastRunDurationMs !== null ? ` · ${formatElapsed(lastRunDurationMs)} elapsed` : ""}`
      : runStatus === "error"
        ? "Simulation failed - details below"
        : runStatus === "idle"
          ? "No analysis yet — press Run"
          : null;

  // Selecting an analysis tab both switches the visible pane and kicks off
  // that analysis immediately - the one primary Run control lives in the top
  // toolbar; in here tab selection IS the run gesture.
  const handleModeChange = (next: AnalysisMode) => {
    setMode(next);
    if (next === "tran") void onRun();
    else if (next === "op") void onRunOperatingPoint();
    else if (next === "ac") void onRunAcSweep();
    else if (next === "dc") void onRunDcSweep();
    else if (next === "tf") void onRunTf();
    else if (next === "noise") void onRunNoise();
    else if (next === "step") void onRunStep();
  };

  // Fix 3 - a run long enough to need a Stop button also deserves copy that
  // says what's actually running, not just a generic "Running…" (the status
  // strip below already covers the generic case; this is the loud overlay).
  const runningLabel =
    mode === "tran" ? "Running transient analysis…"
    : mode === "op" ? "Running operating point…"
    : mode === "ac" ? "Running AC sweep…"
    : mode === "dc" ? "Running DC sweep…"
    : mode === "tf" ? "Running transfer function…"
    : mode === "noise" ? "Running noise analysis…"
    : "Running step sweep…";
  const runPercent = runProgress != null ? Math.round(runProgress * 100) : null;

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
          {/* No Run button here - the single primary Run lives in the top
              toolbar. Duration/detail live in Advanced ▸ Simulation settings;
              run status lives in the dashboard strip under the tabs. */}
        </div>
      </div>

      <div className="plotter-tabs">
        <AnalysisModeRail value={mode} onValueChange={handleModeChange} disabled={isRunning} />
      </div>

      <div className={`plotter-status plotter-status--${runStatus}`} role="status" aria-live="polite">
        <span className="plotter-status-lamp" aria-hidden="true" />
        <span className="plotter-status-state">{statusLabel}</span>
        {lastRunInfo && <span className="plotter-status-info">{lastRunInfo}</span>}
        {activeEngine && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={`plotter-status-engine plotter-status-engine--${activeEngine}`}
                data-engine={activeEngine}
                // Focusable so the caveat about what each engine models is
                // reachable without a pointer; the label itself is visible
                // regardless, so nothing essential lives only in the tooltip.
                tabIndex={0}
              >
                {ENGINE_LABELS[activeEngine]}
              </span>
            </TooltipTrigger>
            <TooltipContent>{ENGINE_DESCRIPTIONS[activeEngine]}</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* `.plotter-body` is the positioning root for the run overlay below -
          it needs to center over the plots specifically, not the whole
          panel (which would cover the header/tabs/status strip too). */}
      <div className="plotter-body">
        {isRunning && (
          <div className="run-overlay">
            <div className="run-overlay-card">
              <div className="run-overlay-title">{runningLabel}</div>
              <div
                className="run-overlay-track"
                role="progressbar"
                aria-label="Simulation progress"
                aria-valuemin={0}
                aria-valuemax={100}
                {...(runPercent != null ? { "aria-valuenow": runPercent } : {})}
              >
                <div
                  className={`run-overlay-fill${runPercent == null ? " indeterminate" : ""}`}
                  style={runPercent != null ? { width: `${runPercent}%` } : undefined}
                />
              </div>
              <div className="run-overlay-meta">
                <span className="run-overlay-percent">{runPercent != null ? `${runPercent}%` : "Solving…"}</span>
                <Button variant="outline" size="sm" onClick={onStop} className="run-overlay-stop">
                  Stop
                </Button>
              </div>
            </div>
          </div>
        )}

      {mode === "tran" && (
        <>
          <div ref={transientPlotsRef}>
            <WaveformPlot
              result={result}
              baseTraces={baseTraces}
              netLabels={netLabels}
              extraTraces={scopeTraces}
              paneLayout={paneLayout}
              showStatistics={showStats}
              measurements={measurements}
              fourier={fourier}
              layoutKey={circuitTitle ?? "default"}
              forcedX={pltXWindow}
              onPlotExpression={plotExpression}
              cursors={transientCursorPositions}
              cursorTool={{
                activeCursor: cursorsOpen ? activeTransientCursor : null,
                onActiveCursorChange: (cursor) => {
                  if (cursor !== null) setCursorsOpen(true);
                  setActiveTransientCursor(cursor);
                },
                onCursorFractionChange: (cursor, fraction) => {
                  if (cursor === "c1") setCursorF1(fraction);
                  else setCursorF2(fraction);
                },
              }}
            />
          </div>

          <div className="advanced-settings">
            <button
              className="disclosure-header"
              onClick={() => setAdvancedOpen((o) => !o)}
              aria-expanded={advancedOpen}
              aria-label="Toggle advanced settings"
            >
              <span className="disclosure-label">Advanced</span>
              <span className="advanced-settings-auto">{resolvedOptionsSource.toUpperCase()}</span>
              <span className="disclosure-rule" aria-hidden="true" />
              <span className={`disclosure-chevron${advancedOpen ? " open" : ""}`}>›</span>
            </button>
            {advancedOpen && (
              <div className="advanced-body">
                <section className="advanced-group">
                  <h4 className="advanced-group-title">Plot tools</h4>
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
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => pltInputRef.current?.click()}
                          disabled={mode !== "tran" && mode !== "ac" && mode !== "dc" && mode !== "step"}
                        >
                          {pltLoadedName ? "Open .plt ✓" : "Open .plt"}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Apply LTspice .plt plot settings (panes, traces, X window)</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={savePlotSettings}
                          disabled={mode !== "tran" && mode !== "ac" && mode !== "dc"}
                        >
                          Save .plt
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Export current panes/expressions as an LTspice .plt</TooltipContent>
                    </Tooltip>
                    {pltLoadedName && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setPltLoadedName(null);
                              setPltXWindow(null);
                              setPltError(null);
                            }}
                          >
                            Clear .plt
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Clear applied plot settings (keeps current probes)</TooltipContent>
                      </Tooltip>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant={showStats ? "secondary" : "outline"}
                          size="sm"
                          aria-pressed={showStats}
                          onClick={() => setShowStats((s) => !s)}
                        >
                          Plot statistics
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Show MIN/AVG/MAX reference lines on single-trace panes</TooltipContent>
                    </Tooltip>
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
                    <input
                      ref={pltInputRef}
                      className="file-input"
                      type="file"
                      accept=".plt"
                      onChange={(e) => {
                        const file = e.currentTarget.files?.[0];
                        if (file) void loadPlotSettings(file);
                      }}
                    />
                  </div>
                  {refError && <div className="expr-error" role="alert">{refError}</div>}
                  {pltError && <div className="expr-error" role="alert">{pltError}</div>}
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
                </section>

                <section className="advanced-group">
                  <h4 className="advanced-group-title">Spectrum &amp; cursors</h4>
                  <FftView result={result} preferredSignals={baseTraces.map((trace) => trace.label)} />
                  <CursorView
                    result={result}
                    extraTraces={exprTraces}
                    open={cursorsOpen}
                    onOpenChange={(open) => {
                      setCursorsOpen(open);
                      setActiveTransientCursor(open ? (activeTransientCursor ?? "c1") : null);
                    }}
                    f1={cursorF1}
                    f2={cursorF2}
                    onF1Change={setCursorF1}
                    onF2Change={setCursorF2}
                  />
                </section>

                <section className="advanced-group">
                  <h4 className="advanced-group-title">Export</h4>
                  <div className="expr-bar">
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
                        <Button variant="outline" size="sm" onClick={() => void exportPng()} disabled={!result?.ok}>
                          Export PNG
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Export every visible transient plot pane as one PNG image</TooltipContent>
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
                  </div>
                  {exportError && <div className="expr-error" role="alert">{exportError}</div>}
                </section>

                <section className="advanced-group">
                  <h4 className="advanced-group-title">Simulation settings</h4>
                  <div className="advanced-settings-help-row">
                    <p className="advanced-settings-help">
                      STOP is simulated circuit time, not wall-clock solve time. Unless you override it, Tau sets output point density from the fastest source and reactive time constants.
                    </p>
                    <div className="flex items-center gap-2">
                      {resolvedOptionsSource === "custom" && onResetOptions && (
                        <Button variant="outline" size="sm" onClick={onResetOptions}>
                          Use {resetOptionsTarget === "document" ? "document" : "automatic"} settings
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="transient-settings-grid">
                    <CircuitDurationControl
                      key={circuitTitle ?? "default"}
                      seconds={options.stopTime}
                      onChange={(stopTime) => onOptionsChange({ ...options, stopTime })}
                    />
                    <div className="waveform-detail-control">
                      <div className="waveform-detail-control__head">
                        <span>Waveform detail</span>
                        <strong>{resolvedOptionsSource === "automatic"
                          ? "Circuit-aware"
                          : resolvedOptionsSource === "document"
                            ? "From document"
                            : selectedDetail ? detailLabel(selectedDetail) : "Custom"}</strong>
                      </div>
                      <div className="waveform-detail-presets" role="group" aria-label="Waveform detail">
                        {(["quick", "balanced", "precision"] as const).map((detail) => (
                          <button
                            key={detail}
                            type="button"
                            aria-label={`Use ${detail} waveform detail`}
                            aria-pressed={resolvedOptionsSource === "custom" && selectedDetail === detail}
                            onClick={() => onOptionsChange({ ...options, steps: detailSteps[detail] })}
                          >
                            <strong>{detailLabel(detail)}</strong>
                            <small>{detailDescription(detail)}</small>
                          </button>
                        ))}
                      </div>
                      <small className="waveform-detail-note">
                        Output interval {formatEngineering(options.stopTime / options.steps, "s", 3)} · {formatCount(options.steps)} points. Solver time depends on circuit complexity and convergence.
                      </small>
                    </div>
                    <ResolutionControl
                      resolution={resolution}
                      maxSteps={maxTransientSteps}
                    />
                    <details className="transient-expert-settings">
                      <summary>Exact output settings</summary>
                      <label>
                        <span>Output points</span>
                        <Input
                          type="number"
                          variant="mono"
                          aria-label="Exact output points"
                          min={minimumTransientSteps}
                          max={maxTransientSteps}
                          step={1}
                          value={options.steps}
                          onChange={(event) => {
                            const steps = Number(event.currentTarget.value);
                            if (!Number.isInteger(steps) || steps < minimumTransientSteps || steps > maxTransientSteps) return;
                            onOptionsChange({ ...options, steps });
                          }}
                        />
                      </label>
                      <small>Use an exact count for imported-result reproduction or a controlled convergence study.</small>
                    </details>
                  </div>
                </section>
              </div>
            )}
          </div>
        </>
      )}

      {mode === "op" && <OpTable result={opResult} />}
      {mode === "ac" && (
        <>
          <div ref={acPlotsRef}>
            <AcPlot result={acResult} overlays={acExprTraces} />
          </div>
          <AcFamilyPlot family={acStepFamily} />
          <MeasTable measurements={acMeasurements} />

          <div className="advanced-settings">
            <button
              className="disclosure-header"
              onClick={() => setAcAdvancedOpen((o) => !o)}
              aria-expanded={acAdvancedOpen}
              aria-label="Toggle advanced settings"
            >
              <span className="disclosure-label">Advanced</span>
              <span className="disclosure-rule" aria-hidden="true" />
              <span className={`disclosure-chevron${acAdvancedOpen ? " open" : ""}`}>›</span>
            </button>
            {acAdvancedOpen && (
              <div className="advanced-body">
                <section className="advanced-group">
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
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="sm" onClick={() => void exportAcPng()} disabled={!acResult?.ok}>
                          Export PNG
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Export Bode magnitude and phase panes as one PNG image</TooltipContent>
                    </Tooltip>
                  </div>
                  {acExprError && <div className="expr-error" role="alert">{acExprError}</div>}
                  {exportError && mode === "ac" && <div className="expr-error" role="alert">{exportError}</div>}
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
                </section>
              </div>
            )}
          </div>
        </>
      )}
      {mode === "dc" && (
        <>
          <DcSetupForm setup={dcSetup} components={components} onChange={onDcSetupChange} />
          <div ref={dcPlotsRef}>
            <DcPlot result={dcResult} overlays={dcExprTraces} />
          </div>
          <DcFamilyPlot family={dcStepFamily} />
          <MeasTable measurements={dcMeasurements} />

          <div className="advanced-settings">
            <button
              className="disclosure-header"
              onClick={() => setDcAdvancedOpen((o) => !o)}
              aria-expanded={dcAdvancedOpen}
              aria-label="Toggle advanced settings"
            >
              <span className="disclosure-label">Advanced</span>
              <span className="disclosure-rule" aria-hidden="true" />
              <span className={`disclosure-chevron${dcAdvancedOpen ? " open" : ""}`}>›</span>
            </button>
            {dcAdvancedOpen && (
              <div className="advanced-body">
                <section className="advanced-group">
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
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="sm" onClick={() => void exportDcPng()} disabled={!dcResult?.ok}>
                          Export PNG
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Export the DC sweep plot as a PNG image</TooltipContent>
                    </Tooltip>
                  </div>
                  {dcExprError && <div className="expr-error" role="alert">{dcExprError}</div>}
                  {exportError && mode === "dc" && <div className="expr-error" role="alert">{exportError}</div>}
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
                </section>
              </div>
            )}
          </div>
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
          <div ref={noisePlotsRef}>
            <NoisePlot result={noiseResult} />
          </div>
          <MeasTable measurements={noiseMeasurements} />

          <div className="advanced-settings">
            <button
              className="disclosure-header"
              onClick={() => setNoiseAdvancedOpen((o) => !o)}
              aria-expanded={noiseAdvancedOpen}
              aria-label="Toggle advanced settings"
            >
              <span className="disclosure-label">Advanced</span>
              <span className="disclosure-rule" aria-hidden="true" />
              <span className={`disclosure-chevron${noiseAdvancedOpen ? " open" : ""}`}>›</span>
            </button>
            {noiseAdvancedOpen && (
              <div className="advanced-body">
                <section className="advanced-group">
                  <div className="expr-bar">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="sm" onClick={exportNoiseCsv} disabled={!noiseResult?.ok}>
                          Export CSV
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Export the noise spectrum as a CSV table</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="sm" onClick={() => void exportNoisePng()} disabled={!noiseResult?.ok}>
                          Export PNG
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Export the noise spectrum plot as a PNG image</TooltipContent>
                    </Tooltip>
                  </div>
                  {exportError && mode === "noise" && <div className="expr-error" role="alert">{exportError}</div>}
                </section>
              </div>
            )}
          </div>
        </>
      )}
      {mode === "step" && (
        <>
          <StepSetupForm setup={stepSetupUi} components={components} onChange={onStepSetupUiChange} />
          {stepDomain === "ac" ? (
            <AcFamilyPlot family={acStepFamily} />
          ) : stepDomain === "dc" ? (
            <DcFamilyPlot family={dcStepFamily} />
          ) : (
            <StepPlot result={stepResult} probes={probes} wires={wires} />
          )}
          {stepResult && !stepResult.ok && stepResult.message && stepDomain !== "tran" && (
            <div className="warning-list" role="alert">
              <div>{stepResult.message}</div>
            </div>
          )}
        </>
      )}

      {/* Run warnings live in Diagnostics — avoid a duplicate banner here. */}
      </div>
    </aside>
  );
}

export function WaveformPlot({
  result,
  baseTraces,
  netLabels,
  extraTraces = [],
  paneLayout,
  showStatistics = false,
  measurements = [],
  fourier = [],
  layoutKey = "default",
  forcedX = null,
  cursors = null,
  cursorTool,
  onPlotExpression,
}: {
  result: AnalysisResult | null;
  baseTraces: Trace[];
  netLabels: NetLabel[];
  /** User-entered expression traces overlaid on the scope. */
  extraTraces?: Trace[];
  paneLayout: PaneLayout;
  /** MIN/AVG/MAX overlay on single-trace panes - opt-in, off by default. */
  showStatistics?: boolean;
  /** Non-empty tables become their own snap-tiling dashboard cards, ordered
   *  and sized alongside the plot panes (see cardLayout.ts). Defaulting to
   *  `[]` keeps every prior direct-render caller (the axes tests) rendering
   *  no table cards, exactly as before this dashboard existed. */
  measurements?: MeasResult[];
  fourier?: FourierResult[];
  /** Best-effort localStorage key for the dashboard's card order/width/
   *  height, one per circuit tab (App.tsx's active document title). */
  layoutKey?: string;
  /** Optional X window from an applied LTspice `.plt` (overrides auto 0…tMax). */
  forcedX?: { xMin: number; xMax: number } | null;
  /** Active transient measurement positions, drawn through every plot pane. */
  cursors?: { x1: number; x2: number } | null;
  /** Direct plot interaction shared with the exact C1/C2 controls. */
  cursorTool?: {
    activeCursor: TransientCursorId | null;
    onActiveCursorChange: (cursor: TransientCursorId | null) => void;
    onCursorFractionChange: (cursor: TransientCursorId, fraction: number) => void;
  };
  /** Right-click math → add a derived expression overlay (parent owns exprList). */
  onPlotExpression?: (expression: string) => void;
}) {
  const success = result?.ok ? result : null;
  const [activeTraceId, setActiveTraceId] = useState<string | null>(null);
  const [traceColorOverrides, setTraceColorOverrides] = useState<Record<string, string>>({});
  const [windowStats, setWindowStats] = useState<{
    label: string;
    unit: string;
    average: number;
    rms: number;
    tMin: number;
    tMax: number;
  } | null>(null);
  useEffect(() => {
    setActiveTraceId(null);
    setTraceColorOverrides({});
    setWindowStats(null);
  }, [layoutKey]);

  // Build the full ordered trace list (all panes, all traces) the same way as
  // before - probed nets or the first 6, then expression/ref overlays.  We keep
  // a map from id → Trace for fast lookup when rendering per-pane subsets.
  const allTraces = useMemo<Trace[]>(() => {
    return [...baseTraces, ...extraTraces].map((trace) => {
      const color = traceColorOverrides[trace.id];
      return color ? { ...trace, color } : trace;
    });
  }, [baseTraces, extraTraces, traceColorOverrides]);

  const traceById = useMemo<Map<string, Trace>>(() => {
    const m = new Map<string, Trace>();
    for (const t of allTraces) m.set(t.id, t);
    return m;
  }, [allTraces]);

  const paneTracesById = useMemo(() => {
    const byPane = new Map<string, Trace[]>();
    for (const pane of paneLayout) {
      byPane.set(
        pane.id,
        pane.traceIds.map((traceId) => traceById.get(traceId)).filter((trace): trace is Trace => trace !== undefined),
      );
    }
    return byPane;
  }, [paneLayout, traceById]);

  const activeTrace = (activeTraceId ? traceById.get(activeTraceId) : undefined) ?? allTraces[0] ?? null;
  useEffect(() => {
    if (activeTrace && activeTrace.id !== activeTraceId) setActiveTraceId(activeTrace.id);
    if (!activeTrace && activeTraceId !== null) setActiveTraceId(null);
  }, [activeTrace, activeTraceId]);

  const tMax = useMemo(() => (success ? success.times[success.times.length - 1] || 1 : 1), [success]);
  const [sharedX, setSharedX] = useState({ xMin: 0, xMax: tMax });
  useEffect(() => setSharedX({ xMin: 0, xMax: tMax }), [success, tMax]);
  useEffect(() => {
    if (!forcedX) return;
    if (!(forcedX.xMax > forcedX.xMin) || !Number.isFinite(forcedX.xMin) || !Number.isFinite(forcedX.xMax)) return;
    setSharedX(forcedX);
  }, [forcedX]);
  const shareXViewport = useCallback((next: { xMin: number; xMax: number }) => {
    setSharedX((current) => current.xMin === next.xMin && current.xMax === next.xMax ? current : next);
  }, []);

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

  // ── Dashboard card model (snap-tiling grid) ──────────────────────────────
  // One card per pane (even an empty one - a pane always gets its own scope
  // face) plus one card per non-empty table. Cards are keyed by TRACE id, not
  // pane id/index: automaticLayout regenerates pane ids as `auto-p${index}`
  // whenever the signal set changes, so keying by pane id would silently
  // reassign one probe's saved width/height to whatever trace lands at that
  // index next. Recomputed plainly (no memo) every render - cheap, and
  // memoizing would need `labelFor` in the deps, which closes over `success`/
  // `netLabels` and is recreated every render anyway.
  const cardSpecs: CardSpec[] = paneLayout.map((pane) => {
    const traceId = pane.traceIds[0];
    const trace = traceId ? traceById.get(traceId) : undefined;
    return {
      id: traceId ? `plot:${traceId}` : `plot:${pane.id}`,
      kind: "plot",
      title: trace ? labelFor(trace) : "Empty pane",
    };
  });
  if (measurements.length > 0) cardSpecs.push({ id: "measurements", kind: "table", title: "Measurements" });
  if (fourier.length > 0) cardSpecs.push({ id: "fourier", kind: "table", title: "Fourier" });
  const cardById = new Map(cardSpecs.map((c) => [c.id, c]));
  const paneByCardId = new Map(paneLayout.map((pane) => {
    const traceId = pane.traceIds[0];
    return [traceId ? `plot:${traceId}` : `plot:${pane.id}`, pane] as const;
  }));

  const [cardLayout, setCardLayout] = useState<CardLayoutState>(() => loadCardLayout(layoutKey));
  const loadedKeyRef = useRef(layoutKey);
  useEffect(() => {
    // Switching circuit tabs loads THAT tab's own saved grid instead of
    // carrying the previous tab's card order/sizes across.
    if (loadedKeyRef.current === layoutKey) return;
    loadedKeyRef.current = layoutKey;
    setCardLayout(loadCardLayout(layoutKey));
  }, [layoutKey]);

  const cardSpecsKey = cardSpecs.map((c) => `${c.id}:${c.kind}`).join("|");
  const reconciled = useMemo(
    () => reconcileCardLayout(cardLayout, cardSpecs),
    // cardSpecs is a fresh array every render; cardSpecsKey is the stable
    // "same set of cards" signal (same trick as availableTraceKey above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cardLayout, cardSpecsKey],
  );
  useEffect(() => {
    saveCardLayout(layoutKey, reconciled);
  }, [layoutKey, reconciled]);

  // ── Drag-to-tile ─────────────────────────────────────────────────────────
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropPreview, setDropPreviewState] = useState<{ id: string; side: "start" | "end" } | null>(null);
  const dropPreviewRef = useRef(dropPreview);
  const setDropPreview = (next: typeof dropPreview) => {
    dropPreviewRef.current = next;
    setDropPreviewState(next);
  };

  const handleDragStart = (id: string) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setDraggingId(id);
    const onUp = () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      const preview = dropPreviewRef.current;
      if (preview) {
        const target: DropTarget = dropTargetFor(
          { id: preview.id, width: reconciled.widths[preview.id] ?? "full" },
          preview.side,
        );
        setCardLayout(() => applyDrop(reconciled, id, target));
      }
      setDraggingId(null);
      setDropPreview(null);
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const handleCardPointerMove = (id: string) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingId || draggingId === id) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const side: "start" | "end" = event.clientX < rect.left + rect.width / 2 ? "start" : "end";
    if (dropPreviewRef.current?.id === id && dropPreviewRef.current.side === side) return;
    setDropPreview({ id, side });
  };

  const clearDropPreview = () => setDropPreview(null);

  return (
    <>
    <div className="scope-shell">
      {/* The failed-run message used to live in the (removed) footer strip;
          every other tab surfaces result.message inline, so TRAN does too. */}
      {result && !result.ok && (
        <div className="analysis-empty" role="alert">
          <span>{result.message}</span>
          {result.details && (
            <details className="analysis-error-details">
              <summary>Technical details</summary>
              <pre>{result.details}</pre>
            </details>
          )}
        </div>
      )}
      {success && allTraces.length === 0 && (
        <div className="scope-empty-state">
          <Crosshair size={20} strokeWidth={1.5} aria-hidden="true" />
          <strong>Nothing to plot yet</strong>
          <span>Place a probe or label a net. Unlabeled nets stay off the plot.</span>
        </div>
      )}

      {allTraces.length > 0 && (
        <div className="plot-dashboard-grid" onPointerLeave={clearDropPreview}>
          {reconciled.order.map((id) => {
            const card = cardById.get(id);
            if (!card) return null;
            const width = reconciled.widths[id] ?? "full";
            const dropSide = dropPreview?.id === id ? dropPreview.side : null;
            const shellProps = {
              card,
              width,
              dragging: draggingId === id,
              dropSide,
              onDragStart: handleDragStart(id),
              onPointerMove: handleCardPointerMove(id),
              onToggleWidth: () => setCardLayout(() => toggleCardWidth(reconciled, id)),
            };

            if (card.kind === "table") {
              return (
                <DashboardCard key={id} {...shellProps}>
                  {id === "measurements" ? <MeasTable measurements={measurements} /> : <FourierTable results={fourier} />}
                </DashboardCard>
              );
            }

            const pane = paneByCardId.get(id);
            if (!pane) return null;
            const paneIndex = paneLayout.indexOf(pane);
            const paneTraces = paneTracesById.get(pane.id) ?? [];
            const plot =
              success && paneTraces.length > 0
                ? (() => {
                    const plan = planDualAxisY(paneTraces.map((t) => t.unit));
                    const { left, right } = partitionTracesByAxis(paneTraces, plan);
                    const leftBounds = waveformBounds(left.length > 0 ? left : paneTraces);
                    const rightBounds = right.length > 0 ? waveformBounds(right) : null;
                    return {
                      tMax,
                      left: {
                        min: leftBounds.min,
                        max: leftBounds.max,
                        unit: plan.leftUnit || commonTraceUnit(paneTraces.map((t) => t.unit)) || "V",
                      },
                      right:
                        plan.dual && rightBounds && plan.rightUnit
                          ? { min: rightBounds.min, max: rightBounds.max, unit: plan.rightUnit }
                          : null,
                    };
                  })()
                : null;
            const height = reconciled.heights[id] ?? "M";

            return (
              <DashboardCard
                key={id}
                {...shellProps}
                height={height}
                onCycleHeight={() => setCardLayout(() => cycleCardHeight(reconciled, id))}
              >
                <TranScopePane
                  paneTraces={paneTraces}
                  plot={plot}
                  times={success ? success.times : []}
                  ariaLabel={`Waveform pane ${paneIndex + 1}`}
                  showXAxis
                  // Not just `success`: on the render where a run first
                  // resolves, `plot` can still be null for one tick before
                  // `paneLayout` catches up with the new trace ids - folding
                  // `plot`'s presence into the reset key means the viewport
                  // reset effect fires exactly when this pane actually has
                  // data to fit, not before.
                  runKey={plot ? success : null}
                  sharedX={sharedX}
                  onSharedXChange={shareXViewport}
                  showStatistics={showStatistics}
                  plotHeight={PLOT_HEIGHT_PX[height]}
                  cursors={cursors}
                  activeTrace={activeTrace}
                  cursorTool={cursorTool}
                />
                <div className="scope-legend" aria-label="Trace measurements">
                  {paneTraces.length > 0 ? (
                    paneTraces.map((trace) => {
                      const displayLabel = labelFor(trace);
                      const selected = activeTrace?.id === trace.id;
                      const mathSource = expressionForTrace(trace.id, displayLabel);
                      const applyMath = (op: TraceMathOp) => {
                        if (!mathSource || !onPlotExpression) return;
                        onPlotExpression(wrapTraceMath(mathSource, op));
                      };
                      const row = (
                        <div
                          key={trace.id}
                          className={`trace-interaction${selected ? " selected" : ""}`}
                        >
                          <div className="trace-interaction__toolbar">
                            <button
                              type="button"
                              className="trace-interaction__select"
                              aria-label={`Select ${displayLabel} for cursor measurement`}
                              title="Ctrl/⌘+click for average & RMS over the visible window"
                              aria-pressed={selected}
                              onClick={(event) => {
                                if (event.ctrlKey || event.metaKey) {
                                  event.preventDefault();
                                  if (!success) return;
                                  const stats = windowedTraceStatistics(
                                    success.times,
                                    trace.values,
                                    sharedX.xMin,
                                    sharedX.xMax,
                                  );
                                  if (!stats) return;
                                  setWindowStats({
                                    label: displayLabel,
                                    unit: trace.unit,
                                    average: stats.average,
                                    rms: stats.rms,
                                    tMin: sharedX.xMin,
                                    tMax: sharedX.xMax,
                                  });
                                  return;
                                }
                                setActiveTraceId(trace.id);
                              }}
                            >
                              <i style={{ background: trace.color }} aria-hidden="true" />
                              <span>{displayLabel}</span>
                            </button>
                            {cursorTool && (
                              <div className="trace-interaction__cursors" role="group" aria-label={`Cursor tool for ${displayLabel}`}>
                                <button
                                  type="button"
                                  aria-label={`Pan ${displayLabel} plot`}
                                  aria-pressed={selected && cursorTool.activeCursor === null}
                                  onClick={() => {
                                    setActiveTraceId(trace.id);
                                    cursorTool.onActiveCursorChange(null);
                                  }}
                                >
                                  Pan
                                </button>
                                {(["c1", "c2"] as const).map((cursor) => (
                                  <button
                                    key={cursor}
                                    type="button"
                                    aria-label={`Glide cursor ${cursor === "c1" ? "1" : "2"} on ${displayLabel}`}
                                    aria-pressed={selected && cursorTool.activeCursor === cursor}
                                    onClick={() => {
                                      setActiveTraceId(trace.id);
                                      cursorTool.onActiveCursorChange(cursor);
                                    }}
                                  >
                                    {cursor.toUpperCase()}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          {selected && (
                            <div className="trace-interaction__palette" role="group" aria-label={`Color for ${displayLabel}`}>
                              {TRACE_SWATCHES.map((swatch) => {
                                const isCurrent = sameCssColor(trace.color, swatch.color);
                                // A palette entry another trace already wears is
                                // still selectable, but saying so stops the user
                                // creating two traces they cannot tell apart.
                                const takenBy = isCurrent
                                  ? undefined
                                  : allTraces.find((other) => other.id !== trace.id && sameCssColor(other.color, swatch.color));
                                return (
                                  <button
                                    key={swatch.color}
                                    type="button"
                                    className={`${isCurrent ? "active" : ""}${takenBy ? " taken" : ""}`}
                                    style={{ background: swatch.color }}
                                    aria-label={takenBy
                                      ? `Set ${displayLabel} trace color to ${swatch.name} - already used by ${labelFor(takenBy)}`
                                      : `Set ${displayLabel} trace color to ${swatch.name}`}
                                    aria-pressed={isCurrent}
                                    title={takenBy ? `${swatch.name} - already used by ${labelFor(takenBy)}` : swatch.name}
                                    onClick={() => setTraceColorOverrides((current) => ({ ...current, [trace.id]: swatch.color }))}
                                  />
                                );
                              })}
                              {/* The six presets are the same colors the engine
                                  auto-assigns, so a pane with several traces runs
                                  out. Any color is allowed. */}
                              <label
                                className="trace-interaction__custom-color"
                                title={`Pick any color for ${displayLabel}`}
                              >
                                <input
                                  type="color"
                                  value={resolveCssColorHex(trace.color)}
                                  aria-label={`Pick a custom color for ${displayLabel}`}
                                  onChange={(event) => {
                                    const color = event.currentTarget.value;
                                    setTraceColorOverrides((current) => ({ ...current, [trace.id]: color }));
                                  }}
                                />
                              </label>
                            </div>
                          )}
                          {selected && cursorTool && success && success.times.length > 1 && (
                            <TraceSeekFields
                              trace={trace}
                              label={displayLabel}
                              times={success.times}
                              cursorX={cursors
                                ? (cursorTool.activeCursor === "c2" ? cursors.x2 : cursors.x1)
                                : null}
                              activeCursor={cursorTool.activeCursor}
                              onSeek={(fraction) => {
                                // Typing a coordinate is itself a request to
                                // place a cursor, so default to C1 rather than
                                // silently doing nothing in Pan mode.
                                const target = cursorTool.activeCursor ?? "c1";
                                if (cursorTool.activeCursor === null) cursorTool.onActiveCursorChange(target);
                                cursorTool.onCursorFractionChange(target, fraction);
                              }}
                            />
                          )}
                          {selected && cursorTool?.activeCursor && (
                            <p className="trace-interaction__hint">
                              Move over the plot · drag on touch · ←/→ for fine control
                            </p>
                          )}
                          <EngineeringTraceReadout
                            trace={{ ...trace, label: displayLabel }}
                            times={success ? success.times : []}
                            cursor={selected && cursors && cursorTool?.activeCursor
                              ? {
                                  label: cursorTool.activeCursor.toUpperCase(),
                                  time: cursorTool.activeCursor === "c1" ? cursors.x1 : cursors.x2,
                                }
                              : undefined}
                          />
                        </div>
                      );
                      if (!mathSource || !onPlotExpression) return row;
                      return (
                        <ContextMenu key={trace.id}>
                          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
                          <ContextMenuContent aria-label={`Math for ${displayLabel}`}>
                            <ContextMenuLabel>Math</ContextMenuLabel>
                            <ContextMenuSeparator />
                            {traceMathMenuItems().map((item) => (
                              <ContextMenuItem
                                key={item.op}
                                onClick={() => applyMath(item.op)}
                              >
                                {item.label.replace("…", displayLabel)}
                              </ContextMenuItem>
                            ))}
                          </ContextMenuContent>
                        </ContextMenu>
                      );
                    })
                  ) : (
                    <span className="muted">Empty - move a trace here</span>
                  )}
                </div>
              </DashboardCard>
            );
          })}
        </div>
      )}
    </div>
    <Dialog open={windowStats !== null} onOpenChange={(open) => { if (!open) setWindowStats(null); }}>
      <DialogContent aria-describedby="window-avg-rms-desc">
        <DialogHeader>
          <DialogTitle>{windowStats ? `${windowStats.label} — visible window` : "Visible window"}</DialogTitle>
          <DialogDescription id="window-avg-rms-desc">
            Average and RMS over the zoomed time window (LTspice Ctrl+click on a trace label).
          </DialogDescription>
        </DialogHeader>
        {windowStats && (
          <dl className="window-avg-rms" aria-label={`${windowStats.label} average and RMS`}>
            <div>
              <dt>From</dt>
              <dd>{formatEngineering(windowStats.tMin, "s", 3)}</dd>
            </div>
            <div>
              <dt>To</dt>
              <dd>{formatEngineering(windowStats.tMax, "s", 3)}</dd>
            </div>
            <div>
              <dt>Average</dt>
              <dd>{formatEngineering(windowStats.average, windowStats.unit, 3)}</dd>
            </div>
            <div>
              <dt>RMS</dt>
              <dd>{formatEngineering(windowStats.rms, windowStats.unit, 3)}</dd>
            </div>
          </dl>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}

/**
 * Slim header chrome shared by every dashboard card (plot panes AND the
 * measurements/Fourier tables): a drag handle, title, optional height cycle
 * (plots only - tables auto-height), and a width toggle. Owns none of the
 * layout state itself - purely presentational plus the pointer-down that
 * starts a drag, so {@link WaveformPlot} stays the single source of truth
 * for card order/width/height.
 */
function DashboardCard({
  card,
  width,
  height,
  dragging,
  dropSide,
  onDragStart,
  onPointerMove,
  onToggleWidth,
  onCycleHeight,
  children,
}: {
  card: CardSpec;
  width: CardWidth;
  height?: CardHeight;
  dragging: boolean;
  dropSide: "start" | "end" | null;
  onDragStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onToggleWidth: () => void;
  onCycleHeight?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={`dashboard-card dashboard-card--${width}${dragging ? " dashboard-card--dragging" : ""}`}
      data-card-id={card.id}
      onPointerMove={onPointerMove}
    >
      {dropSide && <div className={`dashboard-card-drop dashboard-card-drop--${dropSide}`} aria-hidden="true" />}
      <div className="dashboard-card-header">
        <button
          type="button"
          className="dashboard-card-handle"
          aria-label={`Reorder ${card.title}`}
          onPointerDown={onDragStart}
        >
          ⋮⋮
        </button>
        <span className="dashboard-card-title">{card.title}</span>
        {onCycleHeight && (
          <button
            type="button"
            className="dashboard-card-btn"
            onClick={onCycleHeight}
            aria-label={`Cycle ${card.title} plot height`}
            title="Cycle plot height (S/M/L)"
          >
            {height}
          </button>
        )}
        <button
          type="button"
          className="dashboard-card-btn"
          onClick={onToggleWidth}
          aria-label={width === "half" ? `Widen ${card.title} to full width` : `Narrow ${card.title} to half width`}
          title="Toggle card width"
        >
          {width === "half" ? "½" : "Full"}
        </button>
      </div>
      <div className="dashboard-card-body">{children}</div>
    </div>
  );
}

/**
 * One TRAN scope pane's `<svg>`: real tick axes (via {@link PlotAxes}) plus
 * the trace paths, with Desmos-style cursor-anchored ⌘/pinch-wheel zoom
 * (plain wheel scrolls the panel instead - see `usePlotViewport`), drag pan,
 * and an auto-fit ⌂ button (`usePlotViewport`). Split out of
 * {@link WaveformPlot}'s per-pane `.map()` so each pane can own its own
 * hooks - hooks can't live inside a `.map()` callback in the parent, and
 * each pane needs an independent zoom viewport anyway.
 */
function TranScopePane({
  paneTraces,
  plot,
  times,
  ariaLabel,
  showXAxis,
  runKey,
  sharedX,
  onSharedXChange,
  showStatistics,
  plotHeight = 190,
  cursors,
  activeTrace,
  cursorTool,
}: {
  paneTraces: Trace[];
  /** Left-axis domain (+ optional right-axis for mixed V+A). */
  plot: {
    tMax: number;
    left: { min: number; max: number; unit: string };
    right: { min: number; max: number; unit: string } | null;
  } | null;
  times: number[];
  ariaLabel: string;
  showXAxis: boolean;
  /** Identity of the current run - changing it resets this pane's zoom to full-fit. */
  runKey: unknown;
  sharedX: { xMin: number; xMax: number };
  onSharedXChange: (x: { xMin: number; xMax: number }) => void;
  /** MIN/AVG/MAX overlay on this pane, when it carries exactly one trace. */
  showStatistics: boolean;
  /** Dashboard card height (S/M/L → 160/190/260, see cardLayout.ts). Defaults
   *  to the old fixed 190 for any caller that doesn't specify one. */
  plotHeight?: number;
  cursors?: { x1: number; x2: number } | null;
  activeTrace?: Trace | null;
  cursorTool?: {
    activeCursor: TransientCursorId | null;
    onActiveCursorChange: (cursor: TransientCursorId | null) => void;
    onCursorFractionChange: (cursor: TransientCursorId, fraction: number) => void;
  };
}) {
  const clipId = useId();
  const [measureRef, size] = useMeasuredSize<SVGSVGElement>();
  const { targetXTicks, targetYTicks } = tickCountsFromSize(size);
  // Placeholder domain for a pane with no traces yet (e.g. just added via
  // "move to pane", data not resolved this tick) - 0..1 is arbitrary and must
  // never be shared: `onXViewportChange` below is only wired up when `plot`
  // is real, so this placeholder can't leak into `sharedX` and drag siblings
  // with real (e.g. millisecond-scale) data onto a bogus 0-1s window.
  // Left axis owns the zoomable Y viewport; right-axis (amps) stays data-fit.
  const domain = useMemo<Viewport>(
    () => ({
      xMin: 0,
      xMax: plot ? plot.tMax : 1,
      yMin: plot ? plot.left.min : -1,
      yMax: plot ? plot.left.max : 1,
    }),
    [plot],
  );
  const { viewport, attachSvg, isPanning, fit, fitTo, zoomBy, dragHandlers } = usePlotViewport({
    domain,
    resetKey: runKey,
    width: PLOT_WIDTH,
    height: plotHeight,
    pad: PLOT_PAD,
    sharedX,
    onXViewportChange: plot ? onSharedXChange : undefined,
  });
  const setRefs = useCallback(
    (el: SVGSVGElement | null) => {
      measureRef.current = el;
      attachSvg(el);
    },
    [measureRef, attachSvg],
  );
  const autoFrame = useCallback(() => {
    fitTo(autoFrameWaveform(times, paneTraces, viewport));
  }, [fitTo, paneTraces, times, viewport]);
  const yRangeForTrace = useCallback(
    (trace: Trace): { min: number; max: number } => {
      if (plot?.right && trace.unit === plot.right.unit) {
        return { min: plot.right.min, max: plot.right.max };
      }
      return { min: viewport.yMin, max: viewport.yMax };
    },
    [plot, viewport.yMin, viewport.yMax],
  );
  const tracePaths = useMemo(
    () => paneTraces.map((trace) => {
      const y = yRangeForTrace(trace);
      return {
        trace,
        path: tracePath(trace, times, viewport.xMin, viewport.xMax, y.min, y.max, plotHeight),
      };
    }),
    [paneTraces, times, viewport.xMin, viewport.xMax, yRangeForTrace, plotHeight],
  );
  const selectedPaneTrace = activeTrace
    ? paneTraces.find((trace) => trace.id === activeTrace.id) ?? null
    : null;
  const dragPointerRef = useRef<number | null>(null);
  const glideFromPointer = useCallback((event: ReactPointerEvent<SVGRectElement>) => {
    if (!cursorTool?.activeCursor) return;
    if (event.pointerType === "touch" && dragPointerRef.current !== event.pointerId) return;
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const fraction = plotClientXToFraction(
      event.clientX,
      svg.getBoundingClientRect(),
      PLOT_WIDTH,
      PLOT_PAD,
      viewport,
      times,
    );
    if (Number.isFinite(fraction)) cursorTool.onCursorFractionChange(cursorTool.activeCursor, fraction);
  }, [cursorTool, times, viewport]);
  const beginCursorDrag = useCallback((event: ReactPointerEvent<SVGRectElement>) => {
    if (!cursorTool?.activeCursor) return;
    event.preventDefault();
    event.stopPropagation();
    dragPointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    glideFromPointer(event);
  }, [cursorTool, glideFromPointer]);
  const endCursorDrag = useCallback((event: ReactPointerEvent<SVGRectElement>) => {
    event.stopPropagation();
    if (dragPointerRef.current === event.pointerId) dragPointerRef.current = null;
  }, []);
  // Hover readout: available in Pan mode, without arming a cursor first. Reads
  // whichever trace is closest to the pointer vertically so a multi-trace pane
  // answers "what is that line worth here?" for the line being pointed at.
  const [hover, setHover] = useState<{ x: number; y: number; dataX: number; value: number; trace: Trace } | null>(null);
  const hoverEnabled = Boolean(plot) && !cursorTool?.activeCursor && !isPanning && paneTraces.length > 0;
  useEffect(() => {
    if (!hoverEnabled) setHover(null);
  }, [hoverEnabled]);
  const trackHover = useCallback((event: ReactPointerEvent<SVGRectElement>) => {
    if (!hoverEnabled) return;
    const svg = event.currentTarget.ownerSVGElement ?? event.currentTarget.closest("svg");
    if (!svg) return;
    const bounds = svg.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const fraction = plotClientXToFraction(event.clientX, bounds, PLOT_WIDTH, PLOT_PAD, viewport, times);
    if (!Number.isFinite(fraction)) return;
    const x = fractionToX(times, fraction);
    const plotSpanY = plotHeight - 2 * PLOT_PAD;
    const toScreenY = (value: number, min: number, max: number) =>
      PLOT_PAD + ((max - value) / (max - min || 1)) * plotSpanY;
    const pointerSvgY = ((event.clientY - bounds.top) / bounds.height) * plotHeight;

    let best: { value: number; trace: Trace; screenY: number } | null = null;
    for (const trace of paneTraces) {
      const value = interpolateAt(times, trace.values, x);
      if (!Number.isFinite(value)) continue;
      const yr = yRangeForTrace(trace);
      const screenY = toScreenY(value, yr.min, yr.max);
      if (!best || Math.abs(screenY - pointerSvgY) < Math.abs(best.screenY - pointerSvgY)) {
        best = { value, trace, screenY };
      }
    }
    if (!best) {
      setHover(null);
      return;
    }
    const screenX = PLOT_PAD
      + ((x - viewport.xMin) / (viewport.xMax - viewport.xMin)) * (PLOT_WIDTH - 2 * PLOT_PAD);
    setHover({ x: screenX, y: best.screenY, dataX: x, value: best.value, trace: best.trace });
  }, [hoverEnabled, times, viewport, plotHeight, paneTraces, yRangeForTrace]);
  const hoverVisible = hover
    && hover.x >= PLOT_PAD && hover.x <= PLOT_WIDTH - PLOT_PAD
    && hover.y >= PLOT_PAD && hover.y <= plotHeight - PLOT_PAD;
  const nudgeCursor = useCallback((event: ReactKeyboardEvent<SVGRectElement>) => {
    if (!cursorTool?.activeCursor || !cursors || times.length < 2) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const value = cursorTool.activeCursor === "c1" ? cursors.x1 : cursors.x2;
    const span = times[times.length - 1] - times[0];
    if (!(span > 0)) return;
    const current = (value - times[0]) / span;
    const increment = event.shiftKey ? 0.01 : 0.001;
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    cursorTool.onCursorFractionChange(cursorTool.activeCursor, Math.max(0, Math.min(1, current + direction * increment)));
  }, [cursorTool, cursors, times]);

  return (
    <div className="scope-plot-wrap">
      <svg
        ref={setRefs}
        className={isPanning ? "scope-svg panning" : "scope-svg"}
        viewBox={`0 0 ${PLOT_WIDTH} ${plotHeight}`}
        style={{ aspectRatio: `${PLOT_WIDTH} / ${plotHeight}` }}
        role={selectedPaneTrace && cursorTool?.activeCursor ? "group" : "img"}
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
          yUnit={plot?.left.unit ?? "V"}
          xAxisTitle="Time"
          yAxisTitle={
            plot?.left.unit === "A" ? "Current" : plot?.left.unit === "W" ? "Power" : "Voltage"
          }
          targetXTicks={targetXTicks}
          targetYTicks={targetYTicks}
          showXTicks={showXAxis}
          y2Min={plot?.right?.min}
          y2Max={plot?.right?.max}
          y2Unit={plot?.right?.unit}
          y2AxisTitle={plot?.right ? "Current" : undefined}
        />
        {plot && (
          <>
            <ScopeClip id={clipId} width={PLOT_WIDTH} height={plotHeight} pad={PLOT_PAD}>
              {tracePaths.map(({ trace, path }) => (
                <path
                  key={trace.id}
                  className={trace.id.startsWith("ref:") ? "scope-trace ref" : "scope-trace"}
                  stroke={trace.color}
                  fill="none"
                  d={path}
                />
              ))}
            </ScopeClip>
            {showStatistics && paneTraces.length === 1 && (
              <ScopeStatisticsOverlay
                trace={paneTraces[0]}
                times={times}
                viewport={viewport}
                height={plotHeight}
              />
            )}
            {cursors && (
              <g className="transient-cursors" aria-hidden="true">
                {[
                  { label: "C1", value: cursors.x1, className: "cursor-1" },
                  { label: "C2", value: cursors.x2, className: "cursor-2" },
                ].map((cursor) => {
                  if (cursor.value < viewport.xMin || cursor.value > viewport.xMax) return null;
                  const x = PLOT_PAD + ((cursor.value - viewport.xMin) / (viewport.xMax - viewport.xMin)) * (PLOT_WIDTH - 2 * PLOT_PAD);
                  const selectedValue = selectedPaneTrace
                    ? interpolateAt(times, selectedPaneTrace.values, cursor.value)
                    : NaN;
                  const yr = selectedPaneTrace
                    ? yRangeForTrace(selectedPaneTrace)
                    : { min: viewport.yMin, max: viewport.yMax };
                  const pointVisible = Number.isFinite(selectedValue)
                    && selectedValue >= yr.min
                    && selectedValue <= yr.max;
                  const y = pointVisible
                    ? PLOT_PAD + ((yr.max - selectedValue) / (yr.max - yr.min || 1)) * (plotHeight - 2 * PLOT_PAD)
                    : NaN;
                  const labelWidth = 118;
                  const labelX = x > PLOT_WIDTH / 2 ? x - labelWidth - 4 : x + 4;
                  const labelY = pointVisible
                    ? Math.max(PLOT_PAD + 3, Math.min(y - 20, plotHeight - PLOT_PAD - 18))
                    : 0;
                  return (
                    <g key={cursor.label} className={`plot-cursor transient-cursor ${cursor.className}`}>
                      <line x1={x} y1={PLOT_PAD} x2={x} y2={plotHeight - PLOT_PAD} />
                      <text x={x + 4} y={PLOT_PAD + 11}>{cursor.label}</text>
                      {selectedPaneTrace && pointVisible && (
                        <g className={`cursor-trace-readout${cursorTool?.activeCursor === cursor.label.toLowerCase() ? " active" : ""}`}>
                          <circle
                            className="cursor-trace-point"
                            cx={x}
                            cy={y}
                            r={3.5}
                            fill={selectedPaneTrace.color}
                          />
                          <rect x={labelX} y={labelY} width={labelWidth} height={17} rx={3} />
                          <text x={labelX + 5} y={labelY + 11.5}>
                            {cursor.label} · {formatEngineering(selectedValue, selectedPaneTrace.unit, 3)} · {formatEngineering(cursor.value, "s", 3)}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </g>
            )}
            {hoverEnabled && (
              <rect
                className="scope-hover-surface"
                x={PLOT_PAD}
                y={PLOT_PAD}
                width={PLOT_WIDTH - 2 * PLOT_PAD}
                height={plotHeight - 2 * PLOT_PAD}
                fill="transparent"
                // Deliberately does not stop propagation: the svg's own drag
                // handlers must still receive the event so panning keeps working.
                onPointerMove={trackHover}
                onPointerLeave={() => setHover(null)}
                onPointerCancel={() => setHover(null)}
              />
            )}
            {hoverVisible && hover && (() => {
              // Single-trace panes already title the card; multi-trace panes
              // must name which line the nearest-vertical pick landed on.
              const named = paneTraces.length > 1;
              const readout = named
                ? `${hover.trace.label} · ${formatEngineering(hover.value, hover.trace.unit, 3)} · ${formatEngineering(hover.dataX, "s", 3)}`
                : `${formatEngineering(hover.value, hover.trace.unit, 3)} · ${formatEngineering(hover.dataX, "s", 3)}`;
              const chipWidth = Math.min(
                PLOT_WIDTH - 2 * PLOT_PAD - 8,
                Math.max(named ? 168 : 132, 10 + readout.length * 6.2),
              );
              const chipX = hover.x > PLOT_WIDTH / 2 ? hover.x - chipWidth - 4 : hover.x + 4;
              const chipY = Math.max(PLOT_PAD + 3, Math.min(hover.y - 20, plotHeight - PLOT_PAD - 18));
              return (
                <g className="scope-hover" aria-hidden="true">
                  <line x1={hover.x} y1={PLOT_PAD} x2={hover.x} y2={plotHeight - PLOT_PAD} />
                  <circle className="scope-hover-point" cx={hover.x} cy={hover.y} r={3} fill={hover.trace.color} />
                  <rect x={chipX} y={chipY} width={chipWidth} height={17} rx={3} />
                  <text x={chipX + 5} y={chipY + 11.5}>
                    {readout}
                  </text>
                </g>
              );
            })()}
            {selectedPaneTrace && cursorTool?.activeCursor && (
              <rect
                className="cursor-glide-surface"
                x={PLOT_PAD}
                y={PLOT_PAD}
                width={PLOT_WIDTH - 2 * PLOT_PAD}
                height={plotHeight - 2 * PLOT_PAD}
                fill="transparent"
                role="slider"
                tabIndex={0}
                aria-label={`Glide cursor ${cursorTool.activeCursor === "c1" ? "1" : "2"} over ${selectedPaneTrace.label}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round((((cursorTool.activeCursor === "c1" ? cursors?.x1 : cursors?.x2) ?? times[0]) - times[0]) / ((times[times.length - 1] ?? times[0]) - times[0] || 1) * 100)}
                onPointerDown={beginCursorDrag}
                onPointerMove={(event) => {
                  event.stopPropagation();
                  glideFromPointer(event);
                }}
                onPointerUp={endCursorDrag}
                onPointerCancel={endCursorDrag}
                onKeyDown={nudgeCursor}
              />
            )}
          </>
        )}
      </svg>
      {plot && (
        <ScopeZoomCluster
          onZoomIn={() => zoomBy(0.7)}
          onZoomOut={() => zoomBy(1 / 0.7)}
          onFit={fit}
          onAutoFrame={autoFrame}
          fitLabel="Show full run"
        />
      )}
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
 *  window (not always `[0,tMax]` - zoom/pan can move the visible window to
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
  const xSpan = xMax - xMin || 1;
  let path = "";
  let started = false;
  const innerWidth = PLOT_WIDTH - PLOT_PAD * 2;
  const traceWidth = Math.max(0, innerWidth - TRACE_EDGE_GUTTER * 2);
  for (const index of waveformEnvelopeIndices(times, trace.values, xMin, xMax, innerWidth)) {
    const value = trace.values[index];
    const time = times[index];
    if (!Number.isFinite(value) || !Number.isFinite(time)) continue;
    const x = PLOT_PAD + TRACE_EDGE_GUTTER + ((time - xMin) / xSpan) * traceWidth;
    const y = height - PLOT_PAD - ((value - min) / (max - min || 1)) * (height - PLOT_PAD * 2);
    path += `${started ? "L" : "M"} ${x.toFixed(2)} ${y.toFixed(2)} `;
    started = true;
  }
  return path;
}

function OpTable({ result }: { result: OperatingPointResult | null }) {
  if (!result) return null;
  if (!result.ok) return <div className="analysis-empty">{result.message}</div>;
  // Avoid Math.max(...spread) over a potentially large array - use reduce instead.
  const maxAbs = result.nets.reduce((acc, net) => Math.max(acc, Math.abs(net.voltage)), 0);
  return (
    <>
      <div className="meter-row analysis-meter">
        <Metric label="NODES" value={String(Math.max(0, result.nets.length - 1))} tone="green" />
        <Metric label="GROUND" value="OK" tone="green" />
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
      {result.branches && result.branches.length > 0 && (
        <div className="op-table">
          <div className="op-row op-head">
            <span>COMPONENT</span>
            <span>DC CURRENT</span>
          </div>
          {/* Keyed by id AND terminal: a multi-terminal part contributes one
              row per terminal under a single component id, so the id alone is
              not unique across the list. */}
          {result.branches.map((branch) => (
            <div className="op-row" key={`${branch.id}:${branch.terminal ?? ""}`}>
              <span>{branch.label}</span>
              <span>{formatEngineering(branch.current, "A", 3)}</span>
            </div>
          ))}
        </div>
      )}
      {result.devices && result.devices.length > 0 && (
        <div className="op-table" aria-label="Device operating points">
          <div className="op-row op-head">
            <span>DEVICE PARAMETER</span>
            <span>OPERATING POINT</span>
          </div>
          {result.devices.flatMap((device) => [
            ...(device.region ? [(
              <div className="op-row" key={`${device.id}:region`}>
                <span>{device.label} · REGION</span>
                <span>{device.region}</span>
              </div>
            )] : []),
            ...device.parameters.map((parameter) => (
              <div className="op-row" key={`${device.id}:${parameter.name}`}>
                <span>{device.label} · {parameter.name}</span>
                <span>{formatEngineering(parameter.value, parameter.unit, 4)}</span>
              </div>
            )),
          ])}
        </div>
      )}
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
 * log-log scale (frequency decades on X, V/√Hz decades on Y), with the
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
// Reference (.raw overlay) traces - drawn dashed (see `.scope-trace.ref`).
const REF_COLORS = ["var(--trace-amber)", "var(--trace-purple)", "var(--trace-cream)", "var(--trace-green)"];

/**
 * FFT of a transient signal - LTspice's "View → FFT". Resamples the chosen
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
    // Skip the DC bin (freq 0) - it has no place on a log axis.
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
  // the static full-spectrum domain - a cursor placed via the 0-100% slider
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
            <Button
              variant="outline"
              size="sm"
              disabled={!spectrum}
              aria-label="Export FFT spectrum CSV"
              onClick={() => {
                if (!spectrum) return;
                downloadCsv(spectrumToCsv(spectrum, chosen || "magnitude"), "fft");
              }}
            >
              Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!spectrum}
              aria-label="Export FFT spectrum PNG"
              onClick={async () => {
                const svg = measureRef.current;
                if (!svg || !spectrum) return;
                try {
                  const blob = await waveformSvgsToPng([svg]);
                  downloadWaveformPng(blob, "fft");
                } catch {
                  // Raster failures stay silent here — CSV remains available.
                }
              }}
            >
              Export PNG
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
                        xMin: viewport.xMin,
                        xMax: viewport.xMax,
                        xScale: "log",
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
                  insights.fundamental && { ...insights.fundamental, label: "PEAK" },
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
    ? "-"
    : `${value.toFixed(3)}%`;
  const db = (value: number | null | undefined) => value === null || value === undefined
    ? "-"
    : `${value.toFixed(1)} dB`;
  const hasSignal = Boolean(insights.fundamental && insights.fundamental.amplitude > 0);
  return (
    <section className="fft-insights" aria-label="FFT measurements">
      <div className="fft-insight-grid">
        <SpectrumMetric
          label="Dominant tone"
          value={hasSignal && insights.fundamental ? formatEngineering(insights.fundamental.frequencyHz, "Hz", 3) : "No tone"}
          detail={hasSignal && insights.fundamental ? `${insights.fundamental.amplitudeDb.toFixed(1)} dB · ${formatEngineering(insights.fundamental.amplitude, unit, 3)} · auto-picked` : "No spectral energy above the FFT floor"}
        />
        <SpectrumMetric label="THD" value={percent(insights.thd?.percent)} detail={db(insights.thd?.db)} />
        <SpectrumMetric label="THD + noise" value={percent(insights.thdPlusNoise?.percent)} detail={db(insights.thdPlusNoise?.db)} />
        <SpectrumMetric label="SFDR" value={db(insights.sfdrDb)} detail="Fundamental to largest spur" />
        <SpectrumMetric label="Noise floor" value={db(insights.noiseFloorDb)} detail="Median per FFT bin" />
        <SpectrumMetric
          label="Resolution"
          value={insights.frequencyResolutionHz ? formatEngineering(insights.frequencyResolutionHz, "Hz", 3) : "-"}
          detail="FFT bin width"
        />
        <SpectrumMetric
          label="DC"
          value={insights.dc ? formatEngineering(insights.dc.amplitude, unit, 3) : "-"}
          detail={insights.dc ? `${insights.dc.amplitudeDb.toFixed(1)} dB` : undefined}
        />
      </div>
      {insights.harmonics.length > 0 && (
        <div className="fft-harmonics-wrap">
          <table className="fft-harmonics">
            <caption>Harmonics relative to dominant tone</caption>
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
 * Measurement cursors - two positions along the time axis with a per-trace
 * value + delta readout (LTspice's "1 & 2" cursors). Sliders provide quick
 * placement, exact engineering-notation time fields provide precision, and
 * the controlled positions are also drawn through every waveform pane.
 */
function CursorView({
  result,
  extraTraces,
  open,
  onOpenChange,
  f1,
  f2,
  onF1Change,
  onF2Change,
}: {
  result: AnalysisResult | null;
  extraTraces: Trace[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  f1: number;
  f2: number;
  onF1Change: (fraction: number) => void;
  onF2Change: (fraction: number) => void;
}) {
  const success = result?.ok ? result : null;
  const signals = useMemo<CursorTraceInput[]>(() => {
    if (!success) return [];
    return [
      ...success.traces.map((t) => ({ label: t.label, unit: t.unit, values: t.values })),
      ...success.currents.map((c) => ({ label: c.label, unit: "A", values: c.values })),
      ...extraTraces.map((t) => ({ label: t.label, unit: t.unit, values: t.values })),
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
  const setExactTime = (value: string, setFraction: (fraction: number) => void) => {
    if (!success || success.times.length === 0) return;
    try {
      const seconds = parseQuantity(value, "s");
      const first = success.times[0];
      const last = success.times[success.times.length - 1];
      const span = last - first;
      if (!Number.isFinite(seconds) || span <= 0) return;
      setFraction(Math.max(0, Math.min(1, (seconds - first) / span)));
    } catch {
      // The shared engineering input keeps partial exponent drafts locally.
    }
  };

  if (!success) return null;

  return (
    <div className="fft-view">
      <button
        className="disclosure-header"
        onClick={() => onOpenChange(!open)}
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
                onChange={(e) => onF1Change(Number(e.currentTarget.value) / 1000)}
              />
            </label>
            <label>
              C2
              <input
                type="range" min={0} max={1000} value={Math.round(f2 * 1000)}
                aria-label="Cursor 2 position"
                onChange={(e) => onF2Change(Number(e.currentTarget.value) / 1000)}
              />
            </label>
          </div>
          {readout && (
            <>
              <p className="cursor-help">Drag for coarse placement or enter exact endpoints for a time interval.</p>
              <div className="cursor-time-fields">
                <label>
                  <span>C1 time</span>
                  <EngineeringInput
                    label="Cursor 1 time"
                    value={engineeringInputDisplay(readout.x1, "s")}
                    unit="s"
                    onValueChange={(value) => setExactTime(value, onF1Change)}
                  />
                </label>
                <label>
                  <span>C2 time</span>
                  <EngineeringInput
                    label="Cursor 2 time"
                    value={engineeringInputDisplay(readout.x2, "s")}
                    unit="s"
                    onValueChange={(value) => setExactTime(value, onF2Change)}
                  />
                </label>
              </div>
            </>
          )}
          {readout && (
            <>
              <div className="meter-row analysis-meter">
                <Metric label="t1" value={formatEngineering(readout.x1, "s", 3)} tone="cyan" />
                <Metric label="t2" value={formatEngineering(readout.x2, "s", 3)} tone="cyan" />
                <Metric label="Δt" value={formatEngineering(readout.dx, "s", 3)} tone="green" />
                <Metric
                  label="1/Δt"
                  value={Number.isFinite(readout.inverseDx) ? formatEngineering(readout.inverseDx, "Hz", 3) : "--"}
                  tone="cream"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadCsv(cursorReadoutToCsv(readout), "cursors")}
                >
                  Export CSV
                </Button>
              </div>
            </>
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
                    <td>{formatEngineering(t.y1, t.unit ?? "", 3)}</td>
                    <td>{formatEngineering(t.y2, t.unit ?? "", 3)}</td>
                    <td>{formatEngineering(t.dy, t.unit ?? "", 3)}</td>
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
  // Bode X defaults to log decades (LTspice); Lin X is an explicit toggle.
  // Magnitude Y defaults to Lin dB; Log Y plots |V|/|Vref| on decades.
  // Lower pane defaults to phase (°); Group delay swaps in τ = −dφ/dω (s).
  const [freqScale, setFreqScale] = useState<AxisScale>("log");
  const [magYScale, setMagYScale] = useState<AxisScale>("linear");
  const [lowerMode, setLowerMode] = useState<"phase" | "groupDelay">("phase");
  const [cursorsOn, setCursorsOn] = useState(false);
  const [cf1, setCf1] = useState(0.25);
  const [cf2, setCf2] = useState(0.75);
  const magTicks = tickCountsFromSize(magSize);
  const phaseTicks = tickCountsFromSize(phaseSize);
  const traces = success ? success.traces.slice(0, 4) : [];
  // Expression overlays share the magnitude axis (their value rides `magDb`).
  const magTraces = success ? [...traces, ...overlays] : [];
  const plot = useMemo(() => {
    if (!success || magTraces.length === 0) return null;
    const magY = bodeMagYDomain(magTraces.map((t) => t.magDb), magYScale);
    if (!magY) return null;
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
    const tauSeries = traces.map((t) => groupDelay(success.freqs, t.phaseDeg));
    const tauY = groupDelayYDomain(tauSeries) ?? { yMin: 0, yMax: 1e-6 };
    return {
      yMin: magY.yMin,
      yMax: magY.yMax,
      yUnit: magY.unit,
      f0,
      f1,
      minPh,
      maxPh,
      tauSeries,
      tauYMin: tauY.yMin,
      tauYMax: tauY.yMax,
    };
  }, [success, traces, overlays, magTraces, magYScale]);

  // Independent zoom per pane - magnitude and phase don't share an x-viewport
  // in this pass (a documented scoping decision, see PROGRESS.md): they're
  // visually stacked halves of one Bode plot but each is its own `<svg>` with
  // its own `usePlotViewport`, so zooming one doesn't move the other.
  const magDomain = useMemo<Viewport>(
    () => ({
      xMin: plot ? 10 ** plot.f0 : 1,
      xMax: plot ? 10 ** plot.f1 : 10,
      yMin: plot ? plot.yMin : -60,
      yMax: plot ? plot.yMax : 0,
    }),
    [plot],
  );
  const phaseDomain = useMemo<Viewport>(
    () => ({
      xMin: plot ? 10 ** plot.f0 : 1,
      xMax: plot ? 10 ** plot.f1 : 10,
      yMin: plot ? (lowerMode === "groupDelay" ? plot.tauYMin : plot.minPh) : -180,
      yMax: plot ? (lowerMode === "groupDelay" ? plot.tauYMax : plot.maxPh) : 180,
    }),
    [plot, lowerMode],
  );
  const magVp = usePlotViewport({
    domain: magDomain,
    xScale: freqScale,
    yScale: magYScale,
    resetKey: plot && success
      ? `${freqScale}:${magYScale}:${success.freqs[0]}:${success.freqs[success.freqs.length - 1]}`
      : null,
    width: PLOT_WIDTH,
    height: PLOT_HEIGHT,
    pad: PLOT_PAD,
  });
  const phaseVp = usePlotViewport({
    domain: phaseDomain,
    xScale: freqScale,
    resetKey: plot && success
      ? `${freqScale}:${lowerMode}:${success.freqs[0]}:${success.freqs[success.freqs.length - 1]}`
      : null,
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

  // Two log-fraction cursors on the Bode magnitude pane (FFT-style): dB at each,
  // ΔdB, and dB/decade slope of the primary (and sibling) mag traces.
  const bodeCursors = useMemo(() => {
    if (!cursorsOn || !success || traces.length === 0) return null;
    const x1 = logFractionToX(success.freqs, cf1);
    const x2 = logFractionToX(success.freqs, cf2);
    if (!Number.isFinite(x1) || !Number.isFinite(x2)) return null;
    try {
      return cursorReadout(
        success.freqs,
        traces.map((t) => ({ label: t.label, values: t.magDb, unit: "dB" })),
        x1,
        x2,
      );
    } catch {
      return null;
    }
  }, [cursorsOn, success, traces, cf1, cf2]);

  const bodeCursorPixelX = (f: number): number | null => {
    const frac = freqToFraction(f, magVp.viewport.xMin, magVp.viewport.xMax, freqScale);
    if (frac === null || frac < 0 || frac > 1) return null;
    return PLOT_PAD + frac * (PLOT_WIDTH - PLOT_PAD * 2);
  };

  if (!result) return null;
  if (!result.ok) return <div className="analysis-empty">{result.message}</div>;
  let peak = -Infinity;
  for (const trace of traces) {
    for (const db of trace.magDb) {
      if (Number.isFinite(db)) peak = Math.max(peak, db);
    }
  }
  // Peak group delay τ = -dφ/dω of the primary (first) output trace - the
  // network's worst-case envelope delay in the swept band (LTspice ).
  let peakGroupDelay = 0;
  if (traces.length > 0) {
    for (const tau of groupDelay(result.freqs, traces[0].phaseDeg)) {
      if (Number.isFinite(tau) && Math.abs(tau) > Math.abs(peakGroupDelay)) peakGroupDelay = tau;
    }
  }
  // Loop-stability margins of the primary trace (treated as the open-loop
  // response): phase margin at the 0 dB crossover, gain margin at −180°.
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
              xScale={freqScale}
              yScale={magYScale}
              xUnit="Hz"
              yUnit={plot?.yUnit ?? "dB"}
              targetXTicks={magTicks.targetXTicks}
              targetYTicks={magTicks.targetYTicks}
              showXTicks={false}
            />
            {plot && (
              <ScopeClip id={magClipId} width={PLOT_WIDTH} height={PLOT_HEIGHT} pad={PLOT_PAD}>
                {(() => {
                  const magPlot = {
                    minDb: magVp.viewport.yMin,
                    maxDb: magVp.viewport.yMax,
                    xMin: magVp.viewport.xMin,
                    xMax: magVp.viewport.xMax,
                    xScale: freqScale,
                  };
                  const seriesValues = (magDb: number[]) =>
                    magYScale === "log" ? magDb.map(dbToLinearMag) : magDb;
                  return (
                    <>
                      {traces.map((t, i) => (
                        <path key={t.id} className="scope-trace" stroke={AC_COLORS[i % AC_COLORS.length]} d={bodePath(seriesValues(t.magDb), success!.freqs, magPlot)} />
                      ))}
                      {overlays.map((t, i) => (
                        <path key={t.id} className="scope-trace" stroke={EXPR_COLORS[i % EXPR_COLORS.length]} d={bodePath(seriesValues(t.magDb), success!.freqs, magPlot)} />
                      ))}
                    </>
                  );
                })()}
              </ScopeClip>
            )}
            {bodeCursors &&
              [bodeCursors.x1, bodeCursors.x2].map((f, i) => {
                const x = bodeCursorPixelX(f);
                if (x === null) return null;
                return (
                  <g key={`bc${i}`} className="plot-cursor">
                    <line x1={x} y1={PLOT_PAD} x2={x} y2={PLOT_HEIGHT - PLOT_PAD} />
                    <text x={x + 3} y={PLOT_PAD + 10}>{i + 1}</text>
                  </g>
                );
              })}
          </svg>
          {plot && <ScopeZoomCluster onZoomIn={() => magVp.zoomBy(0.7)} onZoomOut={() => magVp.zoomBy(1 / 0.7)} onFit={magVp.fit} />}
        </div>
        <div className="scope-plot-wrap">
          <svg
            ref={setPhaseRefs}
            className={phaseVp.isPanning ? "scope-svg panning" : "scope-svg"}
            viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
            role="img"
            aria-label={lowerMode === "groupDelay" ? "Bode group delay" : "Bode phase"}
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
              xScale={freqScale}
              xUnit="Hz"
              yUnit={lowerMode === "groupDelay" ? "s" : "°"}
              targetXTicks={phaseTicks.targetXTicks}
              targetYTicks={phaseTicks.targetYTicks}
            />
            {plot && (
              <ScopeClip id={phaseClipId} width={PLOT_WIDTH} height={PLOT_HEIGHT} pad={PLOT_PAD}>
                {lowerMode === "groupDelay"
                  ? plot.tauSeries.map((tau, i) => (
                      <path
                        key={traces[i]?.id ?? `tau-${i}`}
                        className="scope-trace ref"
                        stroke={AC_COLORS[i % AC_COLORS.length]}
                        d={bodeValuePath(tau, success!.freqs, {
                          min: phaseVp.viewport.yMin,
                          max: phaseVp.viewport.yMax,
                          xMin: phaseVp.viewport.xMin,
                          xMax: phaseVp.viewport.xMax,
                          xScale: freqScale,
                        })}
                      />
                    ))
                  : traces.map((t, i) => (
                      <path
                        key={t.id}
                        className="scope-trace ref"
                        stroke={AC_COLORS[i % AC_COLORS.length]}
                        d={bodeValuePath(t.phaseDeg, success!.freqs, {
                          min: phaseVp.viewport.yMin,
                          max: phaseVp.viewport.yMax,
                          xMin: phaseVp.viewport.xMin,
                          xMax: phaseVp.viewport.xMax,
                          xScale: freqScale,
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
        <div className="bode-x-scale" role="group" aria-label="Bode axis scales">
          <Button
            size="sm"
            variant={freqScale === "log" ? "default" : "outline"}
            aria-pressed={freqScale === "log"}
            onClick={() => setFreqScale("log")}
          >
            Log X
          </Button>
          <Button
            size="sm"
            variant={freqScale === "linear" ? "default" : "outline"}
            aria-pressed={freqScale === "linear"}
            onClick={() => setFreqScale("linear")}
          >
            Lin X
          </Button>
          <Button
            size="sm"
            variant={magYScale === "log" ? "default" : "outline"}
            aria-pressed={magYScale === "log"}
            onClick={() => setMagYScale("log")}
          >
            Log Y
          </Button>
          <Button
            size="sm"
            variant={magYScale === "linear" ? "default" : "outline"}
            aria-pressed={magYScale === "linear"}
            onClick={() => setMagYScale("linear")}
          >
            Lin Y
          </Button>
          <Button
            size="sm"
            variant={lowerMode === "phase" ? "default" : "outline"}
            aria-pressed={lowerMode === "phase"}
            onClick={() => setLowerMode("phase")}
          >
            Phase
          </Button>
          <Button
            size="sm"
            variant={lowerMode === "groupDelay" ? "default" : "outline"}
            aria-pressed={lowerMode === "groupDelay"}
            onClick={() => setLowerMode("groupDelay")}
          >
            Group delay
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!plot}
            aria-label="Export phase PNG"
            onClick={async () => {
              const svg = phaseMeasureRef.current;
              if (!svg) return;
              try {
                const blob = await waveformSvgsToPng([svg]);
                downloadWaveformPng(blob, "ac-phase");
              } catch {
                // Raster failures stay silent — Advanced Bode PNG remains available.
              }
            }}
          >
            Export PNG
          </Button>
          <Button
            size="sm"
            variant={cursorsOn ? "default" : "outline"}
            aria-pressed={cursorsOn}
            aria-label="Toggle Bode cursors"
            onClick={() => setCursorsOn((c) => !c)}
          >
            Cursors
          </Button>
        </div>
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
      {cursorsOn && (
        <div className="cursor-sliders">
          <label>
            C1
            <input
              type="range"
              min={0}
              max={1000}
              value={Math.round(cf1 * 1000)}
              aria-label="Bode cursor 1 position"
              onChange={(e) => setCf1(Number(e.currentTarget.value) / 1000)}
            />
          </label>
          <label>
            C2
            <input
              type="range"
              min={0}
              max={1000}
              value={Math.round(cf2 * 1000)}
              aria-label="Bode cursor 2 position"
              onChange={(e) => setCf2(Number(e.currentTarget.value) / 1000)}
            />
          </label>
        </div>
      )}
      {bodeCursors && (
        <div className="meter-row analysis-meter" aria-label="Bode cursor readout">
          <Metric label="f1" value={formatEngineering(bodeCursors.x1, "Hz", 3)} tone="cyan" />
          <Metric label="f2" value={formatEngineering(bodeCursors.x2, "Hz", 3)} tone="cyan" />
          <Metric label="@C1" value={`${bodeCursors.traces[0]!.y1.toFixed(1)} dB`} tone="green" />
          <Metric label="@C2" value={`${bodeCursors.traces[0]!.y2.toFixed(1)} dB`} tone="green" />
          <Metric label="Δ" value={`${bodeCursors.traces[0]!.dy.toFixed(1)} dB`} tone="cream" />
          <Metric
            label="SLOPE"
            value={
              Number.isFinite(dbPerDecade(bodeCursors, bodeCursors.traces[0]!))
                ? `${dbPerDecade(bodeCursors, bodeCursors.traces[0]!).toFixed(1)} dB/dec`
                : "--"
            }
            tone="cream"
          />
        </div>
      )}
    </>
  );
}

function bodePath(
  magDb: number[],
  freqs: number[],
  plot: { minDb: number; maxDb: number; xMin: number; xMax: number; xScale?: AxisScale },
): string {
  return bodeValuePath(magDb, freqs, {
    min: plot.minDb,
    max: plot.maxDb,
    xMin: plot.xMin,
    xMax: plot.xMax,
    xScale: plot.xScale,
  });
}

// Generic "value vs. frequency" trace path shared by Bode magnitude (dB) and
// phase (degrees). X follows `xScale` via {@link freqToFraction}; Y maps
// [min,max] onto the plot box (clamped so out-of-range samples ride the frame).
function bodeValuePath(
  values: number[],
  freqs: number[],
  plot: { min: number; max: number; xMin: number; xMax: number; xScale?: AxisScale },
): string {
  const span = plot.max - plot.min || 1;
  const xScale = plot.xScale ?? "log";
  const count = Math.min(values.length, freqs.length);
  let path = "";
  let started = false;
  for (const index of displaySampleIndices(count)) {
    const v = values[index];
    const frequency = freqs[index];
    if (!Number.isFinite(v) || !Number.isFinite(frequency) || frequency <= 0) continue;
    const lx = freqToFraction(frequency, plot.xMin, plot.xMax, xScale);
    if (lx === null) continue;
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
 * frequency mapping. The ground net (label "GND") is dropped - it is always 0 V.
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

// All entries are App.css trace variables (no hardcoding); colors repeat for
// large families while the legend and measurement table retain exact labels.
const STEP_COLORS = [
  "var(--trace-green)",
  "var(--trace-red)",
  "var(--trace-cyan)",
  "var(--trace-cream)",
  "var(--trace-purple)",
  "var(--trace-amber)",
];

/**
 * Overlay a `.step` family: re-run a transient once per swept value and draw the
 * same signal across the family, one colored curve per step (LTspice parity). The plotted signal follows the probe (first probed net),
 * falling back to the first trace, matching the transient scope.
 */
export function StepPlot({ result, probes, wires }: { result: StepFamilyResult | null; probes: Probe[]; wires: SchematicWire[] }) {
  const [svgRef, size] = useMeasuredSize<SVGSVGElement>();
  const { targetXTicks, targetYTicks } = tickCountsFromSize(size);
  const [exprInput, setExprInput] = useState("");
  const [exprList, setExprList] = useState<string[]>([]);
  const [activeExpr, setActiveExpr] = useState<string | null>(null);
  const [exprError, setExprError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const exprFamily = useMemo(() => {
    if (!activeExpr) return null;
    const evaluated = evaluateStepPlotExpression(activeExpr, result);
    if (!evaluated.ok) return evaluated;
    const { min, max } = waveformBounds(evaluated.series.map((s) => s.trace));
    const tMax = evaluated.series.reduce((acc, s) => Math.max(acc, s.times[s.times.length - 1] || 0), 0) || 1;
    return {
      ok: true as const,
      series: evaluated.series,
      min,
      max,
      tMax,
      signal: evaluated.expression,
      unit: evaluated.unit,
    };
  }, [activeExpr, result]);

  // Members whose run succeeded, paired with the chosen probe trace for each.
  const probeFamily = useMemo(() => {
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
    const unit = first.traces.find((t) => t.id === traceId)?.unit ?? "V";
    return { series, min, max, tMax, signal, unit };
  }, [result, probes, wires]);

  const family =
    activeExpr && exprFamily && exprFamily.ok
      ? exprFamily
      : !activeExpr
        ? probeFamily
        : null;

  const addExpression = () => {
    const expr = exprInput.trim();
    if (!expr) return;
    const probe = evaluateStepPlotExpression(expr, result);
    if (!probe.ok) {
      setExprError(probe.error);
      return;
    }
    setExprList((prev) => (prev.includes(expr) ? prev : [...prev, expr]));
    setActiveExpr(expr);
    setExprInput("");
    setExprError(null);
  };

  const exportStepCsv = () => {
    if (!family) return;
    downloadCsv(
      stepFamilyToCsv(
        family.signal,
        family.series.map((s) => ({
          label: s.label,
          times: s.times,
          values: s.trace.values,
        })),
      ),
      "step",
    );
  };

  const exportStepPng = async () => {
    const svg = svgRef.current;
    if (!svg) return;
    try {
      const blob = await waveformSvgsToPng([svg]);
      downloadWaveformPng(blob, "step");
      setExportError(null);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Could not export the step PNG.");
    }
  };

  if (!result) return null;
  if (!result.ok) return <div className="analysis-empty">{result.message ?? "No step sweep to show."}</div>;
  if (activeExpr && exprFamily && !exprFamily.ok) {
    return (
      <div className="analysis-empty" role="alert">
        {exprFamily.error}
      </div>
    );
  }
  if (!family) {
    return (
      <div className="analysis-empty">
        Step ran, but the selected signal has no data. Probe a node, check the sweep, or add a plot expression.
      </div>
    );
  }

  return (
    <>
      <div className="expr-bar" style={{ marginBottom: 8 }}>
        <Input
          variant="mono"
          size="sm"
          className="flex-1 min-w-40"
          type="text"
          value={exprInput}
          placeholder="Plot an expression across steps, e.g. V(out)-V(in)"
          aria-label="Step plot expression"
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
        {activeExpr && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setActiveExpr(null);
              setExprError(null);
            }}
          >
            Use probe
          </Button>
        )}
      </div>
      {exprError && <div className="expr-error" role="alert">{exprError}</div>}
      {exprList.length > 0 && (
        <div className="expr-list" style={{ marginBottom: 8 }}>
          {exprList.map((expr) => (
            <span
              key={expr}
              className="expr-chip"
              style={{
                borderColor: activeExpr === expr ? "var(--trace-cyan)" : undefined,
                cursor: "pointer",
              }}
            >
              <button
                type="button"
                className="expr-chip-select"
                aria-pressed={activeExpr === expr}
                aria-label={`Plot ${expr} across steps`}
                onClick={() => {
                  setActiveExpr(expr);
                  setExprError(null);
                }}
                style={{ background: "transparent", border: 0, color: "inherit", cursor: "pointer", padding: 0 }}
              >
                {expr}
              </button>
              <button
                type="button"
                aria-label={`Remove ${expr}`}
                onClick={() => {
                  setExprList((prev) => prev.filter((e) => e !== expr));
                  setActiveExpr((cur) => (cur === expr ? null : cur));
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
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
            yUnit={family.unit || "V"}
            yAxisTitle={family.unit === "A" ? "Current" : family.unit === "W" ? "Power" : "Voltage"}
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
        <Button variant="outline" size="sm" onClick={exportStepCsv}>
          Export CSV
        </Button>
        <Button variant="outline" size="sm" onClick={() => void exportStepPng()}>
          Export PNG
        </Button>
      </div>
      {exportError && <div className="expr-error" role="alert">{exportError}</div>}
      <StepMeasTable members={result.members} />
      {result.warnings.length > 0 && (
        <div className="analysis-empty warn" role="status">{result.warnings.join(" ")}</div>
      )}
    </>
  );
}

/** `.meas` values evaluated independently for every transient step member. */
function StepMeasTable({ members }: { members: StepFamilyResult["members"] }) {
  const rows = members.flatMap((member) =>
    (member.measurements ?? []).map((measurement) => ({ step: member.label, measurement })),
  );
  if (rows.length === 0) return null;
  return (
    <div className="meas-table step-meas-table" role="table" aria-label="Step measurements">
      <div className="meas-table-head step-meas-row" role="row">
        <span role="columnheader">STEP</span>
        <span role="columnheader">MEASURE</span>
        <span role="columnheader">VALUE</span>
      </div>
      {rows.map(({ step, measurement }) => (
        <div className="meas-row step-meas-row" role="row" key={`${step}:${measurement.name}`}>
          <span className="meas-name" role="cell" title={step}>{step}</span>
          <span className="meas-name" role="cell">{measurement.name}</span>
          <span
            className={`meas-value${measurement.value === null ? " meas-fail" : ""}`}
            role="cell"
            title={measurement.error}
          >
            {measurement.value === null
              ? (measurement.error ?? "-")
              : formatEngineering(measurement.value, "", 4)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Pick the trace to plot across a step family: the first probed net's trace,
 *  else the first trace - mirroring the transient scope's selection. */
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
  const [exportError, setExportError] = useState<string | null>(null);
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
    const xMax = fHi > fLo ? fHi : fLo * 10;
    return { min, max, xMin: fLo, xMax, xScale: "log" as const };
  }, [overlay]);

  if (!family) return null;
  if (!family.ok) {
    // When every member failed, surface the first member's own error (e.g. a
    // singular matrix) instead of a generic banner.
    const memberError = family.members.map((m) => (m.result.ok ? null : m.result.message)).find((m) => m);
    return <div className="analysis-empty">{family.message ?? memberError ?? "The .step sweep could not run."}</div>;
  }
  if (!overlay || !plot) return null;

  const exportAcStepPng = async () => {
    const svg = svgRef.current;
    if (!svg) return;
    try {
      const blob = await waveformSvgsToPng([svg]);
      downloadWaveformPng(blob, "ac-step");
      setExportError(null);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Could not export the AC step PNG.");
    }
  };

  return (
    <>
      <div className="scope-shell">
        <svg ref={svgRef} className="scope-svg" viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`} role="img" aria-label="AC step family plot">
          <PlotAxes
            width={PLOT_WIDTH}
            height={PLOT_HEIGHT}
            pad={PLOT_PAD}
            xMin={plot.xMin}
            xMax={plot.xMax}
            yMin={plot.min}
            yMax={plot.max}
            xScale={plot.xScale}
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
        <Button variant="outline" size="sm" onClick={() => void exportAcStepPng()}>
          Export PNG
        </Button>
      </div>
      {exportError && <div className="expr-error" role="alert">{exportError}</div>}
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
  const [exportError, setExportError] = useState<string | null>(null);
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

  const exportDcStepPng = async () => {
    const svg = svgRef.current;
    if (!svg) return;
    try {
      const blob = await waveformSvgsToPng([svg]);
      downloadWaveformPng(blob, "dc-step");
      setExportError(null);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Could not export the DC step PNG.");
    }
  };

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
        <Button variant="outline" size="sm" onClick={() => void exportDcStepPng()}>
          Export PNG
        </Button>
      </div>
      {exportError && <div className="expr-error" role="alert">{exportError}</div>}
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
            {m.value === null ? (m.error ?? "-") : formatEngineering(m.value, "", 4)}
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

const DURATION_UNITS = [
  { value: "ns", label: "ns", seconds: 1e-9 },
  { value: "us", label: "µs", seconds: 1e-6 },
  { value: "ms", label: "ms", seconds: 1e-3 },
  { value: "s", label: "s", seconds: 1 },
  { value: "min", label: "min", seconds: 60 },
] as const;
type DurationUnit = typeof DURATION_UNITS[number]["value"];

const durationFactor = (unit: DurationUnit) => DURATION_UNITS.find((candidate) => candidate.value === unit)?.seconds ?? 1;
const initialDurationUnit = (seconds: number): DurationUnit =>
  seconds >= 60 ? "min" : seconds >= 1 ? "s" : seconds >= 1e-3 ? "ms" : seconds >= 1e-6 ? "us" : "ns";
const durationDraft = (seconds: number, unit: DurationUnit) => Number((seconds / durationFactor(unit)).toPrecision(8)).toString();

function CircuitDurationControl({ seconds, onChange }: { seconds: number; onChange: (seconds: number) => void }) {
  const [unit, setUnit] = useState<DurationUnit>(() => initialDurationUnit(seconds));
  const [draft, setDraft] = useState(() => durationDraft(seconds, unit));
  const focused = useRef(false);
  const valid = Number.isFinite(Number(draft)) && Number(draft) > 0;
  useEffect(() => {
    if (!focused.current) setDraft(durationDraft(seconds, unit));
  }, [seconds, unit]);

  return (
    <div className="circuit-duration-control">
      <div className="circuit-duration-control__head">
        <span>Circuit duration</span>
        <strong>{formatEngineering(seconds, "s", 3)}</strong>
      </div>
      <div className="circuit-duration-control__editor">
        <Input
          type="text"
          variant="mono"
          inputMode="decimal"
          aria-label="Circuit duration value"
          aria-invalid={!valid}
          value={draft}
          onFocus={() => { focused.current = true; }}
          onBlur={() => {
            focused.current = false;
            if (!valid) setDraft(durationDraft(seconds, unit));
          }}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setDraft(next);
            const amount = Number(next);
            if (Number.isFinite(amount) && amount > 0) onChange(amount * durationFactor(unit));
          }}
        />
        <select
          aria-label="Circuit duration unit"
          value={unit}
          onChange={(event) => {
            const next = event.currentTarget.value as DurationUnit;
            setUnit(next);
            setDraft(durationDraft(seconds, next));
          }}
        >
          {DURATION_UNITS.map((candidate) => (
            <option key={candidate.value} value={candidate.value}>{candidate.label}</option>
          ))}
        </select>
      </div>
      <small>This is simulated circuit time. A 3 min run models 180 s of circuit behavior; it does not promise three minutes of solver time.</small>
    </div>
  );
}

function ResolutionControl({
  resolution,
  maxSteps,
}: {
  resolution: ReturnType<typeof inspectTransientResolution> | null;
  maxSteps: number;
}) {
  if (!resolution || resolution.maxFrequencyHz <= 0) {
    return (
      <div className="resolution-control neutral">
        <span>RESOLUTION</span>
        <strong className="mono-num">DC / static</strong>
        <small>No periodic source found; output spacing also accounts for reactive time constants.</small>
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
          Fastest source: {formatEngineering(resolution.maxFrequencyHz, "Hz", 3)} · need ≥{MIN_SAMPLES_PER_CYCLE} samples/cycle.
        </small>
      </div>
      {canResolve ? <strong className="resolution-state">{ready ? "Ready" : "Increase detail"}</strong> : (
        <small className="resolution-limit">Shorten STOP or use AC analysis. Output limit: {formatCount(maxSteps)} steps.</small>
      )}
    </div>
  );
}

const formatCount = (value: number) => value.toLocaleString("en-US");
const formatSamples = (value: number) => Number(value.toPrecision(3)).toString();
const detailLabel = (detail: TransientDetailLevel) => detail === "quick" ? "Coarse" : detail === "balanced" ? "Default" : "Fine";
const detailDescription = (detail: TransientDetailLevel) =>
  detail === "quick" ? "Fewer samples" : detail === "balanced" ? "Usual sampling" : "More samples";
const formatElapsed = (milliseconds: number) => milliseconds < 1_000
  ? `${Math.max(1, Math.round(milliseconds))} ms`
  : `${Number((milliseconds / 1_000).toPrecision(3))} s`;
const engineeringInputDisplay = (value: number, unit: string) =>
  formatEngineering(value, unit, 8).replace(/\s+/g, "");

/**
 * Type a coordinate to move the active cursor there. Time is the direct case.
 * A value is the inverse question - "when is this signal 3.3 V?" - which has
 * zero, one, or many answers, so it resolves to the crossing nearest the cursor
 * and says plainly when the trace never reaches the value.
 */
function TraceSeekFields({
  trace,
  label,
  times,
  cursorX,
  activeCursor,
  onSeek,
}: {
  trace: Trace;
  label: string;
  times: readonly number[];
  /** Current position of the cursor being driven, for nearest-crossing choice. */
  cursorX: number | null;
  activeCursor: TransientCursorId | null;
  onSeek: (fraction: number) => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  // A stale "never reaches" note would be misleading against a new run or a
  // different trace.
  useEffect(() => setNote(null), [trace.id, times]);

  const cursorLabel = (activeCursor ?? "c1").toUpperCase();
  const valueUnit = trace.unit || "V";

  const seekTime = (raw: string) => {
    try {
      const seconds = parseQuantity(raw, "s");
      if (!Number.isFinite(seconds)) return;
      setNote(null);
      onSeek(xToFraction(times, seconds));
    } catch {
      // The engineering input keeps partial drafts (e.g. a bare "1e") local.
    }
  };

  const seekValue = (raw: string) => {
    let target: number;
    try {
      target = parseQuantity(raw, valueUnit);
    } catch {
      return;
    }
    if (!Number.isFinite(target)) return;
    const crossings = findTraceCrossings(times, trace.values, target);
    if (crossings.length === 0) {
      setNote(`${label} never reaches ${formatEngineering(target, valueUnit, 3)}.`);
      return;
    }
    const reference = cursorX ?? times[0];
    const hit = nearestCrossing(crossings, reference) ?? crossings[0];
    setNote(crossings.length > 1
      ? `${crossings.length} crossings · moved ${cursorLabel} to the nearest at ${formatEngineering(hit.x, "s", 3)}`
      : `${cursorLabel} → ${formatEngineering(hit.x, "s", 3)}`);
    onSeek(xToFraction(times, hit.x));
  };

  return (
    <div className="trace-seek">
      <label className="trace-seek__field">
        <span>At time</span>
        <EngineeringInput
          label={`Move cursor ${cursorLabel} on ${label} to a time`}
          value={cursorX != null ? engineeringInputDisplay(cursorX, "s") : ""}
          unit="s"
          allowEmpty
          onValueChange={seekTime}
        />
      </label>
      <label className="trace-seek__field">
        <span>At value</span>
        <EngineeringInput
          label={`Move cursor ${cursorLabel} to where ${label} equals a value`}
          value=""
          unit={valueUnit}
          allowEmpty
          onValueChange={seekValue}
        />
      </label>
      {note && <p className="trace-seek__note" role="status">{note}</p>}
    </div>
  );
}
