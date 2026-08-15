import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent } from "react";
import { Eye, EyeOff, Gauge, LockKeyhole, MousePointer2, Tag } from "lucide-react";
import "./App.css";
import "./styles/liveControls.css";
/* Per-concern layers, loaded after App.css so they win at equal specificity.
 * One owner each during the PDF-3 remediation - see UI_UX_PDF3.md. */
import "./styles/explorerTree.css";
import "./styles/sourceSymbols.css";
import "./styles/editorToolbarIcons.css";
import "./styles/pdf4Chrome.css";
import "./styles/diagnosticsDock.css";
import "./styles/resultsDrawerResize.css";
// The sheet-block surfaces. Kept out of App.css deliberately: that file is over
// ten thousand lines and shared by every lane, and roughly thirty of this
// feature's class names had no rule at all - including the one that positions
// the on-drawing port picker, which is why that control was invisible.
import "./styles/sheetBlocks.css";
/* PDF-6 remediation layers. Same one-owner-per-file discipline as the PDF-3
 * layers above, for the same reason: the six surfaces this pass touches
 * (explorer, tabs, rail, diagnostics, palette, titlebar) were worked in
 * parallel, and a shared App.css edit is where parallel passes collide.
 * Loaded last so a PDF-6 rule wins over the App.css rule it supersedes. */
import "./styles/pdf6Explorer.css";
import "./styles/pdf6Tabs.css";
import "./styles/pdf6Rail.css";
import "./styles/pdf6Diagnostics.css";
import "./styles/pdf6Palette.css";
import "./styles/pdf6Titlebar.css";
import {
  canonicalProjectSheetPath,
  projectRelativeSheetPath as relativeSheetPath,
  projectSheetInterfaceDrift,
  type ProjectSheetInterfaceEntry,
} from "./schematic/projectSubcircuit";
import { subcircuitBankSides, subcircuitPortSlots } from "./schematic/subcircuitGeometry";
import { Toolbar } from "./components/Toolbar";
import { StatusBar } from "./components/StatusBar";
import { ComponentMeasurementsPanel } from "./components/ComponentMeasurementsPanel";
import { formatEngineering } from "./simulation/quantity";
import { ASSISTANT_PANEL_WIDTH, loadAssistantOpen, saveAssistantOpen } from "./components/assistantPanelState";
import { PanelResizeHandle, usePanelWidth } from "./components/ui/resizable";
import { Toaster, toast } from "./components/ui/sonner";
import { Sheet, SheetContent, SheetTitle } from "./components/ui/sheet";
import {
  ANALYSIS_PANE_WIDTH,
  canFitIndependentColumns,
  resolveAnalysisPane,
  resolveChrome,
  workspaceWidth,
} from "./chrome/resolveChrome";
import { SURFACES } from "./chrome/surfaces";
import { AnalysisErrorBoundary } from "./components/AnalysisErrorBoundary";
import { EmptyState } from "./components/EmptyState";
import { ProbeIcon } from "./components/editor/ToolIcons";
import { LocalAiSetupDialog } from "./components/LocalAiSetupDialog";
import { ProjectSheetPortsDialog } from "./components/ProjectSheetPortsDialog";
import { UnsavedRecoveryDialog } from "./components/UnsavedRecoveryDialog";
import {
  ExternalEditConflictDialog,
  type PendingExternalEdit,
} from "./components/ExternalEditConflictDialog";
import { LearningPathCoach } from "./components/LearningPathCoach";
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
  componentsRailWidth,
  ComponentsRail,
  ExplorerPanel,
  ComponentInspector,
  WireInspector,
} from "./components/ShellPanels";
import { EditorTabs, EditorToolbar } from "./components/editor/EditorChrome";
import { ActivityRail } from "./components/shell/NavRail";
import { BottomPanel, mergeDiagnostics } from "./components/drawer/DiagnosticsTab";
import {
  diagnosticsHealth,
  diagnosticsVisibleCount,
  useDiagnosticsSeverityPolicy,
} from "./lib/diagnosticsHealth";
import { ResultsDrawer, type DrawerCover } from "./components/drawer/ResultsDrawer";
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
import { canUseNativeStepPath, nativeStepPathRefusal, stepAnalysisDomain } from "./simulation/nativeStepFamily";
import { useProject } from "./store/useProject";
import { loadProjectHierarchySheets, type OpenProjectDocument } from "./schematic/projectHierarchyRuntime";
import {
  buildProjectHierarchyDeck,
  ProjectHierarchyError,
  type ProjectHierarchySheet,
} from "./schematic/projectHierarchy";
import { readInstalledLtspiceModel } from "./project/installedLtspiceLibrary";
import {
  ascRewriteRisks,
  ascSaveBlockReason,
  basename,
  blankAscText,
  blankSimJson,
  isAscFile,
  isSimFile,
  joinPath,
  remapMovedProjectPath,
  serializeSchematicFile,
  type ProjectNode,
} from "./project/types";
import { isInteractiveSchematic, liveControlHint, liveControls } from "./schematic/liveControls";
import {
  MAX_MODEL_LIBRARIES,
  MAX_MODEL_LIBRARY_TOTAL_LENGTH,
  documentBackedNotices,
  liveSchematicDiagnostics,
  retiredKindNotices,
  unimportedPartLabels,
  validateSchematicDocument,
  type DiagnosticFocusTarget,
} from "./schematic/documentValidation";
import { strandedTerminalNotices } from "./schematic/relocatedPins";
import { importProjectAsc } from "./io/projectAscImport";
import { importDroppedFile } from "./io/fileImport";
import { pathExists, pickModelLibraryFile, readTextFile } from "./project/fsBridge";
import { isWorkspacePath } from "./project/defaultWorkspace";
import {
  carryAssistantProbes,
  type AssistantApplyCurrentAscAction,
  type AssistantCreateAscAction,
} from "./lib/assistantActions";
import { pickAutoRunAnalysis, type AutoRunAnalysis } from "./lib/assistantAutoRun";
import { technicalErrorDetails, userFacingErrorMessage } from "./lib/errorMessage";
import { useSimulationPreferences } from "./lib/simulationPreferences";
import { SHELL, SHELL_SEPARATORS, inspectorName } from "./components/shellContract";
import { RunTransport } from "./components/RunTransport";
import { LiveScopePane } from "./components/LiveScopePane";
import { useLiveRun, type LiveChannelRequest } from "./components/useLiveRun";
import { formatSeconds, type LiveRunStatus } from "./simulation/liveRun";
import { buildSpiceDeck, unresolvedSubcktMessage } from "./engine/spiceNetlist";
import type { NativeDeckBuilder } from "./engine/nativeSpice";
import { isActuable, isDraggableWiper } from "./schematic/actuation";
import type { SchematicComponent, SchematicPortDirection } from "./schematic/types";

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
 * The schematic renderer is the heaviest interactive surface in the app, but
 * the launch path is the project-start screen, where it cannot be seen or
 * used. Keep it out of the first renderer chunk and fetch it only once the
 * user opens, creates, or imports a circuit. The fallback preserves the
 * canvas surface while the editor becomes interactive; it is deliberately
 * decorative so it never creates a second landmark or an inert SVG in the
 * accessibility tree.
 */
const Canvas = lazy(async () => ({
  default: (await import("./components/Canvas")).Canvas,
}));

/** The command catalogue is only needed after its explicit Search affordance. */
const CommandPalette = lazy(async () => ({
  default: (await import("./components/CommandPalette")).CommandPalette,
}));

function CanvasLoadingSurface() {
  return <div className="canvas" aria-hidden="true" />;
}

/**
 * Same treatment for closed, user-summoned surfaces. `React.lazy` fetches when
 * its element is first *rendered*, so simply making the command palette and
 * modal editors lazy would still fetch their chunks during first paint. This
 * latch withholds each element until its affordance is first asked for, then
 * keeps it mounted for the session so close transitions and any retained form
 * state behave exactly as before.
 */
function useMountedOnceOpened(open: boolean): boolean {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  return mounted;
}


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
 * How long a CONTINUOUS run's deck is asked to last, counted in output steps of
 * the resolution Tau already chose for this circuit.
 *
 * A SPICE deck cannot express "run forever": `.tran` needs an end time, and
 * `live_spice.rs` reports reaching it as `analysis-complete`. So a live run is a
 * transient over a span chosen to be unreachable in practice rather than a
 * fictional infinity — a hundred million output points at the circuit's own
 * timestep, which at the measured ~500k solved points/s is hours of wall clock
 * for even a trivial RC and far longer for anything real.
 *
 * It is not hidden behind that arithmetic. The band under the transport prints
 * the resulting span, and if a run ever does reach it the stop is reported as
 * `horizon-reached` ("Finished at …") like any other ending, never as the user
 * having pressed Stop. Scaling by the circuit's own step rather than fixing a
 * number of seconds is what keeps the span meaningful across six decades of
 * circuit timescale.
 */
const LIVE_HORIZON_OUTPUT_STEPS = 100_000_000;

/**
 * How large a document still gets the deck-emitting half of the live
 * diagnostics pass (P3-14).
 *
 * The structural checks are cheap — one `extractCircuit` and a scan — but the
 * two classes only a deck can see (a named model that resolved nowhere, a
 * malformed directive) cost a full emission, and that runs once per edit. A
 * few hundred parts is the size at which that stops being free, and it is two
 * orders of magnitude above the schematics this check exists to help with;
 * `MAX_COMPONENTS` in documentValidation is 5,000, so the cap bites well
 * before the document does. Above it the pass degrades to structural-only
 * rather than making typing stutter, and Run still reports the rest.
 */
const LIVE_DECK_PROBE_MAX_COMPONENTS = 400;

/**
 * Traces a live run plots, capped at the scope's own palette.
 *
 * The engine will happily publish every node in the circuit, and a scope with
 * forty overlaid traces is not a measurement, it is a smear — and each extra
 * vector costs the solver throughput on every poll. Probed nets are taken
 * first so the user's own choices survive the cap, and the cap is reported
 * when it bites rather than silently dropping nets off the plot.
 */
const LIVE_MAX_CHANNELS = 6;

/**
 * `friendlyNetName` from `engine/nativeSpice.ts`, which does not export it.
 *
 * Copied rather than approximated because the live scope and the bounded
 * plotter show the same nets minutes apart: a net labelled `V(R1.C1)` while it
 * runs and `V(n003)` once it stops teaches the engineer that the two plots are
 * of different things. Three lines, and the alternative is exporting a private
 * helper out of the native engine module purely for a caption.
 */
function friendlyNetName(net: { id: string; pins: readonly { componentLabel: string }[] }): string {
  const labels = [...new Set(net.pins.map((pin) => pin.componentLabel).filter(Boolean))];
  return labels.length > 0 ? labels.slice(0, 2).join(".") : net.id;
}

/**
 * Which nets a live run plots, in the order it plots them, and how many it had
 * to leave out.
 *
 * Pure and exported so the ordering is testable without an engine: "the user's
 * probes come first" is the part that matters, because it is what makes the cap
 * survivable. `omitted` is returned rather than swallowed — a plot that quietly
 * shows six of forty nets is the same class of lie as one that hides a wrapped
 * buffer.
 */
export function liveScopeChannelRequests(
  nets: readonly { id: string; isGround: boolean; pins: readonly { componentLabel: string }[] }[],
  probedNetIds: ReadonlySet<string>,
  limit: number = LIVE_MAX_CHANNELS,
): { channels: LiveChannelRequest[]; omitted: number } {
  const plottable = nets.filter((net) => !net.isGround);
  const probed = (net: { id: string }) => probedNetIds.has(net.id.toLowerCase());
  const ordered = [...plottable.filter(probed), ...plottable.filter((net) => !probed(net))];
  const channels = ordered.slice(0, Math.max(0, limit)).map((net) => ({
    vector: `v(${net.id})`,
    label: `V(${friendlyNetName(net)})`,
    unit: "V",
  }));
  return { channels, omitted: ordered.length - channels.length };
}

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
  /**
   * Tau minted this file itself, in this session, as an empty untitled
   * schematic — `startNewCircuit` and nothing else (P3-05).
   *
   * It is deliberately NOT set by `saveTabToProject`'s own
   * `createSchematicInRoot` (that write already carries the user's circuit) nor
   * by the explorer's create (that file carries a name the user typed). The
   * marker exists so `discardMintedEmptyFile` can tell "a file Tau created and
   * the user never engaged with" from "a file that happens to be empty right
   * now", which is the difference between tidying up and destroying work.
   */
  tauMinted?: true;
}

/**
 * The names `createSchematicInRoot` can mint for an unnamed schematic:
 * `untitled.sim` plus the `-2`/`-3`/… ladder `numberedName` appends on a
 * collision (`store/useProject.ts`). That ladder is exactly what the report's
 * screenshot shows accumulating.
 *
 * `.asc` stays in the pattern even though nothing mints it any more. A session
 * that predates the `.sim` default, or a project carrying an `untitled.asc` a
 * previous version created, must still recognise its own scratch buffer -
 * otherwise those tabs stop being replaceable and start accumulating, which is
 * the exact symptom this pattern exists to prevent.
 *
 * Anchored at both ends on purpose: `untitled-2.backup.sim` and a user's own
 * `my-untitled.sim` must not match, and a rename off this shape is one of the
 * four things that has to keep the file — `renameProjectNode` rewrites the
 * tab's `title`/`filePath` from the new basename, so a renamed tab fails here.
 */
const UNTITLED_MINT_NAME = /^untitled(-\d+)?\.(?:sim|asc)$/i;

/**
 * Nothing in this document is worth a file on disk.
 *
 * Every authored collection is consulted, not just components and wires: a
 * sheet holding only a `.tran` directive, one net label, a probe, or a
 * preserved LTspice shape is content someone typed, and removing the file
 * under it would lose it. `ascSheet` is deliberately NOT consulted — a custom
 * sheet size rides along with any imported document and is geometry, not
 * content.
 */
