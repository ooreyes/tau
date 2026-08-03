import { extractCircuit, isResistiveWire, netAtPoint, spiceSafeToken, type ExtractedCircuit, type ExtractedComponent } from "../schematic/netlist";
import { resolveComponentValues, expandDirectiveLines, inlineFuncCalls, substituteKnownBraces, substituteBehavioralBraces, substituteScopeIdentifiers, EMPTY_SCOPE, type ParamScope } from "../simulation/paramScope";
import type { ComponentKind, NetLabel, SchematicComponent, SchematicForeignSymbol, SchematicWire } from "../schematic/types";
import { parseQuantity } from "../simulation/quantity";
import { decodeParams } from "../schematic/params";
import { parseSourceFunction } from "./sourceFunction";
import { stripAcSpec, acSpecDeckText, stripSourceModifiers } from "./acSpec";
import { stripIcSpec, icSpecDeckText, parseIcValue } from "./icSpec";
import { behavioralSpecText as behavioralSpec, ifToTernary, ltFuncsToNgspice, moduloToFloor, statFuncsToNgspice } from "../simulation/behavioral";
import { parseComparator, comparatorDeckLine } from "./comparatorSpec";
import { parseCrystal, crystalDeckLines } from "./crystalSpec";
import { parseDigitalGate, digitalGateDeckLines, dflopDeckLines } from "./digitalGateSpec";
import { sampleHoldDeckLines } from "./sampleHoldSpec";
import { parseModulator, modulatorDeckLines } from "./modulatorSpec";
import { parseOpampAvol, railClampedOpampLine } from "./opampSpec";
import { optionsLineFromDirectives } from "./spiceOptions";
import { modelLibLinesFromDirectives, definedModelNames, definedModelTypes, definedSubcktNames } from "./modelDirectives";
import { couplingLinesFromDirectives } from "./couplingDirectives";
import { laplaceTransfer, laplaceSourceLines } from "./laplace";
import { coreInductance } from "./coreInductor";
import { standardModelLine, standardModelType } from "./standardModels";
import { bundledSubcircuitBlock, bundledLibraryText, sanitizeSubcktName } from "./bundledSubcircuits";
import { parseUserModelLibraries, resolveUserModel, resolveUserSubckt, translateSwitchModelCard } from "./userModelLibrary";
import { tlineDeckParams } from "./tlineSpec";
import { parseTempDirective } from "../io/directiveAnalysis";
import { assertSimulationIntegrity } from "../simulation/simulationIntegrity";
import { parseVaristor, varistorDeckLine } from "./varistorSpec";
import { parsePhaseDetector, phaseDetectorDeckLines } from "./phaseDetectorSpec";
import { isLtspiceCurrentControlledSwitch } from "../schematic/currentControlledSwitch";

export type SpiceAnalysis =
  | { kind: "tran"; stopTime: number; steps: number; startTime?: number; maxStep?: number; uic?: boolean; startup?: boolean }
  | { kind: "op" }
  | { kind: "ac"; startHz: number; stopHz: number; pointsPerDecade: number }
  | {
      kind: "dc";
      source: string;
      start: number;
      stop: number;
      step: number;
      /** Optional nested outer source (SPICE: inner source listed first). */
      source2?: string;
      start2?: number;
      stop2?: number;
      step2?: number;
    }
  | {
      kind: "tf";
      /**
       * Output port, already resolved to deck node names / instance names by
       * the caller - `analysisLine` has no net map of its own.
       */
      output:
        | { kind: "voltage"; node: string; refNode?: string }
        | { kind: "current"; device: string };
      /** Instance name of the independent input source. */
      source: string;
    }
  | {
      kind: "noise";
      /**
       * Output port, already resolved to deck node names by the caller, same
       * as `tf` above - `analysisLine` has no net map of its own.
       */
      output: { node: string; refNode?: string };
      /** Instance name of the independent input source the output noise is
       *  referred back to. It must carry an AC stimulus; ngspice aborts the
       *  whole run without one. */
      source: string;
      startHz: number;
      stopHz: number;
      pointsPerDecade: number;
    };

/**
 * One semiconductor whose named model resolved to nothing - no document
 * `.model`, no bundled LTspice standard part, no attached vendor library - and
 * was therefore emitted on a generic `TAU_*` starter instead. A plausible
 * waveform from the wrong device is worse than no waveform, so every one of
 * these is named out loud on the deck's warning channel.
 */
export interface ModelSubstitution {
  /** The part's reference designator as drawn (M1, Q3, D2). */
  ref: string;
  /** The model name the schematic asked for. */
  requested: string;
  /** The generic starter model Tau put on the device line instead. */
  substituted: string;
}

export interface SpiceDeck {
  circuit: ExtractedCircuit;
  netlist: string;
  /** Semiconductors emitted on a generic starter because the model they name is
   *  defined nowhere. Each also appears as prose in `circuit.warnings`, which
   *  every native analysis result forwards to the UI. Empty for a deck whose
   *  every named model resolved. */
  modelSubstitutions: ModelSubstitution[];
  /** Subcircuit reference names (original casing, deduped, sorted) that no
   *  inline directive, bundled library, or user-imported `.lib`/`.subckt`
   *  defines. The netlist still emits their `X` lines, so the native engine
   *  would fail with a cryptic "unknown subckt"; the native runner checks this
   *  first and fails fast with product copy naming the missing part(s). Empty
   *  for every fully-resolved deck. */
  unresolvedSubckts: string[];
  /** Every device whose own current the deck named in a `.save`, and the vector
   *  ngspice returns it under. Recorded per component so the read side looks up
   *  exactly what was asked for instead of rebuilding the name from a ref-des
   *  the emitter may have sanitized. Populated for the transient and
   *  operating-point and AC decks, the analyses that read device currents. */
  deviceCurrents: DeviceCurrent[];
  /** Native `.op` device parameters requested from ngspice (bias voltages,
   *  transconductance/conductance, and MOS/JFET saturation voltage). */
  deviceOperatingPoints: DeviceOperatingVector[];
}

/** One device current a deck asked ngspice to keep. */
export interface DeviceCurrent {
  /** `SchematicComponent.id` of the device that owns the current. */
  componentId: string;
  /** The ngspice vector name, e.g. `@q1[ic]`. */
  vector: string;
  /** The device terminal this current enters, for a part that reports more than
   *  one. Absent on the single current a bare `I(ref)` means, which is what
   *  every read side keyed by ref-des wants; a BJT's `b` and `e` carry theirs.
   *  Same convention as `CurrentTrace.terminal`. */
  terminal?: string;
}

export interface DeviceOperatingVector {
  componentId: string;
  /** User-facing parameter name (`VBE`, `GM`, `VDSAT`, …). */
  name: string;
  /** Exact ngspice vector saved by the deck. */
  vector: string;
  unit: "V" | "S";
}

type Schematic = {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels?: NetLabel[];
  params?: ParamScope;
  /** Document directive lines; any `.options` here override Tau's defaults. */
  directives?: string[];
  /** Raw text of user-imported vendor `.lib`/`.subckt`/`.mod` files (LTspice
   *  parity gap): a component may reference a model/subckt name that is
   *  neither inline nor one of Tau's bundled parts - see userModelLibrary.ts.
   *  Optional and additive; omitting it leaves deck output unchanged. */
  userModelLibraries?: readonly string[];
  /** File names of those same libraries, when the caller has them. A
   *  `.include`/`.lib` naming one of these DID resolve - its text reaches the
   *  deck through the registry above - so it must not also be reported as a
   *  file Tau could not find. Omitting it only costs a redundant warning. */
  userModelLibraryNames?: readonly string[];
  /** Preserved source symbols without a Tau electrical model. */
  ascForeignSymbols?: readonly SchematicForeignSymbol[];
};

const DEFAULT_MODELS = [
  ".model TAU_DIODE D(Is=1e-14 N=1)",
  ".model TAU_LED D(Is=1e-16 N=2 Rs=10)",
  ".model TAU_ZENER D(Is=1e-14 N=1 Bv=5.1 Ibv=1m)",
  ".model TAU_NMOS NMOS(Level=1 Vto=1 Kp=200u Lambda=0.02)",
  ".model TAU_PMOS PMOS(Level=1 Vto=-1 Kp=80u Lambda=0.02)",
  ".model TAU_NPN NPN(Is=1e-14 Bf=100 Vaf=100)",
  ".model TAU_PNP PNP(Is=1e-14 Bf=100 Vaf=100)",
  ".model TAU_NJF NJF(Vto=-2 Beta=1m Lambda=1e-4)",
  ".model TAU_PJF PJF(Vto=2 Beta=1m Lambda=1e-4)",
  // Starter voltage-controlled switch. Ron matches the resistance Tau has
  // always used for a statically closed switch; Roff is held at 1G rather than
  // the static path's 1T because an Ron/Roff ratio that wide is a documented
  // ngspice convergence hazard, and 1G is already an open circuit in any
  // circuit a switch appears in. Vh=0 - hysteresis costs convergence in DC.
  ".model TAU_SW SW(Ron=1m Roff=1e9 Vt=0.5 Vh=0)",
];

/**
 * Convert Tau's neutral schematic into a complete ngspice deck. Models here
 * are intentionally generic starter models; named vendor models belong in an
 * imported library, not in the schematic renderer or React UI.
 */
/** LTspice behavioral element values: a `V=` / `I=` / `R=` expression prefix. */
function isBehavioralValue(value: string | undefined): boolean {
  return !!value && /^\s*[VIR]\s*=/i.test(value);
}

function importedSymbolLeaf(component: SchematicComponent): string {
  const segments = (component.ltSymbolType ?? "").trim().split(/[\\/]/);
  return segments[segments.length - 1]?.toLowerCase() ?? "";
}

