import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent } from "react";
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
import { ModelLibrariesDialog } from "./components/ModelLibrariesDialog";
import { SimulationSetupDialog } from "./components/SimulationSetupDialog";
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
  UnsavedChangesDialog,
} from "./components/ShellPanels";
import { useSchematic, type SchematicDocument, type SchematicHistory } from "./store/useSchematic";
import { useRuntimeModelLibraries } from "./store/useRuntimeModelLibraries";
import { CATALOG } from "./schematic/catalog";
import { dispatchShortcutAction, isEditingAction, resolveShortcut } from "./schematic/shortcuts";
import { extractCircuit } from "./schematic/netlist";
import {
  enforceMinimumTransientSteps,
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
import { resolveEngineResult, withEngine, type EngineProvenance, type SimulationEngine } from "./simulation/engineProvenance";
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
import { assertSimulationIntegrity } from "./simulation/simulationIntegrity";
import {
  cancelNativeSpice,
  isNativeSpiceRuntime,
  MAX_NATIVE_OUTPUT_POINTS,
  runNativeAcSweep,
  runNativeDcSweep,
  runNativeOperatingPoint,
  runNativeNoise,
  runNativeTransferFunction,
  runNativeTransient,
  runNativeSteppedTransient,
  runNativeSteppedAcSweep,
  runNativeSteppedDcSweep,
} from "./engine/nativeSpice";
import { canUseNativeStepPath, stepAnalysisDomain } from "./simulation/nativeStepFamily";
import { useProject } from "./store/useProject";
import { readInstalledLtspiceModel } from "./project/installedLtspiceLibrary";
import {
  ascRewriteRisks,
  ascSaveBlockReason,
  basename,
  isAscFile,
  remapMovedProjectPath,
  serializeSchematicFile,
} from "./project/types";
import { validateSchematicDocument } from "./schematic/documentValidation";
import { importProjectAsc } from "./io/projectAscImport";
import { importDroppedFile } from "./io/fileImport";
import { pathExists, readTextFile } from "./project/fsBridge";
import { isWorkspacePath } from "./project/defaultWorkspace";
import {
  carryAssistantProbes,
  type AssistantApplyCurrentAscAction,
  type AssistantCreateAscAction,
} from "./lib/assistantActions";
import { pickAutoRunAnalysis, type AutoRunAnalysis } from "./lib/assistantAutoRun";
import { technicalErrorDetails, userFacingErrorMessage } from "./lib/errorMessage";

const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = {
  stopTime: 0.006,
  steps: 240,
};

// The temporary browser workspace exists only inside the project store; fsBridge
// helpers reach Tauri plugin-fs for anything that is not `web://`, which throws
// in a plain browser. Route workspace paths to the in-memory files so opening
// an imported .asc (and its hierarchical .asy/.asc probes) never touches IPC.
async function readProjectText(path: string): Promise<string> {
  if (!isWorkspacePath(path)) return readTextFile(path);
  const file = useProject.getState().workspaceFiles[path];
  if (!file) throw new Error("File not found in workspace.");
  return file.contents;
}

async function projectPathExists(path: string): Promise<boolean> {
  if (!isWorkspacePath(path)) return pathExists(path);
  return Object.prototype.hasOwnProperty.call(useProject.getState().workspaceFiles, path);
}

// Pre-run confirmation thresholds (Fix 3 - "may take a while" guard). The
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
  /** A disk-backed document cleared into an editable, unsaved replacement. */
  detached?: boolean;
  dirty?: boolean;
  /** Stable snapshot of the last successful disk write/open. */
  savedSignature?: string;
  /** Reasons an imported ASC cannot be rewritten losslessly by Tau yet. */
  ascRewriteRisks?: string[];
}