function schematicDocumentIsEmpty(doc: SchematicDocument): boolean {
  return doc.components.length === 0
    && doc.wires.length === 0
    && (doc.probes?.length ?? 0) === 0
    && (doc.netLabels?.length ?? 0) === 0
    && (doc.directives?.length ?? 0) === 0
    && (doc.textAnnotations?.length ?? 0) === 0
    && (doc.ascShapes?.length ?? 0) === 0
    && (doc.ascDataFlags?.length ?? 0) === 0
    && (doc.ascForeignSymbols?.length ?? 0) === 0
    && (doc.ascHierarchicalBlocks?.length ?? 0) === 0
    && (doc.userModelLibraries?.length ?? 0) === 0
    && (doc.projectPorts?.length ?? 0) === 0;
}

/** Does the project tree still list this path? Recursive because a native
 *  project's tree is nested, and the file being asked about may sit in a
 *  subfolder. */
function projectTreeHasPath(nodes: readonly ProjectNode[], path: string): boolean {
  return nodes.some((node) => node.path === path || projectTreeHasPath(node.children ?? [], path));
}

const newTabId = () => `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const blankDocument = (): SchematicDocument => ({ components: [], wires: [], probes: [], netLabels: [] });
const emptyHistory = (): SchematicHistory => ({ past: [], future: [] });

export function schematicDocumentSignature(doc: SchematicDocument): string {
  // Internal ids are deliberately regenerated when a document is loaded so
  // two open copies never collide in the live store. They are not authored
  // circuit content and therefore must not make a clean import look edited.
  const componentIds = new Map(doc.components.map((component, index) => [component.id, `component:${index}`]));
  const netLabelIds = new Map((doc.netLabels ?? []).map((label, index) => [label.id, `net-label:${index}`]));
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
    // `copyDocument` remints net-label ids when a sheet is reopened. Project
    // ports point at those internal ids, so carrying the raw labelId here
    // makes a clean reopened child sheet look dirty even though its ordered
    // interface is unchanged. The label order is authored content and stays
    // stable across that remint; only the identity token is canonicalized.
    projectPorts: (doc.projectPorts ?? []).map(({ labelId, ...port }) => ({
      ...port,
      labelId: netLabelIds.get(labelId) ?? labelId,
    })),
  });
}

// responsive floor - App.css's `.editor-shell`/`.plotter` mirror these as
// a CSS backstop. The schematic column must stay usable - tabs, canvas
// overlays, and the results table - down to the app's stated 900px minimum
// Names the engine on an error result: nothing was returned to attribute, but
// the failure still came from whichever solver the run reached for.
const attemptedEngine = (): SimulationEngine => (isNativeSpiceRuntime() ? "ngspice" : "preview");

/** A project-linked sheet has one honest execution path: the packaged native
 * engine with the recursive project deck builder. `resolveEngineResult` is the
 * ordinary native-first helper for flat documents, but its preview fallback
 * would silently flatten a hierarchy if the bridge declined a request after
 * runtime detection. Refuse that case explicitly instead. */
function resolveAppEngineResult<T extends object>(
  native: T | null,
  fallback: () => T,
  projectHierarchyActive: boolean,
  analysisLabel: string,
): T & EngineProvenance {
  if (projectHierarchyActive && native === null) {
    throw new ProjectHierarchyError(
      "unsupported-child",
      `Project-linked hierarchy cannot run its ${analysisLabel} through Tau's packaged ngspice bridge; no preview or flattened fallback was used.`,
    );
  }
  return resolveEngineResult(native, fallback);
}