export function buildSpiceDeck(schematic: Schematic, analysis: SpiceAnalysis): SpiceDeck {
  assertSimulationIntegrity(schematic.components, schematic.ascForeignSymbols);
  const paramScope = schematic.params ?? EMPTY_SCOPE;
  // Behavioral (V=/I=/R=) expressions may legitimately reference run-time
  // state (`time`, `V(node)`) inside braces or as bare param names - LTspice
  // resolves those late, so route them through the lenient behavioral
  // substitution instead of the strict numeric brace resolver, which would
  // reject the whole deck with e.g. `Unknown parameter "time"` (SRF_PLL).
  // (After behavioral substitution those values are brace-free, so the strict
  // resolver below leaves them untouched and everything else stays strict.)
  const components = resolveComponentValues(
    schematic.components.map((component) =>
      isBehavioralValue(component.value)
        ? { ...component, value: substituteScopeIdentifiers(substituteBehavioralBraces(inlineFuncCalls(component.value, paramScope.funcs), paramScope), paramScope) }
        : component,
    ),
    paramScope,
  );
  const circuit = extractCircuit(components, schematic.wires, schematic.netLabels ?? []);
  if (components.length === 0) throw new Error("Place components before running analysis.");
  if (!circuit.groundNetId) throw new Error("Add a ground symbol so node voltages have a reference.");

  // Branch-current references in behavioral expressions. LTspice's B-sources
  // may read ANY element's current (`V=I(R1)`, BATTERY_ECM's coulomb counter);
  // ngspice only knows V-source/inductor branch currents, and a flattened
  // block's element is emitted under its instance-prefixed name (RX16_R1), so
  // a verbatim `I(R1)` dies with "unknown controlling source". Resolve the
  // reference LTspice-style - innermost enclosing block first, then outward -
  // then rewrite: V-source/inductor refs to the emitted instance name,
  // resistor refs to Ohm's law over the resistor's own nets.
  const componentsByLabel = new Map<string, { entry: ExtractedComponent; index: number }>();
  circuit.components.forEach((entry, index) => {
    const label = entry.component.label?.trim().toLowerCase();
    if (label && !componentsByLabel.has(label)) componentsByLabel.set(label, { entry, index });
  });
  // Deck instance names, resolved once so behavioral current refs, coupling
  // lines, and element emission all agree; throws on a genuine duplicate.
  const instanceNames = resolveInstanceNames(circuit.components);
  const resolveScopedComponent = (
    ref: string,
    ownerLabel: string,
  ): { entry: ExtractedComponent; index: number } | null => {
    const segments = ownerLabel.split(".");
    for (let keep = segments.length - 1; keep >= 0; keep -= 1) {
      const prefix = segments.slice(0, keep).join(".");
      const target = componentsByLabel.get((prefix ? `${prefix}.${ref}` : ref).toLowerCase());
      if (target) return target;
    }
    return null;
  };
  const deckNode = (netId: string | undefined): string | null =>
    netId === undefined ? null : netId === circuit.groundNetId ? "0" : netId.toLowerCase();
  // Node names inside behavioral expressions must transliterate exactly like
  // net labels do (spiceSafeToken), or a Greek-named net (`V(θ_pll)`,
  // `V(uα)`) silently references a different, floating node in the deck.
  const sanitizeExprNodeRefs = (value: string): string =>
    value.replace(/\bV\s*\(\s*([^\s(),]+)\s*(?:,\s*([^\s(),]+)\s*)?\)/giu, (_m, a: string, b?: string) =>
      b ? `V(${spiceSafeToken(a)},${spiceSafeToken(b)})` : `V(${spiceSafeToken(a)})`,
    );
  const rewriteCurrentRefs = (value: string, ownerLabel: string): string =>
    value.replace(/\bI\s*\(\s*([\w.]+)\s*\)/gi, (match, ref: string) => {
      const target = resolveScopedComponent(ref, ownerLabel);
      if (target) {
        const kind = target.entry.component.kind;
        if (kind === "vsource" || kind === "vac" || kind === "inductor") {
          return `I(${instanceNames.get(target.index)!})`;
        }
        if (kind === "resistor") {
          const a = deckNode(target.entry.pins.a);
          const b = deckNode(target.entry.pins.b);
          try {
            const ohms = parseQuantity(target.entry.component.value, "Ω");
            if (a !== null && b !== null && ohms !== 0) return `((V(${a})-V(${b}))/(${ohms}))`;
          } catch {
            /* behavioral/unparseable resistance - leave the reference as-is */
          }
        }
        return match;
      }
      return match;
    });
  for (const entry of circuit.components) {
    const value = entry.component.value;
    if (entry.component.kind === "bsource" || isBehavioralValue(value)) {
      const rewritten = sanitizeExprNodeRefs(rewriteCurrentRefs(value, entry.component.label ?? ""));
      if (rewritten !== value) entry.component = { ...entry.component, value: rewritten };
    }
  }

  // LTspice packs several directives into one on-canvas TEXT block joined by the
  // literal `\n` escape (e.g. `.ic v(vo)=0.5\n.tran 10m`). The single-line
  // directive consumers below must see one directive per entry, or two collapse
  // into one malformed line; `expandDirectiveLines` splits on `\n` and strips
  // `;` comments. Multi-line *blocks* (`.subckt…ends`, `.model` continuations)
  // stay on the raw list, which `modelLibLinesFromDirectives` re-splits itself.
  const rawDirectives = schematic.directives ?? [];
  const flatDirectives = expandDirectiveLines(rawDirectives);

  const lines = ["Tau generated circuit", optionsLineFromDirectives(flatDirectives)];
  const usedKinds = new Set(components.map((component) => component.kind));
  const needsModels = ["diode", "led", "zener", "nmos", "pmos", "njf", "pjf", "npn", "pnp"].some((kind) => usedKinds.has(kind as ComponentKind))
    || components.some((component) => component.kind === "switch" && !isLtspiceCurrentControlledSwitch(component));
  if (needsModels) lines.push(...DEFAULT_MODELS);

  // Carry the document's own `.model`/`.lib`/`.inc`/`.subckt` definitions into the
  // deck so an imported `.asc` simulates against its real device models and
  // libraries instead of only Tau's generic starter models. A `.include`/`.lib`
  // that names a BUNDLED LTspice library file (1563.asc's `.include TowTom2.sub`)
  // is replaced by the bundled text itself - ngspice can't resolve LTspice's
  // lib/sub paths from Tau's working directory. Names those texts define are
  // tracked so the per-instance emission below doesn't duplicate the block.
  const inlinedSubckts = new Set<string>();
  // Files named by a `.include`/`.lib` that resolved to nothing, in first-seen
  // order. Such a directive is left OUT of the deck: the native sanitizer
  // (src-tauri/src/spice.rs `deck_lines`) rejects every file-backed primitive,
  // so emitting it verbatim failed the whole run on a card the user never
  // wrote by hand and cannot act on. Dropping it costs nothing that was
  // working and is not silent - the file is named on the warning channel here,
  // and any definition that went missing with it still surfaces through
  // `unresolvedSubckts` (fatal, names the part) or a model substitution.
  const unresolvedLibraryFiles = new Set<string>();
  const attachedLibraryFiles = new Set(
    (schematic.userModelLibraryNames ?? []).map(libraryFileKey).filter((key) => key !== ""),
  );
  // Track `.subckt … .ends` nesting: LTspice evaluates a `{param}` on a
  // passthrough `.model` line against the document's global `.param` scope
  // (Fc.asc's `.model DX D(Cjo={Cjo} …)` - ngspice instead dies with
  // "Undefined parameter"), but a brace INSIDE a document-defined subckt body
  // must stay verbatim for ngspice to resolve against the subckt's own params.
  let subcktDepth = 0;
  const passthroughScope = schematic.params ?? EMPTY_SCOPE;
  for (const line of modelLibLinesFromDirectives(rawDirectives)) {
    const fileRef = /^\.(include|lib)\s+(.+)$/i.exec(line.trim());
    // Resolve and report against the SAME token, so a directive the bundled
    // lookup never really tried can't be reported as an unresolvable file.
    const file = fileRef ? includedFileName(fileRef[2]) : "";
    const bundled = file ? bundledLibraryText(file) : null;
    if (bundled) {
      lines.push(bundled);
      for (const m of bundled.matchAll(/^\.subckt\s+(\S+)/gim)) inlinedSubckts.add(m[1].toLowerCase());
    } else if (fileRef) {
      if (file && !attachedLibraryFiles.has(libraryFileKey(file))) unresolvedLibraryFiles.add(file);
    } else {
      if (/^\.subckt\b/i.test(line.trim())) subcktDepth += 1;
      const substituted = subcktDepth > 0 ? line : substituteKnownBraces(line, passthroughScope);
      // A VSWITCH/ISWITCH threshold may itself be a `{param}` expression.
      // modelDirectives translates literal levels first; retry after global
      // substitution so a parameterized card also reaches ngspice as SW/CSW.
      lines.push(translateSwitchModelCard(substituted));
      if (/^\.ends\b/i.test(line.trim())) subcktDepth = Math.max(0, subcktDepth - 1);
    }
  }
  for (const file of unresolvedLibraryFiles) circuit.warnings.push(unresolvedLibraryWarning(file));

  // Carry mutual-inductance `K` coupling directives (transformer windings) into
  // the deck with any `{expr}` coefficient resolved; without this a coupled
  // transformer would simulate as independent inductors. A `K` line names
  // inductors by their LTspice instance name, but the deck renames an inductor
  // whose label isn't a valid ngspice `L…` name, so pass the rename map to keep
  // the references in sync.
  const inductorNames = new Map<string, string>();
  circuit.components.forEach((entry, index) => {
    if (entry.component.kind !== "inductor") return;
    const label = safeName(entry.component.label).toLowerCase();
    if (label) inductorNames.set(label, instanceNames.get(index)!);
  });
  lines.push(...couplingLinesFromDirectives(flatDirectives, schematic.params ?? EMPTY_SCOPE, inductorNames));

  // Carry a document `.temp <°C>` into the deck so native ngspice runs its
  // temperature-dependent device models at the authored operating temperature.
  for (const directive of flatDirectives) {
    const temp = parseTempDirective(directive);
    if (temp !== null) {
      lines.push(`.temp ${temp}`);
      break;
    }
  }

  // ngspice's `.ic` accepts node voltages only, while LTspice additionally
  // accepts `I(Lname)=…` for an inductor. Translate those current assignments
  // onto the inductor instance (`IC=…`) and leave only voltage assignments on
  // `.ic`. Stale inductor-current targets left behind by schematic editing are
  // explicit circuit warnings instead of fatal ngspice parser errors.
  const {
    lines: icLines,
    hasIc,
    inductorCurrents,
    warnings: icWarnings,
  } = icLinesFromDirectives(flatDirectives, circuit, paramScope);
  circuit.warnings.push(...icWarnings);
  lines.push(...icLines);

  const userModels = definedModelNames(schematic.directives ?? []);
  const documentModelTypes = definedModelTypes(schematic.directives ?? []);
  // VDMOS power-MOSFET model names (lower-cased), from the document's own
  // `.model … VDMOS(…)` definitions. A MOSFET on one of these emits a 3-terminal
  // VDMOS device line (the bulk node is dropped - see `componentLines`).
  const vdmosModels = new Set<string>();
  for (const [model, type] of documentModelTypes) {
    if (type === "vdmos") vdmosModels.add(model);
  }

  // User-imported vendor library text (.lib/.subckt/.mod files the user
  // attached alongside the schematic - userModelLibrary.ts), parsed once.
  // Consulted only as the LAST resolution source below, after inline document
  // directives and Tau's bundled standard/subckt libraries, and always
  // INLINED as literal text: the native engine's deck sanitizer
  // (src-tauri/src/spice.rs `deck_lines`) rejects any `.include`/`.lib`/
  // `file=` primitive, so there is no other way to pull a user model in.
  // Parsing an empty/absent list yields an empty registry, so every lookup
  // below misses and deck output is unchanged when no libraries are supplied.
  const userLibraryRegistry = parseUserModelLibraries(schematic.userModelLibraries ?? []);

  // A semiconductor may reference an LTspice standard part by name (1N4148,
  // 2N2222, …) with no inline `.model`. When the document doesn't define it but
  // we bundle it, emit the real LTspice model line so the device simulates with
  // its actual parameters instead of a generic `TAU_*` starter. The union of
  // user-defined + emitted-standard names tells `deviceModel` which names are
  // safe to put on the device line.
  const knownModels = new Set(userModels);

  // LTspice's csw.asy is a W device: its Value is exactly
  // `<controlling voltage source> <CSW model> [on|off]`. Validate and resolve
  // every identity before component emission so a missing source/model can
  // never degrade into the generic switch's fixed-open resistor. Attached
  // ISWITCH cards have already been translated to ngspice CSW by the registry.
  const currentSwitchSpecs = new Map<number, CurrentSwitchDeckSpec>();
  const emittedCurrentSwitchModels = new Set<string>();
  circuit.components.forEach((entry, index) => {
    const component = entry.component;
    if (!isLtspiceCurrentControlledSwitch(component)) return;
    const ref = component.label.trim() || `W${index + 1}`;
    const spec = parseCurrentSwitchValue(component.value);
    if (!spec) {
      throw currentSwitchRefusal(ref, `its value must be "Vsense Model [on|off]"; received "${component.value.trim()}"`);
    }

    const control = resolveScopedComponent(spec.controlSource, component.label ?? "");
    if (!control) {
      throw currentSwitchRefusal(ref, `controlling voltage source "${spec.controlSource}" was not found`);
    }
    if (!["vsource", "vac", "vpulse"].includes(control.entry.component.kind)) {
      throw currentSwitchRefusal(
        ref,
        `"${spec.controlSource}" is a ${control.entry.component.kind}, not a voltage source`,
      );
    }
    const controlName = instanceNames.get(control.index);
    if (!controlName || !/^V/i.test(controlName)) {
      throw currentSwitchRefusal(ref, `controlling source "${spec.controlSource}" has no valid V-device identity`);
    }

    const modelKey = spec.model.toLowerCase();
    const inlineType = documentModelTypes.get(modelKey);
    if (inlineType !== undefined && inlineType !== "csw" && inlineType !== "iswitch") {
      throw currentSwitchRefusal(ref, `model "${spec.model}" is ${inlineType.toUpperCase()}, not CSW`);
    }
    if (inlineType !== undefined) {
      const emittedType = lines
        .flatMap((line) => line.split("\n"))
        .map((line) => /^\s*\.model\s+(\S+)\s+([A-Za-z][\w-]*)/i.exec(line))
        .find((match) => match?.[1].toLowerCase() === modelKey)?.[2].toLowerCase();
      if (emittedType !== "csw") {
        throw currentSwitchRefusal(
          ref,
          `model "${spec.model}" could not be translated to an ngspice CSW card`,
        );
      }
    }
    if (inlineType === undefined) {
      const userLine = resolveUserModel(userLibraryRegistry, spec.model);
      if (!userLine) {
        throw currentSwitchRefusal(ref, `model "${spec.model}" was not found`);
      }
      const attachedType = /^\s*\.model\s+\S+\s+([A-Za-z][\w-]*)/i.exec(userLine)?.[1].toLowerCase();
      if (attachedType !== "csw") {
        throw currentSwitchRefusal(
          ref,
          `model "${spec.model}" is ${(attachedType ?? "unknown").toUpperCase()}, not CSW`,
        );
      }
      if (!emittedCurrentSwitchModels.has(modelKey)) {
        lines.push(userLine);
        emittedCurrentSwitchModels.add(modelKey);
      }
      knownModels.add(modelKey);
    }
    currentSwitchSpecs.set(index, { ...spec, controlSource: controlName });
  });
  const SEMI_KINDS: ReadonlySet<ComponentKind> = new Set([
    "diode", "led", "zener", "npn", "pnp", "nmos", "pmos", "njf", "pjf",
  ]);
  const emittedStandard = new Set<string>();
  for (const { component } of circuit.components) {
    if (!SEMI_KINDS.has(component.kind)) continue;
    const named = component.value.trim().split(/\s+/)[0] ?? "";
    if (!named || knownModels.has(named.toLowerCase())) continue;
    // An attached vendor library (userModelLibrary.ts) is checked BEFORE Tau's
    // bundled standard part so a user-attached `.model 1N4148 …` wins over a
    // same-named bundled model instead of being silently shadowed by it - this
    // is LTspice's local-definition-wins semantics and matches user intent. It
    // only changes behavior for documents that HAVE an attachment: with none,
    // `resolveUserModel` misses (empty registry) and every name falls through
    // to `standardModelLine` exactly as before.
    const userLine = resolveUserModel(userLibraryRegistry, named);
    if (userLine) {
      lines.push(userLine);
      knownModels.add(named.toLowerCase());
      continue;
    }
    const line = standardModelLine(named);
    if (line && !emittedStandard.has(named.toLowerCase())) {
      lines.push(line);
      emittedStandard.add(named.toLowerCase());
      knownModels.add(named.toLowerCase());
      if (standardModelType(named) === "vdmos") vdmosModels.add(named.toLowerCase());
    }
  }

  // A subcircuit instance references its `.subckt` by name (the value's first
  // token). When the document neither defines that name nor `.include`s a
  // bundled library that does, emit the bundled block (engine/
  // bundledSubcircuits.ts) so the deck is self-contained - this is how the
  // ISO16750-2/ISO7637-2 symbols work in LTspice, whose `.asy` ModelFile
  // attribute pulls the library in without any on-canvas directive.
  const emittedSubckts = new Set<string>();
  for (const { component } of circuit.components) {
    if (component.kind !== "subckt") continue;
    if (importedSymbolLeaf(component) === "varistor") continue;
    const ref = sanitizeSubcktName(component.value.trim().split(/\s+/)[0] ?? "").toLowerCase();
    if (!ref || userModels.has(ref) || inlinedSubckts.has(ref) || emittedSubckts.has(ref)) continue;
    // Same local-definition-wins rule as the model loop above: an attached
    // vendor library's `.subckt` wins over a bundled subcircuit of the same
    // name, checked first so it is never shadowed.
    const userBlock = resolveUserSubckt(userLibraryRegistry, ref);
    if (userBlock) {
      lines.push(userBlock);
      emittedSubckts.add(ref);
      continue;
    }
    const block = bundledSubcircuitBlock(ref);
    if (block) {
      lines.push(block);
      emittedSubckts.add(ref);
    }
  }

  // A per-instance C/L initial condition also needs `uic` so the value holds at
  // t=0, exactly like a `.ic` directive.
  const hasInstanceIc = circuit.components.some(
    ({ component }) =>
      (component.kind === "capacitor" || component.kind === "inductor") &&
      parseIcValue(component.value) !== null,
  );

  // Pin count per net, so emission can tell a driven net from a floating pin's
  // singleton net (every unconnected pin still gets its own net id). A net
  // label counts as an endpoint: a single-pin net probed through a bare flag
  // (Educational/SampleAndHold.asc's A/B outputs) is connected, not floating.
  const netPinCount = new Map<string, number>(
    circuit.nets.map((net) => [net.id, net.pins.length + (net.labelCount > 0 ? 1 : 0)]),
  );

  // Names a BJT's Value may reference that are actually `.subckt`s (document
  // passthrough or an inlined bundled library): LTspice netlists such a device
  // as an X instance with the same node order; ngspice's Q line would die with
  // "could not find a valid modelname" (UHFpreamp's MRF901).
  const subcktModels = new Set([...definedSubcktNames(rawDirectives), ...inlinedSubckts]);

  // A `subckt` instance whose referenced name resolves to no definition
  // anywhere - inline document `.subckt`, a bundled library block, or a
  // user-imported vendor `.lib`/`.subckt` - reaches ngspice as an `X` line with
  // no matching `.subckt` and fails with a cryptic native error. Collect those
  // names (original casing, deduped) so the native runner can fail fast with
  // product copy naming exactly which part's library is missing. Membership is
  // tested against both the sanitized and raw forms of every known-defined name
  // so a legitimately resolvable reference is never flagged.
  const definedSubcktRefs = new Set<string>();
  for (const known of [...subcktModels, ...emittedSubckts, ...userModels]) {
    definedSubcktRefs.add(known);
    definedSubcktRefs.add(sanitizeSubcktName(known).toLowerCase());
  }
  const unresolvedByKey = new Map<string, string>();
  for (const { component } of circuit.components) {
    if (component.kind !== "subckt") continue;
    if (importedSymbolLeaf(component) === "varistor") continue;
    const displayName = component.value.trim().split(/\s+/)[0] ?? "";
    if (!displayName) continue; // an empty name is already a hard build error below
    const rawKey = displayName.toLowerCase();
    const sanitizedKey = sanitizeSubcktName(displayName).toLowerCase();
    if (definedSubcktRefs.has(rawKey) || definedSubcktRefs.has(sanitizedKey)) continue;
    if (!unresolvedByKey.has(sanitizedKey)) unresolvedByKey.set(sanitizedKey, displayName);
  }
  const unresolvedSubckts = [...unresolvedByKey.values()].sort((a, b) => a.localeCompare(b));

  // Every generic-starter substitution the emission below makes, collected so
  // the deck can name each one instead of quietly plotting a device Tau does
  // not have.
  const modelSubstitutions: ModelSubstitution[] = [];
  // Transient, operating point, and AC read device currents back. A `.save`
  // card is not free - it changes what a run keeps - and `all` keeps the card
  // additive rather than replacing ngspice's default set (verified on an
  // `.op` deck: every node voltage and `#branch` current still comes back
  // alongside the named device currents). Recording only what was actually
  // asked for is what keeps the read side from looking up a vector this deck
  // never requested.
  const wantsDeviceCurrents = analysis.kind === "tran" || analysis.kind === "op" || analysis.kind === "ac";
  const deviceCurrents: DeviceCurrent[] = [];
  const deviceOperatingPoints: DeviceOperatingVector[] = [];
  circuit.components.forEach((entry, index) => {
    const directiveIc = entry.component.kind === "inductor"
      ? inductorCurrents.get(entry.component.label.trim().toLowerCase())
      : undefined;
    const emitted = componentLines(
      entry,
      index,
      instanceNames.get(index) ?? "",
      knownModels,
      schematic.params ?? EMPTY_SCOPE,
      vdmosModels,
      netPinCount,
      subcktModels,
      directiveIc,
      modelSubstitutions,
      analysis.kind === "tran" && analysis.startup ? Math.min(20e-6, analysis.stopTime) : undefined,
      currentSwitchSpecs.get(index),
    );
    lines.push(...emitted);
    // Read off the lines that were actually emitted rather than off the
    // component kind: a BJT whose Value names a `.subckt` goes out as an `X`
    // call, which has no device vector, and only the emitted line knows that.
    if (wantsDeviceCurrents) {
      for (const line of emitted) {
        const vector = deviceCurrentVector(line);
        if (vector) deviceCurrents.push({ componentId: entry.component.id, vector });
        for (const extra of deviceTerminalCurrentVectors(line)) {
          deviceCurrents.push({ componentId: entry.component.id, ...extra });
        }
      }
    }
    if (analysis.kind === "op") {
      for (const line of emitted) {
        for (const parameter of deviceOperatingPointVectors(line)) {
          deviceOperatingPoints.push({ componentId: entry.component.id, ...parameter });
        }
      }
    }
    // A switch that names a model but has no wired control pair silently
    // degraded to a fixed open circuit before this was reported.
    if (
      entry.component.kind === "switch"
      && !isLtspiceCurrentControlledSwitch(entry.component)
      && !isStaticSwitchState(entry.component.value)
      && switchControlNodes(entry, netPinCount) === null
    ) {
      circuit.warnings.push(uncontrolledSwitchWarning(entry.component));
    }
  });
  circuit.warnings.push(...modelSubstitutions.map(modelSubstitutionMessage));

  // Non-ideal wires: series resistors between the nets at each endpoint.
  // Ideal wires already shorted those nets in extractCircuit.
  let wireRIndex = 0;
  for (const wire of schematic.wires) {
    if (!isResistiveWire(wire) || wire.points.length < 2) continue;
    const a = wire.points[0];
    const b = wire.points[wire.points.length - 1];
    const netA = netAtPoint(circuit.nets, schematic.wires, a);
    const netB = netAtPoint(circuit.nets, schematic.wires, b);
    if (!netA || !netB) continue;
    const nodeA = (netA.isGround ? "0" : netA.id).toLowerCase();
    const nodeB = (netB.isGround ? "0" : netB.id).toLowerCase();
    if (nodeA === nodeB) continue;
    wireRIndex += 1;
    const ohms = parseWireResistanceOhms(wire.resistance ?? "0");
    if (!(ohms > 0)) continue;
    lines.push(`RWIRE${wireRIndex} ${nodeA} ${nodeB} ${ohms}`);
  }

  // A semiconductor's own current exists only if the deck asks for it by name.
  const savedVectors = [...new Set([
    ...deviceCurrents.map((device) => device.vector),
    ...deviceOperatingPoints.map((parameter) => parameter.vector),
  ])];
  if (savedVectors.length > 0) {
    lines.push(...saveCardLines(savedVectors));
  }
  lines.push(analysisLine(analysis, hasIc || hasInstanceIc), ".end");

  return {
    circuit,
    netlist: lines.join("\n"),
    unresolvedSubckts,
    modelSubstitutions,
    deviceCurrents,
    deviceOperatingPoints,
  };
}