const newTabId = () => `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const blankDocument = (): SchematicDocument => ({ components: [], wires: [], probes: [], netLabels: [] });
const emptyHistory = (): SchematicHistory => ({ past: [], future: [] });

export function schematicDocumentSignature(doc: SchematicDocument): string {
  // Internal ids are deliberately regenerated when a document is loaded so
  // two open copies never collide in the live store. They are not authored
  // circuit content and therefore must not make a clean import look edited.
  const componentIds = new Map(doc.components.map((component, index) => [component.id, `component:${index}`]));
  return JSON.stringify({
    components: doc.components.map(({ id: _id, ...component }) => component),
    wires: doc.wires.map(({ id: _id, ...wire }) => wire),
    probes: (doc.probes ?? []).map(({ id: _id, componentId, ...probe }) => ({
      ...probe,
      ...(componentId ? { componentId: componentIds.get(componentId) ?? componentId } : {}),
    })),
    netLabels: (doc.netLabels ?? []).map(({ id: _id, ...label }) => label),
    directives: doc.directives ?? [],
    textAnnotations: doc.textAnnotations ?? [],
    ascShapes: doc.ascShapes ?? [],
    ascDataFlags: doc.ascDataFlags ?? [],
    ascForeignSymbols: doc.ascForeignSymbols ?? [],
    ascHierarchicalBlocks: doc.ascHierarchicalBlocks ?? [],
    ascSheet: doc.ascSheet ?? null,
    userModelLibraries: doc.userModelLibraries ?? [],
  });
}

// responsive floor - App.css's `.editor-shell`/`.plotter` mirror these as
// a CSS backstop. The schematic column must stay usable - tabs, canvas
// overlays, and the results table - down to the app's stated 900px minimum
// window width, so the scope column budgets around it instead of squeezing
// it to nothing.
const RAIL_W = SHELL_LAYOUT.railWidth; // .activity-rail
const HANDLE_W = SHELL_LAYOUT.handleWidth; // .col-resize-handle, one per open column
const SCOPE_MIN = 300; // analysis scope column floor (matches old drag clamp)
// Names the engine on an error result: nothing was returned to attribute, but
// the failure still came from whichever solver the run reached for.
const attemptedEngine = (): SimulationEngine => (isNativeSpiceRuntime() ? "ngspice" : "preview");

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
  const textAnnotations = useSchematic((s) => s.textAnnotations);
  const ascShapes = useSchematic((s) => s.ascShapes);
  const ascDataFlags = useSchematic((s) => s.ascDataFlags);
  const ascForeignSymbols = useSchematic((s) => s.ascForeignSymbols);
  const ascHierarchicalBlocks = useSchematic((s) => s.ascHierarchicalBlocks);
  const ascSheet = useSchematic((s) => s.ascSheet);
  const userModelLibraries = useSchematic((s) => s.userModelLibraries);
  const installedLtspiceModelLibraries = useRuntimeModelLibraries((s) => s.installedLtspice);
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
  // Tau chooses transient resolution automatically (from the
  // circuit's time constants + source frequencies) until the user chooses a
  // duration/detail override; that manual state sticks until explicitly reset.
  const [optionsOverridden, setOptionsOverridden] = useState(false);
  const autoAnalysisOptions = useMemo(() => suggestTransientOptions(components), [components]);
  const authoredAnalysisOptions = useMemo(
    () => analysesFromDirectives(directives).tran,
    [directives],
  );
  // An imported schematic's analysis card is part of the circuit, not merely
  // an editor annotation. Honor it until the user deliberately touches a
  // control; otherwise `adoptDirectiveOptions` updates invisible state while
  // the Run path continues to use auto-resolution (the Colpitts regression).
  const requestedAnalysisOptions = optionsOverridden
    ? analysisOptions
    : authoredAnalysisOptions ?? autoAnalysisOptions;
  const effectiveAnalysisOptions = enforceMinimumTransientSteps(
    components,
    requestedAnalysisOptions,
    isNativeSpiceRuntime() ? MAX_NATIVE_OUTPUT_POINTS - 1 : MAX_TRANSIENT_STEPS,
  );
  const overrideAnalysisOptions = useCallback((next: AnalysisOptions) => {
    setAnalysisOptions(next);
    setOptionsOverridden(true);
  }, []);
  const resetAnalysisOptions = useCallback(() => setOptionsOverridden(false), []);
  const analysisOptionsSource = optionsOverridden
    ? "custom" as const
    : authoredAnalysisOptions
      ? "document" as const
      : "automatic" as const;
  const [analysis, setAnalysis] = useState<(AnalysisResult & EngineProvenance) | null>(null);
  const [opAnalysis, setOpAnalysis] = useState<(OperatingPointResult & EngineProvenance) | null>(null);
  const [acAnalysis, setAcAnalysis] = useState<(AcResult & EngineProvenance) | null>(null);
  const [dcAnalysis, setDcAnalysis] = useState<(DcSweepResult & EngineProvenance) | null>(null);
  const [tfAnalysis, setTfAnalysis] = useState<(TfResult & EngineProvenance) | null>(null);
  const [noiseAnalysis, setNoiseAnalysis] = useState<(NoiseResult & EngineProvenance) | null>(null);
  const [stepFamily, setStepFamily] = useState<(StepFamilyResult & EngineProvenance) | null>(null);
  // `.step` families of the AC/DC analyses: computed alongside the base run
  // whenever the document carries a runnable `.step`, overlaid on their panes.
  const [acStepFamily, setAcStepFamily] = useState<AnalysisFamily<AcResult> | null>(null);
  const [dcStepFamily, setDcStepFamily] = useState<AnalysisFamily<DcSweepResult> | null>(null);
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [lastTransientDurationMs, setLastTransientDurationMs] = useState<number | null>(null);
  // Determinate while the web TS solver is reporting real fractions; null
  // (indeterminate bar) before the first callback and for the whole run when
  // native ngspice ends up handling it (no progress channel - see
  // executeTransient/engine/nativeSpice.ts).
  const [runProgress, setRunProgress] = useState<number | null>(null);
  const [runState, setRunState] = useState<"idle" | "complete" | "error" | "stopped">("idle");
  // Pending confirmation for a transient run large enough to warrant a
  // "this may take a while" pause (Fix 3 pre-run guard) - null when no
  // confirmation is pending. `run` is the deferred action to take if the
  // user picks "Run anyway".
  const [confirmLargeRun, setConfirmLargeRun] = useState<{ steps: number; netCount: number; run: () => void } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mode, setMode] = useState<"schematic" | "simulator">("schematic");
  const modeRef = useRef(mode);
  const [tabs, setTabs] = useState<OpenTab[]>([{ id: "tab-0", title: "untitled.asc", doc: null, history: emptyHistory() }]);
  const tabsRef = useRef(tabs);
  const projectRenameInFlightRef = useRef<Promise<string | null> | null>(null);
  const [activeId, setActiveId] = useState("tab-0");
  /** ASC import warnings keyed by document path (shown in Diagnostics). */
  const [importWarningsByPath, setImportWarningsByPath] = useState<Record<string, string[]>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelLibrariesOpen, setModelLibrariesOpen] = useState(false);
  const [simulationSetupOpen, setSimulationSetupOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [confirmCloseTabId, setConfirmCloseTabId] = useState<string | null>(null);
  const [savingCloseTab, setSavingCloseTab] = useState(false);
  const [graphOpen, setGraphOpen] = useState(true);
  const [componentFocusSignal, setComponentFocusSignal] = useState(0);
  const [partsOpen, setPartsOpen] = useState(true);
  const [fitSignal, setFitSignal] = useState(0);
  const [scopeWidth, setScopeWidth] = useState(440);
  // Closed by default - persists across sessions
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
  const openAssistant = useCallback(() => {
    setAssistantOpen(true);
    saveAssistantOpen(true);
    // Panel mounts asynchronously; give React a frame (or two) to paint.
    window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>(".assistant-textarea")?.focus();
    }, 50);
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
  // Live transient run's abort handle (web TS solver only - see
  // executeTransient). Deliberately NOT tied to analysisRequestRef: aborting
  // must let the in-flight run's own partial result still reach setAnalysis,
  // whereas bumping analysisRequestRef (invalidateAnalysis) is for "a
  // genuinely different run/document superseded this one" and discards
  // whatever comes back.
  const transientAbortRef = useRef<AbortController | null>(null);
  const saveActiveToProjectRef = useRef<(options?: { quietBlocked?: boolean }) => Promise<boolean>>(async () => false);

  // Analysis to auto-start after an assistant-confirmed circuit lands, latched
  // by createAssistantCircuit/applyAssistantCircuit and consumed once by the
  // effect below. A ref (not state): replaceCircuit/loadCircuit update the
  // schematic store synchronously, but this component's own closures
  // (directives, and every run callback that reads them) only refresh on the
  // *next* render - so setting a ref here and reading it from an effect keyed
  // on `directives` lets the auto-run fire against freshly-rendered closures
  // instead of the stale ones captured before the circuit swapped.
  const pendingAutoRunRef = useRef<AutoRunAnalysis | null>(null);

  // Selecting a part opens the Components rail so Properties is immediately usable.
  useEffect(() => {
    if (selectedId && mode === "schematic") setPartsOpen(true);
  }, [selectedId, mode]);

  const writeSim = useProject((s) => s.writeSim);
  const projectRootPath = useProject((s) => s.rootPath);
  const projectRootName = useProject((s) => s.rootName);
  const projectCapability = useProject((s) => s.capability);
  const openProjectFolder = useProject((s) => s.openFolder);
  const createProjectFolder = useProject((s) => s.newProject);
  const createSchematicInRoot = useProject((s) => s.createSchematicInRoot);
  const deleteProjectNode = useProject((s) => s.deleteNode);
  const moveProjectNodeInStore = useProject((s) => s.moveNode);
  const renameProjectNodeInStore = useProject((s) => s.renameNode);

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

  const renameProjectNode = useCallback(async (sourcePath: string, newName: string) => {
    const renamedRoot = await renameProjectNodeInStore(sourcePath, newName);
    if (!renamedRoot) return null;
    const nextTabs = tabsRef.current.map((tab) => {
      if (!tab.filePath) return tab;
      const nextPath = remapMovedProjectPath(tab.filePath, sourcePath, renamedRoot);
      if (nextPath === tab.filePath) return tab;
      return { ...tab, filePath: nextPath, title: basename(nextPath) };
    });
    // Keep the imperative view current before this async callback resolves.
    // A Cmd+S arriving in the same frame must follow the renamed path instead
    // of recreating the old file while React is still scheduling the render.
    tabsRef.current = nextTabs;
    setTabs(nextTabs);
    return renamedRoot;
  }, [renameProjectNodeInStore]);

  const requestProjectRename = useCallback((sourcePath: string, newName: string) => {
    const request = renameProjectNode(sourcePath, newName);
    projectRenameInFlightRef.current = request;
    const clearRequest = () => {
      if (projectRenameInFlightRef.current === request) projectRenameInFlightRef.current = null;
    };
    void request.then(clearRequest, clearRequest);
    return request;
  }, [renameProjectNode]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const documentTitle = (tabs.find((tab) => tab.id === activeId) ?? tabs[0])?.title ?? "untitled.asc";
  const activeFilePath = (tabs.find((tab) => tab.id === activeId) ?? tabs[0])?.filePath ?? null;
  const currentDocument = useMemo<SchematicDocument>(() => ({
    components,
    wires,
    probes,
    netLabels,
    directives,
    textAnnotations,
    ascShapes,
    ascDataFlags,
    ascForeignSymbols,
    ascHierarchicalBlocks,
    ...(ascSheet ? { ascSheet } : {}),
    ...(userModelLibraries.length > 0 ? { userModelLibraries } : {}),
  }), [ascDataFlags, ascForeignSymbols, ascHierarchicalBlocks, ascSheet, ascShapes, components, directives, netLabels, probes, textAnnotations, userModelLibraries, wires]);
  // Native runs take the raw vendor text (LTspice-only cleanup happens in the
  // deck builder); the store keeps names alongside for the attachment UI.
  const userModelLibraryTexts = useMemo(
    () => [...userModelLibraries, ...installedLtspiceModelLibraries].map((library) => library.text),
    [installedLtspiceModelLibraries, userModelLibraries],
  );
  // A `.include` naming one of these resolved at open time, so the deck must
  // not warn that it could not find the file.
  const userModelLibraryNames = useMemo(
    () => [...userModelLibraries, ...installedLtspiceModelLibraries].map((library) => library.name),
    [installedLtspiceModelLibraries, userModelLibraries],
  );
  const currentSignature = useMemo(
    () => schematicDocumentSignature(currentDocument),
    [currentDocument],
  );
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  const activeDirty = Boolean(
    (activeFilePath || activeTab?.detached)
    && activeTab?.savedSignature
    && activeTab.savedSignature !== currentSignature,
  );
  const normalizedRoot = projectRootPath?.replace(/\\/g, "/").replace(/\/+$/, "") ?? null;
  const visibleTabs = tabs
    .filter((tab) => {
      if (!normalizedRoot) return false;
      // A cleared imported file is deliberately detached from its source path
      // until the next Save. Keep only that explicit replacement visible;
      // ordinary pathless starter tabs remain behind the project-open gate.
      if (!tab.filePath) return Boolean(tab.detached);
      const normalizedTabPath = tab.filePath.replace(/\\/g, "/");
      return normalizedTabPath === normalizedRoot || normalizedTabPath.startsWith(`${normalizedRoot}/`);
    })
    .map((tab) => (
      tab.id === activeId ? { ...tab, dirty: activeDirty } : tab
    ));
  const normalizedActivePath = activeFilePath?.replace(/\\/g, "/") ?? null;
  const activeProjectFile = Boolean(
    normalizedRoot
    && (
      (normalizedActivePath
        && (normalizedActivePath === normalizedRoot || normalizedActivePath.startsWith(`${normalizedRoot}/`)))
      || (!normalizedActivePath && activeTab?.detached)
    ),
  );

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

  // Prefer ngspice's own `.meas` printout when the native deck carried those
  // cards and the engine log parsed cleanly (P1.6). Otherwise keep the TS
  // runner against the returned waveform — never invent numbers.
  const measurements = useMemo<MeasResult[]>(() => {
    if (!analysis || !analysis.ok || directives.length === 0) return [];
    if (analysis.nativeMeasurements && analysis.nativeMeasurements.length > 0) {
      return analysis.nativeMeasurements;
    }
    return runMeasurements(directives, analysis, params.scope, params.funcs);
  }, [analysis, directives, params]);

  // Prefer ngspice `.four` tables from the engine log when present (P1.6).
  const fourier = useMemo<FourierResult[]>(() => {
    if (!analysis || !analysis.ok) return [];
    if (analysis.nativeFourier && analysis.nativeFourier.length > 0) {
      return analysis.nativeFourier;
    }
    if (directives.length === 0) return [];
    const { four } = analysesFromDirectives(directives);
    if (!four) return [];
    return runFourier(analysis, four);
  }, [analysis, directives]);

  // Per-component V/I/P telemetry for the simulator's always-visible dock
  // (lifted out of SimulationPanel so it can render alongside the read-only
  // schematic, not just inside the analysis column's Advanced disclosure).
  // Tracks the transient result specifically - it's the only analysis kind
  // with per-timestep node/branch data to derive component readings from.
  const componentRows = useMemo<ComponentMeasurement[]>(
    () => (analysis?.ok ? componentMeasurements(analysis) : []),
    [analysis],
  );

  // Prefer ngspice `.meas ac` printout when present (P1.6).
  const acMeasurements = useMemo<MeasResult[]>(() => {
    if (!acAnalysis || !acAnalysis.ok || directives.length === 0) return [];
    if (acAnalysis.nativeMeasurements && acAnalysis.nativeMeasurements.length > 0) {
      return acAnalysis.nativeMeasurements;
    }
    return runAcMeasurements(directives, acAnalysis, params.scope, params.funcs);
  }, [acAnalysis, directives, params]);

  // Prefer ngspice `.meas dc` printout when present (P1.6).
  const dcMeasurements = useMemo<MeasResult[]>(() => {
    if (!dcAnalysis || !dcAnalysis.ok || directives.length === 0) return [];
    if (dcAnalysis.nativeMeasurements && dcAnalysis.nativeMeasurements.length > 0) {
      return dcAnalysis.nativeMeasurements;
    }
    return runDcMeasurements(directives, dcAnalysis, params.scope, params.funcs);
  }, [dcAnalysis, directives, params]);

  // Evaluate the document's `.meas noise …` directives against the latest noise
  // analysis (`V(onoise)`/`V(inoise)` spectral densities over frequency).
  const noiseMeasurements = useMemo<MeasResult[]>(() => {
    if (!noiseAnalysis || !noiseAnalysis.ok || directives.length === 0) return [];
    return runNoiseMeasurements(directives, noiseAnalysis, params.scope, params.funcs);
  }, [noiseAnalysis, directives, params]);

  const assertCurrentSimulationIntegrity = useCallback(
    () => assertSimulationIntegrity(components, ascForeignSymbols),
    [components, ascForeignSymbols],
  );

  const executeTransient = useCallback(async (options: AnalysisOptions) => {
    const requestId = ++analysisRequestRef.current;
    const startedAt = Date.now();
    setAnalysisRunning(true);
    setLastTransientDurationMs(null);
    setRunProgress(null); // indeterminate until the web solver's first onProgress call (native never gets one)
    const controller = new AbortController();
    transientAbortRef.current = controller;
    let recordedTransientResult = false;
    let lastProgressAt = 0;
    const onProgress = (fraction: number) => {
      // Throttle to ~10/sec (100ms) - the solver yields far more often than
      // a progress bar needs to repaint, and 0/1 always get through so the
      // bar starts and finishes in sync with the actual run.
      const now = Date.now();
      if (fraction > 0 && fraction < 1 && now - lastProgressAt < 100) return;
      lastProgressAt = now;
      setRunProgress(fraction);
    };
    try {
      assertCurrentSimulationIntegrity();
      const nativeResult = await runNativeTransient({ components, wires, netLabels, params, directives, userModelLibraries: userModelLibraryTexts, userModelLibraryNames }, options);
      if (nativeResult) {
        // Stop marks this request stale even if the worker happened to finish
        // during cancellation, so a late native result can never overwrite UI.
        if (analysisRequestRef.current !== requestId || controller.signal.aborted) return;
        recordedTransientResult = true;
        setAnalysis(withEngine(nativeResult, "ngspice"));
        setRunState(nativeResult.ok ? "complete" : "error");
        return;
      }
      const result = await runTransientAnalysis(
        { components, wires, netLabels, params, couplings },
        options,
        { onProgress, signal: controller.signal },
      );
      if (analysisRequestRef.current !== requestId) return;
      recordedTransientResult = true;
      setAnalysis(withEngine(result, "preview"));
      setRunState(result.ok ? "complete" : "error");
      if (controller.signal.aborted) showNotice("Stopped early - showing partial result.");
    } catch (error) {
      if (analysisRequestRef.current !== requestId) return;
      if (controller.signal.aborted && isNativeSpiceRuntime()) {
        showNotice("Simulation stopped.");
        return;
      }
      setAnalysis({
        ok: false,
        title: "ngspice transient",
        message: userFacingErrorMessage(error, "ngspice could not run this transient analysis."),
        details: technicalErrorDetails(error),
        warnings: [],
        engine: attemptedEngine(),
      });
      recordedTransientResult = true;
      setRunState("error");
    } finally {
      if (analysisRequestRef.current === requestId) {
        setLastTransientDurationMs(recordedTransientResult ? Date.now() - startedAt : null);
        setAnalysisRunning(false);
        setRunProgress(null);
      }
      // Only clear the ref if it's still ours - a newer executeTransient call
      // (re-run before this one settled) already installed its own
      // controller, and clearing that out from under it would make
      // stopAnalysis fall back to the non-abortable invalidate path for a
      // run that's actually still abortable.
      if (transientAbortRef.current === controller) transientAbortRef.current = null;
    }
  }, [components, wires, netLabels, params, directives, userModelLibraryTexts, couplings, showNotice, assertCurrentSimulationIntegrity]);

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
    // Saving is attempted first, but simulation operates on the validated
    // in-memory schematic and must not be disabled by an unrelated inability
    // to rewrite cosmetic/unsupported ASC records. The save path already tells
    // the user exactly why persistence failed or was blocked.
    await saveActiveToProjectRef.current({ quietBlocked: true });
    confirmLargeRunIfNeeded(effectiveAnalysisOptions, () => { void executeTransient(effectiveAnalysisOptions); });
  }, [effectiveAnalysisOptions, executeTransient, confirmLargeRunIfNeeded]);

  const runOperatingAnalysis = useCallback(async () => {
    const requestId = ++analysisRequestRef.current;
    setAnalysisRunning(true);
    try {
      assertCurrentSimulationIntegrity();
      const result = resolveEngineResult(
        await runNativeOperatingPoint({ components, wires, netLabels, params, directives, userModelLibraries: userModelLibraryTexts, userModelLibraryNames }),
        () => runOperatingPoint({ components, wires, netLabels, params }, { returnBranches: true }),
      );
      if (analysisRequestRef.current !== requestId) return;
      setOpAnalysis(result);
    } catch (error) {
      if (analysisRequestRef.current !== requestId) return;
      setOpAnalysis({ ok: false, message: userFacingErrorMessage(error, "ngspice could not calculate the operating point."), warnings: [], engine: attemptedEngine() });
    } finally {
      if (analysisRequestRef.current === requestId) setAnalysisRunning(false);
    }
  }, [components, wires, netLabels, params, directives, userModelLibraryTexts, assertCurrentSimulationIntegrity]);

  const runAcAnalysis = useCallback(async () => {
    const requestId = ++analysisRequestRef.current;
    setAnalysisRunning(true);
    try {
      assertCurrentSimulationIntegrity();
      // An imported LTspice .ac directive is the user's analysis definition.
      // Suggest a useful range only when the document does not provide one.
      const acSweep = analysesFromDirectives(directives).ac ?? suggestAcSweep(components);
      const schematic = {
        components,
        wires,
        netLabels,
        params,
        directives,
        userModelLibraries: userModelLibraryTexts,
        userModelLibraryNames,
      };
      const result = resolveEngineResult(
        await runNativeAcSweep(schematic, acSweep),
        () => runAcSweep({ components, wires, netLabels, params, couplings }, acSweep),
      );
      if (analysisRequestRef.current !== requestId) return;
      setAcAnalysis(result);
      // A runnable `.step` also produces a family of Bode curves to overlay.
      // Native single-deck path first (emitNativeStep); TS re-run is exclusive.
      const specs = runnableStepsFromDirectives(directives);
      if (specs.length === 0) {
        setAcStepFamily(null);
      } else if (isNativeSpiceRuntime() && canUseNativeStepPath(specs, { components })) {
        const nativeFamily = await runNativeSteppedAcSweep(schematic, acSweep, specs);
        if (analysisRequestRef.current !== requestId) return;
        setAcStepFamily(
          nativeFamily
            ?? runAcStepFamily(
              specs,
              params,
              { components, wires, netLabels, couplings },
              analysesFromDirectives(directives).ac ?? acSweep,
            ),
        );
      } else {
        setAcStepFamily(
          runAcStepFamily(
            specs,
            params,
            { components, wires, netLabels, couplings },
            analysesFromDirectives(directives).ac ?? acSweep,
          ),
        );
      }
    } catch (error) {
      if (analysisRequestRef.current !== requestId) return;
      setAcAnalysis({ ok: false, message: userFacingErrorMessage(error, "ngspice could not run this AC sweep."), warnings: [], engine: attemptedEngine() });
      setAcStepFamily(null);
    } finally {
      if (analysisRequestRef.current === requestId) setAnalysisRunning(false);
    }
  }, [components, wires, netLabels, params, directives, userModelLibraryTexts, userModelLibraryNames, couplings, assertCurrentSimulationIntegrity]);

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
      assertCurrentSimulationIntegrity();
      const schematic = {
        components,
        wires,
        netLabels,
        params,
        directives,
        userModelLibraries: userModelLibraryTexts,
        userModelLibraryNames,
      };
      // ngspice first: the TS solver has no semiconductor stamps, so it cannot
      // sweep a transistor at all.
      const result = resolveEngineResult(
        await runNativeDcSweep(schematic, dc),
        () => runDcSweep({ components, wires, netLabels, params }, dc),
      );
      if (analysisRequestRef.current !== requestId) return;
      setDcAnalysis(result);
      // A runnable `.step` also produces a family of transfer curves to overlay.
      const specs = runnableStepsFromDirectives(directives);
      if (specs.length === 0) {
        setDcStepFamily(null);
      } else if (isNativeSpiceRuntime() && canUseNativeStepPath(specs, { components })) {
        const nativeFamily = await runNativeSteppedDcSweep(schematic, dc, specs);
        if (analysisRequestRef.current !== requestId) return;
        setDcStepFamily(
          nativeFamily
            ?? runDcStepFamily(specs, params, { components, wires, netLabels }, dc),
        );
      } else {
        setDcStepFamily(runDcStepFamily(specs, params, { components, wires, netLabels }, dc));
      }
    } catch (error) {
      if (analysisRequestRef.current !== requestId) return;
      setDcAnalysis({ ok: false, message: userFacingErrorMessage(error, "Could not run this DC sweep."), warnings: [], engine: attemptedEngine() });
      setDcStepFamily(null);
    } finally {
      if (analysisRequestRef.current === requestId) setAnalysisRunning(false);
    }
  }, [components, wires, netLabels, params, directives, dcSetup, userModelLibraryTexts, userModelLibraryNames, assertCurrentSimulationIntegrity]);

  const runTfAnalysis = useCallback(async () => {
    const requestId = ++analysisRequestRef.current;
    const tf = analysesFromDirectives(directives).tf ?? tfSetup;
    setAnalysisRunning(true);
    try {
      assertCurrentSimulationIntegrity();
      // ngspice first, for the same reason as the DC sweep: the TS solver has
      // no semiconductor stamps, so it cannot take an amplifier's gain at all.
      const result = resolveEngineResult(
        await runNativeTransferFunction(
          { components, wires, netLabels, params, directives, userModelLibraries: userModelLibraryTexts, userModelLibraryNames },
          tf,
        ),
        () => runTransferFunction({ components, wires, netLabels, params }, tf),
      );
      if (analysisRequestRef.current !== requestId) return;
      setTfAnalysis(result);
    } catch (error) {
      if (analysisRequestRef.current !== requestId) return;
      setTfAnalysis({ ok: false, message: userFacingErrorMessage(error, "Could not run this transfer function."), warnings: [], engine: attemptedEngine() });
    } finally {
      if (analysisRequestRef.current === requestId) setAnalysisRunning(false);
    }
  }, [components, wires, netLabels, params, directives, tfSetup, userModelLibraryTexts, userModelLibraryNames, assertCurrentSimulationIntegrity]);

  const runNoiseAnalysis_ = useCallback(async () => {
    const requestId = ++analysisRequestRef.current;
    const noise = analysesFromDirectives(directives).noise ?? noiseSetup;
    setAnalysisRunning(true);
    try {
      assertCurrentSimulationIntegrity();
      // ngspice first: the TS solver has only resistor thermal noise and
      // refuses any circuit with a semiconductor in it, so it cannot report a
      // real amplifier's noise at all.
      const result = resolveEngineResult(
        await runNativeNoise(
          { components, wires, netLabels, params, directives, userModelLibraries: userModelLibraryTexts, userModelLibraryNames },
          noise,
        ),
        () => runNoiseAnalysis({ components, wires, netLabels, params }, noise),
      );
      if (analysisRequestRef.current !== requestId) return;
      setNoiseAnalysis(result);
    } catch (error) {
      if (analysisRequestRef.current !== requestId) return;
      setNoiseAnalysis({ ok: false, message: userFacingErrorMessage(error, "Could not run this noise analysis."), warnings: [], engine: attemptedEngine() });
    } finally {
      if (analysisRequestRef.current === requestId) setAnalysisRunning(false);
    }
  }, [components, wires, netLabels, params, directives, noiseSetup, userModelLibraryTexts, userModelLibraryNames, assertCurrentSimulationIntegrity]);

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
    const domain = stepAnalysisDomain(pickAutoRunAnalysis(directives)?.kind);
    const schematic = {
      components,
      wires,
      netLabels,
      params,
      directives,
      userModelLibraries: userModelLibraryTexts,
      userModelLibraryNames,
    };
    setAnalysisRunning(true);
    try {
      assertCurrentSimulationIntegrity();

      // AC/DC STEP domains: same native single-deck path as TRAN; TS re-run
      // stays exclusive (never emitNativeStep under that loop).
      if (domain === "ac") {
        const acSweep = analysesFromDirectives(directives).ac ?? suggestAcSweep(components);
        if (isNativeSpiceRuntime() && canUseNativeStepPath(specs, { components })) {
          const nativeFamily = await runNativeSteppedAcSweep(schematic, acSweep, specs);
          if (analysisRequestRef.current !== requestId) return;
          if (nativeFamily) {
            setAcStepFamily(nativeFamily);
            setStepFamily({
              ok: nativeFamily.ok,
              message: nativeFamily.message,
              members: [],
              warnings: nativeFamily.warnings,
              engine: nativeFamily.ok ? "ngspice" : attemptedEngine(),
            });
            return;
          }
        }
        const family = runAcStepFamily(
          specs,
          params,
          { components, wires, netLabels, couplings },
          acSweep,
        );
        if (analysisRequestRef.current !== requestId) return;
        setAcStepFamily(family);
        setStepFamily({
          ok: family.ok,
          message: family.message,
          members: [],
          warnings: family.warnings,
          engine: "preview",
        });
        return;
      }

      if (domain === "dc") {
        const dc = analysesFromDirectives(directives).dc ?? dcSetup;
        if (isNativeSpiceRuntime() && canUseNativeStepPath(specs, { components })) {
          const nativeFamily = await runNativeSteppedDcSweep(schematic, dc, specs);
          if (analysisRequestRef.current !== requestId) return;
          if (nativeFamily) {
            setDcStepFamily(nativeFamily);
            setStepFamily({
              ok: nativeFamily.ok,
              message: nativeFamily.message,
              members: [],
              warnings: nativeFamily.warnings,
              engine: nativeFamily.ok ? "ngspice" : attemptedEngine(),
            });
            return;
          }
        }
        const family = runDcStepFamily(specs, params, { components, wires, netLabels }, dc);
        if (analysisRequestRef.current !== requestId) return;
        setDcStepFamily(family);
        setStepFamily({
          ok: family.ok,
          message: family.message,
          members: [],
          warnings: family.warnings,
          engine: "preview",
        });
        return;
      }

      let contexts;
      try {
        contexts = nestedStepContexts(specs, params, components);
      } catch (error) {
        setStepFamily({ ok: false, message: userFacingErrorMessage(error, "Could not expand this .step."), members: [], warnings: [] });
        return;
      }
      // P1.6 native single-deck `.step` (source + param + temp): one emit,
      // multi-plot consume. Mutually exclusive with the TS re-run loop below —
      // that path never passes emitNativeStep, so decks stay step-free.
      // Unsupported param brace shapes fall through to the TS path.
      if (isNativeSpiceRuntime() && canUseNativeStepPath(specs, { components })) {
        const nativeFamily = await runNativeSteppedTransient(
          schematic,
          effectiveAnalysisOptions,
          specs,
        );
        if (analysisRequestRef.current !== requestId) return;
        if (nativeFamily) {
          setStepFamily({
            ...nativeFamily,
            engine: nativeFamily.ok ? "ngspice" : attemptedEngine(),
          });
          return;
        }
      }

      const members: StepFamilyMember[] = [];
      // A family only carries a badge when every member came from the same
      // solver; a mixed family is not attributable to one engine.
      let familyEngine: SimulationEngine | undefined;
      for (const ctx of contexts) {
        // A temp sweep forwards its temperature to native ngspice as `.temp` so
        // its device models shift too (the TS solver already saw the rescaled
        // resistors via applyTemperature). Never forward the document's `.step`
        // cards here — that would double-step under this re-run loop.
        const stepDirectives = ctx.temperature !== undefined ? [`.temp ${ctx.temperature}`] : undefined;
        const native = await runNativeTransient({ components: ctx.components, wires, netLabels, params: ctx.params, directives: stepDirectives, userModelLibraries: userModelLibraryTexts, userModelLibraryNames }, effectiveAnalysisOptions);
        const result = native
          ? withEngine(native, "ngspice")
          : withEngine(await runTransientAnalysis({ components: ctx.components, wires, netLabels, params: ctx.params }, effectiveAnalysisOptions), "preview");
        if (analysisRequestRef.current !== requestId) return;
        const memberEngine: SimulationEngine = native ? "ngspice" : "preview";
        familyEngine = members.length === 0 ? memberEngine : familyEngine === memberEngine ? familyEngine : undefined;
        const memberMeasurements = result.ok
          ? runMeasurements(directives, result, ctx.params.scope, ctx.params.funcs)
          : [];
        members.push({ label: ctx.label, value: ctx.value, result, measurements: memberMeasurements });
      }
      const warnings = members.find((m) => m.result.ok)?.result.warnings ?? [];
      setStepFamily({ ok: members.some((m) => m.result.ok), spec: specs[0], members, warnings, engine: familyEngine });
    } catch (error) {
      if (analysisRequestRef.current !== requestId) return;
      setStepFamily({ ok: false, message: userFacingErrorMessage(error, "Could not run this .step sweep."), members: [], warnings: [], engine: attemptedEngine() });
    } finally {
      if (analysisRequestRef.current === requestId) setAnalysisRunning(false);
    }
  }, [components, wires, netLabels, params, directives, userModelLibraryTexts, userModelLibraryNames, effectiveAnalysisOptions, stepSetupUi, dcSetup, couplings, assertCurrentSimulationIntegrity]);

  const preferredAnalysis = useMemo(
    () => pickAutoRunAnalysis(directives)?.kind ?? "tran",
    [directives],
  );
  const stepDomain = useMemo(
    () => stepAnalysisDomain(pickAutoRunAnalysis(directives)?.kind),
    [directives],
  );

  // The global Run command follows the first authored analysis directive, as
  // LTspice users expect. Selecting a mode tab remains an explicit request to
  // run that particular mode.
  const runAndShowSimulator = useCallback(async () => {
    await saveActiveToProjectRef.current({ quietBlocked: true });
    setMode("simulator");
    setGraphOpen(true);
    if (preferredAnalysis === "op") void runOperatingAnalysis();
    else if (preferredAnalysis === "ac") void runAcAnalysis();
    else if (preferredAnalysis === "dc") void runDcAnalysis();
    else if (preferredAnalysis === "tf") void runTfAnalysis();
    else if (preferredAnalysis === "noise") void runNoiseAnalysis_();
    else {
      confirmLargeRunIfNeeded(effectiveAnalysisOptions, () => {
        void executeTransient(effectiveAnalysisOptions);
      });
    }
  }, [
    preferredAnalysis,
    runOperatingAnalysis,
    runAcAnalysis,
    runDcAnalysis,
    runTfAnalysis,
    runNoiseAnalysis_,
    confirmLargeRunIfNeeded,
    effectiveAnalysisOptions,
    executeTransient,
  ]);

  const stopAnalysis = useCallback(() => {
    // transientAbortRef is non-null ONLY while executeTransient's own run is
    // in flight (set at its start, cleared in its finally). The browser solver
    // cooperatively returns a partial result; native uses the same signal to
    // invalidate late results and also terminates its isolated worker.
    if (analysisRunning && transientAbortRef.current) {
      // Do not go through invalidateAnalysis: the browser solver is about to
      // return a useful partial result. Native sees `aborted`, discards any
      // result that crossed the cancellation boundary, and stops the worker.
      transientAbortRef.current.abort();
      if (isNativeSpiceRuntime()) void cancelNativeSpice();
      return;
    }
    if (!analysis && !analysisRunning) {
      showNotice("No simulation result to stop.");
      return;
    }
    if (analysisRunning && isNativeSpiceRuntime()) void cancelNativeSpice();
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
            doc: {
              components,
              wires,
              probes,
              netLabels,
              directives,
              textAnnotations,
              ascShapes,
              ascDataFlags,
              ascForeignSymbols,
              ascHierarchicalBlocks,
              ...(ascSheet ? { ascSheet } : {}),
            },
            history: { past, future },
            dirty: Boolean(tab.savedSignature && tab.savedSignature !== schematicDocumentSignature({
              components,
              wires,
              probes,
              netLabels,
              directives,
              textAnnotations,
              ascShapes,
              ascDataFlags,
              ascForeignSymbols,
              ascHierarchicalBlocks,
              ...(ascSheet ? { ascSheet } : {}),
            })),
          }
        : tab)),
    [activeId, ascDataFlags, ascForeignSymbols, ascHierarchicalBlocks, ascSheet, ascShapes, components, wires, probes, netLabels, directives, textAnnotations, past, future],
  );

  // Adopt an imported circuit's own `.tran` settings (stop time / sample count)
  // so it simulates as authored instead of with the editor's default window.
  const adoptDirectiveOptions = useCallback((doc: SchematicDocument) => {
    const { tran } = analysesFromDirectives(doc.directives ?? []);
    if (tran) setAnalysisOptions(tran);
    setOptionsOverridden(false);
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
              savedSignature: schematicDocumentSignature(doc),
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
          savedSignature: schematicDocumentSignature(doc),
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
          savedSignature: schematicDocumentSignature(doc),
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
      showNotice(userFacingErrorMessage(error, "Could not open .sim file."));
    }
  }, [openDocument, showNotice]);

  const openAscFromProject = useCallback(async (
    path: string,
    title: string,
    text: string,
    // Conversion-time warnings from a non-native import (a SPICE or KiCad
    // netlist Tau converted into this .asc) - see `io/fileImport.ts`. Empty
    // for a genuine .asc, whose own warnings come entirely from `result` below.
    extraWarnings: string[] = [],
  ) => {
    try {
      const result = await importProjectAsc(text, {
        sourcePath: path,
        rootPath: useProject.getState().rootPath,
        readText: readProjectText,
        pathExists: projectPathExists,
        readInstalledLtspiceText: async (id) => (await readInstalledLtspiceModel(id)).text,
      });
      // Duplicate reference designators only failed later, at deck build,
      // far from the cause. Flag them at open time instead.
      const labelCounts = new Map<string, number>();
      for (const component of result.components) {
        const label = component.label?.trim().toLowerCase();
        if (label) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
      }
      const duplicateWarnings = [...labelCounts.entries()]
        .filter(([, count]) => count > 1)
        .map(([label, count]) => `Component name "${label.toUpperCase()}" is used ${count} times; simulation requires unique names.`);
      // Surface import warnings in the Diagnostics panel for THIS document.
      // The toast only carries a count, which is a dead end on its own.
      const allWarnings = [...extraWarnings, ...result.warnings, ...duplicateWarnings];
      setImportWarningsByPath((previous) => ({ ...previous, [path]: allWarnings }));
      // Belt-and-braces: the importer's own count gate stops a hostile file
      // before it does quadratic pin-geometry work, but every document that
      // reaches the store - .asc included - must still clear the exact same
      // bounds (component/wire/coordinate/text caps) the .sim loader enforces
      // above. Any failure here surfaces through the catch below, same as a
      // rejected .sim file.
      const doc: SchematicDocument = validateSchematicDocument({
        components: result.components,
        wires: result.wires,
        netLabels: result.netLabels,
        directives: result.directives,
        textAnnotations: result.textAnnotations,
        ascShapes: result.shapes,
        ascDataFlags: result.dataFlags,
        ascForeignSymbols: result.foreignSymbols,
        ascHierarchicalBlocks: result.hierarchicalBlocks,
        ascSheet: result.sheet,
        probes: [],
        // Vendor models a `.include`/`.lib` named and the importer found beside
        // the schematic. Surfaced in the Model Libraries dialog, whose header
        // count is the user's confirmation that the file was picked up.
        ...(result.modelLibraries.length > 0 ? { userModelLibraries: result.modelLibraries } : {}),
      });
      // The resolver-aware carried set, not one re-derived from `text`: see
      // ascRewriteRisks for why a locally derived set unblocks a lossy save.
      openDocument(doc, title, path, ascRewriteRisks(text, result.foreignSymbols, result.hierarchicalBlocks));
      if (allWarnings.length > 0) {
        // Diagnostics already lists import warnings for this document — skip a
        // second toast that nags "See Diagnostics" after every imperfect ASC.
        console.warn(`Imported ${title} with ${allWarnings.length} warning(s):`, allWarnings);
      }
    } catch (error) {
      showNotice(userFacingErrorMessage(error, "Could not import .asc file."));
    }
  }, [openDocument, showNotice]);

  // Single handler behind every "get a file into Tau" surface that isn't the
  // Explorer header's own input (which calls `io/fileImport.ts` directly) -
  // drag-and-drop onto the editor. Format detection, conversion, and
  // persistence all live in `io/fileImport.ts`; this only decides how to put
  // the result on screen, exactly like `openAscFromProject` above.
  const handleDroppedFile = useCallback(async (file: File) => {
    const outcome = await importDroppedFile(file, { hasActiveSchematic: activeProjectFile });
    if (outcome.kind === "error") {
      showNotice(outcome.message);
      return;
    }
    if (outcome.kind === "model-library") {
      showNotice(`Attached ${outcome.name}`);
      return;
    }
    showNotice(`Imported ${basename(outcome.path)}`);
    await openAscFromProject(outcome.path, basename(outcome.path), outcome.text, outcome.warnings);
  }, [activeProjectFile, openAscFromProject, showNotice]);

  // Drag state for the editor's drop zone (`importDragDepthRef` counts nested
  // dragenter/dragleave pairs - a child element firing dragleave before the
  // parent must not hide the overlay early). Scoped to a real OS file drag
  // only (`types` includes "Files"); this shares no code path with the
  // Explorer tree's own node-reordering drag-and-drop.
  const importDragDepthRef = useRef(0);
  const [importDragActive, setImportDragActive] = useState(false);
  const isFileDrag = (event: DragEvent<HTMLElement>) =>
    Array.from(event.dataTransfer?.types ?? []).includes("Files");
  const handleImportDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    importDragDepthRef.current += 1;
    setImportDragActive(true);
  }, []);
  const handleImportDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);
  const handleImportDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    importDragDepthRef.current = Math.max(0, importDragDepthRef.current - 1);
    if (importDragDepthRef.current === 0) setImportDragActive(false);
  }, []);
  const handleImportDrop = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    importDragDepthRef.current = 0;
    setImportDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    if (event.dataTransfer.files.length > 1) showNotice("Dropped one file to import; the rest were ignored.");
    void handleDroppedFile(file);
  }, [handleDroppedFile, showNotice]);
  const importDropZoneProps = {
    onDragEnter: handleImportDragEnter,
    onDragOver: handleImportDragOver,
    onDragLeave: handleImportDragLeave,
    onDrop: handleImportDrop,
  };

  const createAssistantCircuit = useCallback(async (action: AssistantCreateAscAction) => {
    // Latched before any await/branch below so the auto-run effect (keyed on
    // the schematic store's directives) still fires whether this circuit ends
    // up disk-backed or as a pathless scratchpad.
    pendingAutoRunRef.current = pickAutoRunAnalysis(action.document.directives ?? []);
    if (!useProject.getState().rootPath) {
      throw new Error("Open or create a project folder before Bode creates a schematic.");
    }
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
    // Open the Tau-native document (wires meet symbol pins). The ASC on disk
    // remains the durable interchange file; re-importing it here would attach
    // LTspice pin overrides and visually detach wires from Tau glyphs.
    openDocument(
      action.document,
      basename(path),
      path,
      ascRewriteRisks(action.source, action.document.ascForeignSymbols, action.document.ascHierarchicalBlocks),
    );
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
            ascRewriteRisks: ascRewriteRisks(action.source, action.document.ascForeignSymbols, action.document.ascHierarchicalBlocks),
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
  // (not the confirm handlers themselves) so it fires once the store - and
  // every callback that closes over it - has actually caught up with the
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

  const saveTabToProject = useCallback(async (
    targetId: string,
    options?: { quietBlocked?: boolean },
  ) => {
    // Tab rename persists through the native filesystem bridge. Serialize saves
    // behind that operation so rapid Enter -> Cmd+S cannot target a stale path.
    await projectRenameInFlightRef.current;
    const tab = tabsRef.current.find((t) => t.id === targetId);
    if (!tab) return false;
    const document = targetId === activeId ? currentDocument : tab.doc ?? blankDocument();
    let filePath = tab.filePath ?? null;
    // Running a freshly opened LTspice schematic must be a read-only operation.
    // The previous unconditional best-effort save normalized the source even
    // when the user had made no edit (record order, micro glyphs, and vendor
    // attributes could all change merely by pressing Run). Compare the live
    // semantic signature instead of trusting the asynchronously-derived dirty
    // badge so a clean, already-backed tab never touches disk.
    if (filePath && tab.savedSignature === schematicDocumentSignature(document)) return true;
    let createdForSave = false;
    if (!filePath) {
      filePath = await createSchematicInRoot(tab.title);
      if (!filePath) {
        showNotice(useProject.getState().error ?? "Open a Schematics folder before saving.");
        return false;
      }
      createdForSave = true;
    }
    const savePath = filePath;
    try {
      const serialized = serializeSchematicFile(savePath, document);
      const blockReason = isAscFile(savePath)
        ? ascSaveBlockReason(tab.ascRewriteRisks ?? [], document.probes?.length ?? 0, serialized.warnings)
        : null;
      if (blockReason) {
        if (createdForSave) await deleteProjectNode(savePath);
        console.warn(`Blocked lossy save for ${basename(savePath)}: ${blockReason}`);
        // Run uses the validated in-memory document. A cosmetic ASC rewrite
        // limitation must not interrupt it with a persistence toast; Cmd+S
        // remains explicit and continues to explain why it was protected.
        if (!options?.quietBlocked) showNotice(`Save blocked: ${blockReason}`);
        return false;
      }
      await writeSim(savePath, serialized.contents);
      setTabs((list) => list.map((t) => (
        t.id === targetId
          ? {
              ...t,
              title: basename(savePath),
              filePath: savePath,
              detached: false,
              dirty: false,
              doc: document,
              savedSignature: schematicDocumentSignature(document),
            }
          : t
      )));
      if (serialized.warnings.length > 0) {
        console.warn(`Saved ${basename(savePath)} with export warnings:`, serialized.warnings);
        showNotice(`Saved with ${serialized.warnings.length} export ${serialized.warnings.length === 1 ? "warning" : "warnings"}.`);
      } else {
        showNotice(`${createdForSave ? "Created" : "Saved"} ${basename(savePath)}`);
      }
      return true;
    } catch (error) {
      if (createdForSave) await deleteProjectNode(savePath);
      showNotice(userFacingErrorMessage(error, "Save failed."));
      return false;
    }
  }, [activeId, createSchematicInRoot, currentDocument, deleteProjectNode, showNotice, writeSim]);

  const saveActiveToProject = useCallback(
    (options?: { quietBlocked?: boolean }) => saveTabToProject(activeId, options),
    [activeId, saveTabToProject],
  );
  saveActiveToProjectRef.current = saveActiveToProject;

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
    if (closing.dirty && !confirmed) {
      setConfirmCloseTabId(id);
      return;
    }
    const remaining = snap.filter((tab) => tab.id !== id);
    if (remaining.length === 0) {
      const blank: OpenTab = { id: newTabId(), title: "untitled.asc", doc: blankDocument(), history: emptyHistory() };
      setTabs([blank]);
      setActiveId(blank.id);
      // Replace both the document and its history explicitly. This is the
      // same atomic path used when switching tabs and prevents the just-closed
      // circuit from remaining in the store behind the project-start view.
      restoreCircuit(blank.doc ?? blankDocument(), blank.history);
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
  }, [tabs, activeId, snapshotActive, restoreCircuit, invalidateAnalysis]);

  const clearScratchpad = useCallback(() => {
    newCircuit();
    setTabs((prev) => prev.map((tab) => (
      tab.id === activeId
        ? {
            ...tab,
            // Clearing a disk-backed import starts a new document. Keeping the
            // old path/risk list made a hand-built replacement inherit stale
            // directives and then refuse Save because of records belonging to
            // the original file. Detaching also protects that source file from
            // an accidental empty overwrite.
            title: tab.filePath ? "untitled.asc" : tab.title,
            filePath: null,
            detached: Boolean(tab.filePath) || tab.detached,
            dirty: false,
            savedSignature: schematicDocumentSignature(blankDocument()),
            ascRewriteRisks: [],
            doc: blankDocument(),
            history: emptyHistory(),
          }
        : tab
    )));
    invalidateAnalysis();
    setMode("schematic");
    setConfirmClearOpen(false);
    setGraphOpen(true);
    showNotice("Schematic cleared.");
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
        if (mode === "simulator" && isEditingAction(action)) {
          showNotice("Simulator is view only. Return to Schematic to edit.");
          return;
        }
        // Simulator view is read-only (pan/zoom/probe only - see Canvas's
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
  }, [mode, startPlacing, startWiring, startLabeling, cancel, rotate, mirror, copySelected, paste, duplicateSelected, deleteSelected, undo, redo, saveActiveToProject, showNotice]);

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

  // responsive floor: whenever the window narrows (or the scope opens/
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
        title={activeDirty ? `${documentTitle} •` : (activeProjectFile ? documentTitle : (projectRootName ?? "Open a project"))}
        onModeChange={(nextMode) => {
          if (nextMode === "simulator" && !activeProjectFile) {
            showNotice("Open or create a schematic before using the simulator.");
            return;
          }
          setMode(nextMode);
          if (nextMode === "simulator") setFitSignal((value) => value + 1);
        }}
        onRun={activeProjectFile ? runAndShowSimulator : () => showNotice("Open or create a schematic before running a simulation.")}
        assistantOpen={assistantOpen}
        projectOpen={Boolean(projectRootPath)}
        schematicOpen={activeProjectFile}
        onToggleAssistant={() => {
          if (!projectRootPath) {
            showNotice("Open or create a project folder before using Bode.");
            return;
          }
          toggleAssistant();
        }}
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
          projectOpen={Boolean(projectRootPath)}
          schematicOpen={activeProjectFile}
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
            onRenameNode={requestProjectRename}
            maxWidth={explorerResponsiveMax}
          />
        )}
        {mode === "schematic" && !activeProjectFile && (
          <section
            className="editor-shell"
            aria-label="Project start"
            style={{ position: "relative" }}
            {...importDropZoneProps}
          >
            <main className="stage">
              <EmptyState
                projectOpen={Boolean(projectRootPath)}
                canCreateProject={projectCapability === "tauri"}
                onOpenFolder={() => void openProjectFolder()}
                onCreateProject={() => void createProjectFolder("Schematics")}
                onNewCircuit={() => void startNewCircuit()}
                onAskBode={openAssistant}
                onOpenAscText={openAscFromProject}
                onNotice={showNotice}
              />
            </main>
            <ImportDropOverlay active={importDragActive} />
          </section>
        )}
        {mode === "schematic" && activeProjectFile && (
        <section
          className="editor-shell"
          aria-label="Schematic editor"
          style={{ position: "relative" }}
          {...importDropZoneProps}
        >
          <EditorToolbar
            mode={mode}
            isRunning={analysisRunning}
            onRun={runAndShowSimulator}
            onStop={stopAnalysis}
            onClearScratchpad={() => setConfirmClearOpen(true)}
            modelLibraryCount={userModelLibraries.length}
            onOpenModelLibraries={() => setModelLibrariesOpen(true)}
            onOpenSimulationSetup={() => setSimulationSetupOpen(true)}
          />
          <EditorTabs
            tabs={visibleTabs}
            activeId={activeId}
            mode={mode}
            onSelectTab={switchTab}
            onCloseTab={closeTab}
            onRenameTab={(id, name) => {
              const tab = tabs.find((candidate) => candidate.id === id);
              if (tab?.filePath) void requestProjectRename(tab.filePath, name);
            }}
            onNewCircuit={startNewCircuit}
            onHideSimulator={() => setMode("schematic")}
          />
          <main className="stage">
            <Canvas op={opAnalysis} tran={analysis} interactive fitSignal={fitSignal} />
            {components.length === 0 && wires.length === 0 && toolMode === "select" && (
              <EmptyState
                projectOpen
                onNewCircuit={() => void startNewCircuit()}
                onAskBode={openAssistant}
              />
            )}
          </main>
          <BottomPanel
            result={analysis}
            isRunning={analysisRunning}
            notices={activeFilePath ? importWarningsByPath[activeFilePath] ?? [] : []}
          />
          <ImportDropOverlay active={importDragActive} />
        </section>
        )}
        {mode === "simulator" && activeProjectFile && graphOpen && (
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
                    title="Plot wire voltage or component current"
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
                <Canvas op={opAnalysis} tran={analysis} interactive={false} fitSignal={fitSignal} />
              </div>
              <TelemetryDock rows={componentRows} selectedId={selectedId} onSelect={select} />
            </section>
            <AnalysisErrorBoundary>
              <SimulationPanel
                circuitTitle={documentTitle}
                preferredMode={preferredAnalysis}
                result={analysis}
                opResult={opAnalysis}
                acResult={acAnalysis}
                dcResult={dcAnalysis}
                tfResult={tfAnalysis}
                noiseResult={noiseAnalysis}
                stepResult={stepFamily}
                stepDomain={stepDomain}
                acStepFamily={acStepFamily}
                dcStepFamily={dcStepFamily}
                measurements={measurements}
                fourier={fourier}
                acMeasurements={acMeasurements}
                dcMeasurements={dcMeasurements}
                noiseMeasurements={noiseMeasurements}
                options={effectiveAnalysisOptions}
                optionsAuto={!optionsOverridden}
                optionsSource={analysisOptionsSource}
                resetOptionsTarget={authoredAnalysisOptions ? "document" : "automatic"}
                lastRunDurationMs={lastTransientDurationMs}
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
        {mode === "simulator" && activeProjectFile && !graphOpen && (
          <MinimizedPanelDock
            graphHidden={!graphOpen}
            onRestoreGraph={() => setGraphOpen(true)}
          />
        )}
        {componentsColumnOpen && activeProjectFile && (
          <ComponentsRail
            focusSignal={componentFocusSignal}
            onNotice={showNotice}
            onOpenModelLibraries={() => setModelLibrariesOpen(true)}
            resize={componentsRailResize}
            maxWidth={componentsRailResponsiveMax}
          />
        )}
        {projectRootPath && assistantOpen && (
          <AssistantPanel
            memoryKey={projectRootPath}
            legacyMemoryKey={activeFilePath ?? documentTitle}
            components={components}
            wires={wires}
            netLabels={netLabels}
            probes={probes}
            directives={directives}
            params={params}
            analysis={analysis}
            opResult={opAnalysis}
            acResult={acAnalysis}
            dcResult={dcAnalysis}
            fourier={fourier}
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
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenModelLibraries={() => setModelLibrariesOpen(true)}
      />
      <ModelLibrariesDialog open={modelLibrariesOpen} onOpenChange={setModelLibrariesOpen} />
      <SimulationSetupDialog open={simulationSetupOpen} onOpenChange={setSimulationSetupOpen} />
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
          title="Clear schematic?"
          body="This starts a new untitled schematic and leaves the original file unchanged. Components, wires, labels, directives, probes, and the current analysis are cleared."
          confirmLabel="Clear schematic"
          onConfirm={clearScratchpad}
          onCancel={() => setConfirmClearOpen(false)}
        />
      )}
      {confirmCloseTabId && (
        <UnsavedChangesDialog
          title={tabs.find((tab) => tab.id === confirmCloseTabId)?.title ?? "schematic"}
          saving={savingCloseTab}
          onSave={() => {
            setSavingCloseTab(true);
            void saveTabToProject(confirmCloseTabId).then((saved) => {
              if (!saved) return;
              closeTab(confirmCloseTabId, true);
              setConfirmCloseTabId(null);
            }).finally(() => setSavingCloseTab(false));
          }}
          onDiscard={() => {
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

/**
 * Visible drop-target state for the editor's file import zone. Every color is
 * an existing `App.css` token referenced via `var()` - this component adds no
 * stylesheet rules of its own, so it stays correct in both themes for free.
 */
function ImportDropOverlay({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: "var(--sp-2)",
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        background: "var(--accent-soft)",
        border: "2px dashed var(--accent-line)",
        borderRadius: "var(--r-lg)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--sp-1)" }}>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-heading)", fontWeight: 600, color: "var(--text)" }}>
          Drop to import
        </span>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body)", color: "var(--muted)" }}>
          Schematic, SPICE netlist, or model library
        </span>
      </div>
    </div>
  );
}

export default App;
