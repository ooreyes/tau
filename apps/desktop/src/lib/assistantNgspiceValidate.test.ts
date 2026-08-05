import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAssistantCircuitPlan } from "./assistantCircuitPlan";
import {
  ASSISTANT_NGSPICE_REFUSED_PREFIX,
  ASSISTANT_NGSPICE_REQUIRED,
  validateAssistantProposalBeforeApply,
  type AssistantProposalDocument,
} from "./assistantNgspiceValidate";

/** Same topology the Create button compiles — electrically complete for Tau. */
const RC_PLAN = {
  mode: "create" as const,
  filename: "rc-filter.asc",
  components: [
    { ref: "V1", kind: "vsource", value: "5" },
    { ref: "R1", kind: "resistor", value: "1k" },
    { ref: "C1", kind: "capacitor", value: "1u" },
  ],
  nets: [
    { name: "VIN", pins: ["V1.p", "R1.a"] },
    { name: "OUT", pins: ["R1.b", "C1.a"] },
    { name: "0", pins: ["V1.n", "C1.b"] },
  ],
  directives: [".op"],
};

function rcProposal(): AssistantProposalDocument {
  const action = compileAssistantCircuitPlan("rc-plan", RC_PLAN);
  return action.document;
}

const haveNgspice = spawnSync("ngspice", ["--version"], { encoding: "utf8" }).error === undefined;

function cliNgspiceRunner(netlist: string) {
  const dir = mkdtempSync(join(tmpdir(), "tau-ai-ngspice-"));
  try {
    const cir = join(dir, "proposal.cir");
    writeFileSync(cir, netlist);
    const run = spawnSync("ngspice", ["-b", cir], { encoding: "utf8", timeout: 30_000 });
    return Promise.resolve({
      output: `${run.stdout ?? ""}\n${run.stderr ?? ""}`,
      status: run.status,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("validateAssistantProposalBeforeApply", () => {
  it("refuses when packaged ngspice is unavailable (fail-closed, no skip)", async () => {
    const result = await validateAssistantProposalBeforeApply(rcProposal());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason).toBe(ASSISTANT_NGSPICE_REQUIRED);
  });

  it("refuses when the injected runner reports a non-converging solve", async () => {
    const result = await validateAssistantProposalBeforeApply(rcProposal(), {
      runNetlist: async () => ({
        output: "Fatal error: singular matrix\nsimulation(s) aborted",
        status: 1,
      }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason.startsWith(ASSISTANT_NGSPICE_REFUSED_PREFIX)).toBe(true);
    expect(result.reason.toLowerCase()).toMatch(/singular|aborted|fatal/);
  });

  it("refuses when the packaged path returns zero node voltages", async () => {
    const result = await validateAssistantProposalBeforeApply(rcProposal(), {
      runNetlist: async () => ({ output: "ok", status: 0, voltageCount: 0 }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason.startsWith(ASSISTANT_NGSPICE_REFUSED_PREFIX)).toBe(true);
  });

  it("refuses when deck build throws (unresolved brace value)", async () => {
    const proposal = rcProposal();
    const broken = {
      ...proposal,
      components: proposal.components.map((component) => (
        component.label === "R1"
          ? { ...component, value: "{missing_param}" }
          : component
      )),
    };
    const result = await validateAssistantProposalBeforeApply(broken, {
      runNetlist: async () => ({ output: "should not run", status: 0 }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason.startsWith(ASSISTANT_NGSPICE_REFUSED_PREFIX)).toBe(true);
    expect(result.reason.toLowerCase()).not.toContain("should not run");
  });

  it("accepts a converging OP when the runner proves success", async () => {
    const result = await validateAssistantProposalBeforeApply(rcProposal(), {
      runNetlist: async (netlist) => {
        expect(netlist).toMatch(/\.op\b/i);
        expect(netlist).toMatch(/R1/i);
        expect(netlist).not.toMatch(/V1\s+0\s+0\b/);
        return {
          output: "No. of Data Rows : 1\n",
          status: 0,
        };
      },
    });
    expect(result).toEqual(expect.objectContaining({ ok: true }));
  });

  it.skipIf(!haveNgspice)("proves a real RC through CLI ngspice before apply", async () => {
    const result = await validateAssistantProposalBeforeApply(rcProposal(), {
      runNetlist: cliNgspiceRunner,
    });
    expect(result.ok, result.ok ? "" : result.reason).toBe(true);
  });

  it.skipIf(!haveNgspice)("fail-closes when CLI ngspice is handed a broken netlist", async () => {
    const result = await validateAssistantProposalBeforeApply(rcProposal(), {
      runNetlist: async (netlist) => {
        // Corrupt the otherwise-valid deck so ngspice must abort — proves the
        // gate does not treat a non-zero exit as success.
        const broken = netlist.replace(/\.op\b/i, ".op\nVboom 0 0 1");
        return cliNgspiceRunner(broken);
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason.startsWith(ASSISTANT_NGSPICE_REFUSED_PREFIX)).toBe(true);
  });
});