/**
 * The current ngspice reports for a device that asks for one, keyed by the
 * element letter its instance line starts with. A BJT reports its collector
 * current and a three-terminal device its drain current, which is what `I(Q1)`
 * and `I(M1)` mean everywhere in Tau.
 *
 * ngspice returns these only as `@<ref>[<param>]`, and only for a deck that
 * named them, so this table is at once what the deck saves and what the result
 * is read back by - `nativeSpice` imports it rather than restating it, because
 * a device saved under one name and looked up under another yields no trace at
 * all and no error to say why.
 */
export const DEVICE_CURRENT_PARAMS: Readonly<Record<string, string>> = {
  d: "id",
  q: "ic",
  m: "id",
  j: "id",
};

/**
 * `@q1[ic]` for the instance line `Q1 c b e TAU_NPN`. Undefined for any element
 * ngspice has no such vector for: an `X` subcircuit call, a source, a passive,
 * a behavioral `B` source.
 */
export function deviceCurrentVector(instanceLine: string): string | undefined {
  const name = instanceLine.trim().split(/\s+/)[0] ?? "";
  const param = DEVICE_CURRENT_PARAMS[name.slice(0, 1).toLowerCase()];
  return param ? `@${name.toLowerCase()}[${param}]` : undefined;
}

/**
 * The currents a device reports BEYOND the one `I(ref)` means, keyed by element
 * letter. A BJT is the case that matters: ngspice returns `@q1[ib]` and
 * `@q1[ie]` alongside the collector current, so a base or emitter waveform is
 * available for the asking and used to be unreachable.
 *
 * Every one of these is the current INTO its terminal - `@q1[ie]` is negative
 * for a forward-active NPN - which is why the three sum to zero and why the
 * read side stores them unflipped, exactly as it does the collector current.
 *
 * A param is `i` + its terminal letter, so the letter is derived rather than
 * listed twice; nothing here may name a param that breaks that.
 *
 * A MOSFET reports its gate and source the same way, but NOT its bulk. Only a
 * model with a bulk terminal has `@m1[ib]` at all, and Tau emits a 3-terminal
 * line for any MOSFET on a VDMOS model (see `componentLines`) - which is what
 * an LTspice power MOSFET is. ngspice does not refuse the card for one: it
 * creates the vector ZERO-LENGTH, so the run succeeds and says nothing, and the
 * part carries an empty trace. Only params every model of a kind actually
 * reports belong here; the bulk is deliberately absent.
 */
