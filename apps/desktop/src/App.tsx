import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent } from "react";
import { Crosshair, Eye, EyeOff, Gauge, LockKeyhole, MousePointer2, Tag } from "lucide-react";
import "./App.css";
import "./styles/liveControls.css";
import { Toolbar } from "./components/Toolbar";
import { Canvas } from "./components/Canvas";
import { StatusBar } from "./components/StatusBar";
import { ComponentMeasurementsPanel } from "./components/ComponentMeasurementsPanel";
import { formatEngineering } from "./simulation/quantity";
import { ASSISTANT_PANEL_WIDTH, loadAssistantOpen, saveAssistantOpen } from "./components/assistantPanelState";
import { usePanelWidth } from "./components/ui/resizable";
import { Toaster, toast } from "./components/ui/sonner";
import { Sheet, SheetContent, SheetTitle } from "./components/ui/sheet";
import { canFitIndependentColumns, resolveChrome } from "./chrome/resolveChrome";
import { SURFACES } from "./chrome/surfaces";
import { AnalysisErrorBoundary } from "./components/AnalysisErrorBoundary";
import { EmptyState } from "./components/EmptyState";
import { LocalAiSetupDialog } from "./components/LocalAiSetupDialog";
import { UnsavedRecoveryDialog } from "./components/UnsavedRecoveryDialog";
import {
  ExternalEditConflictDialog,
  type PendingExternalEdit,
} from "./components/ExternalEditConflictDialog";
import { LearningPathCoach } from "./components/LearningPathCoach";
import { CommandPalette } from "./components/CommandPalette";
import {
  clearAllUnsavedLocalState,
  clearUnsavedRecovery,
  documentHasRecoverableContent,
  peekUnsavedRecoveryOffer,
  saveUnsavedRecovery,
  type UnsavedRecoverySnapshot,
} from "./lib/unsavedRecovery";
import {
  classifyExternalEdit,
  diskContentFingerprint,
} from "./lib/externalEditConflict";
import {
  contextualHelpFor,
  dismissLearningPath,
  firstSuccessExampleDocument,
  firstSuccessExampleMeta,
  loadLearningPathState,
  recordLearningPathSimulationOutcome,
  shouldOfferLearningPath,
  shouldShowLearningPathCoach,
  startLearningPath,
  type LearningPathState,
  type LearningPathUiContext,
} from "./lib/learningPath";
import { schematicToAsc } from "./io/ascExport";
import {
  COMPONENTS_RAIL_WIDTH,
  ComponentsRail,
  EditorTabs,
  EditorToolbar,
  ExplorerPanel,
  ComponentInspector,
  WireInspector,
} from "./components/ShellPanels";
import { ActivityRail } from "./components/shell/NavRail";
import { BottomPanel } from "./components/drawer/DiagnosticsTab";
import { ResultsDrawer } from "./components/drawer/ResultsDrawer";
import { SelectionInspector } from "./components/inspector/SelectionInspector";
import { ConfirmDialog, UnsavedChangesDialog } from "./components/ui/confirm";
import { useSchematic, type SchematicDocument, type SchematicHistory } from "./store/useSchematic";
import { useRuntimeModelLibraries } from "./store/useRuntimeModelLibraries";
import { CATALOG } from "./schematic/catalog";
import { dispatchShortcutAction, isEditingAction, resolveShortcut } from "./schematic/shortcuts";
import { extractCircuit } from "./schematic/netlist";
import {
  enforceMinimumTransientSteps,
  MAX_TRANSIENT_STEPS,
  type AnalysisOptions,
  type AnalysisResult,
} from "./simulation/linearTransient";
// The preview transient solve goes through the worker pool rather than being
// called directly: same signature, same progress stream, same abort semantics,
// but the arithmetic no longer runs on the thread that has to paint it. The
// pool falls back to an inline call wherever workers do not exist.
import { prewarmSolverPool, runTransientAnalysisOffThread } from "./simulation/solverPool";
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
  isSimFile,
  remapMovedProjectPath,
  serializeSchematicFile,
} from "./project/types";
import { isInteractiveSchematic, liveControlHint, liveControls } from "./schematic/liveControls";
import { retiredKindNotices, validateSchematicDocument } from "./schematic/documentValidation";
import { strandedTerminalNotices } from "./schematic/relocatedPins";
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
import { useSimulationPreferences } from "./lib/simulationPreferences";
import { SHELL, inspectorName } from "./components/shellContract";

/**
 * Settings is a whole second surface — seven pages, a provider catalog, usage
 * accounting — and none of it is on the path to a schematic first painting, so
 * it is fetched the first time somebody actually opens it rather than parsed
 * at launch.
 *
 * Its Suspense boundary deliberately sits OUTSIDE `SheetContent`: while the
 * chunk is in flight there must be no half-built modal in the accessibility
 * tree, only nothing, so that "a dialog named Settings exists" and "its pages
 * are in it" stay the single observable event they have always been. The
 * `Sheet` root above the boundary stays mounted either way, which is what
 * preserves the close transition and the `onCloseAutoFocus` focus return.
 */
const SettingsWindow = lazy(async () => ({
  default: (await import("./settings/SettingsWindow")).SettingsWindow,
}));

/** Bode is only useful after a project is open and the user summons it. */
const AssistantPanel = lazy(async () => ({
  default: (await import("./components/AssistantPanel")).AssistantPanel,
}));

/** Waveform controls only exist in Simulator, after a circuit is open. */
const SimulationPanel = lazy(async () => ({
  default: (await import("./components/SimulationPanel")).SimulationPanel,
}));

/**
 * Same treatment for the two modal editors below Settings. They need one extra
 * thing Settings did not: `React.lazy` fetches when its element is first
 * *rendered*, and both of these are rendered on every frame of the schematic —
 * closed, drawing nothing, but rendered — so simply making them lazy would
 * fetch both chunks during first paint and buy nothing at all. This latch
 * withholds the element until the dialog is first asked for, and then never
 * lets go: after that first open they are mounted for the rest of the session
 * exactly as they always were, so the Radix close transition and the form state
 * a user leaves behind between visits both behave identically.
 */
function useMountedOnceOpened(open: boolean): boolean {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  return mounted;
}

const ModelLibrariesDialog = lazy(async () => ({
  default: (await import("./components/ModelLibrariesDialog")).ModelLibrariesDialog,
}));

const SimulationSetupDialog = lazy(async () => ({
  default: (await import("./components/SimulationSetupDialog")).SimulationSetupDialog,
}));

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

/**
 * The preview solver is the product path in a browser, where paying its worker
 * startup before the first Run keeps the interaction responsive. A packaged
 * Tau app uses ngspice first, so it leaves that worker unspawned until a
 * genuine fallback needs it.
 */
export function prewarmPreviewSolverForRuntime(
  nativeNgspiceRuntime: boolean,
  prewarm: () => void = prewarmSolverPool,
): void {
  if (!nativeNgspiceRuntime) prewarm();
}

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
  /** Fingerprint of on-disk bytes at last open/save (or Keep-mine acknowledge). */
  diskFingerprint?: string;
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
// Names the engine on an error result: nothing was returned to attribute, but
// the failure still came from whichever solver the run reached for.
const attemptedEngine = (): SimulationEngine => (isNativeSpiceRuntime() ? "ngspice" : "preview");

/** The seven analyses, in the vocabulary the analysis mode rail uses. */
type RunKind = "tran" | "op" | "ac" | "dc" | "tf" | "noise" | "step";

/** What the drawer head calls each one when there are no figures to quote. */
const RUN_KIND_LABEL: Record<RunKind, string> = {
  tran: "Transient",
  op: "Operating point",
  ac: "AC sweep",
  dc: "DC sweep",
  tf: "Transfer function",
  noise: "Noise analysis",
  step: "Step sweep",
};

