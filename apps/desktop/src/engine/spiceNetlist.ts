import { extractCircuit, isResistiveWire, netAtPoint, type ExtractedCircuit, type ExtractedComponent } from "../schematic/netlist";
import { resolveComponentValues, expandDirectiveLines, substituteKnownBraces, EMPTY_SCOPE, type ParamScope } from "../simulation/paramScope";
import type { ComponentKind, NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";
import { parseQuantity } from "../simulation/quantity";
import { decodeParams } from "../schematic/params";
import { parseSourceFunction } from "./sourceFunction";
import { stripAcSpec, acSpecDeckText, stripSourceModifiers } from "./acSpec";
import { stripIcSpec, icSpecDeckText, parseIcValue } from "./icSpec";
import { behavioralSpecText as behavioralSpec } from "../simulation/behavioral";
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
import { tlineDeckParams } from "./tlineSpec";
import { parseTempDirective } from "../io/directiveAnalysis";

export type SpiceAnalysis =
  | { kind: "tran"; stopTime: number; steps: number }
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
    };

export interface SpiceDeck {
  circuit: ExtractedCircuit;
  netlist: string;
}

type Schematic = {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels?: NetLabel[];
  params?: ParamScope;
  /** Document directive lines; any `.options` here override Tau's defaults. */
  directives?: string[];
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
];

/**
 * Convert Tau's neutral schematic into a complete ngspice deck. Models here
 * are intentionally generic starter models; named vendor models belong in an
 * imported library, not in the schematic renderer or React UI.
 */
