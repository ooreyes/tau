import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runTauCli, type TauCliIo } from "./runTauCli";
import { TAU_CLI_API_VERSION, TAU_CLI_DIAGNOSE_KIND } from "./tauCliApi";

const DIVIDER_PATH = join(process.cwd(), "../../Circuit_testing_v1/01_op_voltage_divider.asc");
const DIVIDER_ASC = readFileSync(DIVIDER_PATH, "utf8");

function mockIo(opts: {
  files?: Record<string, string>;
  stdin?: string;
}): { io: TauCliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      readFile: (path) => {
        const text = opts.files?.[path];
        if (text === undefined) throw new Error(`ENOENT: ${path}`);
        return text;
      },
      readStdin: () => opts.stdin ?? "",
      writeOut: (text) => { out.push(text); },
      writeErr: (text) => { err.push(text); },
    },
  };
}

describe("runTauCli", () => {
  it("diagnose --json emits parseable envelope and exit 0", () => {
    const { io, out, err } = mockIo({ files: { [DIVIDER_PATH]: DIVIDER_ASC } });
    const outcome = runTauCli(["diagnose", "--json", DIVIDER_PATH], io);
    expect(err).toEqual([]);
    expect(outcome.exitCode).toBe(0);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.kind).toBe(TAU_CLI_DIAGNOSE_KIND);
    expect(parsed.apiVersion).toBe(TAU_CLI_API_VERSION);
    expect(parsed.status).toBe("ok");
    expect(parsed.stages.deck.ok).toBe(true);
  });

  it("diagnose --text --json reads stdin", () => {
    const { io, out } = mockIo({ stdin: DIVIDER_ASC });
    const outcome = runTauCli(["diagnose", "--text", "--json"], io);
    expect(outcome.exitCode).toBe(0);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.source.title).toBe("stdin.asc");
    expect(parsed.source.path).toBeNull();
  });

  it("usage errors exit 64 with help on stderr", () => {
    const { io, err } = mockIo({});
    const outcome = runTauCli(["diagnose"], io);
    expect(outcome.exitCode).toBe(64);
    expect(err.join("")).toMatch(/requires/);
    expect(err.join("")).toMatch(/tau-cli diagnose/);
  });

  it("version prints api version", () => {
    const { io, out } = mockIo({});
    const outcome = runTauCli(["version"], io);
    expect(outcome.exitCode).toBe(0);
    expect(out.join("")).toContain(TAU_CLI_API_VERSION);
  });
});