export const DEVICE_TERMINAL_CURRENT_PARAMS: Readonly<Record<string, readonly string[]>> = {
  q: ["ib", "ie"],
  m: ["ig", "is"],
};

/** `@q1[ib]` / `@q1[ie]` for the instance line `Q1 c b e TAU_NPN`, each tagged
 *  with the terminal it enters. Empty for every element with one current. */
export function deviceTerminalCurrentVectors(instanceLine: string): { vector: string; terminal: string }[] {
  const name = instanceLine.trim().split(/\s+/)[0] ?? "";
  const params = DEVICE_TERMINAL_CURRENT_PARAMS[name.slice(0, 1).toLowerCase()] ?? [];
  return params.map((param) => ({ vector: `@${name.toLowerCase()}[${param}]`, terminal: param.slice(1) }));
}

const DEVICE_OPERATING_PARAMS: Readonly<Record<string, readonly { name: string; param: string; unit: "V" | "S" }[]>> = {
  d: [
    { name: "VD", param: "vd", unit: "V" },
    { name: "GD", param: "gd", unit: "S" },
  ],
  q: [
    { name: "VBE", param: "vbe", unit: "V" },
    { name: "VBC", param: "vbc", unit: "V" },
    { name: "GM", param: "gm", unit: "S" },
    { name: "GPI", param: "gpi", unit: "S" },
    { name: "GO", param: "go", unit: "S" },
  ],
  m: [
    { name: "VGS", param: "vgs", unit: "V" },
    { name: "VDS", param: "vds", unit: "V" },
    { name: "VON", param: "von", unit: "V" },
    { name: "VDSAT", param: "vdsat", unit: "V" },
    { name: "GM", param: "gm", unit: "S" },
    { name: "GDS", param: "gds", unit: "S" },
  ],
  j: [
    { name: "VGS", param: "vgs", unit: "V" },
    { name: "VDS", param: "vds", unit: "V" },
    { name: "VDSAT", param: "vdsat", unit: "V" },
    { name: "GM", param: "gm", unit: "S" },
    { name: "GDS", param: "gds", unit: "S" },
  ],
};

/** Device bias/small-signal parameters that ngspice exposes on an `.op` plot. */
export function deviceOperatingPointVectors(
  instanceLine: string,
): { name: string; vector: string; unit: "V" | "S" }[] {
  const instance = instanceLine.trim().split(/\s+/)[0] ?? "";
  const parameters = DEVICE_OPERATING_PARAMS[instance.slice(0, 1).toLowerCase()] ?? [];
  return parameters.map(({ name, param, unit }) => ({
    name,
    vector: `@${instance.toLowerCase()}[${param}]`,
    unit,
  }));
}

/** Width to wrap the `.save` card at, well inside any SPICE line-length limit. */
const SAVE_CARD_WIDTH = 120;

/**
 * The `.save` card naming every device current the deck wants, wrapped onto `+`
 * continuations so a schematic full of transistors cannot produce one enormous
 * line.
 *
 * `all` is load-bearing. A bare `.save` REPLACES the default set rather than
 * adding to it, so asking for `@q1[ic]` on its own drops every node voltage and
 * every source branch current from the run - the analysis still succeeds and
 * still plots, just with almost nothing in it.
 */
export function saveCardLines(vectors: readonly string[]): string[] {
  const lines: string[] = [".save all"];
  for (const vector of vectors) {
    const last = lines[lines.length - 1];
    if (last.length + vector.length + 1 <= SAVE_CARD_WIDTH) lines[lines.length - 1] = `${last} ${vector}`;
    else lines.push(`+ ${vector}`);
  }
  return lines;
}

/** How each generic starter reads in product copy, keyed by its model name. */
const GENERIC_MODEL_DESCRIPTION: Record<string, string> = {
  TAU_DIODE: "a generic diode",
  TAU_LED: "a generic LED",
  TAU_ZENER: "a generic 5.1 V zener",
  TAU_NMOS: "a generic NMOS (Level=1)",
  TAU_PMOS: "a generic PMOS (Level=1)",
  TAU_NPN: "a generic NPN",
  TAU_PNP: "a generic PNP",
  TAU_NJF: "a generic N-channel JFET",
  TAU_PJF: "a generic P-channel JFET",
};

/**
 * Product copy for one {@link ModelSubstitution}: the part, the model it asked
 * for, and the consequence. Blunt on purpose - the user is about to read a
 * waveform that looks right and is not, and only this sentence says so.
 */
export function modelSubstitutionMessage(substitution: ModelSubstitution): string {
  const generic = GENERIC_MODEL_DESCRIPTION[substitution.substituted] ?? "a generic starter model";
  return `${substitution.ref}: model "${substitution.requested}" was not found. Tau simulates it as ${generic}, which will not match the real device.`;
}

/** Value tokens that name the *generic* device of a kind rather than a real
 *  part: Tau's Library defaults (`D`, `NPN`, `NMOS W=10u L=1u`, `5V1`, …) and
 *  LTspice's own placeholder symbol values. Landing on the starter model for
 *  one of these is the intended behaviour, not a silent substitution, so they
 *  must never warn - otherwise every default-placed part would. */
const GENERIC_MODEL_VALUES: ReadonlySet<string> = new Set([
  "d", "diode", "led", "zener", "5v1", "nmos", "pmos", "mos", "vdmos",
  "njf", "pjf", "jfet", "j", "npn", "pnp", "q",
]);

/** True when a semiconductor's value names a specific part Tau failed to find,
 *  as opposed to no model at all, an instance parameter (`W=10u`), a bare
 *  number, or one of the generic placeholders above. */
function isSubstitutedModelName(requested: string): boolean {
  const name = requested.trim();
  if (!name || name.includes("=")) return false;
  if (!/[A-Za-z]/.test(name)) return false;
  return !GENERIC_MODEL_VALUES.has(name.toLowerCase());
}

/** Product copy for a deck's {@link SpiceDeck.unresolvedSubckts}: names the
 *  missing subcircuit(s) and tells the user to import the vendor model file
 *  that defines them. Plain prose with no engine transcript, so
 *  `userFacingErrorMessage` surfaces it to the user verbatim. Callers guard on
 *  a non-empty list; the enumerated names are capped so the toast stays short.
 */
export function unresolvedSubcktMessage(names: readonly string[]): string {
  const listed = names.slice(0, MAX_LISTED_MISSING_SUBCKTS).map((name) => `"${name}"`);
  const extra = names.length - listed.length;
  const enumerated = extra > 0 ? `${listed.join(", ")}, and ${extra} more` : listed.join(", ");
  return names.length === 1
    ? `No imported library defines the subcircuit ${enumerated}. Attach the vendor model file (.lib or .subckt) that defines it under Model libraries, then run again.`
    : `No imported library defines these subcircuits: ${enumerated}. Attach the vendor model files (.lib or .subckt) that define them under Model libraries, then run again.`;
}

const MAX_LISTED_MISSING_SUBCKTS = 6;

interface CurrentSwitchDeckSpec {
  controlSource: string;
  model: string;
  state?: "on" | "off";
}

/** Strict LTspice W-device instance tail. Accepting extra tokens would let an
 * accidental/malformed Value change the circuit while still looking valid. */
function parseCurrentSwitchValue(value: string): CurrentSwitchDeckSpec | null {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  if (tokens.length !== 2 && tokens.length !== 3) return null;
  const state = tokens[2]?.toLowerCase();
  if (state !== undefined && state !== "on" && state !== "off") return null;
  return {
    controlSource: tokens[0]!,
    model: tokens[1]!,
    ...(state ? { state } : {}),
  };
}

function currentSwitchRefusal(ref: string, reason: string): Error {
  return new Error(
    `Simulation refused: ${ref} (csw) cannot be emitted safely because ${reason}. No approximate or partial circuit was run.`,
  );
}

/** True when a switch carries Tau's own static state rather than the name of a
 *  `.model … SW(…)`. These are authored in Tau, not imported, and stay a fixed
 *  resistance even if their control pins are wired. */
function isStaticSwitchState(value: string): boolean {
  const state = value.trim().toLowerCase();
  return state === "" || state.startsWith("open") || state.startsWith("closed");
}

