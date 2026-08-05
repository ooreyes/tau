import type { SchematicComponent } from "../schematic/types";
import type { DcSweepSpec } from "./dcSweep";
import type { TfSpec } from "./transferFunction";
import type { NoiseSpec } from "./noise";
import type { StepSpec } from "./paramStep";

const SWEEPABLE_KINDS = new Set(["vsource", "isource", "vac", "iac"]);
// Must use the exact `ComponentKind` spellings (schematic/types.ts). The FETs
// were previously listed as "nmosp"/"pmosp"/"njfet"/"pjfet", which match no
// kind at all, so alt-clicking a MOSFET or JFET silently did nothing.
const CURRENT_PROBE_KINDS = new Set([
  "resistor", "capacitor", "polarizedCapacitor", "inductor", "vsource", "isource",
  "logicConstant", "diode", "led",
  "zener", "nmos", "pmos", "njf", "pjf", "npn", "pnp",
]);

export function sweepableSources(components: readonly SchematicComponent[]): SchematicComponent[] {
  return components.filter((c) => SWEEPABLE_KINDS.has(c.kind) && c.label.trim());
}

export function labeledComponents(components: readonly SchematicComponent[]): SchematicComponent[] {
  return components.filter((c) => c.label.trim() && c.kind !== "ground");
}

export function canCurrentProbe(kind: SchematicComponent["kind"]): boolean {
  return CURRENT_PROBE_KINDS.has(kind);
}

export function defaultDcSetup(components: readonly SchematicComponent[], prev?: DcSweepSpec): DcSweepSpec {
  const sources = sweepableSources(components);
  const source = sources.some((s) => s.label === prev?.source)
    ? prev!.source
    : sources[0]?.label ?? prev?.source ?? "V1";
  return {
    source,
    start: prev?.start ?? 0,
    stop: prev?.stop ?? 5,
    step: prev?.step ?? 0.1,
  };
}

export function defaultTfSetup(components: readonly SchematicComponent[], prev?: TfSpec): TfSpec {
  const sources = sweepableSources(components);
  const source = sources.some((s) => s.label === prev?.source)
    ? prev!.source
    : sources[0]?.label ?? prev?.source ?? "V1";
  return {
    output: prev?.output ?? { kind: "voltage", pos: "out" },
    source,
  };
}

export function defaultNoiseSetup(components: readonly SchematicComponent[], prev?: NoiseSpec): NoiseSpec {
  const sources = sweepableSources(components);
  const source = sources.some((s) => s.label === prev?.source)
    ? prev!.source
    : sources[0]?.label ?? prev?.source ?? "V1";
  return {
    output: prev?.output ?? { pos: "out" },
    source,
    sweep: prev?.sweep ?? { startHz: 10, stopHz: 1e6, pointsPerDecade: 20 },
  };
}

export function defaultStepSetup(components: readonly SchematicComponent[]): StepSpec {
  const src = sweepableSources(components)[0]?.label ?? "V1";
  return { kind: "source", name: src, values: [0, 1, 2, 3, 4, 5] };
}

/** UI-held step sweep as linear start/stop/increment before enumerating values. */
export interface StepSetupUi {
  kind: "source" | "param" | "temp";
  name: string;
  start: number;
  stop: number;
  step: number;
}

export function defaultStepSetupUi(components: readonly SchematicComponent[], prev?: StepSetupUi): StepSetupUi {
  const sources = sweepableSources(components);
  const name = prev?.kind === "source" && sources.some((s) => s.label === prev.name)
    ? prev.name
    : sources[0]?.label ?? prev?.name ?? "V1";
  return {
    kind: prev?.kind ?? "source",
    name,
    start: prev?.start ?? 0,
    stop: prev?.stop ?? 5,
    step: prev?.step ?? 1,
  };
}

export function stepSetupToSpec(ui: StepSetupUi): StepSpec | null {
  if (ui.step === 0) return null;
  const values: number[] = [];
  const dir = ui.stop >= ui.start ? 1 : -1;
  const inc = Math.abs(ui.step) * dir;
  for (let v = ui.start; dir > 0 ? v <= ui.stop + 1e-9 : v >= ui.stop - 1e-9; v += inc) {
    values.push(v);
    if (values.length > 64) break;
  }
  if (values.length === 0) return null;
  return ui.kind === "temp"
    ? { kind: "temp", values }
    : { kind: ui.kind, name: ui.name.trim() || undefined, values };
}
