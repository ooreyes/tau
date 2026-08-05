/**
 * I/O runner for the versioned Tau CLI (`tau.cli.v1`).
 * Pure enough to unit-test with injected read/write; the shell entry wires
 * real fs / stdio.
 */

import { basename } from "node:path";
import {
  cliHelp,
  cliVersion,
  diagnoseAsc,
  exitCodeForUsageError,
  formatCliText,
  parseTauCliArgs,
  serializeCliResult,
  type TauCliExitCode,
  type TauCliResult,
} from "./tauCliApi";

export interface TauCliIo {
  readFile(path: string): string;
  readStdin(): string;
  writeOut(text: string): void;
  writeErr(text: string): void;
}

export interface TauCliRunOutcome {
  exitCode: TauCliExitCode;
  result: TauCliResult | null;
}

export function runTauCli(argv: readonly string[], io: TauCliIo): TauCliRunOutcome {
  const parsed = parseTauCliArgs(argv);
  if (parsed.usageError) {
    io.writeErr(`${parsed.usageError}\n`);
    io.writeErr(formatCliText(cliHelp()));
    return { exitCode: exitCodeForUsageError(), result: null };
  }

  const command = parsed.command ?? "help";
  let result: TauCliResult;
  if (command === "help") {
    result = cliHelp();
  } else if (command === "version") {
    result = cliVersion();
  } else {
    let text: string;
    let path: string | null = parsed.path;
    let title: string;
    try {
      if (parsed.fromStdin) {
        text = io.readStdin();
        title = "stdin.asc";
        path = null;
      } else {
        text = io.readFile(parsed.path!);
        title = basename(parsed.path!);
      }
    } catch (error) {
      io.writeErr(`${error instanceof Error ? error.message : String(error)}\n`);
      return { exitCode: 2, result: null };
    }
    result = diagnoseAsc({ text, title, path });
  }

  const output = parsed.json ? serializeCliResult(result) : formatCliText(result);
  io.writeOut(output);
  if (result.kind === "tau.cli.diagnose.v1") {
    return { exitCode: result.exitCode, result };
  }
  return { exitCode: 0, result };
}