/** The two nodes driving a voltage-controlled switch, or null when the control
 *  pair cannot supply a controlling voltage: either pin unwired (a net with no
 *  second pin on it is not a connection), or both tied to the same net. */
function switchControlNodes(
  entry: ExtractedComponent,
  netPinCount: ReadonlyMap<string, number>,
): { positive: string; negative: string } | null {
  const wired = (pin: string): string | undefined => {
    const netId = entry.pins[pin];
    if (!netId) return undefined;
    if (netId !== "0" && (netPinCount.get(netId) ?? 0) < 2) return undefined;
    return netId.toLowerCase();
  };
  const positive = wired("cp");
  const negative = wired("cn");
  if (!positive || !negative || positive === negative) return null;
  return { positive, negative };
}

/** Product copy for a switch that names a model but has no control connection.
 *  It simulates as a fixed open circuit, which is a different circuit - saying
 *  so is the whole point, since a permanently open switch produces a confident
 *  wrong waveform rather than an error. */
export function uncontrolledSwitchWarning(component: SchematicComponent): string {
  const ref = component.label.trim() || "A switch";
  return `${ref} has no control connection, so it simulates as a fixed open circuit. Wire both control pins (NC+ and NC-) to drive it, or set its value to "closed" to hold it on.`;
}

/**
 * The file a `.include` / `.lib` directive names. A `.lib` may carry a trailing
 * section name (`.lib std.lib NMOS`) which is not part of the path, and either
 * form may quote a path that contains spaces. An unquoted reference ends at the
 * first space, which is how ngspice reads it too.
 */
