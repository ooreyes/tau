/**
 * Fail-closed packaged-ngspice gate for AI circuit proposals.
 *
 * Structural ASC checks (assistantActions) are necessary but not sufficient:
 * Tau must prove the generated schematic builds a deck and converges under
 * packaged ngspice before Create / Apply mutates the project. When the native
 * runtime is unavailable, validation refuses rather than skipping.
 */
import { invoke } from "@tauri-apps/api/core";
import { buildSpiceDeck, unresolvedSubcktMessage } from "../engine/spiceNetlist";
import { isNativeSpiceRuntime } from "../engine/nativeSpice";
import { ngspiceOpSucceeded } from "../io/corpusReport";
import { buildParamScope } from "../simulation/paramScope";
import type { NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";

export const ASSISTANT_NGSPICE_REQUIRED =
  "Tau needs packaged ngspice to validate this circuit before applying it. Open the desktop app and try again.";

export const ASSISTANT_NGSPICE_REFUSED_PREFIX =
  "Tau refused to apply this circuit because packaged ngspice could not validate it";

export interface AssistantProposalDocument {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels?: NetLabel[];
  directives?: string[];
  userModelLibraries?: ReadonlyArray<{ name: string; text: string }>;
}

export interface AssistantNgspiceRunResult {
  /** Combined stdout/stderr / worker messages from the ngspice run. */
  output: string;
  /** Process / worker exit status. Null means the runner could not start. */
  status: number | null;
  /** Count of finite non-ground node voltages when the packaged path returns vectors. */
  voltageCount?: number;
}

/** Injectable runner for unit tests; production uses packaged Tauri ngspice. */
export type AssistantNgspiceRunner = (netlist: string) => Promise<AssistantNgspiceRunResult>;

export type AssistantNgspiceValidation =
  | { ok: true; netlist: string }
  | { ok: false; reason: string };

interface NativeVector {
  name: string;
  real: number[];
  imaginary: number[] | null;
}

interface NativeSpiceResult {
  plot: string;
  vectors: NativeVector[];
  extraPlots: Array<{ name: string; vectors: NativeVector[] }>;
  messages: string[];
  libraryPath: string;
}

async function packagedNgspiceRunner(netlist: string): Promise<AssistantNgspiceRunResult> {
  if (!isNativeSpiceRuntime()) {
    return { output: "", status: null, voltageCount: 0 };
  }
  const result = await invoke<NativeSpiceResult>("simulate_spice", { request: { netlist } });
  const output = result.messages.join("\n");
  const voltageCount = result.vectors.filter((vector) => {
    const name = vector.name.toLowerCase().replace(/\s+/g, "");
    if (!name.startsWith("v(") || name === "v(0)") return false;
    return Number.isFinite(vector.real[0]);
  }).length;
  // Packaged worker returns only on completion; treat missing voltages as failure
  // even when messages omit CLI "no. of data rows" phrasing.
  const status = voltageCount > 0 && !/\b(fatal error|singular matrix|no convergence|simulation\(s\) aborted)\b/i.test(output)
    ? 0
    : 1;
  return { output, status, voltageCount };
}

function refuse(detail: string): AssistantNgspiceValidation {
  const trimmed = detail.trim().replace(/\s+/g, " ");
  return {
    ok: false,
    reason: `${ASSISTANT_NGSPICE_REFUSED_PREFIX}: ${trimmed.slice(0, 280)}`,
  };
}

/**
 * Build an `.op` deck from a proposal document and require packaged ngspice to
 * converge before the UI may Create / Apply. Fail-closed on missing runtime,
 * deck-build refusal, unresolved subcircuits, or non-converging solves.
 */
export async function validateAssistantProposalBeforeApply(
  document: AssistantProposalDocument,
  options?: { runNetlist?: AssistantNgspiceRunner },
): Promise<AssistantNgspiceValidation> {
  const directives = document.directives ?? [];
  const libraries = document.userModelLibraries ?? [];
  let netlist: string;
  try {
    const deck = buildSpiceDeck(
      {
        components: document.components,
        wires: document.wires,
        netLabels: document.netLabels,
        params: buildParamScope(directives),
        directives,
        userModelLibraries: libraries.map((library) => library.text),
        userModelLibraryNames: libraries.map((library) => library.name),
      },
      { kind: "op" },
    );
    if (deck.unresolvedSubckts.length > 0) {
      return refuse(unresolvedSubcktMessage(deck.unresolvedSubckts));
    }
    netlist = deck.netlist;
  } catch (error) {
    const message = error instanceof Error ? error.message : "deck build failed";
    return refuse(message);
  }

  const runner = options?.runNetlist ?? packagedNgspiceRunner;
  let run: AssistantNgspiceRunResult;
  try {
    run = await runner(netlist);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ngspice runner failed";
    return refuse(message);
  }

  if (run.status === null && !(options?.runNetlist)) {
    return { ok: false, reason: ASSISTANT_NGSPICE_REQUIRED };
  }

  if (typeof run.voltageCount === "number") {
    if (run.voltageCount <= 0 || run.status !== 0) {
      const detail = run.output.trim() || "operating point returned no node voltages";
      return refuse(detail.slice(-400));
    }
    return { ok: true, netlist };
  }

  if (!ngspiceOpSucceeded(run.output, run.status)) {
    const detail = run.output.trim() || `ngspice exited with status ${String(run.status)}`;
    return refuse(detail.slice(-400));
  }
  return { ok: true, netlist };
}
