import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Crosshair, Eye, LockKeyhole, MousePointer2, Tag } from "lucide-react";
import "./App.css";
import { Toolbar } from "./components/Toolbar";
import { Canvas } from "./components/Canvas";
import { StatusBar } from "./components/StatusBar";
import { SimulationPanel } from "./components/SimulationPanel";
import { TelemetryDock } from "./components/TelemetryDock";
import { AssistantPanel, ASSISTANT_PANEL_WIDTH, loadAssistantOpen, saveAssistantOpen } from "./components/AssistantPanel";
import { clampPanelWidth, usePanelWidth } from "./components/panelResize";
import {
  SHELL_LAYOUT,
  workspaceCanFitIndependentColumns,
  workspaceExplorerMax,
  workspaceRightColumnMax,
} from "./components/WorkspaceRightDock";
import { AnalysisErrorBoundary } from "./components/AnalysisErrorBoundary";
import { EmptyState } from "./components/EmptyState";
import { LocalAiSetupDialog } from "./components/LocalAiSetupDialog";
import { CommandPalette } from "./components/CommandPalette";
import {
  ActivityRail,
  BottomPanel,
  COMPONENTS_RAIL_WIDTH,
  ComponentsRail,
  ConfirmDialog,
  EditorTabs,
  EditorToolbar,
  ExplorerPanel,
  MinimizedPanelDock,
  SettingsPanel,
} from "./components/ShellPanels";
import { useSchematic, type SchematicDocument, type SchematicHistory } from "./store/useSchematic";
import { CATALOG } from "./schematic/catalog";
import { dispatchShortcutAction, resolveShortcut } from "./schematic/shortcuts";
import { extractCircuit } from "./schematic/netlist";
import {
  MAX_TRANSIENT_STEPS,
  runTransientAnalysis,
  type AnalysisOptions,
  type AnalysisResult,
} from "./simulation/linearTransient";
import { runOperatingPoint, type OperatingPointResult } from "./simulation/operatingPoint";
import { runAcSweep, type AcResult } from "./simulation/acSweep";
import { runDcSweep, type DcSweepResult, type DcSweepSpec } from "./simulation/dcSweep";
import { runTransferFunction, type TfResult, type TfSpec } from "./simulation/transferFunction";
import { runNoiseAnalysis, type NoiseResult, type NoiseSpec } from "./simulation/noise";
import {
  nestedStepContexts,
  runnableStepsFromDirectives,
  type StepFamilyMember,
  type StepFamilyResult,
} from "./simulation/stepFamily";
import {
  runAcStepFamily,
  runDcStepFamily,
  type AnalysisFamily,
} from "./simulation/stepAnalysisFamily";
import { buildParamScope, EMPTY_SCOPE, type ParamScope } from "./simulation/paramScope";
import { parseCouplingSpecs, type CouplingSpec } from "./simulation/coupling";
import { analysesFromDirectives } from "./io/directiveAnalysis";
import {
  defaultDcSetup,
  defaultNoiseSetup,
  defaultStepSetupUi,
  defaultTfSetup,
  stepSetupToSpec,
  type StepSetupUi,
} from "./simulation/analysisSetup";
import { suggestAcSweep, suggestTransientOptions } from "./simulation/autoResolution";
import { runMeasurements, type MeasResult } from "./simulation/measure";
import { runFourier, type FourierResult } from "./simulation/fourier";
import { componentMeasurements, type ComponentMeasurement } from "./simulation/measurementModel";
import { runAcMeasurements } from "./simulation/measureAc";
import { runDcMeasurements } from "./simulation/measureDc";
import { runNoiseMeasurements } from "./simulation/measureNoise";
import {
  isNativeSpiceRuntime,
  MAX_NATIVE_OUTPUT_POINTS,
  runNativeAcSweep,
  runNativeOperatingPoint,
  runNativeTransient,
} from "./engine/nativeSpice";
import { useProject } from "./store/useProject";
import {
  ascRewriteRisks,
  ascSaveBlockReason,
  basename,
  isAscFile,
  remapMovedProjectPath,
  serializeSchematicFile,
} from "./project/types";
import { validateSchematicDocument } from "./schematic/documentValidation";
import { importAsc } from "./io/ascImport";
import {
  carryAssistantProbes,
  type AssistantApplyCurrentAscAction,
  type AssistantCreateAscAction,
} from "./lib/assistantActions";
import { pickAutoRunAnalysis, type AutoRunAnalysis } from "./lib/assistantAutoRun";

const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = {
  stopTime: 0.006,
  steps: 240,
};

// Pre-run confirmation thresholds (Fix 3 — "may take a while" guard). The
// web TS solver blocks-then-yields cooperatively and is the slower path;
// native ngspice runs out-of-process and tolerates far more samples before
// the run feels risky to kick off without warning.
const LARGE_RUN_WEB_STEPS = 150_000;
const LARGE_RUN_NATIVE_STEPS = 500_000;

/** One open editor tab. `doc` is the in-memory snapshot of its schematic; the
 *  active tab's live content is held in the store and snapshotted on switch. */
interface OpenTab {
  id: string;
  title: string;
  doc: SchematicDocument | null;
  history: SchematicHistory;
  /** Absolute path when opened from a project folder; null for scratchpads. */
  filePath?: string | null;
  dirty?: boolean;
  /** Reasons an imported ASC cannot be rewritten losslessly by Tau yet. */
  ascRewriteRisks?: string[];
}

