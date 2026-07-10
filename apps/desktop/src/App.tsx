import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "./App.css";
import { Toolbar } from "./components/Toolbar";
import { Canvas } from "./components/Canvas";
import { StatusBar } from "./components/StatusBar";
import { SimulationPanel } from "./components/SimulationPanel";
import { AnalysisErrorBoundary } from "./components/AnalysisErrorBoundary";
import { EmptyState } from "./components/EmptyState";
import { CommandPalette } from "./components/CommandPalette";
import {
  ActivityRail,
  BottomPanel,
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
import { runMeasurements, type MeasResult } from "./simulation/measure";
import { runFourier, type FourierResult } from "./simulation/fourier";
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
import { basename } from "./project/types";
import { validateSchematicDocument } from "./schematic/documentValidation";
import { importAsc } from "./io/ascImport";

const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = {
  stopTime: 0.006,
  steps: 240,
};

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
}

const newTabId = () => `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const blankDocument = (): SchematicDocument => ({ components: [], wires: [], probes: [], netLabels: [] });
const emptyHistory = (): SchematicHistory => ({ past: [], future: [] });

// §10 responsive floor — App.css's `.editor-shell`/`.plotter` mirror these as
// a CSS backstop. The schematic column must stay usable — tabs, canvas
// overlays, and the results table — down to the app's stated 900px minimum
// window width, so the scope column budgets around it instead of squeezing
// it to nothing.
const RAIL_W = 54; // .activity-rail
const HANDLE_W = 8; // .col-resize-handle, one per open column
const SCOPE_MIN = 300; // analysis scope column floor (matches old drag clamp)

function App() {
  const components = useSchematic((s) => s.components);
  const wires = useSchematic((s) => s.wires);
  const toolMode = useSchematic((s) => s.tool.mode);
  const selectedId = useSchematic((s) => s.selectedId);
  const startPlacing = useSchematic((s) => s.startPlacing);
  const startWiring = useSchematic((s) => s.startWiring);
  const startLabeling = useSchematic((s) => s.startLabeling);
  const loadCircuit = useSchematic((s) => s.loadCircuit);
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
  const [runState, setRunState] = useState<"idle" | "complete" | "error" | "stopped">("idle");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mode, setMode] = useState<"schematic" | "simulator">("schematic");
  const [tabs, setTabs] = useState<OpenTab[]>([{ id: "tab-0", title: "untitled.sim", doc: null, history: emptyHistory() }]);
  const [activeId, setActiveId] = useState("tab-0");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [confirmCloseTabId, setConfirmCloseTabId] = useState<string | null>(null);
  const [graphOpen, setGraphOpen] = useState(true);
  const [componentFocusSignal, setComponentFocusSignal] = useState(0);
  const [partsOpen, setPartsOpen] = useState(true);
  const [fitSignal, setFitSignal] = useState(0);
  const [scopeWidth, setScopeWidth] = useState(440);
  const [dcSetup, setDcSetup] = useState<DcSweepSpec>(() => defaultDcSetup([]));
  const [tfSetup, setTfSetup] = useState<TfSpec>(() => defaultTfSetup([]));
  const [noiseSetup, setNoiseSetup] = useState<NoiseSpec>(() => defaultNoiseSetup([]));
  const [stepSetupUi, setStepSetupUi] = useState<StepSetupUi>(() => defaultStepSetupUi([]));
  const [notice, setNotice] = useState<string | null>(null);
  const shellBodyRef = useRef<HTMLDivElement | null>(null);
  const [shellWidth, setShellWidth] = useState(0);
  // ngspice runs outside React's lifecycle. A request version prevents a late
  // result from an edited, closed, or stopped circuit overwriting current UI.
  const analysisRequestRef = useRef(0);

  // Selecting a part opens the Components rail so Properties is immediately usable.
  useEffect(() => {
    if (selectedId && mode === "schematic") setPartsOpen(true);
  }, [selectedId, mode]);

  const writeSim = useProject((s) => s.writeSim);
  const projectRoot = useProject((s) => s.rootPath);
  const projectTree = useProject((s) => s.tree);
  const ensureDefaultWorkspace = useProject((s) => s.ensureDefaultWorkspace);
  const readSim = useProject((s) => s.readSim);
  const didOpenDefaultRef = useRef(false);

  const documentTitle = (tabs.find((tab) => tab.id === activeId) ?? tabs[0])?.title ?? "untitled.sim";
  const activeFilePath = (tabs.find((tab) => tab.id === activeId) ?? tabs[0])?.filePath ?? null;

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => (current === message ? null : current)), 2600);
  }, []);

  // Seed Powerboard workspace on first launch (explorer shows a real project tree).
  useEffect(() => {
    ensureDefaultWorkspace();
  }, [ensureDefaultWorkspace]);

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
    try {
      const result = await runNativeTransient({ components, wires, netLabels, params, directives }, options) ?? runTransientAnalysis({ components, wires, netLabels, params, couplings }, options);
      if (analysisRequestRef.current !== requestId) return;
      setAnalysis(result);
      setRunState(result.ok ? "complete" : "error");
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
      if (analysisRequestRef.current === requestId) setAnalysisRunning(false);
    }
  }, [components, wires, netLabels, params, directives, couplings]);

  const runAnalysis = useCallback(async () => {
    await executeTransient(analysisOptions);
  }, [analysisOptions, executeTransient]);

  const runAndShowSimulator = useCallback(async () => {
    setMode("simulator");
    setGraphOpen(true);
    await executeTransient(analysisOptions);
  }, [analysisOptions, executeTransient]);

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
      const result = await runNativeAcSweep(
        { components, wires, netLabels, params, directives },
        { startHz: 10, stopHz: 1e6, pointsPerDecade: 20 },
      ) ?? runAcSweep({ components, wires, netLabels, params, couplings }, { startHz: 10, stopHz: 1e6, pointsPerDecade: 20 });
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
              analysesFromDirectives(directives).ac ?? { startHz: 10, stopHz: 1e6, pointsPerDecade: 20 },
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
          (await runNativeTransient({ components: ctx.components, wires, netLabels, params: ctx.params, directives: stepDirectives }, analysisOptions))
          ?? runTransientAnalysis({ components: ctx.components, wires, netLabels, params: ctx.params }, analysisOptions);
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
  }, [components, wires, netLabels, params, directives, analysisOptions, stepSetupUi]);

  const stepAnalysis = useCallback(async () => {
    // Native ngspice may return an endpoint in addition to requested samples.
    const maxSteps = isNativeSpiceRuntime() ? MAX_NATIVE_OUTPUT_POINTS - 1 : MAX_TRANSIENT_STEPS;
    const nextOptions = {
      ...analysisOptions,
      steps: Math.min(maxSteps, Math.max(analysisOptions.steps + 1, Math.ceil(analysisOptions.steps * 1.25))),
    };
    setAnalysisOptions(nextOptions);
    setMode("simulator");
    setGraphOpen(true);
    await executeTransient(nextOptions);
    showNotice(`Re-ran transient at ${nextOptions.steps.toLocaleString()} samples.`);
  }, [analysisOptions, executeTransient, showNotice]);

  const stopAnalysis = useCallback(() => {
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
  const openDocument = useCallback((doc: SchematicDocument, title: string, filePath?: string | null) => {
    const snap = snapshotActive(tabs);
    const existing = snap.find((tab) => (filePath ? tab.filePath === filePath : tab.title === title));
    if (existing) {
      setTabs(snap.map((tab) =>
        tab.id === existing.id
          ? { ...tab, doc, history: emptyHistory(), filePath: filePath ?? tab.filePath, dirty: false }
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
        }]);
        setActiveId(snap[0].id);
        loadCircuit(doc);
      } else {
        const id = newTabId();
        setTabs([...snap, { id, title, doc, history: emptyHistory(), filePath: filePath ?? null, dirty: false }]);
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
      openDocument(doc, title.replace(/\.asc$/i, ".sim"), path);
      if (result.warnings.length > 0) {
        console.warn(`Imported ${title} with ${result.warnings.length} warning(s):`, result.warnings);
      }
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Could not import .asc file.");
    }
  }, [openDocument, showNotice]);

  // Open the first Powerboard .sim once so launch isn't a blank untitled canvas.
  useEffect(() => {
    if (didOpenDefaultRef.current || !projectRoot || projectTree.length === 0) return;
    const firstFile = (() => {
      const walk = (nodes: typeof projectTree): { path: string; name: string } | null => {
        for (const n of nodes) {
          if (n.kind === "file" && /\.sim$/i.test(n.name)) return { path: n.path, name: n.name };
          if (n.children) {
            const hit = walk(n.children);
            if (hit) return hit;
          }
        }
        return null;
      };
      return walk(projectTree);
    })();
    if (!firstFile) return;
    didOpenDefaultRef.current = true;
    let cancelled = false;
    void readSim(firstFile.path).then((json) => {
      if (cancelled) return;
      openSimFromProject(firstFile.path, firstFile.name, json);
    });
    return () => {
      cancelled = true;
    };
  }, [projectRoot, projectTree, readSim, openSimFromProject]);

  const saveActiveToProject = useCallback(async () => {
    const tab = tabs.find((t) => t.id === activeId);
    if (!tab?.filePath) {
      showNotice("Create or open a .sim from the Project column, then Save.");
      return;
    }
    const payload = {
      app: "Tau",
      version: 1,
      savedAt: new Date().toISOString(),
      components,
      wires,
      probes,
      netLabels,
      directives,
    };
    try {
      await writeSim(tab.filePath, JSON.stringify(payload, null, 2));
      setTabs((list) => list.map((t) => (t.id === activeId ? { ...t, dirty: false } : t)));
      showNotice(`Saved ${basename(tab.filePath)}`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Save failed.");
    }
  }, [tabs, activeId, projectRoot, components, wires, probes, netLabels, directives, writeSim, showNotice]);

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

  const startNewCircuit = useCallback(() => {
    const snap = snapshotActive(tabs);
    const taken = new Set(snap.map((tab) => tab.title));
    let title = "untitled.sim";
    for (let n = 2; taken.has(title); n += 1) title = `untitled-${n}.sim`;
    const id = newTabId();
    setTabs([...snap, { id, title, doc: blankDocument(), history: emptyHistory() }]);
    setActiveId(id);
    newCircuit();
    invalidateAnalysis();
    setMode("schematic");
    setGraphOpen(true);
    setFitSignal((n) => n + 1);
    showNotice("Started a new blank circuit.");
  }, [tabs, snapshotActive, newCircuit, invalidateAnalysis, showNotice]);

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
      const blank: OpenTab = { id: newTabId(), title: "untitled.sim", doc: blankDocument(), history: emptyHistory() };
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
  }, [components, wires, invalidateAnalysis]);

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

  return (
    <div className={`app app-${mode}`}>
      <Toolbar
        mode={mode}
        result={analysis}
        runState={runState}
        isRunning={analysisRunning}
        title={documentTitle}
        onModeChange={setMode}
        onRun={runAndShowSimulator}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div
        ref={shellBodyRef}
        className="shell-body"
        style={{ "--scope-w": `${scopeWidth}px` } as CSSProperties}
      >
        <ActivityRail
          mode={mode}
          partsOpen={partsOpen && mode === "schematic"}
          onModeChange={setMode}
          onSearch={() => setPaletteOpen(true)}
          onFocusComponents={() => {
            setMode("schematic");
            setPartsOpen((open) => {
              const next = !open;
              if (next) setComponentFocusSignal((value) => value + 1);
              return next;
            });
          }}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        {mode === "schematic" && (
          <ExplorerPanel
            activeFilePath={activeFilePath}
            onOpenSimFile={openSimFromProject}
            onOpenAscText={openAscFromProject}
            onNotice={showNotice}
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
            <Canvas analysis={analysis} op={opAnalysis} interactive fitSignal={fitSignal} />
            {components.length === 0 && wires.length === 0 && toolMode === "select" && (
              <EmptyState />
            )}
          </main>
          <BottomPanel result={analysis} />
        </section>
        )}
        {mode === "simulator" && graphOpen && (
          <>
            <AnalysisErrorBoundary>
              <SimulationPanel
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
                options={analysisOptions}
                isRunning={analysisRunning}
                onOptionsChange={setAnalysisOptions}
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
        {mode === "schematic" && partsOpen && (
          <ComponentsRail focusSignal={componentFocusSignal} onNotice={showNotice} />
        )}
      </div>
      <StatusBar mode={mode} result={analysis} title={documentTitle} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
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
      {notice && <div className="shell-toast" role="status">{notice}</div>}
    </div>
  );
}

export default App;