export function buildSpiceDeck(schematic: Schematic, analysis: SpiceAnalysis): SpiceDeck {
  const components = resolveComponentValues(schematic.components, schematic.params ?? EMPTY_SCOPE);
  const circuit = extractCircuit(components, schematic.wires, schematic.netLabels ?? []);
  if (components.length === 0) throw new Error("Place components before running analysis.");
  if (!circuit.groundNetId) throw new Error("Add a ground symbol so node voltages have a reference.");

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
  const needsModels = ["diode", "led", "zener", "nmos", "pmos", "njf", "pjf", "npn", "pnp"].some((kind) => usedKinds.has(kind as ComponentKind));
  if (needsModels) lines.push(...DEFAULT_MODELS);

  // Carry the document's own `.model`/`.lib`/`.inc`/`.subckt` definitions into the
  // deck so an imported `.asc` simulates against its real device models and
  // libraries instead of only Tau's generic starter models. A `.include`/`.lib`
  // that names a BUNDLED LTspice library file (1563.asc's `.include TowTom2.sub`)
  // is replaced by the bundled text itself — ngspice can't resolve LTspice's
  // lib/sub paths from Tau's working directory. Names those texts define are
  // tracked so the per-instance emission below doesn't duplicate the block.
  const inlinedSubckts = new Set<string>();
  // Track `.subckt … .ends` nesting: LTspice evaluates a `{param}` on a
  // passthrough `.model` line against the document's global `.param` scope
  // (Fc.asc's `.model DX D(Cjo={Cjo} …)` — ngspice instead dies with
  // "Undefined parameter"), but a brace INSIDE a document-defined subckt body
  // must stay verbatim for ngspice to resolve against the subckt's own params.
  let subcktDepth = 0;
  const passthroughScope = schematic.params ?? EMPTY_SCOPE;
  for (const line of modelLibLinesFromDirectives(rawDirectives)) {
    const fileRef = /^\.(?:include|lib)\s+(.+)$/i.exec(line.trim());
    const bundled = fileRef ? bundledLibraryText(fileRef[1]) : null;
    if (bundled) {
      lines.push(bundled);
      for (const m of bundled.matchAll(/^\.subckt\s+(\S+)/gim)) inlinedSubckts.add(m[1].toLowerCase());
    } else {
      if (/^\.subckt\b/i.test(line.trim())) subcktDepth += 1;
      lines.push(subcktDepth > 0 ? line : substituteKnownBraces(line, passthroughScope));
      if (/^\.ends\b/i.test(line.trim())) subcktDepth = Math.max(0, subcktDepth - 1);
    }
  }

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
    if (label) inductorNames.set(label, instanceName(entry.component, index));
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

  // Carry `.ic`/`.nodeset` initial conditions through to ngspice verbatim. When
  // any `.ic` is present a transient must run with `uic` for the initial values
  // to hold at t=0 (LTspice semantics), not just bias the operating point.
  const { lines: icLines, hasIc } = icLinesFromDirectives(flatDirectives);
  lines.push(...icLines);

  const userModels = definedModelNames(schematic.directives ?? []);
  // VDMOS power-MOSFET model names (lower-cased), from the document's own
  // `.model … VDMOS(…)` definitions. A MOSFET on one of these emits a 3-terminal
  // VDMOS device line (the bulk node is dropped — see `componentLines`).
  const vdmosModels = new Set<string>();
  for (const [model, type] of definedModelTypes(schematic.directives ?? [])) {
    if (type === "vdmos") vdmosModels.add(model);
  }

  // A semiconductor may reference an LTspice standard part by name (1N4148,
  // 2N2222, …) with no inline `.model`. When the document doesn't define it but
  // we bundle it, emit the real LTspice model line so the device simulates with
  // its actual parameters instead of a generic `TAU_*` starter. The union of
  // user-defined + emitted-standard names tells `deviceModel` which names are
  // safe to put on the device line.
  const knownModels = new Set(userModels);
  const SEMI_KINDS: ReadonlySet<ComponentKind> = new Set([
    "diode", "led", "zener", "npn", "pnp", "nmos", "pmos", "njf", "pjf",
  ]);
  const emittedStandard = new Set<string>();
  for (const { component } of circuit.components) {
    if (!SEMI_KINDS.has(component.kind)) continue;
    const named = component.value.trim().split(/\s+/)[0] ?? "";
    if (!named || knownModels.has(named.toLowerCase())) continue;
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
  // bundledSubcircuits.ts) so the deck is self-contained — this is how the
  // ISO16750-2/ISO7637-2 symbols work in LTspice, whose `.asy` ModelFile
  // attribute pulls the library in without any on-canvas directive.
  const emittedSubckts = new Set<string>();
  for (const { component } of circuit.components) {
    if (component.kind !== "subckt") continue;
    const ref = sanitizeSubcktName(component.value.trim().split(/\s+/)[0] ?? "").toLowerCase();
    if (!ref || userModels.has(ref) || inlinedSubckts.has(ref) || emittedSubckts.has(ref)) continue;
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

  const usedInstanceNames = new Map<string, string>();
  circuit.components.forEach(({ component }, index) => {
    if (component.kind === "ground" || component.kind === "testpoint") return;
    const name = instanceName(component, index);
    const key = name.toLocaleLowerCase();
    const previous = usedInstanceNames.get(key);
    if (previous) {
      throw new Error(`Duplicate SPICE instance name "${name}" after sanitizing ${previous} and ${component.label || component.kind}.`);
    }
    usedInstanceNames.set(key, component.label || component.kind);
  });

  circuit.components.forEach((entry, index) => {
    lines.push(...componentLines(entry, index, knownModels, schematic.params ?? EMPTY_SCOPE, vdmosModels, netPinCount, subcktModels));
  });

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

  lines.push(analysisLine(analysis, hasIc || hasInstanceIc), ".end");

  return { circuit, netlist: lines.join("\n") };
}

function componentLines(entry: ExtractedComponent, index: number, userModels: Set<string> = new Set(), params: ParamScope = EMPTY_SCOPE, vdmosModels: ReadonlySet<string> = new Set(), netPinCount: ReadonlyMap<string, number> = new Map(), subcktModels: ReadonlySet<string> = new Set()): string[] {
  const { component } = entry;
  const name = instanceName(component, index);
  const node = (pin: string) => requiredNode(entry, pin);

  // For a semiconductor, prefer the part's own model name when the document
  // actually defines it (`.model`/`.subckt` passthrough); else the generic
  // starter. The part's value is the LTspice `SYMATTR Value` (a model name).
  const deviceModel = (fallback: string): string => {
    const named = component.value.trim().split(/\s+/)[0] ?? "";
    return named && userModels.has(named.toLowerCase()) ? named : fallback;
  };

  // True when the MOSFET resolves to a VDMOS power-MOSFET model: ngspice's
  // VDMOS device is 3-terminal (drain/gate/source) with no bulk node.
  const isVdmos = (modelName: string): boolean =>
    vdmosModels.has(modelName.toLowerCase());

  switch (component.kind) {
    case "resistor":
      // SPICE allows negative resistance (active/negative-impedance elements,
      // e.g. Draft7's -1k); reject only zero/NaN, which is a short.
      return [`${name} ${node("a")} ${node("b")} ${nonZeroNumberValue(component, "Ohm")}`];
    case "capacitor": {
      // An imported crystal (Misc\xtal) lands as a capacitor whose value carries
      // the motional-branch params (Lser/Cpar); expand it into the real BVD
      // model so the deck builds and a Pierce/Colpitts oscillator can resonate,
      // instead of choking positiveNumberFromText on the param-laden value.
      const crystal = parseCrystal(component.value);
      if (crystal) return crystalDeckLines(name, node("a"), node("b"), crystal);
      return [`${name} ${node("a")} ${node("b")} ${positiveNumberFromText(component, stripIcSpec(component.value), "F")}${icSpecDeckText(component.value)}`];
    }
    case "inductor": {
      // A nonlinear (Chan) magnetic-core inductor (Hc/Bs/Br/A/Lm/Lg/N) has no
      // ngspice equivalent; emit its unsaturated linear inductance instead so the
      // deck builds and runs (engine/coreInductor.ts).
      const core = coreInductance(component.value);
      if (core !== null) return [`${name} ${node("a")} ${node("b")} ${core}`];
      return [`${name} ${node("a")} ${node("b")} ${positiveNumberFromText(component, stripIcSpec(component.value), "H")}${icSpecDeckText(component.value)}`];
    }
    case "vsource": {
      // LTspice carries SINE/PULSE/PWL/EXP/SFFM inline on the source value, plus
      // an optional `AC <mag> [phase]` stimulus (from SYMATTR Value2). Split them.
      const main = stripSourceModifiers(stripAcSpec(component.value));
      const ac = acSpecDeckText(component.value);
      const fn = parseSourceFunction(main, "V");
      if (fn) return [`${name} ${node("p")} ${node("n")} ${fn.text}${ac}`];
      return [`${name} ${node("p")} ${node("n")} DC ${numberFromText(component, main, "V")}${ac}`];
    }
    case "isource": {
      // SPICE convention: I N+ N- value → current flows from N+ toward N- through the
      // source body, so N+ is the terminal where external current enters (N+ voltage goes
      // negative for positive I into a resistive load).  Tau's schematic uses p="+", n="-"
      // with the convention that positive I raises V(p) — consistent with the TS MNA solver.
      // Emit as "I name n p value" so that ngspice's N+ = n (sink) and N- = p (source),
      // making V(p) rise for positive current just as the TS solver predicts.
      const main = stripSourceModifiers(stripAcSpec(component.value));
      const ac = acSpecDeckText(component.value);
      const fn = parseSourceFunction(main, "A");
      if (fn) return [`${name} ${node("n")} ${node("p")} ${fn.text}${ac}`];
      return [`${name} ${node("n")} ${node("p")} DC ${numberFromText(component, main, "A")}${ac}`];
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
        named && userModels.has(named.toLowerCase()) ? named : deviceModel("TAU_NMOS");
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
        named && userModels.has(named.toLowerCase()) ? named : deviceModel("TAU_PMOS");
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
      // UniversalOpamp2 — run open loop (class-d_starter's PWM comparator) the
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
      // Stateful device — no B-source can hold edge-triggered state, so emit
      // an XSPICE d_dff between explicit adc/dac bridges at the gate's logic
      // levels (engine/digitalGateSpec.ts; bridges live-verified — the AUTO
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
      // hold — S/H high tracks V(in+,in-) and holds when low; CLK latches the
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
      // LTspice SpecialFunctions\modulate (MODULATOR): behavioral VCO — a
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
      const closed = component.value.trim().toLowerCase().startsWith("closed");
      return [`R_${safeName(component.label || `S${index + 1}`)} ${node("a")} ${node("b")} ${closed ? "1m" : "1e12"}`];
    }
    case "transformer": {
      const base = safeName(component.label || `T${index + 1}`);
      const ratio = turnsRatio(component.value);
      const primaryInductance = 10e-3;
      const secondaryInductance = primaryInductance * (ratio.secondary / ratio.primary) ** 2;
      return [
        `L_${base}_p ${node("p1")} ${node("p2")} ${primaryInductance}`,
        `L_${base}_s ${node("s1")} ${node("s2")} ${secondaryInductance}`,
        `K_${base} L_${base}_p L_${base}_s 0.999`,
      ];
    }
    case "tline": {
      // Ideal lossless transmission line: T N1 N2 N3 N4 Z0=.. TD=..
      // Port A = (a1,a2), port B = (b1,b2). Delay/impedance element — native
      // engine only (the linear TS MNA solver has no transmission-line stamp).
      return [`${name} ${node("a1")} ${node("a2")} ${node("b1")} ${node("b2")} ${tlineDeckParams(component.value)}`];
    }
    case "subckt": {
      // Subcircuit instance: X <nodes in SpiceOrder> <subckt name> [params].
      // Pin ids are p1..pN (the importer banks them in the .asy's SpiceOrder),
      // so sort numerically — object key order is not a contract. The name is
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

/**
 * Collect `.ic`/`.nodeset` directives as deck lines (re-prefixed with a leading
 * dot, lower-cased keyword), reporting whether any `.ic` is present so the
 * transient line can request `uic`.
 */
function icLinesFromDirectives(directives: ReadonlyArray<string>): { lines: string[]; hasIc: boolean } {
  const lines: string[] = [];
  let hasIc = false;
  for (const directive of directives) {
    const bare = directive.trim().replace(/^[.!]+/, "");
    const m = /^(ic|nodeset)\b\s*(.+)$/i.exec(bare);
    if (!m) continue;
    const keyword = m[1].toLowerCase();
    lines.push(`.${keyword} ${m[2].trim()}`);
    if (keyword === "ic") hasIc = true;
  }
  return { lines, hasIc };
}

function analysisLine(analysis: SpiceAnalysis, useInitialConditions = false): string {
  switch (analysis.kind) {
    case "tran": {
      if (!Number.isFinite(analysis.stopTime) || analysis.stopTime <= 0 || !Number.isInteger(analysis.steps) || analysis.steps < 2) {
        throw new Error("Transient analysis needs a positive stop time and at least two output steps.");
      }
      return `.tran ${analysis.stopTime / analysis.steps} ${analysis.stopTime}${useInitialConditions ? " uic" : ""}`;
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
  }
}

function instanceName(component: SchematicComponent, index: number): string {
  const prefix: Record<ComponentKind, string> = {
    resistor: "R", capacitor: "C", inductor: "L", vsource: "V", isource: "I", vac: "V", iac: "I", vpulse: "V",
    diode: "D", led: "D", zener: "D", opamp: "E", comparator: "B", digitalGate: "B", dflop: "A", sampleHold: "A", modulator: "A", vcvs: "E", vccs: "G", cccs: "F", ccvs: "H", bsource: "B", nmos: "M", pmos: "M", njf: "J", pjf: "J", npn: "Q", pnp: "Q",
    potentiometer: "R", switch: "R", transformer: "L", tline: "T", subckt: "X", testpoint: "X", ground: "X",
  };
  const requested = safeName(component.label);
  const p = prefix[component.kind];
  // SPICE identifiers are case-insensitive. Preserve a user's lowercase
  // refdes so `R1` and `r1` reach the duplicate-name guard as the same device
  // instead of manufacturing a misleading `Rr1` fallback.
  if (requested.slice(0, p.length).toLocaleLowerCase() === p.toLocaleLowerCase()) return requested;
  // The label doesn't match the kind's SPICE prefix — this happens when a device
  // is remapped to a placeholder kind (diac/varistor → resistor keep their `Q1`/
  // `A1` labels). A bare `${p}${index+1}` fallback can COLLIDE with a real
  // component that legitimately owns that name (dimmer.asc: diac `Q1`→`R1`
  // clashed with the actual `R1`). Suffix the sanitized label instead so the
  // SPICE name stays unique and still traces back to the LTspice refdes.
  return requested ? `${p}${requested}` : `${p}${index + 1}`;
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
  // on M lines; KP/VTO on the instance are ignored by some engines — keep
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
  const [primaryRaw, secondaryRaw] = value.split(":").map((part) => Number(part.trim()));
  if (Number.isFinite(primaryRaw) && Number.isFinite(secondaryRaw) && primaryRaw > 0 && secondaryRaw > 0) {
    return { primary: primaryRaw, secondary: secondaryRaw };
  }
  return { primary: 1, secondary: 1 };
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, "_") || "X";
}