export function includedFileName(ref: string): string {
  const trimmed = ref.trim();
  const quoted = /^(["'])(.*?)\1/.exec(trimmed);
  if (quoted) return quoted[2].trim();
  return trimmed.split(/\s+/)[0] ?? "";
}

/**
 * The name a library reference reduces to, for matching a `.include`/`.lib`
 * against an attached library. Both sides compare on the base name so
 * `.include models/opamp.lib` matches the attachment named "opamp.lib".
 */
export function libraryFileKey(ref: string): string {
  const normalized = ref.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1).trim().toLowerCase();
}

/** Product copy for a `.include`/`.lib` naming a file Tau has no text for. The
 *  directive is dropped rather than passed through, so this is the only place
 *  the user learns that part of their document did not make it into the run. */
export function unresolvedLibraryWarning(file: string): string {
  return `Could not resolve the library file ${file}, so its models and subcircuits are not part of this run. Attach the file under Model Libraries to use its definitions.`;
}

function componentLines(entry: ExtractedComponent, index: number, name: string, userModels: Set<string> = new Set(), params: ParamScope = EMPTY_SCOPE, vdmosModels: ReadonlySet<string> = new Set(), netPinCount: ReadonlyMap<string, number> = new Map(), subcktModels: ReadonlySet<string> = new Set(), directiveInductorIc?: string, substitutions: ModelSubstitution[] = [], startupRampSeconds?: number, currentSwitch?: CurrentSwitchDeckSpec): string[] {
  const { component } = entry;
  const node = (pin: string) => requiredNode(entry, pin);

  // Fall back to a generic starter, recording the swap when the value named a
  // real part we could not resolve. Without the record the deck would emit a
  // textbook device under a vendor part's designator and say nothing.
  const genericModel = (requested: string, fallback: string): string => {
    if (isSubstitutedModelName(requested)) {
      substitutions.push({ ref: component.label.trim() || name, requested: requested.trim(), substituted: fallback });
    }
    return fallback;
  };

  // For a semiconductor, prefer the part's own model name when the document
  // actually defines it (`.model`/`.subckt` passthrough); else the generic
  // starter. The part's value is the LTspice `SYMATTR Value` (a model name).
  const deviceModel = (fallback: string): string => {
    const named = component.value.trim().split(/\s+/)[0] ?? "";
    return named && userModels.has(named.toLowerCase()) ? named : genericModel(named, fallback);
  };

  // True when the MOSFET resolves to a VDMOS power-MOSFET model: ngspice's
  // VDMOS device is 3-terminal (drain/gate/source) with no bulk node.
  const isVdmos = (modelName: string): boolean =>
    vdmosModels.has(modelName.toLowerCase());

  switch (component.kind) {
    case "resistor": {
      // PowerSim GD-style behavioral resistance: a res symbol whose value is a
      // `V=`/`R=` expression (switchable drive strength ron/roff). ngspice
      // takes the run-time expression quoted: R1 a b r = 'expr'.
      const raw = component.value ?? "";
      if (/^\s*[VR]\s*=/i.test(raw)) {
        const expr = moduloToFloor(ltFuncsToNgspice(statFuncsToNgspice(ifToTernary(raw.replace(/^\s*[VR]\s*=\s*/i, "")))));
        return [`${name} ${node("a")} ${node("b")} r = '${expr}'`];
      }
      // SPICE allows negative resistance (active/negative-impedance elements,
      // e.g. Draft7's -1k); reject only zero/NaN, which is a short.
      return [`${name} ${node("a")} ${node("b")} ${nonZeroNumberValue(component, "Ohm")}`];
    }
    case "capacitor": {
      // An imported crystal (Misc\xtal) lands as a capacitor whose value carries
      // the motional-branch params (Lser/Cpar); expand it into the real BVD
      // model so the deck builds and a Pierce/Colpitts oscillator can resonate,
      // instead of choking positiveNumberFromText on the param-laden value.
      const crystal = parseCrystal(component.value);
      if (crystal) return crystalDeckLines(name, node("a"), node("b"), crystal);
      const series = passiveSeriesResistance(component);
      const capacitance = positiveNumberFromText(component, stripIcSpec(series.value), "F");
      if (series.ohms === null || series.ohms === 0) {
        return [`${name} ${node("a")} ${node("b")} ${capacitance}${icSpecDeckText(component.value)}`];
      }
      const internal = `tau_${safeName(name).toLowerCase()}_esr`;
      return [
        `${name} ${node("a")} ${internal} ${capacitance}${icSpecDeckText(component.value)}`,
        `RTAU_${safeName(name)}_ESR ${internal} ${node("b")} ${series.ohms}`,
      ];
    }
    case "inductor": {
      // A nonlinear (Chan) magnetic-core inductor (Hc/Bs/Br/A/Lm/Lg/N) has no
      // ngspice equivalent; emit its unsaturated linear inductance instead so the
      // deck builds and runs (engine/coreInductor.ts).
      const core = coreInductance(component.value);
      const ic = directiveInductorIc === undefined
        ? icSpecDeckText(component.value)
        : ` IC=${substituteKnownBraces(directiveInductorIc, params).replace(/µ/g, "u")}`;
      if (core !== null) return [`${name} ${node("a")} ${node("b")} ${core}${ic}`];
      const series = passiveSeriesResistance(component);
      const inductance = positiveNumberFromText(component, stripIcSpec(series.value), "H");
      if (series.ohms === null || series.ohms === 0) {
        return [`${name} ${node("a")} ${node("b")} ${inductance}${ic}`];
      }
      const internal = `tau_${safeName(name).toLowerCase()}_esr`;
      return [
        `${name} ${node("a")} ${internal} ${inductance}${ic}`,
        `RTAU_${safeName(name)}_ESR ${internal} ${node("b")} ${series.ohms}`,
      ];
    }
    case "vsource": {
      // LTspice carries SINE/PULSE/PWL/EXP/SFFM inline on the source value, plus
      // an optional `AC <mag> [phase]` stimulus (from SYMATTR Value2). Split them.
      const main = stripSourceModifiers(stripAcSpec(component.value));
      const ac = acSpecDeckText(component.value);
      const fn = parseSourceFunction(main, "V");
      if (fn) return [`${name} ${node("p")} ${node("n")} ${fn.text}${ac}`];
      const dc = numberFromText(component, main, "V");
      const startup = startupRampSeconds === undefined ? "" : ` PWL(0 0 ${startupRampSeconds} ${dc})`;
      return [`${name} ${node("p")} ${node("n")} DC ${dc}${startup}${ac}`];
    }
    case "isource": {
      // SPICE convention: I N+ N- value → current flows from N+ toward N- through the
      // source body, so N+ is the terminal where external current enters (N+ voltage goes
      // negative for positive I into a resistive load).  Tau's schematic uses p="+", n="-"
      // with the convention that positive I raises V(p) - consistent with the TS MNA solver.
      // Emit as "I name n p value" so that ngspice's N+ = n (sink) and N- = p (source),
      // making V(p) rise for positive current just as the TS solver predicts.
      // LTspice's `load`/`load2` flags (current source acts as a clamped load,
      // CP_PLL's `{gm} load`) have no ngspice equivalent - approximate as the
      // ideal source by dropping the flag rather than failing the deck.
      const main = stripSourceModifiers(stripAcSpec(component.value)).replace(/\s+load2?\s*$/i, "");
      const ac = acSpecDeckText(component.value);
      const fn = parseSourceFunction(main, "A");
      if (fn) return [`${name} ${node("n")} ${node("p")} ${fn.text}${ac}`];
      const dc = numberFromText(component, main, "A");
      const startup = startupRampSeconds === undefined ? "" : ` PWL(0 0 ${startupRampSeconds} ${dc})`;
      return [`${name} ${node("n")} ${node("p")} DC ${dc}${startup}${ac}`];
    }
    case "vac": {
      const signal = sourceSignal(component, "V");
      return [`${name} ${node("p")} ${node("n")} DC ${signal.offset} AC ${signal.amplitude} SIN(${signal.offset} ${signal.amplitude} ${signal.frequency})`];
    }
    case "iac": {
      // Same polarity swap as isource: emit n before p so ngspice gives V(p) > 0 for
      // positive amplitude, consistent with the TS AC solver.
      const signal = sourceSignal(component, "A");
      return [`${name} ${node("n")} ${node("p")} DC ${signal.offset} AC ${signal.amplitude} SIN(${signal.offset} ${signal.amplitude} ${signal.frequency})`];
    }
    case "vpulse": {
      const p = decodeParams("vpulse", component.value);
      const low = parseQuantity(p.low ?? "0", "V");
      const high = parseQuantity(p.high ?? "5", "V");
      const freq = parseQuantity(p.frequency ?? "100k", "Hz");
      const duty = Math.min(0.99, Math.max(0.01, Number(p.duty ?? "0.5") || 0.5));
      const period = freq > 0 ? 1 / freq : 1e-5;
      const edge = period * 0.01;
      const width = Math.max(period * duty - edge, period * 0.005);
      // PULSE(V1 V2 TD TR TF PW PER)
      return [`${name} ${node("p")} ${node("n")} DC ${low} PULSE(${low} ${high} 0 ${edge} ${edge} ${width} ${period})`];
    }
    case "diode":
      return [`${name} ${node("a")} ${node("k")} ${deviceModel("TAU_DIODE")}`];
    case "led":
      return [`${name} ${node("a")} ${node("k")} ${deviceModel("TAU_LED")}`];
    case "zener":
      return [`${name} ${node("a")} ${node("k")} ${deviceModel("TAU_ZENER")}`];
    case "nmos": {
      const mos = decodeParams("nmos", component.value);
      // Prefer a user `.model` named in the value; else the TAU starter.
      const named = (mos.model ?? "").trim();
      const model =
        named && userModels.has(named.toLowerCase()) ? named : genericModel(named, "TAU_NMOS");
      const geom = mosfetInstanceParams(mos);
      // VDMOS power MOSFET → 3-terminal line (no bulk); else 4-terminal level-1 MOS.
      return isVdmos(model)
        ? [`${name} ${node("d")} ${node("g")} ${node("s")} ${model}${geom}`]
        : [`${name} ${node("d")} ${node("g")} ${node("s")} ${node("b")} ${model}${geom}`];
    }
    case "pmos": {
      const mos = decodeParams("pmos", component.value);
      const named = (mos.model ?? "").trim();
      const model =
        named && userModels.has(named.toLowerCase()) ? named : genericModel(named, "TAU_PMOS");
      const geom = mosfetInstanceParams(mos);
      return isVdmos(model)
        ? [`${name} ${node("d")} ${node("g")} ${node("s")} ${model}${geom}`]
        : [`${name} ${node("d")} ${node("g")} ${node("s")} ${node("b")} ${model}${geom}`];
    }
    case "njf":
      return [`${name} ${node("d")} ${node("g")} ${node("s")} ${deviceModel("TAU_NJF")}`];
    case "pjf":
      return [`${name} ${node("d")} ${node("g")} ${node("s")} ${deviceModel("TAU_PJF")}`];
    case "npn":
    case "pnp": {
      // LTspice lets a BJT's Value name a `.subckt` (UHFpreamp's MRF901 macro-
      // model) and silently emits an X instance with the same C B E node order;
      // ngspice's Q line rejects a subckt name, so mirror that rewrite here.
      const named = component.value.trim().split(/\s+/)[0] ?? "";
      if (named && subcktModels.has(named.toLowerCase())) {
        return [`X${name} ${node("c")} ${node("b")} ${node("e")} ${named}`];
      }
      return [`${name} ${node("c")} ${node("b")} ${node("e")} ${deviceModel(component.kind === "npn" ? "TAU_NPN" : "TAU_PNP")}`];
    }
    case "opamp": {
      const base = safeName(component.label || `U${index + 1}`);
      // When both supply pins are actually driven (on the ground net or a net
      // with another pin), clamp the output to the rails like LTspice's
      // UniversalOpamp2 - run open loop (class-d_starter's PWM comparator) the
      // plain gain-1e6 model saturates to ~1e7 V instead of switching rail to
      // rail. Floating supplies keep the classic unbounded ideal model.
      const driven = (netId: string | undefined): netId is string =>
        !!netId && (netId === "0" || (netPinCount.get(netId) ?? 0) >= 2);
      const vPlus = entry.pins["v+"];
      const vMinus = entry.pins["v-"];
      if (driven(vPlus) && driven(vMinus)) {
        const avol = parseOpampAvol(component.value);
        return [railClampedOpampLine(`B_${base}`, node("out"), node("in+"), node("in-"), vPlus.toLowerCase(), vMinus.toLowerCase(), avol)];
      }
      return [
        `E_${base} ${node("out")} 0 ${node("in+")} ${node("in-")} 1e6`,
        `R_${base}_out ${node("out")} 0 1e9`,
      ];
    }
    case "comparator": {
      // Open-loop comparator: a behavioral source whose output snaps to explicit
      // high/low levels (engine/comparatorSpec.ts), so it clamps instead of the
      // gain-1e6 op-amp model's ~1e7 V saturation. ngspice's B-source if()
      // syntax matches LTspice's.
      const base = safeName(component.label || `U${index + 1}`);
      const spec = parseComparator(component.value);
      return [comparatorDeckLine(`B_${base}`, node("out"), node("in+"), node("in-"), spec)];
    }
    case "digitalGate": {
      // LTspice idealized digital gate → one B-source per connected output
      // (engine/digitalGateSpec.ts). Floating inputs are ignored (LTspice
      // semantics): a pin only counts when its net is ground or shared.
      const base = safeName(component.label || `A${index + 1}`);
      const spec = parseDigitalGate(component.value);
      const connected = (pin: string): string | null => {
        const netId = entry.pins[pin];
        if (!netId) return null;
        if (netId !== "0" && (netPinCount.get(netId) ?? 0) < 2) return null;
        return netId.toLowerCase();
      };
      if (importedSymbolLeaf(component) === "phidet") {
        return phaseDetectorDeckLines(base, {
          a: connected("in1") ?? "0",
          b: connected("in2") ?? "0",
          q: connected("q") ?? `${base.toLowerCase()}_qnc`,
          com: connected("com") ?? "0",
        }, parsePhaseDetector(component.value));
      }
      const ins = ["in1", "in2", "in3", "in4", "in5"]
        .map(connected)
        .filter((n): n is string => n !== null);
      return digitalGateDeckLines(base, {
        ins,
        q: connected("q") ?? undefined,
        qbar: connected("qbar") ?? undefined,
        com: connected("com") ?? undefined,
      }, spec);
    }
    case "dflop": {
      // Stateful device - no B-source can hold edge-triggered state, so emit
      // an XSPICE d_dff between explicit adc/dac bridges at the gate's logic
      // levels (engine/digitalGateSpec.ts; bridges live-verified - the AUTO
      // bridge thresholds sit above LTspice's 0..1 V levels). Unconnected
      // control pins tie to analog ground (digital 0 = inactive).
      const base = safeName(component.label || `A${index + 1}`);
      const spec = parseDigitalGate(component.value);
      const connected = (pin: string): string | undefined => {
        const netId = entry.pins[pin];
        if (!netId) return undefined;
        if (netId !== "0" && (netPinCount.get(netId) ?? 0) < 2) return undefined;
        return netId.toLowerCase();
      };
      return dflopDeckLines(base, {
        d: connected("d"),
        clk: connected("clk"),
        pre: connected("pre"),
        clr: connected("clr"),
        q: connected("q"),
        qbar: connected("qbar"),
      }, spec);
    }
    case "sampleHold": {
      // LTspice SpecialFunctions\sample (SAMPLEHOLD): behavioral track-and-
      // hold - S/H high tracks V(in+,in-) and holds when low; CLK latches the
      // input at each rising edge via master-slave switch+cap stages
      // (engine/sampleHoldSpec.ts, live-verified against the Educational
      // SampleAndHold example). Params (Vt=…) share the A-device value syntax.
      const base = safeName(component.label || `A${index + 1}`);
      const spec = parseDigitalGate(component.value);
      const connected = (pin: string): string | undefined => {
        const netId = entry.pins[pin];
        if (!netId) return undefined;
        if (netId !== "0" && (netPinCount.get(netId) ?? 0) < 2) return undefined;
        return netId.toLowerCase();
      };
      return sampleHoldDeckLines(base, {
        inp: connected("in+"),
        inn: connected("in-"),
        clk: connected("clk"),
        sh: connected("sh"),
        out: connected("out"),
        com: connected("com"),
      }, spec);
    }
    case "modulator": {
      // LTspice SpecialFunctions\modulate (MODULATOR): behavioral VCO - a
      // unit sine at `space` Hz for FM=0V, `mark` Hz for FM=1V, amplitude
      // scaled by the AM input (engine/modulatorSpec.ts, live-verified
      // against PLL.asc's space=0 entry).
      const base = safeName(component.label || `A${index + 1}`);
      const spec = parseModulator(component.value);
      const connected = (pin: string): string | undefined => {
        const netId = entry.pins[pin];
        if (!netId) return undefined;
        if (netId !== "0" && (netPinCount.get(netId) ?? 0) < 2) return undefined;
        return netId.toLowerCase();
      };
      return modulatorDeckLines(base, {
        fm: connected("fm"),
        am: connected("am"),
        out: connected("out"),
        com: connected("com"),
      }, spec);
    }
    case "vcvs": {
      // A `Laplace=H(s)` value is a continuous transfer function, not a gain;
      // realize it as an XSPICE s_xfer (rational) or its DC gain (otherwise).
      const transfer = laplaceTransfer(component.value);
      if (transfer !== null) {
        return laplaceSourceLines({
          base: safeName(component.label || `E${index + 1}`),
          op: node("op"), on: node("on"), cp: node("cp"), cn: node("cn"),
          transfer, isCurrent: false, scope: params.scope, funcs: params.funcs,
        }).lines;
      }
      // VCVS (E): E op on cp cn gain  →  V(op,on) = gain·V(cp,cn)
      return [`${name} ${node("op")} ${node("on")} ${node("cp")} ${node("cn")} ${numberValue(component, "V/V")}`];
    }
    case "vccs": {
      const transfer = laplaceTransfer(component.value);
      if (transfer !== null) {
        return laplaceSourceLines({
          base: safeName(component.label || `G${index + 1}`),
          op: node("op"), on: node("on"), cp: node("cp"), cn: node("cn"),
          transfer, isCurrent: true, scope: params.scope, funcs: params.funcs,
        }).lines;
      }
      // VCCS (G): G op on cp cn gm  →  I(op→on) = gm·V(cp,cn)
      return [`${name} ${node("op")} ${node("on")} ${node("cp")} ${node("cn")} ${numberValue(component, "A/V")}`];
    }
    case "cccs": {
      // CCCS (F): the control pair is a zero-volt sense source; F references it.
      // I(op→on) = gain·I(cp→cn). Emit "V<base> cp cn 0" then "F op on V<base> gain".
      const base = safeName(component.label || `F${index + 1}`);
      return [
        `V_${base}_sense ${node("cp")} ${node("cn")} 0`,
        `${name} ${node("op")} ${node("on")} V_${base}_sense ${numberValue(component, "A/A")}`,
      ];
    }
    case "ccvs": {
      // CCVS (H): V(op,on) = r·I(cp→cn), sensed through a zero-volt source.
      const base = safeName(component.label || `H${index + 1}`);
      return [
        `V_${base}_sense ${node("cp")} ${node("cn")} 0`,
        `${name} ${node("op")} ${node("on")} V_${base}_sense ${numberValue(component, "V/A")}`,
      ];
    }
    case "bsource": {
      // Behavioral (arbitrary) source B: value carries "V=<expr>" or "I=<expr>",
      // an expression of node voltages/currents/time. ngspice's B-source syntax
      // matches LTspice's, so emit the spec verbatim after p/n (already
      // brace-substituted for any {param}). Default to V= when no prefix given.
      const spec = behavioralSpec(component.value);
      return [`${name} ${node("p")} ${node("n")} ${spec}`];
    }
    case "potentiometer": {
      // Split the track into two equal halves around the wiper. ngspice does
      // not evaluate arithmetic in a bare value field, so emit a precomputed
      // number rather than an expression like "10000/2".
      const resistance = parsedNumber(component, "Ohm");
      if (resistance <= 0) throw new Error(`${component.label || component.kind} needs a positive Ohm value.`);
      const half = (resistance / 2).toString();
      const base = safeName(component.label || `RV${index + 1}`);
      return [
        `R_${base}_a ${node("a")} ${node("w")} ${half}`,
        `R_${base}_b ${node("w")} ${node("b")} ${half}`,
      ];
    }
    case "switch": {
      if (isLtspiceCurrentControlledSwitch(component)) {
        if (!currentSwitch) {
          throw currentSwitchRefusal(component.label.trim() || name, "its validated W-device specification is unavailable");
        }
        return [
          `${name} ${node("a")} ${node("b")} ${currentSwitch.controlSource} ${currentSwitch.model}${currentSwitch.state ? ` ${currentSwitch.state}` : ""}`,
        ];
      }
      // A voltage-controlled switch (LTspice sw.asy) is ngspice's `S` device:
      // the switched path A/B gated by the NC+/NC- control pair. Emit the real
      // device whenever that pair is wired and the value names a model. A part
      // left on Tau's static open/closed state, or one whose control pair never
      // reaches a net, has no controlling voltage and stays a fixed resistance -
      // `uncontrolledSwitchWarning` reports the second case so a switch that
      // cannot switch is never silent.
      const control = switchControlNodes(entry, netPinCount);
      if (control && !isStaticSwitchState(component.value)) {
        const named = component.value.trim().split(/\s+/)[0] ?? "";
        const model = named && userModels.has(named.toLowerCase())
          ? named
          : genericModel(named, "TAU_SW");
        return [`${name} ${node("a")} ${node("b")} ${control.positive} ${control.negative} ${model}`];
      }
      const closed = component.value.trim().toLowerCase().startsWith("closed");
      return [`R_${safeName(component.label || `S${index + 1}`)} ${node("a")} ${node("b")} ${closed ? "1m" : "1e12"}`];
    }
    case "transformer": {
      const base = safeName(component.label || `T${index + 1}`);
      const windings = transformerWindings(component.value);
      return [
        `L_${base}_p ${node("p1")} ${node("p2")} ${windings.primary}`,
        `L_${base}_s ${node("s1")} ${node("s2")} ${windings.secondary}`,
        `K_${base} L_${base}_p L_${base}_s ${windings.coupling}`,
      ];
    }
    case "tline": {
      // Ideal lossless transmission line: T N1 N2 N3 N4 Z0=.. TD=..
      // Port A = (a1,a2), port B = (b1,b2). Delay/impedance element - native
      // engine only (the linear TS MNA solver has no transmission-line stamp).
      return [`${name} ${node("a1")} ${node("a2")} ${node("b1")} ${node("b2")} ${tlineDeckParams(component.value)}`];
    }
    case "subckt": {
      if (importedSymbolLeaf(component) === "varistor") {
        return [varistorDeckLine(
          safeName(component.label || `A${index + 1}`),
          node("p1"),
          node("p2"),
          node("p3"),
          node("p4"),
          parseVaristor(component.value),
        )];
      }
      // Subcircuit instance: X <nodes in SpiceOrder> <subckt name> [params].
      // Pin ids are p1..pN (the importer banks them in the .asy's SpiceOrder),
      // so sort numerically - object key order is not a contract. The name is
      // sanitized exactly like the bundled `.subckt` lines (a dash in a subckt
      // name is fatal to ngspice's X-line lookup), and any `µ` in the instance
      // params (Fc.asc's `C=.25µ`) becomes ngspice's `u`.
      const tokens = component.value.trim().split(/\s+/).filter(Boolean);
      const subName = tokens[0] ?? "";
      if (!subName) {
        throw new Error(`${component.label || "subcircuit"} needs a subcircuit name (the value's first token).`);
      }
      const params = tokens.slice(1).join(" ").replace(/µ/g, "u");
      const nodes = Object.keys(entry.pins)
        .filter((pin) => /^p\d+$/.test(pin))
        .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
        .map((pin) => node(pin));
      if (nodes.length === 0) {
        throw new Error(`${component.label || "subcircuit"} has no connected pins.`);
      }
      return [`${name} ${nodes.join(" ")} ${sanitizeSubcktName(subName)}${params ? ` ${params}` : ""}`];
    }
    case "testpoint":
    case "ground":
      return [];
  }
}

interface InitialConditionDeckSpec {
  lines: string[];
  hasIc: boolean;
  /** LTspice inductor instance name (lower-case) → current expression. */
  inductorCurrents: Map<string, string>;
  warnings: string[];
}

/** One complete LTspice `.ic` assignment. Values may be plain tokens or a
 * brace expression containing whitespace. Anything left unmatched is passed
 * through unchanged so malformed user syntax remains a real engine error. */
const LTSPICE_IC_ASSIGNMENT = /([VI])\s*\(\s*([^)]+?)\s*\)\s*=\s*(\{[^}]*\}|[^\s]+)/gi;