const newTabId = () => `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const blankDocument = (): SchematicDocument => ({ components: [], wires: [], probes: [], netLabels: [] });
const emptyHistory = (): SchematicHistory => ({ past: [], future: [] });

// §10 responsive floor — App.css's `.editor-shell`/`.plotter` mirror these as
// a CSS backstop. The schematic column must stay usable — tabs, canvas
// overlays, and the results table — down to the app's stated 900px minimum
// window width, so the scope column budgets around it instead of squeezing
// it to nothing.
const RAIL_W = SHELL_LAYOUT.railWidth; // .activity-rail
const HANDLE_W = SHELL_LAYOUT.handleWidth; // .col-resize-handle, one per open column
const SCOPE_MIN = 300; // analysis scope column floor (matches old drag clamp)
function App() {
  const components = useSchematic((s) => s.components);
  const wires = useSchematic((s) => s.wires);
  const toolMode = useSchematic((s) => s.tool.mode);
  const selectedId = useSchematic((s) => s.selectedId);
  const select = useSchematic((s) => s.select);
  const startPlacing = useSchematic((s) => s.startPlacing);
  const startWiring = useSchematic((s) => s.startWiring);
  const startProbing = useSchematic((s) => s.startProbing);
  const startLabeling = useSchematic((s) => s.startLabeling);
  const loadCircuit = useSchematic((s) => s.loadCircuit);
  const replaceCircuit = useSchematic((s) => s.replaceCircuit);
  const restoreCircuit = useSchematic((s) => s.restoreCircuit);
  const newCircuit = useSchematic((s) => s.newCircuit);
  const probes = useSchematic((s) => s.probes);
  const netLabels = useSchematic((s) => s.netLabels);
  const directives = useSchematic((s) => s.directives);
  const past = useSchematic((s) => s.past);
  const future = useSchematic((s) => s.future);
  const cancel = useSchematic((s) => s.cancel);
  const rotate = useSchematic((s) => s.rotate);
  const mirror = useSchematic((s) => s.mirror);
  const copySelected = useSchematic((s) => s.copySelected);
  const paste = useSchematic((s) => s.paste);
  const duplicateSelected = useSchematic((s) => s.duplicateSelected);
  const deleteSelected = useSchematic((s) => s.deleteSelected);
  const undo = useSchematic((s) => s.undo);
  const redo = useSchematic((s) => s.redo);
  const [analysisOptions, setAnalysisOptions] = useState<AnalysisOptions>(DEFAULT_ANALYSIS_OPTIONS);
  // §11 Unit C8 — Tau chooses transient resolution automatically (from the
  // circuit's time constants + source frequencies) until the user touches a
  // dial; manual state then sticks until "Reset to auto".
  const [optionsOverridden, setOptionsOverridden] = useState(false);
  const autoAnalysisOptions = useMemo(() => suggestTransientOptions(components), [components]);
  const effectiveAnalysisOptions = optionsOverridden ? analysisOptions : autoAnalysisOptions;
  const overrideAnalysisOptions = useCallback((next: AnalysisOptions) => {
    setAnalysisOptions(next);
    setOptionsOverridden(true);
  }, []);
  const resetAnalysisOptions = useCallback(() => setOptionsOverridden(false), []);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [opAnalysis, setOpAnalysis] = useState<OperatingPointResult | null>(null);
  const [acAnalysis, setAcAnalysis] = useState<AcResult | null>(null);
  const [dcAnalysis, setDcAnalysis] = useState<DcSweepResult | null>(null);
  const [tfAnalysis, setTfAnalysis] = useState<TfResult | null>(null);
  const [noiseAnalysis, setNoiseAnalysis] = useState<NoiseResult | null>(null);
  const [stepFamily, setStepFamily] = useState<StepFamilyResult | null>(null);
  // `.step` families of the AC/DC analyses: computed alongside the base run
  // whenever the document carries a runnable `.step`, overlaid on their panes.
  const [acStepFamily, setAcStepFamily] = useState<AnalysisFamily<AcResult> | null>(null);
  const [dcStepFamily, setDcStepFamily] = useState<AnalysisFamily<DcSweepResult> | null>(null);
  const [analysisRunning, setAnalysisRunning] = useState(false);
  // Determinate while the web TS solver is reporting real fractions; null
  // (indeterminate bar) before the first callback and for the whole run when
  // native ngspice ends up handling it (no progress channel — see
  // executeTransient/engine/nativeSpice.ts).
  const [runProgress, setRunProgress] = useState<number | null>(null);
  const [runState, setRunState] = useState<"idle" | "complete" | "error" | "stopped">("idle");
  // Pending confirmation for a transient run large enough to warrant a
  // "this may take a while" pause (Fix 3 pre-run guard) — null when no
  // confirmation is pending. `run` is the deferred action to take if the
  // user picks "Run anyway".
  const [confirmLargeRun, setConfirmLargeRun] = useState<{ steps: number; netCount: number; run: () => void } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mode, setMode] = useState<"schematic" | "simulator">("schematic");
  const modeRef = useRef(mode);
  const [tabs, setTabs] = useState<OpenTab[]>([{ id: "tab-0", title: "untitled.asc", doc: null, history: emptyHistory() }]);
  const [activeId, setActiveId] = useState("tab-0");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [confirmCloseTabId, setConfirmCloseTabId] = useState<string | null>(null);
  const [graphOpen, setGraphOpen] = useState(true);
  const [componentFocusSignal, setComponentFocusSignal] = useState(0);
  const [partsOpen, setPartsOpen] = useState(true);
  const [fitSignal, setFitSignal] = useState(0);
  const [scopeWidth, setScopeWidth] = useState(440);
  // Closed by default (§ AI assistant column) — persists across sessions
  // like graphOpen/partsOpen, but doesn't reset on a schematic/simulator mode
  // switch since it's not view-specific. Width is lifted (not owned by
  // AssistantPanel itself) so the responsive-floor effect below can read and
  // shrink it, the same reason scopeWidth lives here instead of in SimulationPanel.
  const [assistantOpen, setAssistantOpen] = useState(loadAssistantOpen);
  const assistantResize = usePanelWidth(ASSISTANT_PANEL_WIDTH);
  const toggleAssistant = useCallback(() => {
    setAssistantOpen((open) => {
      const next = !open;
      saveAssistantOpen(next);
      return next;
    });
  }, []);
  const closeAssistant = useCallback(() => {
    setAssistantOpen(false);
    saveAssistantOpen(false);
  }, []);
  const [dcSetup, setDcSetup] = useState<DcSweepSpec>(() => defaultDcSetup([]));
  const [tfSetup, setTfSetup] = useState<TfSpec>(() => defaultTfSetup([]));
  const [noiseSetup, setNoiseSetup] = useState<NoiseSpec>(() => defaultNoiseSetup([]));
  const [stepSetupUi, setStepSetupUi] = useState<StepSetupUi>(() => defaultStepSetupUi([]));
  const [notice, setNotice] = useState<string | null>(null);
  const shellBodyRef = useRef<HTMLDivElement | null>(null);
  const [shellWidth, setShellWidth] = useState(0);
  const componentsRailResize = usePanelWidth(COMPONENTS_RAIL_WIDTH);
  // ngspice runs outside React's lifecycle. A request version prevents a late
  // result from an edited, closed, or stopped circuit overwriting current UI.
  const analysisRequestRef = useRef(0);
  // Live transient run's abort handle (web TS solver only — see
  // executeTransient). Deliberately NOT tied to analysisRequestRef: aborting
  // must let the in-flight run's own partial result still reach setAnalysis,
  // whereas bumping analysisRequestRef (invalidateAnalysis) is for "a
  // genuinely different run/document superseded this one" and discards
  // whatever comes back.
  const transientAbortRef = useRef<AbortController | null>(null);

  // Analysis to auto-start after an assistant-confirmed circuit lands, latched
  // by createAssistantCircuit/applyAssistantCircuit and consumed once by the
  // effect below. A ref (not state): replaceCircuit/loadCircuit update the
  // schematic store synchronously, but this component's own closures
  // (directives, and every run callback that reads them) only refresh on the
  // *next* render — so setting a ref here and reading it from an effect keyed
  // on `directives` lets the auto-run fire against freshly-rendered closures
  // instead of the stale ones captured before the circuit swapped.
  const pendingAutoRunRef = useRef<AutoRunAnalysis | null>(null);

  // Selecting a part opens the Components rail so Properties is immediately usable.
  useEffect(() => {
    if (selectedId && mode === "schematic") setPartsOpen(true);
  }, [selectedId, mode]);

  const writeSim = useProject((s) => s.writeSim);
  const createSchematicInRoot = useProject((s) => s.createSchematicInRoot);
  const deleteProjectNode = useProject((s) => s.deleteNode);
  const moveProjectNodeInStore = useProject((s) => s.moveNode);

  const moveProjectNode = useCallback(async (sourcePath: string, destinationDirectoryPath: string) => {
    const movedRoot = await moveProjectNodeInStore(sourcePath, destinationDirectoryPath);
    if (!movedRoot) return null;

    // A folder move can affect several open tabs. Remap every matching path so
    // the next Save follows the file instead of recreating it at its old path.
    setTabs((openTabs) => openTabs.map((tab) => {
      if (!tab.filePath) return tab;
      const nextPath = remapMovedProjectPath(tab.filePath, sourcePath, movedRoot);
      if (nextPath === tab.filePath) return tab;
      return { ...tab, filePath: nextPath, title: basename(nextPath) };
    }));
    return movedRoot;
  }, [moveProjectNodeInStore]);

  const documentTitle = (tabs.find((tab) => tab.id === activeId) ?? tabs[0])?.title ?? "untitled.asc";
  const activeFilePath = (tabs.find((tab) => tab.id === activeId) ?? tabs[0])?.filePath ?? null;

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => (current === message ? null : current)), 2600);
  }, []);

  const invalidateAnalysis = useCallback((state: "idle" | "stopped" = "idle") => {
    analysisRequestRef.current += 1;
    setAnalysisRunning(false);
    setAnalysis(null);
    setOpAnalysis(null);
    setAcAnalysis(null);
    setDcAnalysis(null);
    setTfAnalysis(null);
    setNoiseAnalysis(null);
    setStepFamily(null);
    setAcStepFamily(null);
    setDcStepFamily(null);
    setRunState(state);
  }, []);

  // Build the param scope (.param/.func) from the document's directives once per
  // change so every analysis resolves {expr}/{param} values the same way. A bad
  // set of directives (cycle/undefined) falls back to an empty scope rather than
  // crashing the run; the per-value resolver still surfaces unresolved refs.
  const params = useMemo<ParamScope>(() => {
    if (directives.length === 0) return EMPTY_SCOPE;
    try {
      return buildParamScope(directives);
    } catch {
      return EMPTY_SCOPE;
    }
  }, [directives]);

  // Parse the document's `K` mutual-inductance directives once so the interim TS
  // transient/AC solvers couple transformer windings (the native deck already
  // carries `K` lines verbatim). Empty when there are no coupling directives.
  const couplings = useMemo<CouplingSpec[]>(
    () => (directives.length === 0 ? [] : parseCouplingSpecs(directives, params)),
    [directives, params],
  );

  // Evaluate the document's `.meas` directives against the latest transient
  // result. Recomputed only when the result or directives change; measurements
  // chain by name through a scope seeded with the circuit's `.param` values.
  const measurements = useMemo<MeasResult[]>(() => {
    if (!analysis || !analysis.ok || directives.length === 0) return [];
    return runMeasurements(directives, analysis, params.scope, params.funcs);
  }, [analysis, directives, params]);

  // Evaluate the document's `.four` directive against the latest transient result
  // (DC + harmonics + THD over the last period). Recomputed only on change.
  const fourier = useMemo<FourierResult[]>(() => {
    if (!analysis || !analysis.ok || directives.length === 0) return [];
    const { four } = analysesFromDirectives(directives);
    if (!four) return [];
    return runFourier(analysis, four);
  }, [analysis, directives]);

  // Per-component V/I/P telemetry for the simulator's always-visible dock
  // (lifted out of SimulationPanel so it can render alongside the read-only
  // schematic, not just inside the analysis column's Advanced disclosure).
  // Tracks the transient result specifically — it's the only analysis kind
  // with per-timestep node/branch data to derive component readings from.
  const componentRows = useMemo<ComponentMeasurement[]>(
    () => (analysis?.ok ? componentMeasurements(analysis) : []),
    [analysis],
  );

  // Evaluate the document's `.meas ac …` directives against the latest AC sweep.
  // Mirrors the transient measurements but on the frequency axis (db/mag/phase).
  const acMeasurements = useMemo<MeasResult[]>(() => {
    if (!acAnalysis || !acAnalysis.ok || directives.length === 0) return [];
    return runAcMeasurements(directives, acAnalysis, params.scope, params.funcs);
  }, [acAnalysis, directives, params]);

  // Evaluate the document's `.meas dc …` directives against the latest DC sweep
  // (aggregates / FIND / WHEN over the swept-source axis, not time).
  const dcMeasurements = useMemo<MeasResult[]>(() => {
    if (!dcAnalysis || !dcAnalysis.ok || directives.length === 0) return [];
    return runDcMeasurements(directives, dcAnalysis, params.scope, params.funcs);
  }, [dcAnalysis, directives, params]);

  // Evaluate the document's `.meas noise …` directives against the latest noise
  // analysis (`V(onoise)`/`V(inoise)` spectral densities over frequency).
  const noiseMeasurements = useMemo<MeasResult[]>(() => {
    if (!noiseAnalysis || !noiseAnalysis.ok || directives.length === 0) return [];
    return runNoiseMeasurements(directives, noiseAnalysis, params.scope, params.funcs);
  }, [noiseAnalysis, directives, params]);

  const executeTransient = useCallback(async (options: AnalysisOptions) => {
    const requestId = ++analysisRequestRef.current;
    setAnalysisRunning(true);
    setRunProgress(null); // indeterminate until the web solver's first onProgress call (native never gets one)
    const controller = new AbortController();
    transientAbortRef.current = controller;
    let lastProgressAt = 0;
    const onProgress = (fraction: number) => {
      // Throttle to ~10/sec (100ms) — the solver yields far more often than
      // a progress bar needs to repaint, and 0/1 always get through so the
      // bar starts and finishes in sync with the actual run.
      const now = Date.now();
      if (fraction > 0 && fraction < 1 && now - lastProgressAt < 100) return;
      lastProgressAt = now;
      setRunProgress(fraction);
    };
    try {
      const nativeResult = await runNativeTransient({ components, wires, netLabels, params, directives }, options);
      if (nativeResult) {
        // Native has no abort mechanism (no process kill — see
        // engine/nativeSpice.ts). If Stop was clicked while this was in
        // flight, `controller` is aborted but analysisRequestRef is NOT
        // (see stopAnalysis) — so this check is what actually discards a
        // native result the user no longer wants.
        if (analysisRequestRef.current !== requestId || controller.signal.aborted) return;
        setAnalysis(nativeResult);
        setRunState(nativeResult.ok ? "complete" : "error");
        return;
      }
      const result = await runTransientAnalysis(
        { components, wires, netLabels, params, couplings },
        options,
        { onProgress, signal: controller.signal },
      );
      if (analysisRequestRef.current !== requestId) return;
      setAnalysis(result);
      setRunState(result.ok ? "complete" : "error");
      if (controller.signal.aborted) showNotice("Stopped early — showing partial result.");
    } catch (error) {
      if (analysisRequestRef.current !== requestId) return;
      setAnalysis({
        ok: false,
        title: "ngspice transient",
        message: error instanceof Error ? error.message : "ngspice could not run this transient analysis.",
        warnings: [],
      });
      setRunState("error");
    } finally {
      if (analysisRequestRef.current === requestId) {
        setAnalysisRunning(false);
        setRunProgress(null);
      }
      // Only clear the ref if it's still ours — a newer executeTransient call
      // (re-run before this one settled) already installed its own
      // controller, and clearing that out from under it would make
      // stopAnalysis fall back to the non-abortable invalidate path for a
      // run that's actually still abortable.
      if (transientAbortRef.current === controller) transientAbortRef.current = null;
    }
  }, [components, wires, netLabels, params, directives, couplings, showNotice]);

  // Pre-run guard (Fix 3): a step count big enough to genuinely stall the UI
  // for a while gets a confirmation instead of launching silently. Native is
  // out-of-process and far faster per sample, hence the higher ceiling.
  const confirmLargeRunIfNeeded = useCallback((options: AnalysisOptions, run: () => void) => {
    const limit = isNativeSpiceRuntime() ? LARGE_RUN_NATIVE_STEPS : LARGE_RUN_WEB_STEPS;
    if (options.steps <= limit) {
      run();
      return;
    }
    const netCount = extractCircuit(components, wires, netLabels).nets.length;
    setConfirmLargeRun({ steps: options.steps, netCount, run });
  }, [components, wires, netLabels]);

  const runAnalysis = useCallback(async () => {
    confirmLargeRunIfNeeded(effectiveAnalysisOptions, () => { void executeTransient(effectiveAnalysisOptions); });
  }, [effectiveAnalysisOptions, executeTransient, confirmLargeRunIfNeeded]);

  const runAndShowSimulator = useCallback(async () => {
    confirmLargeRunIfNeeded(effectiveAnalysisOptions, () => {
      setMode("simulator");
      setGraphOpen(true);
      void executeTransient(effectiveAnalysisOptions);
    });
  }, [effectiveAnalysisOptions, executeTransient, confirmLargeRunIfNeeded]);

  const runOperatingAnalysis = useCallback(async () => {
    const requestId = ++analysisRequestRef.current;
    setAnalysisRunning(true);
    try {
      const result = await runNativeOperatingPoint({ components, wires, netLabels, params, directives }) ?? runOperatingPoint({ components, wires, netLabels, params }, { returnBranches: true });
      if (analysisRequestRef.current !== requestId) return;
      setOpAnalysis(result);
    } catch (error) {
      if (analysisRequestRef.current !== requestId) return;
      setOpAnalysis({ ok: false, message: error instanceof Error ? error.message : "ngspice could not calculate the operating point.", warnings: [] });
    } finally {
      if (analysisRequestRef.current === requestId) setAnalysisRunning(false);
    }
  }, [components, wires, netLabels, params, directives]);

  const runAcAnalysis = useCallback(async () => {
    const requestId = ++analysisRequestRef.current;
    setAnalysisRunning(true);
    try {
      // §11 Unit C8 — sweep defaults bracket the circuit's own source
      // frequencies (a document .ac directive still wins for step families).
      const acSweep = suggestAcSweep(components);
      const result = await runNativeAcSweep(
        { components, wires, netLabels, params, directives },
        acSweep,
      ) ?? runAcSweep({ components, wires, netLabels, params, couplings }, acSweep);
      if (analysisRequestRef.current !== requestId) return;
      setAcAnalysis(result);
      // A runnable `.step` also produces a family of Bode curves to overlay,
      // swept over the document's own `.ac` range when it has one (TS solver).
      const specs = runnableStepsFromDirectives(directives);
      setAcStepFamily(
        specs.length > 0
          ? runAcStepFamily(
              specs,
              params,
              { components, wires, netLabels, couplings },
              analysesFromDirectives(directives).ac ?? acSweep,
            )
          : null,
      );
    } catch (error) {
      if (analysisRequestRef.current !== requestId) return;
      setAcAnalysis({ ok: false, message: error instanceof Error ? error.message : "ngspice could not run this AC sweep.", warnings: [] });
      setAcStepFamily(null);
    } finally {
      if (analysisRequestRef.current === requestId) setAnalysisRunning(false);
    }
  }, [components, wires, netLabels, params, directives, couplings]);

  useEffect(() => {
    setDcSetup((d) => defaultDcSetup(components, d));
    setTfSetup((t) => defaultTfSetup(components, t));
    setNoiseSetup((n) => defaultNoiseSetup(components, n));
    setStepSetupUi((s) => defaultStepSetupUi(components, s));
  }, [components]);

  // A DC sweep uses the UI setup panel, falling back to an imported `.dc`
  // directive when the document carries one from LTspice.
  const runDcAnalysis = useCallback(async () => {
    const requestId = ++analysisRequestRef.current;
    const dc = analysesFromDirectives(directives).dc ?? dcSetup;
    setAnalysisRunning(true);
    try {
      const result = runDcSweep({ components, wires, netLabels, params }, dc);
      if (analysisRequestRef.current !== requestId) return;
      setDcAnalysis(result);
      // A runnable `.step` also produces a family of transfer curves to overlay.
      const specs = runnableStepsFromDirectives(directives);
      setDcStepFamily(
        specs.length > 0 ? runDcStepFamily(specs, params, { components, wires, netLabels }, dc) : null,
      );
    } catch (error) {
      if (analysisRequestRef.current !== requestId) return;
      setDcAnalysis({ ok: false, message: error instanceof Error ? error.message : "Could not run this DC sweep.", warnings: [] });
      setDcStepFamily(null);
    } finally {
      if (analysisRequestRef.current === requestId) setAnalysisRunning(false);
    }
  }, [components, wires, netLabels, params, directives, dcSetup]);

  const runTfAnalysis = useCallback(async () => {
    const requestId = ++analysisRequestRef.current;
    const tf = analysesFromDirectives(directives).tf ?? tfSetup;
    setAnalysisRunning(true);
    try {
      const result = runTransferFunction({ components, wires, netLabels, params }, tf);
      if (analysisRequestRef.current !== requestId) return;
      setTfAnalysis(result);
    } catch (error) {
      if (analysisRequestRef.current !== requestId) return;
      setTfAnalysis({ ok: false, message: error instanceof Error ? error.message : "Could not run this transfer function.", warnings: [] });
    } finally {
      if (analysisRequestRef.current === requestId) setAnalysisRunning(false);
    }
  }, [components, wires, netLabels, params, directives, tfSetup]);

  const runNoiseAnalysis_ = useCallback(async () => {
    const requestId = ++analysisRequestRef.current;
    const noise = analysesFromDirectives(directives).noise ?? noiseSetup;
    setAnalysisRunning(true);
    try {
      const result = runNoiseAnalysis({ components, wires, netLabels, params }, noise);
      if (analysisRequestRef.current !== requestId) return;
      setNoiseAnalysis(result);
    } catch (error) {
      if (analysisRequestRef.current !== requestId) return;
      setNoiseAnalysis({ ok: false, message: error instanceof Error ? error.message : "Could not run this noise analysis.", warnings: [] });
    } finally {
      if (analysisRequestRef.current === requestId) setAnalysisRunning(false);
    }
  }, [components, wires, netLabels, params, directives, noiseSetup]);

  const runStepAnalysis = useCallback(async () => {
    const requestId = ++analysisRequestRef.current;
    const directiveSpecs = runnableStepsFromDirectives(directives);
    const uiSpec = stepSetupToSpec(stepSetupUi);
    const specs = directiveSpecs.length > 0 ? directiveSpecs : uiSpec ? [uiSpec] : [];
    if (specs.length === 0) {
      setStepFamily({
        ok: false,
        message: "Configure the step sweep below (source, start, stop, increment) then run again.",
        members: [],
        warnings: [],
      });
      return;
    }
    let contexts;
    try {
      contexts = nestedStepContexts(specs, params, components);
    } catch (error) {
      setStepFamily({ ok: false, message: error instanceof Error ? error.message : "Could not expand this .step.", members: [], warnings: [] });
      return;
    }
    setAnalysisRunning(true);
    try {
      const members: StepFamilyMember[] = [];
      for (const ctx of contexts) {
        // A temp sweep forwards its temperature to native ngspice as `.temp` so
        // its device models shift too (the TS solver already saw the rescaled
        // resistors via applyTemperature).
        const stepDirectives = ctx.temperature !== undefined ? [`.temp ${ctx.temperature}`] : undefined;
        const result =
          (await runNativeTransient({ components: ctx.components, wires, netLabels, params: ctx.params, directives: stepDirectives }, effectiveAnalysisOptions))
          ?? (await runTransientAnalysis({ components: ctx.components, wires, netLabels, params: ctx.params }, effectiveAnalysisOptions));
        if (analysisRequestRef.current !== requestId) return;
        members.push({ label: ctx.label, value: ctx.value, result });
      }
      const warnings = members.find((m) => m.result.ok)?.result.warnings ?? [];
      setStepFamily({ ok: members.some((m) => m.result.ok), spec: specs[0], members, warnings });
    } catch (error) {
      if (analysisRequestRef.current !== requestId) return;
      setStepFamily({ ok: false, message: error instanceof Error ? error.message : "Could not run this .step sweep.", members: [], warnings: [] });
    } finally {
      if (analysisRequestRef.current === requestId) setAnalysisRunning(false);
    }
  }, [components, wires, netLabels, params, directives, effectiveAnalysisOptions, stepSetupUi]);

  const stepAnalysis = useCallback(async () => {
    // Native ngspice may return an endpoint in addition to requested samples.
    const maxSteps = isNativeSpiceRuntime() ? MAX_NATIVE_OUTPUT_POINTS - 1 : MAX_TRANSIENT_STEPS;
    const nextOptions = {
      ...effectiveAnalysisOptions,
      steps: Math.min(maxSteps, Math.max(effectiveAnalysisOptions.steps + 1, Math.ceil(effectiveAnalysisOptions.steps * 1.25))),
    };
    overrideAnalysisOptions(nextOptions);
    setMode("simulator");
    setGraphOpen(true);
    await executeTransient(nextOptions);
    showNotice(`Re-ran transient at ${nextOptions.steps.toLocaleString()} samples.`);
  }, [effectiveAnalysisOptions, overrideAnalysisOptions, executeTransient, showNotice]);

  const stopAnalysis = useCallback(() => {
    // transientAbortRef is non-null ONLY while executeTransient's own run is
    // in flight (set at its start, cleared in its finally) — every other
    // analysis kind (OP/AC/DC/TF/Noise/Step) leaves it null, so a live one of
    // those still falls through to the old invalidate-based Stop below.
    if (analysisRunning && transientAbortRef.current) {
      // A transient run can now actually be interrupted mid-solve (Fix 3) —
      // abort the web solver's cooperative loop. This deliberately does NOT
      // go through invalidateAnalysis: that bumps analysisRequestRef, which
      // would make executeTransient discard the partial result this abort is
      // about to produce. See executeTransient for how a native (unabortable)
      // run still gets its stale result discarded correctly via the same
      // controller's `aborted` flag.
      transientAbortRef.current.abort();
      return;
    }
    if (!analysis && !analysisRunning) {
      showNotice("No simulation result to stop.");
      return;
    }
    invalidateAnalysis("stopped");
    showNotice("Simulation stopped. Run again when ready.");
  }, [analysis, analysisRunning, invalidateAnalysis, showNotice]);

  // Snapshot the live store into the active tab so schematic annotations and
  // undo/redo history are isolated from every other open circuit.
  const snapshotActive = useCallback(
    (list: OpenTab[]) =>
      list.map((tab) => (tab.id === activeId
        ? {
            ...tab,
            doc: { components, wires, probes, netLabels, directives },
            history: { past, future },
          }
        : tab)),
    [activeId, components, wires, probes, netLabels, directives, past, future],
  );

  // Adopt an imported circuit's own `.tran` settings (stop time / sample count)
  // so it simulates as authored instead of with the editor's default window.
  const adoptDirectiveOptions = useCallback((doc: SchematicDocument) => {
    const { tran } = analysesFromDirectives(doc.directives ?? []);
    if (tran) setAnalysisOptions(tran);
  }, []);

  // Open a document: focus its tab if already open, otherwise add a new one.
  // If the only tab is still the blank untitled starter, replace it in place.
  const openDocument = useCallback((
    doc: SchematicDocument,
    title: string,
    filePath?: string | null,
    rewriteRisks: string[] = [],
  ) => {
    const snap = snapshotActive(tabs);
    const existing = snap.find((tab) => (filePath ? tab.filePath === filePath : tab.title === title));
    if (existing) {
      setTabs(snap.map((tab) =>
        tab.id === existing.id
          ? {
              ...tab,
              doc,
              history: emptyHistory(),
              filePath: filePath ?? tab.filePath,
              dirty: false,
              ascRewriteRisks: rewriteRisks,
            }
          : tab,
      ));
      setActiveId(existing.id);
      loadCircuit(doc);
    } else {
      const blankStarter =
        snap.length === 1 &&
        !snap[0].filePath &&
        /^untitled/i.test(snap[0].title) &&
        components.length === 0 &&
        wires.length === 0;
      if (blankStarter) {
        setTabs([{
          id: snap[0].id,
          title,
          doc,
          history: emptyHistory(),
          filePath: filePath ?? null,
          dirty: false,
          ascRewriteRisks: rewriteRisks,
        }]);
        setActiveId(snap[0].id);
        loadCircuit(doc);
      } else {
        const id = newTabId();
        setTabs([...snap, {
          id,
          title,
          doc,
          history: emptyHistory(),
          filePath: filePath ?? null,
          dirty: false,
          ascRewriteRisks: rewriteRisks,
        }]);
        setActiveId(id);
        loadCircuit(doc);
      }
    }
    adoptDirectiveOptions(doc);
    invalidateAnalysis();
    setMode("schematic");
    setFitSignal((n) => n + 1);
    showNotice(`Opened ${title}`);
  }, [tabs, snapshotActive, loadCircuit, adoptDirectiveOptions, invalidateAnalysis, showNotice, components.length, wires.length]);

  const openSimFromProject = useCallback((path: string, title: string, json: string) => {
    try {
      const parsed = JSON.parse(json) as unknown;
      const doc = validateSchematicDocument(parsed);
      openDocument(doc, title, path);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Could not open .sim file.");
    }
  }, [openDocument, showNotice]);

  const openAscFromProject = useCallback((path: string, title: string, text: string) => {
    try {
      const result = importAsc(text);
      const doc: SchematicDocument = {
        components: result.components,
        wires: result.wires,
        netLabels: result.netLabels,
        directives: result.directives,
        probes: [],
      };
      openDocument(doc, title, path, ascRewriteRisks(text));
      if (result.warnings.length > 0) {
        console.warn(`Imported ${title} with ${result.warnings.length} warning(s):`, result.warnings);
        showNotice(`Opened ${title} with ${result.warnings.length} import warning(s).`);
      }
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Could not import .asc file.");
    }
  }, [openDocument, showNotice]);

  const createAssistantCircuit = useCallback(async (action: AssistantCreateAscAction) => {
    const path = await createSchematicInRoot(action.filename);
    if (!path) throw new Error(useProject.getState().error ?? "Could not create schematic.");
    try {
      await writeSim(path, action.source);
    } catch (error) {
      // The assistant action is all-or-nothing: don't leave a misleading empty
      // placeholder if the second half of the native write fails.
      await deleteProjectNode(path);
      throw error;
    }
    pendingAutoRunRef.current = pickAutoRunAnalysis(action.document.directives ?? []);
    // Open the Tau-native document (wires meet symbol pins). The ASC on disk
    // remains the durable interchange file; re-importing it here would attach
    // LTspice pin overrides and visually detach wires from Tau glyphs.
    openDocument(action.document, basename(path), path, ascRewriteRisks(action.source));
    showNotice(`Created ${basename(path)}`);
  }, [createSchematicInRoot, deleteProjectNode, openDocument, showNotice, writeSim]);

  const applyAssistantCircuit = useCallback((action: AssistantApplyCurrentAscAction) => {
    pendingAutoRunRef.current = pickAutoRunAnalysis(action.document.directives ?? []);
    replaceCircuit({
      ...action.document,
      probes: carryAssistantProbes(components, probes, action.document),
    });
    const next = useSchematic.getState();
    const appliedDocument: SchematicDocument = {
      components: next.components,
      wires: next.wires,
      probes: next.probes,
      netLabels: next.netLabels,
      directives: next.directives,
    };
    const appliedHistory: SchematicHistory = { past: next.past, future: next.future };
    setTabs((openTabs) => openTabs.map((tab) => (
      tab.id === activeId
        ? {
            ...tab,
            doc: appliedDocument,
            history: appliedHistory,
            dirty: true,
            ascRewriteRisks: ascRewriteRisks(action.source),
          }
        : tab
    )));
    adoptDirectiveOptions(appliedDocument);
    invalidateAnalysis();
    setMode("schematic");
    setFitSignal((value) => value + 1);
    showNotice("Applied assistant changes to the current circuit.");
  }, [activeId, adoptDirectiveOptions, components, invalidateAnalysis, probes, replaceCircuit, showNotice]);

  // Auto-starts the analysis an assistant-confirmed circuit's directives
  // request (ask -> confirm -> data appears), reusing the exact per-mode run
  // callbacks the simulator's own Run buttons use so pre-run guards, abort,
  // progress, and dashboards all behave identically. Keyed on `directives`
  // (not the confirm handlers themselves) so it fires once the store — and
  // every callback that closes over it — has actually caught up with the
  // just-applied circuit; see pendingAutoRunRef above.
  useEffect(() => {
    const pending = pendingAutoRunRef.current;
    if (!pending) return;
    pendingAutoRunRef.current = null;
    if (analysisRunning) return; // don't stack an auto-run under one already in flight

    showNotice(`Running ${pending.directive} from the assistant's plan…`);
    switch (pending.kind) {
      case "tran": {
        const tran = analysesFromDirectives(directives).tran;
        if (!tran) return;
        confirmLargeRunIfNeeded(tran, () => {
          setMode("simulator");
          setGraphOpen(true);
          void executeTransient(tran);
        });
        break;
      }
      case "ac":
        setMode("simulator");
        setGraphOpen(true);
        void runAcAnalysis();
        break;
      case "dc":
        setMode("simulator");
        setGraphOpen(true);
        void runDcAnalysis();
        break;
      case "tf":
        setMode("simulator");
        setGraphOpen(true);
        void runTfAnalysis();
        break;
      case "noise":
        setMode("simulator");
        setGraphOpen(true);
        void runNoiseAnalysis_();
        break;
      case "op":
        setMode("simulator");
        setGraphOpen(true);
        void runOperatingAnalysis();
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directives]);

  const saveActiveToProject = useCallback(async () => {
    const tab = tabs.find((t) => t.id === activeId);
    if (!tab) return;
    let filePath = tab.filePath ?? null;
    let createdForSave = false;
    if (!filePath) {
      filePath = await createSchematicInRoot(tab.title);
      if (!filePath) {
        showNotice(useProject.getState().error ?? "Open a Schematics folder before saving.");
        return;
      }
      createdForSave = true;
    }
    const savePath = filePath;
    try {
      const serialized = serializeSchematicFile(savePath, {
        components,
        wires,
        probes,
        netLabels,
        directives,
      });
      const blockReason = isAscFile(savePath)
        ? ascSaveBlockReason(tab.ascRewriteRisks ?? [], probes.length, serialized.warnings)
        : null;
      if (blockReason) {
        if (createdForSave) await deleteProjectNode(savePath);
        console.warn(`Blocked lossy save for ${basename(savePath)}: ${blockReason}`);
        showNotice(`Save blocked: ${blockReason}`);
        return;
      }
      await writeSim(savePath, serialized.contents);
      setTabs((list) => list.map((t) => (
        t.id === activeId
          ? { ...t, title: basename(savePath), filePath: savePath, dirty: false }
          : t
      )));
      if (serialized.warnings.length > 0) {
        console.warn(`Saved ${basename(savePath)} with export warnings:`, serialized.warnings);
        showNotice(`Saved with ${serialized.warnings.length} export warning(s).`);
      } else {
        showNotice(`${createdForSave ? "Created" : "Saved"} ${basename(savePath)}`);
      }
    } catch (error) {
      if (createdForSave) await deleteProjectNode(savePath);
      showNotice(error instanceof Error ? error.message : "Save failed.");
    }
  }, [tabs, activeId, components, wires, probes, netLabels, directives, createSchematicInRoot, deleteProjectNode, writeSim, showNotice]);

  // Switch to an already-open tab, preserving each tab's content in memory.
  const switchTab = useCallback((id: string) => {
    if (id === activeId) return;
    const snap = snapshotActive(tabs);
    const target = snap.find((tab) => tab.id === id);
    if (!target) return;
    setTabs(snap);
    setActiveId(id);
    const restored = target.doc ?? blankDocument();
    restoreCircuit(restored, target.history);
    adoptDirectiveOptions(restored);
    invalidateAnalysis();
    setFitSignal((n) => n + 1);
  }, [activeId, tabs, snapshotActive, restoreCircuit, adoptDirectiveOptions, invalidateAnalysis]);

  const startNewCircuit = useCallback(async () => {
    const path = await createSchematicInRoot();
    if (!path) {
      showNotice(useProject.getState().error ?? "Could not create schematic.");
      return;
    }

    // Opening through the normal document path gives the tab its real filePath
    // immediately. The first ⌘S therefore updates the newly-created .asc
    // instead of falling back to the old pathless scratchpad warning.
    openDocument(blankDocument(), basename(path), path);
    setGraphOpen(true);
    showNotice(`Created ${basename(path)}`);
  }, [createSchematicInRoot, openDocument, showNotice]);

  const closeTab = useCallback((id: string, confirmed = false) => {
    const snap = snapshotActive(tabs);
    const idx = snap.findIndex((tab) => tab.id === id);
    if (idx === -1) return;
    const closing = snap[idx];
    const isLastPopulatedTab = snap.length === 1
      && Boolean(closing.doc && (closing.doc.components.length > 0 || closing.doc.wires.length > 0));
    if (isLastPopulatedTab && !confirmed) {
      setConfirmCloseTabId(id);
      return;
    }
    const remaining = snap.filter((tab) => tab.id !== id);
    if (remaining.length === 0) {
      const blank: OpenTab = { id: newTabId(), title: "untitled.asc", doc: blankDocument(), history: emptyHistory() };
      setTabs([blank]);
      setActiveId(blank.id);
      newCircuit();
    } else {
      const next = remaining[Math.max(0, idx - 1)];
      setTabs(remaining);
      if (id === activeId) {
        setActiveId(next.id);
        restoreCircuit(next.doc ?? blankDocument(), next.history);
      }
    }
    invalidateAnalysis();
    setMode("schematic");
  }, [tabs, activeId, snapshotActive, restoreCircuit, newCircuit, invalidateAnalysis]);

  const clearScratchpad = useCallback(() => {
    newCircuit();
    setTabs((prev) => prev.map((tab) => (
      tab.id === activeId ? { ...tab, doc: blankDocument(), history: emptyHistory() } : tab
    )));
    invalidateAnalysis();
    setMode("schematic");
    setConfirmClearOpen(false);
    setGraphOpen(true);
    showNotice("Scratchpad cleared.");
  }, [activeId, newCircuit, invalidateAnalysis, showNotice]);

  useEffect(() => {
    invalidateAnalysis();
  }, [components, wires, directives, invalidateAnalysis]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Simulator node naming is an analysis annotation and should rename/create
  // its plot immediately from the current result. Once back in the schematic,
  // labels regain their electrical net-merging meaning and invalidate results.
  // `mode` itself is intentionally tracked through a ref: changing views must
  // preserve the last result so Run/Errors keep their truthful status color.
  useEffect(() => {
    if (modeRef.current === "schematic") invalidateAnalysis();
  }, [netLabels, invalidateAnalysis]);

  // The simulator's circuit surface has exactly three safe modes: inspect,
  // voltage probe, and node name. Never carry a topology-editing tool across
  // from the schematic editor.
  useEffect(() => {
    if (mode === "simulator" && !["select", "probe", "label"].includes(toolMode)) cancel();
  }, [mode, toolMode, cancel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, button, [role='button'], [role='tab'], [role='dialog'], [contenteditable='true']")) {
        return;
      }

      const action = resolveShortcut({
        key: e.key,
        ctrlOrMeta: e.metaKey || e.ctrlKey,
        shift: e.shiftKey,
      });
      if (action) {
        if (action !== "cancel") e.preventDefault();
        // Simulator view is read-only (pan/zoom/probe only — see Canvas's
        // `interactive` prop); every editing action requires schematic view.
        dispatchShortcutAction(action, mode, {
          undo,
          redo,
          openPalette: () => setPaletteOpen(true),
          rotate,
          mirror,
          copy: copySelected,
          paste,
          duplicate: duplicateSelected,
          cancel,
          remove: deleteSelected,
          wire: startWiring,
          label: startLabeling,
        });
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveActiveToProject();
        return;
      }
      if (e.metaKey || e.ctrlKey) return; // leave other OS / app shortcuts alone
      if (mode !== "schematic") return; // place-shortcuts (R/C/L/V/…) are schematic-only edits

      const entry = CATALOG.find((c) => c.hotkey === e.key.toLowerCase());
      if (entry) {
        e.preventDefault();
        startPlacing(entry.kind);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, startPlacing, startWiring, startLabeling, cancel, rotate, mirror, copySelected, paste, duplicateSelected, deleteSelected, undo, redo, saveActiveToProject]);

  // Track the shell body's real width so the simulator column budget below
  // reacts to the actual window size (including the 900px minimum), not just
  // a value read once at mount.
  useEffect(() => {
    const el = shellBodyRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === "number") setShellWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // §10 responsive floor: whenever the window narrows (or the scope opens/
  // closes), re-clamp the scope width so the layout never drops below a
  // usable width. This only ever shrinks toward the current values, so it
  // never fights a manual drag that already fits.
  useEffect(() => {
    if (mode !== "simulator" || shellWidth === 0) return;
    if (graphOpen) {
      const budget = shellWidth - RAIL_W - HANDLE_W;
      setScopeWidth((w) => Math.min(w, Math.max(SCOPE_MIN, budget)));
    }
    // scopeWidth is intentionally excluded: this effect only reacts to layout
    // changes (window size, panel open/close), and reads the latest width via
    // the functional updater without re-running on every drag-driven change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shellWidth, mode, graphOpen]);

  const independentColumnsFit = workspaceCanFitIndependentColumns(shellWidth, [
    COMPONENTS_RAIL_WIDTH.minWidth,
    ASSISTANT_PANEL_WIDTH.minWidth,
  ]);
  // At the 900px floor Explorer + Components + Assistant cannot all coexist.
  // Components and Assistant are the active creation tools, so keep them
  // together and temporarily yield the passive Explorer column. Selecting
  // Explorer explicitly below swaps Components out; widening restores all
  // three without mutating the user's Components preference.
  const componentsColumnOpen = mode === "schematic" && partsOpen;
  const explorerColumnOpen = mode === "schematic"
    && (!assistantOpen || !componentsColumnOpen || independentColumnsFit);
  const assistantResponsiveMax = workspaceRightColumnMax(
    shellWidth,
    mode,
    ASSISTANT_PANEL_WIDTH,
    mode === "schematic" && assistantOpen && componentsColumnOpen
      ? [COMPONENTS_RAIL_WIDTH.minWidth]
      : [],
  );
  const effectiveAssistantWidth = clampPanelWidth(
    assistantResize.width,
    ASSISTANT_PANEL_WIDTH.minWidth,
    assistantResponsiveMax,
  );
  const componentsRailResponsiveMax = workspaceRightColumnMax(
    shellWidth,
    "schematic",
    COMPONENTS_RAIL_WIDTH,
    assistantOpen ? [effectiveAssistantWidth] : [],
  );
  const effectiveComponentsRailWidth = clampPanelWidth(
    componentsRailResize.width,
    COMPONENTS_RAIL_WIDTH.minWidth,
    componentsRailResponsiveMax,
  );
  const explorerResponsiveMax = explorerColumnOpen
    ? workspaceExplorerMax(shellWidth, [
        ...(componentsColumnOpen ? [effectiveComponentsRailWidth] : []),
        ...(assistantOpen ? [effectiveAssistantWidth] : []),
      ])
    : undefined;

  // Same responsive floor for the independent Assistant column in both modes.
  // Persisted desktop widths must not make either the schematic editor or
  // simulator analysis unreachable when the window returns at 900px.
  useEffect(() => {
    if (shellWidth === 0 || !assistantOpen) return;
    if (assistantResize.width > assistantResponsiveMax) assistantResize.setWidth(assistantResponsiveMax);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shellWidth, mode, assistantOpen, assistantResize.width, assistantResponsiveMax]);

  useEffect(() => {
    if (shellWidth === 0 || !componentsColumnOpen) return;
    if (componentsRailResize.width > componentsRailResponsiveMax) {
      componentsRailResize.setWidth(componentsRailResponsiveMax);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shellWidth, componentsColumnOpen, componentsRailResize.width, componentsRailResponsiveMax]);

  const effectiveAssistantResize = {
    ...assistantResize,
    width: effectiveAssistantWidth,
  };

  return (
    <div className={`app app-${mode}`}>
      <Toolbar
        mode={mode}
        result={analysis}
        runState={runState}
        isRunning={analysisRunning}
        title={documentTitle}
        onModeChange={(nextMode) => {
          setMode(nextMode);
          if (nextMode === "simulator") setFitSignal((value) => value + 1);
        }}
        onRun={runAndShowSimulator}
        assistantOpen={assistantOpen}
        onToggleAssistant={toggleAssistant}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div
        ref={shellBodyRef}
        className="shell-body"
        style={{ "--scope-w": `${scopeWidth}px`, "--assistant-w": `${effectiveAssistantWidth}px` } as CSSProperties}
      >
        <ActivityRail
          mode={mode}
          explorerOpen={explorerColumnOpen}
          partsOpen={componentsColumnOpen}
          onFocusExplorer={() => {
            setMode("schematic");
            if (assistantOpen && !independentColumnsFit) setPartsOpen(false);
          }}
          onModeChange={setMode}
          onSearch={() => setPaletteOpen(true)}
          onFocusComponents={() => {
            setMode("schematic");
            setPartsOpen((open) => {
              const next = !open;
              if (next) {
                setComponentFocusSignal((value) => value + 1);
              }
              return next;
            });
          }}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        {explorerColumnOpen && (
          <ExplorerPanel
            activeFilePath={activeFilePath}
            onOpenSimFile={openSimFromProject}
            onOpenAscText={openAscFromProject}
            onNotice={showNotice}
            onMoveNode={moveProjectNode}
            maxWidth={explorerResponsiveMax}
          />
        )}
        {mode === "schematic" && (
        <section className="editor-shell" aria-label="Schematic editor">
          <EditorToolbar
            mode={mode}
            isRunning={analysisRunning}
            onRun={runAndShowSimulator}
            onStep={stepAnalysis}
            onStop={stopAnalysis}
            onClearScratchpad={() => setConfirmClearOpen(true)}
          />
          <EditorTabs
            tabs={tabs}
            activeId={activeId}
            mode={mode}
            onSelectTab={switchTab}
            onCloseTab={closeTab}
            onNewCircuit={startNewCircuit}
            onHideSimulator={() => setMode("schematic")}
          />
          <main className="stage">
            <Canvas op={opAnalysis} interactive fitSignal={fitSignal} />
            {components.length === 0 && wires.length === 0 && toolMode === "select" && (
              <EmptyState />
            )}
          </main>
          <BottomPanel result={analysis} isRunning={analysisRunning} />
        </section>
        )}
        {mode === "simulator" && graphOpen && (
          <>
            <section className="sim-schematic-pane" aria-label="Circuit overview">
              <header className="sim-schematic-header">
                <div className="sim-schematic-title">
                  <Eye size={14} strokeWidth={1.7} aria-hidden="true" />
                  <span>Circuit</span>
                </div>
                <div className="sim-circuit-tools" role="toolbar" aria-label="Circuit inspection tools">
                  <button
                    className={toolMode === "select" ? "active" : undefined}
                    onClick={cancel}
                    aria-pressed={toolMode === "select"}
                    title="Inspect components without editing"
                  >
                    <MousePointer2 size={13} strokeWidth={1.7} aria-hidden="true" />
                    <span>Inspect</span>
                  </button>
                  <button
                    className={toolMode === "probe" ? "active" : undefined}
                    onClick={startProbing}
                    aria-pressed={toolMode === "probe"}
                    title="Add or remove a voltage probe"
                  >
                    <Crosshair size={13} strokeWidth={1.7} aria-hidden="true" />
                    <span>Probe</span>
                  </button>
                  <button
                    className={toolMode === "label" ? "active" : undefined}
                    onClick={startLabeling}
                    aria-pressed={toolMode === "label"}
                    title="Add, rename, or remove a node name"
                  >
                    <Tag size={13} strokeWidth={1.7} aria-hidden="true" />
                    <span>Name</span>
                  </button>
                </div>
                <span
                  className="sim-view-only"
                  aria-label="View-only circuit topology"
                  title="View-only circuit topology"
                >
                  <LockKeyhole size={13} strokeWidth={1.8} aria-hidden="true" />
                </span>
              </header>
              <div className="sim-schematic-canvas">
                <Canvas op={opAnalysis} interactive={false} fitSignal={fitSignal} />
              </div>
              <TelemetryDock rows={componentRows} selectedId={selectedId} onSelect={select} />
            </section>
            <AnalysisErrorBoundary>
              <SimulationPanel
                circuitTitle={documentTitle}
                result={analysis}
                opResult={opAnalysis}
                acResult={acAnalysis}
                dcResult={dcAnalysis}
                tfResult={tfAnalysis}
                noiseResult={noiseAnalysis}
                stepResult={stepFamily}
                acStepFamily={acStepFamily}
                dcStepFamily={dcStepFamily}
                measurements={measurements}
                fourier={fourier}
                acMeasurements={acMeasurements}
                dcMeasurements={dcMeasurements}
                noiseMeasurements={noiseMeasurements}
                options={effectiveAnalysisOptions}
                optionsAuto={!optionsOverridden}
                isRunning={analysisRunning}
                runProgress={runProgress}
                onOptionsChange={overrideAnalysisOptions}
                onResetOptions={resetAnalysisOptions}
                onRun={runAnalysis}
                onRunOperatingPoint={runOperatingAnalysis}
                onRunAcSweep={runAcAnalysis}
                onRunDcSweep={runDcAnalysis}
                onRunTf={runTfAnalysis}
                onRunNoise={runNoiseAnalysis_}
                onRunStep={runStepAnalysis}
                onStop={stopAnalysis}
                onStep={stepAnalysis}
                onClose={() => setGraphOpen(false)}
                dcSetup={dcSetup}
                onDcSetupChange={setDcSetup}
                tfSetup={tfSetup}
                onTfSetupChange={setTfSetup}
                noiseSetup={noiseSetup}
                onNoiseSetupChange={setNoiseSetup}
                stepSetupUi={stepSetupUi}
                onStepSetupUiChange={setStepSetupUi}
              />
            </AnalysisErrorBoundary>
          </>
        )}
        {mode === "simulator" && !graphOpen && (
          <MinimizedPanelDock
            graphHidden={!graphOpen}
            onRestoreGraph={() => setGraphOpen(true)}
          />
        )}
        {componentsColumnOpen && (
          <ComponentsRail
            focusSignal={componentFocusSignal}
            onNotice={showNotice}
            resize={componentsRailResize}
            maxWidth={componentsRailResponsiveMax}
          />
        )}
        {assistantOpen && (
          <AssistantPanel
            components={components}
            wires={wires}
            netLabels={netLabels}
            directives={directives}
            params={params}
            analysis={analysis}
            componentRows={componentRows}
            measurements={measurements}
            selectedId={selectedId}
            resize={effectiveAssistantResize}
            onCreateAsc={createAssistantCircuit}
            onApplyCurrent={applyAssistantCircuit}
            onOpenSettings={() => setSettingsOpen(true)}
            onClose={closeAssistant}
          />
        )}
      </div>
      <StatusBar mode={mode} result={analysis} title={documentTitle} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <LocalAiSetupDialog onReady={() => showNotice("Local AI is ready on this Mac.")} />
      {settingsOpen && (
        <SettingsPanel
          title={documentTitle}
          onClose={() => setSettingsOpen(false)}
          onNewCircuit={startNewCircuit}
          onOpenCommandPalette={() => {
            setSettingsOpen(false);
            setPaletteOpen(true);
          }}
          onNotice={showNotice}
        />
      )}
      {confirmClearOpen && (
        <ConfirmDialog
          title="Clear scratchpad?"
          body="This removes all components, wires, labels, probes, and the current analysis from the scratchpad."
          confirmLabel="Clear scratchpad"
          onConfirm={clearScratchpad}
          onCancel={() => setConfirmClearOpen(false)}
        />
      )}
      {confirmCloseTabId && (
        <ConfirmDialog
          title="Close this scratchpad?"
          body="Save a .tau.json copy first if you need this circuit later. Closing the only open scratchpad starts a new blank circuit."
          confirmLabel="Close scratchpad"
          onConfirm={() => {
            closeTab(confirmCloseTabId, true);
            setConfirmCloseTabId(null);
          }}
          onCancel={() => setConfirmCloseTabId(null)}
        />
      )}
      {confirmLargeRun && (
        <ConfirmDialog
          title="Large transient run"
          body={`This run computes ${confirmLargeRun.steps.toLocaleString()} samples across ${confirmLargeRun.netCount.toLocaleString()} nets and may take a while.`}
          confirmLabel="Run anyway"
          onConfirm={() => {
            const { run } = confirmLargeRun;
            setConfirmLargeRun(null);
            run();
          }}
          onCancel={() => setConfirmLargeRun(null)}
        />
      )}
      {notice && <div className="shell-toast" role="status">{notice}</div>}
    </div>
  );
}

export default App;