/**
 * The part of a result every analysis shares, which is all the drawer head and
 * the Errors tab read. Seven concrete result types, one common shape: `ok`,
 * a failure `message`, and the run's warnings.
 */
export interface RunOutcome {
  ok: boolean;
  message?: string;
  warnings?: readonly string[];
}

function App() {
  const components = useSchematic((s) => s.components);
  const wires = useSchematic((s) => s.wires);
  const toolMode = useSchematic((s) => s.tool.mode);
  const selectedId = useSchematic((s) => s.selectedId);
  const selectedCount = useSchematic((s) => (s.selectedId ? 1 : s.selectedIds.length));
  const selectedIds = useSchematic((s) => s.selectedIds);
  const selectedWireId = useSchematic((s) => s.selectedWireId);
  const select = useSchematic((s) => s.select);
  const startPlacing = useSchematic((s) => s.startPlacing);
  const startWiring = useSchematic((s) => s.startWiring);
  const startProbing = useSchematic((s) => s.startProbing);
  const startAmmeter = useSchematic((s) => s.startAmmeter);
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
  const simulationPrefs = useSimulationPreferences();
  const autoAnalysisOptions = useMemo(
    () => suggestTransientOptions(components, simulationPrefs.transientDetail),
    [components, simulationPrefs.transientDetail],
  );
  const [analysisOptions, setAnalysisOptions] = useState<AnalysisOptions>(autoAnalysisOptions);
  // Tau chooses transient resolution automatically (from the
  // circuit's time constants + source frequencies) until the user chooses a
  // duration/detail override; that manual state sticks until explicitly reset.
  const [optionsOverridden, setOptionsOverridden] = useState(false);
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
  const [pendingRecovery, setPendingRecovery] = useState<UnsavedRecoverySnapshot | null>(() =>
    peekUnsavedRecoveryOffer(),
  );
  const [learningPath, setLearningPath] = useState<LearningPathState>(() => loadLearningPathState());
  /** Hides the post-success coach after "Got it" without clearing completed status. */
  const [learningPathCoachHidden, setLearningPathCoachHidden] = useState(false);
  const [pendingExternalEdit, setPendingExternalEdit] = useState<PendingExternalEdit | null>(null);
  const pendingExternalEditRef = useRef<PendingExternalEdit | null>(null);
  pendingExternalEditRef.current = pendingExternalEdit;
  const [schematicReadoutTime, setSchematicReadoutTime] = useState<number | null>(null);
  /** Animate schematic V/I through real `.tran` samples (EveryCircuit-style live). */
  // Current mode: the animated flow-dot overlay. On by default because it is
  // the point of running a simulation, but genuinely dismissable - an overlay
  // you cannot turn off is one you end up fighting while reading the drawing.
  const [currentVisualizer, setCurrentVisualizer] = useState(true);
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
  /**
   * Which of the seven analyses last ran, so a single readout can describe it.
   *
   * The results drawer's head is the one line that stays on screen when the
   * drawer is collapsed, and it was reading `analysis` - the transient result
   * - no matter what had actually run. A completed AC sweep therefore reported
   * "No analysis yet" beside its own plot, and a failed one could report a
   * previous transient's green "Complete · 6 ms · 241 samples".
   *
   * Recorded at each run's entry rather than inferred from which result object
   * is newest, because "newest" is unanswerable once two of them are non-null.
   * It tracks the analysis rail exactly: selecting a mode there IS the run
   * gesture, and every one of those tabs calls through to a run below.
   */
  const [lastRunKind, setLastRunKind] = useState<RunKind>("tran");
  /**
   * The inputs each analysis was last run against, so selecting its tab can
   * show the answer instead of recomputing it.
   *
   * Picking a mode in the analysis rail IS the run gesture (see
   * `handleModeChange` in SimulationPanel), and nothing remembered what had
   * already been answered - so TRAN, AC, back to TRAN re-solved a transient
   * that had not changed by so much as a wire. On anything past a toy circuit
   * that is a visible stall for a result the app is already holding.
   *
   * Keyed on the whole document signature plus the installed model libraries
   * plus that mode's own setup, and recorded when the run STARTS rather than
   * when it lands, so an edit made mid-run cannot be mistaken for the inputs
   * that produced the result. Cleared wholesale by `invalidateAnalysis`.
   */
  const runInputsRef = useRef<Partial<Record<RunKind, string>>>({});
  const analysisInputsKeyRef = useRef("");
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
  const modelLibrariesMounted = useMountedOnceOpened(modelLibrariesOpen);
  const simulationSetupMounted = useMountedOnceOpened(simulationSetupOpen);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [confirmCloseTabId, setConfirmCloseTabId] = useState<string | null>(null);
  const [savingCloseTab, setSavingCloseTab] = useState(false);
  /**
   * Bumped whenever a run produces something worth reading, which raises the
   * results drawer if it is collapsed. A counter rather than the old
   * `graphOpen` boolean: `setGraphOpen(true)` on an already-open panel is a
   * no-op, so "a new result arrived" and "the panel happens to be open" were
   * the same state and the second run of a session could not raise anything.
   */
  const [resultsRaise, setResultsRaise] = useState(0);
  /** Pixels of canvas the results drawer is covering; see its onCoverChange. */
  const [drawerCover, setDrawerCover] = useState(0);

  /**
   * Warm the preview worker while a browser user is still reading the
   * schematic. Packaged Tau starts with ngspice instead, so creating the
   * preview worker at native-app mount would spend memory and CPU on a solver
   * that is only a later fallback.
   */
  useEffect(() => {
    prewarmPreviewSolverForRuntime(isNativeSpiceRuntime());
  }, []);
  /** The selection's on-screen box, published by Canvas; see onSelectionRect. */
  const [selectionRect, setSelectionRect] = useState<
    { minX: number; minY: number; maxX: number; maxY: number } | null
  >(null);
  /**
   * Dismissing the inspector must not deselect the part, so "closed" is its
   * own state rather than an absence of selection. Keyed by what is selected,
   * so choosing a different part brings it back.
   */
  const [inspectorClosedFor, setInspectorClosedFor] = useState<string | null>(null);
  /** Bumped by the explicit keyboard command, never by a canvas selection. */
  const [inspectorFocusSignal, setInspectorFocusSignal] = useState(0);
  /** Shell-body box in client coordinates, measured alongside its width. */
  const [shellBox, setShellBox] = useState({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  const [componentFocusSignal, setComponentFocusSignal] = useState(0);
  const [partsOpen, setPartsOpen] = useState(true);
  const [fitSignal, setFitSignal] = useState(0);
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
  // Document-opening work can await sibling symbols, model libraries, or
  // filesystem writes.  A later tab switch, a new circuit, or another file is
  // a newer navigation request; a late answer from the older request has no
  // permission to replace the live circuit.
  const documentNavigationRef = useRef(0);
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

  // Selecting a part opens the Components rail so Properties is immediately
  // usable. Keyed on the count, not on `selectedId`: the store nulls that the
  // moment a second part joins the selection, so a marquee drag used to leave
  // the rail shut over a panel that now had something to show.
  useEffect(() => {
    if (selectedCount > 0 && mode === "schematic") setPartsOpen(true);
  }, [selectedCount, mode]);

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
  // Crash recovery tracks any recoverable document that is not identical to the
  // last successful disk open/save - including untitled scratchpads that never
  // received a savedSignature. Skip while the launch dialog is still open so
  // we do not overwrite the offered snapshot with a blank starter.
  const needsCrashRecovery = Boolean(
    !pendingRecovery
    && documentHasRecoverableContent(currentDocument)
    && (!activeTab?.savedSignature || activeTab.savedSignature !== currentSignature),
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
    toast(message, { duration: 2600 });
    window.setTimeout(() => setNotice((current) => (current === message ? null : current)), 2600);
  }, []);

  // Radix only restores focus to a `<Dialog.Trigger>` automatically. Settings
  // has three separate entry points (toolbar gear, rail button, and any
  // future one) living in components far from where `<Dialog>` mounts below,
  // so none of them is a `Dialog.Trigger` - Radix's own restoration is a
  // silent no-op here. This ref plus `Dialog`'s `onCloseAutoFocus` (below)
  // is the manual equivalent: remember what had focus when Settings opened,
  // and hand it back when Settings closes.
  const settingsOpenerRef = useRef<HTMLElement | null>(null);

  /**
   * Show Settings, in this window. It briefly opened a second OS window; that
   * gave it a second JavaScript context, and with it a second credential store
   * the assistant never read - see `settings/settingsSurface.ts`.
   */
  const openSettingsSurface = useCallback(() => {
    settingsOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSettingsOpen(true);
  }, []);

  const invalidateAnalysis = useCallback((state: "idle" | "stopped" = "idle") => {
    analysisRequestRef.current += 1;
    // Every remembered answer goes with the results it described. See
    // `runInputsRef`: a key surviving its result would let a later tab click
    // skip a run and then find nothing to show.
    runInputsRef.current = {};
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

  /**
   * Everything outside a single mode's own setup that a result depends on.
   *
   * The document signature already covers components, wires, labels,
   * directives and the document's embedded models; the installed libraries
   * are app state rather than document state, so they are appended here.
   */
  const analysisInputsKey = useMemo(
    () => `${currentSignature}\u0000${userModelLibraryNames.join("\u0001")}`,
    [currentSignature, userModelLibraryNames],
  );
  const analysisSetupKey = useCallback((kind: RunKind) => {
    switch (kind) {
      case "tran": return JSON.stringify(effectiveAnalysisOptions);
      case "dc": return JSON.stringify(dcSetup);
      case "tf": return JSON.stringify(tfSetup);
      case "noise": return JSON.stringify(noiseSetup);
      case "step": return JSON.stringify(stepSetupUi);
      default: return "";
    }
  }, [effectiveAnalysisOptions, dcSetup, tfSetup, noiseSetup, stepSetupUi]);
  useEffect(() => {
    analysisInputsKeyRef.current = analysisInputsKey;
  }, [analysisInputsKey]);

  /**
   * Open a run: name the analysis, and record what it is being run against.
   *
   * Read through refs rather than taken as dependencies on purpose. Every one
   * of the seven run callbacks below would otherwise have to carry the key and
   * all five setup objects in its dependency array, and those callbacks are
   * themselves dependencies of half the toolbar.
   */
  const beginRun = useCallback((kind: RunKind) => {
    setLastRunKind(kind);
    runInputsRef.current[kind] = `${analysisInputsKeyRef.current}\u0000${analysisSetupKeyRef.current(kind)}`;
  }, []);
  const analysisSetupKeyRef = useRef(analysisSetupKey);
  useEffect(() => {
    analysisSetupKeyRef.current = analysisSetupKey;
  }, [analysisSetupKey]);

  /**
   * The result the drawer is describing: the one the last run produced.
   *
   * Every surface below reads this rather than `analysis`, which is the
   * transient and only the transient. See `lastRunKind` for what went wrong
   * when they did not.
   */
  const activeAnalysis = useMemo<RunOutcome | null>(() => {
    switch (lastRunKind) {
      case "op": return opAnalysis;
      case "ac": return acAnalysis;
      case "dc": return dcAnalysis;
      case "tf": return tfAnalysis;
      case "noise": return noiseAnalysis;
      case "step": return stepFamily;
      default: return analysis;
    }
  }, [lastRunKind, analysis, opAnalysis, acAnalysis, dcAnalysis, tfAnalysis, noiseAnalysis, stepFamily]);

  /**
   * Does this analysis already hold the answer for the circuit as it stands?
   *
   * Consulted by the analysis rail before it re-runs on a tab selection. The
   * explicit Run control deliberately does NOT consult it: selecting a mode
   * means "show me this", and pressing Run means "do it again".
   */
  const hasFreshResult = useCallback((kind: RunKind) => {
    if (analysisRunning) return false;
    const result =
      kind === "op" ? opAnalysis
      : kind === "ac" ? acAnalysis
      : kind === "dc" ? dcAnalysis
      : kind === "tf" ? tfAnalysis
      : kind === "noise" ? noiseAnalysis
      : kind === "step" ? stepFamily
      : analysis;
    if (!result) return false;
    const key = `${analysisInputsKey}\u0000${analysisSetupKey(kind)}`;
    return runInputsRef.current[kind] === key;
  }, [
    analysisRunning, analysisInputsKey, analysisSetupKey,
    analysis, opAnalysis, acAnalysis, dcAnalysis, tfAnalysis, noiseAnalysis, stepFamily,
  ]);

  /**
   * The two things the results drawer needs that only App can compute.
   *
   * `resultsSummary` is the whole readout when the drawer is collapsed, so it
   * has to say what happened without the plots: for a transient, the run's
   * span and how many points it took; for the others, which analysis this
   * was, since a sweep has no single span to quote. Or the error's own
   * message. Two facts, not the plotter's five - a peek strip is a glance,
   * and the detail is one click away.
   *
   * `diagnosticsBadge` is the same count the Errors tab renders, hoisted so it
   * is legible with the drawer shut. It mirrors BottomPanel's own arithmetic
   * (the failure message, the run's warnings, and any import notices for this
   * file), which is a duplication worth accepting: the alternative is the tab
   * reporting its own count upward through state, and a surface that has to
   * render before its label is correct cannot be collapsed.
   */
  const resultsSummary = useMemo(() => {
    if (analysisRunning) return undefined;
    if (!activeAnalysis) return undefined;
    if (!activeAnalysis.ok) return activeAnalysis.message ?? RUN_KIND_LABEL[lastRunKind];
    if (lastRunKind === "tran" && analysis?.ok) {
      const { stopTime, sampleCount } = analysis.stats;
      return `${formatEngineering(stopTime, "s", 2)} \u00b7 ${sampleCount} samples`;
    }
    return RUN_KIND_LABEL[lastRunKind];
  }, [activeAnalysis, analysis, analysisRunning, lastRunKind]);

  /**
   * What the floating inspector is describing.
   *
   * Document order, and `selectedId` folded into `selectedIds` as a
   * belt-and-braces union, matching what the docked rail did before the panel
   * moved to the selection.
   */
  const inspectedParts = useMemo(() => {
    const ids = new Set<string>(selectedIds);
    if (selectedId) ids.add(selectedId);
    return components.filter((component) => ids.has(component.id));
  }, [components, selectedIds, selectedId]);
  const inspectedWire = useMemo(
    () => wires.find((wire) => wire.id === selectedWireId) ?? null,
    [wires, selectedWireId],
  );
  const inspectionKey = inspectedWire
    ? `wire:${inspectedWire.id}`
    : inspectedParts.map((part) => part.id).join(" ") || null;
  const inspectorTitle = inspectedWire
    ? "Wire properties"
    : inspectedParts.length === 1
      ? inspectorName(inspectedParts[0].label || inspectedParts[0].kind)
      : `${inspectedParts.length} components`;
  const inspectorOpen = Boolean(inspectionKey) && inspectionKey !== inspectorClosedFor;

  const diagnosticsBadge = useMemo(() => {
    if (analysisRunning) return null;
    const notices = activeFilePath ? importWarningsByPath[activeFilePath] ?? [] : [];
    const failed = Boolean(activeAnalysis && !activeAnalysis.ok);
    const count = (failed ? 1 : 0) + (activeAnalysis?.warnings?.length ?? 0) + notices.length;
    if (count === 0) return null;
    return { text: String(count), tone: failed ? ("error" as const) : ("warning" as const) };
  }, [activeAnalysis, analysisRunning, activeFilePath, importWarningsByPath]);

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
    beginRun("tran");
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
      const result = await runTransientAnalysisOffThread(
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
    beginRun("op");
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
    beginRun("ac");
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
        // The TS family is now awaited (its members run across the worker
        // pool), so the staleness check has to be repeated after it settles -
        // a re-run started while forty sweeps were in flight must win.
        const family = nativeFamily
          ?? await runAcStepFamily(
            specs,
            params,
            { components, wires, netLabels, couplings },
            analysesFromDirectives(directives).ac ?? acSweep,
          );
        if (analysisRequestRef.current !== requestId) return;
        setAcStepFamily(family);
      } else {
        const family = await runAcStepFamily(
          specs,
          params,
          { components, wires, netLabels, couplings },
          analysesFromDirectives(directives).ac ?? acSweep,
        );
        if (analysisRequestRef.current !== requestId) return;
        setAcStepFamily(family);
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
    beginRun("dc");
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
        const family = nativeFamily
          ?? await runDcStepFamily(specs, params, { components, wires, netLabels }, dc);
        if (analysisRequestRef.current !== requestId) return;
        setDcStepFamily(family);
      } else {
        const family = await runDcStepFamily(specs, params, { components, wires, netLabels }, dc);
        if (analysisRequestRef.current !== requestId) return;
        setDcStepFamily(family);
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
    beginRun("tf");
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
    beginRun("noise");
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
    beginRun("step");
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
        const family = await runAcStepFamily(
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
        const family = await runDcStepFamily(specs, params, { components, wires, netLabels }, dc);
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
          : withEngine(await runTransientAnalysisOffThread({ components: ctx.components, wires, netLabels, params: ctx.params }, effectiveAnalysisOptions), "preview");
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

  /**
   * The parts of this circuit a reader can operate, detected from the sheet
   * rather than declared by the author.
   *
   * Recomputed with `components`, which is also what an actuation changes, so
   * the positions below are a live readout of the circuit: throwing a switch
   * on the canvas moves this row in the same commit that re-solves the
   * analysis.
   */
  const circuitIsInteractive = useMemo(() => isInteractiveSchematic(components), [components]);
  const circuitControls = useMemo(() => liveControls(components), [components]);
  const circuitControlsHint = useMemo(
    () => liveControlHint(circuitControls, preferredAnalysis),
    [circuitControls, preferredAnalysis],
  );

  // The global Run command follows the first authored analysis directive, as
  // LTspice users expect. Selecting a mode tab remains an explicit request to
  // run that particular mode.
  const runAndShowSimulator = useCallback(async () => {
    await saveActiveToProjectRef.current({ quietBlocked: true });
    setMode("simulator");
    setResultsRaise((n) => n + 1);
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
    options?: { dirty?: boolean; notice?: string; diskFingerprint?: string },
  ) => {
    const snap = snapshotActive(tabs);
    const markDirty = Boolean(options?.dirty);
    const signature = schematicDocumentSignature(doc);
    const recoveredDetached = markDirty && !filePath;
    const diskFingerprint = options?.diskFingerprint;
    const existing = snap.find((tab) => (filePath ? tab.filePath === filePath : tab.title === title));
    if (existing) {
      setTabs(snap.map((tab) =>
        tab.id === existing.id
          ? {
              ...tab,
              doc,
              history: emptyHistory(),
              filePath: filePath ?? tab.filePath,
              detached: recoveredDetached || tab.detached,
              dirty: markDirty,
              // Recovered dirty work must keep a clean signature that differs
              // from the live document so the unsaved badge stays honest.
              savedSignature: markDirty
                ? `${signature}::recovered`
                : signature,
              ...(diskFingerprint !== undefined ? { diskFingerprint } : {}),
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
          detached: recoveredDetached,
          dirty: markDirty,
          savedSignature: markDirty ? `${signature}::recovered` : signature,
          ...(diskFingerprint !== undefined ? { diskFingerprint } : {}),
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
          detached: recoveredDetached,
          dirty: markDirty,
          savedSignature: markDirty ? `${signature}::recovered` : signature,
          ...(diskFingerprint !== undefined ? { diskFingerprint } : {}),
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
    // A bare "Opened <file>" is not reported. The tab strip, the title bar and
    // the drawing itself all just changed to say so, and a toast that restates
    // what three visible surfaces already show is ink with no information in
    // it - and it lands over the bottom-right of the instrument, which is
    // where the trace legend and the measurement cards are. A notice with
    // something to add (dropped parts, stranded terminals) still speaks.
    if (options?.notice) showNotice(options.notice);
  }, [tabs, snapshotActive, loadCircuit, adoptDirectiveOptions, invalidateAnalysis, showNotice, components.length, wires.length]);

  const openSimFromProject = useCallback((path: string, title: string, json: string) => {
    documentNavigationRef.current += 1;
    try {
      const parsed = JSON.parse(json) as unknown;
      const doc = validateSchematicDocument(parsed);
      // Retired parts are dropped rather than refused, so the open has to say
      // which ones went - the drawing changing on its own is not acceptable.
      const retired = retiredKindNotices(parsed);
      // Same rule for a part whose terminals moved after this file was saved:
      // the geometry is left exactly as drawn and the affected parts are named,
      // because a schematic that quietly comes back subtly disconnected would
      // solve differently with nothing on screen to say why.
      const stranded = strandedTerminalNotices(doc.components, doc.wires);
      const reported = [...retired, ...stranded];
      const alsoDropped = retired.length - 1;
      const dropped = alsoDropped > 0
        ? `${retired[0]} ${alsoDropped} more ${alsoDropped === 1 ? "was" : "were"} dropped as well.`
        : retired[0];
      const attention = stranded.length > 1
        ? `${stranded[0]} ${stranded.length - 1} other part${stranded.length === 2 ? "" : "s"} needs the same.`
        : stranded[0];
      const summary = [dropped, attention].filter(Boolean).join(" ");
      // Diagnostics keeps the full per-part list; the toast carries the first.
      setImportWarningsByPath((previous) => ({ ...previous, [path]: reported }));
      openDocument(doc, title, path, [], {
        diskFingerprint: diskContentFingerprint(json),
        ...(summary ? { notice: `Opened ${title}. ${summary}` } : {}),
      });
    } catch (error) {
      showNotice(userFacingErrorMessage(error, "Could not open .sim file."));
    }
  }, [openDocument, showNotice, setImportWarningsByPath]);

  const openAscFromProject = useCallback(async (
    path: string,
    title: string,
    text: string,
    // Conversion-time warnings from a non-native import (a SPICE or KiCad
    // netlist Tau converted into this .asc) - see `io/fileImport.ts`. Empty
    // for a genuine .asc, whose own warnings come entirely from `result` below.
    extraWarnings: string[] = [],
  ) => {
    const requestId = ++documentNavigationRef.current;
    try {
      const result = await importProjectAsc(text, {
        sourcePath: path,
        rootPath: useProject.getState().rootPath,
        readText: readProjectText,
        pathExists: projectPathExists,
        readInstalledLtspiceText: async (id) => (await readInstalledLtspiceModel(id)).text,
      });
      // Resolving a vendor hierarchy can take noticeably longer than opening a
      // simple schematic.  Do not let the old result add a tab, warnings, or
      // a toast after the user has already chosen a different file.
      if (documentNavigationRef.current !== requestId) return;
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
      // A Tau-native digital part written under a carrier symbol comes back on
      // Tau's own pin geometry, so an `.asc` saved before those terminals moved
      // is stranded exactly the way a `.sim` is. Same rule, same report.
      const strandedWarnings = strandedTerminalNotices(result.components, result.wires);
      // Surface import warnings in the Diagnostics panel for THIS document.
      // The toast only carries a count, which is a dead end on its own.
      const allWarnings = [...extraWarnings, ...result.warnings, ...duplicateWarnings, ...strandedWarnings];
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
      openDocument(doc, title, path, ascRewriteRisks(text, result.foreignSymbols, result.hierarchicalBlocks), {
        diskFingerprint: diskContentFingerprint(text),
      });
      if (allWarnings.length > 0) {
        // Diagnostics already lists import warnings for this document — skip a
        // second toast that nags "See Diagnostics" after every imperfect ASC.
        console.warn(`Imported ${title} with ${allWarnings.length} warning(s):`, allWarnings);
      }
    } catch (error) {
      if (documentNavigationRef.current !== requestId) return;
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
    const requestId = ++documentNavigationRef.current;
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
    if (documentNavigationRef.current !== requestId) return;
    // Latch only for the circuit that actually became current.  An assistant
    // request superseded while its disk write was pending must not auto-run on
    // a later, unrelated edit.
    pendingAutoRunRef.current = pickAutoRunAnalysis(action.document.directives ?? []);
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
    documentNavigationRef.current += 1;
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
          setResultsRaise((n) => n + 1);
          void executeTransient(tran);
        });
        break;
      }
      case "ac":
        setMode("simulator");
        setResultsRaise((n) => n + 1);
        void runAcAnalysis();
        break;
      case "dc":
        setMode("simulator");
        setResultsRaise((n) => n + 1);
        void runDcAnalysis();
        break;
      case "tf":
        setMode("simulator");
        setResultsRaise((n) => n + 1);
        void runTfAnalysis();
        break;
      case "noise":
        setMode("simulator");
        setResultsRaise((n) => n + 1);
        void runNoiseAnalysis_();
        break;
      case "op":
        setMode("simulator");
        setResultsRaise((n) => n + 1);
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
    // Refuse to silently overwrite when the on-disk file changed outside Tau.
    if (!createdForSave && tab.diskFingerprint) {
      try {
        const exists = await projectPathExists(filePath);
        if (!exists) {
          setPendingExternalEdit({
            tabId: targetId,
            filePath,
            title: tab.title,
            kind: "missing",
            diskText: null,
            diskFingerprint: null,
          });
          return false;
        }
        const diskText = await readProjectText(filePath);
        const diskFingerprint = diskContentFingerprint(diskText);
        const editorDirty = tab.savedSignature !== schematicDocumentSignature(document);
        const classification = classifyExternalEdit({
          syncedFingerprint: tab.diskFingerprint,
          diskFingerprint,
          editorDirty,
        });
        if (classification.kind !== "in-sync") {
          setPendingExternalEdit({
            tabId: targetId,
            filePath,
            title: tab.title,
            kind: classification.kind,
            diskText,
            diskFingerprint: classification.diskFingerprint,
          });
          return false;
        }
      } catch (error) {
        showNotice(userFacingErrorMessage(error, "Could not verify the file on disk before saving."));
        return false;
      }
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
      clearUnsavedRecovery();
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
              diskFingerprint: diskContentFingerprint(serialized.contents),
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
    documentNavigationRef.current += 1;
    setTabs(snap);
    setActiveId(id);
    const restored = target.doc ?? blankDocument();
    restoreCircuit(restored, target.history);
    adoptDirectiveOptions(restored);
    invalidateAnalysis();
    setFitSignal((n) => n + 1);
  }, [activeId, tabs, snapshotActive, restoreCircuit, adoptDirectiveOptions, invalidateAnalysis]);

  const startNewCircuit = useCallback(async () => {
    const requestId = ++documentNavigationRef.current;
    const path = await createSchematicInRoot();
    if (!path) {
      showNotice(useProject.getState().error ?? "Could not create schematic.");
      return;
    }

    // Opening through the normal document path gives the tab its real filePath
    // immediately. The first ⌘S therefore updates the newly-created .asc
    // instead of falling back to the old pathless scratchpad warning.
    let fingerprint: string | undefined;
    try {
      fingerprint = diskContentFingerprint(await readProjectText(path));
    } catch {
      fingerprint = undefined;
    }
    if (documentNavigationRef.current !== requestId) return;
    openDocument(blankDocument(), basename(path), path, [], {
      ...(fingerprint !== undefined ? { diskFingerprint: fingerprint } : {}),
    });
    // No raise here. This replaced `setGraphOpen(true)`, which was a no-op
    // reset of a simulator-only panel; bumping the shared drawer's raise
    // counter is not, and it lifted an empty "No analysis yet" drawer over
    // the blank canvas of a schematic that had not been run.
    showNotice(`Created ${basename(path)}`);
  }, [createSchematicInRoot, openDocument, showNotice]);

  /** First-success learning path: load RC Charging + coach; user presses Run. */
  const startFirstSuccessExample = useCallback(async () => {
    if (!useProject.getState().rootPath) {
      showNotice("Open or create a project folder before trying the RC example.");
      return;
    }
    const requestId = ++documentNavigationRef.current;
    const meta = firstSuccessExampleMeta();
    const doc = firstSuccessExampleDocument();
    const path = await createSchematicInRoot(meta.filename);
    if (!path) {
      showNotice(useProject.getState().error ?? "Could not create schematic.");
      return;
    }
    const exported = schematicToAsc({
      components: doc.components,
      wires: doc.wires,
      netLabels: doc.netLabels ?? [],
      directives: doc.directives,
    });
    try {
      await writeSim(path, exported.text);
    } catch (error) {
      await deleteProjectNode(path);
      showNotice(userFacingErrorMessage(error, "Could not write the RC Charging example."));
      return;
    }
    if (documentNavigationRef.current !== requestId) return;
    openDocument(doc, basename(path), path, [], {
      diskFingerprint: diskContentFingerprint(exported.text),
      notice: `Loaded ${meta.name}. Press Run to simulate.`,
    });
    setLearningPath(startLearningPath());
    setLearningPathCoachHidden(false);
    // No raise here. This replaced `setGraphOpen(true)`, which was a no-op
    // reset of a simulator-only panel; bumping the shared drawer's raise
    // counter is not, and it lifted an empty "No analysis yet" drawer over
    // the blank canvas of a schematic that had not been run.
  }, [createSchematicInRoot, deleteProjectNode, openDocument, showNotice, writeSim]);

  const dismissLearningPathCoach = useCallback(() => {
    setLearningPath(dismissLearningPath());
    setLearningPathCoachHidden(true);
  }, []);

  const learningPathUiContext: LearningPathUiContext = useMemo(() => {
    if (learningPath.status === "completed") return "success";
    if (analysisRunning) return "simulating";
    if (components.length > 0 || wires.length > 0) return "example_ready";
    return "empty";
  }, [learningPath.status, analysisRunning, components.length, wires.length]);

  const learningPathTip = useMemo(
    () => contextualHelpFor(learningPath, learningPathUiContext),
    [learningPath, learningPathUiContext],
  );

  // Complete the first-success path when any analysis settles ok while active.
  useEffect(() => {
    if (analysisRunning || learningPath.status !== "in_progress") return;
    const settledOk =
      (analysis?.ok === true)
      || (opAnalysis?.ok === true)
      || (acAnalysis?.ok === true)
      || (dcAnalysis?.ok === true)
      || (tfAnalysis?.ok === true)
      || (noiseAnalysis?.ok === true)
      || (stepFamily?.ok === true);
    if (!settledOk) return;
    setLearningPath(recordLearningPathSimulationOutcome({ ok: true }));
    setLearningPathCoachHidden(false);
  }, [
    analysisRunning,
    learningPath.status,
    analysis,
    opAnalysis,
    acAnalysis,
    dcAnalysis,
    tfAnalysis,
    noiseAnalysis,
    stepFamily,
  ]);

  const closeTab = useCallback((id: string, confirmed = false) => {
    const snap = snapshotActive(tabs);
    const idx = snap.findIndex((tab) => tab.id === id);
    if (idx === -1) return;
    const closing = snap[idx];
    if (closing.dirty && !confirmed) {
      setConfirmCloseTabId(id);
      return;
    }
    documentNavigationRef.current += 1;
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
    documentNavigationRef.current += 1;
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
            diskFingerprint: undefined,
            ascRewriteRisks: [],
            doc: blankDocument(),
            history: emptyHistory(),
          }
        : tab
    )));
    invalidateAnalysis();
    setMode("schematic");
    setConfirmClearOpen(false);
    // No raise here. This replaced `setGraphOpen(true)`, which was a no-op
    // reset of a simulator-only panel; bumping the shared drawer's raise
    // counter is not, and it lifted an empty "No analysis yet" drawer over
    // the blank canvas of a schematic that had not been run.
    showNotice("Schematic cleared.");
  }, [activeId, newCircuit, invalidateAnalysis, showNotice]);

  /**
   * Re-solve after a contact was operated, instead of blanking the plot.
   *
   * Every other edit invalidates: the result on screen no longer describes the
   * circuit, and showing it would be a lie. Throwing a switch is the one edit
   * whose entire purpose is to see the new result, so it re-runs the analysis
   * the reader is already looking at. Held in a ref so the effect below keeps
   * its original dependencies and does not re-fire on every render.
   */
  const rerunAfterActuationRef = useRef<() => void>(() => {});
  rerunAfterActuationRef.current = () => {
    if (preferredAnalysis === "op") void runOperatingAnalysis();
    else if (preferredAnalysis === "ac") void runAcAnalysis();
    else if (preferredAnalysis === "dc") void runDcAnalysis();
    else if (preferredAnalysis === "tf") void runTfAnalysis();
    else if (preferredAnalysis === "noise") void runNoiseAnalysis_();
    else void executeTransient(effectiveAnalysisOptions);
  };
  const actuationPendingRef = useRef(false);
  const handleActuate = useCallback(() => { actuationPendingRef.current = true; }, []);

  useEffect(() => {
    if (actuationPendingRef.current) {
      actuationPendingRef.current = false;
      rerunAfterActuationRef.current();
      return;
    }
    invalidateAnalysis();
  }, [components, wires, directives, invalidateAnalysis]);

  // Persist a versioned dirty snapshot so a crash can offer Restore next launch.
  useEffect(() => {
    if (pendingRecovery) return;
    if (!needsCrashRecovery) {
      clearUnsavedRecovery();
      return;
    }
    const timer = window.setTimeout(() => {
      saveUnsavedRecovery({
        title: documentTitle,
        filePath: activeFilePath,
        signature: currentSignature,
        document: currentDocument,
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    pendingRecovery,
    needsCrashRecovery,
    documentTitle,
    activeFilePath,
    currentSignature,
    currentDocument,
  ]);

  const restorePendingRecovery = useCallback(() => {
    if (!pendingRecovery) return;
    documentNavigationRef.current += 1;
    const snap = pendingRecovery;
    setPendingRecovery(null);
    openDocument(snap.document, snap.title, snap.filePath, [], {
      dirty: true,
      notice: `Restored unsaved edits to ${snap.title}`,
    });
  }, [pendingRecovery, openDocument]);

  const discardPendingRecovery = useCallback(() => {
    clearAllUnsavedLocalState();
    setPendingRecovery(null);
    showNotice("Discarded unsaved recovery copy.");
  }, [showNotice]);

  const probeActiveExternalEdit = useCallback(async () => {
    if (pendingRecovery || pendingExternalEditRef.current) return;
    const tab = tabsRef.current.find((t) => t.id === activeId);
    if (!tab?.filePath || !tab.diskFingerprint || tab.detached) return;
    const filePath = tab.filePath;
    try {
      const exists = await projectPathExists(filePath);
      const document = tab.id === activeId ? currentDocument : tab.doc ?? blankDocument();
      const editorDirty = Boolean(
        tab.savedSignature && tab.savedSignature !== schematicDocumentSignature(document),
      );
      if (!exists) {
        setPendingExternalEdit({
          tabId: tab.id,
          filePath,
          title: tab.title,
          kind: "missing",
          diskText: null,
          diskFingerprint: null,
        });
        return;
      }
      const diskText = await readProjectText(filePath);
      const diskFingerprint = diskContentFingerprint(diskText);
      const classification = classifyExternalEdit({
        syncedFingerprint: tab.diskFingerprint,
        diskFingerprint,
        editorDirty,
      });
      if (classification.kind === "in-sync") return;
      setPendingExternalEdit({
        tabId: tab.id,
        filePath,
        title: tab.title,
        kind: classification.kind,
        diskText,
        diskFingerprint: classification.diskFingerprint,
      });
    } catch {
      // Focus probes are best-effort; a transient FS error must not toast-spam.
    }
  }, [activeId, currentDocument, pendingRecovery]);

  useEffect(() => {
    const onFocus = () => { void probeActiveExternalEdit(); };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void probeActiveExternalEdit();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [probeActiveExternalEdit]);

  const reloadExternalEdit = useCallback(() => {
    const pending = pendingExternalEdit;
    if (!pending || pending.diskText === null) {
      setPendingExternalEdit(null);
      return;
    }
    setPendingExternalEdit(null);
    const title = basename(pending.filePath);
    if (isAscFile(pending.filePath)) {
      void openAscFromProject(pending.filePath, title, pending.diskText);
      return;
    }
    if (isSimFile(pending.filePath)) {
      openSimFromProject(pending.filePath, title, pending.diskText);
      return;
    }
    showNotice(`Could not reload ${title}: unsupported schematic type.`);
  }, [pendingExternalEdit, openAscFromProject, openSimFromProject, showNotice]);

  const keepExternalEdit = useCallback(() => {
    const pending = pendingExternalEdit;
    if (!pending) return;
    setPendingExternalEdit(null);
    if (pending.kind === "missing") {
      // Detach so Save can recreate without claiming the vanished path is synced.
      setTabs((list) => list.map((tab) => (
        tab.id === pending.tabId
          ? {
              ...tab,
              filePath: null,
              detached: true,
              dirty: true,
              diskFingerprint: undefined,
            }
          : tab
      )));
      showNotice(`Kept “${pending.title}” open as an unsaved schematic.`);
      return;
    }
    // Acknowledge the disk revision so we stop re-prompting; Save will overwrite.
    if (pending.diskFingerprint) {
      setTabs((list) => list.map((tab) => (
        tab.id === pending.tabId
          ? { ...tab, diskFingerprint: pending.diskFingerprint ?? tab.diskFingerprint }
          : tab
      )));
    }
    showNotice(`Keeping editor copy of “${pending.title}”. Save will overwrite disk.`);
  }, [pendingExternalEdit, showNotice]);

  const discardExternalEdit = useCallback(() => {
    const pending = pendingExternalEdit;
    if (!pending) return;
    setPendingExternalEdit(null);
    closeTab(pending.tabId, true);
    showNotice(`Closed “${pending.title}” without writing.`);
  }, [pendingExternalEdit, closeTab, showNotice]);

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

  // The simulator's circuit surface allows only measurement tools: inspect,
  // voltage probe, ammeter, and node name. All four read the circuit; none can
  // change its topology. Anything else is an editing tool carried across from
  // the schematic editor and gets cancelled.
  useEffect(() => {
    if (mode === "simulator" && !["select", "probe", "ammeter", "label"].includes(toolMode)) cancel();
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
      // The inspector's keyboard entry point, and the reason it is a separate
      // gesture from selecting: a canvas selection deliberately does NOT move
      // focus, or `r` would type the letter r into a value field instead of
      // rotating the part. This is how a keyboard user reaches the fields.
      if (e.key.toLowerCase() === "i") {
        e.preventDefault();
        setInspectorClosedFor(null);
        setInspectorFocusSignal((value) => value + 1);
        return;
      }
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
      // The same observation answers "where may a floating surface go": the
      // shell body's own box, in client coordinates, which is the space the
      // selection rect Canvas publishes is measured in.
      const rect = el.getBoundingClientRect();
      if (rect.width > 0) {
        setShellBox({ minX: rect.left, minY: rect.top, maxX: rect.right, maxY: rect.bottom });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);


  // A `scopeWidth` state, a responsive clamp for it, and a `--scope-w` custom
  // property used to live here. Nothing read any of it: no CSS rule in the repo
  // referenced --scope-w, and the value was never consumed in JS either. It was
  // a complete apparatus, effect and all, driving nothing.


  // One pure function decides what is on screen and how wide it may be. The
  // rule used to be stated across four derived values here that all had to
  // agree; `chrome/resolveChrome.ts` is now the single place it lives, and it
  // is unit-tested without rendering an app or faking a ResizeObserver.
  // Same predicate the resolver uses, called once here so the Explorer swap
  // below and the layout cannot disagree about whether all three columns fit.
  const independentColumnsFit = canFitIndependentColumns(shellWidth, [
    SURFACES.components.width.minWidth,
    SURFACES.assistant.width.minWidth,
  ]);
  const chrome = resolveChrome({
    mode,
    shellWidth,
    intent: { explorer: true, components: partsOpen, assistant: assistantOpen },
    widths: {
      // The Explorer owns its own width inside ExplorerPanel; App only hands
      // it a ceiling. The resolver still needs a number to reserve against,
      // so it gets the configured default.
      explorer: SURFACES.explorer.width.defaultWidth,
      components: componentsRailResize.width,
      assistant: assistantResize.width,
    },
  });
  const componentsColumnOpen = chrome.components.visible;

  /**
   * Where the inspector may go, and what it should stay off.
   *
   * The viewport is the shell body inset by a gutter, less whatever the
   * results drawer is covering along the bottom - the drawer floats, so
   * nothing in the layout reserves that band and the inspector would happily
   * place itself underneath it. The rail is an obstacle rather than an inset
   * because it is narrow enough that overlapping it is sometimes the least
   * bad option, and the placement kernel is allowed to make that call.
   */
  const inspectorViewport = useMemo(() => ({
    minX: shellBox.minX + 8,
    minY: shellBox.minY + 8,
    maxX: shellBox.maxX - 8,
    maxY: Math.max(shellBox.minY + 8, shellBox.maxY - drawerCover - 8),
  }), [shellBox, drawerCover]);

  const inspectorObstacles = useMemo(
    () => (componentsColumnOpen
      ? [{
        minX: shellBox.maxX - componentsRailResize.width,
        minY: shellBox.minY,
        maxX: shellBox.maxX,
        maxY: shellBox.maxY,
      }]
      : []),
    [componentsColumnOpen, componentsRailResize.width, shellBox],
  );
  const explorerColumnOpen = chrome.explorer.visible;
  const effectiveAssistantWidth = chrome.assistant.width ?? assistantResize.width;
  const componentsRailResponsiveMax = chrome.components.maxWidth!;
  const explorerResponsiveMax = chrome.explorer.maxWidth;

  // The two clamping effects that used to live here are gone. They wrote the
  // clamped width back into storage, which meant a narrow window permanently
  // shrank the size the user had chosen: widening it again gave back the
  // floor's width, not theirs. `resolveChrome` clamps for display only, so the
  // stored preference survives and comes back when there is room for it.

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
        onOpenSettings={openSettingsSurface}
      />
      <div
        ref={shellBodyRef}
        className="shell-body"
        style={{ "--assistant-w": `${effectiveAssistantWidth}px` } as CSSProperties}
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
          onOpenSettings={openSettingsSurface}
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
        {/*
          * The workspace column: whichever mode surface is up, plus the
          * results drawer that floats over it.
          *
          * The wrapper exists so the drawer has something to be absolute
          * inside. Anchored to `.shell-body` it spanned the whole window
          * minus the nav rail, which meant that at half height it also
          * covered the bottom of the explorer, the parts rail and the
          * assistant - and the assistant pins its composer to the bottom of
          * its column, so the only way to talk to Bode disappeared behind a
          * waveform. Offsetting by each column's width in CSS is not
          * available: two of the three are user-resizable. Making the centre
          * region the drawer's containing block excludes all of them by
          * construction, at any width.
          */}
        <div className="workspace-column">
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
                offerFirstSuccess={shouldOfferLearningPath(learningPath)}
                onTryFirstSuccess={() => void startFirstSuccessExample()}
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
          {/* Named, unlike the empty-state stage above it, because this is the
              one a keyboard or screen-reader user needs to be able to reach and
              return to. The redesign makes the canvas the whole window and
              gives Escape a "return focus here" job, which needs a landmark to
              return to. See shellContract.ts. */}
          <main className="stage" aria-label={SHELL.canvas.name}>
            <Canvas
              op={opAnalysis}
              tran={analysis}
              readoutTime={schematicReadoutTime}
              interactive
              fitSignal={fitSignal}
              fitInsetBottom={drawerCover}
              onSelectionRect={setSelectionRect}
            />
            {components.length === 0 && wires.length === 0 && toolMode === "select" && (
              <EmptyState
                projectOpen
                onNewCircuit={() => void startNewCircuit()}
                onAskBode={openAssistant}
                offerFirstSuccess={shouldOfferLearningPath(learningPath)}
                onTryFirstSuccess={() => void startFirstSuccessExample()}
              />
            )}
            {/*
              * The parts library, over the drawing rather than beside it.
              *
              * Inside the stage, not the shell body, and that placement is the
              * whole fix. As a sibling of the editor section it had to span the
              * full height to reach the canvas, which put it on top of the
              * toolbar's Run button; raising the toolbar's z-index above it did
              * not settle the hit-testing, because something in that subtree
              * forms a stacking context. The stage IS the canvas area, so an
              * overlay in it covers exactly what it should and nothing else -
              * no z-index arithmetic against chrome it was never meant to
              * reach.
              */}
            {componentsColumnOpen && (
              <ComponentsRail
                focusSignal={componentFocusSignal}
                onNotice={showNotice}
                resize={componentsRailResize}
                maxWidth={componentsRailResponsiveMax}
              />
            )}
          </main>
          <ImportDropOverlay active={importDragActive} />
        </section>
        )}
        {mode === "simulator" && activeProjectFile && (
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
                    title="Plot a node\u2019s voltage over time"
                  >
                    <Crosshair size={13} strokeWidth={1.7} aria-hidden="true" />
                    <span>Probe</span>
                  </button>
                  <button
                    className={toolMode === "ammeter" ? "active" : undefined}
                    onClick={startAmmeter}
                    aria-pressed={toolMode === "ammeter"}
                    title="Clamp an ammeter on a part or wire to plot its current over time"
                  >
                    <Gauge size={13} strokeWidth={1.7} aria-hidden="true" />
                    <span>Ammeter</span>
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
                {(opAnalysis?.ok || analysis?.ok) && (
                  <button
                    type="button"
                    className={`sim-current-mode-badge${currentVisualizer ? " active" : ""}`}
                    aria-pressed={currentVisualizer}
                    aria-label={currentVisualizer ? "Current Mode on" : "Current Mode off"}
                    title={
                      currentVisualizer
                        ? "Current Mode on: animated flow dots show real branch current on the wires. Click to hide."
                        : "Current Mode off. Click to show animated branch current on the wires."
                    }
                    onClick={() => setCurrentVisualizer((on) => !on)}
                  >
                    {currentVisualizer
                      ? <Eye size={13} strokeWidth={1.7} aria-hidden="true" />
                      : <EyeOff size={13} strokeWidth={1.7} aria-hidden="true" />}
                    <span>Current Mode</span>
                  </button>
                )}
                <span
                  className="sim-view-only"
                  aria-label="View-only circuit topology"
                  title="View-only circuit topology"
                >
                  <LockKeyhole size={13} strokeWidth={1.8} aria-hidden="true" />
                </span>
              </header>
              {/*
                * Live controls. The simulator is otherwise strictly read-only -
                * the padlock above says so - and the one exception, operating a
                * contact, was discoverable only by hovering the exact symbol.
                * This band names the controls, shows the position each one is
                * in right now, and states what operating one costs. It renders
                * only when the schematic actually has an operable part, so a
                * plain RC circuit gets no chrome at all.
                */}
              {circuitIsInteractive && (
                <div className="live-controls" role="group" aria-label="Live controls">
                  <span className="live-controls-title">
                    <span
                      className={`live-controls-lamp${analysisRunning ? " solving" : ""}`}
                      aria-hidden="true"
                    />
                    Live
                  </span>
                  <ul className="live-controls-list" role="status">
                    {circuitControls.map((control) => (
                      <li key={control.id} className="live-control">
                        <span className="live-control-name">{control.name}</span>
                        <span className="live-control-position">{control.position}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="live-controls-hint">{circuitControlsHint}</p>
                </div>
              )}
              <div className="sim-schematic-canvas">
                <Canvas
                  op={opAnalysis}
                  tran={analysis}
                  readoutTime={schematicReadoutTime}
                  interactive={false}
                  onActuate={handleActuate}
                  fitSignal={fitSignal}
                  fitInsetBottom={drawerCover}
                  onSelectionRect={setSelectionRect}
                  currentVisualizer={currentVisualizer}
                />
              </div>
            </section>
        )}
        {/*
          * The inspector, at the selection rather than in a column.
          *
          * Rendered as a sibling of the canvas inside the shell body, so its
          * client coordinates and the rect Canvas publishes are in the same
          * space. Its obstacles are the two surfaces that can be under it: the
          * results drawer, whose height the drawer itself measures, and the
          * parts rail when it is open.
          */}
        {inspectorOpen && (inspectedParts.length > 0 || inspectedWire) && (
          <SelectionInspector
            anchor={selectionRect}
            viewport={inspectorViewport}
            obstacles={inspectorObstacles}
            title={inspectorTitle}
            focusSignal={inspectorFocusSignal}
            onDismiss={() => setInspectorClosedFor(inspectionKey)}
          >
            {inspectedWire
              ? <WireInspector wire={inspectedWire} />
              : (
                <ComponentInspector
                  selected={inspectedParts}
                  onOpenModelLibraries={() => setModelLibrariesOpen(true)}
                />
              )}
          </SelectionInspector>
        )}
        {/*
          * One bottom surface for every result the app produces.
          *
          * It replaces three that each owned a slice of the window: the
          * schematic's diagnostics strip, the simulator's telemetry dock, and
          * the analysis plotter as a 400px right-hand column. The plotter is
          * the one an engineer actually reads, and it was getting whatever
          * width was left after the circuit, the explorer and the assistant
          * had taken theirs. Over the canvas instead of beside it, it gets
          * the window.
          *
          * Rendered outside the mode branches on purpose: it is the one
          * surface that means the same thing in both modes, and mounting one
          * per branch would put two live landmarks under a single accessible
          * name every time the mode changed.
          */}
        {activeProjectFile && (
          <ResultsDrawer
            status={analysisRunning ? "running" : activeAnalysis ? (activeAnalysis.ok ? "complete" : "error") : "idle"}
            statusLine={resultsSummary}
            onStop={stopAnalysis}
            raiseSignal={resultsRaise}
            onCoverChange={setDrawerCover}
            preferredHeight={mode === "simulator" ? "half" : "peek"}
            preferredTab={mode === "simulator" ? "waveforms" : "errors"}
            errorBadge={diagnosticsBadge}
            errors={
              <BottomPanel
                result={activeAnalysis}
                isRunning={analysisRunning}
                notices={activeFilePath ? importWarningsByPath[activeFilePath] ?? [] : []}
              />
            }
            measurements={componentRows.length === 0 ? null : (
              <ComponentMeasurementsPanel
                rows={componentRows}
                selectedId={selectedId}
                onSelect={select}
                variant="compact"
              />
            )}
            waveforms={mode !== "simulator" ? null : (
              <Suspense fallback={null}>
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
                    documentSignature={currentSignature}
                    circuitFilePath={activeFilePath}
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
                    hasFreshResult={hasFreshResult}
                    dcSetup={dcSetup}
                    onDcSetupChange={setDcSetup}
                    tfSetup={tfSetup}
                    onTfSetupChange={setTfSetup}
                    noiseSetup={noiseSetup}
                    onNoiseSetupChange={setNoiseSetup}
                    stepSetupUi={stepSetupUi}
                    onStepSetupUiChange={setStepSetupUi}
                    onSchematicReadoutTime={setSchematicReadoutTime}
                    liveSchematicPlayback={currentVisualizer}
                  />
                </AnalysisErrorBoundary>
              </Suspense>
            )}
          />
        )}
        </div>
        {projectRootPath && assistantOpen && (
          <Suspense fallback={null}>
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
              onOpenSettings={openSettingsSurface}
              onClose={closeAssistant}
              modalBlocked={settingsOpen}
            />
          </Suspense>
        )}
      </div>
      <StatusBar mode={mode} result={analysis} title={documentTitle} />
      {shouldShowLearningPathCoach(learningPath)
        && !learningPathCoachHidden
        && learningPathTip
        && (
        <LearningPathCoach
          tip={learningPathTip}
          status={learningPath.status}
          onDismiss={dismissLearningPathCoach}
          onPrimary={
            shouldOfferLearningPath(learningPath)
              ? () => void startFirstSuccessExample()
              : undefined
          }
          primaryLabel={
            shouldOfferLearningPath(learningPath) ? "Try RC Charging" : undefined
          }
        />
      )}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenModelLibraries={() => setModelLibrariesOpen(true)}
      />
      {/* A boundary each, not one shared one: a second dialog suspending under
          a shared boundary would blank the first one back out and lose the
          state its user left in it. */}
      <Suspense fallback={null}>
        {modelLibrariesMounted && (
          <ModelLibrariesDialog open={modelLibrariesOpen} onOpenChange={setModelLibrariesOpen} />
        )}
      </Suspense>
      <Suspense fallback={null}>
        {simulationSetupMounted && (
          <SimulationSetupDialog open={simulationSetupOpen} onOpenChange={setSimulationSetupOpen} />
        )}
      </Suspense>
      <LocalAiSetupDialog onReady={() => showNotice("Local AI is ready on this Mac.")} />
      {pendingRecovery && (
        <UnsavedRecoveryDialog
          snapshot={pendingRecovery}
          onRestore={restorePendingRecovery}
          onDiscard={discardPendingRecovery}
        />
      )}
      {pendingExternalEdit && (
        <ExternalEditConflictDialog
          pending={pendingExternalEdit}
          onReload={reloadExternalEdit}
          onKeep={keepExternalEdit}
          onDiscard={discardExternalEdit}
        />
      )}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <Suspense fallback={null}>
          <SheetContent
            showCloseButton={false}
            overlayClassName="bg-transparent"
            className="tau-settings-route top-0 left-0 max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-0 bg-transparent p-0 shadow-none"
            onCloseAutoFocus={(event) => {
              // See settingsOpenerRef above: there is no Dialog.Trigger for
              // Radix to return focus to on its own.
              event.preventDefault();
              settingsOpenerRef.current?.focus();
            }}
          >
            {/* Radix requires a Title for the dialog's accessible name; visually
                hidden so the rendered surface matches today's design exactly.
                Text must stay exactly "Settings" - App.workspace.test.tsx
                queries getByRole("dialog", { name: "Settings" }). */}
            <SheetTitle className="sr-only">Settings</SheetTitle>
            <SettingsWindow onClose={() => setSettingsOpen(false)} />
          </SheetContent>
        </Suspense>
      </Sheet>
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
      {/* Visual toast via Sonner; sr-only live region keeps a11y + unit tests
          on a stable role=status surface without a second painted chip. */}
      {notice && (
        <div className="sr-only" role="status" aria-live="polite">
          {notice}
        </div>
      )}
      <Toaster />
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