/**
 * Collect `.ic`/`.nodeset` directives and translate LTspice's inductor-current
 * extension to ngspice's per-instance `IC=` syntax. ngspice only supports node
 * voltage assignments on `.ic`; passing `I(L1)=…` through is always a syntax
 * error. Current references made stale by deleting/renaming their target are
 * omitted with an explicit circuit warning. An existing non-inductor target
 * remains a hard error because LTspice only permits inductor currents here.
 */
function icLinesFromDirectives(
  directives: ReadonlyArray<string>,
  circuit: ExtractedCircuit,
  params: ParamScope = EMPTY_SCOPE,
): InitialConditionDeckSpec {
  const lines: string[] = [];
  let hasIc = false;
  const inductorCurrents = new Map<string, string>();
  const warnings: string[] = [];
  const componentsByName = new Map(
    circuit.components
      .filter(({ component }) => component.label.trim() !== "")
      .map(({ component }) => [component.label.trim().toLowerCase(), component] as const),
  );
  for (const directive of directives) {
    const bare = directive.trim().replace(/^[.!]+/, "");
    const m = /^(ic|nodeset)\b\s*(.+)$/i.exec(bare);
    if (!m) continue;
    const keyword = m[1].toLowerCase();
    // The deck carries no .param lines (Tau resolves params app-side), so any
    // `{vout}`-style brace here must be substituted now or ngspice fatals.
    const body = substituteKnownBraces(m[2].trim(), params);
    if (keyword === "nodeset") {
      lines.push(`.nodeset ${body}`);
      continue;
    }

    const matches = [...body.matchAll(LTSPICE_IC_ASSIGNMENT)];
    LTSPICE_IC_ASSIGNMENT.lastIndex = 0;
    const unmatched = body.replace(LTSPICE_IC_ASSIGNMENT, " ").trim();
    LTSPICE_IC_ASSIGNMENT.lastIndex = 0;
    if (matches.length === 0 || unmatched !== "") {
      // Preserve malformed/unsupported syntax so ngspice reports it instead of
      // silently changing the user's circuit.
      lines.push(`.ic ${body}`);
      hasIc = true;
      continue;
    }

    const voltageAssignments: string[] = [];
    for (const assignment of matches) {
      const authoredKind = assignment[1];
      const kind = authoredKind.toUpperCase();
      const target = assignment[2].trim();
      const value = assignment[3];
      if (kind === "V") {
        // Preserve node-voltage assignments verbatim. ngspice accepts this
        // syntax and reports a non-existent node as a non-fatal warning.
        voltageAssignments.push(`${authoredKind}(${target})=${value}`);
        hasIc = true;
        continue;
      }

      const component = componentsByName.get(target.toLowerCase());
      if (!component) {
        warnings.push(`Ignored .ic I(${target})=${value} because inductor ${target} is not present.`);
        continue;
      }
      if (component.kind !== "inductor") {
        throw new Error(`.ic I(${target})=${value} requires an inductor, but ${target} is a ${component.kind}.`);
      }
      inductorCurrents.set(target.toLowerCase(), value);
      hasIc = true;
    }
    if (voltageAssignments.length > 0) lines.push(`.ic ${voltageAssignments.join(" ")}`);
  }
  return { lines, hasIc, inductorCurrents, warnings };
}

function analysisLine(analysis: SpiceAnalysis, useInitialConditions = false): string {
  switch (analysis.kind) {
    case "tran": {
      if (!Number.isFinite(analysis.stopTime) || analysis.stopTime <= 0 || !Number.isInteger(analysis.steps) || analysis.steps < 2) {
        throw new Error("Transient analysis needs a positive stop time and at least two output steps.");
      }
      const outputStep = analysis.stopTime / analysis.steps;
      const startTime = analysis.startTime;
      const maxStep = analysis.maxStep;
      if (startTime !== undefined && (!Number.isFinite(startTime) || startTime < 0 || startTime >= analysis.stopTime)) {
        throw new Error("Transient output start time must be non-negative and earlier than stop time.");
      }
      if (maxStep !== undefined && (!Number.isFinite(maxStep) || maxStep <= 0)) {
        throw new Error("Transient maximum step must be greater than zero.");
      }
      const authoredTail = startTime !== undefined || maxStep !== undefined
        ? ` ${startTime ?? 0}${maxStep !== undefined ? ` ${maxStep}` : ""}`
        : "";
      return `.tran ${outputStep} ${analysis.stopTime}${authoredTail}${useInitialConditions || analysis.uic || analysis.startup ? " uic" : ""}`;
    }
    case "op":
      return ".op";
    case "ac":
      if (!Number.isFinite(analysis.startHz) || !Number.isFinite(analysis.stopHz) || analysis.startHz <= 0 || analysis.stopHz <= analysis.startHz || analysis.pointsPerDecade < 1) {
        throw new Error("AC analysis needs positive start/stop frequencies and at least one point per decade.");
      }
      return `.ac dec ${Math.round(analysis.pointsPerDecade)} ${analysis.startHz} ${analysis.stopHz}`;
    case "dc": {
      if (!analysis.source.trim()) throw new Error("DC sweep needs a source name.");
      if (!Number.isFinite(analysis.start) || !Number.isFinite(analysis.stop) || !Number.isFinite(analysis.step) || analysis.step === 0) {
        throw new Error("DC sweep needs finite start/stop values and a non-zero increment.");
      }
      // ngspice wants the increment signed toward the stop value.
      const inc = Math.abs(analysis.step) * (analysis.stop >= analysis.start ? 1 : -1);
      let line = `.dc ${safeName(analysis.source)} ${analysis.start} ${analysis.stop} ${inc}`;
      // Nested outer source: append `<src2> <start2> <stop2> <inc2>` (SPICE
      // sweeps the first-listed source innermost).
      if (
        analysis.source2 &&
        analysis.source2.trim() &&
        Number.isFinite(analysis.start2) &&
        Number.isFinite(analysis.stop2) &&
        Number.isFinite(analysis.step2) &&
        analysis.step2 !== 0
      ) {
        const inc2 = Math.abs(analysis.step2!) * (analysis.stop2! >= analysis.start2! ? 1 : -1);
        line += ` ${safeName(analysis.source2)} ${analysis.start2} ${analysis.stop2} ${inc2}`;
      }
      return line;
    }
    case "tf": {
      if (!analysis.source.trim()) throw new Error("Transfer function needs an input source name.");
      const source = safeName(analysis.source.trim());
      if (analysis.output.kind === "current") {
        const device = analysis.output.device.trim();
        if (!device) throw new Error("Transfer function needs an output device name.");
        return `.tf i(${safeName(device)}) ${source}`;
      }
      // Node names arrive already resolved to what the deck emits, so they are
      // validated rather than rewritten - mangling one here would silently
      // measure a different node than the caller asked for.
      const node = deckNode(analysis.output.node, "output node", "Transfer function");
      const refNode = analysis.output.refNode?.trim()
        ? deckNode(analysis.output.refNode, "output reference node", "Transfer function")
        : undefined;
      return `.tf v(${refNode ? `${node},${refNode}` : node}) ${source}`;
    }
    case "noise": {
      if (!analysis.source.trim()) throw new Error("Noise analysis needs an input source name.");
      if (
        !Number.isFinite(analysis.startHz) || !Number.isFinite(analysis.stopHz)
        || analysis.startHz <= 0 || analysis.stopHz <= analysis.startHz || analysis.pointsPerDecade < 1
      ) {
        throw new Error("Noise analysis needs positive start/stop frequencies and at least one point per decade.");
      }
      const node = deckNode(analysis.output.node, "output node", "Noise analysis");
      const refNode = analysis.output.refNode?.trim()
        ? deckNode(analysis.output.refNode, "output reference node", "Noise analysis")
        : undefined;
      const port = refNode ? `${node},${refNode}` : node;
      return `.noise v(${port}) ${safeName(analysis.source.trim())} dec ${Math.round(analysis.pointsPerDecade)} ${analysis.startHz} ${analysis.stopHz}`;
    }
  }
}