function projectHierarchyStepRefusal(
  domain: "AC" | "DC",
  specs: Parameters<typeof nativeStepPathRefusal>[0],
  components: readonly SchematicComponent[],
): ProjectHierarchyError {
  const detail = nativeStepPathRefusal(specs, { components })
    ?? "Tau's native single-deck step bridge did not return a family.";
  return new ProjectHierarchyError(
    "unsupported-child",
    `Project-linked ${domain} stepping is refused: ${detail} Tau will not run a preview family or flatten the linked sheet.`,
  );
}

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
  const projectPorts = useSchematic((s) => s.projectPorts);
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
  const clearSheet = useSchematic((s) => s.clearSheet);
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
  const [tabs, setTabs] = useState<OpenTab[]>([{ id: "tab-0", title: "untitled.sim", doc: null, history: emptyHistory() }]);
  const tabsRef = useRef(tabs);
  const projectRenameInFlightRef = useRef<Promise<string | null> | null>(null);
  const [activeId, setActiveId] = useState("tab-0");
  /** ASC import warnings keyed by document path (shown in Diagnostics). */
  const [importWarningsByPath, setImportWarningsByPath] = useState<Record<string, string[]>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [simulationSetupOpen, setSimulationSetupOpen] = useState(false);
  const [projectSheetPortsOpen, setProjectSheetPortsOpen] = useState(false);
  const paletteMounted = useMountedOnceOpened(paletteOpen);
  const simulationSetupMounted = useMountedOnceOpened(simulationSetupOpen);
  const projectSheetPortsMounted = useMountedOnceOpened(projectSheetPortsOpen);
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
  /** Pixels of canvas the results drawer is covering, per axis; see its
   *  onCoverChange. Axis-tagged because docked right its `height` is the whole
   *  column and reserving that along the bottom collapses the fit box. */
  const [drawerCover, setDrawerCover] = useState<DrawerCover>({ bottom: 0, right: 0 });
  /**
   * Stable and value-comparing, and both halves of that are load-bearing.
   *
   * The drawer's measuring effect is keyed on this function's identity and its
   * cleanup reports zero, so an inline arrow - a new function every render -
   * would tear the effect down and republish a zero cover on every commit,
   * making the canvas fit and the inspector flicker between reserving the
   * band and not. `useCallback` with no deps fixes that half.
   *
   * The comparison fixes the other half: a ResizeObserver re-reports the same
   * rect on layout churn, and handing `setDrawerCover` a fresh object each
   * time would re-render everything downstream of `inspectorViewport` for a
   * value that did not change.
   */
  const handleDrawerCover = useCallback((next: DrawerCover) => {
    setDrawerCover((current) =>
      current.bottom === next.bottom && current.right === next.right ? current : next);
  }, []);

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
  /** Canvas owns the gesture; the floating inspector only suspends for that gesture. */
  const [selectedComponentDragActive, setSelectedComponentDragActive] = useState(false);
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
  /** The analysis pane's remembered width, dragged by the split's divider.
   *  Bounds come from `resolveAnalysisPane` below, not from this config -
   *  the static ones only guard a stale localStorage value. */
  const analysisPaneResize = usePanelWidth(ANALYSIS_PANE_WIDTH);
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
  /** The options the transient currently on screen was solved with — see
   *  `executeTransient`. Null when no transient result is standing. */
  const lastTransientOptionsRef = useRef<AnalysisOptions | null>(null);
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
  const projectTree = useProject((s) => s.tree);
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

  const documentTitle = (tabs.find((tab) => tab.id === activeId) ?? tabs[0])?.title ?? "untitled.sim";
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
    ...(projectPorts.length > 0 ? { projectPorts } : {}),
  }), [ascDataFlags, ascForeignSymbols, ascHierarchicalBlocks, ascSheet, ascShapes, components, directives, netLabels, probes, projectPorts, textAnnotations, userModelLibraries, wires]);
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

  const projectHierarchyActive = components.some((component) => component.projectSubcircuit !== undefined);
  const openProjectDocuments = useMemo<OpenProjectDocument[]>(() => {
    const documents: OpenProjectDocument[] = [];
    for (const tab of tabs) {
      if (!tab.filePath) continue;
      const document = tab.id === activeId ? currentDocument : tab.doc;
      if (document) documents.push({ path: tab.filePath, document });
    }
    return documents;
  }, [activeId, currentDocument, tabs]);

  /*
   * THE SHEET-INTERFACE INDEX - what every sibling Tau sheet declares as its
   * public interface right now.
   *
   * This is the thing that turns "retype the child's ports in the right order"
   * into "choose a sheet". Three properties are load-bearing:
   *
   * 1. ADVISORY ONLY. `buildProjectHierarchyDeck` stays the sole judge of a
   *    link. This index never authorises a run; it only stops the UI asking the
   *    reader for something the project already knows. If it is wrong, a run
   *    still refuses.
   * 2. AN OPEN TAB WINS over the same path on disk, because an unsaved
   *    interface edit is the copy the reader is reasoning about. Which one was
   *    read is reported as `comparedSource` so a drift review can say so.
   * 3. EMPTY MEANS "NOT CHECKED", never "agrees". The drift classifier has a
   *    distinct `not-checked` arm for exactly this, and conflating the two
   *    would let a stale link look healthy.
   *
   * Held in state and filled by an effect rather than derived in a memo,
   * because reading a sibling sheet is asynchronous - `readSim` crosses the
   * Tauri boundary - and a memo cannot await.
   */
  const [sheetInterfaceIndex, setSheetInterfaceIndex] = useState<readonly ProjectSheetInterfaceEntry[]>([]);

  useEffect(() => {
    if (!projectRootPath) { setSheetInterfaceIndex([]); return; }
    let cancelled = false;
    const readSheet = useProject.getState().readSim;

    const entryFor = (
      absolutePath: string,
      doc: SchematicDocument | null,
      unreadable?: string,
    ): ProjectSheetInterfaceEntry | null => {
      const relative = relativeSheetPath(projectRootPath, absolutePath);
      const sheetPath = relative ? canonicalProjectSheetPath(relative) : null;
      if (!sheetPath) return null;
      const fileName = basename(absolutePath);
      if (unreadable) return { sheetPath, fileName, status: "unreadable", ports: [], reason: unreadable };
      const ports = doc?.projectPorts ?? [];
      return ports.length > 0
        ? { sheetPath, fileName, status: "ok", ports }
        : { sheetPath, fileName, status: "no-interface", ports: [] };
    };

    void (async () => {
      const byPath = new Map<string, ProjectSheetInterfaceEntry>();
      // Open tabs first; a later disk read must not overwrite them.
      for (const tab of tabsRef.current) {
        if (!tab.filePath || !isSimFile(tab.filePath)) continue;
        const doc = tab.id === activeId ? currentDocument : tab.doc ?? null;
        const entry = entryFor(tab.filePath, doc);
        if (entry) byPath.set(entry.sheetPath, entry);
      }
      const files: string[] = [];
      const walk = (nodes: readonly ProjectNode[]) => {
        for (const node of nodes) {
          if (node.kind === "dir") { walk(node.children ?? []); continue; }
          if (isSimFile(node.name)) files.push(node.path);
        }
      };
      walk(projectTree);
      for (const path of files) {
        const relative = relativeSheetPath(projectRootPath, path);
        const sheetPath = relative ? canonicalProjectSheetPath(relative) : null;
        if (!sheetPath || byPath.has(sheetPath)) continue;
        try {
          const raw = await readSheet(path);
          if (cancelled) return;
          const entry = entryFor(path, validateSchematicDocument(JSON.parse(raw)));
          if (entry) byPath.set(entry.sheetPath, entry);
        } catch (error) {
          if (cancelled) return;
          const entry = entryFor(path, null, error instanceof Error ? error.message : "This sheet could not be read.");
          if (entry) byPath.set(entry.sheetPath, entry);
        }
      }
      if (!cancelled) setSheetInterfaceIndex([...byPath.values()]);
    })();

    return () => { cancelled = true; };
  }, [projectRootPath, projectTree, activeId, currentDocument]);

  /*
   * Drift per linked instance, derived from that index.
   *
   * Deliberately NOT a repaint. A drifted instance keeps every pin and every
   * wire exactly where its stored contract put them, because the stored
   * contract is precisely what will be netlisted; moving the picture to match a
   * child the netlist does not yet use would be the one lie this feature cannot
   * afford. The annotation is an argument addressed to the reader, and the
   * resync action is the only thing allowed to move geometry.
   *
   * `no-interface` is folded into `drifted` rather than given its own lamp: from
   * the instance's point of view a child that has stopped declaring any ports is
   * a contract that no longer matches, and the sentence says which.
   */
  const subcircuitDrift = useMemo(() => {
    const map = new Map<string, { kind: "drifted" | "missing-sheet" | "sheet-unreadable"; sentence: string; pins?: readonly string[] }>();
    for (const component of components) {
      const link = component.projectSubcircuit;
      if (!link) continue;
      const entry = sheetInterfaceIndex.find((candidate) => candidate.sheetPath === link.sheetPath) ?? null;
      const current = subcircuitBankSides(component).map((side) => side ?? "left");
      const expected = entry?.status === "ok"
        ? subcircuitPortSlots(entry.ports.map((port) => port.name), entry.ports.map((port) => port.direction))
            .map((slot) => slot.side)
        : [];
      const drift = projectSheetInterfaceDrift(link.ports, entry, { current, expected });
      switch (drift.kind) {
        case "in-sync":
        case "not-checked":
          continue;
        case "missing-sheet":
          map.set(component.id, { kind: "missing-sheet", sentence: `${link.sheetPath} is not in this project any more.` });
          continue;
        case "sheet-unreadable":
          map.set(component.id, { kind: "sheet-unreadable", sentence: drift.reason });
          continue;
        case "no-interface":
          map.set(component.id, {
            kind: "drifted",
            sentence: `${link.sheetPath} no longer declares any ports, so this block's contract matches nothing.`,
          });
          continue;
        case "drifted":
          map.set(component.id, {
            kind: "drifted",
            sentence: drift.summary,
            pins: drift.rows.map((row) => `p${row.position}`),
          });
          continue;
      }
    }
    return map;
  }, [components, sheetInterfaceIndex]);






  const [projectHierarchyContext, setProjectHierarchyContext] = useState<{
    rootPath: string;
    sheets: ProjectHierarchySheet[];
  } | null>(null);
  const [projectHierarchyLoadError, setProjectHierarchyLoadError] = useState<unknown>(null);

  // Project-linked sheets are a separate compile input, not a hint for the
  // ordinary root emitter. Refresh the complete candidate set whenever the
  // project, active file, open-tab snapshots, or link contract changes. A
  // missing/stale context deliberately produces a refusal until this load
  // finishes; no flat-deck fallback is allowed.
  useEffect(() => {
    let cancelled = false;
    setProjectHierarchyContext(null);
    setProjectHierarchyLoadError(null);
    if (!projectHierarchyActive) return () => { cancelled = true; };
    if (!projectRootPath || !activeFilePath) {
      setProjectHierarchyLoadError(new ProjectHierarchyError(
        "invalid-path",
        "Project-linked sheets must be saved inside an open project before they can run.",
      ));
      return () => { cancelled = true; };
    }
    void loadProjectHierarchySheets({
      projectRoot: projectRootPath,
      rootSheetPath: activeFilePath,
      tree: projectTree,
      readText: readProjectText,
      openDocuments: openProjectDocuments,
    }).then((context) => {
      if (cancelled) return;
      setProjectHierarchyContext(context);
    }).catch((error: unknown) => {
      if (cancelled) return;
      setProjectHierarchyLoadError(error);
    });
    return () => { cancelled = true; };
  }, [activeFilePath, openProjectDocuments, projectHierarchyActive, projectRootPath, projectTree]);

  const makeProjectDeckBuilder = useCallback((
    root: SchematicDocument,
    rootParams: ParamScope,
    rootDirectives: readonly string[] = root.directives ?? [],
  ): NativeDeckBuilder => (analysis, deckOptions = {}) => {
    if (!projectHierarchyActive) {
      return buildSpiceDeck({
        components: root.components,
        wires: root.wires,
        netLabels: root.netLabels,
        params: rootParams,
        directives: [...rootDirectives],
        ascForeignSymbols: root.ascForeignSymbols,
        userModelLibraries: userModelLibraryTexts,
        userModelLibraryNames,
      }, analysis, deckOptions);
    }
    if (!projectHierarchyContext) {
      const detail = projectHierarchyLoadError instanceof Error
        ? projectHierarchyLoadError.message
        : "linked project sheets are still loading";
      throw new ProjectHierarchyError("missing-sheet", `Project hierarchy is unavailable: ${detail}`, activeFilePath ?? undefined);
    }
    return buildProjectHierarchyDeck({
      rootPath: projectHierarchyContext.rootPath,
      root,
      sheets: projectHierarchyContext.sheets,
      analysis,
      rootDeck: {
        params: rootParams,
        directives: rootDirectives,
        userModelLibraries: userModelLibraryTexts,
        userModelLibraryNames,
        ascForeignSymbols: root.ascForeignSymbols,
      },
      deckOptions,
    }).deck;
  }, [activeFilePath, projectHierarchyActive, projectHierarchyContext, projectHierarchyLoadError, userModelLibraryNames, userModelLibraryTexts]);

  const assertProjectHierarchyCanRun = useCallback(() => {
    if (projectHierarchyActive && !isNativeSpiceRuntime()) {
      throw new ProjectHierarchyError(
        "unsupported-child",
        "Project-linked hierarchy requires Tau's packaged ngspice engine; the preview solver will not flatten or approximate it.",
        activeFilePath ?? undefined,
      );
    }
  }, [activeFilePath, projectHierarchyActive]);
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

  /*
   * "This net is an input/output of this sheet", as ONE undo step.
   *
   * The net's name and the ordered port that rides it are written together by
   * the store action, so the two can never disagree - which is the whole reason
   * the draft commits through here instead of `upsertNetLabel` when a direction
   * is chosen.
   */
  const commitNetLabelPort = useCallback((
    x: number,
    y: number,
    text: string,
    direction: SchematicPortDirection | null,
  ): { ok: boolean; error?: string } => {
    const result = useSchematic.getState().upsertNetLabelPort(x, y, text, direction);
    // The result is RETURNED, not swallowed: the draft keeps itself open and
    // shows the reason inline, which is the difference between "that name is
    // taken" landing where the reader is typing and landing in a toast they
    // have already looked away from. A notice as well would be two voices.
    return result;
  }, []);

  /**
   * Why this sheet cannot be given an interface, or null when it can.
   *
   * `.asc` used to be refused here, and no longer is: an LTspice sheet states
   * its ports as a `FLAG` plus an adjacent `IOPIN <dir>`, the compiler reads
   * that contract, and the save path keeps it. The refusal outlived its reason
   * the moment the engine learned to read those markers, and leaving it in place
   * would have made the whole `.asc` half of the feature unreachable from the
   * UI - the same "built but not wired" failure this pass exists to remove.
   *
   * The one thing a `.asc` still cannot do is OWN a block, which is a different
   * question asked in a different place (`canonicalProjectOwnerPath`).
   */
  const sheetInterfaceDisabledReason = useMemo(() => {
    const path = activeFilePath;
    if (!path) return "Save this sheet into the project before giving it an interface.";
    return null;
  }, [activeFilePath]);

  /**
   * Which sheets instantiate the sheet in front of us, for the child's dialog.
   *
   * This can only see OPEN TABS, so a parent that is saved but closed is
   * invisible to it. That makes an empty result ambiguous, and the two readings
   * are not equally safe: "no sheet uses this" invites the user to change an
   * interface freely, while "I don't know" does not. So an empty result returns
   * `undefined`, which is the prop's own spelling for "not told" and makes the
   * dialog withhold the claim instead of asserting a falsehood. A NON-empty
   * result is still reported, because finding a user among open tabs is a true
   * positive regardless of what is closed.
   */
  const sheetUsedBy = useMemo(() => {
    if (!projectRootPath || !activeFilePath) return undefined;
    const relative = relativeSheetPath(projectRootPath, activeFilePath);
    const me = relative ? canonicalProjectSheetPath(relative) : null;
    if (!me) return undefined;
    const rows: { sheetPath: string; reference: string }[] = [];
    for (const tab of tabsRef.current) {
      const doc = tab.id === activeId ? currentDocument : tab.doc;
      if (!doc || !tab.filePath) continue;
      const tabRelative = relativeSheetPath(projectRootPath, tab.filePath);
      const from = tabRelative ? canonicalProjectSheetPath(tabRelative) : null;
      if (!from || from === me) continue;
      for (const component of doc.components) {
        if (component.projectSubcircuit?.sheetPath === me) {
          rows.push({ sheetPath: from, reference: component.label || component.id });
        }
      }
    }
    return rows.length > 0 ? rows : undefined;
  }, [projectRootPath, activeFilePath, activeId, currentDocument]);

  // The default shell never exposes a model-file browser. An unresolved
  // selected part still has one intentional, file-driven recovery route: the
  // inspector can open a vendor `.lib`/`.sub` picker, and the chosen text is
  // attached to the active schematic so exact resolution remains intact.
  const attachModelFile = useCallback(async () => {
    try {
      const picked = await pickModelLibraryFile();
      if (!picked) return;
      const libraries = useSchematic.getState().userModelLibraries;
      if (libraries.length >= MAX_MODEL_LIBRARIES && !libraries.some((library) => library.name === picked.name)) {
        showNotice(`Tau supports up to ${MAX_MODEL_LIBRARIES} attached model files.`);
        return;
      }
      const existingTotal = libraries
        .filter((library) => library.name !== picked.name)
        .reduce((sum, library) => sum + library.text.length, 0);
      if (existingTotal + picked.text.length > MAX_MODEL_LIBRARY_TOTAL_LENGTH) {
        showNotice(`Attaching ${picked.name} would exceed the ${MAX_MODEL_LIBRARY_TOTAL_LENGTH.toLocaleString("en-US")}-character limit for attached model files.`);
        return;
      }
      useSchematic.getState().attachModelLibrary(picked);
      showNotice(`Attached ${picked.name} to this schematic.`);
    } catch (error) {
      showNotice(userFacingErrorMessage(error, "Could not attach that .lib or .sub file."));
    }
  }, [showNotice]);

  // Radix only restores focus to a `<Dialog.Trigger>` automatically. Settings
  // has entry points living in components far from where `<Dialog>` mounts
  // below, so none of them is a `Dialog.Trigger` - Radix's own restoration is
  // a silent no-op here. This ref plus `Dialog`'s `onCloseAutoFocus` (below) is
  // the manual equivalent: remember what had focus when Settings opened, and
  // hand it back when Settings closes.
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

  useEffect(() => {
    const openFromNativeMenu = () => openSettingsSurface();
    window.addEventListener("tau:open-settings", openFromNativeMenu);
    return () => window.removeEventListener("tau:open-settings", openFromNativeMenu);
  }, [openSettingsSurface]);

  /**
   * Whether the live scope is describing the circuit that is open now.
   *
   * The scope is mounted on `liveRun.ring`, which the hook creates once per run
   * and never clears — right for the run itself (a trace must survive its own
   * Stop; that is the whole point of looking at it) and wrong across documents.
   * Nothing in `useLiveRun` knows a document exists, so the answer has to be
   * kept here: `invalidateAnalysis` is the one call every document-navigation
   * route already makes to drop the results that no longer describe the sheet,
   * and a live trace solved from the previous document is exactly such a
   * result. Without this, opening another circuit and returning to the
   * simulator showed the old one's waveform under the new one's name.
   */
  const [liveScopeShown, setLiveScopeShown] = useState(false);

  /**
   * Whether the live session is still the most recent thing that ran.
   *
   * The transport shares one status line between two mechanisms that know
   * nothing about each other, and `liveRun.status` keeps its last stop reason
   * for as long as the hook is mounted. So once a live run had ended, the line
   * a finished WINDOW run left behind was the LIVE session's — a bounded
   * transient that completed normally could report "solution diverged" from a
   * different run minutes earlier. A stale reason attached to the wrong run is
   * worse than no reason at all, so a bounded run takes the line back.
   */
  const [lastRunWasLive, setLastRunWasLive] = useState(false);

  const invalidateAnalysis = useCallback((state: "idle" | "stopped" = "idle") => {
    analysisRequestRef.current += 1;
    setLiveScopeShown(false);
    setLiveActuationDisclosures({});
    lastTransientOptionsRef.current = null;
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

  /**
   * The document's own `.tran` line, verbatim, so the transport can quote the
   * file rather than paraphrase it ("From this file's .tran 5m").
   *
   * `analysesFromDirectives` gives the parsed numbers; this gives the words the
   * author wrote, which is what a reader recognises when Tau claims to be
   * reproducing their file.
   */
  const authoredTranDirective = useMemo(
    () => directives.find((line) => /^\s*\.tran\b/i.test(line))?.trim() ?? null,
    [directives],
  );

  /**
   * The running circuit.
   *
   * LIVE is the default and an authored `.tran` pre-selects WINDOW at that
   * duration — that decision is `defaultRunPlan`'s, inside the hook, so this
   * file cannot develop a second opinion about it.
   */
  const liveRun = useLiveRun({
    authoredTran: authoredAnalysisOptions ?? null,
    authoredDirective: authoredTranDirective,
    onNotice: showNotice,
  });
  const { start: startLiveSession_, stop: stopLiveRun, actuate: actuateLiveRun } = liveRun;
  const liveRunning = liveRun.running;
  /**
   * The circuit as it stood the last time the running deck was synchronised
   * with it.
   *
   * `Canvas`'s `onActuate` says only "something was operated", not which part,
   * so the components that changed are worked out by diffing against this. It
   * is set when a live run starts and advanced every time a change is sent, so
   * a burst of pointer moves during a wiper drag diffs against what the engine
   * last received rather than against the start of the run.
   */
  const liveComponentsRef = useRef<SchematicComponent[]>([]);
  /** Read by the actuation effect, which must keep its original dependencies —
   *  adding `liveRunning` to them would re-fire it on every start and stop. */
  const liveRunningRef = useRef(liveRunning);
  liveRunningRef.current = liveRunning;
  /**
   * The circuit each operated control briefly left the run solving, keyed by
   * the control it belongs to.
   *
   * Tau's engine bridge alters one instance per command, so a part the emitter
   * spells as two resistors cannot change atomically: the run resumes between
   * the two alters and genuinely integrates something that is neither the old
   * circuit nor the new one — an SPDT with both throws open and COM floating on
   * two 1e12 Ω resistors, or a pot holding a track total no real part has. That
   * interval is milliseconds long, it is visible in the trace as a transient
   * nothing on the sheet accounts for, and `LiveActuationPlan.intermediate`
   * already writes the sentence for it. Storing it here is what puts that
   * sentence in front of the reader instead of computing it and dropping it,
   * which is precisely the silent smoothing-over AGENTS.md forbids.
   *
   * Keyed by control rather than kept as a single latest sentence: two controls
   * can each have left their own artefact in the same trace, and collapsing
   * them would silently retract the first one.
   */
  const [liveActuationDisclosures, setLiveActuationDisclosures] =
    useState<Readonly<Record<string, string>>>({});
  /** Only ever called with a genuinely different value, so a burst of wiper
   *  moves that keeps producing the same sentence does not re-render the band. */
  const noteActuationDisclosure = useCallback((controlId: string, sentence: string | null) => {
    setLiveActuationDisclosures((previous) => {
      const current = previous[controlId] ?? null;
      if (current === sentence) return previous;
      const next = { ...previous };
      if (sentence === null) delete next[controlId];
      else next[controlId] = sentence;
      return next;
    });
  }, []);
  /** `stopAnalysis` is declared far below this point but the transport is wired
   *  above it, and the bounded abort path must stay exactly the one control the
   *  drawer and the editor toolbar already call — not a second copy of it. */
  const stopAnalysisRef = useRef<() => void>(() => {});

  /**
   * Whether this live session has already been told why it is ending.
   *
   * `stopLiveRun` records an intent synchronously but `liveRun.running` does
   * not go false until the halt has round-tripped through the engine, so the
   * app can ask a second time in the same event and the LAST intent is the one
   * the user reads. That is how leaving the simulator came to report
   * "the circuit changed": every document-navigation route calls
   * `leaveSimulator()` and then replaces the store's components in the same
   * event, the edit effect below runs while `running` is still true, and its
   * `circuit-edited` overwrote the true reason.
   *
   * First reason wins, because the first thing that happened is why the run
   * ended — the document did not change and then get abandoned, it was
   * abandoned and then changed. Reset when a run starts, not when one ends: the
   * halt is asynchronous and a flag cleared on `running` going false would
   * reopen the same window it exists to close.
   */
  const liveStopReasonClaimedRef = useRef(false);
  const claimLiveStop = useCallback((intent: Parameters<typeof stopLiveRun>[0]) => {
    if (liveStopReasonClaimedRef.current) return;
    liveStopReasonClaimedRef.current = true;
    stopLiveRun(intent);
  }, [stopLiveRun]);

  /**
   * Leave the simulator, stopping whatever it was solving on the way out.
   *
   * Every route back to the schematic goes through here: the header's mode
   * toggle, the activity rail, the tab strip's hide button, opening or closing
   * a document, applying an assistant circuit, and clearing the sheet. That is
   * the whole point of centralising it — a route that skipped it would leave a
   * solver running against a circuit nobody is looking at, and a *partly*
   * patched set of routes is worse than none, because the one that leaks is
   * invisible until the machine gets hot.
   *
   * Deliberately NOT a `useEffect` on `mode`. An effect runs after the commit
   * that already painted the schematic, which leaves a window — one poll, up to
   * 20 ms — in which a live frame can land against a view the user has left.
   * `stopLiveRun` clears the session's poll timer synchronously, before the
   * halt is even sent, so calling it inline closes that window entirely.
   */
  const leaveSimulator = useCallback(() => {
    claimLiveStop("left-simulator");
    setMode("schematic");
  }, [claimLiveStop]);

  /** The mode toggle in both chrome surfaces. Entering is a plain state change;
   *  leaving is never one. */
  const changeMode = useCallback((next: "schematic" | "simulator") => {
    if (next === "schematic") {
      leaveSimulator();
      return;
    }
    setMode("simulator");
  }, [leaveSimulator]);

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

  const nativeSchematic = useMemo(() => ({
    components,
    wires,
    netLabels,
    params,
    directives,
    userModelLibraries: userModelLibraryTexts,
    userModelLibraryNames,
    ...(projectHierarchyActive ? { buildDeck: makeProjectDeckBuilder(currentDocument, params) } : {}),
  }), [components, currentDocument, directives, makeProjectDeckBuilder, netLabels, params, projectHierarchyActive, userModelLibraryNames, userModelLibraryTexts, wires]);

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
    // Every bounded run in the app opens here, which makes this the one place
    // that can honestly answer "is the live session still the most recent thing
    // that ran?" for the transport's status line. See `transportStatus`.
    setLastRunWasLive(false);
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
   * One engine, one lease — said out loud instead of discovered.
   *
   * The live session holds ngspice for as long as it runs, and the Rust side
   * refuses any other analysis while it does ("A live simulation is running.
   * Stop it before starting another analysis."). Nothing up here knew that.
   * Selecting a tab in the analysis rail IS the run gesture, so a reader could
   * ask for `.op` mid-run, get the interlock's sentence back as a FAILED
   * result, and have it stored as this circuit's operating point — one that
   * then survived stopping the run, because a stored result keyed to the right
   * document counts as fresh. An engine refusal is not an answer about a
   * circuit and must never be filed as one.
   *
   * Refused here rather than by disabling the tabs: a control that silently
   * does nothing teaches nothing, and the fix (stop the run) is one sentence.
   */
  const refuseWhileLive = useCallback(
    (run: () => void | Promise<void>) => () => {
      if (liveRunningRef.current) {
        showNotice("A live run is using the engine. Stop it before starting another analysis.");
        return;
      }
      void run();
    },
    [showNotice],
  );

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
    // A run that never reached the solver is not this circuit's answer, so it
    // cannot let a tab selection skip the run. "Show me this" is entitled to
    // another attempt when the last one failed — the failure may have been the
    // engine being busy, a library that has since been installed, or anything
    // else outside the document signature this key is built from. Pressing Run
    // was already the only way back, which made a transient refusal permanent
    // for as long as the sheet went untouched.
    if (!result.ok) return false;
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

  /**
   * Everything wrong with the document as drawn, with no run required (P3-14).
   *
   * The Errors dock used to be a run REPORT: it could only ever say "No
   * analysis yet" over a schematic with no ground, no source and two stranded
   * terminals. `liveSchematicDiagnostics` is the linter half of
   * `documentValidation.ts` and answers the same questions from the document
   * alone.
   *
   * Memoised on the store slices themselves rather than on `currentSignature`,
   * because those references only change when the document changes — a
   * signature comparison would re-serialize the whole sheet on every render to
   * discover the same thing.
   *
   * `probeDeck` is the expensive class (a named model that resolved nowhere, a
   * malformed directive) and is only worth paying for on a document small
   * enough that emitting a deck between keystrokes is not felt. Above the
   * threshold the pass degrades to the structural checks rather than making
   * the editor stutter, and the deck's own errors surface on Run as they
   * always did.
   *
   * Schematic mode only, and not merely because that is where the report asks
   * for it: in the simulator the same dock already lists the run's own
   * `warnings`, which come from the same `extractCircuit` call, so running
   * both would print every floating-pin warning twice.
   */
  const liveDiagnostics = useMemo(() => (mode !== "schematic" ? [] : liveSchematicDiagnostics({
    components,
    wires,
    netLabels,
    ascForeignSymbols,
    ...(components.length <= LIVE_DECK_PROBE_MAX_COMPONENTS
      ? {
        probeDeck: () => {
          // A plain operating point: the cheapest card that still forces the
          // whole deck — every device model, every `.param`, every directive
          // — to be emitted and therefore validated. Linked sheets go through
          // the same recursive compiler as Run; they never fall back to the
          // flat root emitter when a sibling is missing or still loading.
          if (projectHierarchyActive) {
            nativeSchematic.buildDeck?.({ kind: "op" });
            return;
          }
          buildSpiceDeck(nativeSchematic, { kind: "op" });
        },
      }
      : {}),
  })), [
    mode, components, wires, netLabels, ascForeignSymbols, params, directives,
    userModelLibraryTexts, userModelLibraryNames, nativeSchematic, projectHierarchyActive,
  ]);

  /**
   * What an Errors row does when it is clicked: take the reader to the part it
   * is complaining about.
   *
   * Selecting is the half this file can do today, and it is the half that
   * matters on a schematic that fits the viewport — the part highlights and
   * the inspector opens on it. Canvas also accepts a separate structured
   * reveal target, so net diagnostics can pan without selecting a component.
   */
  const [revealTarget, setRevealTarget] = useState<{ id: string; signal: number }>({ id: "", signal: 0 });
  const [revealNetTarget, setRevealNetTarget] = useState<{ point: { x: number; y: number } | null; signal: number }>({ point: null, signal: 0 });
  const revealDiagnosticComponent = useCallback((componentId: string) => {
    select(componentId);
    // Selecting says WHICH part; this says WHERE. Canvas pans it into view
    // without touching zoom, and does nothing when it is already on screen, so
    // clicking an error never reframes the sheet under the reader. The signal
    // is bumped rather than compared, so clicking the same row twice still
    // works after the reader has panned away.
    setRevealTarget((prev) => ({ id: componentId, signal: prev.signal + 1 }));
  }, [select]);

  /*
   * The drift lamp on the drawing selects the block and brings it into view.
   *
   * Deliberately NOT a second dialog: the review lives in the inspector
   * (ProjectInterfaceReviewDialog, rendered from ComponentInspector), which is
   * the surface that already owns the contract and the resync action. Opening a
   * competing copy from here would give the same decision two homes and two
   * pieces of state to disagree about. Clicking the lamp therefore does what
   * clicking the block does, and the reader continues in one place.
   */
  const reviewSubcircuitDrift = useCallback((componentId: string) => {
    revealDiagnosticComponent(componentId);
  }, [revealDiagnosticComponent]);
  const focusDiagnostic = useCallback((target: DiagnosticFocusTarget) => {
    if (target.kind === "component") {
      revealDiagnosticComponent(target.componentId);
      return;
    }
    setRevealNetTarget((prev) => ({
      point: { x: target.x, y: target.y },
      signal: prev.signal + 1,
    }));
  }, [revealDiagnosticComponent]);

  /**
   * The live rows the dock will actually render, with anything the run has
   * already said removed.
   *
   * The live pass and `extractCircuit` answer some questions from the same
   * code, so they produce the same STRING — "No ground symbol found." and the
   * single-pin warnings especially. Leaving the simulator does not invalidate
   * the analysis, so carrying a failed run back into the editor put both
   * copies on screen at once: the dock printed the same sentence twice and the
   * badge counted it twice. That is the reported state (the evidence
   * screenshot is the editor after a run), so the de-duplication has to happen
   * here rather than being left to the reader.
   *
   * The run's row is the one kept, because it is the one that carries
   * `role="alert"` and the failure's own ordering; the live copy is redundant
   * on a document the run has already judged.
   */
  /**
   * This document's import notices, re-checked against this document.
   *
   * `importWarningsByPath` is a snapshot taken once, at open time, so a notice
   * naming a skipped part outlived the part: clearing the sheet (or opening a
   * replacement over the same path) left the dock reporting a device that was
   * no longer anywhere in the document, above an empty canvas. The filter runs
   * on every read of these notices - the merge, the badge and the panel - so
   * the three cannot disagree about how many there are.
   */
  const activeImportNotices = useMemo(
    () => documentBackedNotices(
      activeFilePath ? importWarningsByPath[activeFilePath] ?? [] : [],
      ascForeignSymbols,
      ascHierarchicalBlocks,
    ),
    [activeFilePath, ascForeignSymbols, ascHierarchicalBlocks, importWarningsByPath],
  );

  const diagnosticMerge = useMemo(
    () => mergeDiagnostics(activeAnalysis, activeImportNotices, liveDiagnostics, analysisRunning),
    [activeAnalysis, activeImportNotices, analysisRunning, liveDiagnostics],
  );
  const dockIssues = diagnosticMerge.liveIssues;

  /* The user's warning policy, read live so flipping it in Settings repaints
     the lamp, the badge and the window together rather than after a reload. */
  const severityPolicy = useDiagnosticsSeverityPolicy();
  /**
   * Whether the rail's `!` is currently showing the diagnostics window.
   *
   * The `!` raises and hides the results drawer on its Errors tab rather than
   * mounting and unmounting the panel. That is what "bring up the error window
   * below / clicked again it should hide it" means in a shell that already has
   * one: the Errors tab has to stay mounted so the live linter can list what is
   * wrong with a sheet before it is ever run (P3-14), and the thing the button
   * changes is whether the reader can see it.
   *
   * Two nonces rather than one boolean prop, matching the drawer's existing
   * `raiseSignal` discipline: the drawer owns its own height (the user can drag
   * it), so it takes instructions, not state. Dragging the drawer by hand can
   * therefore leave the lamp's pressed state describing the last thing the
   * BUTTON did rather than the drawer's current height - a known, small
   * imprecision, and the alternative is the button fighting the drag.
   */
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticsRaise, setDiagnosticsRaise] = useState(0);
  const [diagnosticsCollapse, setDiagnosticsCollapse] = useState(0);
  const toggleDiagnosticsWindow = useCallback(() => {
    setDiagnosticsOpen((open) => {
      if (open) setDiagnosticsCollapse((n) => n + 1);
      else setDiagnosticsRaise((n) => n + 1);
      return !open;
    });
  }, []);

  /* PDF-6 item 6. The badge, the rail's health lamp and the diagnostics window
     must all answer to the same policy: under `errors-only` a warning is not
     listed, so a badge still counting it would send the reader to a window
     that has nothing to show them. `diagnosticsVisibleCount` and
     `diagnosticsHealth` are the one authority for both numbers. */
  const diagnosticsBadge = useMemo(() => {
    if (analysisRunning) return null;
    const count = diagnosticsVisibleCount(diagnosticMerge, severityPolicy);
    if (count === 0) return null;
    const tone = diagnosticsHealth(diagnosticMerge, severityPolicy) === "error"
      ? ("error" as const)
      : ("warning" as const);
    return { text: String(count), tone };
  }, [analysisRunning, diagnosticMerge, severityPolicy]);

  /**
   * Which part of the badge is worth raising a peeked drawer for.
   *
   * A run landing or an import reporting is news; the live count moving as
   * someone places and wires a part is not, and yanking the drawer open on
   * every edit would fight them. So the raise key deliberately omits
   * `liveDiagnostics` even though the badge counts it.
   */
  const diagnosticsRaiseKey = useMemo(() => {
    if (analysisRunning) return null;
    const failed = Boolean(activeAnalysis && !activeAnalysis.ok);
    const count = (failed ? 1 : 0) + (activeAnalysis?.warnings?.length ?? 0) + activeImportNotices.length;
    if (count === 0) return null;
    return `${failed ? "error" : "warning"}:${count}`;
  }, [activeAnalysis, analysisRunning, activeImportNotices]);

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
    // The span that is actually on screen, which is not always the document's.
    // A WINDOW run from the transport solves the bounds the user typed there,
    // and `rerunAfterActuationRef` re-solves "the run the reader is already
    // looking at" — so it has to re-solve THIS, not the authored `.tran` that
    // `effectiveAnalysisOptions` still holds. Cleared by `invalidateAnalysis`,
    // because after an ordinary edit there is no run on screen to reproduce.
    lastTransientOptionsRef.current = options;
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
      assertProjectHierarchyCanRun();
      const nativeResult = await runNativeTransient(nativeSchematic, options);
      if (projectHierarchyActive && nativeResult === null) {
        throw new ProjectHierarchyError(
          "unsupported-child",
          "Project-linked hierarchy could not use Tau's packaged ngspice bridge for this transient; no preview or flattened fallback was used.",
        );
      }
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
  }, [components, wires, netLabels, params, directives, userModelLibraryTexts, couplings, showNotice, assertCurrentSimulationIntegrity, assertProjectHierarchyCanRun, nativeSchematic, projectHierarchyActive]);

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

  /**
   * The circuit-time span a continuous run's deck is asked for.
   *
   * Derived from the resolution Tau already chose for this circuit rather than
   * fixed in seconds — see {@link LIVE_HORIZON_OUTPUT_STEPS}. Shown under the
   * transport in live mode, because a ceiling nobody can see is a ceiling that
   * will surprise somebody.
   */
  const liveHorizonSeconds = useMemo(() => {
    const outputStep = effectiveAnalysisOptions.stopTime / Math.max(1, effectiveAnalysisOptions.steps);
    return outputStep * LIVE_HORIZON_OUTPUT_STEPS;
  }, [effectiveAnalysisOptions]);

  /**
   * What Run does from the transport, per the mode the user can see.
   *
   * WINDOW is the ordinary bounded transient, and it goes through
   * `executeTransient` rather than `runAnalysis`: `runAnalysis` first awaits a
   * project save, which is right for the header's Run (a deliberate "run my
   * file") and wrong for a control the user may press repeatedly while tuning a
   * span. The pre-run size guard stays, because a bounded run can still be
   * enormous.
   *
   * LIVE energises the circuit through the engine bridge and never touches the
   * bounded path at all. Outside the desktop app that bridge answers
   * `not-available`, which is reported as the capability absence it is — Tau
   * does not quietly run a bounded transient instead and call it live.
   */
  const runFromTransport = useCallback(async () => {
    const plan = liveRun.plan;
    setResultsRaise((n) => n + 1);
    // The previous run's explanation stops describing anything the user is
    // looking at the instant they press Run again — including when the last
    // attempt was refused and the next one is a bounded run that cannot be.
    liveRun.clearMessage();

    if (plan.mode === "window") {
      const options = enforceMinimumTransientSteps(
        components,
        {
          ...effectiveAnalysisOptions,
          stopTime: plan.stopTime,
          ...(plan.startTime > 0 ? { startTime: plan.startTime } : {}),
        },
        isNativeSpiceRuntime() ? MAX_NATIVE_OUTPUT_POINTS - 1 : MAX_TRANSIENT_STEPS,
      );
      confirmLargeRunIfNeeded(options, () => { void executeTransient(options); });
      return;
    }

    let deck: ReturnType<typeof buildSpiceDeck>;
    try {
      assertCurrentSimulationIntegrity();
      assertProjectHierarchyCanRun();
      deck = projectHierarchyActive
        ? nativeSchematic.buildDeck!({ kind: "tran", stopTime: liveHorizonSeconds, steps: LIVE_HORIZON_OUTPUT_STEPS })
        : buildSpiceDeck(nativeSchematic, { kind: "tran", stopTime: liveHorizonSeconds, steps: LIVE_HORIZON_OUTPUT_STEPS });
    } catch (error) {
      showNotice(userFacingErrorMessage(error, "Tau could not build a deck for this circuit."));
      return;
    }
    // Same fail-closed rule the bounded native path uses: a subcircuit with no
    // resolvable definition is refused here, by name, instead of being handed
    // to ngspice to reject with a cryptic message half a second later.
    if (deck.unresolvedSubckts.length > 0) {
      showNotice(unresolvedSubcktMessage(deck.unresolvedSubckts));
      return;
    }

    const probedNetIds = new Set(
      probes.map((probe) => probe.netId?.toLowerCase()).filter((id): id is string => Boolean(id)),
    );
    const { channels, omitted } = liveScopeChannelRequests(deck.circuit.nets, probedNetIds);
    if (channels.length === 0) {
      showNotice("This circuit has no node voltage to plot, so there is nothing to watch live.");
      return;
    }
    if (omitted > 0) {
      showNotice(`Watching ${channels.length} of ${channels.length + omitted} nets live — probe the ones you want to see.`);
    }
    liveComponentsRef.current = components;
    // A new session is a new set of facts: no stop reason has been claimed for
    // it yet, and the intervals the LAST run's actuations disclosed are not in
    // the trace this one is about to draw.
    liveStopReasonClaimedRef.current = false;
    setLiveActuationDisclosures({});
    setLiveScopeShown(true);
    setLastRunWasLive(true);
    await startLiveSession_({ netlist: deck.netlist, deck, channels });
  }, [
    liveRun.plan,
    liveRun.clearMessage,
    components,
    wires,
    netLabels,
    params,
    directives,
    ascForeignSymbols,
    userModelLibraryTexts,
    userModelLibraryNames,
    nativeSchematic,
    projectHierarchyActive,
    assertProjectHierarchyCanRun,
    probes,
    effectiveAnalysisOptions,
    liveHorizonSeconds,
    confirmLargeRunIfNeeded,
    executeTransient,
    assertCurrentSimulationIntegrity,
    showNotice,
    startLiveSession_,
  ]);

  const runOperatingAnalysis = useCallback(async () => {
    const requestId = ++analysisRequestRef.current;
    setAnalysisRunning(true);
    beginRun("op");
    try {
      assertCurrentSimulationIntegrity();
      assertProjectHierarchyCanRun();
      const result = resolveAppEngineResult(
        await runNativeOperatingPoint(nativeSchematic),
        () => runOperatingPoint({ components, wires, netLabels, params }, { returnBranches: true }),
        projectHierarchyActive,
        "operating-point analysis",
      );
      if (analysisRequestRef.current !== requestId) return;
      setOpAnalysis(result);
    } catch (error) {
      if (analysisRequestRef.current !== requestId) return;
      setOpAnalysis({ ok: false, message: userFacingErrorMessage(error, "ngspice could not calculate the operating point."), warnings: [], engine: attemptedEngine() });
    } finally {
      if (analysisRequestRef.current === requestId) setAnalysisRunning(false);
    }
  }, [components, wires, netLabels, params, directives, userModelLibraryTexts, assertCurrentSimulationIntegrity, assertProjectHierarchyCanRun, nativeSchematic, projectHierarchyActive]);

  const runAcAnalysis = useCallback(async () => {
    const requestId = ++analysisRequestRef.current;
    setAnalysisRunning(true);
    beginRun("ac");
    try {
      assertCurrentSimulationIntegrity();
      assertProjectHierarchyCanRun();
      // An imported LTspice .ac directive is the user's analysis definition.
      // Suggest a useful range only when the document does not provide one.
      const acSweep = analysesFromDirectives(directives).ac ?? suggestAcSweep(components);
      const result = resolveAppEngineResult(
        await runNativeAcSweep(nativeSchematic, acSweep),
        () => runAcSweep({ components, wires, netLabels, params, couplings }, acSweep),
        projectHierarchyActive,
        "AC analysis",
      );
      if (analysisRequestRef.current !== requestId) return;
      setAcAnalysis(result);
      // A runnable `.step` also produces a family of Bode curves to overlay.
      // Native single-deck path first (emitNativeStep); TS re-run is exclusive.
      const specs = runnableStepsFromDirectives(directives);
      if (specs.length === 0) {
        setAcStepFamily(null);
      } else if (projectHierarchyActive) {
        if (!isNativeSpiceRuntime() || !canUseNativeStepPath(specs, { components })) {
          throw projectHierarchyStepRefusal("AC", specs, components);
        }
        const nativeFamily = await runNativeSteppedAcSweep(nativeSchematic, acSweep, specs);
        if (!nativeFamily) throw projectHierarchyStepRefusal("AC", specs, components);
        if (analysisRequestRef.current !== requestId) return;
        setAcStepFamily(nativeFamily);
      } else if (isNativeSpiceRuntime() && canUseNativeStepPath(specs, { components })) {
        const nativeFamily = await runNativeSteppedAcSweep(nativeSchematic, acSweep, specs);
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
  }, [components, wires, netLabels, params, directives, userModelLibraryTexts, userModelLibraryNames, couplings, assertCurrentSimulationIntegrity, assertProjectHierarchyCanRun, nativeSchematic, projectHierarchyActive]);

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
      assertProjectHierarchyCanRun();
      // ngspice first: the TS solver has no semiconductor stamps, so it cannot
      // sweep a transistor at all.
      const result = resolveAppEngineResult(
        await runNativeDcSweep(nativeSchematic, dc),
        () => runDcSweep({ components, wires, netLabels, params }, dc),
        projectHierarchyActive,
        "DC analysis",
      );
      if (analysisRequestRef.current !== requestId) return;
      setDcAnalysis(result);
      // A runnable `.step` also produces a family of transfer curves to overlay.
      const specs = runnableStepsFromDirectives(directives);
      if (specs.length === 0) {
        setDcStepFamily(null);
      } else if (projectHierarchyActive) {
        if (!isNativeSpiceRuntime() || !canUseNativeStepPath(specs, { components })) {
          throw projectHierarchyStepRefusal("DC", specs, components);
        }
        const nativeFamily = await runNativeSteppedDcSweep(nativeSchematic, dc, specs);
        if (!nativeFamily) throw projectHierarchyStepRefusal("DC", specs, components);
        if (analysisRequestRef.current !== requestId) return;
        setDcStepFamily(nativeFamily);
      } else if (isNativeSpiceRuntime() && canUseNativeStepPath(specs, { components })) {
        const nativeFamily = await runNativeSteppedDcSweep(nativeSchematic, dc, specs);
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
  }, [components, wires, netLabels, params, directives, dcSetup, userModelLibraryTexts, userModelLibraryNames, assertCurrentSimulationIntegrity, assertProjectHierarchyCanRun, nativeSchematic, projectHierarchyActive]);

  const runTfAnalysis = useCallback(async () => {
    const requestId = ++analysisRequestRef.current;
    const tf = analysesFromDirectives(directives).tf ?? tfSetup;
    setAnalysisRunning(true);
    beginRun("tf");
    try {
      assertCurrentSimulationIntegrity();
      assertProjectHierarchyCanRun();
      // ngspice first, for the same reason as the DC sweep: the TS solver has
      // no semiconductor stamps, so it cannot take an amplifier's gain at all.
      const result = resolveAppEngineResult(
        await runNativeTransferFunction(nativeSchematic, tf),
        () => runTransferFunction({ components, wires, netLabels, params }, tf),
        projectHierarchyActive,
        "transfer-function analysis",
      );
      if (analysisRequestRef.current !== requestId) return;
      setTfAnalysis(result);
    } catch (error) {
      if (analysisRequestRef.current !== requestId) return;
      setTfAnalysis({ ok: false, message: userFacingErrorMessage(error, "Could not run this transfer function."), warnings: [], engine: attemptedEngine() });
    } finally {
      if (analysisRequestRef.current === requestId) setAnalysisRunning(false);
    }
  }, [components, wires, netLabels, params, directives, tfSetup, userModelLibraryTexts, userModelLibraryNames, assertCurrentSimulationIntegrity, assertProjectHierarchyCanRun, nativeSchematic, projectHierarchyActive]);

  const runNoiseAnalysis_ = useCallback(async () => {
    const requestId = ++analysisRequestRef.current;
    const noise = analysesFromDirectives(directives).noise ?? noiseSetup;
    setAnalysisRunning(true);
    beginRun("noise");
    try {
      assertCurrentSimulationIntegrity();
      assertProjectHierarchyCanRun();
      // ngspice first: the TS solver has only resistor thermal noise and
      // refuses any circuit with a semiconductor in it, so it cannot report a
      // real amplifier's noise at all.
      const result = resolveAppEngineResult(
        await runNativeNoise(nativeSchematic, noise),
        () => runNoiseAnalysis({ components, wires, netLabels, params }, noise),
        projectHierarchyActive,
        "noise analysis",
      );
      if (analysisRequestRef.current !== requestId) return;
      setNoiseAnalysis(result);
    } catch (error) {
      if (analysisRequestRef.current !== requestId) return;
      setNoiseAnalysis({ ok: false, message: userFacingErrorMessage(error, "Could not run this noise analysis."), warnings: [], engine: attemptedEngine() });
    } finally {
      if (analysisRequestRef.current === requestId) setAnalysisRunning(false);
    }
  }, [components, wires, netLabels, params, directives, noiseSetup, userModelLibraryTexts, userModelLibraryNames, assertCurrentSimulationIntegrity, assertProjectHierarchyCanRun, nativeSchematic, projectHierarchyActive]);

  const runStepAnalysis = useCallback(async () => {
    const requestId = ++analysisRequestRef.current;
    // A configuration refusal is still the user's most recent run gesture.
    // Record it before validating specs so the header/outcome surfaces report
    // this real `.step` error instead of a stale transient/other analysis.
    beginRun("step");
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
    const schematic = nativeSchematic;
    setAnalysisRunning(true);
    try {
      assertCurrentSimulationIntegrity();
      assertProjectHierarchyCanRun();

      // AC/DC STEP domains: same native single-deck path as TRAN; TS re-run
      // stays exclusive (never emitNativeStep under that loop).
      if (domain === "ac") {
        const acSweep = analysesFromDirectives(directives).ac ?? suggestAcSweep(components);
        if (projectHierarchyActive) {
          if (!isNativeSpiceRuntime() || !canUseNativeStepPath(specs, { components })) {
            throw projectHierarchyStepRefusal("AC", specs, components);
          }
          const nativeFamily = await runNativeSteppedAcSweep(schematic, acSweep, specs);
          if (!nativeFamily) throw projectHierarchyStepRefusal("AC", specs, components);
          if (analysisRequestRef.current !== requestId) return;
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
        if (projectHierarchyActive) {
          if (!isNativeSpiceRuntime() || !canUseNativeStepPath(specs, { components })) {
            throw projectHierarchyStepRefusal("DC", specs, components);
          }
          const nativeFamily = await runNativeSteppedDcSweep(schematic, dc, specs);
          if (!nativeFamily) throw projectHierarchyStepRefusal("DC", specs, components);
          if (analysisRequestRef.current !== requestId) return;
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
        const stepDocument: SchematicDocument = {
          ...currentDocument,
          components: ctx.components,
          wires,
          netLabels,
          directives: stepDirectives,
        };
        const stepSchematic = {
          components: ctx.components,
          wires,
          netLabels,
          params: ctx.params,
          directives: stepDirectives,
          userModelLibraries: userModelLibraryTexts,
          userModelLibraryNames,
          ...(projectHierarchyActive ? { buildDeck: makeProjectDeckBuilder(stepDocument, ctx.params, stepDirectives) } : {}),
        };
        const native = await runNativeTransient(stepSchematic, effectiveAnalysisOptions);
        if (projectHierarchyActive && native === null) {
          throw new ProjectHierarchyError(
            "unsupported-child",
            "Project-linked transient stepping could not use Tau's packaged ngspice bridge for one family member; no preview or flattened fallback was used.",
          );
        }
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
  }, [components, wires, netLabels, params, directives, userModelLibraryTexts, userModelLibraryNames, effectiveAnalysisOptions, stepSetupUi, dcSetup, couplings, assertCurrentSimulationIntegrity, assertProjectHierarchyCanRun, nativeSchematic, currentDocument, makeProjectDeckBuilder, projectHierarchyActive]);

  /**
   * The analysis rail's seven run gestures, each holding the engine-lease
   * refusal. Built once per callback change rather than inline in the JSX so
   * the analysis panel is not handed seven new function identities on every
   * frame of a live run.
   */
  const boundedRuns = useMemo(() => ({
    tran: refuseWhileLive(runAnalysis),
    op: refuseWhileLive(runOperatingAnalysis),
    ac: refuseWhileLive(runAcAnalysis),
    dc: refuseWhileLive(runDcAnalysis),
    tf: refuseWhileLive(runTfAnalysis),
    noise: refuseWhileLive(runNoiseAnalysis_),
    step: refuseWhileLive(runStepAnalysis),
  }), [
    refuseWhileLive,
    runAnalysis, runOperatingAnalysis, runAcAnalysis, runDcAnalysis,
    runTfAnalysis, runNoiseAnalysis_, runStepAnalysis,
  ]);

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
    // `liveRunning`, because the consequence genuinely differs: an energised
    // circuit bends its running trace, an idle one re-solves the authored
    // analysis. Promising a re-run while a solve is in flight would tell the
    // reader to expect the plot to blank and restart, which it does not.
    () => liveControlHint(circuitControls, preferredAnalysis, liveRunning),
    [circuitControls, preferredAnalysis, liveRunning],
  );

  /**
   * What the transport shows, from whichever run is actually in flight.
   *
   * A bounded WINDOW run has no circuit-time progress to report — `ngspice`
   * hands back one finished result, not a stream — so it reports `NaN`, which
   * `formatSeconds` renders as an em dash. That is deliberate and is the whole
   * reason this is not `0`: a zero would be a measurement, and the honest
   * answer while a bounded solve is in flight is that Tau does not know where
   * it has got to.
   */
  const transportStatus = useMemo<LiveRunStatus>(() => {
    if (liveRunning) return liveRun.status;
    if (analysisRunning) {
      return {
        phase: "running",
        solvedCircuitTime: Number.NaN,
        rate: { source: "unknown", targetRate: liveRun.plan.targetRate },
      };
    }
    // A bounded run has taken the line since the live session ended, so the
    // live session's stop reason no longer describes anything the reader is
    // looking at. `idle` and not a synthesised `stopped`: a stop reason is a
    // statement about a run that was interrupted, and `ngspice` handing back
    // one finished result is not that. What the bounded run produced — its
    // span, its warnings, its failure — belongs to the results drawer, which
    // says it in full. See `lastRunWasLive`.
    if (!lastRunWasLive) return { phase: "idle" };
    return liveRun.status;
  }, [liveRunning, analysisRunning, lastRunWasLive, liveRun.status, liveRun.plan.targetRate]);

  /** Stop whichever run the transport is showing. The live session and the
   *  bounded abort path are separate mechanisms and stay so; this only picks. */
  const stopFromTransport = useCallback(() => {
    if (liveRunning) {
      claimLiveStop("user");
      return;
    }
    stopAnalysisRef.current();
  }, [liveRunning, claimLiveStop]);

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
  stopAnalysisRef.current = stopAnalysis;

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
              ...(userModelLibraries.length > 0 ? { userModelLibraries } : {}),
              ...(projectPorts.length > 0 ? { projectPorts } : {}),
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
              ...(userModelLibraries.length > 0 ? { userModelLibraries } : {}),
              ...(projectPorts.length > 0 ? { projectPorts } : {}),
            })),
          }
        : tab)),
    [activeId, ascDataFlags, ascForeignSymbols, ascHierarchicalBlocks, ascSheet, ascShapes, components, wires, probes, netLabels, directives, projectPorts, textAnnotations, userModelLibraries, past, future],
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
    options?: { dirty?: boolean; notice?: string; diskFingerprint?: string; tauMinted?: boolean },
  ) => {
    const snap = snapshotActive(tabs);
    const markDirty = Boolean(options?.dirty);
    const signature = schematicDocumentSignature(doc);
    const recoveredDetached = markDirty && !filePath;
    const diskFingerprint = options?.diskFingerprint;
    // Spread rather than assigned, and only ever set true: a tab that was
    // minted stays minted (the byte-equality check in
    // `discardMintedEmptyFile` is what retires the claim once real content
    // reaches disk), and a re-open of somebody else's file must not be able to
    // invent the marker. See `OpenTab.tauMinted`.
    const mintedMark = options?.tauMinted ? { tauMinted: true as const } : {};
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
              ...mintedMark,
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
          ...mintedMark,
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
          ...mintedMark,
        }]);
        setActiveId(id);
        loadCircuit(doc);
      }
    }
    adoptDirectiveOptions(doc);
    invalidateAnalysis();
    leaveSimulator();
    setFitSignal((n) => n + 1);
    // A bare "Opened <file>" is not reported. The tab strip, the title bar and
    // the drawing itself all just changed to say so, and a toast that restates
    // what three visible surfaces already show is ink with no information in
    // it - and it lands over the bottom-right of the instrument, which is
    // where the trace legend and the measurement cards are. A notice with
    // something to add (dropped parts, stranded terminals) still speaks.
    if (options?.notice) showNotice(options.notice);
  }, [tabs, snapshotActive, loadCircuit, adoptDirectiveOptions, invalidateAnalysis, leaveSimulator, showNotice, components.length, wires.length]);

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

  /** Open a child sheet from a project-relative link path. */
  const openLinkedSheetPath = useCallback((sheetPath: string) => {
    if (!projectRootPath) return;
    const target = joinPath(projectRootPath, sheetPath);
    const already = tabsRef.current.find((tab) => tab.filePath === target);
    if (already) { setActiveId(already.id); return; }
    void (async () => {
      try {
        const json = await useProject.getState().readSim(target);
        openSimFromProject(target, basename(target), json);
      } catch (error) {
        showNotice(error instanceof Error ? error.message : `Could not open ${sheetPath}.`);
      }
    })();
  }, [projectRootPath, openSimFromProject, showNotice]);

  const openLinkedSheetForComponent = useCallback((componentId: string) => {
    const link = components.find((candidate) => candidate.id === componentId)?.projectSubcircuit;
    if (link) openLinkedSheetPath(link.sheetPath);
  }, [components, openLinkedSheetPath]);

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
        // the schematic. Surfaced in the attached-file recovery workflow, so
        // the user can confirm the exact vendor text was picked up.
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
      textAnnotations: next.textAnnotations,
      ascShapes: next.ascShapes,
      ascDataFlags: next.ascDataFlags,
      ascForeignSymbols: next.ascForeignSymbols,
      ascHierarchicalBlocks: next.ascHierarchicalBlocks,
      ...(next.ascSheet ? { ascSheet: next.ascSheet } : {}),
      ...(next.userModelLibraries.length > 0 ? { userModelLibraries: next.userModelLibraries } : {}),
      ...(next.projectPorts.length > 0 ? { projectPorts: next.projectPorts } : {}),
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
    leaveSimulator();
    setFitSignal((value) => value + 1);
    showNotice("Applied assistant changes to the current circuit.");
  }, [activeId, adoptDirectiveOptions, components, invalidateAnalysis, leaveSimulator, probes, replaceCircuit, showNotice]);

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
      // The ONE route that mints a file the user never asked for by name, so
      // the only one allowed to mark the tab as Tau's to clean up (P3-05).
      tauMinted: true,
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

  /**
   * P3-05 — take the file with the tab when Tau minted it and nobody ever put
   * anything in it, instead of leaving the reported `untitled-2.asc …
   * untitled-4.asc` ladder in the explorer.
   *
   * Deleting a user's file wrongly is far worse than leaving an empty one, so
   * ALL FOUR of these must hold, and each is here because a different real
   * document would otherwise be destroyed:
   *
   *  1. `tab.tauMinted` — Tau created this file itself this session, from the
   *     New-schematic route. A file the user (or an import) created is never
   *     ours to remove, even when it is empty right now.
   *  2. the basename is one `createSchematicInRoot` mints. This is what
   *     protects a RENAME: `renameProjectNode` rewrites the tab's title and
   *     path, so a tab renamed off `untitled*` stops matching.
   *  3. the in-memory document is empty on every authored collection.
   *  4. the on-disk text is byte-equal to the template Tau wrote. This is the
   *     condition that retires a stale mint marker: the moment a save puts a
   *     real circuit on disk the bytes differ, so a saved-then-emptied tab
   *     keeps its file.
   *
   * The contract's wording is "the user chose Don't save", and this is
   * deliberately wider: an untouched minted tab is NOT dirty (its signature
   * still equals `blankDocument()`'s), so `closeTab` never prompts for it and
   * the dialog the report describes never appears. Hooking only the discard
   * button would therefore have left the reported screenshot exactly as it is.
   * Widening is safe precisely because of conditions 3 and 4: in the silent
   * case there is, by construction, nothing to lose.
   */
  const discardMintedEmptyFile = useCallback(async (tab: OpenTab) => {
    const path = tab.filePath;
    if (!path || !tab.tauMinted) return;
    const name = basename(path);
    if (!UNTITLED_MINT_NAME.test(name)) return;
    if (!tab.doc || !schematicDocumentIsEmpty(tab.doc)) return;
    // A read that FAILS keeps the file. Treating "could not read" as "matches
    // the template" would delete bytes nobody ever verified, which is the one
    // irreversible mistake available anywhere on this path.
    let onDisk: string;
    try {
      onDisk = await readProjectText(path);
    } catch {
      return;
    }
    // Which blank template counts depends on the extension, exactly as
    // `newFileContents` decides it when minting. Comparing against the ASC
    // template unconditionally was a live regression the moment new sheets
    // became `.sim`: a minted `untitled.sim` holds Tau JSON, never matched, so
    // the delete silently stopped firing and the `untitled-2 / untitled-3 / …`
    // ladder this whole path exists to prevent came straight back.
    const template = isAscFile(path) ? blankAscText() : blankSimJson();
    if (onDisk !== template) return;
    await deleteProjectNode(path);
    // `useProject.deleteNode` swallows its errors and, on the in-memory
    // workspace branch, never sets `error` at all — and nothing clears a stale
    // `error` there either. So the store's `error` is not a success signal:
    // reading it would report an unrelated earlier failure as this file's.
    // Ask what actually happened instead — the node is gone iff nothing lists
    // the path any more.
    const after = useProject.getState();
    const survived = Object.prototype.hasOwnProperty.call(after.workspaceFiles, path)
      || projectTreeHasPath(after.tree, path);
    if (!survived) return;
    // Never fail silently: the file is still there, so say so and say why.
    showNotice(`Kept ${name}: Tau could not delete the empty schematic.${after.error ? ` ${after.error}` : ""}`);
  }, [deleteProjectNode, showNotice]);

  const closeTab = useCallback((id: string, confirmed = false) => {
    const snap = snapshotActive(tabs);
    const idx = snap.findIndex((tab) => tab.id === id);
    if (idx === -1) return;
    const closing = snap[idx];
    if (closing.dirty && !confirmed) {
      setConfirmCloseTabId(id);
      return;
    }
    // Fire-and-forget on purpose, and placed after the confirm guard so it
    // covers BOTH close routes (the silent clean close and the Don't-Save one).
    // `closeTab` has to stay synchronous — the tab list, the restored document
    // and its undo history are all set below in one commit, and awaiting a disk
    // round trip here would interleave that with whatever the user does next.
    // `closing` is the snapshot, so it still carries the document the tab held
    // at close time even though the store is about to hold the next tab's.
    void discardMintedEmptyFile(closing);
    documentNavigationRef.current += 1;
    const remaining = snap.filter((tab) => tab.id !== id);
    if (remaining.length === 0) {
      const blank: OpenTab = { id: newTabId(), title: "untitled.sim", doc: blankDocument(), history: emptyHistory() };
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
    leaveSimulator();
  }, [tabs, activeId, snapshotActive, restoreCircuit, invalidateAnalysis, leaveSimulator, discardMintedEmptyFile]);

  const clearScratchpad = useCallback(() => {
    documentNavigationRef.current += 1;
    // Clear is a document edit, not navigation. The store records one undoable
    // blank-document snapshot and leaves the tab's file identity, disk
    // fingerprint, and ASC rewrite policy alone.
    clearSheet();
    const cleared = useSchematic.getState();
    const clearedDocument: SchematicDocument = {
      components: cleared.components,
      wires: cleared.wires,
      probes: cleared.probes,
      netLabels: cleared.netLabels,
      directives: cleared.directives,
      textAnnotations: cleared.textAnnotations,
      ascShapes: cleared.ascShapes,
      ascDataFlags: cleared.ascDataFlags,
      ascForeignSymbols: cleared.ascForeignSymbols,
      ascHierarchicalBlocks: cleared.ascHierarchicalBlocks,
      ...(cleared.ascSheet ? { ascSheet: cleared.ascSheet } : {}),
      ...(cleared.userModelLibraries.length > 0 ? { userModelLibraries: cleared.userModelLibraries } : {}),
      ...(cleared.projectPorts.length > 0 ? { projectPorts: cleared.projectPorts } : {}),
    };
    setTabs((prev) => prev.map((tab) => (
      tab.id === activeId
        ? {
            ...tab,
            dirty: Boolean(tab.savedSignature && tab.savedSignature !== schematicDocumentSignature(clearedDocument)),
            doc: clearedDocument,
            history: { past: cleared.past, future: cleared.future },
          }
        : tab
    )));
    invalidateAnalysis();
    leaveSimulator();
    setConfirmClearOpen(false);
    // No raise here. This replaced `setGraphOpen(true)`, which was a no-op
    // reset of a simulator-only panel; bumping the shared drawer's raise
    // counter is not, and it lifted an empty "No analysis yet" drawer over
    // the blank canvas of a schematic that had not been run.
    showNotice("Schematic cleared.");
  }, [activeId, clearSheet, invalidateAnalysis, leaveSimulator, showNotice]);

  /**
   * Re-solve after a contact was operated, instead of blanking the plot.
   *
   * Every other edit invalidates: the result on screen no longer describes the
   * circuit, and showing it would be a lie. Throwing a switch is the one edit
   * whose entire purpose is to see the new result, so it re-runs the analysis
   * the reader is already looking at. Held in a ref so the effect below keeps
   * its original dependencies and does not re-fire on every render.
   *
   * "The analysis the reader is already looking at" is taken literally for the
   * transient: `lastTransientOptionsRef` holds the bounds that produced the
   * trace on screen, which for a run started from the transport's WINDOW mode
   * are the ones the user typed there and not the document's `.tran`. Falling
   * back to `effectiveAnalysisOptions` re-solved the authored span instead, so
   * throwing a switch after a 1 ms window silently answered a different
   * question — the axis changed under the reader with nothing saying why.
   */
  const rerunAfterActuationRef = useRef<() => void>(() => {});
  rerunAfterActuationRef.current = () => {
    if (preferredAnalysis === "op") void runOperatingAnalysis();
    else if (preferredAnalysis === "ac") void runAcAnalysis();
    else if (preferredAnalysis === "dc") void runDcAnalysis();
    else if (preferredAnalysis === "tf") void runTfAnalysis();
    else if (preferredAnalysis === "noise") void runNoiseAnalysis_();
    else void executeTransient(lastTransientOptionsRef.current ?? effectiveAnalysisOptions);
  };
  const actuationPendingRef = useRef(false);
  const handleActuate = useCallback(() => { actuationPendingRef.current = true; }, []);

  /**
   * Operating a control while the circuit is energised, which is the payoff the
   * whole live path exists for: the solver is halted, the one device the emitter
   * wrote for this part is altered, and the SAME transient resumes, so the trace
   * on screen acquires a corner instead of blanking and starting again.
   *
   * `Canvas`'s `onActuate` reports only that *something* moved, so the parts
   * that changed are found by diffing against the circuit the running deck was
   * last synchronised with. Only actuable kinds are considered: every other
   * difference is a real edit, and an edit is handled by the branch below, not
   * by an alter.
   *
   * Held in a ref, like the re-solve above and for the same reason: the effect
   * that consumes it keeps its original dependencies.
   */
  const actuateLiveRunRef = useRef<() => void>(() => {});
  actuateLiveRunRef.current = () => {
    const previous = new Map(liveComponentsRef.current.map((part) => [part.id, part]));
    liveComponentsRef.current = components;
    for (const part of components) {
      if (!isActuable(part.kind) && !isDraggableWiper(part.kind)) continue;
      const before = previous.get(part.id);
      if (!before || before.value === part.value) continue;
      // The component goes in holding its OLD value and the new one is the
      // second argument, because that pair is what `planLiveActuation` reads:
      // it compares the two through the netlist emitter's own readers to decide
      // which resistors move and in what order. Handing it the new value twice
      // makes every change look like no change, and it answers `unchanged` — a
      // switch that moves on the sheet and never reaches the solver.
      const target = actuateLiveRun(
        { id: part.id, kind: part.kind, label: part.label, value: before.value },
        part.value,
      );
      if (!target) continue;
      if (target.kind === "refused") {
        showNotice(target.failure.message);
        // Nothing reached the running circuit, so any interval this control
        // disclosed for an earlier move is no longer what is on the trace.
        noteActuationDisclosure(target.controlId, null);
        continue;
      }
      // `intermediate` is null when one alter does the whole change, and the
      // null is as load-bearing as the sentence: it retracts a disclosure the
      // previous move made about this same control.
      if (target.kind === "alter") noteActuationDisclosure(target.plan.controlId, target.plan.intermediate);
      else noteActuationDisclosure(target.controlId, null);
    }
  };

  /**
   * A circuit edit during a live run stops the run.
   *
   * The deck the engine is solving was built from the sheet as it was at Run,
   * and `alter` can change a value but not add a wire. Carrying on would leave
   * a trace advancing under a schematic it no longer describes, which is the
   * exact silent-wrongness AGENTS.md forbids — so the run ends, with
   * `circuit-edited` as its own visible reason.
   */
  const liveEditRef = useRef<() => void>(() => {});
  liveEditRef.current = () => {
    if (liveRunning) claimLiveStop("circuit-edited");
  };

  useEffect(() => {
    if (actuationPendingRef.current) {
      actuationPendingRef.current = false;
      // A live run absorbs the change; an idle one re-solves. Both keep what is
      // on screen, which is the promise the live-controls band makes.
      if (liveRunningRef.current) actuateLiveRunRef.current();
      else rerunAfterActuationRef.current();
      return;
    }
    liveEditRef.current();
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

      const entry = CATALOG.find((c) => c.paletteVisible !== false && c.hotkey === e.key.toLowerCase());
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
  const effectiveAssistantWidth = chrome.assistant.width ?? assistantResize.width;

  /**
   * The simulator's split, and the divider's live clamp.
   *
   * Both come from `resolveAnalysisPane`, which is where the split/stack
   * threshold and the circuit pane's floor are stated once and unit-tested.
   * This is deliberately TypeScript and not a container query: the fixed
   * inspector below has to be inset by the pane's width and cannot observe a
   * container, so a query would give the CSS and this file two answers that
   * disagree in the band around the threshold.
   *
   * `workspaceWidth` is fed the columns that are actually beside the workspace
   * in the simulator - the assistant, or nothing. Explorer and Components are
   * schematic-only, so there is nothing else to pay for.
   */
  const analysisWorkspace = workspaceWidth(
    shellWidth,
    chrome.assistant.visible ? [effectiveAssistantWidth] : [],
  );
  const analysisPane = resolveAnalysisPane({
    workspace: analysisWorkspace,
    persisted: analysisPaneResize.width,
  });
  /** Only the simulator splits. The schematic keeps the full-bleed canvas and
   *  today's peek drawer, at every width. */
  const analysisSplit = mode === "simulator" && activeProjectFile && analysisPane.layout === "split";

  /**
   * Keep the divider's own idea of its width inside the clamp the layout is
   * actually enforcing.
   *
   * `usePanelWidth` clamps every drag and arrow-key step against the STATIC
   * `ANALYSIS_PANE_WIDTH`, whose maximum (560px = plotter floor + circuit
   * floor) is only reachable in a wide workspace. `resolveAnalysisPane` knows
   * the real ceiling — at a 1100px window with Bode open it is 410px — and
   * clamps the RENDERED width to it, so the circuit pane never loses its floor.
   * What it could not do is stop the hook from banking the unreachable number:
   * a drag past the stop left the divider believing it sat at 560 while the
   * screen showed 410, and the next 150px of the return gesture, or the next
   * ten arrow presses, then moved nothing at all. A control that ignores the
   * first third of a gesture reads as broken, which is why this exists.
   *
   * Narrowly: only a width the DIVIDER just moved, and only while a divider
   * exists. The three guards below are each load-bearing, and the middle one is
   * the reason the two clamping effects above this were deleted in the first
   * place:
   *
   * - **Stacked layouts are skipped.** With no divider there is no gesture to
   *   correct, and `resolveAnalysisPane`'s ceiling collapses to the pane's own
   *   minimum in a cramped workspace — so a schematic with all three side
   *   panels open would otherwise pull the remembered width down to 280px and
   *   the simulator would open at its floor for the rest of the session. The
   *   min-window screenshot gate caught exactly that.
   * - **A resize is not a decision.** A window that got narrower is not the
   *   user changing their mind, so a changed workspace leaves the remembered
   *   width alone and widening the window hands it back.
   * - **The width has to have moved.** Merely entering the simulator, where a
   *   divider appears over an unchanged workspace, must not commit the reader
   *   to whatever that workspace happens to allow.
   *
   * What is left is precisely a drag or an arrow-key step, which IS the user
   * placing the divider now — and now has a ceiling.
   */
  const analysisDividerRef = useRef({ workspace: -1, width: -1 });
  const { width: analysisPaneWidth, setWidth: setAnalysisPaneWidth } = analysisPaneResize;
  const analysisPaneMax = analysisPane.maxWidth;
  useEffect(() => {
    const previous = analysisDividerRef.current;
    analysisDividerRef.current = { workspace: analysisWorkspace, width: analysisPaneWidth };
    if (!analysisSplit) return;
    if (previous.workspace !== analysisWorkspace) return;
    if (previous.width === analysisPaneWidth) return;
    if (analysisPaneWidth <= analysisPaneMax) return;
    setAnalysisPaneWidth(analysisPaneMax);
  }, [analysisSplit, analysisWorkspace, analysisPaneWidth, analysisPaneMax, setAnalysisPaneWidth]);

  /**
   * Where the inspector may go, and what it should stay off.
   *
   * The viewport is the shell body inset by a gutter, less whatever the
   * results drawer is covering - the inspector is `position: fixed`, so it is
   * outside every flex row in the shell and nothing in the layout reserves
   * that space for it. Which EDGE the drawer eats is the drawer's to say, and
   * it says so per axis: docked bottom it floats over the canvas and costs
   * height; docked right it is the analysis pane and costs width. Reading the
   * wrong axis is not a cosmetic error - the right-docked drawer is as tall as
   * the whole column, so charging its height to `maxY` would flatten this box
   * to `minY + 8` and leave the inspector nowhere legal to go.
   *
   * The rail is an obstacle rather than an inset because it is narrow enough
   * that overlapping it is sometimes the least bad option, and the placement
   * kernel is allowed to make that call.
   */
  /**
   * How far in from the shell body's right edge the analysis pane starts.
   *
   * `drawerCover.right` alone is the pane's width, not its position: the
   * assistant sits to its right, so with Bode open the pane's left edge is
   * `assistant + pane` in from the shell edge and clamping at `pane` would
   * still let a 300px inspector cover the whole plot. The assistant's rendered
   * width is exactly `--assistant-w` (`App.css:8057`; its resize handle is
   * absolutely positioned inside it and adds nothing), so this is a measured
   * fact rather than a model of the layout.
   *
   * Zero unless the drawer is docked right, which keeps the schematic and the
   * stacked fallback on precisely today's placement - the assistant has never
   * been an obstacle for the inspector and this is not the change that makes
   * it one.
   */
  const inspectorRightReserve = drawerCover.right > 0
    ? drawerCover.right + (chrome.assistant.visible ? effectiveAssistantWidth : 0)
    : 0;
  const inspectorViewport = useMemo(() => ({
    minX: shellBox.minX + 8,
    minY: shellBox.minY + 8,
    maxX: Math.max(shellBox.minX + 8, shellBox.maxX - inspectorRightReserve - 8),
    maxY: Math.max(shellBox.minY + 8, shellBox.maxY - drawerCover.bottom - 8),
  }), [shellBox, drawerCover.bottom, inspectorRightReserve]);

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
        outcome={activeAnalysis}
        runState={runState}
        isRunning={analysisRunning}
        liveRunning={liveRunning}
        /* The unsaved state travels as a flag, not as a bullet concatenated
           onto the title. As a character inside the string it had no
           accessible name, inherited the filename's 10px --faint, and - the
           actual bug - lived inside the ellipsising run, so a long document
           name truncated the unsaved marker away. PDF-6 item 9. */
        title={activeProjectFile ? documentTitle : (projectRootName ?? "Open a project")}
        dirty={activeDirty}
        onModeChange={(nextMode) => {
          if (nextMode === "simulator" && !activeProjectFile) {
            showNotice("Open or create a schematic before using the simulator.");
            return;
          }
          changeMode(nextMode);
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
      />
      <div
        ref={shellBodyRef}
        className="shell-body"
        style={{ "--assistant-w": `${effectiveAssistantWidth}px` } as CSSProperties}
      >
        <ActivityRail
          mode={mode}
          /* The health lamp. It sits in the rail rather than in the drawer it
             opens, because a badge inside a closed drawer cannot tell anyone to
             open the drawer - and this is the only surface the report asks to be
             true at all times: green clean, amber advisory, red only when the
             circuit will not run. */
          diagnostics={{
            health: diagnosticsHealth(diagnosticMerge, severityPolicy),
            count: diagnosticsVisibleCount(diagnosticMerge, severityPolicy),
            open: diagnosticsOpen,
            onToggle: toggleDiagnosticsWindow,
            /* Nothing to open onto without a schematic - the drawer itself is
               only mounted for an open sheet. */
            disabled: !activeProjectFile,
          }}
          /* Settings lives in the rail's foot now, not the status bar's right
             edge: the status bar returns null in a resting schematic, which is
             exactly the state the review screenshot was taken in - so the gear
             was not merely in the wrong corner, it was absent. */
          onOpenSettings={openSettingsSurface}
          explorerOpen={explorerColumnOpen}
          partsOpen={componentsColumnOpen}
          projectOpen={Boolean(projectRootPath)}
          schematicOpen={activeProjectFile}
          onFocusExplorer={() => {
            leaveSimulator();
            if (assistantOpen && !independentColumnsFit) setPartsOpen(false);
          }}
          onModeChange={changeMode}
          onSearch={() => setPaletteOpen(true)}
          onFocusComponents={() => {
            leaveSimulator();
            setPartsOpen((open) => {
              const next = !open;
              if (next) {
                setComponentFocusSignal((value) => value + 1);
              }
              return next;
            });
          }}
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
          *
          * In the simulator, once the workspace is wide enough
          * (`resolveAnalysisPane`), the same wrapper turns into the two-pane
          * row the user asked for: circuit left, analysis right, a divider
          * between. The results drawer is the same component and the same
          * landmark either way - it is told which edge it is docked to, and
          * only the axis changes.
          *
          * The pane's width rides on a custom property rather than a prop
          * because it is a fact about this row, not about the drawer: the
          * drawer must stay full-bleed in the bottom dock, where no such
          * number exists.
          */}
        <div
          className={`workspace-column${analysisSplit ? " workspace-column--split" : ""}`}
          style={analysisSplit
            ? ({ "--analysis-pane-w": `${analysisPane.width}px` } as CSSProperties)
            : undefined}
        >
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
            canStop={analysisRunning && transientAbortRef.current !== null}
            onRun={runAndShowSimulator}
            onStop={stopAnalysis}
            onClearScratchpad={() => setConfirmClearOpen(true)}
            onOpenSimulationSetup={() => setSimulationSetupOpen(true)}
            onOpenProjectInterface={() => setProjectSheetPortsOpen(true)}
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
            onHideSimulator={leaveSimulator}
          />
          {/* Named, unlike the empty-state stage above it, because this is the
              one a keyboard or screen-reader user needs to be able to reach and
              return to. The redesign makes the canvas the whole window and
              gives Escape a "return focus here" job, which needs a landmark to
              return to. See shellContract.ts. */}
          {/*
            * Publish the parts rail's real width to CSS. The rail is an
            * absolutely-positioned overlay on this stage's right edge, and the
            * canvas zoom cluster is anchored to that same edge - so without
            * this the +, - and fit buttons render underneath the rail: present
            * in the DOM, focusable, and invisible. Zero when the rail is shut.
            */}
          <main
            className="stage"
            aria-label={SHELL.canvas.name}
            style={{
              "--stage-rail-inset": componentsColumnOpen
                ? `${componentsRailWidth(componentsRailResize.width, componentsRailResponsiveMax)}px`
                : "0px",
            } as CSSProperties}
          >
            <Suspense fallback={<CanvasLoadingSurface />}>
              <Canvas
                op={opAnalysis}
                tran={analysis}
                readoutTime={schematicReadoutTime}
                interactive
                fitSignal={fitSignal}
                fitInsetBottom={drawerCover.bottom}
                revealComponentId={revealTarget.id}
                revealSignal={revealTarget.signal}
                revealNetPoint={revealNetTarget.point}
                revealNetSignal={revealNetTarget.signal}
                /* Item 14: without these the feature is invisible in the app -
                 * the drawing cannot say a net is a port, a block cannot say its
                 * contract drifted, and there is no way into the sheet a block
                 * stands for. Editor instance only: the simulator's Canvas is
                 * read-only, so authoring props would be a lie there. */
                subcircuitDrift={subcircuitDrift}
                onReviewDrift={reviewSubcircuitDrift}
                onOpenLinkedSheet={openLinkedSheetForComponent}
                onCommitNetLabelPort={commitNetLabelPort}
                sheetInterfaceDisabledReason={sheetInterfaceDisabledReason}
                onSelectionRect={setSelectionRect}
                onSelectedComponentDragChange={setSelectedComponentDragActive}
              />
            </Suspense>
            {components.length === 0 && wires.length === 0 && toolMode === "select" && (
              <EmptyState
                projectOpen
                // P3-04B (TOOLBAR handoff): this card renders INSIDE an open,
                // empty schematic, so the "create or open a schematic" copy
                // told a reader to do the thing they had already done. The
                // first EmptyState, over a shell with no file open, keeps that
                // copy and must not take this prop.
                schematicOpen
                onShowParts={() => {
                  // Set-true, not `onFocusComponents`: that handler TOGGLES,
                  // and at the widths this card appears at the rail is
                  // usually already open — so reusing it would close the panel
                  // the copy just pointed at.
                  setPartsOpen(true);
                  setComponentFocusSignal((value) => value + 1);
                }}
                onNewCircuit={() => void startNewCircuit()}
                onAskBode={openAssistant}
                offerFirstSuccess={shouldOfferLearningPath(learningPath)}
                onTryFirstSuccess={() => void startFirstSuccessExample()}
                // The card renders whenever the sheet has no components and no
                // wires, which an import whose every part was unmappable also
                // satisfies. Handing it the retained records stops it telling
                // someone whose file DID contain a part to place their first
                // one, while the dock below refuses to simulate over that same
                // part. Empty on a genuinely fresh sheet.
                unimportedParts={unimportedPartLabels(ascForeignSymbols)}
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
                    {/* P3-12 (TOOLBAR handoff): the same red multimeter probe the editor
                      * tool strip draws, so the two surfaces stop disagreeing about what
                      * the probe tool looks like. */}
                    <ProbeIcon size={13} aria-hidden="true" />
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
                * The run transport, and this is the surface that owns it.
                *
                * Not the header's Run (`Toolbar.tsx`): that control is the
                * simulation health lamp — neutral, amber, green, red — and its
                * job is "run my file and show me the simulator". Its own tests
                * pin that styling, and a lamp that also had to become a Stop
                * button, carry a Live|Window choice and hold an editable
                * duration would stop being legible as either thing.
                *
                * Not the editor toolbar (`ShellPanels.tsx`) either: that Run
                * belongs to the schematic, and a live run only exists in the
                * simulator — leaving for the schematic is one of the things
                * that stops it (`leaveSimulator`). A transport on a surface
                * that cannot hold a run is a control that is dead half the
                * time.
                *
                * So it sits here, in the circuit pane, one band above the
                * controls it energises. That adjacency is the requirement, in
                * the user's own words: "This will allow us to actively see the
                * plot change when the user clicks a button." Stop is one click
                * from the switch you just threw, and the band is visible
                * whenever the simulator is, including at the 900px floor where
                * the results drawer is collapsed to a peek strip.
                */}
              <div className="run-transport-band">
                <RunTransport
                  plan={liveRun.plan}
                  status={transportStatus}
                  livePlan={liveRun.livePlan}
                  windowPlan={liveRun.windowPlan}
                  onPlanChange={liveRun.setPlan}
                  onRun={() => { void runFromTransport(); }}
                  onStop={stopFromTransport}
                />
                {/*
                  * The ceiling behind "runs continuously". A `.tran` card needs
                  * an end time, so a continuous run is a transient over a span
                  * chosen to be unreachable rather than an infinity Tau cannot
                  * express — and a ceiling nobody can see is one that will
                  * surprise somebody. See LIVE_HORIZON_OUTPUT_STEPS.
                  */}
                {liveRun.plan.mode === "live" && (
                  <p className="run-transport-note">
                    {`Solved as a ${formatSeconds(liveHorizonSeconds)} transient; reaching that end is reported as a stop, not hidden.`}
                  </p>
                )}
                {liveRun.message && (
                  <p role="alert" className="run-transport-alert">{liveRun.message}</p>
                )}
              </div>
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
                      // Lit by either run: the lamp says "a solver is working",
                      // and a live run is the one that works longest.
                      className={`live-controls-lamp${analysisRunning || liveRunning ? " solving" : ""}`}
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
                  {/*
                    * What the run genuinely solved between the alters of a
                    * multi-device change. See `liveActuationDisclosures`: the
                    * sentence is the planner's own, rendered here rather than
                    * discarded, because the interval it describes is in the
                    * trace whether or not anything says so.
                    *
                    * Ordered by `circuitControls` so it reads down the band in
                    * the same order as the readouts above it, and carried on
                    * `live-controls-hint` because it IS the consequence row -
                    * a second full-width caption under the first, not a new
                    * kind of surface needing a new kind of styling.
                    */}
                  {circuitControls.map((control) => {
                    const disclosure = liveActuationDisclosures[control.id];
                    return disclosure === undefined ? null : (
                      <p key={`${control.id}-intermediate`} role="status" className="live-controls-hint">
                        {disclosure}
                      </p>
                    );
                  })}
                </div>
              )}
              <div className="sim-schematic-canvas">
                <Suspense fallback={<CanvasLoadingSurface />}>
                  <Canvas
                    op={opAnalysis}
                    tran={analysis}
                    readoutTime={schematicReadoutTime}
                    interactive={false}
                    onActuate={handleActuate}
                    fitSignal={fitSignal}
                    fitInsetBottom={drawerCover.bottom}
                    /* The dock is mounted outside both mode branches, so an
                     * Errors row is clickable here too and must reveal here too. */
                    revealComponentId={revealTarget.id}
                    revealSignal={revealTarget.signal}
                    revealNetPoint={revealNetTarget.point}
                    revealNetSignal={revealNetTarget.signal}
                    onSelectionRect={setSelectionRect}
                    onSelectedComponentDragChange={setSelectedComponentDragActive}
                    currentVisualizer={currentVisualizer}
                  />
                </Suspense>
              </div>
            </section>
        )}
        {/*
          * The divider between circuit and analysis.
          *
          * `panelResize`'s handle and hook, not new drag code: it already has
          * pointer capture that survives a fast drag leaving the strip, the
          * WAI-ARIA window-splitter arrow keys, and localStorage persistence.
          * Edge "left" is the right-docked convention Assistant and Components
          * already use - drag left to widen the pane.
          *
          * The clamp is `resolveAnalysisPane`'s, not the static config's:
          * `App.css:7283-7286` gives `.workspace-column > .sim-schematic-pane`
          * `min-width: 0` at specificity 0-2-0, which beats the `min-width:
          * 280px` at `App.css:7517`, so the stylesheet is NOT holding the
          * circuit's floor. This max is the only thing standing between a drag
          * and a circuit pane of zero width.
          */}
        {analysisSplit && (
          <PanelResizeHandle
            edge="left"
            label={SHELL_SEPARATORS.analysisPane}
            width={analysisPane.width}
            minWidth={analysisPane.minWidth}
            maxWidth={analysisPane.maxWidth}
            dragging={analysisPaneResize.dragging}
            onPointerDown={analysisPaneResize.onPointerDown}
            onKeyDown={analysisPaneResize.onKeyDown}
          />
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
            selectionKey={inspectionKey}
            focusSignal={inspectorFocusSignal}
            suspended={selectedComponentDragActive}
            onDismiss={() => setInspectorClosedFor(inspectionKey)}
          >
            {inspectedWire
              ? <WireInspector wire={inspectedWire} />
              : (
                <ComponentInspector
                  /* The index is what removes the retyping: choose a sheet and
                   * its declared pinout arrives. Empty means "not checked yet",
                   * never "agrees". */
                  sheetInterfaces={sheetInterfaceIndex}
                  comparedSource="open-tab"
                  onOpenSheet={openLinkedSheetPath}
                  selected={inspectedParts}
                  manualModelControls={false}
                  onAttachModelFile={attachModelFile}
                  projectFilePath={activeFilePath}
                />
              )}
          </SelectionInspector>
        )}
        {/*
          * One bottom surface for every result the app produces.
          *
          * It replaces three that each owned a slice of the window: the
          * schematic's diagnostics strip, the simulator's telemetry dock, and
          * the analysis plotter as a 400px right-hand column. That merge is
          * what survives; the axis is what changed. In a wide simulator it is
          * the right-hand pane again - but as ONE surface with one landmark
          * and one name, at a width the user drags and Tau remembers, beside a
          * circuit that is no longer a 38% offcut. Everywhere else it is
          * still the bottom drawer over the canvas.
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
            /* Two independent reasons to raise the drawer - a run finishing and
               the rail's `!` - folded into the one signal the drawer reads. A
               string, so either counter moving is a change under `Object.is`. */
            raiseSignal={`${resultsRaise}:${diagnosticsRaise}`}
            onCoverChange={handleDrawerCover}
            orientation={analysisSplit ? "right" : "bottom"}
            preferredHeight={mode === "simulator" ? "half" : "peek"}
            /* Pressing `!` in the simulator has to land on Errors, or the
               button "brings up" a drawer showing waveforms. */
            preferredTab={diagnosticsOpen || mode !== "simulator" ? "errors" : "waveforms"}
            errorBadge={diagnosticsBadge}
            badgeRaiseKey={diagnosticsRaiseKey}
            collapseSignal={diagnosticsCollapse}
            /* Always mounted. The rail's `!` raises and hides this drawer
               (`diagnosticsRaise`/`diagnosticsCollapse` below), it does not
               unmount the panel - because the dock's job is to list what is
               wrong with a sheet BEFORE anyone runs it (P3-14), and a window
               that only exists after you press a button cannot do that. */
            errors={
              <BottomPanel
                result={activeAnalysis}
                isRunning={analysisRunning}
                notices={activeImportNotices}
                issues={dockIssues}
                onSelectComponent={revealDiagnosticComponent}
                onFocusDiagnostic={focusDiagnostic}
                severityPolicy={severityPolicy}
              />
            }
            // P3-14: Measurements is a SIMULATOR surface. It leaked into the
            // schematic because the gate was row count alone, and leaving the
            // simulator does not invalidate the analysis — so any successful
            // run left a populated Measurements tab sitting next to Errors in
            // the editor, which is the reported screenshot exactly. The
            // simulator's own measurement surfaces are untouched.
            measurements={mode !== "simulator" || componentRows.length === 0 ? null : (
              <ComponentMeasurementsPanel
                rows={componentRows}
                selectedId={selectedId}
                onSelect={select}
                variant="compact"
              />
            )}
            waveforms={mode !== "simulator" ? null : (
              <>
              {/*
                * The live scope, above the bounded plotter rather than instead
                * of it. A live run and a finished `.tran` are different
                * measurements of the same circuit and an engineer often wants
                * both; swapping one for the other would also mean the plotter's
                * cursors and measurements vanished the moment Run was pressed.
                *
                * `key` is the run key and nothing else. It is bumped once per
                * run, so a new run gets a fresh pane (and a fresh y-axis), while
                * a run in flight keeps the same element — and therefore the zoom
                * and the pan the user set — through every one of the thirty-odd
                * frames a second landing underneath it.
                */}
              {liveScopeShown && liveRun.ring && (
                <div className="live-scope-host">
                  <LiveScopePane
                    key={liveRun.runKey}
                    ring={liveRun.ring}
                    channels={liveRun.channels}
                    timeWindow={liveRun.timeWindow}
                    onWindowChange={liveRun.setTimeWindow}
                    status={liveRun.status}
                    retention={liveRun.retention}
                  />
                </div>
              )}
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
                    // Every one of these is a run gesture, and the engine is not
                    // free while the live session holds it - see `boundedRuns`.
                    onRun={boundedRuns.tran}
                    onRunOperatingPoint={boundedRuns.op}
                    onRunAcSweep={boundedRuns.ac}
                    onRunDcSweep={boundedRuns.dc}
                    onRunTf={boundedRuns.tf}
                    onRunNoise={boundedRuns.noise}
                    onRunStep={boundedRuns.step}
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
              </>
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
      <StatusBar mode={mode} result={analysis} />
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
      <Suspense fallback={null}>
        {paletteMounted && (
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            onOpenSettings={openSettingsSurface}
          />
        )}
      </Suspense>
      <Suspense fallback={null}>
        {simulationSetupMounted && (
          <SimulationSetupDialog open={simulationSetupOpen} onOpenChange={setSimulationSetupOpen} />
        )}
        {projectSheetPortsMounted && (
          <ProjectSheetPortsDialog
            open={projectSheetPortsOpen}
            onOpenChange={setProjectSheetPortsOpen}
            usedBy={sheetUsedBy}
            interfaceDisabledReason={sheetInterfaceDisabledReason ?? undefined}
          />
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
          body="This clears the current sheet in one undoable step. The tab, saved file path, and file history stay in place; the file on disk is not changed until you save."
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
          Schematic, SPICE netlist, or vendor model file (.lib/.sub)
        </span>
      </div>
    </div>
  );
}

export default App;