/** A node name safe to place inside a `.tf` / `.noise` output port. */
function deckNode(value: string, role: string, analysis: string): string {
  const node = value.trim();
  if (!node) throw new Error(`${analysis} needs an ${role}.`);
  if (!/^[A-Za-z0-9_$.:+-]+$/.test(node)) {
    throw new Error(`${analysis} ${role} "${value}" is not a usable node name.`);
  }
  return node;
}

const SPICE_PREFIX: Record<ComponentKind, string> = {
  resistor: "R", capacitor: "C", inductor: "L", vsource: "V", isource: "I", vac: "V", iac: "I", vpulse: "V",
  diode: "D", led: "D", zener: "D", opamp: "E", comparator: "B", digitalGate: "B", dflop: "A", sampleHold: "A", modulator: "A", vcvs: "E", vccs: "G", cccs: "F", ccvs: "H", bsource: "B", nmos: "M", pmos: "M", njf: "J", pjf: "J", npn: "Q", pnp: "Q",
  potentiometer: "R", switch: "S", transformer: "L", tline: "T", subckt: "X", testpoint: "X", ground: "X",
};

function componentSpicePrefix(component: SchematicComponent): string {
  return isLtspiceCurrentControlledSwitch(component) ? "W" : SPICE_PREFIX[component.kind];
}

/** The label's own SPICE name when it already carries the kind's prefix
 * (`R1` for a resistor), or null when a prefixed fallback must be
 * manufactured. SPICE identifiers are case-insensitive; a lowercase refdes
 * is preserved so `R1` and `r1` reach the duplicate-name guard as the same
 * device instead of manufacturing a misleading `Rr1` fallback. */
function requestedInstanceName(component: SchematicComponent): string | null {
  const requested = safeName(component.label);
  const p = componentSpicePrefix(component);
  return requested.slice(0, p.length).toLocaleLowerCase() === p.toLocaleLowerCase() ? requested : null;
}

/** Every component's deck instance name, resolved up front so the two naming
 * paths cannot silently collide:
 * - A label that already carries its kind's SPICE prefix owns that name
 *   outright; two components claiming the same one is a real authoring error
 *   and still throws.
 * - Otherwise the name is manufactured (`${prefix}${label}`, e.g. a diac
 *   remapped to a resistor keeps its `Q1` label as `RQ1`). A manufactured
 *   name may land on one a sibling legitimately owns - PowerSim blocks pair
 *   a resistor `Rb` with a part labeled `B` whose fallback is also `RB` - so
 *   it takes a numeric suffix (`RB_2`) until unique instead of failing the
 *   whole deck.
 */
function resolveInstanceNames(components: readonly ExtractedComponent[]): Map<number, string> {
  const used = new Map<string, string>();
  const resolved = new Map<number, string>();
  const named = (component: SchematicComponent) =>
    component.kind !== "ground" && component.kind !== "testpoint";
  components.forEach(({ component }, index) => {
    if (!named(component)) return;
    const name = requestedInstanceName(component);
    if (name === null) return;
    const key = name.toLocaleLowerCase();
    const previous = used.get(key);
    if (previous) {
      throw new Error(`Duplicate SPICE instance name "${name}" after sanitizing ${previous} and ${component.label || component.kind}.`);
    }
    used.set(key, component.label || component.kind);
    resolved.set(index, name);
  });
  components.forEach(({ component }, index) => {
    if (!named(component) || resolved.has(index)) return;
    const requested = safeName(component.label);
    const p = componentSpicePrefix(component);
    const base = requested ? `${p}${requested}` : `${p}${index + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLocaleLowerCase()); n += 1) name = `${base}_${n}`;
    used.set(name.toLocaleLowerCase(), component.label || component.kind);
    resolved.set(index, name);
  });
  return resolved;
}

function requiredNode(entry: ExtractedComponent, pin: string): string {
  const value = entry.pins[pin];
  if (!value) throw new Error(`${entry.component.label || entry.component.kind} is missing its ${pin} pin.`);
  return value.toLowerCase();
}

function numberValue(component: SchematicComponent, unit: string): string {
  return parsedNumber(component, unit).toString();
}

/** Parse a DC level from already-extracted text (the value minus its AC spec),
 *  keeping the component-aware error message. Empty text → DC 0. */
function numberFromText(component: SchematicComponent, text: string, unit: string): string {
  const trimmed = text.trim();
  if (trimmed === "") return "0";
  try {
    const value = parseQuantity(trimmed, unit);
    if (!Number.isFinite(value)) throw new Error("not finite");
    return value.toString();
  } catch {
    throw new Error(`${component.label || component.kind} needs a valid ${unit} value.`);
  }
}

function parsedNumber(component: SchematicComponent, unit: string): number {
  try {
    const value = parseQuantity(component.value, unit);
    if (!Number.isFinite(value) || value !== value) throw new Error("not finite");
    return value;
  } catch {
    throw new Error(`${component.label || component.kind} needs a valid ${unit} value.`);
  }
}

/** Parse a strictly-positive value from already-extracted text (the value minus
 *  its IC spec), keeping the component-aware error message. Used for C/L whose
 *  value may carry a trailing `IC=` token. */
function positiveNumberFromText(component: SchematicComponent, text: string, unit: string): string {
  let value: number;
  try {
    value = parseQuantity(text.trim(), unit);
    if (!Number.isFinite(value)) throw new Error("not finite");
  } catch {
    throw new Error(`${component.label || component.kind} needs a valid ${unit} value.`);
  }
  if (value <= 0) {
    throw new Error(`${component.label || component.kind} needs a positive ${unit} value (got ${value}).`);
  }
  return value.toString();
}

/** LTspice's passive `Rser=` is a real series parasitic, but ngspice's C/L
 * primitives do not accept that per-instance parameter. Remove it from the
 * value token and let componentLines expand an explicit internal resistor. */
function passiveSeriesResistance(component: SchematicComponent): { value: string; ohms: number | null } {
  const match = /(?:^|\s)Rser\s*=\s*([^\s]+)/i.exec(component.value);
  if (!match) return { value: component.value, ohms: null };
  let ohms: number;
  try {
    ohms = parseQuantity(match[1], "Ohm");
    if (!Number.isFinite(ohms) || ohms < 0) throw new Error("invalid series resistance");
  } catch {
    throw new Error(`${component.label || component.kind} needs a valid non-negative Rser value.`);
  }
  return {
    value: component.value.replace(match[0], " ").replace(/\s+/g, " ").trim(),
    ohms,
  };
}

/** Like parsedNumber but rejects only zero/NaN, allowing negative values.
 *  Used for resistors, where SPICE permits a negative (active) resistance but a
 *  zero value is a short that yields a singular deck. */
function nonZeroNumberValue(component: SchematicComponent, unit: string): string {
  const value = parsedNumber(component, unit);
  if (value === 0) {
    throw new Error(`${component.label || component.kind} needs a non-zero ${unit} value.`);
  }
  return value.toString();
}

/** Append MOSFET geometry / model params from the structured value encoding. */
function mosfetInstanceParams(mos: Record<string, string>): string {
  const parts: string[] = [];
  if (mos.w?.trim()) parts.push(`W=${mos.w.trim()}`);
  if (mos.l?.trim()) parts.push(`L=${mos.l.trim()}`);
  // KP/VTO are model parameters in SPICE; when the user sets them on the
  // instance we still emit them as instance overrides (ngspice accepts W/L
  // on M lines; KP/VTO on the instance are ignored by some engines - keep
  // them in the value string for the UI and only emit W/L on the deck line).
  return parts.length ? ` ${parts.join(" ")}` : "";
}

function parseWireResistanceOhms(text: string): number {
  try {
    const value = parseQuantity(text.trim(), "Ohm");
    if (!Number.isFinite(value) || value < 0) throw new Error("not a finite non-negative resistance");
    return value;
  } catch (error) {
    throw new Error(`Wire resistance "${text}" is invalid: ${error instanceof Error ? error.message : "could not parse value"}.`);
  }
}

function sourceSignal(component: SchematicComponent, unit: "V" | "A") {
  const tokens = component.value.trim().split(/[\s,;@]+/).filter(Boolean);
  try {
    if (tokens.length >= 3) {
      return { offset: parseQuantity(tokens[0], unit), amplitude: parseQuantity(tokens[1], unit), frequency: parseQuantity(tokens[2], "Hz") };
    }
    if (tokens.length === 2) {
      return { offset: 0, amplitude: parseQuantity(tokens[0], unit), frequency: parseQuantity(tokens[1], "Hz") };
    }
    if (tokens.length === 1) {
      return { offset: 0, amplitude: parseQuantity(tokens[0], unit), frequency: 1e3 };
    }
  } catch {
    // Re-throw below with a component-aware message.
  }
  throw new Error(`${component.label || component.kind} needs amplitude and frequency values.`);
}

function turnsRatio(value: string) {
  // Only the leading token is a ratio - `1:2 L1=2m k=0.98` must not have its
  // parameter tail swallowed by the `:` split.
  const head = value.trim().split(/\s+/)[0] ?? "";
  const [primaryRaw, secondaryRaw] = head.split(":").map((part) => Number(part.trim()));
  if (Number.isFinite(primaryRaw) && Number.isFinite(secondaryRaw) && primaryRaw > 0 && secondaryRaw > 0) {
    return { primary: primaryRaw, secondary: secondaryRaw };
  }
  return { primary: 1, secondary: 1 };
}

/** Default magnetizing inductance when the part names no `L1`. */
const DEFAULT_PRIMARY_INDUCTANCE = 10e-3;
/** Default coupling. Not 1.0: a perfectly coupled pair is singular. */
const DEFAULT_COUPLING = 0.999;

/**
 * Transformer winding values.
 *
 * Magnetizing inductance and leakage (via `k`) are the two numbers a flyback
 * or forward converter is actually designed around, so both have to be
 * reachable. They used to be hardcoded at 10 mH and 0.999 regardless of what
 * the part said, which silently made every power design the same transformer.
 *
 * Accepts `1:2`, `L1=2m L2=8m k=0.98`, or a mix. `L2` falls back to the turns
 * ratio (L2 = L1 * (Ns/Np)^2), which is the physical relationship, so a bare
 * ratio keeps behaving exactly as before.
 */
export function transformerWindings(value: string): {
  primary: number;
  secondary: number;
  coupling: number;
} {
  const ratio = turnsRatio(value);
  const param = (name: string): number | null => {
    const match = new RegExp(`\\b${name}\\s*=\\s*([^\\s]+)`, "i").exec(value);
    if (!match) return null;
    const parsed = parseQuantity(match[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  const primary = param("L1") ?? DEFAULT_PRIMARY_INDUCTANCE;
  const secondary = param("L2") ?? primary * (ratio.secondary / ratio.primary) ** 2;
  // k must stay strictly inside (0, 1): k=1 makes the coupled pair singular,
  // and ngspice rejects k<=0.
  const declared = param("k");
  const coupling = declared !== null && declared < 1 ? declared : DEFAULT_COUPLING;
  return { primary, secondary, coupling };
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, "_") || "X";
}
